#!/usr/bin/env python3
"""
Populate OHLCV Coverage Matrix

This script populates the ohlcv_coverage_matrix table in DuckDB by:
1. Reading all alerts/calls from caller_links_d or user_calls_d
2. Checking ClickHouse for OHLCV data coverage for each token-alert combination
3. Storing the results in the coverage matrix table for fast queries

Usage:
    python3 populate_coverage_matrix.py --duckdb data/tele.duckdb
    python3 populate_coverage_matrix.py --duckdb data/tele.duckdb --caller Brook
    python3 populate_coverage_matrix.py --duckdb data/tele.duckdb --refresh-all
    python3 populate_coverage_matrix.py --duckdb data/tele.duckdb --start-month 2025-11 --end-month 2025-12
"""

import argparse
import os
import sys
import warnings
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Dict, List, Optional, Tuple

# Suppress deprecation warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)

# Type-only imports for type checking
if TYPE_CHECKING:
    from clickhouse_driver import Client as ClickHouseClient  # type: ignore[import-untyped]

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    from clickhouse_driver import Client as ClickHouseClient  # type: ignore[import-untyped]  # noqa: F811
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)


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
    conn = ctx.__enter__()
    
    # Read and execute schema SQL
    schema_path = os.path.join(os.path.dirname(__file__), 'coverage_matrix_schema.sql')
    if os.path.exists(schema_path):
        with open(schema_path, 'r') as f:
            schema_sql = f.read()
        # Execute schema creation (ignore errors if already exists)
        try:
            conn.execute(schema_sql)
        except Exception as e:
            # Table might already exist, that's OK
            if 'already exists' not in str(e).lower() and 'duplicate' not in str(e).lower():
                print(f"Warning: Schema creation had issues: {e}", file=sys.stderr)
    else:
        print(f"Warning: Schema file not found at {schema_path}", file=sys.stderr)
    
    return conn


def get_alerts_from_duckdb(
    conn: duckdb.DuckDBPyConnection,
    caller_filter: Optional[str] = None,
    start_month: Optional[str] = None,
    end_month: Optional[str] = None,
    refresh_all: bool = False
) -> List[Dict]:
    """
    Get all alerts/calls from DuckDB that need coverage checking.
    
    Returns list of alerts with:
    - chat_id, message_id, trigger_ts_ms
    - caller_name
    - mint, chain
    """
    
    # Build WHERE clause
    where_clauses = []
    
    if caller_filter:
        where_clauses.append(f"trigger_from_name = '{caller_filter}'")
    
    if start_month:
        try:
            start_ts = int(datetime.strptime(start_month + '-01', '%Y-%m-%d').timestamp() * 1000)
            where_clauses.append(f"trigger_ts_ms >= {start_ts}")
        except ValueError:
            raise ValueError(f"Invalid start-month format: '{start_month}'. Expected YYYY-MM")
    
    if end_month:
        try:
            end_date = datetime.strptime(end_month + '-01', '%Y-%m-%d')
            if end_date.month == 12:
                end_date = end_date.replace(year=end_date.year + 1, month=1)
            else:
                end_date = end_date.replace(month=end_date.month + 1)
            end_ts = int(end_date.timestamp() * 1000)
            where_clauses.append(f"trigger_ts_ms < {end_ts}")
        except ValueError:
            raise ValueError(f"Invalid end-month format: '{end_month}'. Expected YYYY-MM")
    
    if not refresh_all:
        # Only check alerts that haven't been checked recently (within last 24 hours)
        # or don't exist in coverage matrix
        where_clauses.append("""
            NOT EXISTS (
                SELECT 1 FROM ohlcv_coverage_matrix cm
                WHERE cm.chat_id = caller_links_d.trigger_chat_id
                  AND cm.message_id = caller_links_d.trigger_message_id
                  AND cm.mint = caller_links_d.mint
                  AND cm.last_checked_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
            )
        """)
    
    where_sql = " AND " + " AND ".join(where_clauses) if where_clauses else ""
    
    # Query caller_links_d (preferred source as it has more metadata)
    query = f"""
    SELECT DISTINCT
        trigger_chat_id as chat_id,
        trigger_message_id as message_id,
        trigger_ts_ms,
        trigger_from_name as caller_name,
        mint,
        COALESCE(chain, 'solana') as chain
    FROM caller_links_d
    WHERE mint IS NOT NULL 
      AND mint != ''
      AND trigger_ts_ms IS NOT NULL
      {where_sql}
    ORDER BY trigger_ts_ms DESC
    """
    
    try:
        results = conn.execute(query).fetchall()
    except Exception as e:
        # Fallback to user_calls_d if caller_links_d doesn't exist or query fails
        print(f"Warning: Querying caller_links_d failed: {e}. Trying user_calls_d...", file=sys.stderr)
        query = f"""
        SELECT DISTINCT
            chat_id,
            message_id,
            call_ts_ms as trigger_ts_ms,
            caller_name,
            mint,
            'solana' as chain
        FROM user_calls_d
        WHERE mint IS NOT NULL 
          AND mint != ''
          AND call_ts_ms IS NOT NULL
          {where_sql.replace('caller_links_d', 'user_calls_d').replace('trigger_chat_id', 'chat_id').replace('trigger_message_id', 'message_id').replace('trigger_ts_ms', 'call_ts_ms').replace('trigger_from_name', 'caller_name')}
        ORDER BY call_ts_ms DESC
        """
        results = conn.execute(query).fetchall()
    
    alerts = []
    for row in results:
        alerts.append({
            'chat_id': row[0],
            'message_id': row[1],
            'trigger_ts_ms': row[2],
            'caller_name': row[3],
            'mint': row[4],
            'chain': row[5] or 'solana'
        })
    
    return alerts


def check_ohlcv_coverage(
    ch_client: ClickHouseClient,
    database: str,
    mint: str,
    chain: str,
    trigger_ts_ms: int,
    pre_window_minutes: int = 260,
    post_window_minutes: int = 1440,
    interval: str = '5m'
) -> Dict:
    """
    Check OHLCV coverage for a specific token-alert combination.
    
    Uses a simplified approach: first check if ANY data exists, then check specific interval.
    This is more robust and handles errors better.
    
    Returns:
        {
            'has_ohlcv_data': bool,
            'coverage_ratio': float,
            'expected_candles': int,
            'actual_candles': int,
            'intervals_available': List[str],
            'coverage_start_ts_ms': int,
            'coverage_end_ts_ms': int
        }
    """
    
    # Calculate time window
    trigger_dt = datetime.fromtimestamp(trigger_ts_ms / 1000)
    coverage_start = trigger_dt - timedelta(minutes=pre_window_minutes)
    coverage_end = trigger_dt + timedelta(minutes=post_window_minutes)
    
    coverage_start_ts_ms = int(coverage_start.timestamp() * 1000)
    coverage_end_ts_ms = int(coverage_end.timestamp() * 1000)
    
    # Convert interval to seconds for expected candle calculation
    interval_seconds_map = {
        '1s': 1,
        '15s': 15,
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600
    }
    interval_seconds = interval_seconds_map.get(interval, 300)
    
    # Calculate expected number of candles
    window_seconds = (coverage_end_ts_ms - coverage_start_ts_ms) // 1000
    expected_candles = window_seconds // interval_seconds if interval_seconds > 0 else 0
    
    # Escape values for SQL injection prevention
    escaped_mint = mint.replace("'", "''")
    escaped_interval = interval.replace("'", "''")
    
    start_ts_seconds = coverage_start_ts_ms // 1000
    end_ts_seconds = coverage_end_ts_ms // 1000
    
    # Initialize defaults
    actual_candles = 0
    intervals_available_str = []
    has_ohlcv_data = False
    
    # Simplified approach: First check if ANY data exists (no interval filter)
    # This avoids the reserved keyword issue if interval column has problems
    try:
        # Query 1: Check if any candles exist for this token in the time window
        query_any_data = f"""
        SELECT COUNT(*) as candle_count
        FROM {database}.ohlcv_candles
        WHERE token_address = '{escaped_mint}'
          AND timestamp >= toDateTime({start_ts_seconds})
          AND timestamp <= toDateTime({end_ts_seconds})
        """
        
        results_any = ch_client.execute(query_any_data)
        any_candles = results_any[0][0] if results_any else 0
        
        if any_candles > 0:
            has_ohlcv_data = True
            
            # Query 2: Get count for requested interval
            try:
                query_requested = f"""
                SELECT COUNT(*) as candle_count
                FROM {database}.ohlcv_candles
                WHERE token_address = '{escaped_mint}'
                  AND timestamp >= toDateTime({start_ts_seconds})
                  AND timestamp <= toDateTime({end_ts_seconds})
                  AND `interval` = '{escaped_interval}'
                """
                results_requested = ch_client.execute(query_requested)
                actual_candles = results_requested[0][0] if results_requested else 0
            except Exception as e:
                # If interval query fails, use the any_candles count as fallback
                print(f"Warning: Interval-specific query failed for {mint}, using any-data count: {e}", file=sys.stderr)
                actual_candles = any_candles
            
            # Query 3: Get all available intervals (optional, don't fail if this errors)
            try:
                query_intervals = f"""
                SELECT DISTINCT `interval`
                FROM {database}.ohlcv_candles
                WHERE token_address = '{escaped_mint}'
                  AND timestamp >= toDateTime({start_ts_seconds})
                  AND timestamp <= toDateTime({end_ts_seconds})
                """
                results_intervals = ch_client.execute(query_intervals)
                intervals_available_str = [row[0] for row in results_intervals]
            except Exception:
                # If interval list query fails, that's OK - we still have the count
                intervals_available_str = []
        
    except Exception as e:
        # If the basic query fails, log and return defaults
        print(f"Warning: ClickHouse query failed for {mint}: {e}", file=sys.stderr)
        has_ohlcv_data = False
        actual_candles = 0
        intervals_available_str = []
    
    # Calculate coverage ratio
    coverage_ratio = actual_candles / expected_candles if expected_candles > 0 else 0.0
    coverage_ratio = min(1.0, coverage_ratio)  # Cap at 1.0
    
    return {
        'has_ohlcv_data': has_ohlcv_data,
        'coverage_ratio': coverage_ratio,
        'expected_candles': expected_candles,
        'actual_candles': actual_candles,
        'intervals_available': intervals_available_str,
        'coverage_start_ts_ms': coverage_start_ts_ms,
        'coverage_end_ts_ms': coverage_end_ts_ms
    }


def upsert_coverage_matrix(
    conn: duckdb.DuckDBPyConnection,
    alerts: List[Dict],
    ch_client: ClickHouseClient,
    database: str,
    pre_window_minutes: int = 260,
    post_window_minutes: int = 1440,
    interval: str = '5m',
    verbose: bool = False
) -> Dict[str, int]:
    """
    Upsert coverage data into the coverage matrix table.
    
    Returns stats: {'processed': int, 'updated': int, 'inserted': int, 'errors': int}
    """
    
    stats = {'processed': 0, 'updated': 0, 'inserted': 0, 'errors': 0}
    
    for i, alert in enumerate(alerts, 1):
        try:
            if verbose and i % 100 == 0:
                print(f"Processing {i}/{len(alerts)} alerts...", file=sys.stderr, flush=True)
            
            # Check coverage
            coverage = check_ohlcv_coverage(
                ch_client,
                database,
                alert['mint'],
                alert['chain'],
                alert['trigger_ts_ms'],
                pre_window_minutes,
                post_window_minutes,
                interval
            )
            
            # Upsert into coverage matrix
            # DuckDB uses DELETE + INSERT pattern for upserts
            delete_sql = """
            DELETE FROM ohlcv_coverage_matrix
            WHERE chat_id = ? AND message_id = ? AND mint = ? AND chain = ?
            """
            
            insert_sql = """
            INSERT INTO ohlcv_coverage_matrix (
                chat_id, message_id, trigger_ts_ms, caller_name,
                mint, chain,
                has_ohlcv_data, coverage_ratio, expected_candles, actual_candles,
                intervals_available,
                pre_window_minutes, post_window_minutes,
                coverage_start_ts_ms, coverage_end_ts_ms,
                last_checked_at, last_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
            
            # Check if record exists
            check_sql = """
            SELECT 1 FROM ohlcv_coverage_matrix
            WHERE chat_id = ? AND message_id = ? AND mint = ? AND chain = ?
            """
            exists = conn.execute(
                check_sql,
                [alert['chat_id'], alert['message_id'], alert['mint'], alert['chain']]
            ).fetchone()
            
            # Delete existing record if it exists
            conn.execute(
                delete_sql,
                [alert['chat_id'], alert['message_id'], alert['mint'], alert['chain']]
            )
            
            # Insert new record
            conn.execute(
                insert_sql,
                [
                    alert['chat_id'],
                    alert['message_id'],
                    alert['trigger_ts_ms'],
                    alert['caller_name'],
                    alert['mint'],
                    alert['chain'],
                    coverage['has_ohlcv_data'],
                    coverage['coverage_ratio'],
                    coverage['expected_candles'],
                    coverage['actual_candles'],
                    ','.join(coverage['intervals_available']),  # Store as comma-separated string
                    pre_window_minutes,
                    post_window_minutes,
                    coverage['coverage_start_ts_ms'],
                    coverage['coverage_end_ts_ms']
                ]
            )
            
            if exists:
                stats['updated'] += 1
            else:
                stats['inserted'] += 1
            
            stats['processed'] += 1
            
        except Exception as e:
            stats['errors'] += 1
            print(f"Error processing alert {alert.get('chat_id')}/{alert.get('message_id')}: {e}", file=sys.stderr)
    
    return stats


def main():
    parser = argparse.ArgumentParser(description='Populate OHLCV coverage matrix in DuckDB')
    parser.add_argument('--duckdb', required=True, help='Path to DuckDB database')
    parser.add_argument('--caller', help='Filter by specific caller')
    parser.add_argument('--start-month', help='Start month (YYYY-MM format)')
    parser.add_argument('--end-month', help='End month (YYYY-MM format)')
    parser.add_argument('--refresh-all', action='store_true', help='Refresh all alerts, even recently checked ones')
    parser.add_argument('--pre-window', type=int, default=260, help='Pre-window minutes (default: 260)')
    parser.add_argument('--post-window', type=int, default=1440, help='Post-window minutes (default: 1440)')
    parser.add_argument('--interval', default='5m', help='OHLCV interval to check (default: 5m)')
    parser.add_argument('--verbose', action='store_true', help='Show verbose output')
    
    args = parser.parse_args()
    
    duckdb_conn = None
    ch_client = None
    
    try:
        # Connect to databases
        if args.verbose:
            print("Connecting to DuckDB...", file=sys.stderr, flush=True)
        duckdb_conn = get_duckdb_connection(args.duckdb)
        
        if args.verbose:
            print("Connecting to ClickHouse...", file=sys.stderr, flush=True)
        ch_client, database = get_clickhouse_client()
        
        # Get alerts to process
        if args.verbose:
            print("Fetching alerts from DuckDB...", file=sys.stderr, flush=True)
        alerts = get_alerts_from_duckdb(
            duckdb_conn,
            caller_filter=args.caller,
            start_month=args.start_month,
            end_month=args.end_month,
            refresh_all=args.refresh_all
        )
        
        if args.verbose:
            print(f"Found {len(alerts)} alerts to process", file=sys.stderr, flush=True)
        
        if len(alerts) == 0:
            print("No alerts to process", file=sys.stderr, flush=True)
            return 0
        
        # Process alerts and update coverage matrix
        if args.verbose:
            print("Processing coverage checks...", file=sys.stderr, flush=True)
        
        stats = upsert_coverage_matrix(
            duckdb_conn,
            alerts,
            ch_client,
            database,
            pre_window_minutes=args.pre_window,
            post_window_minutes=args.post_window,
            interval=args.interval,
            verbose=args.verbose
        )
        
        # Print summary
        print("\n" + "="*80, file=sys.stderr, flush=True)
        print("COVERAGE MATRIX UPDATE SUMMARY", file=sys.stderr, flush=True)
        print("="*80, file=sys.stderr, flush=True)
        print(f"Processed: {stats['processed']}", file=sys.stderr, flush=True)
        print(f"Inserted: {stats['inserted']}", file=sys.stderr, flush=True)
        print(f"Updated: {stats['updated']}", file=sys.stderr, flush=True)
        if stats['errors'] > 0:
            print(f"Errors: {stats['errors']}", file=sys.stderr, flush=True)
        print("="*80, file=sys.stderr, flush=True)
        
        # Show sample queries
        if args.verbose:
            print("\nSample queries:", file=sys.stderr, flush=True)
            print("  -- View token coverage: SELECT * FROM token_coverage_summary WHERE mint = '...'", file=sys.stderr, flush=True)
            print("  -- View caller coverage: SELECT * FROM caller_coverage_summary WHERE caller_name = '...'", file=sys.stderr, flush=True)
            print("  -- View missing coverage: SELECT * FROM alerts_missing_coverage LIMIT 10", file=sys.stderr, flush=True)
        
        return 0
        
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        if duckdb_conn:
            try:
                duckdb_conn.close()
            except Exception:
                pass
        if ch_client:
            try:
                ch_client.disconnect()
            except Exception:
                pass


if __name__ == '__main__':
    sys.exit(main())

