"""
Optimizer Objective Function - R-space scoring with penalties and boosts.

The objective function converts raw backtest results into a single score
that the optimizer maximizes. The score is designed to:

1. Anchor on AvgR / TotalR (risk-adjusted returns)
2. Penalize things you hate (large DD_pre2x)
3. Boost things you love (fast time_to_2x, fat tails)

The key insight: because everything is in R-space, the optimizer can
safely compare stops of different widths without lying to itself.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ObjectiveConfig:
    """
    Configuration for the objective function.
    
    All penalties/boosts are tunable. The defaults match your instincts:
    - Hard penalty on DD_pre2x > 30%
    - Brutal penalty beyond 60%
    - Strong boost for fast time_to_2x
    - Bonus for fat right tail
    """
    
    # === Primary objective ===
    # What we're maximizing (before penalties/boosts)
    primary_metric: str = "avg_r"  # "avg_r" | "total_r" | "expectancy_r"
    
    # === Drawdown penalty ===
    # Penalty = exp(k * max(0, dd_pre2x - threshold)) - 1
    dd_penalty_threshold: float = 0.30  # Start penalizing at 30% DD
    dd_penalty_k: float = 5.0  # Steepness (higher = harsher)
    dd_brutal_threshold: float = 0.60  # "Abandon hope" level
    dd_brutal_multiplier: float = 10.0  # Extra multiplier beyond brutal
    
    # === Timing boost ===
    # Boost = a / (time_to_2x_minutes + b)
    timing_boost_a: float = 60.0  # Numerator (higher = stronger boost)
    timing_boost_b: float = 60.0  # Offset (prevents division by tiny values)
    timing_boost_max: float = 0.5  # Cap the boost contribution
    
    # === Tail bonus ===
    # Bonus for asymmetric upside (p95 ATH >> p75 ATH)
    tail_bonus_weight: float = 0.1  # Weight of tail bonus
    tail_bonus_metric: str = "log_p95"  # "log_p95" | "p95_minus_p75" | "p95_ratio"
    
    # === Win rate floor ===
    # Minimum win rate to be considered valid
    min_win_rate: float = 0.20  # 20% minimum
    win_rate_penalty_k: float = 5.0  # Steepness of penalty below threshold
    
    # === Implied loss R check ===
    # If avg loss R drifts away from -1R, penalize (catches stop gapping)
    expected_loss_r: float = -1.0
    loss_r_tolerance: float = 0.3  # Allow ±0.3R drift
    loss_r_penalty_k: float = 2.0  # Penalty for exceeding tolerance
    
    # === Weights ===
    # How to combine components into final score
    primary_weight: float = 1.0
    dd_penalty_weight: float = 1.0
    timing_boost_weight: float = 0.3
    tail_bonus_weight_final: float = 0.2
    win_rate_penalty_weight: float = 0.5
    loss_r_penalty_weight: float = 0.3
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "primary_metric": self.primary_metric,
            "dd_penalty_threshold": self.dd_penalty_threshold,
            "dd_penalty_k": self.dd_penalty_k,
            "dd_brutal_threshold": self.dd_brutal_threshold,
            "dd_brutal_multiplier": self.dd_brutal_multiplier,
            "timing_boost_a": self.timing_boost_a,
            "timing_boost_b": self.timing_boost_b,
            "timing_boost_max": self.timing_boost_max,
            "tail_bonus_weight": self.tail_bonus_weight,
            "tail_bonus_metric": self.tail_bonus_metric,
            "min_win_rate": self.min_win_rate,
            "win_rate_penalty_k": self.win_rate_penalty_k,
            "expected_loss_r": self.expected_loss_r,
            "loss_r_tolerance": self.loss_r_tolerance,
            "loss_r_penalty_k": self.loss_r_penalty_k,
            "primary_weight": self.primary_weight,
            "dd_penalty_weight": self.dd_penalty_weight,
            "timing_boost_weight": self.timing_boost_weight,
            "tail_bonus_weight_final": self.tail_bonus_weight_final,
            "win_rate_penalty_weight": self.win_rate_penalty_weight,
            "loss_r_penalty_weight": self.loss_r_penalty_weight,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ObjectiveConfig":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# Default config matching your instincts
DEFAULT_OBJECTIVE_CONFIG = ObjectiveConfig()

# Conservative config - prioritizes consistency over upside
CONSERVATIVE_OBJECTIVE_CONFIG = ObjectiveConfig(
    dd_penalty_threshold=0.20,
    dd_penalty_k=8.0,
    min_win_rate=0.30,
    tail_bonus_weight=0.05,
)

# Aggressive config - accepts more DD for upside
AGGRESSIVE_OBJECTIVE_CONFIG = ObjectiveConfig(
    dd_penalty_threshold=0.40,
    dd_penalty_k=3.0,
    dd_brutal_threshold=0.70,
    min_win_rate=0.15,
    tail_bonus_weight=0.2,
)


@dataclass
class ObjectiveComponents:
    """
    Breakdown of objective function components.
    
    Useful for understanding what's driving the score.
    """
    primary_value: float = 0.0
    dd_penalty: float = 0.0
    timing_boost: float = 0.0
    tail_bonus: float = 0.0
    win_rate_penalty: float = 0.0
    loss_r_penalty: float = 0.0
    
    final_score: float = 0.0
    
    def to_dict(self) -> Dict[str, float]:
        return {
            "primary_value": self.primary_value,
            "dd_penalty": self.dd_penalty,
            "timing_boost": self.timing_boost,
            "tail_bonus": self.tail_bonus,
            "win_rate_penalty": self.win_rate_penalty,
            "loss_r_penalty": self.loss_r_penalty,
            "final_score": self.final_score,
        }


def compute_dd_penalty(
    dd_pre2x_median: float,
    config: ObjectiveConfig,
) -> float:
    """
    Compute drawdown penalty.
    
    Penalty = exp(k * max(0, dd - threshold)) - 1
    
    Beyond brutal threshold, multiply by brutal_multiplier.
    """
    if dd_pre2x_median <= config.dd_penalty_threshold:
        return 0.0
    
    excess = dd_pre2x_median - config.dd_penalty_threshold
    
    # Base exponential penalty
    penalty = math.exp(config.dd_penalty_k * excess) - 1
    
    # Brutal zone multiplier
    if dd_pre2x_median > config.dd_brutal_threshold:
        brutal_excess = dd_pre2x_median - config.dd_brutal_threshold
        penalty *= (1 + config.dd_brutal_multiplier * brutal_excess)
    
    return penalty


def compute_timing_boost(
    time_to_2x_median_minutes: float,
    config: ObjectiveConfig,
) -> float:
    """
    Compute timing boost.
    
    Boost = a / (time_to_2x + b)
    
    Diminishing returns, but strongly rewards fast.
    """
    if time_to_2x_median_minutes <= 0 or math.isnan(time_to_2x_median_minutes):
        return 0.0
    
    boost = config.timing_boost_a / (time_to_2x_median_minutes + config.timing_boost_b)
    return min(boost, config.timing_boost_max)


def compute_tail_bonus(
    p75_ath: float,
    p95_ath: float,
    config: ObjectiveConfig,
) -> float:
    """
    Compute tail bonus for asymmetric upside.
    
    Options:
    - log_p95: log(p95_ath)
    - p95_minus_p75: p95 - p75 (rewards spread)
    - p95_ratio: p95 / p75 (rewards fat tail ratio)
    """
    if p95_ath <= 0 or math.isnan(p95_ath):
        return 0.0
    
    if config.tail_bonus_metric == "log_p95":
        # Higher p95 = bigger bonus
        bonus = math.log(max(p95_ath, 1.0)) * config.tail_bonus_weight
    elif config.tail_bonus_metric == "p95_minus_p75":
        # Bigger spread between p95 and p75 = bigger bonus
        spread = max(0, p95_ath - p75_ath)
        bonus = spread * config.tail_bonus_weight
    elif config.tail_bonus_metric == "p95_ratio":
        # Higher ratio = fatter tail
        if p75_ath > 0:
            ratio = p95_ath / p75_ath
            bonus = (ratio - 1) * config.tail_bonus_weight
        else:
            bonus = 0.0
    else:
        bonus = 0.0
    
    return bonus


def compute_win_rate_penalty(
    win_rate: float,
    config: ObjectiveConfig,
) -> float:
    """
    Compute penalty for win rate below minimum.
    
    Exponential penalty below threshold.
    """
    if win_rate >= config.min_win_rate:
        return 0.0
    
    deficit = config.min_win_rate - win_rate
    return math.exp(config.win_rate_penalty_k * deficit) - 1


def compute_loss_r_penalty(
    avg_loss_r: float,
    config: ObjectiveConfig,
) -> float:
    """
    Compute penalty for implied loss R drifting from -1R.
    
    This catches stop gapping / execution weirdness.
    If losses are averaging -1.5R instead of -1R, something's wrong.
    """
    if avg_loss_r == 0 or math.isnan(avg_loss_r):
        return 0.0
    
    # Expected is -1R, so avg_loss_r should be close to -1
    drift = abs(avg_loss_r - config.expected_loss_r)
    
    if drift <= config.loss_r_tolerance:
        return 0.0
    
    excess = drift - config.loss_r_tolerance
    return excess * config.loss_r_penalty_k


def compute_objective(
    summary: Dict[str, Any],
    config: Optional[ObjectiveConfig] = None,
) -> ObjectiveComponents:
    """
    Compute the full objective function from backtest summary.
    
    Args:
        summary: Backtest summary dict with R-space metrics
        config: Objective configuration (default: DEFAULT_OBJECTIVE_CONFIG)
    
    Returns:
        ObjectiveComponents with breakdown and final score
    """
    if config is None:
        config = DEFAULT_OBJECTIVE_CONFIG
    
    components = ObjectiveComponents()
    
    # === Primary metric ===
    if config.primary_metric == "avg_r":
        components.primary_value = summary.get("avg_r", 0.0)
    elif config.primary_metric == "total_r":
        components.primary_value = summary.get("total_r", 0.0)
    elif config.primary_metric == "expectancy_r":
        # Expectancy = (WR * AvgWinR) + ((1-WR) * AvgLossR)
        wr = summary.get("tp_sl_win_rate", 0.0)
        avg_win_r = summary.get("avg_r_win", 0.0)
        avg_loss_r = summary.get("avg_r_loss", -1.0)
        components.primary_value = (wr * avg_win_r) + ((1 - wr) * avg_loss_r)
    else:
        components.primary_value = summary.get(config.primary_metric, 0.0)
    
    # === Drawdown penalty ===
    dd_pre2x_median = summary.get("dd_pre2x_median", 0.0)
    if dd_pre2x_median is None:
        dd_pre2x_median = 0.0
    components.dd_penalty = compute_dd_penalty(dd_pre2x_median, config)
    
    # === Timing boost ===
    time_to_2x_median = summary.get("time_to_2x_median_min", 0.0)
    if time_to_2x_median is None:
        time_to_2x_median = float("inf")
    components.timing_boost = compute_timing_boost(time_to_2x_median, config)
    
    # === Tail bonus ===
    p75_ath = summary.get("p75_ath", 1.0)
    p95_ath = summary.get("p95_ath", 1.0)
    if p75_ath is None:
        p75_ath = 1.0
    if p95_ath is None:
        p95_ath = 1.0
    components.tail_bonus = compute_tail_bonus(p75_ath, p95_ath, config)
    
    # === Win rate penalty ===
    win_rate = summary.get("tp_sl_win_rate", 0.0)
    if win_rate is None:
        win_rate = 0.0
    components.win_rate_penalty = compute_win_rate_penalty(win_rate, config)
    
    # === Loss R penalty ===
    avg_loss_r = summary.get("avg_r_loss", -1.0)
    if avg_loss_r is None:
        avg_loss_r = -1.0
    components.loss_r_penalty = compute_loss_r_penalty(avg_loss_r, config)
    
    # === Combine into final score ===
    score = (
        config.primary_weight * components.primary_value
        - config.dd_penalty_weight * components.dd_penalty
        + config.timing_boost_weight * components.timing_boost
        + config.tail_bonus_weight_final * components.tail_bonus
        - config.win_rate_penalty_weight * components.win_rate_penalty
        - config.loss_r_penalty_weight * components.loss_r_penalty
    )
    
    components.final_score = score
    return components


def score_result(
    summary: Dict[str, Any],
    config: Optional[ObjectiveConfig] = None,
) -> float:
    """
    Quick helper to get just the final score.
    """
    return compute_objective(summary, config).final_score


def print_objective_breakdown(
    components: ObjectiveComponents,
    config: Optional[ObjectiveConfig] = None,
) -> None:
    """
    Print a human-readable breakdown of the objective function.
    """
    if config is None:
        config = DEFAULT_OBJECTIVE_CONFIG
    
    print(f"  Primary ({config.primary_metric}): {components.primary_value:+.4f} × {config.primary_weight}")
    print(f"  DD penalty:        -{components.dd_penalty:.4f} × {config.dd_penalty_weight}")
    print(f"  Timing boost:      +{components.timing_boost:.4f} × {config.timing_boost_weight}")
    print(f"  Tail bonus:        +{components.tail_bonus:.4f} × {config.tail_bonus_weight_final}")
    print(f"  Win rate penalty:  -{components.win_rate_penalty:.4f} × {config.win_rate_penalty_weight}")
    print(f"  Loss R penalty:    -{components.loss_r_penalty:.4f} × {config.loss_r_penalty_weight}")
    print(f"  ─────────────────────────────")
    print(f"  FINAL SCORE:       {components.final_score:+.4f}")

