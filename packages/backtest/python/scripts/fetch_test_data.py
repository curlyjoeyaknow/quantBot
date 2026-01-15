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
    """Fetch a sample call from DuckDB.
    
    Tries multiple table sources:
    1. backtest_call_results (has call_id, entry_ts_ms, entry_px)
    2. user_calls_d (has call_ts_ms, price_usd, generates call_id)
    """
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    # Try backtest_call_results first (has call_id)
    result = conn.execute("""
        SELECT 
            call_id,
            mint,
            entry_ts_ms,
            entry_px,
            caller_name
        FROM backtest_call_results 
        WHERE entry_ts_ms >= 1704067200000
          AND entry_ts_ms < 1704153600000
        LIMIT 1
    """).fetchone()
    
    if result:
        conn.close()
        return {
            "call_id": result[0],
            "mint": result[1],
            "alert_timestamp_ms": result[2],
            "entry_price": result[3],
            "caller_name": result[4] if len(result) > 4 else None,
        }
    
    # Fallback to user_calls_d (generate call_id from mint + timestamp)
    result = conn.execute("""
        SELECT 
            mint,
            call_ts_ms,
            price_usd,
            caller_name,
            message_id
        FROM user_calls_d 
        WHERE call_ts_ms >= 1704067200000
          AND call_ts_ms < 1704153600000
        LIMIT 1
    """).fetchone()
    
    conn.close()
    
    if result:
        # Generate call_id from mint + timestamp + message_id
        call_id = f"{result[0]}_{result[1]}_{result[4]}" if len(result) > 4 else f"{result[0]}_{result[1]}"
        return {
            "call_id": call_id,
            "mint": result[0],
            "alert_timestamp_ms": result[1],
            "entry_price": result[2],
            "caller_name": result[3] if len(result) > 3 else None,
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

def print_schema_info(duckdb_path: str):
    """Print schema information for debugging."""
    try:
        conn = duckdb.connect(duckdb_path, read_only=True)
        
        # Get table counts
        tables = conn.execute("SHOW TABLES").fetchall()
        table_info = {}
        for table in tables:
            table_name = table[0]
            try:
                count = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
                if count > 0:
                    # Get column names
                    schema = conn.execute(f"DESCRIBE {table_name}").fetchall()
                    columns = [col[0] for col in schema]
                    table_info[table_name] = {
                        "count": count,
                        "columns": columns
                    }
            except:
                pass
        
        conn.close()
        
        return {
            "tables_with_data": table_info,
            "suggested_tables": [
                "backtest_call_results",
                "user_calls_d",
                "tg_norm_d"
            ]
        }
    except Exception as e:
        return {"error": str(e)}


def main():
    """Main entry point."""
    # Read input from stdin
    input_data = json.load(sys.stdin)
    duckdb_path = input_data["duckdb_path"]
    show_schema = input_data.get("show_schema", False)
    
    # If requested, print schema info
    if show_schema:
        schema_info = print_schema_info(duckdb_path)
        json.dump({"success": True, "schema_info": schema_info}, sys.stdout)
        return
    
    try:
        # Fetch sample call
        call = fetch_sample_call(duckdb_path)
        
        if not call:
            # Include schema info in error for debugging
            schema_info = print_schema_info(duckdb_path)
            json.dump({
                "success": False,
                "error": "No calls found in test period (2024-01-01 to 2024-01-02)",
                "schema_info": schema_info
            }, sys.stdout)
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

