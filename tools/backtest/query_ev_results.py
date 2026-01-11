#!/usr/bin/env python3
"""
Query EV results from phased stop simulator parquet files.

This script helps you query the parquet files to avoid the "duplicate mint" issue
by filtering to a specific strategy.

Usage:
    # Query winners with trailing 20%/20%
    python3 query_ev_results.py output/my_run/phased_stop_results_*.parquet --winners --strategy trailing 0.20 0.20
    
    # Query all trades with static 15%/30%
    python3 query_ev_results.py output/my_run/phased_stop_results_*.parquet --strategy static 0.15 0.30
    
    # Show cohort statistics
    python3 query_ev_results.py output/my_run/phased_stop_results_*.parquet --stats --strategy trailing 0.20 0.20
"""

import argparse
import sys
from pathlib import Path
import pyarrow.parquet as pq
import pandas as pd


def main():
    parser = argparse.ArgumentParser(description="Query EV results from phased stop simulator")
    parser.add_argument("parquet_file", help="Path to parquet file (can use wildcards)")
    parser.add_argument("--strategy", nargs=3, metavar=("MODE", "P1", "P2"),
                        help="Filter to specific strategy: mode phase1_pct phase2_pct (e.g., trailing 0.20 0.20)")
    parser.add_argument("--winners", action="store_true", help="Show only winners (hit 3x)")
    parser.add_argument("--losers", action="store_true", help="Show only losers (2x but not 3x)")
    parser.add_argument("--never-2x", action="store_true", help="Show only trades that never hit 2x")
    parser.add_argument("--stats", action="store_true", help="Show cohort statistics")
    parser.add_argument("--top", type=int, default=10, help="Number of top results to show")
    parser.add_argument("--caller", help="Filter to specific caller")
    
    args = parser.parse_args()
    
    # Load parquet
    try:
        df = pq.read_table(args.parquet_file).to_pandas()
    except Exception as e:
        print(f"Error loading parquet file: {e}", file=sys.stderr)
        print("\nIf you see 'invalid TType', the file is corrupted.", file=sys.stderr)
        print("Delete it and run the simulator again.", file=sys.stderr)
        sys.exit(1)
    
    print(f"Loaded {len(df)} rows from {args.parquet_file}")
    
    # Check for new columns
    if 'exit_mult' not in df.columns:
        print("\n⚠️  This file doesn't have the new EV metrics (exit_mult, peak_mult, etc.)")
        print("Run the simulator again to generate files with these metrics.")
        sys.exit(1)
    
    # Filter by strategy
    if args.strategy:
        mode, p1_str, p2_str = args.strategy
        p1 = float(p1_str)
        p2 = float(p2_str)
        
        df = df[
            (df['stop_mode'] == mode) &
            (df['phase1_stop_pct'] == p1) &
            (df['phase2_stop_pct'] == p2)
        ].copy()
        
        print(f"Filtered to {mode} {p1*100:.0f}%/{p2*100:.0f}%: {len(df)} rows")
    
    # Filter by caller
    if args.caller:
        df = df[df['caller'] == args.caller].copy()
        print(f"Filtered to caller '{args.caller}': {len(df)} rows")
    
    # Filter by cohort
    if args.winners:
        df = df[df['hit_3x'] == True].copy()
        print(f"Filtered to winners (hit 3x): {len(df)} rows")
    elif args.losers:
        df = df[(df['hit_2x'] == True) & (df['hit_3x'] == False)].copy()
        print(f"Filtered to losers (2x but not 3x): {len(df)} rows")
    elif args.never_2x:
        df = df[df['hit_2x'] == False].copy()
        print(f"Filtered to never 2x: {len(df)} rows")
    
    if len(df) == 0:
        print("\nNo rows match the filters.")
        sys.exit(0)
    
    print(f"\nUnique mints: {df['mint'].nunique()}")
    print()
    
    # Show statistics
    if args.stats:
        print("=== Cohort Statistics ===")
        print(f"Count: {len(df)}")
        print(f"Mean exit mult: {df['exit_mult'].mean():.3f}x")
        print(f"Median exit mult: {df['exit_mult'].median():.3f}x")
        print(f"P25 exit mult: {df['exit_mult'].quantile(0.25):.3f}x")
        print(f"P75 exit mult: {df['exit_mult'].quantile(0.75):.3f}x")
        print(f"P90 exit mult: {df['exit_mult'].quantile(0.90):.3f}x")
        print(f"Mean peak mult: {df['peak_mult'].mean():.3f}x")
        print(f"Mean giveback: {df['giveback_from_peak_pct'].mean():.1f}%")
        print()
    
    # Show top results
    print(f"=== Top {args.top} by exit multiple ===")
    cols = ['caller', 'mint', 'entry_mult', 'peak_mult', 'exit_mult', 
            'giveback_from_peak_pct', 'hit_2x', 'hit_3x', 'exit_reason']
    
    # Truncate mint for display
    result = df.nlargest(args.top, 'exit_mult')[cols].copy()
    result['mint'] = result['mint'].str[:30] + '...'
    
    pd.set_option('display.max_columns', None)
    pd.set_option('display.width', 200)
    print(result.to_string(index=False))


if __name__ == "__main__":
    main()

