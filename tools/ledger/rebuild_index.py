#!/usr/bin/env python3
"""
On-demand indexer CLI - Rebuild DuckDB index from event log.

Usage:
    python tools/ledger/rebuild_index.py --db data/ledger/index/runs.duckdb
    python tools/ledger/rebuild_index.py --db data/ledger/index/runs.duckdb --since-date 2026-01-23
    python tools/ledger/rebuild_index.py --db data/ledger/index/runs.duckdb --full-rebuild
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from indexer import rebuild_index, rebuild_runs_index, rebuild_alerts_index, rebuild_catalog_index


def main():
    parser = argparse.ArgumentParser(description='Rebuild DuckDB index from event log')
    parser.add_argument('--db', help='Path to DuckDB index file (e.g., runs.duckdb)')
    parser.add_argument('--since-date', help='Only process events after this date (YYYY-MM-DD)')
    parser.add_argument('--full-rebuild', action='store_true', help='Rebuild all indexes (runs, alerts, catalog)')
    parser.add_argument('--verbose', action='store_true', help='Verbose output')
    
    args = parser.parse_args()
    
    try:
        if args.full_rebuild:
            if args.verbose:
                print("Rebuilding all indexes...")
            rebuild_runs_index(args.since_date)
            rebuild_alerts_index(args.since_date)
            rebuild_catalog_index(args.since_date)
            if args.verbose:
                print("All indexes rebuilt successfully")
        elif args.db:
            duckdb_path = Path(args.db)
            if not duckdb_path.is_absolute():
                # Resolve relative to repo root
                from indexer import _repo_root
                duckdb_path = _repo_root / duckdb_path
            
            if args.verbose:
                print(f"Rebuilding index: {duckdb_path}")
                if args.since_date:
                    print(f"  Since date: {args.since_date}")
            
            rebuild_index(duckdb_path, args.since_date)
            
            if args.verbose:
                print(f"Index rebuilt successfully: {duckdb_path}")
        else:
            parser.print_help()
            sys.exit(1)
        
        sys.exit(0)
    
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

