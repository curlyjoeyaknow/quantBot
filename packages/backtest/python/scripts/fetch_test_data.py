#!/usr/bin/env python3
"""
Fetch test data for simulation parity tests.

Fetches a sample call from DuckDB and corresponding candles from ClickHouse.
"""

import json
import sys
import duckdb
from clickhouse_driver import Client as ClickHouseClient

def fetch_sample_call(duckdb_path: str):
    """Fetch a sample call from DuckDB."""
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    result = conn.execute("""
        SELECT 
            call_id,
            mint,
            alert_timestamp_ms,
            entry_price
        FROM calls 
        WHERE alert_timestamp_ms >= 1704067200000
          AND alert_timestamp_ms < 1704153600000
        LIMIT 1
    """).fetchone()
    
    conn.close()
    
    if result:
        return {
            "call_id": result[0],
            "mint": result[1],
            "alert_timestamp_ms": result[2],
            "entry_price": result[3],
        }
    return None

def fetch_candles(mint: str, start_ms: int, end_ms: int):
    """Fetch candles from ClickHouse."""
    client = ClickHouseClient(host='localhost', port=19000, database='quantbot')
    
    query = f"""
        SELECT
            toUnixTimestamp(timestamp) * 1000 AS timestamp_ms,
            open,
            high,
            low,
            close,
            volume
        FROM ohlcv_candles
        WHERE chain = 'sol'
          AND token_address = '{mint}'
          AND interval_seconds = 60
          AND timestamp >= fromUnixTimestamp({start_ms // 1000})
          AND timestamp < fromUnixTimestamp({end_ms // 1000})
        ORDER BY timestamp ASC
    """
    
    rows = client.execute(query)
    
    candles = [
        {
            "timestamp_ms": row[0],
            "open": row[1],
            "high": row[2],
            "low": row[3],
            "close": row[4],
            "volume": row[5],
        }
        for row in rows
    ]
    
    return candles

def main():
    """Main entry point."""
    # Read input from stdin
    input_data = json.load(sys.stdin)
    duckdb_path = input_data["duckdb_path"]
    
    try:
        # Fetch sample call
        call = fetch_sample_call(duckdb_path)
        
        if not call:
            json.dump({"success": False, "error": "No calls found"}, sys.stdout)
            sys.exit(1)
        
        # Fetch candles (1 hour before to 4 hours after alert)
        start_ms = call["alert_timestamp_ms"] - 60 * 60 * 1000
        end_ms = call["alert_timestamp_ms"] + 4 * 60 * 60 * 1000
        
        candles = fetch_candles(call["mint"], start_ms, end_ms)
        
        # Return result
        json.dump({
            "success": True,
            "call": call,
            "candles": candles,
        }, sys.stdout)
        
    except Exception as e:
        import traceback
        json.dump({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }, sys.stdout)
        sys.exit(1)

if __name__ == "__main__":
    main()

