#!/usr/bin/env python3
"""
Migrate ClickHouse ohlcv_candles to normalized chain names

This script:
1. Creates a new table with normalized chain names
2. Copies all data with chain name normalization
3. Swaps the tables
4. Drops the old table

Normalization:
  SOL, Solana, SOLANA → solana
  ETH, Ethereum, ETHEREUM → ethereum
  BSC, Bsc, BNB → bsc
  BASE, Base → base
  EVM, Evm → evm

Estimated time: 2-5 minutes for 50M rows
"""

import sys
import os
import time

try:
    from clickhouse_driver import Client
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)


def get_client():
    """Get ClickHouse client"""
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    port = int(os.getenv('CLICKHOUSE_PORT', '9000'))
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    
    return Client(host=host, port=port, database=database, user=user, password=password), database


def normalize_chain(chain: str) -> str:
    """Normalize chain name to lowercase canonical form"""
    chain_map = {
        'SOL': 'solana',
        'Solana': 'solana',
        'SOLANA': 'solana',
        'sol': 'solana',
        
        'ETH': 'ethereum',
        'Ethereum': 'ethereum',
        'ETHEREUM': 'ethereum',
        'eth': 'ethereum',
        
        'BSC': 'bsc',
        'Bsc': 'bsc',
        'BNB': 'bsc',
        'bnb': 'bsc',
        
        'BASE': 'base',
        'Base': 'base',
        
        'EVM': 'evm',
        'Evm': 'evm',
    }
    return chain_map.get(chain, chain.lower())


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Normalize chain names in ClickHouse')
    parser.add_argument('--dry-run', action='store_true', help='Show plan without executing')
    parser.add_argument('--batch-size', type=int, default=1000000, help='Batch size for data copy (default: 1M rows)')
    
    args = parser.parse_args()
    
    try:
        client, database = get_client()
        
        print("🔍 Analyzing current state...\n")
        
        # Get current distribution
        result = client.execute(f"SELECT chain, count() FROM {database}.ohlcv_candles GROUP BY chain ORDER BY count() DESC")
        
        print("Current chain distribution:")
        total_rows = 0
        rows_to_normalize = 0
        for chain, count in result:
            normalized = normalize_chain(chain)
            status = f"→ {normalized}" if chain != normalized else "✓"
            print(f"  {chain:15} {count:12,} rows  {status}")
            total_rows += count
            if chain != normalized:
                rows_to_normalize += count
        
        print(f"\nTotal: {total_rows:,} rows")
        print(f"To normalize: {rows_to_normalize:,} rows ({rows_to_normalize/total_rows*100:.1f}%)")
        
        if args.dry_run:
            print("\n[DRY RUN] No changes made. Run without --dry-run to execute.")
            return 0
        
        print("\n" + "="*80)
        print("🔄 Starting migration...")
        print("="*80)
        
        # Step 1: Drop old normalized table if exists
        print("\n1. Dropping old normalized table if exists...")
        client.execute(f"DROP TABLE IF EXISTS {database}.ohlcv_candles_normalized")
        print("   ✓ Done")
        
        # Step 2: Create new table with Date column for old ClickHouse syntax
        print("\n2. Creating new table with optimized schema...")
        create_query = f"""
        CREATE TABLE {database}.ohlcv_candles_normalized (
            token_address String,
            chain String,
            timestamp DateTime,
            date Date,
            interval String,
            open Float64,
            high Float64,
            low Float64,
            close Float64,
            volume Float64
        )
        ENGINE = MergeTree(date, (token_address, chain, date, timestamp), 8192)
        """
        client.execute(create_query)
        print("   ✓ Table created")
        
        # Step 3: Copy data in batches with normalization
        print("\n3. Copying and normalizing data...")
        print(f"   Batch size: {args.batch_size:,} rows")
        
        start_time = time.time()
        offset = 0
        total_inserted = 0
        
        while True:
            # Fetch batch
            batch_query = f"""
            SELECT token_address, chain, timestamp, interval, open, high, low, close, volume
            FROM {database}.ohlcv_candles
            ORDER BY token_address, chain, timestamp
            LIMIT {args.batch_size} OFFSET {offset}
            """
            
            batch = client.execute(batch_query)
            
            if not batch:
                break
            
            # Normalize chains in batch
            normalized_batch = []
            for row in batch:
                token, chain, ts, interval, o, h, l, c, v = row
                normalized_chain = normalize_chain(chain)
                normalized_batch.append((token, normalized_chain, ts, interval, o, h, l, c, v))
            
            # Insert normalized batch
            client.execute(
                f"INSERT INTO {database}.ohlcv_candles_normalized VALUES",
                normalized_batch
            )
            
            total_inserted += len(batch)
            offset += args.batch_size
            
            elapsed = time.time() - start_time
            rate = total_inserted / elapsed if elapsed > 0 else 0
            progress_pct = (total_inserted / total_rows * 100) if total_rows > 0 else 0
            eta = (total_rows - total_inserted) / rate if rate > 0 else 0
            
            print(f"   Progress: {total_inserted:,} / {total_rows:,} ({progress_pct:.1f}%) | Rate: {rate:,.0f} rows/s | ETA: {eta:.0f}s", flush=True)
            
            if len(batch) < args.batch_size:
                break
        
        total_time = time.time() - start_time
        print(f"\n   ✓ Copied {total_inserted:,} rows in {total_time:.1f}s ({total_inserted/total_time:,.0f} rows/s)")
        
        # Step 4: Verify counts
        print("\n4. Verifying data...")
        new_result = client.execute(f"SELECT chain, count() FROM {database}.ohlcv_candles_normalized GROUP BY chain ORDER BY count() DESC")
        
        print("   New table distribution:")
        new_total = 0
        for chain, count in new_result:
            print(f"     {chain:15} {count:12,} rows")
            new_total += count
        
        print(f"\n   Original: {total_rows:,} rows")
        print(f"   New:      {new_total:,} rows")
        
        if new_total == total_rows:
            print("   ✓ Row count matches!")
        else:
            print(f"   ⚠️  Row count mismatch! Difference: {abs(new_total - total_rows):,}")
            return 1
        
        # Step 5: Swap tables
        print("\n5. Swapping tables...")
        client.execute(f"RENAME TABLE {database}.ohlcv_candles TO {database}.ohlcv_candles_old")
        client.execute(f"RENAME TABLE {database}.ohlcv_candles_normalized TO {database}.ohlcv_candles")
        print("   ✓ Tables swapped")
        
        # Step 6: Drop old table
        print("\n6. Dropping old table...")
        client.execute(f"DROP TABLE {database}.ohlcv_candles_old")
        print("   ✓ Old table dropped")
        
        print("\n" + "="*80)
        print("✅ Migration complete!")
        print("="*80)
        print(f"\nTotal time: {total_time:.1f}s")
        print(f"Rows migrated: {total_inserted:,}")
        print(f"Average rate: {total_inserted/total_time:,.0f} rows/s")
        
        print("\n📊 Final distribution:")
        final_result = client.execute(f"SELECT chain, count() FROM {database}.ohlcv_candles GROUP BY chain ORDER BY count() DESC")
        for chain, count in final_result:
            print(f"  {chain:15} {count:12,} rows")
        
        return 0
        
    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())

