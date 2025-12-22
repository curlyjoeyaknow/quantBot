#!/usr/bin/env python3
"""
Normalize Chain Names in DuckDB

This script normalizes inconsistent chain names in DuckDB tables to their
canonical lowercase forms:
- SOL, Solana, SOLANA, sol -> solana
- ETH, Ethereum, ETHEREUM, eth -> ethereum
- BSC, Bsc, BNB, bnb -> bsc
- BASE, Base -> base
- EVM, Evm -> evm

Usage:
    python tools/storage/normalize_chains_duckdb.py --duckdb data/calls.duckdb [--dry-run]
"""

import argparse
import sys
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("Error: duckdb package not installed. Install with: pip install duckdb", file=sys.stderr)
    sys.exit(1)


def normalize_chain(chain: str) -> str:
    """
    Normalize chain name to lowercase canonical form.
    
    Maps:
    - 'eth'/'ethereum' -> 'ethereum'
    - 'sol'/'solana' -> 'solana'
    - 'bsc'/'bnb'/'binance' -> 'bsc'
    - 'base' -> 'base'
    - 'evm' -> 'evm'
    """
    if not chain:
        return 'solana'  # Default to solana if empty/None
    
    chain_lower = chain.lower().strip()
    chain_map = {
        'eth': 'ethereum',
        'ethereum': 'ethereum',
        'sol': 'solana',
        'solana': 'solana',
        'bsc': 'bsc',
        'bnb': 'bsc',  # BNB is BSC's native token, same chain
        'binance': 'bsc',
        'base': 'base',
        'evm': 'evm',
    }
    return chain_map.get(chain_lower, 'solana')  # Default to solana if unknown


def get_chain_stats(con: duckdb.DuckDBPyConnection) -> list:
    """Get current chain name distribution"""
    try:
        result = con.execute("""
            SELECT 
                chain,
                COUNT(*) as count,
                COUNT(DISTINCT mint) as unique_tokens
            FROM caller_links_d
            WHERE chain IS NOT NULL
            GROUP BY chain
            ORDER BY count DESC
        """).fetchall()
        return result
    except Exception as e:
        # Table might not exist or have different schema
        print(f"Warning: Could not query chain stats: {e}", file=sys.stderr)
        return []


def normalize_chains(con: duckdb.DuckDBPyConnection, dry_run: bool = True) -> dict:
    """
    Normalize chain names in caller_links_d table.
    
    Returns dict with stats about normalization.
    """
    stats = {
        'total_rows': 0,
        'rows_updated': 0,
        'chains_normalized': {},
    }
    
    try:
        # Check if table exists
        tables = con.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'main' AND table_name = 'caller_links_d'
        """).fetchall()
        
        if not tables:
            print("Warning: caller_links_d table not found", file=sys.stderr)
            return stats
        
        # Get current chain distribution
        chain_stats = get_chain_stats(con)
        stats['total_rows'] = sum(row[1] for row in chain_stats)
        
        if dry_run:
            print("\n🔍 DRY RUN - No changes will be made\n")
            print("Current chain distribution:")
            print(f"{'Chain':<20} {'Count':<15} {'Unique Tokens':<15} {'Will Normalize To':<20}")
            print("-" * 70)
            
            for chain, count, unique_tokens in chain_stats:
                normalized = normalize_chain(chain)
                will_change = chain != normalized
                status = f"→ {normalized}" if will_change else "✓ (already normalized)"
                print(f"{chain:<20} {count:<15} {unique_tokens:<15} {status:<20}")
                if will_change:
                    stats['rows_updated'] += count
                    stats['chains_normalized'][chain] = normalized
            
            print(f"\nTotal rows that would be updated: {stats['rows_updated']}")
            return stats
        
        # Actually normalize chains
        print("\n🔄 Normalizing chain names...\n")
        
        # Get all unique chain values that need normalization
        chains_to_normalize = con.execute("""
            SELECT DISTINCT chain
            FROM caller_links_d
            WHERE chain IS NOT NULL
        """).fetchall()
        
        updates_made = 0
        for (chain,) in chains_to_normalize:
            normalized = normalize_chain(chain)
            if chain != normalized:
                result = con.execute("""
                    UPDATE caller_links_d
                    SET chain = ?
                    WHERE chain = ?
                """, [normalized, chain])
                rows_updated = result.rowcount
                updates_made += rows_updated
                stats['rows_updated'] += rows_updated
                stats['chains_normalized'][chain] = normalized
                print(f"  ✓ Normalized '{chain}' → '{normalized}' ({rows_updated} rows)")
        
        print(f"\n✅ Normalized {updates_made} rows across {len(stats['chains_normalized'])} chain variants")
        
        # Show final distribution
        print("\nFinal chain distribution:")
        final_stats = get_chain_stats(con)
        print(f"{'Chain':<20} {'Count':<15} {'Unique Tokens':<15}")
        print("-" * 50)
        for chain, count, unique_tokens in final_stats:
            print(f"{chain:<20} {count:<15} {unique_tokens:<15}")
        
        return stats
        
    except Exception as e:
        print(f"Error normalizing chains: {e}", file=sys.stderr)
        raise


def main():
    parser = argparse.ArgumentParser(description='Normalize chain names in DuckDB')
    parser.add_argument(
        '--duckdb',
        type=str,
        required=True,
        help='Path to DuckDB file'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be changed without making changes'
    )
    
    args = parser.parse_args()
    
    duckdb_path = Path(args.duckdb)
    if not duckdb_path.exists():
        print(f"Error: DuckDB file not found: {duckdb_path}", file=sys.stderr)
        sys.exit(1)
    
    try:
        con = duckdb.connect(str(duckdb_path))
        
        print(f"📊 Analyzing chain names in {duckdb_path}")
        stats = normalize_chains(con, dry_run=args.dry_run)
        
        if args.dry_run:
            print("\n💡 Run without --dry-run to apply changes")
        else:
            print("\n✅ Chain normalization complete!")
        
        con.close()
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

