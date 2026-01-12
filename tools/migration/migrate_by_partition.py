#!/usr/bin/env python3
"""
Migrate ohlcv_candles to ReplacingMergeTree in batches by partition.

This avoids memory exhaustion by processing one month at a time.
"""

import os
import sys
import time
from pathlib import Path
from typing import List, Tuple

try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    print("ERROR: clickhouse-driver not installed")
    sys.exit(1)


def get_client() -> ClickHouseClient:
    """Get ClickHouse client."""
    return ClickHouseClient(
        host=os.getenv("CLICKHOUSE_HOST", "localhost"),
        port=int(os.getenv("CLICKHOUSE_PORT", "19000")),
        database=os.getenv("CLICKHOUSE_DATABASE", "quantbot"),
        user=os.getenv("CLICKHOUSE_USER", "quantbot_app"),
        password=os.getenv("CLICKHOUSE_PASSWORD", ""),
        settings={'max_memory_usage': 20000000000}  # 20GB limit per query
    )


def get_partitions(client: ClickHouseClient, database: str) -> List[Tuple[str, str, int]]:
    """Get list of partitions from source table."""
    query = f"""
        SELECT chain, toYYYYMM(timestamp) as month_partition, count() as row_count
        FROM {database}.ohlcv_candles
        GROUP BY chain, month_partition
        ORDER BY chain, month_partition
    """
    return client.execute(query)


def migrate_partition(client: ClickHouseClient, database: str, chain: str, month_partition: int) -> dict:
    """Migrate a single partition."""
    start_time = time.time()
    
    partition_name = f"{chain}-{month_partition}"
    
    # Get count for this partition
    count_query = f"""
        SELECT count()
        FROM {database}.ohlcv_candles
        WHERE chain = '{chain}' AND toYYYYMM(timestamp) = {month_partition}
    """
    source_count = client.execute(count_query)[0][0]
    
    # Migrate with deduplication
    insert_query = f"""
        INSERT INTO {database}.ohlcv_candles_v2
        SELECT 
            token_address,
            chain,
            timestamp,
            interval_seconds,
            anyLast(open) as open,
            anyLast(high) as high,
            anyLast(low) as low,
            anyLast(close) as close,
            anyLast(volume) as volume,
            now() as ingested_at
        FROM {database}.ohlcv_candles
        WHERE chain = '{chain}' AND toYYYYMM(timestamp) = {month_partition}
        GROUP BY token_address, chain, timestamp, interval_seconds
    """
    
    client.execute(insert_query)
    
    # Verify
    verify_query = f"""
        SELECT count()
        FROM {database}.ohlcv_candles_v2
        WHERE chain = '{chain}' AND toYYYYMM(timestamp) = {month_partition}
    """
    migrated_count = client.execute(verify_query)[0][0]
    
    elapsed = time.time() - start_time
    
    return {
        "partition": partition_name,
        "source_rows": source_count,
        "migrated_rows": migrated_count,
        "duplicates_removed": source_count - migrated_count,
        "elapsed_seconds": elapsed
    }


def main():
    database = os.getenv("CLICKHOUSE_DATABASE", "quantbot")
    
    print("=" * 70)
    print("PARTITION-BY-PARTITION MIGRATION")
    print("=" * 70)
    print(f"Database: {database}\n")
    
    client = get_client()
    
    # Step 1: Drop and recreate v2 table
    print("[1/3] Creating target table...")
    client.execute(f"DROP TABLE IF EXISTS {database}.ohlcv_candles_v2")
    
    create_sql = f"""
        CREATE TABLE {database}.ohlcv_candles_v2 (
            token_address String,
            chain String,
            timestamp DateTime,
            interval_seconds UInt32,
            open Float64,
            high Float64,
            low Float64,
            close Float64,
            volume Float64,
            ingested_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(ingested_at)
        PARTITION BY (chain, toYYYYMM(timestamp))
        ORDER BY (token_address, chain, timestamp, interval_seconds)
        SETTINGS index_granularity = 8192
    """
    client.execute(create_sql)
    print("✓ Table created\n")
    
    # Step 2: Get partitions
    print("[2/3] Getting partitions...")
    partitions = get_partitions(client, database)
    print(f"✓ Found {len(partitions)} partitions\n")
    
    # Step 3: Migrate each partition
    print("[3/3] Migrating partitions...")
    total_source = 0
    total_migrated = 0
    total_duplicates = 0
    
    for i, (chain, month_partition, count) in enumerate(partitions, 1):
        print(f"\n  [{i}/{len(partitions)}] Partition: {chain}-{month_partition} (rows: {count:,})")
        
        try:
            result = migrate_partition(client, database, chain, month_partition)
            total_source += result["source_rows"]
            total_migrated += result["migrated_rows"]
            total_duplicates += result["duplicates_removed"]
            
            print(f"    ✓ Migrated {result['migrated_rows']:,} rows ({result['elapsed_seconds']:.1f}s)")
            print(f"      Duplicates removed: {result['duplicates_removed']:,}")
        except Exception as e:
            print(f"    ❌ Failed: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    print("\n" + "=" * 70)
    print("MIGRATION COMPLETE")
    print("=" * 70)
    print(f"Total source rows: {total_source:,}")
    print(f"Total migrated rows: {total_migrated:,}")
    print(f"Total duplicates removed: {total_duplicates:,}")
    print()
    print("Next steps:")
    print("  1. Verify: SELECT count() FROM ohlcv_candles_v2;")
    print("  2. Check duplicates (should be 0)")
    print("  3. Swap tables:")
    print(f"     RENAME TABLE {database}.ohlcv_candles TO {database}.ohlcv_candles_old,")
    print(f"                  {database}.ohlcv_candles_v2 TO {database}.ohlcv_candles;")


if __name__ == "__main__":
    main()

