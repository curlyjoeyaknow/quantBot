#!/usr/bin/env python3
"""
Compute ATH/ATL metrics for all alerts in DuckDB.

This script:
1. Adds ATH metrics columns to user_calls_d if they don't exist
2. Queries all alerts from user_calls_d
3. For each alert, fetches OHLCV candles from ohlcv_candles_d
4. Computes ATH/ATL metrics using candle data
5. Updates user_calls_d with computed metrics

Usage:
    python tools/storage/compute_ath_metrics.py --duckdb data/alerts.duckdb
    python tools/storage/compute_ath_metrics.py --duckdb data/alerts.duckdb --limit 100
    python tools/storage/compute_ath_metrics.py --duckdb data/alerts.duckdb --skip-computed
"""

import argparse
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

try:
    import duckdb
except ImportError:
    print("Error: duckdb not installed. Install with: pip install duckdb")
    sys.exit(1)


def add_ath_columns(con: duckdb.DuckDBPyConnection) -> None:
    """Add ATH metrics columns to user_calls_d if they don't exist."""
    print("Checking/adding ATH metrics columns to user_calls_d...")
    
    # Check if columns exist by trying to query them
    try:
        con.execute("SELECT ath_price FROM user_calls_d LIMIT 1").fetchone()
        print("  ATH columns already exist")
        return
    except Exception:
        pass
    
    # Add columns
    columns = [
        "ath_price DOUBLE",
        "ath_multiple DOUBLE",
        "ath_timestamp INTEGER",
        "time_to_ath_minutes DOUBLE",
        "atl_price DOUBLE",
        "atl_multiple DOUBLE",
        "atl_timestamp INTEGER",
        "max_roi_pct DOUBLE",
    ]
    
    for col in columns:
        col_name = col.split()[0]
        col_type = " ".join(col.split()[1:])
        try:
            con.execute(f"ALTER TABLE user_calls_d ADD COLUMN {col_name} {col_type}")
            print(f"  Added column: {col_name}")
        except Exception as e:
            if "duplicate" in str(e).lower() or "already exists" in str(e).lower():
                print(f"  Column {col_name} already exists")
            else:
                print(f"  Warning: Could not add column {col_name}: {e}")
    
    print("  ATH columns ready")


def calculate_ath_metrics(
    entry_price: float,
    entry_timestamp: int,
    candles: List[Dict[str, any]]
) -> Dict[str, any]:
    """
    Calculate ATH/ATL metrics from candles.
    
    Args:
        entry_price: Price at alert time
        entry_timestamp: Unix timestamp (seconds) of alert
        candles: List of candle dicts with 'timestamp', 'high', 'low'
    
    Returns:
        Dict with ath_price, ath_multiple, ath_timestamp, time_to_ath_minutes,
        atl_price, atl_multiple, atl_timestamp, max_roi_pct
    """
    if not entry_price or entry_price <= 0:
        return {
            "ath_price": entry_price,
            "ath_multiple": 1.0,
            "ath_timestamp": entry_timestamp,
            "time_to_ath_minutes": 0.0,
            "atl_price": entry_price,
            "atl_multiple": 1.0,
            "atl_timestamp": entry_timestamp,
            "max_roi_pct": 0.0,
        }
    
    if not candles:
        return {
            "ath_price": entry_price,
            "ath_multiple": 1.0,
            "ath_timestamp": entry_timestamp,
            "time_to_ath_minutes": 0.0,
            "atl_price": entry_price,
            "atl_multiple": 1.0,
            "atl_timestamp": entry_timestamp,
            "max_roi_pct": 0.0,
        }
    
    # First pass: Find ATH (highest high after entry)
    ath_price = entry_price
    ath_timestamp = entry_timestamp
    
    for candle in candles:
        if candle["timestamp"] > entry_timestamp:
            candle_high = candle.get("high")
            if candle_high and candle_high > 0:
                if candle_high > ath_price:
                    ath_price = candle_high
                    ath_timestamp = candle["timestamp"]
    
    # Second pass: Find ATL (lowest low from entry until ATH)
    atl_price = entry_price
    atl_timestamp = entry_timestamp
    
    for candle in candles:
        if candle["timestamp"] > entry_timestamp and candle["timestamp"] <= ath_timestamp:
            candle_low = candle.get("low")
            if candle_low and candle_low > 0:
                if candle_low < atl_price:
                    atl_price = candle_low
                    atl_timestamp = candle["timestamp"]
    
    # Calculate multiples
    ath_multiple = ath_price / entry_price if entry_price > 0 else 1.0
    atl_multiple = atl_price / entry_price if entry_price > 0 else 1.0
    
    # Calculate time to ATH in minutes
    time_to_ath_minutes = (ath_timestamp - entry_timestamp) / 60.0
    
    # Calculate max ROI percentage
    max_roi_pct = ((ath_price - entry_price) / entry_price * 100.0) if entry_price > 0 else 0.0
    
    # Sanity check: cap multiples at 10000x to filter data issues
    if ath_multiple > 10000:
        return {
            "ath_price": entry_price,
            "ath_multiple": 1.0,
            "ath_timestamp": entry_timestamp,
            "time_to_ath_minutes": 0.0,
            "atl_price": entry_price,
            "atl_multiple": 1.0,
            "atl_timestamp": entry_timestamp,
            "max_roi_pct": 0.0,
        }
    
    return {
        "ath_price": ath_price,
        "ath_multiple": ath_multiple,
        "ath_timestamp": ath_timestamp,
        "time_to_ath_minutes": time_to_ath_minutes,
        "atl_price": atl_price,
        "atl_multiple": atl_multiple,
        "atl_timestamp": atl_timestamp,
        "max_roi_pct": max_roi_pct,
    }


def fetch_candles(
    con: duckdb.DuckDBPyConnection,
    mint: str,
    alert_timestamp: int,
    lookforward_hours: int = 24
) -> List[Dict[str, any]]:
    """
    Fetch OHLCV candles for a mint after alert timestamp.
    
    Args:
        con: DuckDB connection
        mint: Token mint address
        alert_timestamp: Unix timestamp (seconds) of alert
        lookforward_hours: How many hours forward to fetch candles
    
    Returns:
        List of candle dicts with timestamp, high, low
    """
    end_timestamp = alert_timestamp + (lookforward_hours * 3600)
    
    try:
        result = con.execute("""
            SELECT 
                timestamp,
                high,
                low
            FROM ohlcv_candles_d
            WHERE mint = ?
              AND timestamp >= ?
              AND timestamp <= ?
            ORDER BY timestamp ASC
        """, [mint, alert_timestamp, end_timestamp]).fetchall()
        
        candles = []
        for row in result:
            candles.append({
                "timestamp": row[0],
                "high": row[1],
                "low": row[2],
            })
        
        return candles
    except Exception as e:
        print(f"    Warning: Could not fetch candles for {mint[:8]}...: {e}")
        return []


def get_alerts_to_process(
    con: duckdb.DuckDBPyConnection,
    skip_computed: bool = False,
    limit: Optional[int] = None
) -> List[Tuple[str, int, str, int, float, str]]:
    """
    Get list of alerts to process.
    
    Returns:
        List of tuples: (chat_id, message_id, run_id, call_ts_ms, price_usd, mint)
    """
    query = """
        SELECT DISTINCT
            chat_id,
            message_id,
            run_id,
            call_ts_ms,
            price_usd,
            mint
        FROM user_calls_d
        WHERE mint IS NOT NULL
          AND TRIM(CAST(mint AS VARCHAR)) != ''
          AND call_ts_ms IS NOT NULL
          AND price_usd IS NOT NULL
          AND price_usd > 0
    """
    
    if skip_computed:
        query += " AND ath_price IS NULL"
    
    query += " ORDER BY call_ts_ms DESC"
    
    if limit:
        query += f" LIMIT {limit}"
    
    try:
        result = con.execute(query).fetchall()
        alerts = []
        for row in result:
            alerts.append((row[0], row[1], row[2], row[3], row[4], row[5]))
        return alerts
    except Exception as e:
        print(f"Error querying alerts: {e}")
        return []


def update_alert_metrics(
    con: duckdb.DuckDBPyConnection,
    chat_id: str,
    message_id: int,
    run_id: str,
    metrics: Dict[str, any]
) -> bool:
    """Update ATH metrics for an alert."""
    try:
        con.execute("""
            UPDATE user_calls_d
            SET 
                ath_price = ?,
                ath_multiple = ?,
                ath_timestamp = ?,
                time_to_ath_minutes = ?,
                atl_price = ?,
                atl_multiple = ?,
                atl_timestamp = ?,
                max_roi_pct = ?
            WHERE chat_id = ? AND message_id = ? AND run_id = ?
        """, [
            metrics["ath_price"],
            metrics["ath_multiple"],
            metrics["ath_timestamp"],
            metrics["time_to_ath_minutes"],
            metrics["atl_price"],
            metrics["atl_multiple"],
            metrics["atl_timestamp"],
            metrics["max_roi_pct"],
            chat_id,
            message_id,
            run_id,
        ])
        return True
    except Exception as e:
        print(f"    Error updating metrics: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Compute ATH/ATL metrics for all alerts in DuckDB"
    )
    parser.add_argument(
        "--duckdb",
        required=True,
        help="Path to DuckDB file (e.g., data/alerts.duckdb)"
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Limit number of alerts to process (for testing)"
    )
    parser.add_argument(
        "--skip-computed",
        action="store_true",
        help="Skip alerts that already have ATH metrics computed"
    )
    parser.add_argument(
        "--lookforward-hours",
        type=int,
        default=24,
        help="How many hours forward to fetch candles (default: 24)"
    )
    
    args = parser.parse_args()
    
    # Connect to DuckDB
    from tools.shared.duckdb_adapter import get_write_connection
    try:
        with get_write_connection(args.duckdb) as con:
            # Add ATH columns if needed
            add_ath_columns(con)
            
            # Get alerts to process
            print("\nQuerying alerts to process...")
            alerts = get_alerts_to_process(con, skip_computed=args.skip_computed, limit=args.limit)
            total = len(alerts)
            
            if total == 0:
                print("No alerts to process")
                return
            
            print(f"Found {total} alerts to process\n")
            
            # Process each alert
            processed = 0
            updated = 0
            skipped = 0
            errors = 0
            
            for idx, (chat_id, message_id, run_id, call_ts_ms, price_usd, mint) in enumerate(alerts, 1):
                # Convert call_ts_ms to seconds (if it's in milliseconds)
                if call_ts_ms > 1e12:
                    call_ts_seconds = call_ts_ms // 1000
                else:
                    call_ts_seconds = call_ts_ms
                
                print(f"[{idx}/{total}] Processing {mint[:8]}... (call_ts={call_ts_seconds})")
                
                # Fetch candles
                candles = fetch_candles(con, mint, call_ts_seconds, args.lookforward_hours)
                
                if not candles:
                    print(f"    No candles found, skipping")
                    skipped += 1
                    continue
                
                # Calculate metrics
                metrics = calculate_ath_metrics(price_usd, call_ts_seconds, candles)
                
                # Update database
                if update_alert_metrics(con, chat_id, message_id, run_id, metrics):
                    print(f"    Updated: ATH={metrics['ath_multiple']:.2f}x, ATL={metrics['atl_multiple']:.2f}x, Time to ATH={metrics['time_to_ath_minutes']:.1f}min")
                    updated += 1
                else:
                    errors += 1
                
                processed += 1
                
                # Progress update every 100 records
                if processed % 100 == 0:
                    print(f"\n  Progress: {processed}/{total} processed, {updated} updated, {skipped} skipped, {errors} errors\n")
            
            print(f"\n{'='*60}")
            print(f"Summary:")
            print(f"  Total alerts: {total}")
            print(f"  Processed: {processed}")
            print(f"  Updated: {updated}")
            print(f"  Skipped (no candles): {skipped}")
            print(f"  Errors: {errors}")
            print(f"{'='*60}")


if __name__ == "__main__":
    main()

