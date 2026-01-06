#!/usr/bin/env python3
"""
Caller-First Analysis: Find profitable callers BEFORE optimizing parameters.

The insight: If no callers show consistent edge with simple TP/SL,
parameter optimization won't magically create alpha - it will just overfit.

This tool:
1. Runs a FIXED, conservative TP/SL (e.g., 2.0x / 0.40x) across all callers
2. Computes per-caller metrics with walk-forward validation
3. Ranks callers by out-of-sample performance
4. Identifies which callers have real edge vs noise

Usage:
    # Analyze all callers with default params
    python3 run_caller_analysis.py \
        --from 2025-01-01 --to 2025-06-01 \
        --slice slices/per_token

    # With custom TP/SL
    python3 run_caller_analysis.py \
        --from 2025-01-01 --to 2025-06-01 \
        --tp 2.5 --sl 0.35 \
        --min-trades 10

Output:
    - Caller leaderboard ranked by test R
    - Consistency metrics (train vs test)
    - Identified "tier A" callers with consistent edge
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

from lib.alerts import Alert, load_alerts
from lib.helpers import parse_yyyy_mm_dd
from lib.partitioner import is_hive_partitioned, is_per_token_directory
from lib.summary import summarize_tp_sl
from lib.timing import TimingContext
from lib.tp_sl_query import run_tp_sl_query

UTC = timezone.utc


@dataclass
class CallerResult:
    """Result for a single caller."""
    caller: str
    n_train: int
    n_test: int
    train_r: float
    test_r: float
    delta_r: float
    ratio: float  # test_r / train_r
    avg_r_train: float
    avg_r_test: float
    win_rate_train: float
    win_rate_test: float
    hit2x_train: float
    hit2x_test: float
    median_dd_test: float
    
    # Derived
    is_consistent: bool = False  # ratio > 0.3 and test_r > 0
    tier: str = "C"  # A, B, C based on consistency + magnitude
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "caller": self.caller,
            "n_train": self.n_train,
            "n_test": self.n_test,
            "train_r": self.train_r,
            "test_r": self.test_r,
            "delta_r": self.delta_r,
            "ratio": self.ratio,
            "avg_r_train": self.avg_r_train,
            "avg_r_test": self.avg_r_test,
            "win_rate_train": self.win_rate_train,
            "win_rate_test": self.win_rate_test,
            "hit2x_train": self.hit2x_train,
            "hit2x_test": self.hit2x_test,
            "median_dd_test": self.median_dd_test,
            "is_consistent": self.is_consistent,
            "tier": self.tier,
        }


@dataclass
class CallerAnalysisConfig:
    """Configuration for caller analysis."""
    date_from: str
    date_to: str
    
    # Fixed TP/SL - use conservative values
    tp_mult: float = 2.0
    sl_mult: float = 0.40
    
    # Walk-forward split
    train_pct: float = 0.70  # 70% train, 30% test
    
    # Minimums
    min_train_trades: int = 10
    min_test_trades: int = 5
    
    # Data sources
    duckdb_path: str = "data/alerts.duckdb"
    chain: str = "solana"
    slice_path: str = "slices/per_token"
    
    # Backtest params
    interval_seconds: int = 60
    horizon_hours: int = 48
    fee_bps: float = 30.0
    slippage_bps: float = 50.0
    risk_per_trade: float = 0.02


def run_caller_backtest(
    alerts: List[Alert],
    slice_path: Path,
    is_partitioned: bool,
    config: CallerAnalysisConfig,
) -> Dict[str, Any]:
    """Run backtest on alerts and return summary."""
    if not alerts:
        return {}
    
    results = run_tp_sl_query(
        alerts=alerts,
        slice_path=slice_path,
        tp_mult=config.tp_mult,
        sl_mult=config.sl_mult,
        interval_seconds=config.interval_seconds,
        horizon_hours=config.horizon_hours,
        fee_bps=config.fee_bps,
        slippage_bps=config.slippage_bps,
        risk_per_trade=config.risk_per_trade,
    )
    
    return summarize_tp_sl(results)


def assign_tier(result: CallerResult) -> str:
    """
    Assign tier based on consistency and magnitude.
    
    Tier A: Consistent (ratio > 0.3) AND profitable (test_r > 0) AND decent size (n_test >= 10)
    Tier B: Profitable (test_r > 0) but less consistent or smaller sample
    Tier C: Everything else
    """
    if result.test_r > 0 and result.ratio > 0.3 and result.n_test >= 10:
        if result.avg_r_test > 0:
            return "A"
    if result.test_r > 0 and result.n_test >= 5:
        return "B"
    return "C"


def run_caller_analysis(
    config: CallerAnalysisConfig,
    verbose: bool = True,
) -> List[CallerResult]:
    """
    Run caller-first analysis.
    
    Steps:
    1. Load all alerts
    2. Group by caller
    3. For each caller: run train/test backtest
    4. Compute consistency metrics
    5. Rank and tier callers
    """
    timing = TimingContext()
    timing.start()
    
    date_from = parse_yyyy_mm_dd(config.date_from)
    date_to = parse_yyyy_mm_dd(config.date_to)
    
    # Load alerts
    with timing.phase("load_alerts"):
        all_alerts = load_alerts(config.duckdb_path, config.chain, date_from, date_to)
        if not all_alerts:
            raise ValueError(f"No alerts found for {config.date_from} to {config.date_to}")
        if verbose:
            print(f"Loaded {len(all_alerts)} alerts", file=sys.stderr)
    
    # Setup slice
    slice_path = Path(config.slice_path)
    if not slice_path.exists():
        raise ValueError(f"Slice not found: {slice_path}")
    is_partitioned = is_hive_partitioned(slice_path) or is_per_token_directory(slice_path)
    
    # Group by caller
    alerts_by_caller: Dict[str, List[Alert]] = {}
    for a in all_alerts:
        caller = a.caller.strip()
        if caller not in alerts_by_caller:
            alerts_by_caller[caller] = []
        alerts_by_caller[caller].append(a)
    
    if verbose:
        print(f"Found {len(alerts_by_caller)} unique callers", file=sys.stderr)
    
    # Split point for train/test
    total_days = (date_to - date_from).days
    train_days = int(total_days * config.train_pct)
    train_end = date_from + timedelta(days=train_days)
    
    if verbose:
        print(f"Train: {date_from.date()} to {train_end.date()}", file=sys.stderr)
        print(f"Test:  {train_end.date()} to {date_to.date()}", file=sys.stderr)
        print(f"Fixed params: TP={config.tp_mult}x SL={config.sl_mult}x", file=sys.stderr)
        print()
    
    # Analyze each caller
    results: List[CallerResult] = []
    
    with timing.phase("analyze_callers"):
        for i, (caller, caller_alerts) in enumerate(sorted(alerts_by_caller.items()), 1):
            # Split by time
            train_alerts = [a for a in caller_alerts if a.ts < train_end]
            test_alerts = [a for a in caller_alerts if a.ts >= train_end]
            
            # Skip if not enough data
            if len(train_alerts) < config.min_train_trades:
                continue
            if len(test_alerts) < config.min_test_trades:
                continue
            
            # Run backtests
            train_summary = run_caller_backtest(train_alerts, slice_path, is_partitioned, config)
            test_summary = run_caller_backtest(test_alerts, slice_path, is_partitioned, config)
            
            if not train_summary or not test_summary:
                continue
            
            # Extract metrics
            train_r = train_summary.get("total_r", 0.0)
            test_r = test_summary.get("total_r", 0.0)
            
            # Compute ratio (avoid div by zero)
            if abs(train_r) > 0.01:
                ratio = test_r / train_r
            else:
                ratio = 1.0 if abs(test_r) < 0.01 else (10.0 if test_r > 0 else -10.0)
            ratio = max(-10.0, min(10.0, ratio))
            
            result = CallerResult(
                caller=caller,
                n_train=len(train_alerts),
                n_test=len(test_alerts),
                train_r=train_r,
                test_r=test_r,
                delta_r=test_r - train_r,
                ratio=ratio,
                avg_r_train=train_summary.get("avg_r", 0.0),
                avg_r_test=test_summary.get("avg_r", 0.0),
                win_rate_train=train_summary.get("tp_sl_win_rate", 0.0),
                win_rate_test=test_summary.get("tp_sl_win_rate", 0.0),
                hit2x_train=train_summary.get("pct_hit_2x", 0.0) or 0.0,
                hit2x_test=test_summary.get("pct_hit_2x", 0.0) or 0.0,
                median_dd_test=abs(test_summary.get("median_dd_pre2x") or test_summary.get("dd_pre2x_median") or 0.0),
                is_consistent=(ratio > 0.3 and test_r > 0),
            )
            result.tier = assign_tier(result)
            results.append(result)
            
            if verbose and i % 10 == 0:
                print(f"  Analyzed {i}/{len(alerts_by_caller)} callers...", file=sys.stderr)
    
    timing.end()
    
    # Sort by test_r (out-of-sample performance)
    results.sort(key=lambda r: r.test_r, reverse=True)
    
    if verbose:
        print()
        print("=" * 90, file=sys.stderr)
        print("CALLER ANALYSIS COMPLETE", file=sys.stderr)
        print("=" * 90, file=sys.stderr)
        print(timing.summary_line(), file=sys.stderr)
        print()
        
        # Summary stats
        tier_a = [r for r in results if r.tier == "A"]
        tier_b = [r for r in results if r.tier == "B"]
        profitable = [r for r in results if r.test_r > 0]
        consistent = [r for r in results if r.is_consistent]
        
        print(f"Total callers analyzed: {len(results)}", file=sys.stderr)
        print(f"Profitable (test_r > 0): {len(profitable)} ({len(profitable)/len(results)*100:.0f}%)", file=sys.stderr)
        print(f"Consistent (ratio > 0.3 & profitable): {len(consistent)} ({len(consistent)/len(results)*100:.0f}%)", file=sys.stderr)
        print(f"Tier A (consistent + good size): {len(tier_a)}", file=sys.stderr)
        print(f"Tier B (profitable but less consistent): {len(tier_b)}", file=sys.stderr)
        print()
        
        # Tier A leaderboard
        if tier_a:
            print("─" * 90, file=sys.stderr)
            print("TIER A CALLERS (consistent edge - USE THESE):", file=sys.stderr)
            print("─" * 90, file=sys.stderr)
            for i, r in enumerate(tier_a[:15], 1):
                print(
                    f"  {i:2d}. {r.caller[:25]:<25} | "
                    f"TeR={r.test_r:+6.1f} TrR={r.train_r:+6.1f} "
                    f"Ratio={r.ratio:+.2f} n={r.n_test:3d} "
                    f"WR={r.win_rate_test:.0%}",
                    file=sys.stderr
                )
        
        # Top by test R (regardless of tier)
        print()
        print("─" * 90, file=sys.stderr)
        print("TOP 15 BY TEST R (raw out-of-sample):", file=sys.stderr)
        print("─" * 90, file=sys.stderr)
        for i, r in enumerate(results[:15], 1):
            tier_mark = f"[{r.tier}]"
            print(
                f"  {i:2d}. {tier_mark} {r.caller[:22]:<22} | "
                f"TeR={r.test_r:+6.1f} TrR={r.train_r:+6.1f} "
                f"Ratio={r.ratio:+.2f} n={r.n_test:3d}",
                file=sys.stderr
            )
        
        # Callers to AVOID (high train, negative test = overfitting on their signals)
        overfit_callers = [r for r in results if r.train_r > 10 and r.test_r < 0]
        if overfit_callers:
            print()
            print("─" * 90, file=sys.stderr)
            print("⚠️  OVERFIT CALLERS (high train, negative test - AVOID):", file=sys.stderr)
            print("─" * 90, file=sys.stderr)
            for r in overfit_callers[:10]:
                print(
                    f"  ⚠️  {r.caller[:25]:<25} | "
                    f"TrR={r.train_r:+6.1f} TeR={r.test_r:+6.1f} (DANGER)",
                    file=sys.stderr
                )
        
        # Actionable output
        print()
        print("=" * 90, file=sys.stderr)
        print("RECOMMENDED NEXT STEPS:", file=sys.stderr)
        print("=" * 90, file=sys.stderr)
        
        if tier_a:
            tier_a_names = [r.caller for r in tier_a]
            print(f"1. Create a caller group file with Tier A callers:", file=sys.stderr)
            print(f"   echo '{json.dumps(tier_a_names[:10])}' > caller_groups/tier_a.json", file=sys.stderr)
            print()
            print(f"2. Run parameter optimization ONLY on Tier A callers:", file=sys.stderr)
            print(f"   python3 run_random_search.py --from {config.date_from} --to {config.date_to} \\", file=sys.stderr)
            print(f"       --caller-group caller_groups/tier_a.json", file=sys.stderr)
        else:
            print("⚠️  No Tier A callers found. This suggests:", file=sys.stderr)
            print("    - The fixed TP/SL might not be optimal", file=sys.stderr)
            print("    - The data period might be too short", file=sys.stderr)
            print("    - There may not be consistent caller alpha to exploit", file=sys.stderr)
            print()
            print("Try:", file=sys.stderr)
            print(f"    - Different TP/SL: --tp 2.5 --sl 0.35", file=sys.stderr)
            print(f"    - Longer date range", file=sys.stderr)
            print(f"    - Lower thresholds: --min-test 3", file=sys.stderr)
    
    return results


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Caller-First Analysis: Find profitable callers before optimizing params",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    
    # Required
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")
    
    # Fixed TP/SL (conservative defaults)
    ap.add_argument("--tp", type=float, default=2.0, help="TP multiplier (default: 2.0)")
    ap.add_argument("--sl", type=float, default=0.40, help="SL multiplier (default: 0.40)")
    
    # Train/test split
    ap.add_argument("--train-pct", type=float, default=0.70, help="Training data percentage (default: 0.70)")
    
    # Minimums
    ap.add_argument("--min-train", type=int, default=10, help="Min training trades per caller")
    ap.add_argument("--min-test", type=int, default=5, help="Min test trades per caller")
    
    # Data sources
    ap.add_argument("--duckdb", default="data/alerts.duckdb", help="DuckDB path")
    ap.add_argument("--chain", default="solana", help="Chain name")
    ap.add_argument("--slice", dest="slice_path", default="slices/per_token", help="Slice path")
    
    # Backtest params
    ap.add_argument("--interval-seconds", type=int, default=60)
    ap.add_argument("--horizon-hours", type=int, default=48)
    ap.add_argument("--fee-bps", type=float, default=30.0)
    ap.add_argument("--slippage-bps", type=float, default=50.0)
    
    # Output
    ap.add_argument("--output", "-o", help="Output JSON file")
    ap.add_argument("--quiet", "-q", action="store_true")
    
    args = ap.parse_args()
    
    config = CallerAnalysisConfig(
        date_from=args.date_from,
        date_to=args.date_to,
        tp_mult=args.tp,
        sl_mult=args.sl,
        train_pct=args.train_pct,
        min_train_trades=args.min_train,
        min_test_trades=args.min_test,
        duckdb_path=args.duckdb,
        chain=args.chain,
        slice_path=args.slice_path,
        interval_seconds=args.interval_seconds,
        horizon_hours=args.horizon_hours,
        fee_bps=args.fee_bps,
        slippage_bps=args.slippage_bps,
    )
    
    results = run_caller_analysis(config, verbose=not args.quiet)
    
    if args.output:
        output_data = {
            "config": {
                "date_from": config.date_from,
                "date_to": config.date_to,
                "tp_mult": config.tp_mult,
                "sl_mult": config.sl_mult,
                "train_pct": config.train_pct,
            },
            "results": [r.to_dict() for r in results],
            "summary": {
                "total_callers": len(results),
                "tier_a": len([r for r in results if r.tier == "A"]),
                "tier_b": len([r for r in results if r.tier == "B"]),
                "profitable": len([r for r in results if r.test_r > 0]),
                "consistent": len([r for r in results if r.is_consistent]),
            },
        }
        
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(output_data, f, indent=2)
        
        if not args.quiet:
            print(f"\nResults saved to: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()

