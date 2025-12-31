#!/usr/bin/env python3
"""
Sync OHLCV data from ClickHouse to DuckDB for simulations
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    from clickhouse_connect import get_client
    CLICKHOUSE_AVAILABLE = True
except ImportError:
    CLICKHOUSE_AVAILABLE = False
    print("WARNING: clickhouse-connect not available. Install with: pip install clickhouse-connect", file=sys.stderr)


def sync_ohlcv_for_calls(
    duckdb_path: str,
    clickhouse_host: str = None,
    clickhouse_port: int = None,
    clickhouse_database: str = None,
    clickhouse_user: str = None,
    clickhouse_password: str = None,
    caller_name: str = None,
    from_date: str = None,
    to_date: str = None,
    limit: int = 1000
):
    """Sync OHLCV data from ClickHouse to DuckDB for calls."""
    
    if not CLICKHOUSE_AVAILABLE:
        print("ERROR: ClickHouse client not available", file=sys.stderr)
        sys.exit(1)
    
    # Get defaults from environment if not provided
    import os
    clickhouse_host = clickhouse_host or os.getenv('CLICKHOUSE_HOST', 'localhost')
    clickhouse_port = clickhouse_port or int(os.getenv('CLICKHOUSE_HTTP_PORT', os.getenv('CLICKHOUSE_PORT', '18123')))
    clickhouse_database = clickhouse_database or os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    clickhouse_user = clickhouse_user or os.getenv('CLICKHOUSE_USER', 'default')
    clickhouse_password = clickhouse_password or os.getenv('CLICKHOUSE_PASSWORD', '')
    
    # Connect to databases
    duckdb_con = duckdb.connect(duckdb_path)
    clickhouse_client = get_client(
        host=clickhouse_host,
        port=clickhouse_port,
        database=clickhouse_database,
        username=clickhouse_user,
        password=clickhouse_password
    )
    
    # Setup simulation schema in DuckDB
    sys.path.insert(0, str(Path(__file__).parent))
    from sql_functions import setup_simulation_schema
    setup_simulation_schema(duckdb_con)
    
    # Query calls from DuckDB
    query = """
        SELECT DISTINCT
            mint,
            call_datetime,
            caller_name
        FROM user_calls_d
        WHERE mint IS NOT NULL 
          AND TRIM(CAST(mint AS VARCHAR)) != ''
          AND call_datetime IS NOT NULL
    """
    
    params = []
    if caller_name:
        query += " AND caller_name = ?"
        params.append(caller_name)
    
    if from_date:
        query += " AND call_datetime >= ?"
        params.append(from_date)
    
    if to_date:
        query += " AND call_datetime <= ?"
        params.append(to_date)
    
    query += " ORDER BY call_datetime DESC LIMIT ?"
    params.append(limit)
    
    calls = duckdb_con.execute(query, params).fetchall()
    
    if not calls:
        print(json.dumps({"success": False, "error": "No calls found"}))
        sys.exit(1)
    
    print(f"Found {len(calls)} calls to sync OHLCV for", file=sys.stderr)
    
    # Group by mint to minimize queries
    mint_calls = {}
    for mint, call_dt, caller in calls:
        if mint not in mint_calls:
            mint_calls[mint] = []
        mint_calls[mint].append(call_dt)
    
    print(f"Processing {len(mint_calls)} unique tokens", file=sys.stderr)
    
    total_candles = 0
    tokens_processed = 0
    
    for mint, call_times in mint_calls.items():
        try:
            # Determine time range (earliest call - 260min to latest call + 1440min)
            earliest = min(call_times)
            latest = max(call_times)
            
            # Parse datetime strings
            if isinstance(earliest, str):
                earliest_dt = datetime.fromisoformat(earliest.replace('Z', '+00:00'))
            else:
                earliest_dt = earliest
            
            if isinstance(latest, str):
                latest_dt = datetime.fromisoformat(latest.replace('Z', '+00:00'))
            else:
                latest_dt = latest
            
            from datetime import timedelta
            start_time = earliest_dt - timedelta(minutes=260)
            end_time = latest_dt + timedelta(minutes=1440)
            
            # Query ClickHouse (uses interval_seconds, not interval)
            # Use {param:Type} syntax for clickhouse-connect
            ch_query = f"""
                SELECT 
                    toUnixTimestamp(timestamp) as timestamp,
                    open,
                    high,
                    low,
                    close,
                    volume,
                    interval_seconds
                FROM {clickhouse_database}.ohlcv_candles
                WHERE token_address = {{token_address:String}}
                  AND chain = 'solana'
                  AND timestamp >= {{start_time:DateTime}}
                  AND timestamp <= {{end_time:DateTime}}
                  AND interval_seconds IN (60, 300)
                ORDER BY timestamp ASC
            """
            
            result = clickhouse_client.query(
                ch_query,
                parameters={
                    'token_address': mint,
                    'start_time': start_time,
                    'end_time': end_time
                }
            )
            
            candles = []
            for row in result.result_rows:
                interval_seconds = int(row[6])  # Already in seconds (60 for 1m, 300 for 5m)
                candles.append((
                    mint,
                    int(row[0]),  # timestamp
                    float(row[1]),  # open
                    float(row[2]),  # high
                    float(row[3]),  # low
                    float(row[4]),  # close
                    float(row[5]),  # volume
                    interval_seconds,
                    'clickhouse'  # source
                ))
            
            if candles:
                # Insert into DuckDB (use INSERT OR IGNORE to handle duplicates)
                duckdb_con.executemany("""
                    INSERT OR IGNORE INTO ohlcv_candles_d 
                    (mint, timestamp, open, high, low, close, volume, interval_seconds, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, candles)
                
                total_candles += len(candles)
                tokens_processed += 1
                print(f"  {mint[:8]}...: {len(candles)} candles", file=sys.stderr)
            else:
                print(f"  {mint[:8]}...: No candles in ClickHouse", file=sys.stderr)
                
        except Exception as e:
            print(f"  Error processing {mint[:8]}...: {e}", file=sys.stderr)
    
    duckdb_con.close()
    clickhouse_client.close()
    
    result = {
        "success": True,
        "calls_processed": len(calls),
        "tokens_processed": tokens_processed,
        "total_candles": total_candles
    }
    
    print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description="Sync OHLCV from ClickHouse to DuckDB")
    parser.add_argument("--duckdb", required=True, help="DuckDB file path")
    parser.add_argument("--clickhouse-host", help="ClickHouse host (default: from env)")
    parser.add_argument("--clickhouse-port", type=int, help="ClickHouse HTTP port (default: from env)")
    parser.add_argument("--clickhouse-database", help="ClickHouse database (default: from env)")
    parser.add_argument("--clickhouse-user", help="ClickHouse user (default: from env)")
    parser.add_argument("--clickhouse-password", help="ClickHouse password (default: from env)")
    parser.add_argument("--caller-name", help="Filter by caller name")
    parser.add_argument("--from-date", help="Start date (ISO format)")
    parser.add_argument("--to-date", help="End date (ISO format)")
    parser.add_argument("--limit", type=int, default=1000, help="Max calls to process")
    
    args = parser.parse_args()
    
    sync_ohlcv_for_calls(
        args.duckdb,
        args.clickhouse_host,
        args.clickhouse_port,
        args.clickhouse_database,
        args.clickhouse_user,
        args.clickhouse_password,
        args.caller_name,
        args.from_date,
        args.to_date,
        args.limit
    )


if __name__ == '__main__':
    main()

