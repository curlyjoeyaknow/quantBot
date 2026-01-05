#!/usr/bin/env python3
"""
Random Search Optimizer for TP/SL Parameters.

Samples N random parameter combinations and evaluates each.
Stores all trials to the DuckDB trial ledger for later analysis.

This is the "discovery engine" - run overnight to explore the parameter space.

Usage:
    # 200 random trials with walk-forward validation
    python3 run_random_search.py \
        --from 2025-10-01 --to 2025-12-31 \
        --trials 200 \
        --train-days 14 --test-days 7 \
        --slice slices/per_token

    # Quick test with 20 trials
    python3 run_random_search.py \
        --from 2025-12-01 --to 2025-12-24 \
        --trials 20 \
        --slice slices/per_token
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

from lib.alerts import Alert, load_alerts
from lib.caller_groups import load_caller_group
from lib.helpers import parse_yyyy_mm_dd
from lib.optimizer_objective import (
    ObjectiveConfig,
    DEFAULT_OBJECTIVE_CONFIG,
    compute_objective,
)
from lib.summary import summarize_tp_sl
from lib.timing import TimingContext, format_ms
from lib.tp_sl_query import run_tp_sl_query
from lib.trial_ledger import ensure_trial_schema, store_optimizer_run

UTC = timezone.utc


@dataclass
class RandomSearchConfig:
    """Configuration for random search."""
    # Date range
    date_from: str
    date_to: str
    
    # Number of random trials
    n_trials: int = 200
    
    # Parameter ranges (uniform sampling)
    tp_min: float = 1.5
    tp_max: float = 6.0
    sl_min: float = 0.20
    sl_max: float = 0.80
    
    # Walk-forward validation
    train_days: int = 14
    test_days: int = 7
    use_walk_forward: bool = True
    
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
    threads: int = 8
    
    # Filtering
    caller_group: Optional[str] = None
    
    # Random seed for reproducibility
    seed: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "date_from": self.date_from,
            "date_to": self.date_to,
            "n_trials": self.n_trials,
            "tp_range": [self.tp_min, self.tp_max],
            "sl_range": [self.sl_min, self.sl_max],
            "train_days": self.train_days,
            "test_days": self.test_days,
            "use_walk_forward": self.use_walk_forward,
            "interval_seconds": self.interval_seconds,
            "horizon_hours": self.horizon_hours,
            "fee_bps": self.fee_bps,
            "slippage_bps": self.slippage_bps,
            "seed": self.seed,
        }


@dataclass
class TrialResult:
    """Result of a single trial."""
    trial_id: str
    params: Dict[str, Any]
    summary: Dict[str, Any]
    objective: Dict[str, Any]
    duration_ms: int
    alerts_ok: int
    alerts_total: int
    
    # Walk-forward specific
    train_r: Optional[float] = None
    test_r: Optional[float] = None
    delta_r: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "trial_id": self.trial_id,
            "params": self.params,
            "summary": self.summary,
            "objective": self.objective,
            "duration_s": self.duration_ms / 1000,
            "alerts_ok": self.alerts_ok,
            "alerts_total": self.alerts_total,
            "train_r": self.train_r,
            "test_r": self.test_r,
            "delta_r": self.delta_r,
        }


def sample_params(config: RandomSearchConfig, rng: random.Random) -> Dict[str, Any]:
    """Sample random parameters."""
    return {
        "tp_mult": round(rng.uniform(config.tp_min, config.tp_max), 2),
        "sl_mult": round(rng.uniform(config.sl_min, config.sl_max), 2),
        "intrabar_order": rng.choice(["sl_first", "tp_first"]),
    }


def run_single_backtest(
    alerts: List[Alert],
    slice_path: Path,
    is_partitioned: bool,
    params: Dict[str, Any],
    config: RandomSearchConfig,
) -> Dict[str, Any]:
    """Run a single backtest with given params."""
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


def run_random_search(config: RandomSearchConfig, verbose: bool = True) -> List[TrialResult]:
    """
    Run random search optimization.
    
    If use_walk_forward=True, each trial is evaluated on out-of-sample data.
    """
    from lib.partitioner import is_hive_partitioned, is_per_token_directory
    
    timing = TimingContext()
    timing.start()
    
    # Set random seed
    rng = random.Random(config.seed)
    if config.seed:
        print(f"Random seed: {config.seed}", file=sys.stderr)
    
    # Parse dates
    date_from = parse_yyyy_mm_dd(config.date_from)
    date_to = parse_yyyy_mm_dd(config.date_to)
    
    # Load alerts
    with timing.phase("load_alerts"):
        all_alerts = load_alerts(config.duckdb_path, config.chain, date_from, date_to)
        if not all_alerts:
            raise ValueError(f"No alerts found for {config.date_from} to {config.date_to}")
        
        # Filter by caller group
        if config.caller_group:
            group = load_caller_group(config.caller_group)
            if group:
                all_alerts = [a for a in all_alerts if group.matches(a.caller)]
        
        if verbose:
            print(f"Loaded {len(all_alerts)} alerts", file=sys.stderr)
    
    # Setup slice
    slice_path = Path(config.slice_path)
    if not slice_path.exists():
        raise ValueError(f"Slice not found: {slice_path}")
    is_partitioned = is_hive_partitioned(slice_path) or (slice_path.is_dir() and not slice_path.suffix)
    
    # Split into train/test if walk-forward
    if config.use_walk_forward:
        train_end = date_to - timedelta(days=config.test_days)
        train_alerts = [a for a in all_alerts if a.ts < train_end]
        test_alerts = [a for a in all_alerts if a.ts >= train_end]
        
        if verbose:
            print(f"Walk-forward split: {len(train_alerts)} train, {len(test_alerts)} test", file=sys.stderr)
        
        if len(train_alerts) < 10:
            raise ValueError("Not enough training alerts")
        if len(test_alerts) < 5:
            raise ValueError("Not enough test alerts")
    else:
        train_alerts = all_alerts
        test_alerts = []
    
    # Generate random parameter samples
    param_samples = [sample_params(config, rng) for _ in range(config.n_trials)]
    
    if verbose:
        print(f"\nRunning {config.n_trials} random trials...", file=sys.stderr)
        print(f"TP range: [{config.tp_min}, {config.tp_max}]", file=sys.stderr)
        print(f"SL range: [{config.sl_min}, {config.sl_max}]", file=sys.stderr)
        print()
    
    # Run trials
    results: List[TrialResult] = []
    
    with timing.phase("trials"):
        for i, params in enumerate(param_samples, 1):
            trial_id = uuid.uuid4().hex[:8]
            trial_timing = TimingContext()
            trial_timing.start()
            
            # Run on training data
            train_summary = run_single_backtest(
                train_alerts, slice_path, is_partitioned, params, config
            )
            train_r = train_summary.get("total_r", 0.0)
            
            # Run on test data if walk-forward
            test_r = None
            delta_r = None
            if config.use_walk_forward and test_alerts:
                test_summary = run_single_backtest(
                    test_alerts, slice_path, is_partitioned, params, config
                )
                test_r = test_summary.get("total_r", 0.0)
                delta_r = test_r - train_r
                
                # Use test performance for final summary
                final_summary = test_summary
            else:
                final_summary = train_summary
            
            # Compute objective
            obj = compute_objective(final_summary, DEFAULT_OBJECTIVE_CONFIG)
            
            trial_timing.end()
            
            result = TrialResult(
                trial_id=trial_id,
                params=params,
                summary=final_summary,
                objective=obj.to_dict(),
                duration_ms=trial_timing.total_ms,
                alerts_ok=final_summary.get("alerts_ok", 0),
                alerts_total=len(train_alerts) if not config.use_walk_forward else len(test_alerts),
                train_r=train_r,
                test_r=test_r,
                delta_r=delta_r,
            )
            results.append(result)
            
            if verbose:
                wr = final_summary.get("tp_sl_win_rate", 0.0) * 100
                avg_r = final_summary.get("avg_r", 0.0)
                score = obj.final_score
                
                if config.use_walk_forward:
                    print(
                        f"[{i:3d}/{config.n_trials}] "
                        f"TP={params['tp_mult']:.2f}x SL={params['sl_mult']:.2f}x | "
                        f"TrainR={train_r:+.1f} TestR={test_r:+.1f} ΔR={delta_r:+.1f} "
                        f"Score={score:+.3f}",
                        file=sys.stderr
                    )
                else:
                    print(
                        f"[{i:3d}/{config.n_trials}] "
                        f"TP={params['tp_mult']:.2f}x SL={params['sl_mult']:.2f}x | "
                        f"WR={wr:.0f}% AvgR={avg_r:+.2f} Score={score:+.3f}",
                        file=sys.stderr
                    )
    
    timing.end()
    
    # Print summary
    if verbose:
        print(f"\n{'='*70}", file=sys.stderr)
        print("RANDOM SEARCH COMPLETE", file=sys.stderr)
        print(f"{'='*70}", file=sys.stderr)
        print(timing.summary_line(), file=sys.stderr)
        
        # Sort by objective score
        sorted_results = sorted(results, key=lambda r: r.objective.get("final_score", 0), reverse=True)
        
        print(f"\nTOP 10 BY OBJECTIVE SCORE:", file=sys.stderr)
        print("-" * 80, file=sys.stderr)
        for i, r in enumerate(sorted_results[:10], 1):
            score = r.objective.get("final_score", 0)
            if config.use_walk_forward:
                print(
                    f"  {i:2d}. TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                    f"TestR={r.test_r:+.1f} ΔR={r.delta_r:+.1f} Score={score:+.3f}",
                    file=sys.stderr
                )
            else:
                avg_r = r.summary.get("avg_r", 0.0)
                wr = r.summary.get("tp_sl_win_rate", 0.0) * 100
                print(
                    f"  {i:2d}. TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                    f"WR={wr:.0f}% AvgR={avg_r:+.2f} Score={score:+.3f}",
                    file=sys.stderr
                )
        
        # Walk-forward summary
        if config.use_walk_forward:
            test_rs = [r.test_r for r in results if r.test_r is not None]
            delta_rs = [r.delta_r for r in results if r.delta_r is not None]
            
            avg_test_r = sum(test_rs) / len(test_rs) if test_rs else 0
            avg_delta_r = sum(delta_rs) / len(delta_rs) if delta_rs else 0
            pct_profitable = sum(1 for r in test_rs if r > 0) / len(test_rs) * 100 if test_rs else 0
            
            print(f"\nWALK-FORWARD SUMMARY:", file=sys.stderr)
            print(f"  Avg Test R: {avg_test_r:+.2f}", file=sys.stderr)
            print(f"  Avg ΔR (test-train): {avg_delta_r:+.2f}", file=sys.stderr)
            print(f"  % Profitable (test): {pct_profitable:.0f}%", file=sys.stderr)
    
    return results


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Random Search Optimizer with Walk-Forward Validation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    
    # Required
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")
    
    # Trials
    ap.add_argument("--trials", type=int, default=200, help="Number of random trials (default: 200)")
    ap.add_argument("--seed", type=int, help="Random seed for reproducibility")
    
    # Parameter ranges
    ap.add_argument("--tp-min", type=float, default=1.5, help="Min TP multiplier")
    ap.add_argument("--tp-max", type=float, default=6.0, help="Max TP multiplier")
    ap.add_argument("--sl-min", type=float, default=0.20, help="Min SL multiplier")
    ap.add_argument("--sl-max", type=float, default=0.80, help="Max SL multiplier")
    
    # Walk-forward
    ap.add_argument("--train-days", type=int, default=14, help="Training window days")
    ap.add_argument("--test-days", type=int, default=7, help="Test window days")
    ap.add_argument("--no-walk-forward", action="store_true", help="Disable walk-forward validation")
    
    # Data sources
    ap.add_argument("--duckdb", default="data/alerts.duckdb", help="DuckDB path")
    ap.add_argument("--chain", default="solana", help="Chain name")
    ap.add_argument("--slice", dest="slice_path", default="slices/per_token", help="Slice path")
    
    # Backtest params
    ap.add_argument("--interval-seconds", type=int, default=60)
    ap.add_argument("--horizon-hours", type=int, default=48)
    ap.add_argument("--fee-bps", type=float, default=30.0)
    ap.add_argument("--slippage-bps", type=float, default=50.0)
    ap.add_argument("--threads", type=int, default=8)
    
    # Filtering
    ap.add_argument("--caller-group", help="Filter by caller group")
    
    # Output
    ap.add_argument("--output-dir", default="results/random_search")
    ap.add_argument("--json", action="store_true", help="Output JSON")
    ap.add_argument("--quiet", "-q", action="store_true")
    
    args = ap.parse_args()
    
    config = RandomSearchConfig(
        date_from=args.date_from,
        date_to=args.date_to,
        n_trials=args.trials,
        tp_min=args.tp_min,
        tp_max=args.tp_max,
        sl_min=args.sl_min,
        sl_max=args.sl_max,
        train_days=args.train_days,
        test_days=args.test_days,
        use_walk_forward=not args.no_walk_forward,
        duckdb_path=args.duckdb,
        chain=args.chain,
        slice_path=args.slice_path,
        interval_seconds=args.interval_seconds,
        horizon_hours=args.horizon_hours,
        fee_bps=args.fee_bps,
        slippage_bps=args.slippage_bps,
        threads=args.threads,
        caller_group=args.caller_group,
        seed=args.seed,
    )
    
    # Run
    run_id = uuid.uuid4().hex[:12]
    results = run_random_search(config, verbose=not args.quiet)
    
    # Save results
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{run_id}_random_search.json"
    
    output_data = {
        "run_id": run_id,
        "config": config.to_dict(),
        "results": [r.to_dict() for r in results],
        "created_at": datetime.now(UTC).isoformat(),
    }
    
    with open(output_path, "w") as f:
        json.dump(output_data, f, indent=2, default=str)
    
    print(f"\nResults saved to: {output_path}", file=sys.stderr)
    
    # Store to DuckDB
    try:
        store_optimizer_run(
            duckdb_path=config.duckdb_path,
            run_id=run_id,
            run_type="random_search",
            name=f"random_{args.trials}_{config.date_from}_{config.date_to}",
            date_from=config.date_from,
            date_to=config.date_to,
            config=config.to_dict(),
            results=[r.to_dict() for r in results],
            timing=None,
            notes=f"trials={args.trials} tp=[{config.tp_min},{config.tp_max}] sl=[{config.sl_min},{config.sl_max}]",
        )
        print(f"✓ Run stored to DuckDB: {config.duckdb_path}", file=sys.stderr)
    except Exception as e:
        print(f"⚠️  Failed to store to DuckDB: {e}", file=sys.stderr)
    
    if args.json:
        print(json.dumps(output_data, indent=2, default=str))


if __name__ == "__main__":
    main()

