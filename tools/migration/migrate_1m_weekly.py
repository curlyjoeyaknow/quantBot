#!/usr/bin/env python3
"""
Weekly-batched migration for 1m OHLCV candles.
Migrates in 7-day chunks to minimize memory usage.
"""

import os
import sys
from datetime import datetime, timedelta
import clickhouse_connect

def migrate_week(ch_client, start_date, end_date, week_num, total_weeks):
    """Migrate one 7-day batch."""
    
    # Format dates for ClickHouse
    start_str = start_date.strftime('%Y-%m-%d 00:00:00')
    end_str = end_date.strftime('%Y-%m-%d 23:59:59')
    
    print(f"Week {week_num}/{total_weeks}: {start_date.date()} to {end_date.date()}", flush=True)
    
    # Count candles in this week
    count_query = f"""
        SELECT count() 
        FROM quantbot.ohlcv_candles 
        WHERE interval_seconds = 60
          AND timestamp >= toDateTime('{start_str}')
          AND timestamp <= toDateTime('{end_str}')
    """
    count = int(ch_client.command(count_query))
    
    if count == 0:
        print(f"  No candles in this range, skipping", flush=True)
        return 0
    
    print(f"  Found {count:,} candles", flush=True)
    
    # Migrate this week with deduplication
    migration_query = f"""
        INSERT INTO quantbot.ohlcv_candles_1m (
            token_address, chain, timestamp, interval_seconds,
            open, high, low, close, volume,
            quality_score, ingested_at, source_tier,
            ingestion_run_id, script_version
        )
        SELECT 
            token_address,
            chain,
            timestamp,
            interval_seconds,
            argMax(open, ingested_at) AS open,
            argMax(high, ingested_at) AS high,
            argMax(low, ingested_at) AS low,
            argMax(close, ingested_at) AS close,
            argMax(volume, ingested_at) AS volume,
            0 AS quality_score,
            now() AS ingested_at,
            0 AS source_tier,
            'migration-1m-weekly' AS ingestion_run_id,
            'migration-1.0.0' AS script_version
        FROM quantbot.ohlcv_candles
        WHERE interval_seconds = 60
          AND timestamp >= toDateTime('{start_str}')
          AND timestamp <= toDateTime('{end_str}')
        GROUP BY token_address, chain, timestamp, interval_seconds
    """
    
    try:
        ch_client.command(migration_query)
        print(f"  ✓ Migrated successfully", flush=True)
        return count
    except Exception as e:
        print(f"  ✗ Error: {e}", flush=True)
        raise

def main():
    # Connect to ClickHouse
    ch_client = clickhouse_connect.get_client(
        host=os.getenv('CLICKHOUSE_HOST', 'localhost'),
        port=int(os.getenv('CLICKHOUSE_PORT', '8123')),
        username=os.getenv('CLICKHOUSE_USER', 'default'),
        password=os.getenv('CLICKHOUSE_PASSWORD', ''),
        database='quantbot'
    )
    
    print("1m Candle Migration (Weekly Batches)")
    print("=" * 80)
    print()
    
    # Check existing data
    existing = int(ch_client.command('SELECT count() FROM quantbot.ohlcv_candles_1m'))
    print(f"Current rows in ohlcv_candles_1m: {existing:,}")
    
    if existing > 10:
        print()
        print("NOTE: Target table already has data.")
        print()
    
    # Use fixed date range: 2025-01-01 to 2026-01-31
    # (Only migrate recent data, ignore old 2023-2024 data)
    min_date = datetime(2025, 1, 1)
    max_date = datetime(2026, 1, 31)
    
    print(f"Source data range: {min_date.date()} to {max_date.date()}")
    print()
    
    # Calculate batches (7 days each)
    batch_size_days = 7
    current_date = min_date
    total_migrated = 0
    
    batches = []
    while current_date <= max_date:
        batch_end = min(current_date + timedelta(days=batch_size_days - 1), max_date)
        batches.append((current_date, batch_end))
        current_date = batch_end + timedelta(days=1)
    
    total_batches = len(batches)
    print(f"Will migrate in {total_batches} weekly batches")
    print()
    
    # Migrate each batch
    for batch_num, (start, end) in enumerate(batches, 1):
        try:
            migrated = migrate_week(ch_client, start, end, batch_num, total_batches)
            total_migrated += migrated
            print()
            sys.stdout.flush()
        except Exception as e:
            print(f"\n✗ Migration failed at week {batch_num}")
            print(f"  Error: {e}")
            print(f"\n  Progress: {total_migrated:,} candles migrated before failure")
            sys.exit(1)
    
    # Final verification
    final_count = int(ch_client.command('SELECT count() FROM quantbot.ohlcv_candles_1m'))
    
    print("=" * 80)
    print("✅ Migration Complete!")
    print()
    print(f"  Total rows in ohlcv_candles_1m: {final_count:,}")
    print(f"  Migrated in this run: {final_count - existing:,}")
    print()

if __name__ == '__main__':
    main()

