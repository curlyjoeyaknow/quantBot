"""
Robust Region Finder for Parameter Optimization.

Key innovations:
1. Objective = median(TestR across folds) - not mean, to survive outliers
2. Exponential DD penalty: gentle at 30%, brutal by 60% (effectively disqualify)
3. Stress lane: slippage ×2 + stop-gap worst-case simulation
4. Parameter island clustering: top 30 candidates clustered into 2-4 regions

Philosophy: Find profitable REGIONS with evidence they survive unseen periods.
Not "the best params" but "robust parameter neighborhoods".
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from statistics import median

# =============================================================================
# EXPONENTIAL DD PENALTY (THE KEY)
# =============================================================================
# Curve design:
#   - 0-30%: No penalty (normal for memecoins)
#   - 30-45%: Gentle penalty (exp ramps up slowly)
#   - 45-60%: Aggressive penalty (exp steepens)
#   - >60%: Nuclear (effectively disqualifies)

@dataclass
class DDPenaltyConfig:
    """
    Exponential drawdown penalty configuration.
    
    The penalty function:
        penalty = 0                                   if dd <= gentle_threshold
        penalty = scale * (exp(rate * excess) - 1)   otherwise
    
    where:
        excess = (dd - gentle_threshold) / (brutal_threshold - gentle_threshold)
        rate increases as dd approaches brutal_threshold
    
    At brutal_threshold, penalty should effectively disqualify the candidate.
    """
    gentle_threshold: float = 0.30    # No penalty below 30%
    brutal_threshold: float = 0.60    # Effectively disqualified at 60%
    nuclear_threshold: float = 0.70   # Hard reject above 70%
    
    # Penalty curve parameters
    gentle_rate: float = 2.0          # Slow exponential growth
    brutal_rate: float = 8.0          # Fast exponential growth near brutal
    max_penalty: float = 100.0        # Cap penalty (for numerical stability)
    
    def compute(self, dd_pct: float) -> Tuple[float, str]:
        """
        Compute DD penalty and classification.
        
        Args:
            dd_pct: Drawdown as decimal (0.30 = 30%)
        
        Returns:
            (penalty, category) where category is:
            - "clean": dd <= gentle (no penalty)
            - "acceptable": gentle < dd <= 0.45
            - "risky": 0.45 < dd <= brutal
            - "disqualified": dd > brutal
            - "nuclear": dd > nuclear (hard reject)
        """
        dd = abs(dd_pct)  # Ensure positive
        
        if dd <= self.gentle_threshold:
            return 0.0, "clean"
        
        if dd > self.nuclear_threshold:
            return self.max_penalty, "nuclear"
        
        if dd > self.brutal_threshold:
            # Severe penalty but not max (for ranking among bad candidates)
            excess = (dd - self.brutal_threshold) / (self.nuclear_threshold - self.brutal_threshold)
            penalty = self.max_penalty * 0.8 * excess + 20.0
            return min(penalty, self.max_penalty), "disqualified"
        
        # Between gentle and brutal: progressive exponential
        # Map dd to 0-1 range within the penalty zone
        normalized = (dd - self.gentle_threshold) / (self.brutal_threshold - self.gentle_threshold)
        
        # Rate interpolation: starts at gentle_rate, approaches brutal_rate
        rate = self.gentle_rate + (self.brutal_rate - self.gentle_rate) * normalized
        
        # Exponential penalty
        penalty = math.exp(rate * normalized) - 1.0
        
        # Categorize
        if dd <= 0.45:
            category = "acceptable"
        else:
            category = "risky"
        
        return min(penalty, self.max_penalty), category


DEFAULT_DD_PENALTY = DDPenaltyConfig()


def compute_dd_penalty_robust(
    median_dd_pre2x: Optional[float],
    p75_dd_pre2x: Optional[float] = None,
    config: DDPenaltyConfig = DEFAULT_DD_PENALTY,
) -> Tuple[float, str, Dict[str, Any]]:
    """
    Compute robust DD penalty using both median and p75.
    
    Takes the WORSE of median and p75 to catch fat-tailed DD distributions.
    
    Args:
        median_dd_pre2x: Median drawdown before 2x
        p75_dd_pre2x: 75th percentile drawdown
        config: Penalty configuration
    
    Returns:
        (penalty, worst_category, breakdown)
    """
    breakdown = {
        "median_dd": median_dd_pre2x,
        "p75_dd": p75_dd_pre2x,
    }
    
    # Compute penalties for both
    median_penalty, median_cat = 0.0, "clean"
    if median_dd_pre2x is not None:
        median_penalty, median_cat = config.compute(median_dd_pre2x)
    
    p75_penalty, p75_cat = 0.0, "clean"
    if p75_dd_pre2x is not None:
        p75_penalty, p75_cat = config.compute(p75_dd_pre2x)
    
    breakdown["median_penalty"] = median_penalty
    breakdown["median_category"] = median_cat
    breakdown["p75_penalty"] = p75_penalty
    breakdown["p75_category"] = p75_cat
    
    # Take worse penalty (penalize fat tails)
    # Weight p75 at 0.5x since it's the tail
    combined_penalty = median_penalty + 0.5 * p75_penalty
    
    # Worst category
    category_order = ["clean", "acceptable", "risky", "disqualified", "nuclear"]
    worst_idx = max(category_order.index(median_cat), category_order.index(p75_cat))
    worst_category = category_order[worst_idx]
    
    breakdown["combined_penalty"] = combined_penalty
    breakdown["worst_category"] = worst_category
    
    return combined_penalty, worst_category, breakdown


# =============================================================================
# STRESS LANE (WORST-CASE SIMULATION)
# =============================================================================

@dataclass
class StressConfig:
    """
    Configuration for stress lane testing (legacy single-lane mode).
    
    Stress lane applies pessimistic assumptions:
    - slippage_mult: Multiply slippage (2x = double slippage)
    - stop_gap_prob: Probability of stop gapping through (missing stop)
    - stop_gap_mult: When gap occurs, loss multiplied by this
    
    For multi-lane stress testing, use stress_lanes.StressLane instead.
    """
    slippage_mult: float = 2.0       # 2x slippage (e.g., 50bps → 100bps)
    stop_gap_prob: float = 0.15      # 15% of stops gap through
    stop_gap_mult: float = 1.5       # When gapped, lose 1.5x expected loss
    
    # Weight of stress results in final score
    stress_weight: float = 0.30      # 30% of score from stress test


def simulate_stress_r(
    base_test_r: float,
    avg_r: float,
    win_rate: float,
    n_trades: int,
    avg_r_loss: float,
    config: Optional["StressConfig"] = None,
    lane: Optional[Any] = None,  # stress_lanes.StressLane
    base_slippage_bps: float = 50.0,
) -> Tuple[float, Dict[str, Any]]:
    """
    Simulate stressed R given base metrics.
    
    Supports two modes:
    1. Legacy: Use StressConfig (slippage multiplier approach)
    2. Lane: Use StressLane from stress_lanes module (absolute bps approach)
    
    Applies:
    1. Extra slippage cost (reduces both wins and losses)
    2. Stop gap simulation (some losses are worse than expected)
    
    Args:
        base_test_r: Original TestR before stress
        avg_r: Average R per trade
        win_rate: Win rate (0-1)
        n_trades: Number of trades
        avg_r_loss: Average R on losing trades (negative)
        config: Legacy StressConfig (if lane is None)
        lane: StressLane from stress_lanes module (takes precedence)
        base_slippage_bps: Base slippage in bps (for lane mode)
    
    Returns:
        (stressed_r, breakdown)
    """
    # Import StressLane type check at runtime to avoid circular imports
    from .stress_lanes import StressLane
    
    # Determine parameters based on config or lane
    if lane is not None and isinstance(lane, StressLane):
        # Lane mode: use absolute bps values
        slippage_mult = lane.slippage_bps / base_slippage_bps if base_slippage_bps > 0 else 2.0
        stop_gap_prob = lane.stop_gap_prob
        stop_gap_mult = lane.stop_gap_mult
        breakdown = {
            "base_test_r": base_test_r,
            "lane": lane.name,
            "slippage_bps": lane.slippage_bps,
            "base_slippage_bps": base_slippage_bps,
            "stop_gap_prob": stop_gap_prob,
            "stop_gap_mult": stop_gap_mult,
        }
    else:
        # Legacy mode: use StressConfig
        if config is None:
            config = StressConfig()
        slippage_mult = config.slippage_mult
        stop_gap_prob = config.stop_gap_prob
        stop_gap_mult = config.stop_gap_mult
        breakdown = {
            "base_test_r": base_test_r,
            "slippage_mult": slippage_mult,
            "stop_gap_prob": stop_gap_prob,
            "stop_gap_mult": stop_gap_mult,
        }
    
    if n_trades <= 0:
        return 0.0, breakdown
    
    # Slippage hit: extra slippage reduces avg_r
    # Assume base slippage is ~50bps = 0.05R on avg
    base_slippage_r = 0.05
    extra_slippage_r = base_slippage_r * (slippage_mult - 1.0)
    slippage_hit = extra_slippage_r * n_trades
    
    # Stop gap hit: some losing trades lose more than expected
    n_losses = int(n_trades * (1.0 - win_rate))
    n_gapped = int(n_losses * stop_gap_prob)
    
    # Extra loss from gapped stops
    # If avg_r_loss = -1R and gap_mult = 1.5, gapped losses are -1.5R
    extra_loss_per_gap = abs(avg_r_loss) * (stop_gap_mult - 1.0)
    stop_gap_hit = extra_loss_per_gap * n_gapped
    
    # Total stress reduction
    total_stress_hit = slippage_hit + stop_gap_hit
    stressed_r = base_test_r - total_stress_hit
    
    breakdown["slippage_hit_r"] = slippage_hit
    breakdown["stop_gap_hit_r"] = stop_gap_hit
    breakdown["total_stress_hit"] = total_stress_hit
    breakdown["stressed_r"] = stressed_r
    breakdown["stress_pct"] = (total_stress_hit / abs(base_test_r)) if base_test_r != 0 else 0.0
    
    return stressed_r, breakdown


# =============================================================================
# ROBUST OBJECTIVE FUNCTION
# =============================================================================

@dataclass
class FoldResult:
    """Result from a single fold."""
    fold_name: str
    train_r: float
    test_r: float
    
    # Detailed metrics
    avg_r: float = 0.0
    win_rate: float = 0.0
    n_trades: int = 0
    avg_r_loss: float = -1.0
    
    # DD metrics
    median_dd_pre2x: Optional[float] = None
    p75_dd_pre2x: Optional[float] = None
    hit2x_pct: Optional[float] = None
    
    # Stress test results
    stressed_r: Optional[float] = None
    stress_breakdown: Optional[Dict[str, Any]] = None


@dataclass
class RobustObjectiveResult:
    """
    Result of robust objective computation.
    
    The key innovation: uses median(TestR) not mean(TestR).
    """
    # Primary score (what you rank by)
    robust_score: float
    
    # Component scores
    median_test_r: float              # Median across folds (THE KEY)
    mean_test_r: float                # For comparison
    min_test_r: float                 # Worst fold
    
    # Anti-overfit metrics
    median_train_r: float
    median_ratio: float               # Median of (TestR/TrainR) per fold
    pessimistic_r: float              # TestR - λ * |TrainR - TestR|
    
    # DD penalty
    dd_penalty: float
    dd_category: str
    dd_breakdown: Dict[str, Any] = field(default_factory=dict)
    
    # Stress lane
    median_stressed_r: Optional[float] = None
    stress_penalty: float = 0.0
    stress_breakdown: Dict[str, Any] = field(default_factory=dict)
    
    # Gates
    passes_gates: bool = False
    gate_failures: List[str] = field(default_factory=list)
    
    # Per-fold details
    fold_results: List[FoldResult] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "robust_score": self.robust_score,
            "median_test_r": self.median_test_r,
            "mean_test_r": self.mean_test_r,
            "min_test_r": self.min_test_r,
            "median_train_r": self.median_train_r,
            "median_ratio": self.median_ratio,
            "pessimistic_r": self.pessimistic_r,
            "dd_penalty": self.dd_penalty,
            "dd_category": self.dd_category,
            "dd_breakdown": self.dd_breakdown,
            "median_stressed_r": self.median_stressed_r,
            "stress_penalty": self.stress_penalty,
            "stress_breakdown": self.stress_breakdown,
            "passes_gates": self.passes_gates,
            "gate_failures": self.gate_failures,
            "n_folds": len(self.fold_results),
        }


# =============================================================================
# EXPLICIT GATE CONFIGURATION
# =============================================================================

@dataclass
class GateConfig:
    """
    Named gates with explicit thresholds.
    
    Gates are hard requirements that a strategy must pass to be considered "tradeable".
    Each gate has:
    - A clear name
    - A threshold value
    - A comparison operator (implicit in the check logic)
    
    This replaces the scattered gate checks with a single source of truth.
    """
    # Generalization gates (anti-overfit)
    test_train_ratio_min: float = 0.20     # TestR >= 20% of TrainR (not total overfit)
    
    # Drawdown gates (risk management)
    p75_dd_max: float = 0.60               # 75th percentile DD <= 60%
    median_dd_max: float = 0.40            # Median DD <= 40%
    
    # Win rate gates (consistency)
    hit2x_min: float = 0.30                # At least 30% hit 2x
    win_rate_min: float = 0.35             # Win rate >= 35%
    
    # Profitability gates
    test_r_min: float = 0.0                # TestR >= 0 (must be profitable OOS)
    avg_r_min: float = 0.0                 # Average R >= 0
    
    # Loss sanity gates (catches execution issues)
    avg_r_loss_min: float = -1.5           # Avg loss >= -1.5R (catches severe stop gaps)
    avg_r_loss_max: float = -0.5           # Avg loss <= -0.5R (catches too tight stops)
    
    # Fold survival (robustness across time)
    fold_survival_pct: float = 0.60        # At least 60% of folds profitable
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "test_train_ratio_min": self.test_train_ratio_min,
            "p75_dd_max": self.p75_dd_max,
            "median_dd_max": self.median_dd_max,
            "hit2x_min": self.hit2x_min,
            "win_rate_min": self.win_rate_min,
            "test_r_min": self.test_r_min,
            "avg_r_min": self.avg_r_min,
            "avg_r_loss_min": self.avg_r_loss_min,
            "avg_r_loss_max": self.avg_r_loss_max,
            "fold_survival_pct": self.fold_survival_pct,
        }


DEFAULT_GATE_CONFIG = GateConfig()


@dataclass
class GateCheckResult:
    """Result of checking all gates."""
    passes_all: bool
    gate_results: Dict[str, Dict[str, Any]]  # gate_name -> {passed, value, threshold, message}
    n_passed: int
    n_total: int
    failure_messages: List[str]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "passes_all": self.passes_all,
            "n_passed": self.n_passed,
            "n_total": self.n_total,
            "gate_results": self.gate_results,
            "failure_messages": self.failure_messages,
        }


def check_gates(
    test_train_ratio: Optional[float],
    p75_dd: Optional[float],
    median_dd: Optional[float],
    hit2x_pct: Optional[float],
    win_rate: Optional[float],
    test_r: Optional[float],
    avg_r: Optional[float],
    avg_r_loss: Optional[float],
    fold_survival_pct: Optional[float],
    config: GateConfig = DEFAULT_GATE_CONFIG,
) -> GateCheckResult:
    """
    Check all gates and return detailed results.
    
    Args:
        test_train_ratio: TestR / TrainR ratio
        p75_dd: 75th percentile drawdown (as positive decimal, e.g., 0.40 = 40%)
        median_dd: Median drawdown (as positive decimal)
        hit2x_pct: Percentage that hit 2x (0-1)
        win_rate: Win rate (0-1)
        test_r: Test R total
        avg_r: Average R per trade
        avg_r_loss: Average R on losing trades (negative)
        fold_survival_pct: Percentage of folds that were profitable (0-1)
        config: Gate configuration
    
    Returns:
        GateCheckResult with per-gate details
    """
    gate_results = {}
    failures = []
    
    def check_min(name: str, value: Optional[float], threshold: float, fmt: str = ".2f") -> bool:
        """Check value >= threshold."""
        if value is None:
            gate_results[name] = {
                "passed": True,  # Skip if no data
                "value": None,
                "threshold": threshold,
                "message": f"{name}: N/A (skipped)",
            }
            return True
        
        passed = value >= threshold
        msg = f"{name}: {value:{fmt}} >= {threshold:{fmt}}"
        if not passed:
            msg = f"{name}: {value:{fmt}} < {threshold:{fmt}} (FAIL)"
            failures.append(msg)
        gate_results[name] = {
            "passed": passed,
            "value": value,
            "threshold": threshold,
            "message": msg,
        }
        return passed
    
    def check_max(name: str, value: Optional[float], threshold: float, fmt: str = ".2f") -> bool:
        """Check value <= threshold."""
        if value is None:
            gate_results[name] = {
                "passed": True,
                "value": None,
                "threshold": threshold,
                "message": f"{name}: N/A (skipped)",
            }
            return True
        
        passed = value <= threshold
        msg = f"{name}: {value:{fmt}} <= {threshold:{fmt}}"
        if not passed:
            msg = f"{name}: {value:{fmt}} > {threshold:{fmt}} (FAIL)"
            failures.append(msg)
        gate_results[name] = {
            "passed": passed,
            "value": value,
            "threshold": threshold,
            "message": msg,
        }
        return passed
    
    # Run all gate checks
    check_min("test_train_ratio", test_train_ratio, config.test_train_ratio_min)
    check_max("p75_dd", p75_dd, config.p75_dd_max, ".0%")
    check_max("median_dd", median_dd, config.median_dd_max, ".0%")
    check_min("hit2x", hit2x_pct, config.hit2x_min, ".0%")
    check_min("win_rate", win_rate, config.win_rate_min, ".0%")
    check_min("test_r", test_r, config.test_r_min, "+.1f")
    check_min("avg_r", avg_r, config.avg_r_min, "+.2f")
    check_min("avg_r_loss", avg_r_loss, config.avg_r_loss_min, ".2f")
    check_max("avg_r_loss_upper", avg_r_loss, config.avg_r_loss_max, ".2f")
    check_min("fold_survival", fold_survival_pct, config.fold_survival_pct, ".0%")
    
    n_passed = sum(1 for g in gate_results.values() if g["passed"])
    n_total = len(gate_results)
    
    return GateCheckResult(
        passes_all=len(failures) == 0,
        gate_results=gate_results,
        n_passed=n_passed,
        n_total=n_total,
        failure_messages=failures,
    )


def print_gate_check(result: GateCheckResult, indent: str = "  ") -> None:
    """Print gate check results in a readable format."""
    status = "PASS" if result.passes_all else "FAIL"
    print(f"\nGATE CHECK: {status} ({result.n_passed}/{result.n_total})")
    print("-" * 50)
    
    for gate_name, gate_info in result.gate_results.items():
        passed = gate_info["passed"]
        value = gate_info["value"]
        threshold = gate_info["threshold"]
        
        if value is None:
            print(f"{indent}[─] {gate_name}: N/A")
        elif passed:
            print(f"{indent}[✓] {gate_info['message']}")
        else:
            print(f"{indent}[✗] {gate_info['message']}")


@dataclass
class RobustObjectiveConfig:
    """Configuration for robust objective function."""
    
    # Pessimistic adjustment
    pessimistic_lambda: float = 0.15  # Penalty for train/test gap
    
    # DD penalty config
    dd_penalty_config: DDPenaltyConfig = field(default_factory=DDPenaltyConfig)
    
    # Stress config
    stress_config: StressConfig = field(default_factory=StressConfig)
    stress_weight: float = 0.30       # How much stress results affect score
    
    # Gate config (explicit named gates)
    gate_config: GateConfig = field(default_factory=GateConfig)
    
    # Legacy gate fields (for backwards compatibility, use gate_config instead)
    gate_max_p75_dd: float = 0.60     # p75_dd must be <= 60%
    gate_max_median_dd: float = 0.40  # median_dd must be <= 40%
    gate_min_hit2x: float = 0.30      # hit2x >= 30%
    gate_min_test_r: float = 0.0      # TestR >= 0 (must be profitable OOS)
    gate_min_ratio: float = 0.20      # TestR/TrainR >= 0.20 (not total overfit)
    
    # Fold survival requirement
    min_folds_positive: float = 0.60  # At least 60% of folds must be positive


DEFAULT_ROBUST_CONFIG = RobustObjectiveConfig()


def compute_robust_objective(
    fold_results: List[FoldResult],
    config: RobustObjectiveConfig = DEFAULT_ROBUST_CONFIG,
) -> RobustObjectiveResult:
    """
    Compute robust objective from multi-fold results.
    
    Key formula:
        robust_score = median(TestR) - DD_penalty - stress_penalty - gate_penalty
    
    Uses MEDIAN not MEAN to be robust to outlier folds.
    
    Args:
        fold_results: Results from each walk-forward fold
        config: Objective configuration
    
    Returns:
        RobustObjectiveResult with full breakdown
    """
    if not fold_results:
        return RobustObjectiveResult(
            robust_score=-999.0,
            median_test_r=0.0,
            mean_test_r=0.0,
            min_test_r=0.0,
            median_train_r=0.0,
            median_ratio=0.0,
            pessimistic_r=0.0,
            dd_penalty=0.0,
            dd_category="nuclear",
            passes_gates=False,
            gate_failures=["no_folds"],
        )
    
    # Extract per-fold metrics
    test_rs = [f.test_r for f in fold_results]
    train_rs = [f.train_r for f in fold_results]
    
    # Ratios (TestR / TrainR) per fold, handle zero train
    ratios = []
    for f in fold_results:
        if abs(f.train_r) > 0.01:
            ratios.append(f.test_r / f.train_r)
        else:
            ratios.append(1.0 if abs(f.test_r) < 0.01 else (10.0 if f.test_r > 0 else -10.0))
    
    # Core statistics (THE KEY: use median, not mean)
    median_test_r = median(test_rs)
    mean_test_r = sum(test_rs) / len(test_rs)
    min_test_r = min(test_rs)
    median_train_r = median(train_rs)
    median_ratio = median(ratios)
    
    # Clamp ratio for sanity
    median_ratio = max(-10.0, min(10.0, median_ratio))
    
    # Pessimistic R: median_test_r - λ * |median_train_r - median_test_r|
    gap = abs(median_train_r - median_test_r)
    pessimistic_r = median_test_r - config.pessimistic_lambda * gap
    
    # DD metrics (aggregate across folds)
    dd_pre2x_values = [f.median_dd_pre2x for f in fold_results if f.median_dd_pre2x is not None]
    p75_dd_values = [f.p75_dd_pre2x for f in fold_results if f.p75_dd_pre2x is not None]
    hit2x_values = [f.hit2x_pct for f in fold_results if f.hit2x_pct is not None]
    
    median_dd_pre2x = median(dd_pre2x_values) if dd_pre2x_values else None
    p75_dd_pre2x = median(p75_dd_values) if p75_dd_values else None
    median_hit2x = median(hit2x_values) if hit2x_values else None
    
    # DD penalty
    dd_penalty, dd_category, dd_breakdown = compute_dd_penalty_robust(
        median_dd_pre2x, p75_dd_pre2x, config.dd_penalty_config
    )
    
    # Stress lane (run on each fold, take median)
    stressed_rs = []
    for f in fold_results:
        if f.n_trades > 0:
            stressed_r, stress_bd = simulate_stress_r(
                f.test_r, f.avg_r, f.win_rate, f.n_trades, f.avg_r_loss, config.stress_config
            )
            stressed_rs.append(stressed_r)
            f.stressed_r = stressed_r
            f.stress_breakdown = stress_bd
    
    median_stressed_r = median(stressed_rs) if stressed_rs else None
    
    # Stress penalty: difference between normal and stressed performance
    stress_penalty = 0.0
    stress_breakdown = {}
    if median_stressed_r is not None:
        stress_diff = median_test_r - median_stressed_r
        if stress_diff > 0:
            # Penalty scales with how much performance degrades under stress
            stress_penalty = stress_diff * config.stress_weight
        stress_breakdown = {
            "median_stressed_r": median_stressed_r,
            "stress_diff": stress_diff,
            "stress_penalty": stress_penalty,
        }
    
    # Gates
    gate_failures = []
    
    if p75_dd_pre2x is not None and p75_dd_pre2x > config.gate_max_p75_dd:
        gate_failures.append(f"p75_dd={p75_dd_pre2x:.0%}>{config.gate_max_p75_dd:.0%}")
    
    if median_dd_pre2x is not None and median_dd_pre2x > config.gate_max_median_dd:
        gate_failures.append(f"med_dd={median_dd_pre2x:.0%}>{config.gate_max_median_dd:.0%}")
    
    if median_hit2x is not None and median_hit2x < config.gate_min_hit2x:
        gate_failures.append(f"hit2x={median_hit2x:.0%}<{config.gate_min_hit2x:.0%}")
    
    if median_test_r < config.gate_min_test_r:
        gate_failures.append(f"test_r={median_test_r:+.1f}<{config.gate_min_test_r}")
    
    if median_ratio < config.gate_min_ratio:
        gate_failures.append(f"ratio={median_ratio:.2f}<{config.gate_min_ratio:.2f}")
    
    # Fold survival: check how many folds are positive
    n_positive_folds = sum(1 for r in test_rs if r > 0)
    pct_positive = n_positive_folds / len(test_rs) if test_rs else 0.0
    if pct_positive < config.min_folds_positive:
        gate_failures.append(f"fold_survival={pct_positive:.0%}<{config.min_folds_positive:.0%}")
    
    passes_gates = len(gate_failures) == 0
    
    # Final robust score
    # Start with median TestR (not mean!)
    base_score = median_test_r
    
    # Subtract penalties
    robust_score = base_score - dd_penalty - stress_penalty
    
    # Gate failure penalty
    if not passes_gates:
        robust_score -= 50.0  # Heavy penalty for failing gates
    
    return RobustObjectiveResult(
        robust_score=robust_score,
        median_test_r=median_test_r,
        mean_test_r=mean_test_r,
        min_test_r=min_test_r,
        median_train_r=median_train_r,
        median_ratio=median_ratio,
        pessimistic_r=pessimistic_r,
        dd_penalty=dd_penalty,
        dd_category=dd_category,
        dd_breakdown=dd_breakdown,
        median_stressed_r=median_stressed_r,
        stress_penalty=stress_penalty,
        stress_breakdown=stress_breakdown,
        passes_gates=passes_gates,
        gate_failures=gate_failures,
        fold_results=fold_results,
    )


# =============================================================================
# PARAMETER ISLAND CLUSTERING
# =============================================================================

@dataclass
class ParameterIsland:
    """
    A cluster of similar parameter combinations.
    
    Represents a "profitable region" in parameter space.
    """
    island_id: int
    centroid: Dict[str, float]        # Center of the cluster
    members: List[Dict[str, Any]]     # All candidates in this island
    
    # Aggregate stats
    mean_robust_score: float
    median_robust_score: float
    best_robust_score: float
    mean_median_test_r: float
    mean_ratio: float
    pct_pass_gates: float
    
    # Spread (how "tight" is the cluster)
    param_spread: Dict[str, float]    # Std dev of each param
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "island_id": self.island_id,
            "centroid": self.centroid,
            "n_members": len(self.members),
            "mean_robust_score": self.mean_robust_score,
            "median_robust_score": self.median_robust_score,
            "best_robust_score": self.best_robust_score,
            "mean_median_test_r": self.mean_median_test_r,
            "mean_ratio": self.mean_ratio,
            "pct_pass_gates": self.pct_pass_gates,
            "param_spread": self.param_spread,
            "members": self.members,
        }


def cluster_parameters(
    candidates: List[Dict[str, Any]],
    n_clusters: int = 3,
    top_n: int = 30,
) -> List[ParameterIsland]:
    """
    Cluster top candidates into parameter islands.
    
    Uses simple k-means on TP/SL parameters.
    
    Args:
        candidates: List of dicts with "params" and "robust_result" keys
        n_clusters: Target number of clusters (2-4)
        top_n: Number of top candidates to cluster
    
    Returns:
        List of ParameterIsland objects
    """
    if not candidates:
        return []
    
    # Take top N by robust_score
    sorted_candidates = sorted(
        candidates,
        key=lambda c: c.get("robust_result", {}).get("robust_score", -999),
        reverse=True
    )[:top_n]
    
    if len(sorted_candidates) < n_clusters:
        n_clusters = max(1, len(sorted_candidates))
    
    # Extract param vectors (TP, SL)
    param_keys = ["tp_mult", "sl_mult"]
    
    def get_param_vec(c: Dict[str, Any]) -> List[float]:
        params = c.get("params", {})
        return [params.get(k, 0.0) for k in param_keys]
    
    # Simple k-means implementation (no numpy dependency)
    vectors = [get_param_vec(c) for c in sorted_candidates]
    
    # Initialize centroids (spread across range)
    min_vals = [min(v[i] for v in vectors) for i in range(len(param_keys))]
    max_vals = [max(v[i] for v in vectors) for i in range(len(param_keys))]
    
    # Evenly spaced initial centroids
    centroids = []
    for k in range(n_clusters):
        frac = (k + 0.5) / n_clusters
        centroid = [min_vals[i] + frac * (max_vals[i] - min_vals[i]) for i in range(len(param_keys))]
        centroids.append(centroid)
    
    # K-means iterations
    for _ in range(20):
        # Assign to nearest centroid
        assignments = []
        for v in vectors:
            dists = [sum((v[i] - c[i])**2 for i in range(len(param_keys))) for c in centroids]
            assignments.append(dists.index(min(dists)))
        
        # Update centroids
        new_centroids = []
        for k in range(n_clusters):
            members = [vectors[i] for i in range(len(vectors)) if assignments[i] == k]
            if members:
                new_centroid = [sum(m[i] for m in members) / len(members) for i in range(len(param_keys))]
            else:
                new_centroid = centroids[k]
            new_centroids.append(new_centroid)
        
        # Check convergence
        if new_centroids == centroids:
            break
        centroids = new_centroids
    
    # Build islands
    islands = []
    for k in range(n_clusters):
        member_indices = [i for i in range(len(sorted_candidates)) if assignments[i] == k]
        if not member_indices:
            continue
        
        members = [sorted_candidates[i] for i in member_indices]
        
        # Stats
        robust_scores = [m.get("robust_result", {}).get("robust_score", 0) for m in members]
        median_test_rs = [m.get("robust_result", {}).get("median_test_r", 0) for m in members]
        ratios = [m.get("robust_result", {}).get("median_ratio", 0) for m in members]
        passes_gates = [m.get("robust_result", {}).get("passes_gates", False) for m in members]
        
        # Param spread
        param_spread = {}
        for pi, pk in enumerate(param_keys):
            values = [m.get("params", {}).get(pk, 0) for m in members]
            mean_val = sum(values) / len(values) if values else 0
            variance = sum((v - mean_val)**2 for v in values) / len(values) if values else 0
            param_spread[pk] = math.sqrt(variance)
        
        island = ParameterIsland(
            island_id=k,
            centroid=dict(zip(param_keys, centroids[k])),
            members=[{
                "params": m.get("params"),
                "robust_score": m.get("robust_result", {}).get("robust_score"),
                "median_test_r": m.get("robust_result", {}).get("median_test_r"),
                "passes_gates": m.get("robust_result", {}).get("passes_gates"),
            } for m in members],
            mean_robust_score=sum(robust_scores) / len(robust_scores) if robust_scores else 0,
            median_robust_score=median(robust_scores) if robust_scores else 0,
            best_robust_score=max(robust_scores) if robust_scores else 0,
            mean_median_test_r=sum(median_test_rs) / len(median_test_rs) if median_test_rs else 0,
            mean_ratio=sum(ratios) / len(ratios) if ratios else 0,
            pct_pass_gates=sum(1 for p in passes_gates if p) / len(passes_gates) if passes_gates else 0,
            param_spread=param_spread,
        )
        islands.append(island)
    
    # Sort islands by mean_robust_score
    islands.sort(key=lambda x: x.mean_robust_score, reverse=True)
    
    # Re-number
    for i, island in enumerate(islands):
        island.island_id = i
    
    return islands


def print_islands(islands: List[ParameterIsland]) -> None:
    """Print parameter islands summary."""
    print(f"\n{'='*80}")
    print(f"PARAMETER ISLANDS ({len(islands)} regions)")
    print(f"{'='*80}")
    
    for island in islands:
        print(f"\n{'─'*60}")
        print(f"ISLAND {island.island_id}: {len(island.members)} candidates")
        print(f"  Centroid: TP={island.centroid.get('tp_mult', 0):.2f}x SL={island.centroid.get('sl_mult', 0):.2f}x")
        print(f"  Spread:   TP±{island.param_spread.get('tp_mult', 0):.2f} SL±{island.param_spread.get('sl_mult', 0):.2f}")
        print(f"  Scores:")
        print(f"    Mean Robust:   {island.mean_robust_score:+.2f}")
        print(f"    Median Robust: {island.median_robust_score:+.2f}")
        print(f"    Best Robust:   {island.best_robust_score:+.2f}")
        print(f"    Mean TestR:    {island.mean_median_test_r:+.2f}")
        print(f"    Mean Ratio:    {island.mean_ratio:.2f}")
        print(f"    % Pass Gates:  {island.pct_pass_gates:.0%}")
        
        # Show top 3 in island
        sorted_members = sorted(island.members, key=lambda m: m.get("robust_score", 0), reverse=True)[:3]
        print(f"  Top 3:")
        for m in sorted_members:
            gate_str = "✓" if m.get("passes_gates") else "✗"
            print(f"    TP={m['params']['tp_mult']:.2f}x SL={m['params']['sl_mult']:.2f}x | "
                  f"Score={m.get('robust_score', 0):+.2f} TestR={m.get('median_test_r', 0):+.2f} {gate_str}")


# =============================================================================
# ISLAND CHAMPION SELECTION
# =============================================================================

@dataclass
class IslandChampion:
    """
    A single champion selected from an island for stress lane validation.
    
    This is the "representative" that will be tested under stress conditions.
    """
    island_id: int
    params: Dict[str, Any]
    discovery_score: float       # Robust score from discovery phase
    median_test_r: float
    passes_gates: bool
    
    # Island context
    island_size: int             # How many candidates in the island
    island_centroid: Dict[str, float]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "island_id": self.island_id,
            "params": self.params,
            "discovery_score": self.discovery_score,
            "median_test_r": self.median_test_r,
            "passes_gates": self.passes_gates,
            "island_size": self.island_size,
            "island_centroid": self.island_centroid,
        }


def extract_island_champions(
    islands: List[ParameterIsland],
    prefer_passing_gates: bool = True,
) -> List[IslandChampion]:
    """
    Select one champion from each island for stress lane validation.
    
    The champion is the best representative of the island - the one most
    likely to survive stress testing while representing the island's region.
    
    Selection criteria:
    1. If prefer_passing_gates=True, prefer candidates that pass gates
    2. Among those, select by highest robust_score
    3. If none pass gates, still select the best (will fail validation gracefully)
    
    Args:
        islands: List of ParameterIsland from cluster_parameters()
        prefer_passing_gates: Whether to prefer gate-passing candidates
    
    Returns:
        List of IslandChampion, one per island
    """
    champions = []
    
    for island in islands:
        if not island.members:
            continue
        
        # Filter to passing candidates if preferred
        candidates = island.members
        if prefer_passing_gates:
            passing = [m for m in island.members if m.get("passes_gates", False)]
            if passing:
                candidates = passing
        
        # Select best by robust_score
        best = max(candidates, key=lambda m: m.get("robust_score", -999))
        
        champion = IslandChampion(
            island_id=island.island_id,
            params=best.get("params", {}),
            discovery_score=best.get("robust_score", 0.0),
            median_test_r=best.get("median_test_r", 0.0),
            passes_gates=best.get("passes_gates", False),
            island_size=len(island.members),
            island_centroid=island.centroid,
        )
        champions.append(champion)
    
    return champions


def print_island_champions(champions: List[IslandChampion]) -> None:
    """Print island champions summary."""
    print(f"\n{'='*80}")
    print(f"ISLAND CHAMPIONS ({len(champions)} selected for validation)")
    print(f"{'='*80}")
    
    for champ in champions:
        params = champ.params
        gate_str = "✓" if champ.passes_gates else "✗"
        print(f"\nIsland {champ.island_id} Champion:")
        print(f"  Params:    TP={params.get('tp_mult', 0):.2f}x SL={params.get('sl_mult', 0):.2f}x")
        print(f"  Centroid:  TP={champ.island_centroid.get('tp_mult', 0):.2f}x SL={champ.island_centroid.get('sl_mult', 0):.2f}x")
        print(f"  Discovery: Score={champ.discovery_score:+.2f} TestR={champ.median_test_r:+.2f} {gate_str}")
        print(f"  Island:    {champ.island_size} candidates")


# =============================================================================
# CONSOLIDATED EVALUATION ENTRY POINT
# =============================================================================

def evaluate_candidate_robust(
    params: Dict[str, Any],
    fold_results: List[FoldResult],
    config: RobustObjectiveConfig = DEFAULT_ROBUST_CONFIG,
) -> Dict[str, Any]:
    """
    Evaluate a candidate using robust objective.
    
    This is the main entry point for the robust region finder.
    
    Args:
        params: Parameter dict (tp_mult, sl_mult, etc.)
        fold_results: Results from each walk-forward fold
        config: Objective configuration
    
    Returns:
        Dict with params and robust_result
    """
    robust_result = compute_robust_objective(fold_results, config)
    
    return {
        "params": params,
        "robust_result": robust_result.to_dict(),
        "robust_score": robust_result.robust_score,
        "passes_gates": robust_result.passes_gates,
    }

