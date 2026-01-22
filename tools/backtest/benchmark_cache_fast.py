#!/usr/bin/env python3
"""
Fast Cache Performance Benchmark

Measures actual cache load time without subprocess overhead.
Compares different loading methods for optimal performance.
"""

import sys
import argparse
import time
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent))

from lib.helpers import parse_yyyy_mm_dd

def benchmark_pandas_load(cache_path: Path, iterations: int = 10) -> dict:
    """Benchmark pandas parquet loading."""
    import pandas as pd
    
    times = []
    for _ in range(iterations):
        start = time.perf_counter()
        df = pd.read_parquet(cache_path)
        elapsed = time.perf_counter() - start
        times.append(elapsed)
    
    return {
        'method': 'pandas',
        'min': min(times),
        'max': max(times),
        'mean': sum(times) / len(times),
        'rows': len(df),
        'columns': len(df.columns),
    }

def benchmark_duckdb_load(cache_path: Path, iterations: int = 10) -> dict:
    """Benchmark DuckDB parquet loading."""
    import duckdb
    
    times = []
    for _ in range(iterations):
        con = duckdb.connect()
        start = time.perf_counter()
        df = con.execute(f"SELECT * FROM read_parquet('{cache_path}')").df()
        elapsed = time.perf_counter() - start
        times.append(elapsed)
        con.close()
    
    return {
        'method': 'duckdb',
        'min': min(times),
        'max': max(times),
        'mean': sum(times) / len(times),
        'rows': len(df),
        'columns': len(df.columns),
    }

def benchmark_pyarrow_load(cache_path: Path, iterations: int = 10) -> dict:
    """Benchmark PyArrow parquet loading."""
    import pyarrow.parquet as pq
    
    times = []
    for _ in range(iterations):
        start = time.perf_counter()
        table = pq.read_table(cache_path)
        df = table.to_pandas()
        elapsed = time.perf_counter() - start
        times.append(elapsed)
    
    return {
        'method': 'pyarrow',
        'min': min(times),
        'max': max(times),
        'mean': sum(times) / len(times),
        'rows': len(df),
        'columns': len(df.columns),
    }

def benchmark_pandas_fastparquet(cache_path: Path, iterations: int = 10) -> dict:
    """Benchmark pandas with fastparquet engine."""
    import pandas as pd
    
    times = []
    for _ in range(iterations):
        start = time.perf_counter()
        df = pd.read_parquet(cache_path, engine='fastparquet')
        elapsed = time.perf_counter() - start
        times.append(elapsed)
    
    return {
        'method': 'pandas-fastparquet',
        'min': min(times),
        'max': max(times),
        'mean': sum(times) / len(times),
        'rows': len(df),
        'columns': len(df.columns),
    }

def main():
    ap = argparse.ArgumentParser(description="Fast cache performance benchmark")
    ap.add_argument("--baseline-cache", required=True, help="Path to baseline cache parquet file")
    ap.add_argument("--iterations", type=int, default=10, help="Number of iterations for averaging")
    ap.add_argument("--compare-methods", action="store_true", help="Compare all loading methods")
    
    args = ap.parse_args()
    
    cache_path = Path(args.baseline_cache)
    if not cache_path.exists():
        print(f"❌ Cache file not found: {cache_path}")
        sys.exit(1)
    
    file_size_mb = cache_path.stat().st_size / (1024 * 1024)
    
    print("=" * 80)
    print("Fast Cache Performance Benchmark")
    print("=" * 80)
    print(f"Cache file: {cache_path}")
    print(f"File size: {file_size_mb:.3f} MB")
    print(f"Iterations: {args.iterations}")
    print()
    
    results = []
    
    # Always test pandas (default)
    print("1. Pandas (pyarrow engine) - Default")
    print("-" * 80)
    try:
        result = benchmark_pandas_load(cache_path, args.iterations)
        results.append(result)
        print(f"  Mean: {result['mean']*1000:.2f}ms")
        print(f"  Min:  {result['min']*1000:.2f}ms")
        print(f"  Max:  {result['max']*1000:.2f}ms")
        print(f"  Rows: {result['rows']}, Columns: {result['columns']}")
        print()
    except Exception as e:
        print(f"  ❌ Error: {e}")
        print()
    
    if args.compare_methods:
        # Compare DuckDB
        print("2. DuckDB")
        print("-" * 80)
        try:
            result = benchmark_duckdb_load(cache_path, args.iterations)
            results.append(result)
            print(f"  Mean: {result['mean']*1000:.2f}ms")
            print(f"  Min:  {result['min']*1000:.2f}ms")
            print(f"  Max:  {result['max']*1000:.2f}ms")
            print()
        except Exception as e:
            print(f"  ❌ Error: {e}")
            print()
        
        # Compare PyArrow direct
        print("3. PyArrow (direct)")
        print("-" * 80)
        try:
            result = benchmark_pyarrow_load(cache_path, args.iterations)
            results.append(result)
            print(f"  Mean: {result['mean']*1000:.2f}ms")
            print(f"  Min:  {result['min']*1000:.2f}ms")
            print(f"  Max:  {result['max']*1000:.2f}ms")
            print()
        except Exception as e:
            print(f"  ⚠️  PyArrow not available or error: {e}")
            print()
        
        # Compare fastparquet
        print("4. Pandas (fastparquet engine)")
        print("-" * 80)
        try:
            result = benchmark_pandas_fastparquet(cache_path, args.iterations)
            results.append(result)
            print(f"  Mean: {result['mean']*1000:.2f}ms")
            print(f"  Min:  {result['min']*1000:.2f}ms")
            print(f"  Max:  {result['max']*1000:.2f}ms")
            print()
        except Exception as e:
            print(f"  ⚠️  fastparquet not available or error: {e}")
            print()
    
    # Summary
    if len(results) > 1:
        print("=" * 80)
        print("Performance Comparison")
        print("=" * 80)
        results_sorted = sorted(results, key=lambda x: x['mean'])
        fastest = results_sorted[0]
        
        print(f"Fastest method: {fastest['method']} ({fastest['mean']*1000:.2f}ms)")
        print()
        print("All methods (sorted by speed):")
        for r in results_sorted:
            speedup = fastest['mean'] / r['mean'] if r['mean'] > 0 else 0
            print(f"  {r['method']:20s} {r['mean']*1000:8.2f}ms ({speedup:.2f}x vs fastest)")
    
    print()
    print("=" * 80)
    print("Benchmark complete!")
    print("=" * 80)

if __name__ == "__main__":
    main()

