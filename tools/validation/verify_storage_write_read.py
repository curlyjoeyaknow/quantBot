#!/usr/bin/env python3
"""
Verify ClickHouse storage write and read integrity.

Fetches candles from Birdeye, writes to ClickHouse, reads back, and compares.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

# Load environment
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

try:
    from clickhouse_driver import Client as ClickHouseClient
    import requests
except ImportError as e:
    print(json.dumps({"success": False, "error": f"Missing dependency: {e}"}))
    sys.exit(1)

UTC = timezone.utc


def fetch_candles(mint: str, from_unix: int, to_unix: int, interval: str, chain: str) -> List[Dict]:
    """Fetch candles from Birdeye."""
    api_key = os.getenv("BIRDEYE_API_KEY")
    if not api_key:
        raise ValueError("BIRDEYE_API_KEY not set")
    
    url = "https://public-api.birdeye.so/defi/ohlcv"
    params = {
        "address": mint,
        "type": interval,
        "time_from": from_unix,
        "time_to": to_unix
    }
    headers = {
        "X-API-KEY": api_key,
        "x-chain": chain
    }
    
    response = requests.get(url, params=params, headers=headers, timeout=30)
    response.raise_for_status()
    
    data = response.json()
    if not data.get("success"):
        raise ValueError(f"Birdeye API error: {data.get('message', 'unknown')}")
    
    items = data.get("data", {}).get("items", [])
    return [
        {
            "timestamp": item["unixTime"],
            "open": item["o"],
            "high": item["h"],
            "low": item["l"],
            "close": item["c"],
            "volume": item["v"]
        }
        for item in items
    ]


def write_candles(client: ClickHouseClient, database: str, mint: str, chain: str, 
                  candles: List[Dict], interval_seconds: int) -> int:
    """Write candles to ClickHouse."""
    if not candles:
        return 0
    
    # Prepare rows
    rows = []
    for candle in candles:
        rows.append({
            "token_address": mint,
            "chain": chain,
            "timestamp": datetime.fromtimestamp(candle["timestamp"], tz=UTC),
            "interval_seconds": interval_seconds,
            "open": candle["open"],
            "high": candle["high"],
            "low": candle["low"],
            "close": candle["close"],
            "volume": candle["volume"],
            "ingested_at": datetime.now(UTC)  # Required for ReplacingMergeTree
        })
    
    # Insert
    client.execute(
        f"INSERT INTO {database}.ohlcv_candles VALUES",
        rows
    )
    
    return len(rows)


def read_candles(client: ClickHouseClient, database: str, mint: str, chain: str,
                 timestamps: List[int], interval_seconds: int) -> List[Dict]:
    """Read specific candles from ClickHouse by exact timestamps."""
    if not timestamps:
        return []
    
    # Query for exact timestamps we wrote, with deduplication using any()
    ts_list = ','.join(str(ts) for ts in timestamps)
    query = f"""
        SELECT 
            toUnixTimestamp(timestamp) as ts,
            any(open) as open,
            any(high) as high,
            any(low) as low,
            any(close) as close,
            any(volume) as volume
        FROM {database}.ohlcv_candles
        WHERE token_address = %(mint)s
          AND chain = %(chain)s
          AND interval_seconds = %(interval_seconds)s
          AND toUnixTimestamp(timestamp) IN ({ts_list})
        GROUP BY token_address, chain, timestamp, interval_seconds
        ORDER BY timestamp
    """
    
    rows = client.execute(query, {
        "mint": mint,
        "chain": chain,
        "interval_seconds": interval_seconds
    })
    
    return [
        {
            "timestamp": int(row[0]),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5])
        }
        for row in rows
    ]


def compare_candles(original: List[Dict], read_back: List[Dict]) -> Dict[str, Any]:
    """Compare original and read-back candles."""
    errors = []
    warnings = []
    
    if len(original) != len(read_back):
        errors.append(f"Count mismatch: wrote {len(original)}, read {len(read_back)}")
    
    # Create timestamp maps
    orig_map = {c["timestamp"]: c for c in original}
    read_map = {c["timestamp"]: c for c in read_back}
    
    # Check for missing timestamps
    missing = set(orig_map.keys()) - set(read_map.keys())
    if missing:
        errors.append(f"Missing {len(missing)} timestamps after read")
    
    # Check for extra timestamps
    extra = set(read_map.keys()) - set(orig_map.keys())
    if extra:
        warnings.append(f"Found {len(extra)} extra timestamps (may be from previous writes)")
    
    # Compare values for matching timestamps
    value_mismatches = 0
    for ts in orig_map:
        if ts in read_map:
            orig = orig_map[ts]
            read = read_map[ts]
            
            # Allow small floating point differences
            tolerance = 1e-6
            if abs(orig["open"] - read["open"]) > tolerance:
                value_mismatches += 1
            if abs(orig["close"] - read["close"]) > tolerance:
                value_mismatches += 1
    
    if value_mismatches > 0:
        errors.append(f"{value_mismatches} value mismatches detected")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings
    }


def main():
    parser = argparse.ArgumentParser(description="Verify ClickHouse storage write/read")
    parser.add_argument("--mint", required=True)
    parser.add_argument("--from-unix", type=int, required=True)
    parser.add_argument("--to-unix", type=int, required=True)
    parser.add_argument("--interval", default="1m")
    parser.add_argument("--chain", default="solana")
    
    args = parser.parse_args()
    
    # Map interval to seconds
    interval_map = {"1s": 1, "15s": 15, "1m": 60, "5m": 300, "15m": 900, "1h": 3600}
    interval_seconds = interval_map.get(args.interval, 60)
    
    result = {
        "success": False,
        "mint": args.mint,
        "interval": args.interval,
        "candles_fetched": 0,
        "candles_written": 0,
        "candles_read": 0,
        "comparison": {}
    }
    
    try:
        # Connect to ClickHouse
        host = os.getenv("CLICKHOUSE_HOST", "localhost")
        port = int(os.getenv("CLICKHOUSE_PORT", "19000"))
        database = os.getenv("CLICKHOUSE_DATABASE", "quantbot")
        user = os.getenv("CLICKHOUSE_USER", "quantbot_app")
        password = os.getenv("CLICKHOUSE_PASSWORD", "")
        
        client = ClickHouseClient(host=host, port=port, database=database, user=user, password=password)
        
        # Step 1: Fetch from Birdeye
        candles = fetch_candles(args.mint, args.from_unix, args.to_unix, args.interval, args.chain)
        result["candles_fetched"] = len(candles)
        
        if len(candles) == 0:
            result["error"] = "No candles fetched from Birdeye"
            print(json.dumps(result, indent=2))
            sys.exit(1)
        
        # Step 2: Write to ClickHouse
        written = write_candles(client, database, args.mint, args.chain, candles, interval_seconds)
        result["candles_written"] = written
        
        # Step 3: Read back from ClickHouse (using exact timestamps we wrote)
        timestamps = [c["timestamp"] for c in candles]
        read_back = read_candles(client, database, args.mint, args.chain, 
                                 timestamps, interval_seconds)
        result["candles_read"] = len(read_back)
        
        # Step 4: Compare
        comparison = compare_candles(candles, read_back)
        result["comparison"] = comparison
        result["success"] = comparison["valid"]
        
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["success"] else 1)
        
    except Exception as e:
        result["error"] = str(e)
        print(json.dumps(result, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()

