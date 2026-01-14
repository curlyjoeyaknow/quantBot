#!/usr/bin/env python3
"""
Batched migration for 5m OHLCV candles.
Migrates by date ranges to avoid memory issues.
"""

import os
import sys
from datetime import datetime, timedelta
import clickhouse_connect

def migrate_batch(ch_client, start_date, end_date, batch_num, total_batches):
    """Migrate one date range batch."""
    
    # Format dates for ClickHouse
    start_str = start_date.strftime('%Y-%m-%d 00:00:00')
    end_str = end_date.strftime('%Y-%m-%d 23:59:59')
    
    print(f"Batch {batch_num}/{total_batches}: {start_date.date()} to {end_date.date()}")
    
    # Count candles in this batch
    count_query = f"""
        SELECT count() 
        FROM quantbot.ohlcv_candles 
        WHERE interval_seconds = 300
          AND timestamp >= toDateTime('{start_str}')
          AND timestamp <= toDateTime('{end_str}')
    """
    count = int(ch_client.command(count_query))
    
    if count == 0:
        print(f"  No candles in this range, skipping")
        return 0
    
    print(f"  Found {count:,} candles")
    
    # Migrate this batch with deduplication
    migration_query = f"""
        INSERT INTO quantbot.ohlcv_candles_5m (
            token_address, chain, timestamp, interval_seconds,
            open, high, low, close, volume,
            quality_score, ingested_at, source_tier,
            ingestion_run_id, script_version
        )
        SELECT 
            token_address,
            chain,
            timestamp,
            300 AS interval_seconds,
            argMax(open, ingested_at) AS open,
            argMax(high, ingested_at) AS high,
            argMax(low, ingested_at) AS low,
            argMax(close, ingested_at) AS close,
            argMax(volume, ingested_at) AS volume,
            0 AS quality_score,
            now() AS ingested_at,
            0 AS source_tier,
            'migration-5m-batched' AS ingestion_run_id,
            'migration-1.0.0' AS script_version
        FROM quantbot.ohlcv_candles
        WHERE interval_seconds = 300
          AND timestamp >= toDateTime('{start_str}')
          AND timestamp <= toDateTime('{end_str}')
        GROUP BY token_address, chain, timestamp
    """
    
    try:
        ch_client.command(migration_query)
        print(f"  ✓ Migrated successfully")
        return count
    except Exception as e:
        print(f"  ✗ Error: {e}")
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
    
    print("5m Candle Migration (Batched)")
    print("=" * 80)
    print()
    
    # Check existing data
    existing = int(ch_client.command('SELECT count() FROM quantbot.ohlcv_candles_5m'))
    print(f"Current rows in ohlcv_candles_5m: {existing:,}")
    
    if existing > 10:
        print()
        print("NOTE: Target table already has data. Will skip existing date ranges.")
        print()
    
    # Get date range from source data
    date_range_query = """
        SELECT 
            toDate(MIN(timestamp)) as min_date,
            toDate(MAX(timestamp)) as max_date
        FROM quantbot.ohlcv_candles
        WHERE interval_seconds = 300
    """
    result = ch_client.query(date_range_query).result_rows
    min_date_obj, max_date_obj = result[0]
    
    # Convert date objects to datetime
    min_date = datetime.combine(min_date_obj, datetime.min.time())
    max_date = datetime.combine(max_date_obj, datetime.min.time())
    
    print(f"Source data range: {min_date.date()} to {max_date.date()}")
    print()
    
    # Calculate batches (30 days each)
    batch_size_days = 30
    current_date = min_date
    batch_num = 0
    total_migrated = 0
    
    batches = []
    while current_date <= max_date:
        batch_end = min(current_date + timedelta(days=batch_size_days - 1), max_date)
        batches.append((current_date, batch_end))
        current_date = batch_end + timedelta(days=1)
    
    total_batches = len(batches)
    print(f"Will migrate in {total_batches} batches of ~{batch_size_days} days each")
    print()
    
    # Migrate each batch
    for batch_num, (start, end) in enumerate(batches, 1):
        try:
            migrated = migrate_batch(ch_client, start, end, batch_num, total_batches)
            total_migrated += migrated
            print()
        except Exception as e:
            print(f"\n✗ Migration failed at batch {batch_num}")
            print(f"  Error: {e}")
            print(f"\n  Progress: {total_migrated:,} candles migrated before failure")
            sys.exit(1)
    
    # Final verification
    final_count = int(ch_client.command('SELECT count() FROM quantbot.ohlcv_candles_5m'))
    
    print("=" * 80)
    print("✅ Migration Complete!")
    print()
    print(f"  Total rows in ohlcv_candles_5m: {final_count:,}")
    print(f"  Migrated in this run: {final_count - existing:,}")
    print()
    print("Next steps:")
    print("1. Verify data: SELECT count(), min(timestamp), max(timestamp) FROM quantbot.ohlcv_candles_5m;")
    print("2. Migrate 1m data: python3 tools/migration/migrate_1m_batched.py")
    print("3. Run deduplication: quantbot ohlcv dedup sweep")

if __name__ == '__main__':
    main()

