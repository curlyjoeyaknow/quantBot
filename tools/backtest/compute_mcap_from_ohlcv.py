#!/usr/bin/env python3
"""
Compute market cap at alert time using OHLCV data.

For each alert in the alerts database:
1. Gets price from OHLCV candles at alert time
2. Gets supply from token_metadata (or calculates from market_cap if available)
3. Computes market cap = price * supply
4. Updates the alerts database with computed market cap
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Tuple

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

# Load environment variables from .env file if it exists
def load_env_file():
    """Load environment variables from .env file in project root."""
    env_path = Path(__file__).parent.parent.parent / '.env'
    if env_path.exists():
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    # Only set if not already in environment
                    if key not in os.environ:
                        os.environ[key] = value

load_env_file()

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    from clickhouse_connect import get_client
    CLICKHOUSE_AVAILABLE = True
except ImportError:
    print("ERROR: clickhouse-connect not installed. Run: pip install clickhouse-connect", file=sys.stderr)
    sys.exit(1)

from lib.alerts import load_alerts, Alert

UTC = timezone.utc


def get_clickhouse_client() -> Tuple[any, str]:
    """
    Get ClickHouse client from environment or defaults.
    
    clickhouse_connect uses HTTP protocol, so we need HTTP ports:
    - 8123 (local HTTP)
    - 18123 (Docker HTTP, mapped from container's 8123)
    
    If CLICKHOUSE_PORT is set to native protocol port (9000/19000), map to HTTP port.
    
    Returns:
        tuple: (ClickHouseClient, database_name)
    """
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    env_port_str = os.getenv('CLICKHOUSE_PORT', '8123')
    env_port = int(env_port_str)
    
    # Map native protocol ports to HTTP ports for clickhouse_connect
    if env_port == 9000:
        port = 8123  # Local HTTP
    elif env_port == 19000:
        port = 18123  # Docker HTTP
    elif env_port in (8123, 18123):
        port = env_port  # Already HTTP port
    else:
        port = env_port  # Use as-is
    
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    username = os.getenv('CLICKHOUSE_USERNAME', os.getenv('CLICKHOUSE_USER', 'default'))
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    
    print(f"Connecting to ClickHouse: {host}:{port} as {username} (database: {database})", file=sys.stderr)
    if env_port != port:
        print(f"Note: Mapped CLICKHOUSE_PORT={env_port} to HTTP port {port} for clickhouse_connect", file=sys.stderr)
    
    try:
        client = get_client(
            host=host,
            port=port,
            database=database,
            username=username,
            password=password
        )
        
        # Test connection
        client.command('SELECT 1')
        return client, database
    except Exception as e:
        print(f"ERROR: Failed to connect to ClickHouse: {e}", file=sys.stderr)
        print(f"\nConnection details:", file=sys.stderr)
        print(f"  Host: {host}", file=sys.stderr)
        print(f"  Port: {port} (from CLICKHOUSE_PORT={env_port_str})", file=sys.stderr)
        print(f"  Database: {database}", file=sys.stderr)
        print(f"  Username: {username}", file=sys.stderr)
        print(f"\nEnvironment variables:", file=sys.stderr)
        print(f"  CLICKHOUSE_HOST={os.getenv('CLICKHOUSE_HOST', 'not set')}", file=sys.stderr)
        print(f"  CLICKHOUSE_PORT={env_port_str}", file=sys.stderr)
        print(f"  CLICKHOUSE_DATABASE={database}", file=sys.stderr)
        print(f"  CLICKHOUSE_USERNAME={username}", file=sys.stderr)
        print(f"  CLICKHOUSE_PASSWORD={'***' if password else '(not set)'}", file=sys.stderr)
        raise


def get_price_from_ohlcv(
    client: any,
    database: str,
    mint: str,
    chain: str,
    alert_timestamp: datetime,
    window_minutes: int = 60
) -> Optional[float]:
    """
    Get price from OHLCV candles at alert time.
    
    Looks for the closest candle before or at alert time within the window.
    
    Args:
        client: ClickHouse client
        database: Database name
        mint: Token mint address
        chain: Chain name (e.g., 'solana')
        alert_timestamp: Alert timestamp
        window_minutes: Time window to search for candles (default: 30 minutes)
    
    Returns:
        Close price from OHLCV, or None if not found
    """
    # Convert alert timestamp to ClickHouse DateTime format
    alert_dt = alert_timestamp.strftime('%Y-%m-%d %H:%M:%S')
    window_start = (alert_timestamp - timedelta(minutes=window_minutes)).strftime('%Y-%m-%d %H:%M:%S')
    window_end = (alert_timestamp + timedelta(minutes=window_minutes)).strftime('%Y-%m-%d %H:%M:%S')
    
    # Escape mint address for SQL injection prevention
    escaped_mint = mint.replace("'", "''")
    escaped_chain = chain.replace("'", "''")
    
    # Query for the closest candle at or before alert time
    # Note: The ohlcv_candles table doesn't have an 'interval' column in this database
    # So we query without filtering by interval
    query = f"""
        SELECT 
            close,
            timestamp
        FROM {database}.ohlcv_candles
        WHERE token_address = '{escaped_mint}'
          AND chain = '{escaped_chain}'
          AND timestamp >= '{window_start}'
          AND timestamp <= '{window_end}'
        ORDER BY 
          ABS(toUnixTimestamp(timestamp) - toUnixTimestamp('{alert_dt}'))
        LIMIT 1
    """
    
    try:
        result = client.query(query)
        if result.result_rows:
            price = float(result.result_rows[0][0])
            return price
        # No candles found in window - try expanding window or check if token exists at all
        return None
    except Exception as e:
        error_msg = str(e)
        # Only print warning if it's not a "no data" type error
        if 'UNKNOWN_IDENTIFIER' not in error_msg and 'interval' not in error_msg.lower():
            print(f"WARNING: Failed to query OHLCV for {mint[:20]}...: {error_msg[:100]}", file=sys.stderr)
        return None


def get_supply_from_metadata(
    client: any,
    database: str,
    mint: str,
    chain: str,
    alert_timestamp: datetime,
    window_hours: int = 24
) -> Optional[float]:
    """
    Get token supply from token_metadata.
    
    Tries to get supply directly, or calculates it from market_cap / price if available.
    
    Args:
        client: ClickHouse client
        database: Database name
        mint: Token mint address
        chain: Chain name
        alert_timestamp: Alert timestamp
        window_hours: Time window to search for metadata (default: 24 hours)
    
    Returns:
        Token supply, or None if not found
    """
    # Convert alert timestamp to ClickHouse DateTime format
    alert_dt = alert_timestamp.strftime('%Y-%m-%d %H:%M:%S')
    window_start = (alert_timestamp - timedelta(hours=window_hours)).strftime('%Y-%m-%d %H:%M:%S')
    window_end = (alert_timestamp + timedelta(hours=window_hours)).strftime('%Y-%m-%d %H:%M:%S')
    
    # Escape mint address for SQL injection prevention
    escaped_mint = mint.replace("'", "''")
    escaped_chain = chain.replace("'", "''")
    
    # Query for metadata closest to alert time
    # Try to get supply directly, or calculate from market_cap / price
    query = f"""
        SELECT 
            market_cap,
            price,
            metadata_json
        FROM {database}.token_metadata
        WHERE (token_address = '{escaped_mint}' OR lower(token_address) = lower('{escaped_mint}'))
          AND chain = '{escaped_chain}'
          AND timestamp >= '{window_start}'
          AND timestamp <= '{window_end}'
        ORDER BY ABS(toUnixTimestamp(timestamp) - toUnixTimestamp('{alert_dt}'))
        LIMIT 1
    """
    
    try:
        result = client.query(query)
        if result.result_rows:
            market_cap = result.result_rows[0][0]
            price = result.result_rows[0][1]
            metadata_json = result.result_rows[0][2] if len(result.result_rows[0]) > 2 else None
            
            # Try to extract supply from metadata_json
            if metadata_json:
                try:
                    import json
                    metadata = json.loads(metadata_json)
                    if 'supply' in metadata and metadata['supply']:
                        return float(metadata['supply'])
                except (json.JSONDecodeError, ValueError, KeyError):
                    pass
            
            # Calculate supply from market_cap / price if both are available
            if market_cap and price and price > 0:
                supply = float(market_cap) / float(price)
                return supply
            
            return None
    except Exception as e:
        print(f"WARNING: Failed to query token_metadata for {mint}: {e}", file=sys.stderr)
        return None


def get_market_cap_from_metadata(
    client: any,
    database: str,
    mint: str,
    chain: str,
    alert_timestamp: datetime,
    window_hours: int = 24
) -> Optional[float]:
    """
    Get market cap directly from token_metadata table.
    
    Args:
        client: ClickHouse client
        database: Database name
        mint: Token mint address
        chain: Chain name
        alert_timestamp: Alert timestamp
        window_hours: Time window to search for metadata (default: 24 hours)
    
    Returns:
        Market cap, or None if not found
    """
    # Convert alert timestamp to ClickHouse DateTime format
    alert_dt = alert_timestamp.strftime('%Y-%m-%d %H:%M:%S')
    window_start = (alert_timestamp - timedelta(hours=window_hours)).strftime('%Y-%m-%d %H:%M:%S')
    window_end = (alert_timestamp + timedelta(hours=window_hours)).strftime('%Y-%m-%d %H:%M:%S')
    
    # Escape mint address for SQL injection prevention
    escaped_mint = mint.replace("'", "''")
    escaped_chain = chain.replace("'", "''")
    
    # Query for market_cap closest to alert time
    query = f"""
        SELECT 
            market_cap
        FROM {database}.token_metadata
        WHERE (token_address = '{escaped_mint}' OR lower(token_address) = lower('{escaped_mint}'))
          AND chain = '{escaped_chain}'
          AND timestamp >= '{window_start}'
          AND timestamp <= '{window_end}'
          AND market_cap IS NOT NULL
          AND market_cap > 0
        ORDER BY ABS(toUnixTimestamp(timestamp) - toUnixTimestamp('{alert_dt}'))
        LIMIT 1
    """
    
    try:
        result = client.query(query)
        if result.result_rows:
            market_cap = result.result_rows[0][0]
            if market_cap:
                return float(market_cap)
        return None
    except Exception as e:
        print(f"WARNING: Failed to query market_cap from token_metadata for {mint}: {e}", file=sys.stderr)
        return None


def update_alerts_mcap(
    duckdb_path: str,
    alerts_with_mcap: List[Tuple[Alert, float]]
) -> None:
    """
    Update alerts database with computed market cap values.
    
    Updates caller_links_d table with computed mcap_usd values.
    Since canon.alerts_final doesn't have mcap_usd column, we update caller_links_d
    if a matching record exists there.
    
    Args:
        duckdb_path: Path to DuckDB file
        alerts_with_mcap: List of (Alert, market_cap) tuples
    """
    conn = duckdb.connect(duckdb_path)
    
    updated_count = 0
    for alert, mcap in alerts_with_mcap:
        try:
            # Update caller_links_d if it exists
            result = conn.execute("""
                UPDATE caller_links_d
                SET mcap_usd = ?
                WHERE mint = ? AND trigger_ts_ms = ?
            """, [mcap, alert.mint, alert.ts_ms])
            if result.rowcount > 0:
                updated_count += 1
        except Exception as e:
            # caller_links_d might not exist or alert might not be in it
            # This is OK if we're using canon.alerts_final as the source
            pass
    
    conn.commit()
    conn.close()
    print(f"Updated {updated_count}/{len(alerts_with_mcap)} alerts in caller_links_d")
    if updated_count < len(alerts_with_mcap):
        print(f"Note: {len(alerts_with_mcap) - updated_count} alerts were from canon.alerts_final but not found in caller_links_d")
        print(f"     (canon.alerts_final doesn't have mcap_usd column - consider adding it or creating a mapping table)")


def main():
    parser = argparse.ArgumentParser(
        description='Compute market cap at alert time using OHLCV data'
    )
    parser.add_argument(
        '--duckdb',
        required=True,
        help='Path to DuckDB alerts database'
    )
    parser.add_argument(
        '--chain',
        default='solana',
        help='Chain name (default: solana)'
    )
    parser.add_argument(
        '--from-date',
        help='Start date (YYYY-MM-DD, inclusive). If not specified, processes all alerts.'
    )
    parser.add_argument(
        '--to-date',
        help='End date (YYYY-MM-DD, inclusive). If not specified, processes all alerts.'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Compute market caps but do not update database'
    )
    parser.add_argument(
        '--output',
        help='Output CSV file path (optional)'
    )
    parser.add_argument(
        '--ch-host',
        help='ClickHouse host (overrides CLICKHOUSE_HOST env var)'
    )
    parser.add_argument(
        '--ch-port',
        type=int,
        help='ClickHouse port (overrides CLICKHOUSE_PORT env var)'
    )
    parser.add_argument(
        '--ch-database',
        help='ClickHouse database (overrides CLICKHOUSE_DATABASE env var)'
    )
    parser.add_argument(
        '--ch-username',
        help='ClickHouse username (overrides CLICKHOUSE_USERNAME/CLICKHOUSE_USER env var)'
    )
    parser.add_argument(
        '--ch-password',
        help='ClickHouse password (overrides CLICKHOUSE_PASSWORD env var)'
    )
    
    args = parser.parse_args()
    
    # Override environment variables with command-line arguments
    if args.ch_host:
        os.environ['CLICKHOUSE_HOST'] = args.ch_host
    if args.ch_port:
        os.environ['CLICKHOUSE_PORT'] = str(args.ch_port)
    if args.ch_database:
        os.environ['CLICKHOUSE_DATABASE'] = args.ch_database
    if args.ch_username:
        os.environ['CLICKHOUSE_USERNAME'] = args.ch_username
    if args.ch_password:
        os.environ['CLICKHOUSE_PASSWORD'] = args.ch_password
    
    # Connect to ClickHouse
    print("Connecting to ClickHouse...")
    try:
        ch_client, ch_database = get_clickhouse_client()
        print(f"Connected to ClickHouse database: {ch_database}")
    except Exception as e:
        print(f"ERROR: Failed to connect to ClickHouse: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Load alerts
    print(f"Loading alerts from {args.duckdb}...")
    try:
        if args.from_date and args.to_date:
            date_from = datetime.strptime(args.from_date, '%Y-%m-%d').replace(tzinfo=UTC)
            date_to = datetime.strptime(args.to_date, '%Y-%m-%d').replace(tzinfo=UTC)
            alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
        else:
            # Load all alerts (use a wide date range)
            date_from = datetime(2020, 1, 1, tzinfo=UTC)
            date_to = datetime.now(UTC)
            alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
        
        print(f"Loaded {len(alerts)} alerts")
        
        # Check how many already have mcap_usd (from caller_links_d join)
        conn_check = duckdb.connect(args.duckdb, read_only=True)
        try:
            # Check canon.alerts_final count
            total_canon = conn_check.execute("SELECT COUNT(*) FROM canon.alerts_final WHERE lower(chain) = lower(?)", [args.chain]).fetchone()[0]
            
            # Check how many have mcap_usd via caller_links_d join
            with_mcap_count = sum(1 for alert in alerts if alert.mcap_usd is not None)
            
            print(f"Database status: {total_canon} total alerts in canon.alerts_final ({args.chain}), {with_mcap_count} already have mcap_usd")
        except Exception as e:
            # Fallback to simpler message if canon.alerts_final doesn't exist
            try:
                total_in_db = conn_check.execute("SELECT COUNT(*) FROM caller_links_d").fetchone()[0]
                with_mcap_in_db = conn_check.execute("SELECT COUNT(*) FROM caller_links_d WHERE mcap_usd IS NOT NULL").fetchone()[0]
                print(f"Database status: {total_in_db} total alerts in caller_links_d, {with_mcap_in_db} already have mcap_usd")
            except Exception:
                pass
        finally:
            conn_check.close()
    except Exception as e:
        print(f"ERROR: Failed to load alerts: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Count how many will be skipped (already have mcap_usd)
    skipped_count = sum(1 for alert in alerts if alert.mcap_usd is not None)
    to_process = len(alerts) - skipped_count
    print(f"Processing {to_process} alerts ({skipped_count} already have mcap_usd, skipping)")
    
    # Compute market caps
    print("Computing market caps...")
    alerts_with_mcap: List[Tuple[Alert, float]] = []
    alerts_without_mcap: List[Alert] = []
    alerts_no_price: List[Alert] = []
    alerts_no_supply: List[Alert] = []
    
    for i, alert in enumerate(alerts, 1):
        if i % 100 == 0:
            print(f"Processing alert {i}/{len(alerts)}...")
        
        # Skip if market cap already exists
        if alert.mcap_usd is not None:
            continue
        
        alert_dt = alert.ts
        
        # Get price from OHLCV
        price = get_price_from_ohlcv(ch_client, ch_database, alert.mint, args.chain, alert_dt)
        if price is None or price <= 0:
            alerts_no_price.append(alert)
            alerts_without_mcap.append(alert)
            continue
        
        # Get supply from token_metadata
        supply = get_supply_from_metadata(ch_client, ch_database, alert.mint, args.chain, alert_dt)
        if supply is None or supply <= 0:
            # Fallback: try to get market_cap directly from token_metadata
            market_cap = get_market_cap_from_metadata(ch_client, ch_database, alert.mint, args.chain, alert_dt)
            if market_cap is not None and market_cap > 0:
                # Use market_cap from token_metadata as fallback
                alerts_with_mcap.append((alert, market_cap))
            else:
                alerts_no_supply.append(alert)
                alerts_without_mcap.append(alert)
            continue
        
        # Compute market cap = price * supply
        market_cap = price * supply
        alerts_with_mcap.append((alert, market_cap))
    
    print(f"\nResults:")
    print(f"  ✓ Computed market caps: {len(alerts_with_mcap)} alerts")
    print(f"  ✗ Could not compute: {len(alerts_without_mcap)} alerts")
    if alerts_no_price:
        print(f"     - Missing OHLCV price: {len(alerts_no_price)} alerts")
    if alerts_no_supply:
        print(f"     - Missing token supply/metadata: {len(alerts_no_supply)} alerts")
    
    if alerts_with_mcap:
        print(f"\n  Summary: {len(alerts_with_mcap)}/{to_process} alerts processed successfully ({100*len(alerts_with_mcap)/to_process:.1f}%)")
    
    # Update database if not dry-run
    if not args.dry_run and alerts_with_mcap:
        print("Updating database...")
        try:
            update_alerts_mcap(args.duckdb, alerts_with_mcap)
            print("Database updated successfully")
        except Exception as e:
            print(f"ERROR: Failed to update database: {e}", file=sys.stderr)
            sys.exit(1)
    elif args.dry_run:
        print("DRY RUN: Database not updated")
    
    # Output CSV if requested
    if args.output:
        import csv
        print(f"Writing results to {args.output}...")
        with open(args.output, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['mint', 'ts_ms', 'caller', 'mcap_usd', 'computed'])
            for alert, mcap in alerts_with_mcap:
                writer.writerow([alert.mint, alert.ts_ms, alert.caller, mcap, 'yes'])
            for alert in alerts_without_mcap:
                writer.writerow([alert.mint, alert.ts_ms, alert.caller, None, 'no'])
        print("CSV file written")
    
    # Print summary statistics
    if alerts_with_mcap:
        mcaps = [mcap for _, mcap in alerts_with_mcap]
        print("\nMarket Cap Statistics:")
        print(f"  Min: ${min(mcaps):,.2f}")
        print(f"  Max: ${max(mcaps):,.2f}")
        print(f"  Median: ${sorted(mcaps)[len(mcaps)//2]:,.2f}")
        print(f"  Mean: ${sum(mcaps)/len(mcaps):,.2f}")
    
    ch_client.close()


if __name__ == '__main__':
    main()

