"""
Optimizer Objective Functions

The scoring system for parameter optimization. Designed to:
1. Reward R-multiple performance (AvgR, TotalR)
2. Penalize high drawdown (exponential pain after threshold)
3. Boost fast time-to-2x
4. Bonus for discipline (high hit rate + low DD)
5. Bonus for fat right tail (p75/p95 upside)

Philosophy: "Find parameters that make money without psychological nightmares."
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class ObjectiveConfig:
    """
    Configuration for the optimizer objective function.
    
    Tunables are organized by category:
    - DD penalty: exponential pain for high drawdown
    - Time boost: reward for fast time-to-2x
    - Discipline bonus: synergy for hit rate + low DD
    - Tail bonus: reward for fat right tail
    - R-weighting: how much to weight AvgR vs TotalR
    """
    
    # === DD Penalty (exponential) ===
    # Penalty = exp(dd_rate * max(0, dd - dd_threshold)) - 1
    # At dd_threshold: penalty = 0
    # At dd_nuclear: penalty is massive (effectively disqualifies)
    dd_threshold: float = 0.30      # Penalty starts here (30% DD)
    dd_nuclear: float = 0.60        # "Abandon hope" zone (60% DD)
    dd_rate: float = 8.0            # Exponential rate (tuned so nuclear ≈ 10x penalty)
    dd_weight: float = 1.0          # Multiplier for DD penalty in final score
    
    # === Time Boost (hyperbolic) ===
    # Boost = time_max_boost / (1 + time_to_2x_min / time_halflife)
    # Fast = big boost, slow = small boost, asymptotes to 0
    time_max_boost: float = 0.50    # Max boost when instant (50% lift)
    time_halflife_min: float = 30.0 # Minutes at which boost = max/2
    time_weight: float = 1.0        # Multiplier for time boost
    
    # === Discipline Bonus ===
    # Awarded when hit2x >= threshold AND dd <= threshold
    # "Low risk, high hit rate" synergy
    discipline_hit2x_threshold: float = 0.50  # 50% hit rate
    discipline_dd_threshold: float = 0.30     # 30% DD
    discipline_bonus: float = 0.30            # Bonus amount
    
    # === Tail Bonus ===
    # Rewards fat right tail (p95 >> p75 >> median)
    # tail_bonus = p75_weight * (p75 - median) + p95_weight * (p95 - p75)
    tail_p75_weight: float = 0.10
    tail_p95_weight: float = 0.05
    
    # === R-weighting ===
    # Final score base = avg_r_weight * AvgR + total_r_weight * TotalR / n_trades
    # Usually just use AvgR (total_r_weight = 0)
    avg_r_weight: float = 1.0
    total_r_weight: float = 0.0  # Normalized by n_trades if used
    
    # === Sample size adjustment ===
    # confidence = sqrt(n / (n + k))
    # Shrinks scores for small samples
    confidence_k: float = 30.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "dd_threshold": self.dd_threshold,
            "dd_nuclear": self.dd_nuclear,
            "dd_rate": self.dd_rate,
            "dd_weight": self.dd_weight,
            "time_max_boost": self.time_max_boost,
            "time_halflife_min": self.time_halflife_min,
            "time_weight": self.time_weight,
            "discipline_hit2x_threshold": self.discipline_hit2x_threshold,
            "discipline_dd_threshold": self.discipline_dd_threshold,
            "discipline_bonus": self.discipline_bonus,
            "tail_p75_weight": self.tail_p75_weight,
            "tail_p95_weight": self.tail_p95_weight,
            "avg_r_weight": self.avg_r_weight,
            "total_r_weight": self.total_r_weight,
            "confidence_k": self.confidence_k,
        }


# Default config (tuned for your use case)
DEFAULT_OBJECTIVE_CONFIG = ObjectiveConfig()


def compute_dd_penalty(
    dd_magnitude: float,
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute exponential drawdown penalty.
    
    Args:
        dd_magnitude: Drawdown as positive decimal (0.30 = 30% DD)
        config: Objective configuration
    
    Returns:
        Penalty value (0 if dd <= threshold, exponential growth after)
    
    Examples:
        dd=0.20 → 0.0 (below threshold)
        dd=0.35 → exp(8 * 0.05) - 1 ≈ 0.49
        dd=0.50 → exp(8 * 0.20) - 1 ≈ 3.95
        dd=0.60 → exp(8 * 0.30) - 1 ≈ 10.0 (nuclear)
    """
    excess = max(0.0, dd_magnitude - config.dd_threshold)
    if excess <= 0:
        return 0.0
    return math.exp(config.dd_rate * excess) - 1.0


def compute_time_boost(
    time_to_2x_min: Optional[float],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute hyperbolic time-to-2x boost.
    
    Args:
        time_to_2x_min: Time to 2x in minutes (None if never hit)
        config: Objective configuration
    
    Returns:
        Boost value (0 to max_boost)
    
    Examples:
        t=0 → max_boost (instant)
        t=halflife → max_boost / 2
        t=inf → 0
    """
    if time_to_2x_min is None or time_to_2x_min < 0:
        return 0.0
    return config.time_max_boost / (1.0 + time_to_2x_min / config.time_halflife_min)


def compute_discipline_bonus(
    hit2x_pct: float,
    dd_magnitude: float,
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute discipline bonus (low DD + high hit rate synergy).
    
    Args:
        hit2x_pct: Hit 2x rate as decimal (0.50 = 50%)
        dd_magnitude: Drawdown as positive decimal
        config: Objective configuration
    
    Returns:
        Bonus value (0 or discipline_bonus)
    """
    if hit2x_pct >= config.discipline_hit2x_threshold and dd_magnitude <= config.discipline_dd_threshold:
        return config.discipline_bonus
    return 0.0


def compute_tail_bonus(
    median_ath: float,
    p75_ath: Optional[float],
    p95_ath: Optional[float],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute tail bonus (fat right tail reward).
    
    Args:
        median_ath: Median ATH multiple
        p75_ath: 75th percentile ATH
        p95_ath: 95th percentile ATH
        config: Objective configuration
    
    Returns:
        Bonus value
    """
    bonus = 0.0
    
    if p75_ath is not None and p75_ath > median_ath:
        bonus += config.tail_p75_weight * (p75_ath - median_ath)
    
    if p95_ath is not None and p75_ath is not None and p95_ath > p75_ath:
        bonus += config.tail_p95_weight * (p95_ath - p75_ath)
    
    return bonus


def compute_confidence(
    n_trades: int,
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute sample size confidence adjustment.
    
    Args:
        n_trades: Number of trades
        config: Objective configuration
    
    Returns:
        Confidence multiplier (0 to 1)
    """
    if n_trades <= 0:
        return 0.0
    return math.sqrt(n_trades / (n_trades + config.confidence_k))


@dataclass
class ObjectiveResult:
    """Result of computing the objective function (also aliased as ObjectiveComponents)."""
    
    # Inputs
    avg_r: float
    total_r: float
    n_trades: int
    dd_magnitude: float
    time_to_2x_min: Optional[float]
    hit2x_pct: float
    median_ath: float
    p75_ath: Optional[float]
    p95_ath: Optional[float]
    
    # Components
    base_score: float = 0.0
    dd_penalty: float = 0.0
    time_boost: float = 0.0
    discipline_bonus: float = 0.0
    tail_bonus: float = 0.0
    confidence: float = 1.0
    
    # Final
    raw_score: float = 0.0
    final_score: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "avg_r": self.avg_r,
            "total_r": self.total_r,
            "n_trades": self.n_trades,
            "dd_magnitude": self.dd_magnitude,
            "time_to_2x_min": self.time_to_2x_min,
            "hit2x_pct": self.hit2x_pct,
            "median_ath": self.median_ath,
            "p75_ath": self.p75_ath,
            "p95_ath": self.p95_ath,
            "base_score": self.base_score,
            "dd_penalty": self.dd_penalty,
            "time_boost": self.time_boost,
            "discipline_bonus": self.discipline_bonus,
            "tail_bonus": self.tail_bonus,
            "confidence": self.confidence,
            "raw_score": self.raw_score,
            "final_score": self.final_score,
        }


def compute_objective(
    avg_r: float,
    total_r: float,
    n_trades: int,
    dd_magnitude: float,
    time_to_2x_min: Optional[float] = None,
    hit2x_pct: float = 0.0,
    median_ath: float = 1.0,
    p75_ath: Optional[float] = None,
    p95_ath: Optional[float] = None,
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> ObjectiveResult:
    """
    Compute the full objective function.
    
    Score = confidence * (
        base_score
        + time_boost * time_weight
        + discipline_bonus
        + tail_bonus
        - dd_penalty * dd_weight
    )
    
    Args:
        avg_r: Average R per trade
        total_r: Total R
        n_trades: Number of trades
        dd_magnitude: Drawdown as positive decimal (0.30 = 30%)
        time_to_2x_min: Median time to 2x in minutes
        hit2x_pct: Hit 2x rate as decimal
        median_ath: Median ATH multiple
        p75_ath: 75th percentile ATH
        p95_ath: 95th percentile ATH
        config: Objective configuration
    
    Returns:
        ObjectiveResult with all components
    """
    result = ObjectiveResult(
        avg_r=avg_r,
        total_r=total_r,
        n_trades=n_trades,
        dd_magnitude=dd_magnitude,
        time_to_2x_min=time_to_2x_min,
        hit2x_pct=hit2x_pct,
        median_ath=median_ath,
        p75_ath=p75_ath,
        p95_ath=p95_ath,
    )
    
    # Base score from R performance
    result.base_score = config.avg_r_weight * avg_r
    if config.total_r_weight > 0 and n_trades > 0:
        result.base_score += config.total_r_weight * (total_r / n_trades)
    
    # Penalty for high drawdown
    result.dd_penalty = compute_dd_penalty(dd_magnitude, config)
    
    # Boost for fast time-to-2x
    result.time_boost = compute_time_boost(time_to_2x_min, config)
    
    # Discipline bonus
    result.discipline_bonus = compute_discipline_bonus(hit2x_pct, dd_magnitude, config)
    
    # Tail bonus
    result.tail_bonus = compute_tail_bonus(median_ath, p75_ath, p95_ath, config)
    
    # Confidence adjustment
    result.confidence = compute_confidence(n_trades, config)
    
    # Raw score (before confidence)
    result.raw_score = (
        result.base_score
        + result.time_boost * config.time_weight
        + result.discipline_bonus
        + result.tail_bonus
        - result.dd_penalty * config.dd_weight
    )
    
    # Final score
    result.final_score = result.confidence * result.raw_score
    
    return result


def score_from_summary(
    summary: Dict[str, Any],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> ObjectiveResult:
    """
    Compute objective from a backtest summary dict.
    
    Args:
        summary: Summary dict from summarize_tp_sl()
        config: Objective configuration
    
    Returns:
        ObjectiveResult
    """
    # Extract R metrics
    avg_r = summary.get("avg_r", 0.0)
    total_r = summary.get("total_r", 0.0)
    n_trades = summary.get("alerts_ok", 0)
    
    # Extract DD (convert from pct to decimal magnitude)
    dd_pct = summary.get("median_dd_initial", 0.0)
    if dd_pct is None:
        dd_pct = summary.get("median_dd_overall", 0.0) or 0.0
    dd_magnitude = abs(dd_pct) / 100.0 if abs(dd_pct) > 1 else abs(dd_pct)
    
    # Extract time to 2x (convert from seconds to minutes if needed)
    time_to_2x_s = summary.get("median_time_to_2x_s")
    time_to_2x_min = time_to_2x_s / 60.0 if time_to_2x_s is not None else None
    
    # Extract hit rate
    hit2x_pct = summary.get("pct_hit_2x", 0.0) or 0.0
    
    # Extract ATH metrics
    median_ath = summary.get("median_ath_mult", 1.0) or 1.0
    p75_ath = summary.get("p75_ath_mult")
    p95_ath = summary.get("p95_ath_mult")
    
    return compute_objective(
        avg_r=avg_r,
        total_r=total_r,
        n_trades=n_trades,
        dd_magnitude=dd_magnitude,
        time_to_2x_min=time_to_2x_min,
        hit2x_pct=hit2x_pct,
        median_ath=median_ath,
        p75_ath=p75_ath,
        p95_ath=p95_ath,
        config=config,
    )


# =============================================================================
# Implied AvgLossR Sanity Check
# =============================================================================

def compute_implied_avg_loss_r(
    avg_r: float,
    win_rate: float,
    avg_r_win: float,
) -> float:
    """
    Compute implied average loss R from the expectancy equation.
    
    AvgR = WinRate * AvgRWin + (1 - WinRate) * AvgRLoss
    
    Solving for AvgRLoss:
    AvgRLoss = (AvgR - WinRate * AvgRWin) / (1 - WinRate)
    
    If this drifts significantly from -1R, it indicates:
    - Stop gapping (gaps through stop = bigger losses)
    - Execution slippage beyond modeled
    - Fees eating into stop distance
    
    Args:
        avg_r: Average R per trade
        win_rate: Win rate as decimal (0.35 = 35%)
        avg_r_win: Average R on winning trades
    
    Returns:
        Implied average R on losing trades (should be close to -1R)
    """
    if win_rate >= 1.0:
        return 0.0  # No losses
    if win_rate <= 0.0:
        return avg_r  # All losses, avg_r is avg_r_loss
    
    return (avg_r - win_rate * avg_r_win) / (1.0 - win_rate)


def check_loss_r_sanity(
    summary: Dict[str, Any],
    expected_loss_r: float = -1.0,
    tolerance: float = 0.15,
) -> Dict[str, Any]:
    """
    Check if implied AvgLossR is close to expected.
    
    Args:
        summary: Backtest summary dict
        expected_loss_r: Expected loss R (usually -1.0)
        tolerance: Allowed deviation (0.15 = 15%)
    
    Returns:
        Dict with sanity check results
    """
    avg_r = summary.get("avg_r", 0.0)
    win_rate = summary.get("tp_sl_win_rate", 0.0)
    avg_r_win = summary.get("avg_r_win", 0.0)
    avg_r_loss = summary.get("avg_r_loss", 0.0)
    
    implied_loss_r = compute_implied_avg_loss_r(avg_r, win_rate, avg_r_win)
    deviation = abs(implied_loss_r - expected_loss_r)
    is_sane = deviation <= tolerance
    
    return {
        "avg_r": avg_r,
        "win_rate": win_rate,
        "avg_r_win": avg_r_win,
        "avg_r_loss_actual": avg_r_loss,
        "avg_r_loss_implied": implied_loss_r,
        "expected_loss_r": expected_loss_r,
        "deviation": deviation,
        "is_sane": is_sane,
        "warning": None if is_sane else f"Implied AvgLossR ({implied_loss_r:.2f}) deviates {deviation:.2f} from expected ({expected_loss_r:.2f})",
    }


# =============================================================================
# Print helpers
# =============================================================================

def print_objective_breakdown(result: ObjectiveResult) -> None:
    """Print a breakdown of the objective function components."""
    print(f"Objective Breakdown:")
    print(f"  Base (AvgR):       {result.base_score:+.3f}")
    print(f"  - DD Penalty:      {result.dd_penalty:+.3f} (DD={result.dd_magnitude:.1%})")
    print(f"  + Time Boost:      {result.time_boost:+.3f} (t2x={result.time_to_2x_min:.0f}m)" if result.time_to_2x_min else f"  + Time Boost:      {result.time_boost:+.3f} (no 2x)")
    print(f"  + Discipline:      {result.discipline_bonus:+.3f}")
    print(f"  + Tail Bonus:      {result.tail_bonus:+.3f}")
    print(f"  × Confidence:      {result.confidence:.3f} (n={result.n_trades})")
    print(f"  ─────────────────────")
    print(f"  Raw Score:         {result.raw_score:+.3f}")
    print(f"  Final Score:       {result.final_score:+.3f}")


# =============================================================================
# Backwards compatibility alias
# =============================================================================

# ObjectiveComponents is an alias for ObjectiveResult
ObjectiveComponents = ObjectiveResult
