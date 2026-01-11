#!/usr/bin/env python3
"""
Deduplicate the ClickHouse ohlcv_candles table.

This script:
1. Creates a new table with ReplacingMergeTree engine
2. Inserts deduplicated data from the old table
3. Renames tables (old -> backup, new -> original)

Usage:
  python3 dedupe_clickhouse_ohlcv.py --dry-run    # Check duplicate counts
  python3 dedupe_clickhouse_ohlcv.py              # Actually deduplicate
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime

try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)


def get_client(host: str, port: int, user: str, password: str) -> ClickHouseClient:
    return ClickHouseClient(
        host=host,
        port=port,
        database="quantbot",
        user=user,
        password=password,
        connect_timeout=30,
        send_receive_timeout=3600,  # 1 hour for large operations
    )


def check_duplicates(client: ClickHouseClient) -> dict:
    """Check current duplicate status."""
    result = client.execute("""
        SELECT 
            count(*) as total_rows,
            count(DISTINCT (token_address, chain, timestamp, interval_seconds)) as unique_candles
        FROM quantbot.ohlcv_candles
    """)
    total, unique = result[0]
    return {
        "total_rows": total,
        "unique_rows": unique,
        "duplicate_rows": total - unique,
        "duplicate_pct": (total - unique) / total * 100 if total > 0 else 0,
    }


def get_months_in_table(client: ClickHouseClient) -> list:
    """Get distinct months (YYYYMM) in the table for batch processing."""
    result = client.execute("""
        SELECT DISTINCT toYYYYMM(timestamp) as month
        FROM quantbot.ohlcv_candles
        ORDER BY month
    """)
    return [row[0] for row in result]


def deduplicate_table(client: ClickHouseClient, verbose: bool = True) -> None:
    """Deduplicate by creating new table and swapping."""
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    new_table = "ohlcv_candles_deduped"
    backup_table = f"ohlcv_candles_backup_{timestamp}"
    
    if verbose:
        print(f"[1/5] Creating new deduplicated table: {new_table}")
    
    # Drop new table if it exists from a failed previous run
    client.execute(f"DROP TABLE IF EXISTS quantbot.{new_table}")
    
    # Create new table with same structure but ReplacingMergeTree for future dedup
    client.execute(f"""
        CREATE TABLE quantbot.{new_table}
        (
            token_address String,
            chain String,
            timestamp DateTime,
            interval_seconds UInt32,
            open Float64,
            high Float64,
            low Float64,
            close Float64,
            volume Float64
        )
        ENGINE = ReplacingMergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (chain, token_address, interval_seconds, timestamp)
        SETTINGS index_granularity = 8192
    """)
    
    if verbose:
        print(f"[2/5] Getting months to process...")
    
    months = get_months_in_table(client)
    
    if verbose:
        print(f"      Found {len(months)} months of data")
        print(f"      Range: {months[0]} to {months[-1]}")
    
    if verbose:
        print(f"[3/5] Inserting deduplicated data by month (this may take a while)...")
    
    total_inserted = 0
    
    # Insert deduplicated data month by month for better memory management
    for i, month in enumerate(months):
        if verbose:
            print(f"      Processing {month} ({i+1}/{len(months)})...", end=" ", flush=True)
        
        # Get count before for this month
        before_count = client.execute(f"""
            SELECT count() FROM quantbot.ohlcv_candles
            WHERE toYYYYMM(timestamp) = {month}
        """)[0][0]
        
        # Insert deduplicated data for this month
        client.execute(f"""
            INSERT INTO quantbot.{new_table}
            SELECT 
                token_address,
                chain,
                timestamp,
                interval_seconds,
                any(open) as open,
                any(high) as high,
                any(low) as low,
                any(close) as close,
                any(volume) as volume
            FROM quantbot.ohlcv_candles
            WHERE toYYYYMM(timestamp) = {month}
            GROUP BY token_address, chain, timestamp, interval_seconds
        """)
        
        # Check how many rows were inserted for this month
        after_count = client.execute(f"""
            SELECT count() FROM quantbot.{new_table}
            WHERE toYYYYMM(timestamp) = {month}
        """)[0][0]
        
        total_inserted += after_count
        removed = before_count - after_count
        
        if verbose:
            print(f"{before_count:,} -> {after_count:,} ({removed:,} dupes removed)")
    
    if verbose:
        print(f"[4/5] Verifying new table...")
    
    # Verify the new table has correct count
    new_stats = client.execute(f"SELECT count() FROM quantbot.{new_table}")[0][0]
    
    if verbose:
        print(f"      New table has {new_stats:,} rows (expected: {total_inserted:,})")
    
    if new_stats == 0:
        raise RuntimeError("New table is empty! Aborting.")
    
    if verbose:
        print(f"[5/5] Swapping tables...")
        print(f"      Renaming ohlcv_candles -> {backup_table}")
        print(f"      Renaming {new_table} -> ohlcv_candles")
    
    # Rename old table to backup
    client.execute(f"RENAME TABLE quantbot.ohlcv_candles TO quantbot.{backup_table}")
    
    # Rename new table to original name
    client.execute(f"RENAME TABLE quantbot.{new_table} TO quantbot.ohlcv_candles")
    
    if verbose:
        print()
        print("=" * 60)
        print("DEDUPLICATION COMPLETE")
        print("=" * 60)
        print(f"New table:    quantbot.ohlcv_candles ({new_stats:,} rows)")
        print(f"Backup table: quantbot.{backup_table}")
        print()
        print("To drop the backup table (after verification):")
        print(f"  DROP TABLE quantbot.{backup_table}")


def main():
    ap = argparse.ArgumentParser(description="Deduplicate ClickHouse ohlcv_candles table")
    
    ap.add_argument("--dry-run", action="store_true", help="Only check duplicates, don't modify")
    ap.add_argument("--ch-host", default=os.getenv("CLICKHOUSE_HOST", "localhost"))
    ap.add_argument("--ch-port", type=int, default=int(os.getenv("CLICKHOUSE_PORT", "19000")))
    ap.add_argument("--ch-user", default=os.getenv("CLICKHOUSE_USER", "default"))
    ap.add_argument("--ch-pass", default=os.getenv("CLICKHOUSE_PASSWORD", ""))
    
    args = ap.parse_args()
    
    print("Connecting to ClickHouse...")
    client = get_client(args.ch_host, args.ch_port, args.ch_user, args.ch_pass)
    
    print("Checking current duplicate status...")
    stats = check_duplicates(client)
    
    print()
    print("=" * 60)
    print("CURRENT STATUS")
    print("=" * 60)
    print(f"Total rows:     {stats['total_rows']:,}")
    print(f"Unique rows:    {stats['unique_rows']:,}")
    print(f"Duplicate rows: {stats['duplicate_rows']:,} ({stats['duplicate_pct']:.1f}%)")
    print()
    
    if stats['duplicate_rows'] == 0:
        print("No duplicates found. Nothing to do.")
        return
    
    if args.dry_run:
        print("[DRY RUN] Would remove duplicates. Run without --dry-run to proceed.")
        return
    
    print("Starting deduplication...")
    print()
    
    deduplicate_table(client, verbose=True)


if __name__ == "__main__":
    main()

