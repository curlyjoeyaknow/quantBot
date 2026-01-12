#!/usr/bin/env python3
"""
Migrate ohlcv_candles to ReplacingMergeTree to eliminate duplicates.

This script:
1. Creates new table with ReplacingMergeTree engine
2. Migrates data with deduplication (keeping most recent)
3. Renames tables (old -> backup, new -> production)
4. Verifies migration success
"""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Any

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
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver")
    sys.exit(1)


def get_client() -> ClickHouseClient:
    """Get ClickHouse client."""
    return ClickHouseClient(
        host=os.getenv("CLICKHOUSE_HOST", "localhost"),
        port=int(os.getenv("CLICKHOUSE_PORT", "19000")),
        database=os.getenv("CLICKHOUSE_DATABASE", "quantbot"),
        user=os.getenv("CLICKHOUSE_USER", "quantbot_app"),
        password=os.getenv("CLICKHOUSE_PASSWORD", "")
    )


def check_duplicates(client: ClickHouseClient, database: str) -> Dict[str, Any]:
    """Check current duplicate count."""
    query = f"""
        SELECT count() as total_duplicates
        FROM (
            SELECT token_address, chain, timestamp, interval_seconds, count() as cnt
            FROM {database}.ohlcv_candles
            GROUP BY token_address, chain, timestamp, interval_seconds
            HAVING cnt > 1
        )
    """
    result = client.execute(query)
    return {"total_duplicate_groups": result[0][0] if result else 0}


def create_new_table(client: ClickHouseClient, database: str, dry_run: bool = False) -> None:
    """Create new table with ReplacingMergeTree engine."""
    create_sql = f"""
    CREATE TABLE IF NOT EXISTS {database}.ohlcv_candles_v2 (
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
    
    print("Creating new table with ReplacingMergeTree engine...")
    print(f"SQL: {create_sql}")
    
    if not dry_run:
        client.execute(create_sql)
        print("✓ Table created: ohlcv_candles_v2")
    else:
        print("✓ DRY RUN: Would create table ohlcv_candles_v2")


def migrate_data(client: ClickHouseClient, database: str, dry_run: bool = False) -> Dict[str, Any]:
    """Migrate data with deduplication."""
    
    # Count source rows
    source_count = client.execute(f"SELECT count() FROM {database}.ohlcv_candles")[0][0]
    print(f"Source table has {source_count:,} rows")
    
    # Migration query - deduplicate by keeping row with most recent values
    # Use anyLast to pick the last value encountered (most recent insert)
    migrate_sql = f"""
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
    GROUP BY token_address, chain, timestamp, interval_seconds
    """
    
    print(f"Migrating data with deduplication...")
    print(f"SQL: {migrate_sql[:200]}...")
    
    if not dry_run:
        client.execute(migrate_sql)
        
        # Count migrated rows
        migrated_count = client.execute(f"SELECT count() FROM {database}.ohlcv_candles_v2")[0][0]
        print(f"✓ Migrated {migrated_count:,} deduplicated rows")
        
        return {
            "source_rows": source_count,
            "migrated_rows": migrated_count,
            "duplicates_removed": source_count - migrated_count
        }
    else:
        print(f"✓ DRY RUN: Would migrate ~{source_count:,} rows with deduplication")
        return {"source_rows": source_count, "migrated_rows": 0, "duplicates_removed": 0}


def swap_tables(client: ClickHouseClient, database: str, dry_run: bool = False) -> None:
    """Swap old and new tables."""
    print("Swapping tables...")
    
    # Check if backup already exists
    tables = client.execute(f"SHOW TABLES FROM {database}")
    table_names = [t[0] for t in tables]
    
    if "ohlcv_candles_old" in table_names:
        print("⚠️  Backup table 'ohlcv_candles_old' already exists")
        response = input("Drop existing backup? (yes/no): ")
        if response.lower() == "yes":
            if not dry_run:
                client.execute(f"DROP TABLE {database}.ohlcv_candles_old")
                print("✓ Dropped old backup")
        else:
            print("Aborting - please manually handle ohlcv_candles_old")
            sys.exit(1)
    
    if not dry_run:
        # Rename current table to backup
        client.execute(f"RENAME TABLE {database}.ohlcv_candles TO {database}.ohlcv_candles_old")
        print("✓ Renamed ohlcv_candles -> ohlcv_candles_old")
        
        # Rename new table to production
        client.execute(f"RENAME TABLE {database}.ohlcv_candles_v2 TO {database}.ohlcv_candles")
        print("✓ Renamed ohlcv_candles_v2 -> ohlcv_candles")
    else:
        print("✓ DRY RUN: Would rename tables")


def verify_migration(client: ClickHouseClient, database: str) -> Dict[str, Any]:
    """Verify migration success."""
    print("\nVerifying migration...")
    
    # Check row count
    count = client.execute(f"SELECT count() FROM {database}.ohlcv_candles")[0][0]
    print(f"✓ New table has {count:,} rows")
    
    # Check for duplicates
    dup_check = check_duplicates(client, database)
    if dup_check["total_duplicate_groups"] == 0:
        print("✓ No duplicates found")
    else:
        print(f"⚠️  Still has {dup_check['total_duplicate_groups']} duplicate groups")
    
    # Check engine
    engine_query = f"""
        SELECT engine
        FROM system.tables
        WHERE database = '{database}' AND name = 'ohlcv_candles'
    """
    engine = client.execute(engine_query)[0][0]
    print(f"✓ Table engine: {engine}")
    
    # Sample data
    sample = client.execute(f"SELECT * FROM {database}.ohlcv_candles LIMIT 1")
    if sample:
        print(f"✓ Sample row: {len(sample[0])} columns")
    
    return {
        "row_count": count,
        "duplicates": dup_check["total_duplicate_groups"],
        "engine": engine
    }


def main():
    parser = argparse.ArgumentParser(description="Migrate ohlcv_candles to ReplacingMergeTree")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without executing")
    parser.add_argument("--skip-swap", action="store_true", help="Create and migrate but don't swap tables")
    
    args = parser.parse_args()
    
    database = os.getenv("CLICKHOUSE_DATABASE", "quantbot")
    
    print("=" * 70)
    print("OHLCV CANDLES MIGRATION TO REPLACING MERGE TREE")
    print("=" * 70)
    print(f"Database: {database}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print()
    
    try:
        client = get_client()
        
        # Step 1: Check current state
        print("[1/5] Checking current state...")
        dup_stats = check_duplicates(client, database)
        print(f"  Current duplicate groups: {dup_stats['total_duplicate_groups']:,}")
        print()
        
        # Step 2: Create new table
        print("[2/5] Creating new table...")
        create_new_table(client, database, args.dry_run)
        print()
        
        # Step 3: Migrate data
        print("[3/5] Migrating data...")
        migration_stats = migrate_data(client, database, args.dry_run)
        print(f"  Duplicates removed: {migration_stats['duplicates_removed']:,}")
        print()
        
        # Step 4: Swap tables (optional)
        if not args.skip_swap:
            print("[4/5] Swapping tables...")
            if not args.dry_run:
                response = input("Ready to swap tables? This will make the new table live. (yes/no): ")
                if response.lower() != "yes":
                    print("Aborting table swap. New table remains as ohlcv_candles_v2")
                    sys.exit(0)
            swap_tables(client, database, args.dry_run)
            print()
        else:
            print("[4/5] Skipping table swap (--skip-swap)")
            print()
        
        # Step 5: Verify
        if not args.dry_run and not args.skip_swap:
            print("[5/5] Verifying migration...")
            verify_migration(client, database)
        else:
            print("[5/5] Skipping verification (dry run or skip swap)")
        
        print()
        print("=" * 70)
        print("MIGRATION COMPLETE")
        print("=" * 70)
        
        if args.dry_run:
            print("\n⚠️  This was a DRY RUN. No changes were made.")
            print("Run without --dry-run to execute the migration.")
        elif args.skip_swap:
            print("\n✓ Migration complete. New table is: ohlcv_candles_v2")
            print("To make it live, run:")
            print(f"  RENAME TABLE {database}.ohlcv_candles TO {database}.ohlcv_candles_old;")
            print(f"  RENAME TABLE {database}.ohlcv_candles_v2 TO {database}.ohlcv_candles;")
        else:
            print("\n✓ Migration successful!")
            print(f"  Old table backed up as: {database}.ohlcv_candles_old")
            print(f"  New table is live as: {database}.ohlcv_candles")
            print("\nNext steps:")
            print("1. Test queries on new table")
            print("2. Update ingestion code to set ingested_at")
            print("3. Re-export slices")
            print("4. Drop backup table when confident: DROP TABLE ohlcv_candles_old")
        
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

