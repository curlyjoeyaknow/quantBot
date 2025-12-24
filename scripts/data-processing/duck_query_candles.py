#!/usr/bin/env python3
"""
duck_query_candles.py

Query Parquet candle files with DuckDB.

This script reads Parquet files exported from ClickHouse and allows you to query them
using DuckDB's excellent Parquet support. No need to import into a database - DuckDB
reads Parquet files directly.

Requirements:
  pip install duckdb pandas

Usage examples:

# Preview candles from a Parquet file
python scripts/data-processing/duck_query_candles.py \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --tf 1m

# Run a custom query
python scripts/data-processing/duck_query_candles.py \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --tf 1m \
  --query "SELECT min(timestamp), max(timestamp), count(*) FROM candles"

# Query all timeframes
python scripts/data-processing/duck_query_candles.py \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --all-tfs

# Output as CSV
python scripts/data-processing/duck_query_candles.py \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --tf 1m \
  --csv > output.csv
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Optional

try:
    import duckdb
except ImportError:
    print("[fatal] duckdb not installed. pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print("[fatal] pandas not installed. pip install pandas", file=sys.stderr)
    sys.exit(1)


def die(msg: str, code: int = 1) -> None:
    print(f"[fatal] {msg}", file=sys.stderr)
    raise SystemExit(code)


def find_parquet_path(slice_dir: str, mint: str, tf: str, chain: Optional[str] = None) -> pathlib.Path:
    """Find the Parquet file for a given mint and timeframe."""
    base = pathlib.Path(slice_dir)
    
    if chain:
        path = base / f"mint={mint}" / f"chain={chain}" / f"tf={tf}.parquet"
    else:
        path = base / f"mint={mint}" / f"tf={tf}.parquet"
    
    if not path.exists():
        # Try alternative location
        alt_path = base / f"mint={mint}" / f"tf={tf}.parquet"
        if alt_path.exists():
            return alt_path
        die(f"Parquet file not found: {path}")
    
    return path


def query_parquet(
    parquet_path: pathlib.Path,
    query: Optional[str] = None,
    view_name: str = "candles",
    as_csv: bool = False,
) -> None:
    """Query a Parquet file with DuckDB."""
    con = duckdb.connect()
    
    # Create view from Parquet file
    con.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet(?);", [str(parquet_path)])
    
    if query:
        # Run custom query
        df = con.execute(query).fetchdf()
        if as_csv:
            sys.stdout.write(df.to_csv(index=False))
        else:
            print(df.to_string(index=False))
    else:
        # Default: preview first 5 rows
        df = con.execute(f"SELECT * FROM {view_name} LIMIT 5").fetchdf()
        if as_csv:
            sys.stdout.write(df.to_csv(index=False))
        else:
            print(f"[info] Preview of {view_name} (first 5 rows):")
            print(df.to_string(index=False))
            
            # Also show summary
            summary = con.execute(
                f"""
                SELECT 
                    COUNT(*) as row_count,
                    MIN(timestamp) as min_ts,
                    MAX(timestamp) as max_ts
                FROM {view_name}
                """
            ).fetchdf()
            print(f"\n[info] Summary:")
            print(summary.to_string(index=False))


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Query Parquet candle files with DuckDB",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--mint", required=True, help="Token mint address")
    ap.add_argument("--slice-dir", default="./slices/candles", help="Directory containing Parquet slices")
    ap.add_argument("--tf", default=None, help="Timeframe to query: 1s|15s|1m|5m (required unless --all-tfs)")
    ap.add_argument("--chain", default=None, help="Chain filter (if Parquet files are partitioned by chain)")
    ap.add_argument("--query", default=None, help="Custom SQL query (uses 'candles' view)")
    ap.add_argument("--view", default="candles", help="DuckDB view name (default: candles)")
    ap.add_argument("--csv", action="store_true", help="Output as CSV to stdout")
    ap.add_argument("--all-tfs", action="store_true", help="Query all timeframes (1s, 15s, 1m, 5m)")
    
    args = ap.parse_args()
    
    if args.all_tfs:
        # Query all timeframes
        tfs = ["1s", "15s", "1m", "5m"]
        for tf in tfs:
            try:
                path = find_parquet_path(args.slice_dir, args.mint, tf, args.chain)
                print(f"\n[info] === Timeframe: {tf} ===")
                query_parquet(path, args.query, f"candles_{tf}", args.csv)
            except SystemExit:
                continue
            except Exception as e:
                print(f"[error] tf={tf}: {e}", file=sys.stderr)
                continue
    else:
        if not args.tf:
            die("--tf is required (or use --all-tfs)")
        
        path = find_parquet_path(args.slice_dir, args.mint, args.tf, args.chain)
        query_parquet(path, args.query, args.view, args.csv)


if __name__ == "__main__":
    main()

