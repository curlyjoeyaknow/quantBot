#!/usr/bin/env python3
"""
Add ingestion metadata to ClickHouse ohlcv_candles table.

This migration adds:
- ingested_at: DateTime column tracking when candles were inserted
- ingestion_run_id: String column for tracking ingestion runs (optional)

Usage:
    python tools/storage/migrate_add_ingestion_metadata.py [--dry-run]
"""

import os
import sys
from datetime import datetime
from clickhouse_driver import Client
from typing import Optional

def get_clickhouse_client() -> Client:
    """Get ClickHouse client from environment variables."""
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    port = int(os.getenv('CLICKHOUSE_PORT', '9000'))
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    return Client(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database
    )

def check_column_exists(client: Client, table: str, column: str) -> bool:
    """Check if a column exists in a table."""
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    query = f"""
        SELECT count() as count
        FROM system.columns
        WHERE database = '{database}'
          AND table = '{table}'
          AND name = '{column}'
    """
    result = client.execute(query)
    return result[0][0] > 0

def get_table_row_count(client: Client, table: str) -> int:
    """Get the number of rows in a table."""
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    query = f"SELECT count() FROM {database}.{table}"
    result = client.execute(query)
    return result[0][0]

def add_ingestion_metadata_columns(client: Client, dry_run: bool = False) -> None:
    """Add ingestion metadata columns to ohlcv_candles table."""
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    table = 'ohlcv_candles'
    
    print(f"Checking {database}.{table} schema...")
    
    # Check if columns already exist
    has_ingested_at = check_column_exists(client, table, 'ingested_at')
    has_ingestion_run_id = check_column_exists(client, table, 'ingestion_run_id')
    
    if has_ingested_at and has_ingestion_run_id:
        print("✓ Ingestion metadata columns already exist")
        return
    
    # Get current row count
    row_count = get_table_row_count(client, table)
    print(f"Current table size: {row_count:,} rows")
    
    # Add ingested_at column if missing
    if not has_ingested_at:
        print(f"\n{'[DRY RUN] ' if dry_run else ''}Adding ingested_at column...")
        alter_query = f"""
            ALTER TABLE {database}.{table}
            ADD COLUMN IF NOT EXISTS ingested_at DateTime DEFAULT now()
        """
        print(f"Query: {alter_query}")
        
        if not dry_run:
            client.execute(alter_query)
            print("✓ Added ingested_at column")
        else:
            print("[DRY RUN] Would add ingested_at column")
    else:
        print("✓ ingested_at column already exists")
    
    # Add ingestion_run_id column if missing
    if not has_ingestion_run_id:
        print(f"\n{'[DRY RUN] ' if dry_run else ''}Adding ingestion_run_id column...")
        alter_query = f"""
            ALTER TABLE {database}.{table}
            ADD COLUMN IF NOT EXISTS ingestion_run_id String DEFAULT ''
        """
        print(f"Query: {alter_query}")
        
        if not dry_run:
            client.execute(alter_query)
            print("✓ Added ingestion_run_id column")
        else:
            print("[DRY RUN] Would add ingestion_run_id column")
    else:
        print("✓ ingestion_run_id column already exists")
    
    print("\n✓ Migration complete!")
    print(f"\nNote: Existing rows will have:")
    print(f"  - ingested_at: current timestamp (when column was added)")
    print(f"  - ingestion_run_id: empty string")
    print(f"\nNew inserts will automatically populate these fields.")

def analyze_duplicates(client: Client) -> None:
    """Analyze duplicate candles in the table."""
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    print("\n" + "="*80)
    print("DUPLICATE CANDLES ANALYSIS")
    print("="*80)
    
    # Check if ingested_at column exists
    if not check_column_exists(client, 'ohlcv_candles', 'ingested_at'):
        print("⚠ ingested_at column does not exist yet. Run migration first.")
        return
    
    # Find tokens with duplicate candles (same token, timestamp, interval)
    query = f"""
        SELECT 
            token_address,
            chain,
            interval,
            timestamp,
            count() as duplicate_count,
            groupArray(ingested_at) as ingestion_times
        FROM {database}.ohlcv_candles
        GROUP BY token_address, chain, interval, timestamp
        HAVING duplicate_count > 1
        ORDER BY duplicate_count DESC, token_address, timestamp
        LIMIT 100
    """
    
    print("\nQuerying for duplicate candles...")
    results = client.execute(query)
    
    if not results:
        print("✓ No duplicate candles found!")
        return
    
    print(f"\n⚠ Found {len(results)} duplicate candle groups:\n")
    
    for row in results[:20]:  # Show first 20
        token, chain, interval, ts, count, ingestion_times = row
        token_short = token[:8] + "..." if len(token) > 12 else token
        print(f"  {token_short} ({chain}, {interval}) @ {ts}")
        print(f"    Duplicates: {count}")
        print(f"    Ingestion times: {ingestion_times}")
        print()
    
    if len(results) > 20:
        print(f"  ... and {len(results) - 20} more duplicate groups")
    
    # Summary by token
    summary_query = f"""
        SELECT 
            token_address,
            chain,
            count(DISTINCT timestamp) as duplicate_timestamps,
            sum(cnt - 1) as extra_rows
        FROM (
            SELECT 
                token_address,
                chain,
                timestamp,
                count() as cnt
            FROM {database}.ohlcv_candles
            GROUP BY token_address, chain, timestamp
            HAVING cnt > 1
        )
        GROUP BY token_address, chain
        ORDER BY extra_rows DESC
        LIMIT 20
    """
    
    print("\n" + "="*80)
    print("TOKENS WITH MOST DUPLICATES")
    print("="*80 + "\n")
    
    summary_results = client.execute(summary_query)
    
    for row in summary_results:
        token, chain, dup_ts, extra = row
        token_short = token[:8] + "..." if len(token) > 12 else token
        print(f"  {token_short} ({chain})")
        print(f"    Duplicate timestamps: {dup_ts}")
        print(f"    Extra rows to remove: {extra}")
        print()

def create_deduplication_view(client: Client, dry_run: bool = False) -> None:
    """Create a view that shows only the most recent candles per (token, timestamp, interval)."""
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    print("\n" + "="*80)
    print("CREATING DEDUPLICATION VIEW")
    print("="*80)
    
    # Check if ingested_at column exists
    if not check_column_exists(client, 'ohlcv_candles', 'ingested_at'):
        print("⚠ ingested_at column does not exist yet. Run migration first.")
        return
    
    view_query = f"""
        CREATE OR REPLACE VIEW {database}.ohlcv_candles_deduplicated AS
        SELECT 
            token_address,
            chain,
            timestamp,
            interval,
            open,
            high,
            low,
            close,
            volume,
            ingested_at,
            ingestion_run_id
        FROM (
            SELECT *,
                   ROW_NUMBER() OVER (
                       PARTITION BY token_address, chain, timestamp, interval 
                       ORDER BY ingested_at DESC
                   ) as rn
            FROM {database}.ohlcv_candles
        )
        WHERE rn = 1
    """
    
    print(f"{'[DRY RUN] ' if dry_run else ''}Creating view ohlcv_candles_deduplicated...")
    print(f"\nView definition:")
    print(view_query)
    
    if not dry_run:
        client.execute(view_query)
        print("\n✓ Created view ohlcv_candles_deduplicated")
        print("\nUsage:")
        print(f"  SELECT * FROM {database}.ohlcv_candles_deduplicated")
        print(f"  WHERE token_address = 'YOUR_TOKEN' AND timestamp >= 'YYYY-MM-DD'")
    else:
        print("\n[DRY RUN] Would create view ohlcv_candles_deduplicated")

def main():
    """Main migration script."""
    dry_run = '--dry-run' in sys.argv
    analyze_only = '--analyze' in sys.argv
    create_view = '--create-view' in sys.argv
    
    if dry_run:
        print("="*80)
        print("DRY RUN MODE - No changes will be made")
        print("="*80 + "\n")
    
    try:
        client = get_clickhouse_client()
        
        # Test connection
        result = client.execute("SELECT version()")
        print(f"Connected to ClickHouse version: {result[0][0]}\n")
        
        if analyze_only:
            analyze_duplicates(client)
        elif create_view:
            create_deduplication_view(client, dry_run)
        else:
            # Run migration
            add_ingestion_metadata_columns(client, dry_run)
            
            # Analyze duplicates after migration
            if not dry_run:
                analyze_duplicates(client)
                create_deduplication_view(client, dry_run)
        
    except Exception as e:
        print(f"\n✗ Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    if '--help' in sys.argv or '-h' in sys.argv:
        print(__doc__)
        print("\nOptions:")
        print("  --dry-run      Show what would be done without making changes")
        print("  --analyze      Only analyze duplicates (don't modify schema)")
        print("  --create-view  Create deduplication view")
        print("  --help, -h     Show this help message")
        sys.exit(0)
    
    main()

