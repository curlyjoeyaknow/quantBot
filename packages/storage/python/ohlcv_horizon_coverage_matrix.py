#!/usr/bin/env python3
"""
OHLCV Horizon Coverage Matrix Generator

Generates a coverage matrix showing OHLCV data availability at different horizon times
for alerts grouped by month. This helps identify:
- Which months have sufficient data for backtests
- What horizon times are available for different alerts
- Where targeted data fetching is needed

Matrix structure:
- Columns: Monthly buckets (2025-05-01 to 2026-01-05)
- Rows: Horizon times (-4hrs, 0hrs, +4hrs, +12hrs, +24hrs, +48hrs, +72hrs, +144hrs, +288hrs)
- Values: Coverage percentage (0-100%) for 1m or 5m candles

Usage:
    python3 ohlcv_horizon_coverage_matrix.py --duckdb data/tele.duckdb --interval 1m
    python3 ohlcv_horizon_coverage_matrix.py --duckdb data/tele.duckdb --interval 5m --visualize
"""

import argparse
import os
import sys
import warnings
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

# Add tools/shared to path for imports
_shared_path = os.path.join(os.path.dirname(__file__), '..', 'shared')
if _shared_path not in sys.path:
    sys.path.insert(0, _shared_path)
from progress_bar import ProgressBar

# Suppress deprecation warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)


# Horizon times in hours (relative to alert time)
HORIZONS = [-4, 0, 4, 12, 24, 48, 72, 144, 288]

# Month range: 2025-05-01 to 2026-01-05
START_MONTH = datetime(2025, 5, 1)
END_MONTH = datetime(2026, 1, 5)


def get_clickhouse_client() -> Tuple[ClickHouseClient, str]:
    """Get ClickHouse client from environment or defaults."""
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    env_port_str = os.getenv('CLICKHOUSE_PORT', '19000')
    env_port = int(env_port_str)
    
    # Map HTTP ports to native protocol ports
    if env_port == 8123:
        port = 9000
    elif env_port == 18123:
        port = 19000
    else:
        port = env_port
    
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    connect_timeout = int(os.getenv('CLICKHOUSE_CONNECT_TIMEOUT', '5'))
    send_receive_timeout = int(os.getenv('CLICKHOUSE_SEND_RECEIVE_TIMEOUT', '60'))
    
    client = ClickHouseClient(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password,
        connect_timeout=connect_timeout,
        send_receive_timeout=send_receive_timeout
    )
    
    # Test connection
    client.execute('SELECT 1')
    return client, database


def get_duckdb_connection(db_path: str) -> duckdb.DuckDBPyConnection:
    """
    Get DuckDB connection and ensure schema exists.
    
    DEPRECATED: Use get_write_connection() from tools.shared.duckdb_adapter instead.
    This function is kept for backward compatibility but now uses the adapter internally.
    """
    from tools.shared.duckdb_adapter import get_connection as adapter_get_connection
    # Use adapter which handles empty/invalid files and sets busy_timeout
    # Note: We manually enter the context manager to return the connection
    # This is not ideal but maintains backward compatibility
    ctx = adapter_get_connection(db_path, read_only=False)
    return ctx.__enter__()


def check_table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    """Check if a table exists in DuckDB."""
    try:
        result = conn.execute(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?",
            [table_name]
        ).fetchone()
        return result[0] > 0 if result else False
    except Exception:
        # Fallback: try to query the table directly
        try:
            conn.execute(f"SELECT 1 FROM {table_name} LIMIT 1")
            return True
        except Exception:
            return False


def list_available_tables(conn: duckdb.DuckDBPyConnection) -> List[str]:
    """List all available tables in DuckDB."""
    try:
        result = conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
        ).fetchall()
        return [row[0] for row in result]
    except Exception:
        # Fallback: try to get from pragma
        try:
            result = conn.execute("PRAGMA show_tables").fetchall()
            return [row[0] for row in result] if result else []
        except Exception:
            return []


def get_month_buckets() -> List[Tuple[str, datetime, datetime]]:
    """Generate month buckets from 2025-05-01 to 2026-01-05."""
    buckets = []
    current = START_MONTH
    
    while current <= END_MONTH:
        # Calculate end of month (or END_MONTH if we're in the last month)
        if current.month == END_MONTH.month and current.year == END_MONTH.year:
            month_end = END_MONTH
        else:
            # First day of next month
            if current.month == 12:
                next_month = datetime(current.year + 1, 1, 1)
            else:
                next_month = datetime(current.year, current.month + 1, 1)
            month_end = next_month - timedelta(days=1)
        
        month_key = current.strftime('%Y-%m')
        buckets.append((month_key, current, month_end))
        
        # Move to next month
        if current.month == 12:
            current = datetime(current.year + 1, 1, 1)
        else:
            current = datetime(current.year, current.month + 1, 1)
    
    return buckets


def get_alerts_by_month(
    conn: duckdb.DuckDBPyConnection,
    month_start: datetime,
    month_end: datetime
) -> List[Dict]:
    """Get alerts for a specific month from DuckDB."""
    month_start_ts_ms = int(month_start.timestamp() * 1000)
    month_end_ts_ms = int(month_end.timestamp() * 1000)
    
    # Check which tables exist
    has_caller_links = check_table_exists(conn, 'caller_links_d')
    has_user_calls = check_table_exists(conn, 'user_calls_d')
    has_simulation_runs = check_table_exists(conn, 'simulation_runs')
    
    if not has_caller_links and not has_user_calls and not has_simulation_runs:
        # List available tables for debugging
        available_tables = list_available_tables(conn)
        print(f"Warning: No alert tables found. Available tables: {', '.join(available_tables) if available_tables else 'none'}", file=sys.stderr)
        return []
    
    # Try caller_links_d first (preferred), fallback to user_calls_d, then simulation_runs
    if has_caller_links:
        query = """
            SELECT DISTINCT
                mint,
                COALESCE(chain, 'solana') as chain,
                trigger_ts_ms as alert_timestamp,
                trigger_from_name as caller_name
            FROM caller_links_d
            WHERE trigger_ts_ms >= ? 
              AND trigger_ts_ms <= ?
              AND mint IS NOT NULL
              AND mint != ''
              AND trigger_ts_ms IS NOT NULL
            ORDER BY trigger_ts_ms
        """
        
        try:
            result = conn.execute(query, [month_start_ts_ms, month_end_ts_ms]).fetchall()
            alerts = []
            for row in result:
                alerts.append({
                    'mint': row[0],
                    'chain': row[1] or 'solana',
                    'alert_timestamp': row[2],
                    'caller_name': row[3] if len(row) > 3 else None,
                })
            return alerts
        except Exception as e:
            print(f"Warning: Querying caller_links_d failed: {e}. Trying user_calls_d...", file=sys.stderr)
            # Mark as failed, will try user_calls_d
            pass
    
    # Fallback to user_calls_d
    if has_user_calls:
        query = """
            SELECT DISTINCT
                mint,
                'solana' as chain,
                call_ts_ms as alert_timestamp,
                caller_name
            FROM user_calls_d
            WHERE call_ts_ms >= ? 
              AND call_ts_ms <= ?
              AND mint IS NOT NULL
              AND mint != ''
              AND call_ts_ms IS NOT NULL
            ORDER BY call_ts_ms
        """
        try:
            result = conn.execute(query, [month_start_ts_ms, month_end_ts_ms]).fetchall()
            alerts = []
            for row in result:
                alerts.append({
                    'mint': row[0],
                    'chain': row[1] or 'solana',
                    'alert_timestamp': row[2],
                    'caller_name': row[3] if len(row) > 3 else None,
                })
            return alerts
        except Exception as e2:
            print(f"Warning: Error querying user_calls_d for month {month_start.strftime('%Y-%m')}: {e2}", file=sys.stderr)
            # Continue to try simulation_runs if available
    
    # Fallback to simulation_runs (has alert_timestamp and mint)
    if has_simulation_runs:
        # Convert timestamps: simulation_runs.alert_timestamp is TIMESTAMP, need to convert to ms
        month_start_ts = month_start
        month_end_ts = month_end
        
        query = """
            SELECT DISTINCT
                mint,
                'solana' as chain,
                CAST(EXTRACT(EPOCH FROM alert_timestamp) * 1000 AS BIGINT) as alert_timestamp,
                caller_name
            FROM simulation_runs
            WHERE alert_timestamp >= ? 
              AND alert_timestamp <= ?
              AND mint IS NOT NULL
              AND mint != ''
              AND alert_timestamp IS NOT NULL
            ORDER BY alert_timestamp
        """
        try:
            result = conn.execute(query, [month_start_ts, month_end_ts]).fetchall()
            alerts = []
            for row in result:
                alerts.append({
                    'mint': row[0],
                    'chain': row[1] or 'solana',
                    'alert_timestamp': row[2],
                    'caller_name': row[3] if len(row) > 3 else None,
                })
            return alerts
        except Exception as e3:
            print(f"Warning: Error querying simulation_runs for month {month_start.strftime('%Y-%m')}: {e3}", file=sys.stderr)
            return []
    
    return []


def normalize_chain(chain: str) -> str:
    """Normalize chain name to lowercase canonical form."""
    if not chain:
        return 'solana'  # Default
    
    chain_lower = chain.lower().strip()
    
    # Chain name mapping
    chain_map = {
        'sol': 'solana',
        'solana': 'solana',
        'eth': 'ethereum',
        'ethereum': 'ethereum',
        'bnb': 'bsc',
        'bsc': 'bsc',
        'base': 'base',
        'evm': 'evm',
    }
    
    return chain_map.get(chain_lower, chain_lower)


def check_coverage_at_horizon(
    ch_client: ClickHouseClient,
    database: str,
    mint: str,
    chain: str,
    alert_ts_ms: int,
    horizon_hours: int,
    interval: str,
    window_minutes: int = 60,  # Check 1 hour window around horizon point
    debug: bool = False
) -> bool:
    """
    Check if OHLCV data exists at a specific horizon time.
    
    Args:
        ch_client: ClickHouse client
        database: Database name
        mint: Token mint address
        chain: Chain identifier
        alert_ts_ms: Alert timestamp in milliseconds
        horizon_hours: Horizon time in hours (negative = before alert, positive = after)
        interval: Candle interval ('1m' or '5m')
        window_minutes: Window size in minutes to check around horizon point
        debug: If True, print debug information
    
    Returns:
        True if data exists, False otherwise
    """
    # Normalize chain to lowercase
    normalized_chain = normalize_chain(chain)
    
    # Calculate horizon timestamp
    horizon_ts_ms = alert_ts_ms + (horizon_hours * 3600 * 1000)
    
    # Calculate window around horizon
    window_start_ms = horizon_ts_ms - (window_minutes * 60 * 1000)
    window_end_ms = horizon_ts_ms + (window_minutes * 60 * 1000)
    
    window_start_sec = window_start_ms // 1000
    window_end_sec = window_end_ms // 1000
    
    # Escape values for SQL (use parameterized query if possible, but ClickHouse driver may not support it)
    escaped_mint = mint.replace("'", "''")
    escaped_chain = normalized_chain.replace("'", "''")
    escaped_interval = interval.replace("'", "''")
    
    # Use exact matching first (more reliable than LIKE patterns)
    # Try exact match first, then case-insensitive if needed
    query = f"""
        SELECT count() as count
        FROM {database}.ohlcv_candles
        WHERE token_address = '{escaped_mint}'
          AND lower(chain) = lower('{escaped_chain}')
          AND `interval` = '{escaped_interval}'
          AND timestamp >= toDateTime({window_start_sec})
          AND timestamp <= toDateTime({window_end_sec})
        LIMIT 1
    """
    
    try:
        result = ch_client.execute(query)
        if result and len(result) > 0:
            count = result[0][0] if isinstance(result[0], tuple) else result[0]
            if debug and count == 0:
                # Try a broader query to see if data exists at all
                debug_query = f"""
                    SELECT count() as count
                    FROM {database}.ohlcv_candles
                    WHERE token_address = '{escaped_mint}'
                      AND lower(chain) = lower('{escaped_chain}')
                      AND timestamp >= toDateTime({window_start_sec})
                      AND timestamp <= toDateTime({window_end_sec})
                    LIMIT 1
                """
                debug_result = ch_client.execute(debug_query)
                debug_count = debug_result[0][0] if debug_result and len(debug_result) > 0 else 0
                if debug_count > 0:
                    print(f"Debug: Found {debug_count} candles for {mint[:8]}... but none with interval '{interval}'", file=sys.stderr)
            return count > 0
        return False
    except Exception as e:
        # Log error for debugging (but don't spam)
        if debug:
            print(f"Debug: Query failed for {mint[:8]}... chain={normalized_chain} interval={interval}: {e}", file=sys.stderr)
        return False




def calculate_coverage_matrix(
    conn: duckdb.DuckDBPyConnection,
    ch_client: ClickHouseClient,
    database: str,
    interval: str,
    progress_callback: Optional[callable] = None,
    debug: bool = False
) -> Tuple[Dict[str, Dict[int, float]], Dict[str, int]]:
    """
    Calculate coverage matrix: month -> horizon -> coverage percentage.
    
    Returns:
        Tuple of (coverage_matrix, total_alerts)
        coverage_matrix: Dict mapping month_key -> horizon_hours -> coverage_percentage
        total_alerts: Dict mapping month_key -> total alert count
    """
    month_buckets = get_month_buckets()
    matrix = defaultdict(lambda: defaultdict(int))  # month -> horizon -> count_with_coverage
    total_alerts = defaultdict(int)  # month -> total alerts
    
    total_checks = 0
    completed_checks = 0
    
    # Pre-calculate total checks for progress
    total_alerts_count = 0
    for month_key, month_start, month_end in month_buckets:
        alerts = get_alerts_by_month(conn, month_start, month_end)
        total_alerts_count += len(alerts)
        total_checks += len(alerts) * len(HORIZONS)
    
    print(f"Found {total_alerts_count:,} total alerts across all months", file=sys.stderr)
    print(f"Total coverage checks to perform: {total_checks:,} (alerts × {len(HORIZONS)} horizons)", file=sys.stderr)
    print("", file=sys.stderr)  # Empty line before progress bar
    
    # Use ProgressBar class for better control
    with ProgressBar(total=total_checks, prefix="Processing", update_interval=10) as progress:
        for month_key, month_start, month_end in month_buckets:
            alerts = get_alerts_by_month(conn, month_start, month_end)
            
            if not alerts:
                continue
            
            total_alerts[month_key] = len(alerts)
            
            for alert_idx, alert in enumerate(alerts):
                mint = alert['mint']
                chain = alert['chain']
                alert_ts_ms = alert['alert_timestamp']
                
                for horizon in HORIZONS:
                    has_coverage = check_coverage_at_horizon(
                        ch_client,
                        database,
                        mint,
                        chain,
                        alert_ts_ms,
                        horizon,
                        interval,
                        debug=debug
                    )
                    
                    if has_coverage:
                        matrix[month_key][horizon] += 1
                    
                    completed_checks += 1
                    
                    if progress_callback:
                        progress_callback(completed_checks, total_checks)
                    
                    # Update progress bar with current month in prefix
                    progress.update(completed_checks, prefix=f"Processing {month_key}")
    
    # Convert counts to percentages
    coverage_matrix = {}
    for month_key in matrix:
        coverage_matrix[month_key] = {}
        total = total_alerts[month_key]
        if total > 0:
            for horizon in HORIZONS:
                count = matrix[month_key][horizon]
                coverage_matrix[month_key][horizon] = (count / total) * 100.0
        else:
            for horizon in HORIZONS:
                coverage_matrix[month_key][horizon] = 0.0
    
    return coverage_matrix, dict(total_alerts)


def create_schema(conn: duckdb.DuckDBPyConnection, interval: str):
    """Create schema for storing coverage matrix."""
    table_name = f'ohlcv_horizon_coverage_{interval}'
    
    schema_sql = f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            month_key TEXT NOT NULL,
            horizon_hours INTEGER NOT NULL,
            coverage_percentage DOUBLE NOT NULL,
            total_alerts INTEGER NOT NULL,
            alerts_with_coverage INTEGER NOT NULL,
            interval TEXT NOT NULL,
            generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (month_key, horizon_hours, interval)
        );
        
        CREATE INDEX IF NOT EXISTS idx_{table_name}_month ON {table_name}(month_key);
        CREATE INDEX IF NOT EXISTS idx_{table_name}_horizon ON {table_name}(horizon_hours);
    """
    
    try:
        conn.execute(schema_sql)
    except Exception as e:
        if 'already exists' not in str(e).lower():
            print(f"Warning: Schema creation had issues: {e}", file=sys.stderr)


def store_matrix(
    conn: duckdb.DuckDBPyConnection,
    matrix: Dict[str, Dict[int, float]],
    total_alerts: Dict[str, int],
    interval: str
):
    """Store coverage matrix in DuckDB."""
    table_name = f'ohlcv_horizon_coverage_{interval}'
    
    # Clear existing data for this interval
    conn.execute(f"DELETE FROM {table_name} WHERE interval = ?", [interval])
    
    # Insert new data
    for month_key, horizons in matrix.items():
        total = total_alerts.get(month_key, 0)
        for horizon, coverage_pct in horizons.items():
            alerts_with_coverage = int((coverage_pct / 100.0) * total) if total > 0 else 0
            
            conn.execute(
                f"""
                INSERT INTO {table_name} 
                (month_key, horizon_hours, coverage_percentage, total_alerts, alerts_with_coverage, interval)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [month_key, horizon, coverage_pct, total, alerts_with_coverage, interval]
            )
    
    print(f"Stored coverage matrix in {table_name}", file=sys.stderr)


def visualize_matrix(matrix: Dict[str, Dict[int, float]], interval: str):
    """Print coverage matrix with histogram visualization."""
    month_buckets = get_month_buckets()
    month_keys = [key for key, _, _ in month_buckets]
    
    print(f"\n{'='*80}")
    print(f"OHLCV Coverage Matrix - {interval} candles")
    print(f"{'='*80}\n")
    
    # Header
    print(f"{'Horizon':<12}", end="")
    for month_key in month_keys:
        print(f"{month_key:>8}", end="")
    print()
    print("-" * (12 + 8 * len(month_keys)))
    
    # Rows
    for horizon in HORIZONS:
        horizon_label = f"{horizon:+4d}hrs"
        print(f"{horizon_label:<12}", end="")
        
        for month_key in month_keys:
            coverage = matrix.get(month_key, {}).get(horizon, 0.0)
            
            # Color coding (simple terminal colors)
            if coverage >= 90:
                color_code = "\033[32m"  # Green
            elif coverage >= 75:
                color_code = "\033[33m"  # Yellow
            elif coverage >= 50:
                color_code = "\033[93m"  # Bright yellow
            else:
                color_code = "\033[31m"  # Red
            
            reset_code = "\033[0m"
            
            print(f"{color_code}{coverage:>6.1f}%{reset_code}", end="")
        print()
    
    print("\n" + "="*80)
    print("Legend: Coverage percentage (0-100%)")
    print("Colors: Green (≥90%), Yellow (≥75%), Bright Yellow (≥50%), Red (<50%)")
    print("="*80 + "\n")


def main():
    parser = argparse.ArgumentParser(description='Generate OHLCV horizon coverage matrix')
    parser.add_argument('--duckdb', required=True, help='Path to DuckDB database')
    parser.add_argument('--interval', choices=['1m', '5m'], default='1m', help='Candle interval')
    parser.add_argument('--visualize', action='store_true', help='Print visualization')
    parser.add_argument('--skip-storage', action='store_true', help='Skip storing in DuckDB')
    parser.add_argument('--debug', action='store_true', help='Enable debug output for coverage checks')
    
    args = parser.parse_args()
    
    # Connect to databases
    print("Connecting to databases...", file=sys.stderr)
    conn = get_duckdb_connection(args.duckdb)
    
    # Check available tables
    available_tables = list_available_tables(conn)
    print(f"Available tables in DuckDB: {', '.join(available_tables) if available_tables else 'none'}", file=sys.stderr)
    
    # Check if we have the required tables
    has_caller_links = check_table_exists(conn, 'caller_links_d')
    has_user_calls = check_table_exists(conn, 'user_calls_d')
    has_simulation_runs = check_table_exists(conn, 'simulation_runs')
    
    if not has_caller_links and not has_user_calls and not has_simulation_runs:
        print("ERROR: No alert/call data tables found in DuckDB.", file=sys.stderr)
        print("Expected one of: caller_links_d, user_calls_d, or simulation_runs", file=sys.stderr)
        print(f"Please ensure the database at {args.duckdb} contains alert/call data.", file=sys.stderr)
        print(f"Available tables: {', '.join(available_tables) if available_tables else 'none'}", file=sys.stderr)
        print("\nTip: If you have alert data in a different database, use --duckdb to point to it.", file=sys.stderr)
        sys.exit(1)
    
    ch_client, database = get_clickhouse_client()
    
    # Create schema
    if not args.skip_storage:
        create_schema(conn, args.interval)
    
    # Calculate matrix
    print(f"Calculating coverage matrix for {args.interval} candles...", file=sys.stderr)
    matrix, total_alerts = calculate_coverage_matrix(conn, ch_client, database, args.interval, debug=args.debug)
    
    # Store in DuckDB
    if not args.skip_storage:
        store_matrix(conn, matrix, total_alerts, args.interval)
    
    # Visualize
    if args.visualize:
        visualize_matrix(matrix, args.interval)
    
    print("Done!", file=sys.stderr)


if __name__ == '__main__':
    main()

