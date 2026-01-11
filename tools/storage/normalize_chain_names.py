#!/usr/bin/env python3
"""
Normalize Chain Names in ClickHouse

Consolidates inconsistent chain names:
- solana, SOL, Solana → solana
- ethereum, ETH, Ethereum, ETHEREUM → ethereum
- bsc, BSC, Bsc, BNB → bsc
- base, BASE → base
- evm, EVM → evm

This improves query performance and data consistency.
"""

import sys
import os
from typing import Dict

try:
    from clickhouse_driver import Client
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)


# Normalization mapping
CHAIN_NORMALIZATION = {
    # Solana variants
    'SOL': 'solana',
    'Solana': 'solana',
    'SOLANA': 'solana',
    'sol': 'solana',
    
    # Ethereum variants
    'ETH': 'ethereum',
    'Ethereum': 'ethereum',
    'ETHEREUM': 'ethereum',
    'eth': 'ethereum',
    
    # BSC variants
    'BSC': 'bsc',
    'Bsc': 'bsc',
    'BNB': 'bsc',
    'bnb': 'bsc',
    
    # Base variants
    'BASE': 'base',
    'Base': 'base',
    
    # EVM variants
    'EVM': 'evm',
    'Evm': 'evm',
}


def get_clickhouse_client() -> tuple:
    """Get ClickHouse client from environment"""
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    port = int(os.getenv('CLICKHOUSE_PORT', '9000'))
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    
    client = Client(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password
    )
    
    return client, database


def analyze_chain_names(client, database: str) -> Dict[str, int]:
    """Analyze current chain name distribution"""
    query = f"""
    SELECT chain, count() as cnt
    FROM {database}.ohlcv_candles
    GROUP BY chain
    ORDER BY cnt DESC
    """
    
    results = client.execute(query)
    return {row[0]: row[1] for row in results}


def normalize_chains(client, database: str, dry_run: bool = True) -> Dict[str, any]:
    """Normalize chain names in ClickHouse"""
    
    print("🔍 Analyzing current chain names...\n")
    current_chains = analyze_chain_names(client, database)
    
    print("Current distribution:")
    for chain, count in current_chains.items():
        normalized = CHAIN_NORMALIZATION.get(chain, chain)
        status = "→ " + normalized if chain != normalized else "✓ (already normalized)"
        print(f"  {chain:15} {count:12,} rows  {status}")
    
    print("\n" + "="*80)
    
    # Calculate what will change
    changes = {}
    for old_chain, count in current_chains.items():
        new_chain = CHAIN_NORMALIZATION.get(old_chain, old_chain)
        if old_chain != new_chain:
            if new_chain not in changes:
                changes[new_chain] = {'old_chains': [], 'total_rows': 0}
            changes[new_chain]['old_chains'].append(old_chain)
            changes[new_chain]['total_rows'] += count
    
    if not changes:
        print("\n✅ All chain names are already normalized!")
        return {'normalized': 0, 'total_rows': 0}
    
    print("\nNormalization plan:")
    total_rows_to_update = 0
    for new_chain, info in changes.items():
        print(f"\n{new_chain}:")
        for old_chain in info['old_chains']:
            rows = current_chains[old_chain]
            print(f"  {old_chain:15} → {new_chain:15} ({rows:,} rows)")
            total_rows_to_update += rows
        print(f"  Total: {info['total_rows']:,} rows")
    
    print(f"\n📊 Total rows to update: {total_rows_to_update:,}")
    print("="*80)
    
    if dry_run:
        print("\n[DRY RUN] No changes made. Run with --execute to apply normalization.")
        return {'dry_run': True, 'total_rows': total_rows_to_update}
    
    # Execute normalization
    print("\n🔄 Executing normalization...")
    
    updated_count = 0
    for old_chain, new_chain in CHAIN_NORMALIZATION.items():
        if old_chain in current_chains:
            print(f"\n  Updating {old_chain} → {new_chain}...")
            
            # ClickHouse doesn't support UPDATE in old versions
            # We need to use ALTER TABLE ... UPDATE
            try:
                query = f"""
                ALTER TABLE {database}.ohlcv_candles
                UPDATE chain = '{new_chain}'
                WHERE chain = '{old_chain}'
                """
                
                client.execute(query)
                rows = current_chains[old_chain]
                print(f"    ✓ Updated {rows:,} rows")
                updated_count += rows
            except Exception as e:
                print(f"    ✗ Error: {e}")
                print(f"    Note: ClickHouse 18.16 may not support ALTER TABLE UPDATE")
                print(f"    Alternative: Recreate table with normalized data")
                return {'error': str(e), 'updated': updated_count}
    
    print(f"\n✅ Normalization complete! Updated {updated_count:,} rows")
    
    # Verify
    print("\n🔍 Verifying...")
    new_distribution = analyze_chain_names(client, database)
    print("\nNew distribution:")
    for chain, count in new_distribution.items():
        print(f"  {chain:15} {count:12,} rows")
    
    return {'updated': updated_count, 'final_distribution': new_distribution}


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Normalize chain names in ClickHouse')
    parser.add_argument('--execute', action='store_true',
                       help='Execute normalization (default is dry-run)')
    parser.add_argument('--export-script', action='store_true',
                       help='Export SQL script for manual execution')
    
    args = parser.parse_args()
    
    try:
        client, database = get_clickhouse_client()
        
        if args.export_script:
            print("-- Chain Name Normalization Script")
            print("-- Execute in clickhouse-client\n")
            
            current_chains = analyze_chain_names(client, database)
            for old_chain, new_chain in CHAIN_NORMALIZATION.items():
                if old_chain in current_chains:
                    print(f"-- Normalize {old_chain} → {new_chain}")
                    print(f"ALTER TABLE {database}.ohlcv_candles")
                    print(f"UPDATE chain = '{new_chain}'")
                    print(f"WHERE chain = '{old_chain}';")
                    print()
            
            return 0
        
        result = normalize_chains(client, database, dry_run=not args.execute)
        
        if result.get('error'):
            print("\n❌ Normalization failed. Try --export-script to generate SQL for manual execution.")
            return 1
        
        return 0
        
    except Exception as e:
        print(f"\nERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())

