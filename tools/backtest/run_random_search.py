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
from lib.extended_exits import run_extended_exit_query, ExitConfig
from lib.trial_ledger import (
    ensure_trial_schema,
    store_optimizer_run,
    # Pipeline phases (audit trail + resume)
    store_phase_start,
    store_phase_complete,
    store_phase_failed,
    get_phase_status,
    get_resumable_run_state,
    print_run_state,
    # Islands storage
    store_islands,
    load_islands,
    # Champions storage
    store_island_champions,
    load_island_champions,
    # Stress lane validation storage
    store_stress_lane_result,
    get_completed_lanes_for_champion,
    load_stress_lane_results,
    # Champion validation storage
    store_champion_validation,
    load_champion_validations,
    get_maximin_winner,
)
from lib.robust_region_finder import (
    FoldResult,
    RobustObjectiveConfig,
    DEFAULT_ROBUST_CONFIG,
    compute_robust_objective,
    cluster_parameters,
    print_islands,
    DDPenaltyConfig,
    StressConfig,
    extract_island_champions,
    print_island_champions,
    IslandChampion,
)
from lib.stress_lanes import (
    StressLane,
    get_stress_lanes,
    compute_lane_scores,
    ChampionValidationResult,
    print_lane_matrix,
)
from lib.run_mode import (
    ModeType,
    LanePack,
    RunMode,
    create_mode,
    print_mode_summary,
)

UTC = timezone.utc

# ============================================================================
# ANTI-OVERFIT GUARDRAILS
# ============================================================================
# These are THE KEY to not selecting "train-window jackpot exposure"

# λ for pessimistic OOS: pess = TestR - λ * |TrainR - TestR|
# λ=0.15 means: if you overfit by 100R, you lose 15R from your score
PESSIMISTIC_LAMBDA = 0.15

# Ratio penalty thresholds (TestR / TrainR)
# Below 0.10 = smash it, 0.10-0.40 = moderate, >0.40 = little penalty
RATIO_PENALTY_SEVERE = 0.10
RATIO_PENALTY_MODERATE = 0.40

# Feasibility gates (hard requirements for "tradeable")
# These can be tuned based on your risk tolerance
GATE_MAX_P75_DD = 0.60        # p75_dd_pre2x must be <= 60%
GATE_MAX_MEDIAN_DD = 0.35     # median_dd_pre2x must be <= 35% for "preferred"
GATE_MIN_HIT2X = 0.35         # hit2x_pct >= 35% (relaxed from 50% - adjust based on data)
GATE_MAX_T2X_MIN = 120.0      # median_t2x <= 120 minutes (optional)


def compute_anti_overfit_metrics(
    train_r: float,
    test_r: float,
    median_dd_pre2x: Optional[float],
    p75_dd_pre2x: Optional[float],
    hit2x_pct: Optional[float],
    median_t2x_min: Optional[float],
    lamb: float = PESSIMISTIC_LAMBDA,
) -> Dict[str, Any]:
    """
    Compute anti-overfit metrics that prevent selecting train-window jackpots.
    
    Returns:
        ratio: TestR / TrainR (scale-free generalization measure)
        pessimistic_r: TestR - λ * |TrainR - TestR| (penalizes large gaps)
        passes_gates: True if setup is tradeable
        gate_failures: List of which gates failed
    """
    # Ratio: TestR / TrainR (avoid div by zero)
    eps = 1e-6
    if train_r > eps:
        ratio = test_r / train_r
    elif train_r < -eps:
        # Negative train_r: if test is also negative, ratio is positive (both bad)
        ratio = test_r / train_r  
    else:
        # train_r ≈ 0
        ratio = 1.0 if abs(test_r) < eps else (10.0 if test_r > 0 else -10.0)
    
    # Clamp ratio to reasonable range for display
    ratio = max(-10.0, min(10.0, ratio))
    
    # Pessimistic OOS: TestR - λ * |TrainR - TestR|
    gap = abs(train_r - test_r)
    pessimistic_r = test_r - lamb * gap
    
    # Feasibility gates
    gate_failures = []
    
    # Hard gate: p75_dd_pre2x must be <= 60%
    if p75_dd_pre2x is not None and p75_dd_pre2x > GATE_MAX_P75_DD:
        gate_failures.append(f"p75_dd={p75_dd_pre2x:.0%}>{GATE_MAX_P75_DD:.0%}")
    
    # Preferred: median_dd_pre2x <= 30%
    if median_dd_pre2x is not None and median_dd_pre2x > GATE_MAX_MEDIAN_DD:
        gate_failures.append(f"med_dd={median_dd_pre2x:.0%}>{GATE_MAX_MEDIAN_DD:.0%}")
    
    # Preferred: hit2x_pct >= 50%
    if hit2x_pct is not None and hit2x_pct < GATE_MIN_HIT2X:
        gate_failures.append(f"hit2x={hit2x_pct:.0%}<{GATE_MIN_HIT2X:.0%}")
    
    passes_gates = len(gate_failures) == 0
    
    return {
        "ratio": ratio,
        "pessimistic_r": pessimistic_r,
        "passes_gates": passes_gates,
        "gate_failures": gate_failures,
    }


def compute_robust_score(
    test_r: float,
    pessimistic_r: float,
    ratio: float,
    objective_score: float,
    passes_gates: bool,
) -> float:
    """
    Compute a robust score that can't be gamed by train-window overfitting.
    
    The robust score is pessimistic_r with a ratio penalty.
    Setups that fail gates get a severe penalty.
    """
    # Start with pessimistic R
    score = pessimistic_r
    
    # Ratio penalty (scale-free)
    if ratio < RATIO_PENALTY_SEVERE:
        # Severe: test is <10% of train - smash it
        score *= 0.3
    elif ratio < RATIO_PENALTY_MODERATE:
        # Moderate: test is 10-40% of train
        penalty = 1.0 - (RATIO_PENALTY_MODERATE - ratio) / (RATIO_PENALTY_MODERATE - RATIO_PENALTY_SEVERE) * 0.5
        score *= penalty
    # else: ratio >= 0.40, no penalty
    
    # Gate failure penalty
    if not passes_gates:
        score -= 50.0  # Heavy penalty for untradeable setups
    
    return score


@dataclass
class RandomSearchConfig:
    """Configuration for random search."""
    # Date range
    date_from: str
    date_to: str
    
    # Number of random trials
    n_trials: int = 200
    
    # Parameter ranges (uniform sampling) - TIGHTENED DEFAULTS
    # Wider ranges = more overfitting; start conservative
    tp_min: float = 1.5
    tp_max: float = 3.5   # Was 6.0 - too wide leads to overfitting
    sl_min: float = 0.30  # Was 0.20 - very tight stops = noise
    sl_max: float = 0.60  # Was 0.80 - very wide stops = poor R-multiple
    
    # Walk-forward validation
    train_days: int = 14
    test_days: int = 7
    use_walk_forward: bool = True
    
    # Multi-fold walk-forward (rolling windows)
    # If n_folds > 1, uses rolling train/test windows
    n_folds: int = 1      # 1 = single split, >1 = rolling folds
    fold_step_days: int = 7  # Days to step forward between folds
    
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
    caller: Optional[str] = None  # Single caller filter
    mcap_min_usd: Optional[float] = None  # Minimum market cap filter (USD)
    mcap_max_usd: Optional[float] = None  # Maximum market cap filter (USD)
    
    # Random seed for reproducibility
    seed: Optional[int] = None
    
    # Extended exits (optional)
    use_extended_exits: bool = False
    use_tiered_sl: bool = False
    use_delayed_entry: bool = False
    
    # ==========================================================================
    # ROBUST MODE (new region finder)
    # ==========================================================================
    use_robust_mode: bool = False     # Enable robust region finder
    top_n_candidates: int = 30        # Top N candidates to output/cluster
    n_clusters: int = 3               # Number of parameter islands (2-4)
    
    # DD penalty config (gentle at 30%, brutal at 60%)
    dd_gentle_threshold: float = 0.30
    dd_brutal_threshold: float = 0.60
    
    # Stress lane config (legacy single-lane mode)
    stress_slippage_mult: float = 2.0   # 2x slippage
    stress_stop_gap_prob: float = 0.15  # 15% stop gap probability
    
    # ==========================================================================
    # TWO-PASS VALIDATION (island champions + stress lanes)
    # ==========================================================================
    validate_champions: bool = False  # Run full stress lane validation on island champions
    stress_lanes_preset: str = "full" # Stress lane preset: "basic", "full", "extended"
    
    # ==========================================================================
    # RESUME & AUDIT TRAIL
    # ==========================================================================
    resume_run_id: Optional[str] = None  # Resume a previous run from last completed phase
    run_id: Optional[str] = None         # Explicit run ID (for deterministic naming)
    
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
            "n_folds": self.n_folds,
            "fold_step_days": self.fold_step_days,
            "interval_seconds": self.interval_seconds,
            "horizon_hours": self.horizon_hours,
            "fee_bps": self.fee_bps,
            "slippage_bps": self.slippage_bps,
            "caller_group": self.caller_group,
            "caller": self.caller,
            "mcap_min_usd": self.mcap_min_usd,
            "mcap_max_usd": self.mcap_max_usd,
            "seed": self.seed,
            "use_extended_exits": self.use_extended_exits,
            "use_tiered_sl": self.use_tiered_sl,
            "use_delayed_entry": self.use_delayed_entry,
            # Robust mode
            "use_robust_mode": self.use_robust_mode,
            "top_n_candidates": self.top_n_candidates,
            "n_clusters": self.n_clusters,
            "dd_gentle_threshold": self.dd_gentle_threshold,
            "dd_brutal_threshold": self.dd_brutal_threshold,
            "stress_slippage_mult": self.stress_slippage_mult,
            "stress_stop_gap_prob": self.stress_stop_gap_prob,
            # Two-pass validation
            "validate_champions": self.validate_champions,
            "stress_lanes_preset": self.stress_lanes_preset,
            # Resume
            "resume_run_id": self.resume_run_id,
            "run_id": self.run_id,
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
    
    # Anti-overfit metrics (THE KEY)
    ratio: Optional[float] = None           # TestR / TrainR (scale-free)
    pessimistic_r: Optional[float] = None   # TestR - λ * |TrainR - TestR|
    
    # Feasibility gates
    median_dd_pre2x: Optional[float] = None
    p75_dd_pre2x: Optional[float] = None
    hit2x_pct: Optional[float] = None
    median_t2x_min: Optional[float] = None
    passes_gates: bool = False              # True if tradeable
    
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
            "ratio": self.ratio,
            "pessimistic_r": self.pessimistic_r,
            "median_dd_pre2x": self.median_dd_pre2x,
            "p75_dd_pre2x": self.p75_dd_pre2x,
            "hit2x_pct": self.hit2x_pct,
            "median_t2x_min": self.median_t2x_min,
            "passes_gates": self.passes_gates,
        }


def sample_params(config: RandomSearchConfig, rng: random.Random) -> Dict[str, Any]:
    """Sample random parameters."""
    params = {
        "tp_mult": round(rng.uniform(config.tp_min, config.tp_max), 2),
        "sl_mult": round(rng.uniform(config.sl_min, config.sl_max), 2),
        "intrabar_order": rng.choice(["sl_first", "tp_first"]),
    }
    
    # Extended exits (always available, but sampled probabilistically)
    # Time stop (50% chance)
    if config.use_extended_exits and rng.random() < 0.5:
        params["time_stop_hours"] = rng.choice([6, 12, 24, 36, 48])
    
    # Breakeven move (40% chance)
    if config.use_extended_exits and rng.random() < 0.4:
        params["breakeven_trigger_pct"] = round(rng.uniform(0.15, 0.40), 2)
        params["breakeven_offset_pct"] = round(rng.uniform(0.0, 0.02), 3)
    
    # Trailing stop (40% chance, always available in robust mode)
    if (config.use_extended_exits or config.use_robust_mode) and rng.random() < 0.4:
        params["trail_activation_pct"] = round(rng.uniform(0.30, 0.80), 2)
        params["trail_distance_pct"] = round(rng.uniform(0.10, 0.25), 2)
    
    # Tiered stop loss
    if config.use_tiered_sl:
        # Randomly enable some tiers (each tier 50% chance)
        if rng.random() < 0.5:
            params["tier_1_2x_sl"] = round(rng.uniform(0.92, 1.05), 2)  # -8% to +5% from entry
        if rng.random() < 0.5:
            params["tier_1_5x_sl"] = round(rng.uniform(1.05, 1.25), 2)  # +5% to +25%
        if rng.random() < 0.6:
            params["tier_2x_sl"] = round(rng.uniform(1.20, 1.60), 2)   # +20% to +60%
        if rng.random() < 0.4:
            params["tier_3x_sl"] = round(rng.uniform(1.60, 2.20), 2)   # +60% to +120%
        if rng.random() < 0.3:
            params["tier_4x_sl"] = round(rng.uniform(2.00, 3.00), 2)   # +100% to +200%
    
    # Delayed entry (always available in robust mode, or via flag)
    if config.use_delayed_entry or config.use_robust_mode:
        if rng.random() < 0.5:  # 50% chance of using delayed entry
            params["entry_mode"] = rng.choice(["immediate", "wait_dip", "wait_confirm"])
            if params["entry_mode"] == "wait_dip":
                params["dip_pct"] = round(rng.uniform(0.02, 0.10), 2)
                params["max_wait_candles"] = rng.choice([5, 10, 15, 30, 60])
            elif params["entry_mode"] == "wait_confirm":
                params["confirm_candles"] = rng.choice([1, 2, 3])
                params["max_wait_candles"] = rng.choice([5, 10, 15, 30])
        else:
            params["entry_mode"] = "immediate"
    
    # Re-entry (sampling for future integration)
    if config.use_robust_mode and rng.random() < 0.3:  # 30% chance
        params["reentry_enabled"] = True
        params["max_reentries"] = rng.choice([1, 2, 3])
        params["reentry_cooldown_candles"] = rng.choice([5, 10, 15, 30])
        params["reentry_on_sl"] = rng.choice([True, False])
        # Re-entry trigger: after TP, re-enter if price pulls back by X%
        params["reentry_pullback_pct"] = round(rng.uniform(0.10, 0.30), 2)
    else:
        params["reentry_enabled"] = False
    
    return params


def run_single_backtest(
    alerts: List[Alert],
    slice_path: Path,
    is_partitioned: bool,
    params: Dict[str, Any],
    config: RandomSearchConfig,
) -> Dict[str, Any]:
    """Run a single backtest with given params."""
    # Check if we need extended exits
    has_extended = any(
        k in params for k in [
            "time_stop_hours", "breakeven_trigger_pct", "trail_activation_pct",
            "tier_1_2x_sl", "tier_1_5x_sl", "tier_2x_sl", "tier_3x_sl", "tier_4x_sl",
            "entry_mode", "dip_pct", "confirm_candles", "reentry_enabled"
        ]
    )
    
    if has_extended:
        # Use extended exit query
        # Check if tiered SL is enabled (any tier set)
        has_tiered = any(params.get(k) for k in [
            "tier_1_2x_sl", "tier_1_5x_sl", "tier_2x_sl", 
            "tier_3x_sl", "tier_4x_sl", "tier_5x_sl"
        ])
        exit_config = ExitConfig(
            tp_mult=params["tp_mult"],
            sl_mult=params["sl_mult"],
            intrabar_order=params.get("intrabar_order", "sl_first"),
            time_stop_hours=params.get("time_stop_hours"),
            breakeven_trigger_pct=params.get("breakeven_trigger_pct"),
            breakeven_offset_pct=params.get("breakeven_offset_pct", 0.0),
            trail_activation_pct=params.get("trail_activation_pct"),
            trail_distance_pct=params.get("trail_distance_pct", 0.15),
            tiered_sl_enabled=has_tiered,
            tier_1_2x_sl=params.get("tier_1_2x_sl"),
            tier_1_5x_sl=params.get("tier_1_5x_sl"),
            tier_2x_sl=params.get("tier_2x_sl"),
            tier_3x_sl=params.get("tier_3x_sl"),
            tier_4x_sl=params.get("tier_4x_sl"),
            tier_5x_sl=params.get("tier_5x_sl"),
            entry_mode=params.get("entry_mode", "immediate"),
            dip_percent=params.get("dip_pct"),
            max_wait_candles=params.get("max_wait_candles"),
            fee_bps=config.fee_bps,
            slippage_bps=config.slippage_bps,
        )
        rows = run_extended_exit_query(
            alerts=alerts,
            slice_path=slice_path,
            exit_config=exit_config,
            interval_seconds=config.interval_seconds,
            horizon_hours=config.horizon_hours,
            threads=config.threads,
            verbose=False,
        )
    else:
        # Use basic TP/SL query
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


def run_random_search(
    config: RandomSearchConfig,
    run_id: Optional[str] = None,
    verbose: bool = True,
) -> List[TrialResult]:
    """
    Run random search optimization with audit trail through DuckDB.
    
    If use_walk_forward=True, each trial is evaluated on out-of-sample data.
    
    Pipeline phases (all tracked in DuckDB for audit trail + resume):
      1. discovery     - Random search sampling
      2. clustering    - Parameter island formation
      3. champion_selection - Pick one champion per island
      4. stress_validation - Run stress lane matrix on champions
      5. final_selection - Select maximin winner
    """
    import uuid as uuid_mod
    run_id = run_id or uuid_mod.uuid4().hex[:12]
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
        
        # Filter by caller or caller group
        filter_desc = None
        if config.caller:
            # Single caller filter (exact match, case-insensitive)
            caller_lower = config.caller.lower()
            all_alerts = [a for a in all_alerts if a.caller.lower() == caller_lower]
            filter_desc = f"caller={config.caller}"
        elif config.caller_group:
            group = load_caller_group(config.caller_group)
            if group:
                all_alerts = [a for a in all_alerts if group.matches(a.caller)]
                filter_desc = f"caller_group={config.caller_group}"
        
        # Filter by market cap if specified
        if config.mcap_min_usd is not None or config.mcap_max_usd is not None:
            filtered_alerts = []
            skipped_no_mcap = 0
            for a in all_alerts:
                # Skip alerts without market cap data if filtering is requested
                if a.mcap_usd is None:
                    skipped_no_mcap += 1
                    continue
                
                # Apply min/max filters
                if config.mcap_min_usd is not None and a.mcap_usd < config.mcap_min_usd:
                    continue
                if config.mcap_max_usd is not None and a.mcap_usd > config.mcap_max_usd:
                    continue
                
                filtered_alerts.append(a)
            
            all_alerts = filtered_alerts
            if filter_desc:
                filter_desc += f", mcap=[{config.mcap_min_usd or 0:.0f}, {config.mcap_max_usd or float('inf'):.0f}]"
            else:
                filter_desc = f"mcap=[{config.mcap_min_usd or 0:.0f}, {config.mcap_max_usd or float('inf'):.0f}]"
            
            if skipped_no_mcap > 0 and verbose:
                print(f"  (Skipped {skipped_no_mcap} alerts without market cap data)", file=sys.stderr)
        
        if verbose:
            if filter_desc:
                print(f"Loaded {len(all_alerts)} alerts (filtered by {filter_desc})", file=sys.stderr)
            else:
                print(f"Loaded {len(all_alerts)} alerts", file=sys.stderr)
    
    # Setup slice
    slice_path = Path(config.slice_path)
    if not slice_path.exists():
        raise ValueError(f"Slice not found: {slice_path}")
    is_partitioned = is_hive_partitioned(slice_path) or (slice_path.is_dir() and not slice_path.suffix)
    
    # Generate walk-forward folds
    folds: List[Tuple[List[Alert], List[Alert], str]] = []  # (train, test, fold_name)
    
    if config.use_walk_forward:
        if config.n_folds > 1:
            # Multi-fold rolling walk-forward
            # Generates overlapping train/test windows
            total_days = (date_to - date_from).days
            window_days = config.train_days + config.test_days
            
            if window_days > total_days:
                raise ValueError(f"train_days + test_days ({window_days}) > total_days ({total_days})")
            
            fold_idx = 0
            fold_start = date_from
            
            while fold_start + timedelta(days=window_days) <= date_to and fold_idx < config.n_folds:
                fold_train_end = fold_start + timedelta(days=config.train_days)
                fold_test_end = fold_train_end + timedelta(days=config.test_days)
                
                train_alerts = [a for a in all_alerts if fold_start <= a.ts < fold_train_end]
                test_alerts = [a for a in all_alerts if fold_train_end <= a.ts < fold_test_end]
                
                if len(train_alerts) >= 10 and len(test_alerts) >= 5:
                    fold_name = f"fold_{fold_idx+1}_{fold_start.strftime('%m%d')}_{fold_test_end.strftime('%m%d')}"
                    folds.append((train_alerts, test_alerts, fold_name))
                
                fold_start += timedelta(days=config.fold_step_days)
                fold_idx += 1
            
            if not folds:
                raise ValueError("No valid folds generated - check date range and fold settings")
            
            if verbose:
                print(f"Multi-fold walk-forward: {len(folds)} folds", file=sys.stderr)
                for train_a, test_a, name in folds:
                    print(f"  {name}: {len(train_a)} train, {len(test_a)} test", file=sys.stderr)
        else:
            # Single train/test split (original behavior)
            train_end = date_to - timedelta(days=config.test_days)
            train_alerts = [a for a in all_alerts if a.ts < train_end]
            test_alerts = [a for a in all_alerts if a.ts >= train_end]
            
            if verbose:
                print(f"Walk-forward split: {len(train_alerts)} train, {len(test_alerts)} test", file=sys.stderr)
            
            if len(train_alerts) < 10:
                raise ValueError("Not enough training alerts")
            if len(test_alerts) < 5:
                raise ValueError("Not enough test alerts")
            
            folds.append((train_alerts, test_alerts, "single"))
    else:
        # No walk-forward - use all alerts
        folds.append((all_alerts, [], "no_wf"))
    
    # Generate random parameter samples
    param_samples = [sample_params(config, rng) for _ in range(config.n_trials)]
    
    if verbose:
        print(f"\nRunning {config.n_trials} random trials...", file=sys.stderr)
        print(f"TP range: [{config.tp_min}, {config.tp_max}]", file=sys.stderr)
        print(f"SL range: [{config.sl_min}, {config.sl_max}]", file=sys.stderr)
        if len(folds) > 1:
            print(f"Multi-fold: averaging across {len(folds)} folds", file=sys.stderr)
        print()
    
    # Build robust config if in robust mode
    robust_config = None
    if config.use_robust_mode:
        robust_config = RobustObjectiveConfig(
            dd_penalty_config=DDPenaltyConfig(
                gentle_threshold=config.dd_gentle_threshold,
                brutal_threshold=config.dd_brutal_threshold,
            ),
            stress_config=StressConfig(
                slippage_mult=config.stress_slippage_mult,
                stop_gap_prob=config.stress_stop_gap_prob,
            ),
        )
        if verbose:
            print(f"ROBUST MODE enabled:", file=sys.stderr)
            print(f"  DD penalty: gentle at {config.dd_gentle_threshold:.0%}, brutal at {config.dd_brutal_threshold:.0%}", file=sys.stderr)
            print(f"  Stress lane: slippage x{config.stress_slippage_mult:.1f}, stop gap {config.stress_stop_gap_prob:.0%}", file=sys.stderr)
            print(f"  Output: top {config.top_n_candidates} candidates, {config.n_clusters} parameter islands", file=sys.stderr)
            print()
    
    # ========================================================================
    # PHASE 1: DISCOVERY (random search sampling)
    # ========================================================================
    # Check if we can skip discovery (resume mode)
    skip_discovery = False
    if config.resume_run_id:
        discovery_status = get_phase_status(config.duckdb_path, run_id, "discovery")
        if discovery_status and discovery_status.get("status") == "completed":
            skip_discovery = True
            if verbose:
                print(f"⏭  Skipping discovery phase (already completed)", file=sys.stderr)
    
    # Run trials
    results: List[TrialResult] = []
    robust_candidates: List[Dict[str, Any]] = []  # For robust mode clustering
    
    if skip_discovery:
        # Load previous results from DuckDB
        # For now, we'll need to load from the trials table
        # This is a placeholder - you could also store robust_candidates as JSON
        if verbose:
            print(f"  Loading previous discovery results...", file=sys.stderr)
        # TODO: Load from trials_f table
    else:
        # Record phase start
        discovery_phase_id = store_phase_start(
            duckdb_path=config.duckdb_path,
            run_id=run_id,
            phase_name="discovery",
            config=config.to_dict(),
            input_summary={"n_alerts": len(all_alerts), "n_folds": len(folds)},
        )
        
        if verbose:
            print(f"📝 Phase 1: Discovery (phase_id={discovery_phase_id})", file=sys.stderr)
    
    with timing.phase("trials"):
        for i, params in enumerate(param_samples, 1):
            trial_id = uuid.uuid4().hex[:8]
            trial_timing = TimingContext()
            trial_timing.start()
            
            # Multi-fold: run on each fold and collect results
            fold_train_rs: List[float] = []
            fold_test_rs: List[float] = []
            fold_summaries: List[Dict[str, Any]] = []
            fold_results_for_robust: List[FoldResult] = []  # For robust mode
            
            for train_alerts, test_alerts, fold_name in folds:
                # Run on training data
                train_summary = run_single_backtest(
                    train_alerts, slice_path, is_partitioned, params, config
                )
                fold_train_rs.append(train_summary.get("total_r", 0.0))
                
                # Run on test data if walk-forward
                if config.use_walk_forward and test_alerts:
                    test_summary = run_single_backtest(
                        test_alerts, slice_path, is_partitioned, params, config
                    )
                    fold_test_rs.append(test_summary.get("total_r", 0.0))
                    fold_summaries.append(test_summary)
                    
                    # Build FoldResult for robust mode
                    if config.use_robust_mode:
                        fold_results_for_robust.append(FoldResult(
                            fold_name=fold_name,
                            train_r=train_summary.get("total_r", 0.0),
                            test_r=test_summary.get("total_r", 0.0),
                            avg_r=test_summary.get("avg_r", 0.0),
                            win_rate=test_summary.get("tp_sl_win_rate", 0.0),
                            n_trades=test_summary.get("alerts_ok", 0),
                            avg_r_loss=test_summary.get("avg_r_loss", -1.0),
                            median_dd_pre2x=abs(test_summary.get("median_dd_pre2x") or test_summary.get("dd_pre2x_median") or 0.0),
                            p75_dd_pre2x=abs(test_summary.get("p75_dd_pre2x") or test_summary.get("dd_pre2x_p75") or 0.0),
                            hit2x_pct=test_summary.get("pct_hit_2x") or 0.0,
                        ))
                else:
                    fold_summaries.append(train_summary)
            
            # ================================================================
            # ROBUST MODE: Use median(TestR) and new penalties
            # ================================================================
            if config.use_robust_mode and fold_results_for_robust:
                robust_result = compute_robust_objective(fold_results_for_robust, robust_config)
                
                trial_timing.end()
                
                # Store for clustering
                robust_candidates.append({
                    "params": params,
                    "robust_result": robust_result.to_dict(),
                })
                
                # Build TrialResult with robust metrics
                result = TrialResult(
                    trial_id=trial_id,
                    params=params,
                    summary=fold_summaries[-1] if fold_summaries else {},
                    objective={
                        "robust_score": robust_result.robust_score,
                        "median_test_r": robust_result.median_test_r,
                        "mean_test_r": robust_result.mean_test_r,
                        "min_test_r": robust_result.min_test_r,
                        "median_ratio": robust_result.median_ratio,
                        "dd_penalty": robust_result.dd_penalty,
                        "dd_category": robust_result.dd_category,
                        "stress_penalty": robust_result.stress_penalty,
                        "median_stressed_r": robust_result.median_stressed_r,
                        "n_folds": len(fold_results_for_robust),
                    },
                    duration_ms=trial_timing.total_ms,
                    alerts_ok=sum(f.n_trades for f in fold_results_for_robust),
                    alerts_total=sum(len(test_a) for _, test_a, _ in folds),
                    train_r=robust_result.median_train_r,
                    test_r=robust_result.median_test_r,
                    delta_r=robust_result.median_test_r - robust_result.median_train_r,
                    ratio=robust_result.median_ratio,
                    pessimistic_r=robust_result.pessimistic_r,
                    median_dd_pre2x=robust_result.dd_breakdown.get("median_dd"),
                    p75_dd_pre2x=robust_result.dd_breakdown.get("p75_dd"),
                    hit2x_pct=None,
                    median_t2x_min=None,
                    passes_gates=robust_result.passes_gates,
                )
                results.append(result)
                
                if verbose:
                    gate_str = "✓" if robust_result.passes_gates else "✗"
                    dd_str = robust_result.dd_category[:4]
                    stress_str = f" Str={robust_result.median_stressed_r:+.1f}" if robust_result.median_stressed_r else ""
                    print(
                        f"[{i:3d}/{config.n_trials}] "
                        f"TP={params['tp_mult']:.2f}x SL={params['sl_mult']:.2f}x | "
                        f"MedTeR={robust_result.median_test_r:+.1f} "
                        f"Ratio={robust_result.median_ratio:.2f} "
                        f"DD={dd_str} "
                        f"Score={robust_result.robust_score:+.1f}{stress_str} {gate_str}",
                        file=sys.stderr
                    )
            
            # ================================================================
            # LEGACY MODE: Use mean and original anti-overfit metrics
            # ================================================================
            else:
                # Average across folds (legacy behavior)
                train_r = sum(fold_train_rs) / len(fold_train_rs) if fold_train_rs else 0.0
                test_r = sum(fold_test_rs) / len(fold_test_rs) if fold_test_rs else None
                delta_r = (test_r - train_r) if test_r is not None else None
                
                # Use last fold's summary for detailed metrics (or could average)
                final_summary = fold_summaries[-1] if fold_summaries else {}
                
                # For multi-fold, compute average of key metrics
                if len(fold_summaries) > 1:
                    avg_keys = ["avg_r", "win_rate", "pct_hit_2x"]
                    for key in avg_keys:
                        vals = [s.get(key) for s in fold_summaries if s.get(key) is not None]
                        if vals:
                            final_summary[key] = sum(vals) / len(vals)
                    # Sum alerts across folds
                    final_summary["alerts_ok"] = sum(s.get("alerts_ok", 0) for s in fold_summaries)
                    final_summary["total_r"] = test_r if test_r is not None else train_r
                
                # Compute objective
                obj = compute_objective(
                    avg_r=final_summary.get("avg_r", 0.0),
                    total_r=final_summary.get("total_r", 0.0),
                    n_trades=final_summary.get("alerts_ok", 0),
                    dd_magnitude=abs(final_summary.get("dd_pre2x_median", 0.0) or 0.0),
                    time_to_2x_min=final_summary.get("time_to_2x_median_min"),
                    hit2x_pct=final_summary.get("pct_hit_2x", 0.0) or 0.0,
                    median_ath=final_summary.get("median_ath_mult", 1.0) or 1.0,
                    p75_ath=final_summary.get("p75_ath"),
                    p95_ath=final_summary.get("p95_ath"),
                    config=DEFAULT_OBJECTIVE_CONFIG,
                )
                
                trial_timing.end()
                
                # Extract DD metrics for gates
                # Note: DD values are typically negative (drawdown), so we abs() them for gates
                median_dd = abs(final_summary.get("median_dd_pre2x") or final_summary.get("dd_pre2x_median") or 0.0)
                p75_dd = abs(final_summary.get("p75_dd_pre2x") or final_summary.get("dd_pre2x_p75") or 0.0)
                hit2x = final_summary.get("pct_hit_2x") or 0.0
                t2x_min = final_summary.get("time_to_2x_median_min") or final_summary.get("median_time_to_2x_min")
                
                # Compute anti-overfit metrics
                if config.use_walk_forward and test_r is not None:
                    anti_overfit = compute_anti_overfit_metrics(
                        train_r=train_r,
                        test_r=test_r,
                        median_dd_pre2x=median_dd,
                        p75_dd_pre2x=p75_dd,
                        hit2x_pct=hit2x,
                        median_t2x_min=t2x_min,
                    )
                    ratio = anti_overfit["ratio"]
                    pessimistic_r = anti_overfit["pessimistic_r"]
                    passes_gates = anti_overfit["passes_gates"]
                    
                    # Compute robust score (the one you should rank by)
                    robust_score = compute_robust_score(
                        test_r=test_r,
                        pessimistic_r=pessimistic_r,
                        ratio=ratio,
                        objective_score=obj.final_score,
                        passes_gates=passes_gates,
                    )
                else:
                    ratio = None
                    pessimistic_r = None
                    passes_gates = True
                    robust_score = obj.final_score
                
                # Count total alerts across folds
                total_test_alerts = sum(len(test_a) for _, test_a, _ in folds)
                total_train_alerts = sum(len(train_a) for train_a, _, _ in folds)
                
                result = TrialResult(
                    trial_id=trial_id,
                    params=params,
                    summary=final_summary,
                    objective={**obj.to_dict(), "robust_score": robust_score, "n_folds": len(folds)},
                    duration_ms=trial_timing.total_ms,
                    alerts_ok=final_summary.get("alerts_ok", 0),
                    alerts_total=total_test_alerts if config.use_walk_forward else total_train_alerts,
                    train_r=train_r,
                    test_r=test_r,
                    delta_r=delta_r,
                    ratio=ratio,
                    pessimistic_r=pessimistic_r,
                    median_dd_pre2x=median_dd,
                    p75_dd_pre2x=p75_dd,
                    hit2x_pct=hit2x,
                    median_t2x_min=t2x_min,
                    passes_gates=passes_gates,
                )
                results.append(result)
                
                if verbose:
                    wr = final_summary.get("tp_sl_win_rate", 0.0) * 100
                    avg_r = final_summary.get("avg_r", 0.0)
                    
                    if config.use_walk_forward:
                        # Show ratio and pessimistic_r - THE KEY metrics
                        ratio_str = f"{ratio:.2f}" if ratio is not None else "N/A"
                        pess_str = f"{pessimistic_r:+.1f}" if pessimistic_r is not None else "N/A"
                        gate_str = "✓" if passes_gates else "✗"
                        print(
                            f"[{i:3d}/{config.n_trials}] "
                            f"TP={params['tp_mult']:.2f}x SL={params['sl_mult']:.2f}x | "
                            f"TrR={train_r:+.1f} TeR={test_r:+.1f} "
                            f"Ratio={ratio_str} Pess={pess_str} {gate_str}",
                            file=sys.stderr
                        )
                    else:
                        score = obj.final_score
                        print(
                            f"[{i:3d}/{config.n_trials}] "
                            f"TP={params['tp_mult']:.2f}x SL={params['sl_mult']:.2f}x | "
                            f"WR={wr:.0f}% AvgR={avg_r:+.2f} Score={score:+.3f}",
                            file=sys.stderr
                        )
    
    timing.end()
    
    # Record discovery phase completion
    if not skip_discovery:
        store_phase_complete(
            duckdb_path=config.duckdb_path,
            phase_id=discovery_phase_id,
            output_summary={
                "n_trials": len(results),
                "n_robust_candidates": len(robust_candidates),
                "n_tradeable": sum(1 for r in results if r.passes_gates),
            },
        )
        if verbose:
            print(f"✓ Phase 1: Discovery complete ({len(results)} trials)", file=sys.stderr)
    
    # Print summary
    if verbose:
        print(f"\n{'='*80}", file=sys.stderr)
        print("RANDOM SEARCH COMPLETE", file=sys.stderr)
        print(f"{'='*80}", file=sys.stderr)
        print(timing.summary_line(), file=sys.stderr)
        
        # ====================================================================
        # ROBUST MODE: Output top 30 + parameter islands
        # ====================================================================
        if config.use_robust_mode and robust_candidates:
            # Sort by robust_score
            sorted_robust = sorted(
                robust_candidates,
                key=lambda c: c.get("robust_result", {}).get("robust_score", -999),
                reverse=True
            )
            
            # Filter to tradeable only
            tradeable_robust = [c for c in sorted_robust if c.get("robust_result", {}).get("passes_gates", False)]
            
            print(f"\nTradeable candidates: {len(tradeable_robust)}/{len(sorted_robust)}", file=sys.stderr)
            
            # Top 30 by robust score
            print(f"\n{'─'*80}", file=sys.stderr)
            print(f"TOP {config.top_n_candidates} BY ROBUST SCORE (median TestR - DD penalty - stress penalty):", file=sys.stderr)
            print("  → Uses MEDIAN(TestR) not MEAN - robust to outlier folds", file=sys.stderr)
            print("─" * 80, file=sys.stderr)
            
            for i, c in enumerate(sorted_robust[:config.top_n_candidates], 1):
                r = c.get("robust_result", {})
                params = c.get("params", {})
                gate_str = "✓" if r.get("passes_gates") else "✗"
                dd_cat = r.get("dd_category", "?")[:4]
                stress_str = f"Str={r.get('median_stressed_r', 0):+.1f}" if r.get("median_stressed_r") else ""
                print(
                    f"  {i:2d}. TP={params.get('tp_mult', 0):.2f}x SL={params.get('sl_mult', 0):.2f}x | "
                    f"Score={r.get('robust_score', 0):+6.1f} "
                    f"MedTeR={r.get('median_test_r', 0):+5.1f} "
                    f"Ratio={r.get('median_ratio', 0):.2f} "
                    f"DD={dd_cat} {stress_str} {gate_str}",
                    file=sys.stderr
                )
            
            # ================================================================
            # PHASE 2: CLUSTERING (parameter island formation)
            # ================================================================
            clustering_phase_id = store_phase_start(
                duckdb_path=config.duckdb_path,
                run_id=run_id,
                phase_name="clustering",
                config={"n_clusters": config.n_clusters, "top_n": config.top_n_candidates},
                input_phase_id=discovery_phase_id if not skip_discovery else f"{run_id}_discovery",
                input_summary={"n_candidates": len(sorted_robust)},
            )
            
            islands = cluster_parameters(
                sorted_robust, 
                n_clusters=config.n_clusters, 
                top_n=config.top_n_candidates
            )
            
            # Store islands to DuckDB
            if islands:
                island_dicts = [i.to_dict() for i in islands]
                store_islands(
                    duckdb_path=config.duckdb_path,
                    run_id=run_id,
                    phase_id=clustering_phase_id,
                    islands=island_dicts,
                )
                print_islands(islands)
            
            store_phase_complete(
                duckdb_path=config.duckdb_path,
                phase_id=clustering_phase_id,
                output_summary={"n_islands": len(islands)},
            )
            if verbose:
                print(f"✓ Phase 2: Clustering complete ({len(islands)} islands)", file=sys.stderr)
            
            # Robust mode summary
            robust_scores = [c.get("robust_result", {}).get("robust_score", 0) for c in sorted_robust]
            median_test_rs = [c.get("robust_result", {}).get("median_test_r", 0) for c in sorted_robust]
            from statistics import median as stat_median
            
            print(f"\n{'='*80}", file=sys.stderr)
            print("ROBUST MODE SUMMARY:", file=sys.stderr)
            print(f"  Median of Robust Scores: {stat_median(robust_scores):+.2f}", file=sys.stderr)
            print(f"  Median of Median TestR:  {stat_median(median_test_rs):+.2f}", file=sys.stderr)
            print(f"  % Tradeable:             {len(tradeable_robust)/len(sorted_robust)*100:.0f}%", file=sys.stderr)
            print(f"  Parameter Islands:       {len(islands)}", file=sys.stderr)
            print(f"{'='*80}", file=sys.stderr)
        
        elif config.use_walk_forward:
            # ================================================================
            # MULTIPLE LEADERBOARDS - The key to not selecting train-window jackpots
            # ================================================================
            
            # Filter to only tradeable setups
            tradeable = [r for r in results if r.passes_gates]
            print(f"\nTradeable setups (pass DD gates): {len(tradeable)}/{len(results)}", file=sys.stderr)
            
            # 1. TOP BY TEST R (raw out-of-sample)
            sorted_by_test_r = sorted(results, key=lambda r: r.test_r or 0, reverse=True)
            print(f"\n{'─'*80}", file=sys.stderr)
            print("TOP 10 BY TEST R (raw out-of-sample performance):", file=sys.stderr)
            print("─" * 80, file=sys.stderr)
            for i, r in enumerate(sorted_by_test_r[:10], 1):
                ratio_str = f"{r.ratio:.2f}" if r.ratio is not None else "N/A"
                gate_str = "✓" if r.passes_gates else "✗"
                print(
                    f"  {i:2d}. TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                    f"TeR={r.test_r:+6.1f} TrR={r.train_r:+6.1f} "
                    f"Ratio={ratio_str:>5} {gate_str}",
                    file=sys.stderr
                )
            
            # 2. TOP BY PESSIMISTIC R (robust to overfitting)
            sorted_by_pess = sorted(results, key=lambda r: r.pessimistic_r or -9999, reverse=True)
            print(f"\n{'─'*80}", file=sys.stderr)
            print("TOP 10 BY PESSIMISTIC R (TestR - 0.15*|TrainR-TestR|):", file=sys.stderr)
            print("  → Penalizes large train/test gaps", file=sys.stderr)
            print("─" * 80, file=sys.stderr)
            for i, r in enumerate(sorted_by_pess[:10], 1):
                pess_str = f"{r.pessimistic_r:+.1f}" if r.pessimistic_r is not None else "N/A"
                ratio_str = f"{r.ratio:.2f}" if r.ratio is not None else "N/A"
                gate_str = "✓" if r.passes_gates else "✗"
                print(
                    f"  {i:2d}. TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                    f"Pess={pess_str:>7} TeR={r.test_r:+6.1f} Ratio={ratio_str:>5} {gate_str}",
                    file=sys.stderr
                )
            
            # 3. TOP BY ROBUST SCORE (pessimistic + ratio penalty + gates)
            sorted_by_robust = sorted(
                results, 
                key=lambda r: r.objective.get("robust_score", -9999), 
                reverse=True
            )
            print(f"\n{'─'*80}", file=sys.stderr)
            print("TOP 10 BY ROBUST SCORE (pessimistic + ratio penalty + gates):", file=sys.stderr)
            print("  → THE ONE TO TRUST for parameter selection", file=sys.stderr)
            print("─" * 80, file=sys.stderr)
            for i, r in enumerate(sorted_by_robust[:10], 1):
                robust = r.objective.get("robust_score", 0)
                pess_str = f"{r.pessimistic_r:+.1f}" if r.pessimistic_r is not None else "N/A"
                gate_str = "✓" if r.passes_gates else "✗"
                dd_str = f"{r.median_dd_pre2x:.0%}" if r.median_dd_pre2x else "N/A"
                hit_str = f"{r.hit2x_pct:.0%}" if r.hit2x_pct else "N/A"
                print(
                    f"  {i:2d}. TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                    f"Robust={robust:+6.1f} Pess={pess_str:>7} "
                    f"DD={dd_str:>4} Hit2x={hit_str:>4} {gate_str}",
                    file=sys.stderr
                )
            
            # 4. TRADEABLE ONLY - Top by robust score
            if tradeable:
                sorted_tradeable = sorted(
                    tradeable, 
                    key=lambda r: r.objective.get("robust_score", -9999), 
                    reverse=True
                )
                print(f"\n{'─'*80}", file=sys.stderr)
                print("TOP 10 TRADEABLE (pass gates) BY ROBUST SCORE:", file=sys.stderr)
                print("  → Parameters you can actually deploy", file=sys.stderr)
                print("─" * 80, file=sys.stderr)
                for i, r in enumerate(sorted_tradeable[:10], 1):
                    robust = r.objective.get("robust_score", 0)
                    dd_str = f"{r.median_dd_pre2x:.0%}" if r.median_dd_pre2x else "N/A"
                    hit_str = f"{r.hit2x_pct:.0%}" if r.hit2x_pct else "N/A"
                    print(
                        f"  {i:2d}. TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                        f"Robust={robust:+6.1f} TeR={r.test_r:+6.1f} "
                        f"DD={dd_str:>4} Hit2x={hit_str:>4}",
                        file=sys.stderr
                    )
            
            # Walk-forward summary stats
            test_rs = [r.test_r for r in results if r.test_r is not None]
            pess_rs = [r.pessimistic_r for r in results if r.pessimistic_r is not None]
            ratios = [r.ratio for r in results if r.ratio is not None]
            
            avg_test_r = sum(test_rs) / len(test_rs) if test_rs else 0
            avg_pess_r = sum(pess_rs) / len(pess_rs) if pess_rs else 0
            avg_ratio = sum(ratios) / len(ratios) if ratios else 0
            pct_profitable = sum(1 for r in test_rs if r > 0) / len(test_rs) * 100 if test_rs else 0
            
            print(f"\n{'='*80}", file=sys.stderr)
            print("WALK-FORWARD SUMMARY:", file=sys.stderr)
            print(f"  Avg Test R:        {avg_test_r:+.2f}", file=sys.stderr)
            print(f"  Avg Pessimistic R: {avg_pess_r:+.2f}", file=sys.stderr)
            print(f"  Avg Ratio:         {avg_ratio:.2f}", file=sys.stderr)
            print(f"  % Profitable:      {pct_profitable:.0f}%", file=sys.stderr)
            print(f"  % Tradeable:       {len(tradeable)/len(results)*100:.0f}%", file=sys.stderr)
            print(f"{'='*80}", file=sys.stderr)
            
        else:
            # Non walk-forward mode - simple leaderboard
            sorted_results = sorted(results, key=lambda r: r.objective.get("final_score", 0), reverse=True)
            
            print(f"\nTOP 10 BY OBJECTIVE SCORE:", file=sys.stderr)
            print("-" * 80, file=sys.stderr)
            for i, r in enumerate(sorted_results[:10], 1):
                score = r.objective.get("final_score", 0)
                avg_r = r.summary.get("avg_r", 0.0)
                wr = r.summary.get("tp_sl_win_rate", 0.0) * 100
                print(
                    f"  {i:2d}. TP={r.params['tp_mult']:.2f}x SL={r.params['sl_mult']:.2f}x | "
                    f"WR={wr:.0f}% AvgR={avg_r:+.2f} Score={score:+.3f}",
                    file=sys.stderr
                )
    
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
    
    # Parameter ranges (TIGHTENED defaults to reduce overfitting)
    ap.add_argument("--tp-min", type=float, default=1.5, help="Min TP multiplier (default: 1.5)")
    ap.add_argument("--tp-max", type=float, default=3.5, help="Max TP multiplier (default: 3.5, was 6.0)")
    ap.add_argument("--sl-min", type=float, default=0.30, help="Min SL multiplier (default: 0.30, was 0.20)")
    ap.add_argument("--sl-max", type=float, default=0.60, help="Max SL multiplier (default: 0.60, was 0.80)")
    
    # Walk-forward
    ap.add_argument("--train-days", type=int, default=14, help="Training window days")
    ap.add_argument("--test-days", type=int, default=7, help="Test window days")
    ap.add_argument("--no-walk-forward", action="store_true", help="Disable walk-forward validation")
    ap.add_argument("--n-folds", type=int, default=1, help="Number of walk-forward folds (default: 1=single split, >1=rolling)")
    ap.add_argument("--fold-step", type=int, default=7, help="Days to step forward between folds (default: 7)")
    
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
    ap.add_argument("--caller", help="Filter by single caller (exact match)")
    ap.add_argument("--caller-group", help="Filter by caller group file")
    
    # Extended exits
    ap.add_argument("--extended-exits", action="store_true", 
                    help="Enable extended exits (time stop, breakeven, trailing)")
    ap.add_argument("--tiered-sl", action="store_true",
                    help="Enable tiered stop loss (moves SL up as price hits milestones)")
    ap.add_argument("--delayed-entry", action="store_true",
                    help="Enable delayed entry modes (dip entry)")
    
    # Output
    ap.add_argument("--output-dir", default="results/random_search")
    ap.add_argument("--json", action="store_true", help="Output JSON")
    ap.add_argument("--quiet", "-q", action="store_true")
    
    # Robust mode (new region finder)
    ap.add_argument("--robust", action="store_true",
                    help="Enable robust mode: median(TestR), exponential DD penalty, stress lane, clustering")
    ap.add_argument("--top-n", type=int, default=30,
                    help="Number of top candidates to output/cluster (default: 30)")
    ap.add_argument("--n-clusters", type=int, default=3,
                    help="Number of parameter islands (default: 3, range 2-4)")
    ap.add_argument("--dd-gentle", type=float, default=0.30,
                    help="DD penalty gentle threshold (default: 0.30 = 30%%)")
    ap.add_argument("--dd-brutal", type=float, default=0.60,
                    help="DD penalty brutal threshold (default: 0.60 = 60%%)")
    ap.add_argument("--stress-slippage", type=float, default=2.0,
                    help="Stress lane slippage multiplier (default: 2.0)")
    ap.add_argument("--stress-stop-gap", type=float, default=0.15,
                    help="Stress lane stop gap probability (default: 0.15 = 15%%)")
    
    # Two-pass validation (island champions + stress lanes)
    ap.add_argument("--validate-champions", action="store_true",
                    help="After clustering, run full stress lane validation on island champions (maximin selection)")
    ap.add_argument("--stress-lanes", type=str, default="full",
                    help="Stress lane preset: 'basic', 'full', 'extended', or comma-separated lane names (default: full)")
    
    # Resume & audit trail
    ap.add_argument("--resume", dest="resume_run_id", type=str,
                    help="Resume a previous run from last completed phase")
    ap.add_argument("--run-id", type=str,
                    help="Explicit run ID (for deterministic naming, defaults to random UUID)")
    ap.add_argument("--show-state", action="store_true",
                    help="Show the state of a run (use with --resume) and exit")
    
    # Mode presets (THE KEY to reproducibility)
    ap.add_argument("--mode", type=str, choices=["cheap", "serious", "war_room", "custom"],
                    help="Run mode preset: cheap (fast iteration), serious (weekly), war_room (pre-deploy)")
    ap.add_argument("--show-mode", action="store_true",
                    help="Show mode configuration details and exit")
    
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
        n_folds=args.n_folds,
        fold_step_days=args.fold_step,
        duckdb_path=args.duckdb,
        chain=args.chain,
        slice_path=args.slice_path,
        interval_seconds=args.interval_seconds,
        horizon_hours=args.horizon_hours,
        fee_bps=args.fee_bps,
        slippage_bps=args.slippage_bps,
        threads=args.threads,
        caller=args.caller,
        caller_group=args.caller_group,
        seed=args.seed,
        use_extended_exits=args.extended_exits,
        use_tiered_sl=args.tiered_sl,
        use_delayed_entry=args.delayed_entry,
        # Robust mode
        use_robust_mode=args.robust,
        top_n_candidates=args.top_n,
        n_clusters=args.n_clusters,
        dd_gentle_threshold=args.dd_gentle,
        dd_brutal_threshold=args.dd_brutal,
        stress_slippage_mult=args.stress_slippage,
        stress_stop_gap_prob=args.stress_stop_gap,
        # Two-pass validation
        validate_champions=args.validate_champions,
        stress_lanes_preset=args.stress_lanes,
        # Resume & audit trail
        resume_run_id=args.resume_run_id,
        run_id=args.run_id,
    )
    
    # Handle --show-state early
    if getattr(args, "show_state", False) and args.resume_run_id:
        print_run_state(config.duckdb_path, args.resume_run_id)
        return
    
    # =========================================================================
    # RUN MODE CONTRACT
    # =========================================================================
    # If --mode is specified, override config with mode preset
    run_mode: Optional[RunMode] = None
    
    if args.mode:
        # Create mode with overrides from CLI
        run_mode = create_mode(
            mode=args.mode,
            date_from=config.date_from,
            date_to=config.date_to,
            duckdb_path=config.duckdb_path,
            slice_path=config.slice_path,
            seed=config.seed,
            caller_filter=config.caller,
            caller_group=config.caller_group,
        )
        
        # Override config with mode settings
        config.n_trials = run_mode.search.n_trials
        config.n_folds = run_mode.data_window.n_folds
        config.train_days = run_mode.data_window.train_days
        config.test_days = run_mode.data_window.test_days
        config.fold_step_days = run_mode.data_window.fold_step_days
        config.tp_min = run_mode.search.tp_min
        config.tp_max = run_mode.search.tp_max
        config.sl_min = run_mode.search.sl_min
        config.sl_max = run_mode.search.sl_max
        config.n_clusters = run_mode.search.n_clusters
        config.top_n_candidates = run_mode.search.top_n_candidates
        config.dd_gentle_threshold = run_mode.objective.dd_gentle_threshold
        config.dd_brutal_threshold = run_mode.objective.dd_brutal_threshold
        config.stress_lanes_preset = run_mode.stress.lane_pack.value
        config.validate_champions = run_mode.stress.validate_champions
        config.use_robust_mode = True  # Mode always uses robust mode
        config.use_walk_forward = True  # Mode always uses walk-forward
        
        # Handle --show-mode
        if getattr(args, "show_mode", False):
            print_mode_summary(run_mode)
            return
        
        # Print mode signature
        print(f"\n{'─'*70}", file=sys.stderr)
        print(f"  {run_mode.short_signature()}", file=sys.stderr)
        print(f"{'─'*70}\n", file=sys.stderr)
    
    # Determine run_id
    if config.resume_run_id:
        run_id = config.resume_run_id
        state = get_resumable_run_state(config.duckdb_path, run_id)
        if not state["can_resume"]:
            print(f"❌ Cannot resume run {run_id}: no completed phases found", file=sys.stderr)
            return
        print(f"Resuming run {run_id} from phase: {state['next_phase']}", file=sys.stderr)
        print_run_state(config.duckdb_path, run_id)
    elif config.run_id:
        run_id = config.run_id
    else:
        run_id = uuid.uuid4().hex[:12]
    
    # Ensure schema
    ensure_trial_schema(config.duckdb_path)
    
    # Run
    results = run_random_search(config, run_id=run_id, verbose=not args.quiet)
    
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
    
    # Add robust mode extras
    if config.use_robust_mode:
        # Sort candidates for output
        sorted_robust = sorted(
            [{"params": r.params, "robust_result": r.objective} for r in results],
            key=lambda c: c.get("robust_result", {}).get("robust_score", -999),
            reverse=True
        )
        
        # Cluster top candidates
        islands = cluster_parameters(
            sorted_robust,
            n_clusters=config.n_clusters,
            top_n=config.top_n_candidates
        )
        
        output_data["robust_mode"] = {
            "top_candidates": sorted_robust[:config.top_n_candidates],
            "islands": [i.to_dict() for i in islands],
            "n_tradeable": sum(1 for c in sorted_robust if c.get("robust_result", {}).get("passes_gates", False)),
        }
        
        # ====================================================================
        # TWO-PASS VALIDATION: Run stress lane matrix on island champions
        # ====================================================================
        if config.validate_champions and islands:
            from lib.partitioner import is_hive_partitioned, is_per_token_directory
            
            print(f"\n{'='*80}", file=sys.stderr)
            print("PASS 2: STRESS LANE VALIDATION (island champions)", file=sys.stderr)
            print(f"{'='*80}", file=sys.stderr)
            
            # ================================================================
            # PHASE 3: CHAMPION SELECTION
            # ================================================================
            selection_phase_id = store_phase_start(
                duckdb_path=config.duckdb_path,
                run_id=run_id,
                phase_name="champion_selection",
                config={"prefer_passing_gates": True},
                input_summary={"n_islands": len(islands)},
            )
            
            # Extract champions
            champions = extract_island_champions(islands, prefer_passing_gates=True)
            print_island_champions(champions)
            
            # Store champions to DuckDB
            champion_dicts = [c.to_dict() for c in champions]
            store_island_champions(
                duckdb_path=config.duckdb_path,
                run_id=run_id,
                phase_id=selection_phase_id,
                champions=champion_dicts,
            )
            
            store_phase_complete(
                duckdb_path=config.duckdb_path,
                phase_id=selection_phase_id,
                output_summary={"n_champions": len(champions)},
            )
            print(f"✓ Phase 3: Champion Selection complete ({len(champions)} champions)", file=sys.stderr)
            
            # Get stress lanes
            stress_lanes = get_stress_lanes(config.stress_lanes_preset)
            print(f"\nStress lanes ({config.stress_lanes_preset}):", file=sys.stderr)
            for lane in stress_lanes:
                print(f"  - {lane.name}: {lane.description}", file=sys.stderr)
            
            # Reload alerts and slice for validation
            from lib.helpers import parse_yyyy_mm_dd
            date_from = parse_yyyy_mm_dd(config.date_from)
            date_to = parse_yyyy_mm_dd(config.date_to)
            all_alerts = load_alerts(config.duckdb_path, config.chain, date_from, date_to)
            
            # Filter alerts
            if config.caller:
                caller_lower = config.caller.lower()
                all_alerts = [a for a in all_alerts if a.caller.lower() == caller_lower]
            elif config.caller_group:
                group = load_caller_group(config.caller_group)
                if group:
                    all_alerts = [a for a in all_alerts if group.matches(a.caller)]
            
            # Setup walk-forward test set (use same split as discovery)
            if config.use_walk_forward:
                train_end = date_to - timedelta(days=config.test_days)
                test_alerts = [a for a in all_alerts if a.ts >= train_end]
            else:
                test_alerts = all_alerts
            
            slice_path = Path(config.slice_path)
            is_partitioned = is_hive_partitioned(slice_path) or (slice_path.is_dir() and not slice_path.suffix)
            
            # ================================================================
            # PHASE 4: STRESS VALIDATION
            # ================================================================
            validation_phase_id = store_phase_start(
                duckdb_path=config.duckdb_path,
                run_id=run_id,
                phase_name="stress_validation",
                config={"lanes": [l.name for l in stress_lanes]},
                input_phase_id=selection_phase_id,
                input_summary={"n_champions": len(champions), "n_lanes": len(stress_lanes)},
            )
            print(f"📝 Phase 4: Stress Validation (phase_id={validation_phase_id})", file=sys.stderr)
            
            # Validate each champion across all lanes
            validated_champions: List[ChampionValidationResult] = []
            
            for champ in champions:
                champion_id = f"{run_id}_champ_{champ.island_id}"
                print(f"\nValidating Island {champ.island_id} Champion...", file=sys.stderr)
                
                # Check which lanes are already complete (for resume)
                completed_lanes = get_completed_lanes_for_champion(
                    config.duckdb_path, run_id, champion_id
                )
                if completed_lanes:
                    print(f"  (Skipping {len(completed_lanes)} already-completed lanes)", file=sys.stderr)
                
                lane_results = {}
                
                # Load previously completed lane results
                if completed_lanes:
                    prev_results = load_stress_lane_results(
                        config.duckdb_path, run_id, champion_id
                    )
                    for r in prev_results:
                        lane_results[r["lane_name"]] = {
                            "test_r": r.get("test_r", 0.0),
                            "ratio": r.get("ratio", 1.0),
                            "passes_gates": r.get("passes_gates", False),
                            "summary": r.get("summary", {}),
                        }
                
                for lane in stress_lanes:
                    # Skip if already completed (resume mode)
                    if lane.name in completed_lanes:
                        continue
                    print(f"  Running lane '{lane.name}'...", file=sys.stderr, end=" ")
                    
                    # Run backtest with lane parameters
                    rows = run_tp_sl_query(
                        alerts=test_alerts,
                        slice_path=slice_path,
                        is_partitioned=is_partitioned,
                        interval_seconds=config.interval_seconds,
                        horizon_hours=config.horizon_hours,
                        tp_mult=champ.params.get("tp_mult", 2.0),
                        sl_mult=champ.params.get("sl_mult", 0.5),
                        intrabar_order=champ.params.get("intrabar_order", "sl_first"),
                        fee_bps=lane.fee_bps,
                        slippage_bps=lane.slippage_bps,
                        entry_delay_candles=lane.latency_candles,
                        threads=config.threads,
                        verbose=False,
                    )
                    
                    summary = summarize_tp_sl(
                        rows, 
                        sl_mult=champ.params.get("sl_mult", 0.5),
                        risk_per_trade=config.risk_per_trade,
                    )
                    
                    test_r = summary.get("total_r", 0.0)
                    train_r = champ.discovery_score  # Use discovery score as proxy
                    ratio = test_r / train_r if abs(train_r) > 0.01 else 1.0
                    
                    # Apply stop gap penalty analytically
                    if lane.stop_gap_prob > 0.15:
                        n_trades = summary.get("alerts_ok", 0)
                        win_rate = summary.get("tp_sl_win_rate", 0.5)
                        avg_r_loss = summary.get("avg_r_loss", -1.0)
                        n_losses = int(n_trades * (1.0 - win_rate))
                        n_gapped = int(n_losses * lane.stop_gap_prob)
                        extra_loss = abs(avg_r_loss) * (lane.stop_gap_mult - 1.0) * n_gapped
                        test_r -= extra_loss
                    
                    lane_result = {
                        "test_r": test_r,
                        "ratio": ratio,
                        "passes_gates": test_r >= 0 and ratio >= 0.20,
                        "summary": summary,
                    }
                    lane_results[lane.name] = lane_result
                    
                    # Store lane result to DuckDB (audit trail + resume)
                    store_stress_lane_result(
                        duckdb_path=config.duckdb_path,
                        run_id=run_id,
                        phase_id=validation_phase_id,
                        champion_id=champion_id,
                        lane_name=lane.name,
                        lane_config={
                            "fee_bps": lane.fee_bps,
                            "slippage_bps": lane.slippage_bps,
                            "latency_candles": lane.latency_candles,
                            "stop_gap_prob": lane.stop_gap_prob,
                            "stop_gap_mult": lane.stop_gap_mult,
                        },
                        result=lane_result,
                    )
                    
                    print(f"TestR={test_r:+.1f}", file=sys.stderr)
                
                # Compute lane scores
                lane_scores = {name: result["test_r"] for name, result in lane_results.items()}
                lane_score_result = compute_lane_scores(lane_scores)
                
                validated_champ = ChampionValidationResult(
                    island_id=champ.island_id,
                    params=champ.params,
                    discovery_score=champ.discovery_score,
                    lane_results=lane_results,
                    lane_score_result=lane_score_result,
                    validation_score=lane_score_result.robust_score,
                    score_delta=lane_score_result.robust_score - champ.discovery_score,
                )
                validated_champions.append(validated_champ)
            
            # Phase 4 complete
            store_phase_complete(
                duckdb_path=config.duckdb_path,
                phase_id=validation_phase_id,
                output_summary={
                    "n_champions_validated": len(validated_champions),
                    "n_lanes_per_champion": len(stress_lanes),
                },
            )
            print(f"✓ Phase 4: Stress Validation complete", file=sys.stderr)
            
            # ================================================================
            # PHASE 5: FINAL SELECTION (maximin winner)
            # ================================================================
            final_phase_id = store_phase_start(
                duckdb_path=config.duckdb_path,
                run_id=run_id,
                phase_name="final_selection",
                config={},
                input_phase_id=validation_phase_id,
                input_summary={"n_validated_champions": len(validated_champions)},
            )
            
            # Print lane matrix
            print_lane_matrix(validated_champions)
            
            # Store validation summaries and determine winner
            if validated_champions:
                # Rank champions by validation score (maximin)
                sorted_champs = sorted(
                    validated_champions,
                    key=lambda c: c.validation_score,
                    reverse=True
                )
                
                for rank, champ in enumerate(sorted_champs, 1):
                    island_id = f"{run_id}_island_{champ.island_id}"
                    champion_id = f"{run_id}_champ_{champ.island_id}"
                    lane_scores = {name: result["test_r"] for name, result in champ.lane_results.items()}
                    
                    store_champion_validation(
                        duckdb_path=config.duckdb_path,
                        run_id=run_id,
                        phase_id=final_phase_id,
                        champion_id=champion_id,
                        island_id=island_id,
                        lane_scores=lane_scores,
                        validation_rank=rank,
                        discovery_score=champ.discovery_score,
                    )
                
                maximin_winner = sorted_champs[0]
                print(f"\n🏆 MAXIMIN WINNER: Island {maximin_winner.island_id}", file=sys.stderr)
                print(f"   Params: TP={maximin_winner.params.get('tp_mult'):.2f}x SL={maximin_winner.params.get('sl_mult'):.2f}x", file=sys.stderr)
                print(f"   Validation Score: {maximin_winner.validation_score:+.1f}", file=sys.stderr)
                print(f"   Discovery Score:  {maximin_winner.discovery_score:+.1f}", file=sys.stderr)
                print(f"   Score Delta:      {maximin_winner.score_delta:+.1f}", file=sys.stderr)
            
            store_phase_complete(
                duckdb_path=config.duckdb_path,
                phase_id=final_phase_id,
                output_summary={
                    "maximin_winner_island": sorted_champs[0].island_id if sorted_champs else None,
                    "winner_validation_score": sorted_champs[0].validation_score if sorted_champs else None,
                },
            )
            print(f"✓ Phase 5: Final Selection complete", file=sys.stderr)
            
            # Print final run state
            print_run_state(config.duckdb_path, run_id)
            
            # Add validation results to output
            output_data["robust_mode"]["validation"] = {
                "champions": [c.to_dict() for c in validated_champions],
                "stress_lanes": [l.to_dict() for l in stress_lanes],
                "maximin_winner": sorted_champs[0].to_dict() if sorted_champs else None,
            }
    
    with open(output_path, "w") as f:
        json.dump(output_data, f, indent=2, default=str)
    
    print(f"\nResults saved to: {output_path}", file=sys.stderr)
    
    # Store to DuckDB with Run Mode Contract
    try:
        # Extract mode contract fields if available
        mode_name = run_mode.mode.value if run_mode else None
        config_hash = run_mode.config_hash if run_mode else None
        data_fingerprint = run_mode.data_fingerprint if run_mode else None
        code_fingerprint = run_mode.code_fingerprint if run_mode else None
        code_dirty = run_mode.code_dirty if run_mode else False
        signature = run_mode.signature() if run_mode else None
        
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
            # Run Mode Contract
            mode=mode_name,
            config_hash=config_hash,
            data_fingerprint=data_fingerprint,
            code_fingerprint=code_fingerprint,
            code_dirty=code_dirty,
            signature=signature,
        )
        print(f"✓ Run stored to DuckDB: {config.duckdb_path}", file=sys.stderr)
        
        # Print final signature
        if run_mode:
            print(f"\n  {run_mode.short_signature()}\n", file=sys.stderr)
    except Exception as e:
        print(f"⚠️  Failed to store to DuckDB: {e}", file=sys.stderr)
    
    if args.json:
        print(json.dumps(output_data, indent=2, default=str))


if __name__ == "__main__":
    main()

