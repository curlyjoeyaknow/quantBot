#!/usr/bin/env python3
"""
Performance Benchmarking Script

Measures speed improvements from caching:
- Baseline cache: skip path metric computation
- Per-alert cache: skip reloading candles
- Per-caller cache: skip aggregation

Usage:
    python3 benchmark_cache_performance.py \
        --from 2025-01-01 --to 2025-01-02 \
        --duckdb data/alerts.duckdb \
        --baseline-cache results/baseline_cache_*.parquet \
        --per-alert-cache results/per_alert
"""

import sys
import argparse
import time
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent))

from lib.helpers import parse_yyyy_mm_dd

def benchmark_baseline_without_cache(duckdb_path: str, date_from: datetime, date_to: datetime, verbose: bool = False) -> float:
    """Benchmark baseline computation without cache."""
    import subprocess
    
    cmd = [
        sys.executable,
        "run_baseline_all.py",
        "--from", date_from.strftime("%Y-%m-%d"),
        "--to", date_to.strftime("%Y-%m-%d"),
        "--duckdb", duckdb_path,
        "--output-format", "json",
    ]
    
    if verbose:
        print(f"  Running: {' '.join(cmd)}")
    
    start = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - start
    
    if result.returncode != 0:
        if verbose:
            print(f"  ❌ Error: {result.stderr}", file=sys.stderr)
        return -1.0
    
    return elapsed

def benchmark_baseline_with_cache(duckdb_path: str, baseline_cache: Path, verbose: bool = False) -> float:
    """Benchmark baseline computation with cache (load time only)."""
    try:
        import pandas as pd
        
        if verbose:
            print(f"  Loading cache: {baseline_cache}")
        
        start = time.time()
        df = pd.read_parquet(baseline_cache)
        elapsed = time.time() - start
        
        if verbose:
            print(f"  Loaded {len(df)} rows in {elapsed:.2f}s")
        
        return elapsed
    except Exception as e:
        if verbose:
            print(f"  ❌ Error: {e}", file=sys.stderr)
        return -1.0

def benchmark_strategy_without_cache(duckdb_path: str, date_from: datetime, date_to: datetime, verbose: bool = False) -> float:
    """Benchmark strategy run without per-alert cache."""
    import subprocess
    
    cmd = [
        sys.executable,
        "run_strategy.py",
        "--from", date_from.strftime("%Y-%m-%d"),
        "--to", date_to.strftime("%Y-%m-%d"),
        "--duckdb", duckdb_path,
        "--tp", "2.0",
        "--sl", "0.5",
        "--quiet",
    ]
    
    if verbose:
        print(f"  Running: {' '.join(cmd)}")
    
    start = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - start
    
    if result.returncode != 0:
        if verbose:
            print(f"  ❌ Error: {result.stderr}", file=sys.stderr)
        return -1.0
    
    return elapsed

def benchmark_strategy_with_cache(duckdb_path: str, date_from: datetime, date_to: datetime, cache_dir: Path, verbose: bool = False) -> float:
    """Benchmark strategy run with per-alert cache."""
    import subprocess
    
    cmd = [
        sys.executable,
        "run_strategy.py",
        "--from", date_from.strftime("%Y-%m-%d"),
        "--to", date_to.strftime("%Y-%m-%d"),
        "--duckdb", duckdb_path,
        "--tp", "2.0",
        "--sl", "0.5",
        "--per-alert-cache-dir", str(cache_dir),
        "--quiet",
    ]
    
    if verbose:
        print(f"  Running: {' '.join(cmd)}")
    
    start = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - start
    
    if result.returncode != 0:
        if verbose:
            print(f"  ❌ Error: {result.stderr}", file=sys.stderr)
        return -1.0
    
    return elapsed

def main():
    ap = argparse.ArgumentParser(description="Benchmark cache performance")
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")
    ap.add_argument("--duckdb", default="data/alerts.duckdb", help="Path to DuckDB file")
    ap.add_argument("--baseline-cache", help="Path to baseline cache parquet file")
    ap.add_argument("--per-alert-cache", help="Path to per-alert cache directory")
    ap.add_argument("--verbose", action="store_true", help="Verbose output")
    
    args = ap.parse_args()
    
    date_from = parse_yyyy_mm_dd(args.date_from)
    date_to = parse_yyyy_mm_dd(args.date_to)
    
    print("=" * 80)
    print("Cache Performance Benchmarking")
    print("=" * 80)
    print(f"Date range: {date_from.date()} to {date_to.date()}")
    print()
    
    # Benchmark baseline cache
    if args.baseline_cache:
        cache_path = Path(args.baseline_cache)
        if cache_path.exists():
            print("1. Baseline Cache Performance")
            print("-" * 80)
            
            # Without cache
            print("  Without cache (full computation):")
            elapsed_no_cache = benchmark_baseline_without_cache(args.duckdb, date_from, date_to, args.verbose)
            if elapsed_no_cache > 0:
                print(f"    Time: {elapsed_no_cache:.2f}s")
            
            # With cache (load only)
            print("  With cache (load time):")
            elapsed_with_cache = benchmark_baseline_with_cache(args.duckdb, cache_path, args.verbose)
            if elapsed_with_cache > 0:
                print(f"    Time: {elapsed_with_cache:.2f}s")
            
            # Calculate speedup
            if elapsed_no_cache > 0 and elapsed_with_cache > 0:
                speedup = elapsed_no_cache / elapsed_with_cache
                print(f"  ✅ Speedup: {speedup:.1f}x faster with cache")
            
            print()
    
    # Benchmark per-alert cache (strategy runs)
    if args.per_alert_cache:
        cache_dir = Path(args.per_alert_cache)
        if cache_dir.exists():
            print("2. Per-Alert Cache Performance (Strategy Runs)")
            print("-" * 80)
            parquet_files = list(cache_dir.glob("alert_*.parquet"))
            print(f"  Found {len(parquet_files)} cache files")
            
            # Benchmark strategy without cache
            print("  Without per-alert cache (full slice load):")
            elapsed_no_cache = benchmark_strategy_without_cache(
                args.duckdb, date_from, date_to, args.verbose
            )
            if elapsed_no_cache > 0:
                print(f"    Time: {elapsed_no_cache:.2f}s")
            
            # Benchmark strategy with cache
            print("  With per-alert cache (load from cache):")
            elapsed_with_cache = benchmark_strategy_with_cache(
                args.duckdb, date_from, date_to, cache_dir, args.verbose
            )
            if elapsed_with_cache > 0:
                print(f"    Time: {elapsed_with_cache:.2f}s")
            
            # Calculate speedup
            if elapsed_no_cache > 0 and elapsed_with_cache > 0:
                speedup = elapsed_no_cache / elapsed_with_cache
                print(f"  ✅ Speedup: {speedup:.1f}x faster with per-alert cache")
            
            print()
    
    print("=" * 80)
    print("Benchmark complete!")
    print("=" * 80)

if __name__ == "__main__":
    main()

