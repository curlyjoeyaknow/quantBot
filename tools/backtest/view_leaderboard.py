#!/usr/bin/env python3
"""
View optimizer trial leaderboards from DuckDB.

Usage:
    # View best trials by robust score (default)
    python3 view_leaderboard.py
    
    # View by test R
    python3 view_leaderboard.py --by test_r
    
    # View specific run
    python3 view_leaderboard.py --run-id abc123
    
    # Filter by caller
    python3 view_leaderboard.py --caller exy
    
    # Top 20
    python3 view_leaderboard.py --top 20
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("Error: duckdb not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)


def view_leaderboard(
    duckdb_path: str = "data/alerts.duckdb",
    run_id: str | None = None,
    caller: str | None = None,
    sort_by: str = "robust_score",
    top_n: int = 10,
) -> None:
    """View optimizer leaderboard."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    with get_readonly_connection(duckdb_path) as con:
        # Build query based on sort_by
        sort_col_map = {
            "robust_score": "objective_score",
            "test_r": "total_r",
            "total_r": "total_r",
            "avg_r": "avg_r",
            "win_rate": "win_rate",
            "hit2x": "hit2x_pct",
        }
        sort_col = sort_col_map.get(sort_by, "objective_score")
        
        # Get latest run if not specified
        if not run_id:
            latest = con.execute("""
                SELECT run_id, name, created_at, n_trials
                FROM optimizer.recent_runs_v
                ORDER BY created_at DESC
                LIMIT 1
            """).fetchone()
            if not latest:
                print("No runs found in database", file=sys.stderr)
                return
            run_id = latest[0]
            print(f"Latest run: {run_id}")
            print(f"  Name: {latest[1]}")
            print(f"  Created: {latest[2]}")
            print(f"  Trials: {latest[3]}")
        
        # Query trials for this run
        query = f"""
            SELECT 
                trial_id,
                tp_mult,
                sl_mult,
                total_r,
                avg_r,
                win_rate * 100 as win_rate_pct,
                hit2x_pct * 100 as hit2x_pct,
                median_dd_pre2x * 100 as dd_pre2x_pct,
                median_time_to_2x_min,
                objective_score,
                alerts_ok
            FROM optimizer.trials_f
            WHERE run_id = ?
            ORDER BY {sort_col} DESC NULLS LAST
            LIMIT ?
        """
        
        rows = con.execute(query, [run_id, top_n]).fetchall()
        
        if not rows:
            print(f"No trials found for run_id: {run_id}", file=sys.stderr)
            return
        
        # Print leaderboard
        print()
        print("=" * 100)
        print(f"TOP {top_n} BY {sort_by.upper()}")
        print("=" * 100)
        print(f"{'#':>3} {'TP':>5} {'SL':>5} {'TotalR':>8} {'AvgR':>7} {'WR%':>5} {'Hit2x%':>7} {'DD%':>5} {'T2x':>6} {'Score':>7}")
        print("-" * 100)
        
        for i, row in enumerate(rows, 1):
            trial_id, tp, sl, total_r, avg_r, wr, hit2x, dd, t2x, score, alerts = row
            
            # Format values
            total_r_str = f"{total_r:+.1f}" if total_r else "N/A"
            avg_r_str = f"{avg_r:+.2f}" if avg_r else "N/A"
            wr_str = f"{wr:.0f}" if wr else "N/A"
            hit2x_str = f"{hit2x:.0f}" if hit2x else "N/A"
            dd_str = f"{abs(dd):.0f}" if dd else "N/A"
            t2x_str = f"{t2x:.0f}m" if t2x else "N/A"
            score_str = f"{score:+.2f}" if score else "N/A"
            
            print(f"{i:3d} {tp:5.2f}x {sl:5.2f}x {total_r_str:>8} {avg_r_str:>7} {wr_str:>5} {hit2x_str:>7} {dd_str:>5} {t2x_str:>6} {score_str:>7}")
        
        print()
        
        # Show run summary
        summary = con.execute("""
            SELECT 
                COUNT(*) as n_trials,
                AVG(total_r) as avg_total_r,
                AVG(win_rate) * 100 as avg_win_rate,
                SUM(CASE WHEN total_r > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as pct_profitable
            FROM optimizer.trials_f
            WHERE run_id = ?
        """, [run_id]).fetchone()
        
        if summary:
            print(f"Run Summary: {summary[0]} trials, Avg TotalR: {summary[1]:+.1f}, Avg WR: {summary[2]:.0f}%, Profitable: {summary[3]:.0f}%")


def list_runs(duckdb_path: str = "data/alerts.duckdb", top_n: int = 10) -> None:
    """List recent optimizer runs."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    with get_readonly_connection(duckdb_path) as con:
        rows = con.execute(f"""
        SELECT 
            run_id,
            run_type,
            created_at,
            name,
            n_trials,
            date_from,
            date_to
        FROM optimizer.recent_runs_v
        ORDER BY created_at DESC
        LIMIT {top_n}
    """).fetchall()
    
    print("=" * 100)
    print("RECENT OPTIMIZER RUNS")
    print("=" * 100)
    print(f"{'Run ID':12} {'Type':15} {'Created':20} {'Trials':>7} {'Date Range':25}")
    print("-" * 100)
    
    for row in rows:
        run_id, run_type, created, name, n_trials, date_from, date_to = row
        created_str = str(created)[:19] if created else "N/A"
        date_range = f"{date_from} to {date_to}" if date_from and date_to else "N/A"
        print(f"{run_id:12} {run_type:15} {created_str:20} {n_trials or 0:>7} {date_range:25}")
    
        print()


def main() -> None:
    ap = argparse.ArgumentParser(description="View optimizer leaderboards")
    
    ap.add_argument("--duckdb", default="data/alerts.duckdb", help="DuckDB path")
    ap.add_argument("--run-id", help="Specific run ID (default: latest)")
    ap.add_argument("--caller", help="Filter by caller")
    ap.add_argument("--by", dest="sort_by", default="robust_score",
                    choices=["robust_score", "test_r", "total_r", "avg_r", "win_rate", "hit2x"],
                    help="Sort by metric")
    ap.add_argument("--top", type=int, default=10, help="Number of results")
    ap.add_argument("--list-runs", action="store_true", help="List recent runs")
    
    args = ap.parse_args()
    
    if args.list_runs:
        list_runs(args.duckdb, args.top)
    else:
        view_leaderboard(
            duckdb_path=args.duckdb,
            run_id=args.run_id,
            caller=args.caller,
            sort_by=args.sort_by,
            top_n=args.top,
        )


if __name__ == "__main__":
    main()

