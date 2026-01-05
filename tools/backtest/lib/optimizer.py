"""
Grid optimizer for TP/SL parameter search.

Runs backtests across parameter combinations and ranks results.
Includes timing for each phase and scoring for caller ranking.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .alerts import Alert, load_alerts
from .caller_groups import CallerGroup, load_caller_group
from .optimizer_config import OptimizerConfig
from .optimizer_objective import (
    ObjectiveConfig,
    ObjectiveComponents,
    DEFAULT_OBJECTIVE_CONFIG,
    compute_objective,
    print_objective_breakdown,
)
from .summary import summarize_tp_sl, aggregate_by_caller
from .tp_sl_query import run_tp_sl_query
from .timing import TimingContext, format_ms

UTC = timezone.utc


@dataclass
class OptimizationResult:
    """
    Result of a single parameter combination run.
    """
    params: Dict[str, Any]
    summary: Dict[str, Any]
    run_id: str
    duration_s: float
    alerts_ok: int
    alerts_total: int
    objective: Optional[ObjectiveComponents] = None  # Objective function breakdown
    
    @property
    def win_rate(self) -> float:
        return self.summary.get("tp_sl_win_rate", 0.0)
    
    @property
    def total_return_pct(self) -> float:
        return self.summary.get("tp_sl_total_return_pct", 0.0)
    
    @property
    def avg_return_pct(self) -> float:
        return self.summary.get("tp_sl_avg_return_pct", 0.0)
    
    @property
    def profit_factor(self) -> float:
        pf = self.summary.get("tp_sl_profit_factor", 0.0)
        return pf if pf != float("inf") else 999.99
    
    @property
    def expectancy_pct(self) -> float:
        return self.summary.get("tp_sl_expectancy_pct", 0.0)
    
    @property
    def risk_adj_total_return_pct(self) -> float:
        return self.summary.get("risk_adj_total_return_pct", 0.0)
    
    @property
    def total_r(self) -> float:
        return self.summary.get("total_r", 0.0)
    
    @property
    def avg_r(self) -> float:
        return self.summary.get("avg_r", 0.0)
    
    @property
    def avg_r_win(self) -> float:
        return self.summary.get("avg_r_win", 0.0)
    
    @property
    def avg_r_loss(self) -> float:
        return self.summary.get("avg_r_loss", -1.0)
    
    @property
    def r_profit_factor(self) -> float:
        pf = self.summary.get("r_profit_factor", 0.0)
        return pf if pf != float("inf") else 999.99
    
    @property
    def objective_score(self) -> float:
        """Final objective score (higher = better)."""
        if self.objective:
            return self.objective.final_score
        return self.avg_r  # Fallback to avg_r
    
    @property
    def implied_avg_loss_r(self) -> float:
        """
        Implied average loss in R.
        
        Should be close to -1R. If it drifts, stop gapping/execution issues.
        """
        return self.avg_r_loss
    
    def to_dict(self) -> Dict[str, Any]:
        d = {
            "params": self.params,
            "summary": self.summary,
            "run_id": self.run_id,
            "duration_s": self.duration_s,
            "alerts_ok": self.alerts_ok,
            "alerts_total": self.alerts_total,
        }
        if self.objective:
            d["objective"] = self.objective.to_dict()
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OptimizationResult":
        obj = None
        if "objective" in data:
            obj = ObjectiveComponents(**data["objective"])
        return cls(
            params=data["params"],
            summary=data["summary"],
            run_id=data["run_id"],
            duration_s=data["duration_s"],
            alerts_ok=data["alerts_ok"],
            alerts_total=data["alerts_total"],
            objective=obj,
        )


@dataclass
class OptimizationRun:
    """
    Complete optimization run with all results.
    """
    config: OptimizerConfig
    results: List[OptimizationResult] = field(default_factory=list)
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    completed_at: Optional[datetime] = None
    timing: Optional[Dict[str, Any]] = None  # Phase timing data
    
    @property
    def is_complete(self) -> bool:
        return self.completed_at is not None
    
    @property
    def total_duration_s(self) -> float:
        if self.completed_at is None:
            return 0.0
        return (self.completed_at - self.started_at).total_seconds()
    
    def add_result(self, result: OptimizationResult) -> None:
        self.results.append(result)
    
    def mark_complete(self) -> None:
        self.completed_at = datetime.now(UTC)
    
    def rank_by(self, metric: str = "objective_score", ascending: bool = False) -> List[OptimizationResult]:
        """
        Rank results by a metric.
        
        Args:
            metric: Metric to rank by (objective_score, profit_factor, win_rate, 
                   total_return_pct, avg_return_pct, expectancy_pct, 
                   risk_adj_total_return_pct, total_r, avg_r)
            ascending: Sort ascending (default: descending for "best first")
        
        Returns:
            Sorted list of results
        """
        def get_metric(r: OptimizationResult) -> float:
            if metric == "objective_score":
                return r.objective_score
            elif metric == "profit_factor":
                return r.profit_factor
            elif metric == "win_rate":
                return r.win_rate
            elif metric == "total_return_pct":
                return r.total_return_pct
            elif metric == "avg_return_pct":
                return r.avg_return_pct
            elif metric == "expectancy_pct":
                return r.expectancy_pct
            elif metric == "risk_adj_total_return_pct":
                return r.risk_adj_total_return_pct
            elif metric == "total_r":
                return r.total_r
            elif metric == "avg_r":
                return r.avg_r
            else:
                return r.summary.get(metric, 0.0)
        
        return sorted(self.results, key=get_metric, reverse=not ascending)
    
    def get_best(self, metric: str = "objective_score") -> Optional[OptimizationResult]:
        """Get the best result by metric."""
        ranked = self.rank_by(metric)
        return ranked[0] if ranked else None
    
    def to_dict(self) -> Dict[str, Any]:
        d = {
            "config": self.config.to_dict(),
            "results": [r.to_dict() for r in self.results],
            "run_id": self.run_id,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }
        if self.timing:
            d["timing"] = self.timing
        return d
    
    def save(self, path: Optional[str] = None) -> str:
        """
        Save run results to JSON.
        
        Args:
            path: Output path (default: {output_dir}/{run_id}_results.json)
        
        Returns:
            Path to saved file
        """
        if path is None:
            output_dir = Path(self.config.output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            path = str(output_dir / f"{self.run_id}_results.json")
        
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2, default=str)
        
        return path


class GridOptimizer:
    """
    Grid search optimizer for TP/SL parameters.
    
    Runs backtests across all parameter combinations and collects results.
    Uses the objective function to score each result for ranking.
    """
    
    def __init__(
        self,
        config: OptimizerConfig,
        objective_config: Optional[ObjectiveConfig] = None,
        verbose: bool = True,
    ):
        self.config = config
        self.objective_config = objective_config or DEFAULT_OBJECTIVE_CONFIG
        self.verbose = verbose
        self._alerts: Optional[List[Alert]] = None
        self._slice_path: Optional[Path] = None
        self._is_partitioned: bool = False
    
    def _log(self, msg: str) -> None:
        if self.verbose:
            print(msg, file=sys.stderr)
    
    def _load_alerts(self) -> List[Alert]:
        """Load and filter alerts."""
        if self._alerts is not None:
            return self._alerts
        
        from .helpers import parse_yyyy_mm_dd
        
        date_from = parse_yyyy_mm_dd(self.config.date_from)
        date_to = parse_yyyy_mm_dd(self.config.date_to)
        
        self._log(f"Loading alerts from {self.config.duckdb_path}...")
        alerts = load_alerts(
            self.config.duckdb_path,
            self.config.chain,
            date_from,
            date_to,
        )
        
        if not alerts:
            raise ValueError(f"No alerts found for {self.config.date_from} to {self.config.date_to}")
        
        self._log(f"Loaded {len(alerts)} alerts")
        
        # Filter by caller group or caller_ids
        if self.config.caller_group:
            group = load_caller_group(self.config.caller_group)
            if group is None:
                raise ValueError(f"Caller group not found: {self.config.caller_group}")
            
            filtered = [a for a in alerts if group.matches(a.caller)]
            self._log(f"Filtered to {len(filtered)} alerts for group '{self.config.caller_group}'")
            alerts = filtered
        elif self.config.caller_ids:
            caller_set = set(self.config.caller_ids)
            filtered = [a for a in alerts if a.caller.strip() in caller_set]
            self._log(f"Filtered to {len(filtered)} alerts for {len(caller_set)} callers")
            alerts = filtered
        
        if not alerts:
            raise ValueError("No alerts remaining after filtering")
        
        self._alerts = alerts
        return alerts
    
    def _ensure_slice(self, alerts: List[Alert]) -> Tuple[Path, bool]:
        """Ensure slice is available, creating if needed."""
        if self._slice_path is not None:
            return self._slice_path, self._is_partitioned
        
        from .helpers import compute_slice_fingerprint, parse_yyyy_mm_dd
        from .partitioner import is_hive_partitioned, is_per_token_directory
        
        # Use existing slice if specified
        if self.config.slice_path:
            slice_path = Path(self.config.slice_path)
            if not slice_path.exists():
                raise ValueError(f"Slice not found: {slice_path}")
            
            is_partitioned = is_hive_partitioned(slice_path) or is_per_token_directory(slice_path)
            self._slice_path = slice_path
            self._is_partitioned = is_partitioned
            self._log(f"Using existing slice: {slice_path}")
            return slice_path, is_partitioned
        
        # Check for cached slice
        mints = set(a.mint for a in alerts)
        date_from = parse_yyyy_mm_dd(self.config.date_from)
        date_to = parse_yyyy_mm_dd(self.config.date_to)
        
        fingerprint = compute_slice_fingerprint(
            mints, self.config.chain, date_from, date_to, self.config.interval_seconds
        )
        
        slice_dir = Path(self.config.slice_dir)
        slice_path = slice_dir / f"slice_{self.config.date_from.replace('-','')}_{self.config.date_to.replace('-','')}_{fingerprint}.parquet"
        
        if self.config.reuse_slice and slice_path.exists():
            is_partitioned = False
            self._slice_path = slice_path
            self._is_partitioned = is_partitioned
            self._log(f"Reusing cached slice: {slice_path}")
            return slice_path, is_partitioned
        
        # Need to create slice from ClickHouse
        self._log("Slice not found. Creating from ClickHouse...")
        self._log("(This requires clickhouse-driver and ClickHouse connection)")
        
        try:
            from clickhouse_driver import Client as ClickHouseClient
            from .slice_exporter import ClickHouseCfg, export_slice_streaming, query_coverage_batched
        except ImportError:
            raise ImportError(
                "clickhouse-driver required for slice creation. "
                "Install with: pip install clickhouse-driver\n"
                "Or provide an existing slice with --slice-path"
            )
        
        ch_cfg = ClickHouseCfg(
            host=os.getenv("CLICKHOUSE_HOST", "localhost"),
            port=int(os.getenv("CLICKHOUSE_PORT", "9000")),
            database=os.getenv("CLICKHOUSE_DATABASE", "default"),
            table=os.getenv("CLICKHOUSE_TABLE", "ohlcv_candles"),
            user=os.getenv("CLICKHOUSE_USER", "default"),
            password=os.getenv("CLICKHOUSE_PASSWORD", ""),
        )
        
        # Query coverage
        coverage = query_coverage_batched(
            ch_cfg, self.config.chain, mints, self.config.interval_seconds,
            date_from, date_to, ch_batch=1000, parallel=4
        )
        covered_mints = {m for m, cnt in coverage.items() if cnt > 0}
        
        if not covered_mints:
            raise ValueError("No tokens have candle data for this period")
        
        self._log(f"Coverage: {len(covered_mints)}/{len(mints)} tokens")
        
        # Export slice
        slice_dir.mkdir(parents=True, exist_ok=True)
        row_count = export_slice_streaming(
            ch_cfg, self.config.chain, covered_mints, self.config.interval_seconds,
            date_from, date_to, slice_path, ch_batch=1000,
            pre_window_minutes=60, post_window_hours=self.config.horizon_hours + 24,
            parallel=4, verbose=self.verbose
        )
        self._log(f"Exported {row_count:,} candles to {slice_path}")
        
        self._slice_path = slice_path
        self._is_partitioned = False
        return slice_path, False
    
    def run_single(
        self,
        params: Dict[str, Any],
        alerts: List[Alert],
        slice_path: Path,
        is_partitioned: bool,
    ) -> OptimizationResult:
        """
        Run a single backtest with given parameters.
        
        Args:
            params: Parameter dict (tp_mult, sl_mult, intrabar_order, etc.)
            alerts: Alerts to backtest
            slice_path: Path to slice
            is_partitioned: Whether slice is partitioned
        
        Returns:
            OptimizationResult
        """
        run_id = uuid.uuid4().hex[:12]
        t0 = time.time()
        
        tp_mult = params.get("tp_mult", 2.0)
        sl_mult = params.get("sl_mult", 0.5)
        intrabar_order = params.get("intrabar_order", "sl_first")
        
        rows = run_tp_sl_query(
            alerts=alerts,
            slice_path=slice_path,
            is_partitioned=is_partitioned,
            interval_seconds=self.config.interval_seconds,
            horizon_hours=self.config.horizon_hours,
            tp_mult=tp_mult,
            sl_mult=sl_mult,
            intrabar_order=intrabar_order,
            fee_bps=self.config.fee_bps,
            slippage_bps=self.config.slippage_bps,
            threads=self.config.threads,
            verbose=False,
        )
        
        summary = summarize_tp_sl(
            rows,
            sl_mult=sl_mult,
            risk_per_trade=self.config.risk_per_trade,
        )
        
        # Compute objective function
        objective = compute_objective(summary, self.objective_config)
        
        duration = time.time() - t0
        
        return OptimizationResult(
            params=params,
            summary=summary,
            run_id=run_id,
            duration_s=duration,
            alerts_ok=summary.get("alerts_ok", 0),
            alerts_total=summary.get("alerts_total", 0),
            objective=objective,
        )
    
    def run(self) -> OptimizationRun:
        """
        Run the full optimization.
        
        Returns:
            OptimizationRun with all results
        """
        if self.config.tp_sl is None:
            raise ValueError("No TP/SL parameter space configured")
        
        timing = TimingContext()
        timing.start()
        
        total_combos = self.config.count_combinations()
        self._log(f"Starting optimization: {total_combos} parameter combinations")
        self._log(f"Date range: {self.config.date_from} to {self.config.date_to}")
        
        # Load alerts
        with timing.phase("load_alerts"):
            alerts = self._load_alerts()
        
        # Ensure slice
        with timing.phase("ensure_slice"):
            slice_path, is_partitioned = self._ensure_slice(alerts)
        
        # Create run
        opt_run = OptimizationRun(config=self.config)
        
        # Run all combinations
        with timing.phase("backtest"):
            for idx, params in self.config.iter_all_params():
                self._log(f"[{idx+1}/{total_combos}] TP={params['tp_mult']:.2f}x SL={params['sl_mult']:.2f}x ...")
                
                result = self.run_single(params, alerts, slice_path, is_partitioned)
                opt_run.add_result(result)
                
                self._log(
                    f"         WR={result.win_rate*100:.1f}% "
                    f"AvgR={result.avg_r:+.2f} "
                    f"Score={result.objective_score:+.3f} "
                    f"LossR={result.implied_avg_loss_r:.2f} "
                    f"({result.duration_s:.1f}s)"
                )
        
        timing.end()
        opt_run.timing = timing.to_dict()
        opt_run.mark_complete()
        
        # Print summary
        self._log("")
        self._log("=" * 80)
        self._log("OPTIMIZATION COMPLETE")
        self._log("=" * 80)
        self._log(f"Total runs: {len(opt_run.results)}")
        self._log(timing.summary_line())
        
        # Print top 5 by OBJECTIVE SCORE (the key metric)
        self._log("")
        self._log("TOP 5 BY OBJECTIVE SCORE:")
        self._log("-" * 90)
        for i, r in enumerate(opt_run.rank_by("objective_score")[:5], 1):
            self._log(
                f"  {i}. TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                f"Score={r.objective_score:+.3f} WR={r.win_rate*100:.1f}% "
                f"AvgR={r.avg_r:+.2f} LossR={r.implied_avg_loss_r:.2f}"
            )
        
        # Print objective breakdown for the best result
        best = opt_run.get_best("objective_score")
        if best and best.objective:
            self._log("")
            self._log(f"BEST RESULT BREAKDOWN (TP={best.params['tp_mult']:.2f}x SL={best.params['sl_mult']:.2f}x):")
            self._log("-" * 50)
            print_objective_breakdown(best.objective, self.objective_config)
        
        # Print top 5 by Total R (for reference)
        self._log("")
        self._log("TOP 5 BY TOTAL R:")
        self._log("-" * 90)
        for i, r in enumerate(opt_run.rank_by("total_r")[:5], 1):
            self._log(
                f"  {i}. TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                f"TotalR={r.total_r:+.1f} AvgR={r.avg_r:+.2f} WR={r.win_rate*100:.1f}%"
            )
        
        # Print implied loss R check (catches stop gapping)
        self._log("")
        self._log("IMPLIED LOSS R CHECK (should be ~-1.0R):")
        self._log("-" * 50)
        for r in opt_run.results[:10]:
            drift = abs(r.implied_avg_loss_r - (-1.0))
            flag = "⚠️" if drift > 0.3 else "✓"
            self._log(
                f"  TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                f"LossR={r.implied_avg_loss_r:.3f} {flag}"
            )
        
        # Save results
        with timing.phase("save"):
            output_path = opt_run.save()
        self._log("")
        self._log(f"Results saved to: {output_path}")
        
        return opt_run


def run_optimization(
    config: OptimizerConfig,
    objective_config: Optional[ObjectiveConfig] = None,
    verbose: bool = True,
) -> OptimizationRun:
    """
    Run optimization with given config.
    
    Args:
        config: Optimizer configuration
        objective_config: Objective function configuration (default: DEFAULT_OBJECTIVE_CONFIG)
        verbose: Print progress
    
    Returns:
        OptimizationRun with all results
    """
    optimizer = GridOptimizer(config, objective_config=objective_config, verbose=verbose)
    return optimizer.run()

