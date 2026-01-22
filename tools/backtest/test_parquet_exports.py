#!/usr/bin/env python3
"""
Test script for parquet export functionality.

Tests that all parquet exports work correctly and produce valid files.
"""

import sys
import argparse
from pathlib import Path

def test_baseline_parquet(parquet_path: Path) -> bool:
    """Test baseline parquet file."""
    try:
        import pandas as pd
        import duckdb
        
        print(f"Testing baseline parquet: {parquet_path}")
        
        # Load with pandas
        df = pd.read_parquet(parquet_path)
        print(f"  ✅ Loaded with pandas: {len(df)} rows, {len(df.columns)} columns")
        
        # Verify required columns
        required_cols = ['alert_id', 'mint', 'caller', 'entry_price', 'ath_mult', 'dd_initial']
        missing = [col for col in required_cols if col not in df.columns]
        if missing:
            print(f"  ❌ Missing required columns: {missing}")
            return False
        print(f"  ✅ Required columns present")
        
        # Load with DuckDB
        con = duckdb.connect()
        con.execute(f"CREATE TABLE test_baseline AS SELECT * FROM read_parquet('{parquet_path}')")
        duckdb_rows = con.execute("SELECT COUNT(*) FROM test_baseline").fetchone()[0]
        print(f"  ✅ Loaded with DuckDB: {duckdb_rows} rows")
        
        # Check file size
        file_size_mb = parquet_path.stat().st_size / (1024 * 1024)
        print(f"  ✅ File size: {file_size_mb:.2f} MB")
        
        con.close()
        return True
        
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False

def test_per_alert_parquet(parquet_dir: Path) -> bool:
    """Test per-alert parquet files."""
    try:
        import pandas as pd
        import duckdb
        
        print(f"Testing per-alert parquet directory: {parquet_dir}")
        
        # Find all parquet files
        parquet_files = list(parquet_dir.glob("alert_*.parquet"))
        if not parquet_files:
            print(f"  ❌ No parquet files found")
            return False
        
        print(f"  ✅ Found {len(parquet_files)} parquet files")
        
        # Test loading first few files
        test_files = parquet_files[:5]
        total_rows = 0
        for parquet_file in test_files:
            df = pd.read_parquet(parquet_file)
            total_rows += len(df)
            print(f"  ✅ {parquet_file.name}: {len(df)} rows, {len(df.columns)} columns")
        
        # Load all with DuckDB (UNION)
        if len(parquet_files) <= 100:  # Only if reasonable number
            con = duckdb.connect()
            paths_str = ', '.join([f"'{f}'" for f in parquet_files])
            con.execute(f"""
                CREATE TABLE test_per_alert AS 
                SELECT * FROM read_parquet([{paths_str}])
            """)
            duckdb_rows = con.execute("SELECT COUNT(*) FROM test_per_alert").fetchone()[0]
            print(f"  ✅ Loaded all with DuckDB UNION: {duckdb_rows} rows")
            con.close()
        
        # Check total size
        total_size_mb = sum(f.stat().st_size for f in parquet_files) / (1024 * 1024)
        print(f"  ✅ Total size: {total_size_mb:.2f} MB")
        
        return True
        
    except Exception as e:
        print(f"  ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_per_caller_parquet(parquet_dir: Path) -> bool:
    """Test per-caller parquet files."""
    try:
        import pandas as pd
        
        print(f"Testing per-caller parquet directory: {parquet_dir}")
        
        # Find all parquet files
        parquet_files = list(parquet_dir.glob("caller_*.parquet"))
        if not parquet_files:
            print(f"  ❌ No parquet files found")
            return False
        
        print(f"  ✅ Found {len(parquet_files)} parquet files")
        
        # Test loading each file
        for parquet_file in parquet_files:
            df = pd.read_parquet(parquet_file)
            caller_name = parquet_file.stem.replace('caller_', '')
            print(f"  ✅ {caller_name}: {len(df)} rows, {len(df.columns)} columns")
        
        # Check total size
        total_size_mb = sum(f.stat().st_size for f in parquet_files) / (1024 * 1024)
        print(f"  ✅ Total size: {total_size_mb:.2f} MB")
        
        return True
        
    except Exception as e:
        print(f"  ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_per_trade_parquet(parquet_dir: Path) -> bool:
    """Test per-trade parquet files."""
    try:
        import pandas as pd
        
        print(f"Testing per-trade parquet directory: {parquet_dir}")
        
        # Find all parquet files
        parquet_files = list(parquet_dir.glob("trade_*.parquet"))
        if not parquet_files:
            print(f"  ❌ No parquet files found")
            return False
        
        print(f"  ✅ Found {len(parquet_files)} parquet files")
        
        # Test loading first few files
        test_files = parquet_files[:5]
        for parquet_file in test_files:
            df = pd.read_parquet(parquet_file)
            print(f"  ✅ {parquet_file.name}: {len(df)} rows")
        
        # Check total size
        total_size_mb = sum(f.stat().st_size for f in parquet_files) / (1024 * 1024)
        print(f"  ✅ Total size: {total_size_mb:.2f} MB")
        
        return True
        
    except Exception as e:
        print(f"  ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    ap = argparse.ArgumentParser(description="Test parquet export functionality")
    ap.add_argument("--baseline-parquet", help="Path to baseline parquet file")
    ap.add_argument("--per-alert-dir", help="Directory with per-alert parquet files")
    ap.add_argument("--per-caller-dir", help="Directory with per-caller parquet files")
    ap.add_argument("--per-trade-dir", help="Directory with per-trade parquet files")
    ap.add_argument("--all", action="store_true", help="Test all exports in results/ directory")
    
    args = ap.parse_args()
    
    all_passed = True
    
    if args.all:
        # Test all exports in results/ directory
        results_dir = Path("results")
        if results_dir.exists():
            # Baseline
            baseline_files = list(results_dir.glob("baseline_cache_*.parquet"))
            if baseline_files:
                all_passed &= test_baseline_parquet(baseline_files[0])
                print()
            
            # Per-alert
            per_alert_dir = results_dir / "per_alert"
            if per_alert_dir.exists():
                all_passed &= test_per_alert_parquet(per_alert_dir)
                print()
            
            # Per-caller
            per_caller_dir = results_dir / "per_caller"
            if per_caller_dir.exists():
                all_passed &= test_per_caller_parquet(per_caller_dir)
                print()
            
            # Per-trade
            per_trade_dir = results_dir / "per_trade"
            if per_trade_dir.exists():
                all_passed &= test_per_trade_parquet(per_trade_dir)
                print()
    
    # Test specific paths
    if args.baseline_parquet:
        all_passed &= test_baseline_parquet(Path(args.baseline_parquet))
        print()
    
    if args.per_alert_dir:
        all_passed &= test_per_alert_parquet(Path(args.per_alert_dir))
        print()
    
    if args.per_caller_dir:
        all_passed &= test_per_caller_parquet(Path(args.per_caller_dir))
        print()
    
    if args.per_trade_dir:
        all_passed &= test_per_trade_parquet(Path(args.per_trade_dir))
        print()
    
    if not args.baseline_parquet and not args.per_alert_dir and not args.per_caller_dir and not args.per_trade_dir and not args.all:
        print("No test targets specified. Use --all or specify individual paths.")
        sys.exit(1)
    
    if all_passed:
        print("✅ All tests passed!")
        sys.exit(0)
    else:
        print("❌ Some tests failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()

