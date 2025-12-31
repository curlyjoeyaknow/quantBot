#!/usr/bin/env python3
"""
Sync OHLCV data from ClickHouse to DuckDB using native ClickHouse client
"""

import argparse
import json
import sys
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)


def run_clickhouse_query(query: str, host: str = 'localhost', port: int = 9000, 
                        user: str = 'default', password: str = '', database: str = 'quantbot') -> list:
    """Run ClickHouse query using docker exec."""
    cmd = [
        'docker', 'exec', 'quantbot-clickhouse',
        'clickhouse-client',
        '--host', 'localhost',
        '--port', str(port),
        '--user', user,
        '--password', password,
        '--database', database,
        '--query', query,
        '--format', 'JSONEachRow'
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        rows = []
        for line in result.stdout.strip().split('\n'):
            if line.strip():
                rows.append(json.loads(line))
        return rows
    except subprocess.CalledProcessError as e:
        print(f"ClickHouse query failed: {e.stderr}", file=sys.stderr)
        return []


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
    
    # Get defaults from environment if not provided
    import os
    clickhouse_port = clickhouse_port or int(os.getenv('CLICKHOUSE_PORT', '9000'))
    clickhouse_database = clickhouse_database or os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    clickhouse_user = clickhouse_user or os.getenv('CLICKHOUSE_USER', 'quantbot_app')
    clickhouse_password = clickhouse_password or os.getenv('CLICKHOUSE_PASSWORD', '00995598009P')
    
    # Connect to DuckDB
    duckdb_con = duckdb.connect(duckdb_path)
    
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
            
            start_time = earliest_dt - timedelta(minutes=260)
            end_time = latest_dt + timedelta(minutes=1440)
            
            # Query ClickHouse using native client
            # Use toDateTime() to properly cast string to DateTime
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
                WHERE token_address = '{mint.replace("'", "''")}'
                  AND chain = 'solana'
                  AND timestamp >= toDateTime('{start_time.strftime("%Y-%m-%d %H:%M:%S")}')
                  AND timestamp <= toDateTime('{end_time.strftime("%Y-%m-%d %H:%M:%S")}')
                  AND interval_seconds IN (60, 300)
                ORDER BY timestamp ASC
            """
            
            rows = run_clickhouse_query(ch_query, port=clickhouse_port, user=clickhouse_user, 
                                       password=clickhouse_password, database=clickhouse_database)
            
            if rows:
                candles = []
                for row in rows:
                    candles.append((
                        mint,
                        int(row['timestamp']),
                        float(row['open']),
                        float(row['high']),
                        float(row['low']),
                        float(row['close']),
                        float(row['volume']),
                        int(row['interval_seconds']),
                        'clickhouse'
                    ))
                
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
    parser.add_argument("--clickhouse-port", type=int, help="ClickHouse native port (default: from env)")
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
        None,  # host not used (docker exec)
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

