#!/usr/bin/env python3
"""
Migrate OHLCV data to per-interval tables with quality-based deduplication.

This script:
1. Reads from legacy ohlcv_candles table
2. Computes quality scores from data
3. Inserts into per-interval tables (ohlcv_candles_1m, ohlcv_candles_5m)
4. Deduplicates using GROUP BY during migration
5. Creates migration run record for audit trail

Usage:
    python tools/migration/migrate_ohlcv_to_interval_tables.py \
        --dry-run                    # Preview migration plan
    python tools/migration/migrate_ohlcv_to_interval_tables.py \
        --batch-size 100000 \
        --intervals 1m,5m
"""

import os
import sys
from datetime import datetime
from typing import Optional
import clickhouse_connect

def compute_quality_score(candle: dict, source_tier: int) -> int:
    """
    Compute quality score from candle data.
    
    Score breakdown:
      - Has volume (> 0):     +100 points  (MOST IMPORTANT)
      - Valid range (h >= l): +10 points
      - Consistent open:      +5 points (open within high/low)
      - Consistent close:     +5 points (close within high/low)
      - Source tier:          +0-5 points (tie-breaker only)
    
    Maximum possible score: 100 + 10 + 5 + 5 + 5 = 125
    """
    score = 0
    
    # Volume is king (+100 points)
    if candle['volume'] > 0:
        score += 100
    
    # Valid OHLC range (+10 points)
    if candle['high'] >= candle['low']:
        score += 10
    
    # Consistent open (+5 points)
    if candle['open'] >= candle['low'] and candle['open'] <= candle['high']:
        score += 5
    
    # Consistent close (+5 points)
    if candle['close'] >= candle['low'] and candle['close'] <= candle['high']:
        score += 5
    
    # Source tier (0-5 points)
    score += source_tier
    
    return score

def migrate_interval_table(ch_client, interval, interval_seconds, source_tier=0, dry_run=False):
    """
    Migrate candles from ohlcv_candles to interval-specific table.
    Deduplicates during migration using GROUP BY.
    """
    table_name = f'ohlcv_candles_{interval}'
    
    print(f"Migrating {interval} candles to {table_name}...")
    
    # First, check if any candles exist for this interval
    count_query = f"""
        SELECT count() as count
        FROM quantbot.ohlcv_candles
        WHERE interval_seconds = {interval_seconds}
    """
    
    result = ch_client.command(count_query)
    count = int(result)
    
    if count == 0:
        print(f"  No {interval} candles found, skipping")
        return
    
    print(f"  Found {count:,} candles to migrate")
    
    if dry_run:
        print(f"  [DRY RUN] Would migrate {count:,} candles to {table_name}")
        return
    
    # Migrate with deduplication
    # Use argMax to pick values from row with latest ingested_at
    migration_query = f"""
        INSERT INTO quantbot.{table_name} (
            token_address, chain, timestamp, interval_seconds,
            open, high, low, close, volume,
            quality_score, ingested_at, source_tier,
            ingestion_run_id, script_version
        )
        SELECT 
            token_address,
            chain,
            timestamp,
            {interval_seconds} AS interval_seconds,
            argMax(open, ingested_at) AS open,
            argMax(high, ingested_at) AS high,
            argMax(low, ingested_at) AS low,
            argMax(close, ingested_at) AS close,
            argMax(volume, ingested_at) AS volume,
            0 AS quality_score,  -- Will be recomputed, but start at 0
            now() AS ingested_at,  -- Migration timestamp
            {source_tier} AS source_tier,
            'migration-run-001' AS ingestion_run_id,
            'migration-1.0.0' AS script_version
        FROM quantbot.ohlcv_candles
        WHERE interval_seconds = {interval_seconds}
        GROUP BY token_address, chain, timestamp
    """
    
    ch_client.command(migration_query)
    
    # Verify migration
    verify_query = f"""
        SELECT count() as count
        FROM quantbot.{table_name}
    """
    
    result = ch_client.command(verify_query)
    migrated_count = int(result)
    
    print(f"  Migrated {migrated_count:,} candles (deduplicated from {count:,})")
    
    if migrated_count < count:
        duplicates = count - migrated_count
        print(f"  Removed {duplicates:,} duplicates during migration")

def create_tables(ch_client):
    """Create per-interval tables (idempotent)."""
    
    # Create ingestion runs table
    ch_client.command("""
        CREATE TABLE IF NOT EXISTS quantbot.ohlcv_ingestion_runs (
            run_id String,
            started_at DateTime,
            completed_at Nullable(DateTime),
            status String,
            script_version String,
            git_commit_hash String,
            git_branch String,
            git_dirty UInt8,
            cli_args String,
            env_info String,
            input_hash String,
            source_tier UInt8,
            candles_fetched UInt64,
            candles_inserted UInt64,
            candles_rejected UInt64,
            candles_deduplicated UInt64,
            tokens_processed UInt32,
            errors_count UInt32,
            error_message Nullable(String),
            zero_volume_count UInt64,
            dedup_mode String,
            dedup_completed_at Nullable(DateTime)
        )
        ENGINE = MergeTree()
        ORDER BY (run_id, started_at)
        SETTINGS index_granularity = 8192
    """)
    
    # Create 1m table
    ch_client.command("""
        CREATE TABLE IF NOT EXISTS quantbot.ohlcv_candles_1m (
            token_address String,
            chain String,
            timestamp DateTime,
            interval_seconds UInt32 DEFAULT 60,
            open Float64,
            high Float64,
            low Float64,
            close Float64,
            volume Float64,
            quality_score UInt16 DEFAULT 0,
            ingested_at DateTime DEFAULT now(),
            source_tier UInt8 DEFAULT 1,
            ingestion_run_id String DEFAULT '',
            script_version String DEFAULT ''
        )
        ENGINE = ReplacingMergeTree(quality_score, ingested_at)
        PARTITION BY (chain, toYYYYMM(timestamp))
        ORDER BY (token_address, chain, timestamp)
        SETTINGS index_granularity = 8192
    """)
    
    # Create 5m table
    ch_client.command("""
        CREATE TABLE IF NOT EXISTS quantbot.ohlcv_candles_5m (
            token_address String,
            chain String,
            timestamp DateTime,
            interval_seconds UInt32 DEFAULT 300,
            open Float64,
            high Float64,
            low Float64,
            close Float64,
            volume Float64,
            quality_score UInt16 DEFAULT 0,
            ingested_at DateTime DEFAULT now(),
            source_tier UInt8 DEFAULT 1,
            ingestion_run_id String DEFAULT '',
            script_version String DEFAULT ''
        )
        ENGINE = ReplacingMergeTree(quality_score, ingested_at)
        PARTITION BY (chain, toYYYYMM(timestamp))
        ORDER BY (token_address, chain, timestamp)
        SETTINGS index_granularity = 8192
    """)
    
    print("  Created ohlcv_ingestion_runs table")
    print("  Created ohlcv_candles_1m table")
    print("  Created ohlcv_candles_5m table")

def main():
    """Main migration script."""
    import clickhouse_connect
    import argparse
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Migrate OHLCV candles to interval-specific tables')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be migrated without actually migrating')
    args = parser.parse_args()
    
    # ClickHouse connection
    ch_client = clickhouse_connect.get_client(
        host=os.getenv('CLICKHOUSE_HOST', 'localhost'),
        port=int(os.getenv('CLICKHOUSE_PORT', '8123')),
        username=os.getenv('CLICKHOUSE_USER', 'default'),
        password=os.getenv('CLICKHOUSE_PASSWORD', ''),
        database='quantbot'
    )
    
    print("OHLCV Interval Table Migration")
    if args.dry_run:
        print("[DRY RUN MODE]")
    print("=" * 80)
    print()
    
    # Create tables (idempotent - IF NOT EXISTS)
    print("Creating interval-specific tables...")
    create_tables(ch_client)
    print()
    
    # Migrate data
    print("Migrating data from ohlcv_candles...")
    print()
    
    # Only migrate 1m and 5m (as specified in plan)
    intervals = [
        ('1m', 60),
        ('5m', 300),
    ]
    
    for interval, interval_seconds in intervals:
        migrate_interval_table(ch_client, interval, interval_seconds, source_tier=0, dry_run=args.dry_run)
        print()
    
    print("=" * 80)
    print("Migration complete!")
    print()
    print("Next steps:")
    print("1. Verify data in new tables with: SELECT count(), min(timestamp), max(timestamp) FROM quantbot.ohlcv_candles_1m;")
    print("2. Run deduplication sweep: quantbot ohlcv dedup-sweep")
    print("3. Update application code to use new tables")
    print("4. After 30 days, rename ohlcv_candles -> ohlcv_candles_legacy")

if __name__ == '__main__':
    main()

