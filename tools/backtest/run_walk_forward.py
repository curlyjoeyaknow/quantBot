#!/usr/bin/env python3
"""
Walk-Forward Validation for TP/SL Optimization.

Trains on one window, tests on another to detect overfitting.
The key insight: parameters that work in-sample should also work out-of-sample.

Usage:
    python3 run_walk_forward.py --train-from 2025-12-01 --train-to 2025-12-14 \
                                 --test-from 2025-12-15 --test-to 2025-12-28 \
                                 --tp-range 1.5:4.0:0.5 --sl-range 0.3:0.7:0.1
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

from lib.alerts import Alert, load_alerts
from lib.caller_groups import load_caller_group
from lib.helpers import parse_yyyy_mm_dd
from lib.optimizer import GridOptimizer, OptimizationResult, OptimizationRun
from lib.optimizer_config import OptimizerConfig, RangeSpec, TpSlParamSpace
from lib.summary import summarize_tp_sl
from lib.timing import TimingContext, format_ms
from lib.tp_sl_query import run_tp_sl_query
from lib.trial_ledger import store_walk_forward_run

UTC = timezone.utc


@dataclass
class WalkForwardResult:
    """Result of a single walk-forward fold."""
    fold_id: str
    train_from: str
    train_to: str
    test_from: str
    test_to: str
    
    # Best params from training
    best_params: Dict[str, Any]
    
    # Training metrics
    train_alerts: int
    train_win_rate: float
    train_avg_r: float
    train_total_r: float
    
    # Test metrics (out-of-sample)
    test_alerts: int
    test_win_rate: float
    test_avg_r: float
    test_total_r: float
    
    # Delta R metrics (test - train, simple difference)
    # Positive = test outperformed train, Negative = test underperformed
    delta_avg_r: float
    delta_total_r: float
    
    def to_dict(self) -> Dict[str, Any]:
        return self.__dict__
    
    @property
    def test_improved(self) -> bool:
        """Did test outperform train?"""
        return self.delta_total_r > 0


@dataclass
class WalkForwardRun:
    """Complete walk-forward validation run."""
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    folds: List[WalkForwardResult] = field(default_factory=list)
    config: Dict[str, Any] = field(default_factory=dict)
    timing: Optional[Dict[str, Any]] = None
    
    def add_fold(self, fold: WalkForwardResult) -> None:
        self.folds.append(fold)
    
    @property
    def avg_test_total_r(self) -> float:
        if not self.folds:
            return 0.0
        return sum(f.test_total_r for f in self.folds) / len(self.folds)
    
    @property
    def avg_delta_r(self) -> float:
        """Average ΔR across folds (test - train)."""
        if not self.folds:
            return 0.0
        return sum(f.delta_total_r for f in self.folds) / len(self.folds)
    
    @property
    def median_test_r(self) -> float:
        if not self.folds:
            return 0.0
        sorted_r = sorted(f.test_total_r for f in self.folds)
        mid = len(sorted_r) // 2
        if len(sorted_r) % 2 == 0:
            return (sorted_r[mid - 1] + sorted_r[mid]) / 2
        return sorted_r[mid]
    
    @property
    def pct_folds_profitable(self) -> float:
        if not self.folds:
            return 0.0
        return sum(1 for f in self.folds if f.test_total_r > 0) / len(self.folds) * 100
    
    @property
    def worst_fold_r(self) -> float:
        if not self.folds:
            return 0.0
        return min(f.test_total_r for f in self.folds)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "created_at": self.created_at.isoformat(),
            "folds": [f.to_dict() for f in self.folds],
            "config": self.config,
            "timing": self.timing,
            "summary": {
                "n_folds": len(self.folds),
                "avg_test_total_r": self.avg_test_total_r,
                "median_test_r": self.median_test_r,
                "pct_folds_profitable": self.pct_folds_profitable,
                "worst_fold_r": self.worst_fold_r,
                "avg_delta_r": self.avg_delta_r,
            }
        }
    
    def save(self, output_dir: str = "results/walk_forward") -> str:
        path = Path(output_dir) / f"{self.run_id}_walk_forward.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2, default=str)
        return str(path)


def run_single_backtest(
    alerts: List[Alert],
    slice_path: Path,
    is_partitioned: bool,
    params: Dict[str, Any],
    config: OptimizerConfig,
) -> Dict[str, Any]:
    """Run a single backtest with given params and return summary."""
    rows = run_tp_sl_query(
        alerts=alerts,
        slice_path=slice_path,
        is_partitioned=is_partitioned,
        interval_seconds=config.interval_seconds,
        horizon_hours=config.horizon_hours,
        tp_mult=params["tp_mult"],
        sl_mult=params["sl_mult"],
        intrabar_order=params.get("intrabar_order", "sl_first"),
        fee_bps=config.fee_bps,
        slippage_bps=config.slippage_bps,
        threads=config.threads,
        verbose=False,
    )
    return summarize_tp_sl(rows, sl_mult=params["sl_mult"], risk_per_trade=config.risk_per_trade)


def run_walk_forward_fold(
    train_from: str,
    train_to: str,
    test_from: str,
    test_to: str,
    config: OptimizerConfig,
    verbose: bool = True,
) -> WalkForwardResult:
    """
    Run a single walk-forward fold.
    
    1. Load alerts for train period
    2. Run grid search on train period
    3. Find best params by Total R
    4. Test those params on test period
    5. Compare train vs test performance
    """
    from lib.partitioner import is_hive_partitioned, is_per_token_directory
    
    fold_id = uuid.uuid4().hex[:8]
    
    if verbose:
        print(f"\n{'='*70}", file=sys.stderr)
        print(f"FOLD: Train {train_from} to {train_to} | Test {test_from} to {test_to}", file=sys.stderr)
        print(f"{'='*70}", file=sys.stderr)
    
    # Parse dates
    train_from_dt = parse_yyyy_mm_dd(train_from)
    train_to_dt = parse_yyyy_mm_dd(train_to)
    test_from_dt = parse_yyyy_mm_dd(test_from)
    test_to_dt = parse_yyyy_mm_dd(test_to)
    
    # Load all alerts (we'll filter by date)
    all_alerts = load_alerts(
        config.duckdb_path,
        config.chain,
        train_from_dt,
        test_to_dt,  # Load through end of test period
    )
    
    if not all_alerts:
        raise ValueError(f"No alerts found for {train_from} to {test_to}")
    
    # Filter by caller group if specified
    if config.caller_group:
        group = load_caller_group(config.caller_group)
        if group:
            all_alerts = [a for a in all_alerts if group.matches(a.caller)]
    elif config.caller_ids:
        caller_set = set(config.caller_ids)
        all_alerts = [a for a in all_alerts if a.caller.strip() in caller_set]
    
    # Split into train/test (Alert.ts is a datetime property)
    # parse_yyyy_mm_dd returns datetime, so compare datetime to datetime
    from datetime import timedelta
    train_end = train_to_dt + timedelta(days=1)  # Make train_to inclusive
    test_end = test_to_dt + timedelta(days=1)    # Make test_to inclusive
    train_alerts = [a for a in all_alerts if train_from_dt <= a.ts < train_end]
    test_alerts = [a for a in all_alerts if test_from_dt <= a.ts < test_end]
    
    if verbose:
        print(f"Train alerts: {len(train_alerts)}", file=sys.stderr)
        print(f"Test alerts: {len(test_alerts)}", file=sys.stderr)
    
    if not train_alerts:
        raise ValueError(f"No training alerts for {train_from} to {train_to}")
    if not test_alerts:
        raise ValueError(f"No test alerts for {test_from} to {test_to}")
    
    # Setup slice
    slice_path = Path(config.slice_path) if config.slice_path else Path(config.slice_dir)
    if not slice_path.exists():
        raise ValueError(f"Slice not found: {slice_path}")
    is_partitioned = is_hive_partitioned(slice_path) or (slice_path.is_dir() and not slice_path.suffix)
    
    # ========== TRAINING PHASE ==========
    if verbose:
        print(f"\nTraining on {len(train_alerts)} alerts...", file=sys.stderr)
    
    best_result: Optional[Tuple[Dict[str, Any], Dict[str, Any]]] = None
    best_total_r = float("-inf")
    
    # Grid search on training data
    tp_values = config.tp_sl.tp_mult.expand()
    sl_values = config.tp_sl.sl_mult.expand()
    intrabar_orders = config.tp_sl.intrabar_order
    
    total_combos = len(tp_values) * len(sl_values) * len(intrabar_orders)
    combo_idx = 0
    
    for tp_mult in tp_values:
        for sl_mult in sl_values:
            for intrabar_order in intrabar_orders:
                combo_idx += 1
                params = {"tp_mult": tp_mult, "sl_mult": sl_mult, "intrabar_order": intrabar_order}
                
                summary = run_single_backtest(train_alerts, slice_path, is_partitioned, params, config)
                total_r = summary.get("total_r", 0.0)
                
                if verbose:
                    avg_r = summary.get("avg_r", 0.0)
                    wr = summary.get("tp_sl_win_rate", 0.0) * 100
                    print(f"  [{combo_idx}/{total_combos}] TP={tp_mult:.1f}x SL={sl_mult:.1f}x | WR={wr:.0f}% AvgR={avg_r:+.2f} TotalR={total_r:+.1f}", file=sys.stderr)
                
                if total_r > best_total_r:
                    best_total_r = total_r
                    best_result = (params, summary)
    
    if best_result is None:
        raise ValueError("No valid results from training")
    
    best_params, train_summary = best_result
    
    if verbose:
        print(f"\nBest params: TP={best_params['tp_mult']:.1f}x SL={best_params['sl_mult']:.1f}x", file=sys.stderr)
        print(f"Train: WR={train_summary['tp_sl_win_rate']*100:.1f}% AvgR={train_summary['avg_r']:+.2f} TotalR={train_summary['total_r']:+.1f}", file=sys.stderr)
    
    # ========== TESTING PHASE ==========
    if verbose:
        print(f"\nTesting on {len(test_alerts)} alerts...", file=sys.stderr)
    
    test_summary = run_single_backtest(test_alerts, slice_path, is_partitioned, best_params, config)
    
    if verbose:
        print(f"Test: WR={test_summary['tp_sl_win_rate']*100:.1f}% AvgR={test_summary['avg_r']:+.2f} TotalR={test_summary['total_r']:+.1f}", file=sys.stderr)
    
    # ========== CALCULATE DELTA R (simple difference, handles negatives correctly) ==========
    train_avg_r = train_summary.get("avg_r", 0.0)
    test_avg_r = test_summary.get("avg_r", 0.0)
    train_total_r = train_summary.get("total_r", 0.0)
    test_total_r = test_summary.get("total_r", 0.0)
    
    # Delta R = Test - Train (positive means test outperformed)
    delta_avg_r = test_avg_r - train_avg_r
    delta_total_r = test_total_r - train_total_r
    
    if verbose:
        print(f"\nΔR: AvgR={delta_avg_r:+.2f} TotalR={delta_total_r:+.1f}", file=sys.stderr)
        if delta_total_r > 0:
            print("  ✓ Test outperformed train", file=sys.stderr)
        elif delta_total_r < 0 and test_total_r < 0:
            print("  ✗ Both train and test negative (bad regime)", file=sys.stderr)
        else:
            print("  ✗ Test underperformed train", file=sys.stderr)
    
    return WalkForwardResult(
        fold_id=fold_id,
        train_from=train_from,
        train_to=train_to,
        test_from=test_from,
        test_to=test_to,
        best_params=best_params,
        train_alerts=len(train_alerts),
        train_win_rate=train_summary.get("tp_sl_win_rate", 0.0),
        train_avg_r=train_avg_r,
        train_total_r=train_total_r,
        test_alerts=len(test_alerts),
        test_win_rate=test_summary.get("tp_sl_win_rate", 0.0),
        test_avg_r=test_avg_r,
        test_total_r=test_total_r,
        delta_avg_r=delta_avg_r,
        delta_total_r=delta_total_r,
    )


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Walk-Forward Validation for TP/SL Optimization",
        formatter_class=argparse.RawTextHelpFormatter
    )
    
    # Single fold mode
    ap.add_argument("--train-from", help="Train period start (YYYY-MM-DD)")
    ap.add_argument("--train-to", help="Train period end (YYYY-MM-DD)")
    ap.add_argument("--test-from", help="Test period start (YYYY-MM-DD)")
    ap.add_argument("--test-to", help="Test period end (YYYY-MM-DD)")
    
    # Rolling mode (auto-generate folds)
    ap.add_argument("--rolling", action="store_true", help="Use rolling walk-forward")
    ap.add_argument("--from", dest="date_from", help="Overall start date for rolling")
    ap.add_argument("--to", dest="date_to", help="Overall end date for rolling")
    ap.add_argument("--train-days", type=int, default=14, help="Training window in days")
    ap.add_argument("--test-days", type=int, default=7, help="Test window in days")
    ap.add_argument("--step-days", type=int, default=7, help="Step between folds in days (ignored if --non-overlapping)")
    ap.add_argument("--non-overlapping", action="store_true", 
                   help="No data reuse: step = train_days + test_days (clean validation)")
    
    # TP/SL parameters
    ap.add_argument("--tp-range", default="1.5:4.0:0.5", help="TP range as start:end:step")
    ap.add_argument("--sl-range", default="0.3:0.7:0.1", help="SL range as start:end:step")
    
    # Data sources
    ap.add_argument("--duckdb", default="data/alerts.duckdb", help="DuckDB path")
    ap.add_argument("--chain", default="solana", help="Chain name")
    ap.add_argument("--slice", dest="slice_path", default="slices/per_token", help="Slice path")
    
    # Backtest params
    ap.add_argument("--interval-seconds", type=int, default=60)
    ap.add_argument("--horizon-hours", type=int, default=48)
    ap.add_argument("--fee-bps", type=float, default=30.0)
    ap.add_argument("--slippage-bps", type=float, default=50.0)
    ap.add_argument("--risk-per-trade", type=float, default=0.02)
    ap.add_argument("--threads", type=int, default=8)
    
    # Filtering
    ap.add_argument("--caller-group", help="Filter by caller group")
    
    # Output
    ap.add_argument("--output-dir", default="results/walk_forward")
    ap.add_argument("--quiet", "-q", action="store_true")
    
    args = ap.parse_args()
    
    # Parse TP/SL ranges
    tp_start, tp_end, tp_step = map(float, args.tp_range.split(":"))
    sl_start, sl_end, sl_step = map(float, args.sl_range.split(":"))
    
    # Create config
    config = OptimizerConfig(
        name="walk_forward",
        date_from=args.train_from or args.date_from or "2025-12-01",
        date_to=args.test_to or args.date_to or "2025-12-28",
        duckdb_path=args.duckdb,
        chain=args.chain,
        slice_path=args.slice_path,
        slice_dir="slices",
        interval_seconds=args.interval_seconds,
        horizon_hours=args.horizon_hours,
        fee_bps=args.fee_bps,
        slippage_bps=args.slippage_bps,
        risk_per_trade=args.risk_per_trade,
        threads=args.threads,
        caller_group=args.caller_group,
        tp_sl=TpSlParamSpace(
            tp_mult=RangeSpec(start=tp_start, end=tp_end, step=tp_step),
            sl_mult=RangeSpec(start=sl_start, end=sl_end, step=sl_step),
        ),
    )
    
    timing = TimingContext()
    timing.start()
    
    wf_run = WalkForwardRun(config=config.to_dict())
    verbose = not args.quiet
    
    if args.rolling:
        # Generate rolling folds
        from datetime import timedelta
        
        start = parse_yyyy_mm_dd(args.date_from)
        end = parse_yyyy_mm_dd(args.date_to)
        train_days = args.train_days
        test_days = args.test_days
        
        # --anchored: train window anchored at start, test slides forward (non-overlapping tests)
        # --rolling: train window slides forward with step_days (may overlap with previous test)
        # --non-overlapping: step = train + test (no data reuse at all)
        if args.non_overlapping:
            # Each fold uses completely fresh data
            step_days = train_days + test_days
        else:
            step_days = args.step_days
        
        fold_num = 0
        current = start
        
        if verbose and args.non_overlapping:
            print(f"Mode: Non-overlapping (step={step_days} days)", file=sys.stderr)
        elif verbose:
            print(f"Mode: Rolling (step={args.step_days} days)", file=sys.stderr)
        
        while current + timedelta(days=train_days + test_days) <= end + timedelta(days=1):
            fold_num += 1
            train_from = current.strftime("%Y-%m-%d")
            train_to = (current + timedelta(days=train_days - 1)).strftime("%Y-%m-%d")
            test_from = (current + timedelta(days=train_days)).strftime("%Y-%m-%d")
            test_to = (current + timedelta(days=train_days + test_days - 1)).strftime("%Y-%m-%d")
            
            if verbose:
                print(f"\n{'#'*70}", file=sys.stderr)
                print(f"# FOLD {fold_num}", file=sys.stderr)
                print(f"{'#'*70}", file=sys.stderr)
            
            try:
                with timing.phase(f"fold_{fold_num}"):
                    fold = run_walk_forward_fold(
                        train_from, train_to, test_from, test_to,
                        config, verbose=verbose
                    )
                wf_run.add_fold(fold)
            except ValueError as e:
                print(f"Skipping fold {fold_num}: {e}", file=sys.stderr)
            
            current += timedelta(days=step_days)
    else:
        # Single fold mode
        if not all([args.train_from, args.train_to, args.test_from, args.test_to]):
            print("Error: Must specify --train-from, --train-to, --test-from, --test-to", file=sys.stderr)
            print("Or use --rolling mode with --from and --to", file=sys.stderr)
            sys.exit(1)
        
        with timing.phase("fold_1"):
            fold = run_walk_forward_fold(
                args.train_from, args.train_to, args.test_from, args.test_to,
                config, verbose=verbose
            )
        wf_run.add_fold(fold)
    
    timing.end()
    wf_run.timing = timing.to_dict()
    
    # Print summary
    print(f"\n{'='*70}", file=sys.stderr)
    print("WALK-FORWARD SUMMARY", file=sys.stderr)
    print(f"{'='*70}", file=sys.stderr)
    print(f"Folds: {len(wf_run.folds)}", file=sys.stderr)
    print(timing.summary_line(), file=sys.stderr)
    
    # ΔR = Test - Train (positive = test outperformed, negative = test underperformed)
    print(f"\n{'Fold':<6} {'Train':>10} {'Test':>10} {'Best Params':<20} {'TrainR':>8} {'TestR':>8} {'ΔR':>8} {'Status':<10}", file=sys.stderr)
    print("-" * 90, file=sys.stderr)
    
    for i, f in enumerate(wf_run.folds, 1):
        params_str = f"TP={f.best_params['tp_mult']:.1f}x SL={f.best_params['sl_mult']:.1f}x"
        
        # Status: test vs train and profitability
        if f.test_total_r > 0 and f.delta_total_r > 0:
            status = "✓ great"  # Profitable AND outperformed
        elif f.test_total_r > 0:
            status = "○ ok"     # Profitable but underperformed train
        elif f.delta_total_r > 0:
            status = "△ improved" # Lost money but less than train
        else:
            status = "✗ bad"    # Lost money and worse than train
        
        print(f"{i:<6} {f.train_from:>10} {f.test_from:>10} {params_str:<20} {f.train_total_r:>+8.1f} {f.test_total_r:>+8.1f} {f.delta_total_r:>+8.1f} {status:<10}", file=sys.stderr)
    
    print("-" * 90, file=sys.stderr)
    
    # Aggregate stats
    avg_train = sum(f.train_total_r for f in wf_run.folds) / len(wf_run.folds) if wf_run.folds else 0
    avg_test = wf_run.avg_test_total_r
    avg_delta = wf_run.avg_delta_r
    print(f"{'AVG':<6} {'':<10} {'':<10} {'':<20} {avg_train:>+8.1f} {avg_test:>+8.1f} {avg_delta:>+8.1f}", file=sys.stderr)
    
    # Summary stats
    print(f"\n  Median Test R: {wf_run.median_test_r:+.1f}", file=sys.stderr)
    print(f"  % Folds Profitable: {wf_run.pct_folds_profitable:.0f}%", file=sys.stderr)
    print(f"  Worst Fold R: {wf_run.worst_fold_r:+.1f}", file=sys.stderr)
    print(f"  Avg ΔR (test-train): {avg_delta:+.1f}", file=sys.stderr)
    
    # Save results (JSON file)
    output_path = wf_run.save(args.output_dir)
    print(f"\nResults saved to: {output_path}", file=sys.stderr)
    
    # ========== ALWAYS STORE TO DUCKDB ==========
    # This is non-negotiable - every run must be recorded for experiment tracking
    try:
        store_walk_forward_run(
            duckdb_path=args.duckdb,
            run_id=wf_run.run_id,
            name=f"walk_forward_{wf_run.created_at.strftime('%Y%m%d_%H%M%S')}",
            config=wf_run.config,
            folds=[f.to_dict() for f in wf_run.folds],
            timing=wf_run.timing,
            notes=f"tp_range={args.tp_range} sl_range={args.sl_range}",
        )
        print(f"✓ Run stored to DuckDB: {args.duckdb} (optimizer.runs_d / optimizer.walk_forward_f)", file=sys.stderr)
    except Exception as e:
        print(f"⚠️  Failed to store to DuckDB: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()

