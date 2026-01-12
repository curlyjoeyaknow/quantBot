#!/usr/bin/env python3
"""
Verify OHLCV fetch for a single token.

Tests Birdeye API fetch for a specific token and time window.
Returns structured JSON with fetch results and validation.
"""

import argparse
import json
import sys
import os
from datetime import datetime, timezone
from typing import Any, Dict, List
from pathlib import Path

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass  # dotenv not installed, use existing env vars

try:
    from packages.api_clients.src.birdeye import BirdeyeClient
except ImportError:
    # Fallback: use direct HTTP requests
    import requests

UTC = timezone.utc


def fetch_birdeye_candles(
    mint: str,
    interval: str,
    from_unix: int,
    to_unix: int,
    chain: str = "solana"
) -> Dict[str, Any]:
    """
    Fetch candles from Birdeye API.
    
    Returns:
        {
            "success": bool,
            "candles": List[Dict],
            "count": int,
            "error": str (if failed)
        }
    """
    api_key = os.getenv("BIRDEYE_API_KEY")
    if not api_key:
        return {
            "success": False,
            "candles": [],
            "count": 0,
            "error": "BIRDEYE_API_KEY not set"
        }
    
    # Map interval to Birdeye format
    interval_map = {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "1h": "1H",
        "1s": "1s",
        "15s": "15s"
    }
    
    birdeye_interval = interval_map.get(interval, interval)
    
    url = f"https://public-api.birdeye.so/defi/ohlcv"
    params = {
        "address": mint,
        "type": birdeye_interval,
        "time_from": from_unix,
        "time_to": to_unix
    }
    
    headers = {
        "X-API-KEY": api_key,
        "x-chain": chain
    }
    
    try:
        response = requests.get(url, params=params, headers=headers, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        
        if not data.get("success"):
            return {
                "success": False,
                "candles": [],
                "count": 0,
                "error": f"Birdeye API returned success=false: {data.get('message', 'unknown')}"
            }
        
        items = data.get("data", {}).get("items", [])
        
        # Convert to standard format
        candles = []
        for item in items:
            candles.append({
                "timestamp": item["unixTime"],
                "open": item["o"],
                "high": item["h"],
                "low": item["l"],
                "close": item["c"],
                "volume": item["v"]
            })
        
        return {
            "success": True,
            "candles": candles,
            "count": len(candles),
            "error": None
        }
        
    except requests.exceptions.RequestException as e:
        return {
            "success": False,
            "candles": [],
            "count": 0,
            "error": f"HTTP request failed: {str(e)}"
        }
    except Exception as e:
        return {
            "success": False,
            "candles": [],
            "count": 0,
            "error": f"Unexpected error: {str(e)}"
        }


def validate_candles(candles: List[Dict[str, Any]], interval_seconds: int) -> Dict[str, Any]:
    """
    Validate candle data structure and values.
    
    Returns validation report.
    """
    errors = []
    warnings = []
    
    if not candles:
        return {
            "valid": False,
            "errors": ["No candles returned"],
            "warnings": []
        }
    
    # Check each candle
    for i, candle in enumerate(candles):
        # Check required fields
        required = ["timestamp", "open", "high", "low", "close", "volume"]
        for field in required:
            if field not in candle:
                errors.append(f"Candle {i}: missing field '{field}'")
        
        if len(errors) > 10:  # Limit error output
            break
        
        # Check OHLC validity
        if "open" in candle and "high" in candle and "low" in candle and "close" in candle:
            o, h, l, c = candle["open"], candle["high"], candle["low"], candle["close"]
            
            if o <= 0 or h <= 0 or l <= 0 or c <= 0:
                errors.append(f"Candle {i}: non-positive price values")
            elif h < l:
                errors.append(f"Candle {i}: high < low")
            elif o > h or o < l:
                errors.append(f"Candle {i}: open outside [low, high]")
            elif c > h or c < l:
                errors.append(f"Candle {i}: close outside [low, high]")
    
    # Check timestamp ordering
    timestamps = [c["timestamp"] for c in candles if "timestamp" in c]
    if timestamps:
        for i in range(1, len(timestamps)):
            if timestamps[i] <= timestamps[i-1]:
                warnings.append(f"Non-monotonic timestamps at index {i}")
        
        # Check for gaps
        expected_count = (timestamps[-1] - timestamps[0]) // interval_seconds + 1
        if len(timestamps) < expected_count * 0.9:
            warnings.append(f"Potential gaps: got {len(timestamps)} candles, expected ~{expected_count}")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors[:10],  # Limit output
        "warnings": warnings[:10]
    }


def main():
    parser = argparse.ArgumentParser(description="Verify OHLCV fetch from Birdeye")
    parser.add_argument("--mint", required=True, help="Token mint address")
    parser.add_argument("--from-unix", type=int, required=True, help="Start timestamp (unix seconds)")
    parser.add_argument("--to-unix", type=int, required=True, help="End timestamp (unix seconds)")
    parser.add_argument("--interval", default="1m", help="Candle interval (1m, 5m, etc.)")
    parser.add_argument("--chain", default="solana", help="Blockchain")
    
    args = parser.parse_args()
    
    # Fetch candles
    result = fetch_birdeye_candles(
        args.mint,
        args.interval,
        args.from_unix,
        args.to_unix,
        args.chain
    )
    
    # Validate if successful
    if result["success"]:
        interval_seconds = {
            "1s": 1,
            "15s": 15,
            "1m": 60,
            "5m": 300,
            "15m": 900,
            "1h": 3600
        }.get(args.interval, 60)
        
        validation = validate_candles(result["candles"], interval_seconds)
        result["validation"] = validation
    
    # Output JSON
    print(json.dumps(result, indent=2))
    
    # Exit code based on success
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()

