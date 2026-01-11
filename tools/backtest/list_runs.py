#!/usr/bin/env python3
"""
List optimization runs stored in DuckDB.

Usage:
    python3 list_runs.py                   # List recent runs
    python3 list_runs.py --run-id <id>     # Show details for a specific run
    python3 list_runs.py --walk-forward    # List walk-forward results
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

from lib.trial_ledger import (
    list_runs,
    get_best_trials,
    get_walk_forward_summary,
    print_recent_runs,
)

import duckdb


def main() -> None:
    ap = argparse.ArgumentParser(description="List optimization runs")
    ap.add_argument("--duckdb", default="data/alerts.duckdb", help="DuckDB path")
    ap.add_argument("--run-id", help="Show details for a specific run")
    ap.add_argument("--walk-forward", "-w", action="store_true", help="Show walk-forward summary")
    ap.add_argument("--limit", type=int, default=20, help="Max runs to show")
    ap.add_argument("--best", type=int, default=5, help="Top N trials to show for a run")
    
    args = ap.parse_args()
    
    if args.run_id:
        # Show details for a specific run
        print(f"Run: {args.run_id}")
        print()
        
        # Get best trials
        trials = get_best_trials(args.duckdb, args.run_id, limit=args.best)
        if trials:
            print(f"{'#':<3} {'TP':<6} {'SL':<6} {'TotalR':<10} {'AvgR':<10} {'WinRate':<10}")
            print("-" * 55)
            for i, t in enumerate(trials, 1):
                print(
                    f"{i:<3} "
                    f"{t['tp_mult']:<6.1f} "
                    f"{t['sl_mult']:<6.1f} "
                    f"{t['total_r']:>+9.1f} "
                    f"{t['avg_r']:>+9.2f} "
                    f"{t['win_rate']*100:>8.1f}%"
                )
        
        # Get walk-forward summary if applicable
        wf_summary = get_walk_forward_summary(args.duckdb, args.run_id)
        if wf_summary:
            print()
            print("Walk-Forward Summary:")
            print(f"  Folds: {wf_summary['n_folds']}")
            print(f"  Avg Train R: {wf_summary['avg_train_r']:+.1f}")
            print(f"  Avg Test R: {wf_summary['avg_test_r']:+.1f}")
            print(f"  Avg Degradation: {wf_summary['avg_degradation']*100:+.1f}%")
            print(f"  Folds Improved: {wf_summary['folds_improved']}")
            print(f"  Folds Overfit: {wf_summary['folds_overfit']}")
    
    elif args.walk_forward:
        # Show walk-forward summary
        from tools.shared.duckdb_adapter import get_readonly_connection
        with get_readonly_connection(args.duckdb) as con:
            rows = con.execute("""
                SELECT 
                    f.run_id,
                    f.fold_num,
                    f.train_from,
                    f.test_from,
                    f.best_tp_mult,
                    f.best_sl_mult,
                    f.train_total_r,
                    f.test_total_r,
                    f.avg_r_degradation
                FROM optimizer.walk_forward_f f
                ORDER BY f.run_id, f.fold_num
            """).fetchall()
            
            if rows:
                print(f"{'Run':<14} {'Fold':<5} {'Train':<12} {'Test':<12} {'TP':<5} {'SL':<5} {'TrainR':<10} {'TestR':<10} {'Degrad':<10}")
                print("-" * 90)
                for r in rows:
                    degrad_pct = r[8] * 100 if r[8] else 0
                    status = "✓" if degrad_pct < 0 else "⚠️" if degrad_pct > 50 else ""
                    print(
                        f"{r[0][:12]:<14} "
                        f"{r[1]:<5} "
                        f"{str(r[2]):<12} "
                        f"{str(r[3]):<12} "
                        f"{r[4]:<5.1f} "
                        f"{r[5]:<5.1f} "
                        f"{r[6]:>+9.1f} "
                        f"{r[7]:>+9.1f} "
                        f"{degrad_pct:>+8.0f}% {status}"
                    )
            else:
                print("No walk-forward results found.")
    
    else:
        # List recent runs
        print_recent_runs(args.duckdb, args.limit)


if __name__ == "__main__":
    main()

