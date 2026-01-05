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
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ObjectiveConfig:
    """
    Configuration for the optimizer objective function.
    
    Tunables are organized by category:
    - DD penalty: TIERED exponential pain for drawdown at different stages
    - Time boost: reward for fast time-to-tiers (1.2x, 1.5x, 2x)
    - Discipline bonus: synergy for hit rate + low early DD
    - Tail bonus: reward for fat right tail
    - R-weighting: how much to weight AvgR vs TotalR
    
    NEW: Tiered DD scoring based on stage of trade:
    - dd_pre_1_2x: Most critical (risk of ruin before any profit)
    - dd_pre_1_5x: Important (still underwater-ish)
    - dd_pre_2x: Less critical (approaching TP range)
    """
    
    # === TIERED DD Penalty (exponential with tier weights) ===
    # Total DD penalty = sum of tier penalties weighted by importance
    # Early DD is penalized more severely than later DD
    
    # Tier 1: DD before 1.2x (most critical - "ruin zone")
    dd_pre_1_2x_threshold: float = 0.20   # Penalty starts at 20% DD
    dd_pre_1_2x_nuclear: float = 0.50     # Nuclear at 50% DD
    dd_pre_1_2x_rate: float = 6.0         # Exponential rate
    dd_pre_1_2x_weight: float = 2.0       # 2x weight (most important)
    
    # Tier 2: DD before 1.5x (important - "danger zone")
    dd_pre_1_5x_threshold: float = 0.30   # Penalty starts at 30% DD  
    dd_pre_1_5x_nuclear: float = 0.60     # Nuclear at 60% DD
    dd_pre_1_5x_rate: float = 5.0         # Slightly softer curve
    dd_pre_1_5x_weight: float = 1.5       # 1.5x weight
    
    # Tier 3: DD before 2x (less critical - "approaching TP")
    dd_pre_2x_threshold: float = 0.40     # Penalty starts at 40% DD
    dd_pre_2x_nuclear: float = 0.70       # Nuclear at 70% DD  
    dd_pre_2x_rate: float = 4.0           # Even softer curve
    dd_pre_2x_weight: float = 1.0         # Base weight
    
    # Legacy fallback (if tier data not available)
    dd_threshold: float = 0.50            # RECALIBRATED: was 0.30, now 0.50
    dd_nuclear: float = 0.80              # RECALIBRATED: was 0.60, now 0.80
    dd_rate: float = 6.0                  # RECALIBRATED: was 8.0, now 6.0
    dd_weight: float = 1.0                # Multiplier for DD penalty in final score
    
    # === Time Boost (hyperbolic, now tier-aware) ===
    # Boost for hitting 1.2x fast, then 1.5x, then 2x
    time_max_boost: float = 0.50          # Max boost when instant
    time_halflife_min: float = 30.0       # Minutes at which boost = max/2
    time_weight: float = 1.0              # Multiplier for time boost
    # Tier-specific time boosts (smaller boosts for intermediate tiers)
    time_1_2x_weight: float = 0.3         # Small boost for fast 1.2x
    time_1_5x_weight: float = 0.4         # Medium boost for fast 1.5x
    time_2x_weight: float = 0.5           # Main boost for fast 2x
    
    # === Discipline Bonus ===
    # Awarded when hit2x >= threshold AND early_dd <= threshold
    discipline_hit2x_threshold: float = 0.40  # RECALIBRATED: was 0.50, now 0.40
    discipline_dd_threshold: float = 0.40     # RECALIBRATED: was 0.30, now 0.40
    discipline_bonus: float = 0.30            # Bonus amount
    
    # === Tail Bonus ===
    # Rewards fat right tail (p95 >> p75 >> median)
    tail_p75_weight: float = 0.10
    tail_p95_weight: float = 0.05
    
    # === R-weighting ===
    avg_r_weight: float = 1.0
    total_r_weight: float = 0.0
    
    # === Sample size adjustment ===
    confidence_k: float = 30.0
    
    # =========================================================================
    # PATH QUALITY METRICS (NEW)
    # =========================================================================
    
    # === Retention Bonus ===
    # Rewards "clean breakouts" where price retains gains after hitting tiers
    # retention_1_2x_above_1_1x: % of candles that stayed >= 1.1x after hitting 1.2x
    retention_1_2x_threshold: float = 0.70    # Bonus kicks in if retention >= 70%
    retention_1_2x_bonus: float = 0.15         # Bonus for good retention
    retention_1_5x_threshold: float = 0.60    # Slightly lower bar for 1.5x
    retention_1_5x_bonus: float = 0.20         # Slightly higher bonus
    floor_hold_bonus: float = 0.10             # Bonus per tier for holding floor
    
    # === Giveback Penalty ===
    # Penalizes trades that give back gains after hitting tiers
    # giveback = drawdown from tier level after hitting tier (e.g., -30% from 1.5x)
    giveback_1_5x_threshold: float = -0.40     # Penalty if giveback > 40%
    giveback_1_5x_rate: float = 4.0            # Exponential rate
    giveback_1_5x_weight: float = 0.5          # Weight in final score
    giveback_2x_threshold: float = -0.50       # Slightly more lenient at 2x
    giveback_2x_rate: float = 3.0
    giveback_2x_weight: float = 0.3
    
    # === Time Quality Penalty ===
    # Penalizes trades that spend too much time underwater or in chop
    time_underwater_threshold: float = 0.50    # Penalty if > 50% underwater
    time_underwater_rate: float = 3.0          # Exponential rate
    time_underwater_weight: float = 0.5        # Weight in final score
    stall_score_threshold: float = 0.30        # Penalty if > 30% stuck in 1.05-1.15x
    stall_score_rate: float = 4.0
    stall_score_weight: float = 0.4
    
    # === Headfake Penalty ===
    # Penalizes trades that hit 1.2x then dip below entry before 1.5x
    headfake_rate_threshold: float = 0.30      # Penalty if > 30% headfake rate
    headfake_rate_penalty: float = 0.30        # Max penalty for high headfake rate
    headfake_depth_threshold: float = -0.20    # Penalty if depth > 20% below entry
    headfake_depth_rate: float = 3.0           # Exponential rate
    headfake_depth_weight: float = 0.3         # Weight in final score
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            # Tiered DD settings
            "dd_pre_1_2x_threshold": self.dd_pre_1_2x_threshold,
            "dd_pre_1_2x_nuclear": self.dd_pre_1_2x_nuclear,
            "dd_pre_1_2x_rate": self.dd_pre_1_2x_rate,
            "dd_pre_1_2x_weight": self.dd_pre_1_2x_weight,
            "dd_pre_1_5x_threshold": self.dd_pre_1_5x_threshold,
            "dd_pre_1_5x_nuclear": self.dd_pre_1_5x_nuclear,
            "dd_pre_1_5x_rate": self.dd_pre_1_5x_rate,
            "dd_pre_1_5x_weight": self.dd_pre_1_5x_weight,
            "dd_pre_2x_threshold": self.dd_pre_2x_threshold,
            "dd_pre_2x_nuclear": self.dd_pre_2x_nuclear,
            "dd_pre_2x_rate": self.dd_pre_2x_rate,
            "dd_pre_2x_weight": self.dd_pre_2x_weight,
            # Legacy/fallback DD settings
            "dd_threshold": self.dd_threshold,
            "dd_nuclear": self.dd_nuclear,
            "dd_rate": self.dd_rate,
            "dd_weight": self.dd_weight,
            # Time boost settings
            "time_max_boost": self.time_max_boost,
            "time_halflife_min": self.time_halflife_min,
            "time_weight": self.time_weight,
            "time_1_2x_weight": self.time_1_2x_weight,
            "time_1_5x_weight": self.time_1_5x_weight,
            "time_2x_weight": self.time_2x_weight,
            # Other settings
            "discipline_hit2x_threshold": self.discipline_hit2x_threshold,
            "discipline_dd_threshold": self.discipline_dd_threshold,
            "discipline_bonus": self.discipline_bonus,
            "tail_p75_weight": self.tail_p75_weight,
            "tail_p95_weight": self.tail_p95_weight,
            "avg_r_weight": self.avg_r_weight,
            "total_r_weight": self.total_r_weight,
            "confidence_k": self.confidence_k,
            # Path quality config
            "retention_1_2x_threshold": self.retention_1_2x_threshold,
            "retention_1_2x_bonus": self.retention_1_2x_bonus,
            "retention_1_5x_threshold": self.retention_1_5x_threshold,
            "retention_1_5x_bonus": self.retention_1_5x_bonus,
            "floor_hold_bonus": self.floor_hold_bonus,
            "giveback_1_5x_threshold": self.giveback_1_5x_threshold,
            "giveback_1_5x_rate": self.giveback_1_5x_rate,
            "giveback_1_5x_weight": self.giveback_1_5x_weight,
            "giveback_2x_threshold": self.giveback_2x_threshold,
            "giveback_2x_rate": self.giveback_2x_rate,
            "giveback_2x_weight": self.giveback_2x_weight,
            "time_underwater_threshold": self.time_underwater_threshold,
            "time_underwater_rate": self.time_underwater_rate,
            "time_underwater_weight": self.time_underwater_weight,
            "stall_score_threshold": self.stall_score_threshold,
            "stall_score_rate": self.stall_score_rate,
            "stall_score_weight": self.stall_score_weight,
            "headfake_rate_threshold": self.headfake_rate_threshold,
            "headfake_rate_penalty": self.headfake_rate_penalty,
            "headfake_depth_threshold": self.headfake_depth_threshold,
            "headfake_depth_rate": self.headfake_depth_rate,
            "headfake_depth_weight": self.headfake_depth_weight,
        }


# Default config (tuned for your use case)
DEFAULT_OBJECTIVE_CONFIG = ObjectiveConfig()


def compute_dd_penalty_single(
    dd_magnitude: float,
    threshold: float,
    rate: float,
) -> float:
    """
    Compute exponential drawdown penalty for a single tier.
    
    Args:
        dd_magnitude: Drawdown as positive decimal (0.30 = 30% DD)
        threshold: DD threshold above which penalty kicks in
        rate: Exponential rate for penalty growth
    
    Returns:
        Penalty value (0 if dd <= threshold, exponential growth after)
    """
    if dd_magnitude is None or math.isnan(dd_magnitude):
        return 0.0
    dd_magnitude = abs(dd_magnitude)  # Ensure positive
    excess = max(0.0, dd_magnitude - threshold)
    if excess <= 0:
        return 0.0
    return math.exp(rate * excess) - 1.0


def compute_dd_penalty_tiered(
    dd_pre_1_2x: Optional[float],
    dd_pre_1_5x: Optional[float],
    dd_pre_2x: Optional[float],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute tiered drawdown penalty across trade stages.
    
    Each tier has its own threshold, rate, and weight:
    - Tier 1 (pre 1.2x): Most critical - "risk of ruin" before any profit
    - Tier 2 (pre 1.5x): Important - still vulnerable
    - Tier 3 (pre 2x): Less critical - approaching target
    
    Args:
        dd_pre_1_2x: DD before hitting 1.2x (None if 1.2x never hit)
        dd_pre_1_5x: DD before hitting 1.5x (None if 1.5x never hit)
        dd_pre_2x: DD before hitting 2x (None if 2x never hit)
        config: Objective configuration
    
    Returns:
        Weighted sum of tier penalties
    """
    total_penalty = 0.0
    
    # Tier 1: DD before 1.2x (most critical)
    if dd_pre_1_2x is not None and not math.isnan(dd_pre_1_2x):
        penalty_1_2x = compute_dd_penalty_single(
            abs(dd_pre_1_2x),
            config.dd_pre_1_2x_threshold,
            config.dd_pre_1_2x_rate,
        )
        total_penalty += penalty_1_2x * config.dd_pre_1_2x_weight
    
    # Tier 2: DD before 1.5x
    if dd_pre_1_5x is not None and not math.isnan(dd_pre_1_5x):
        penalty_1_5x = compute_dd_penalty_single(
            abs(dd_pre_1_5x),
            config.dd_pre_1_5x_threshold,
            config.dd_pre_1_5x_rate,
        )
        total_penalty += penalty_1_5x * config.dd_pre_1_5x_weight
    
    # Tier 3: DD before 2x
    if dd_pre_2x is not None and not math.isnan(dd_pre_2x):
        penalty_2x = compute_dd_penalty_single(
            abs(dd_pre_2x),
            config.dd_pre_2x_threshold,
            config.dd_pre_2x_rate,
        )
        total_penalty += penalty_2x * config.dd_pre_2x_weight
    
    return total_penalty


def compute_dd_penalty(
    dd_magnitude: float,
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute exponential drawdown penalty (legacy fallback).
    
    Use compute_dd_penalty_tiered for tier-aware scoring when data available.
    
    Args:
        dd_magnitude: Drawdown as positive decimal (0.30 = 30% DD)
        config: Objective configuration
    
    Returns:
        Penalty value (0 if dd <= threshold, exponential growth after)
    
    Examples (with RECALIBRATED defaults):
        dd=0.40 → 0.0 (below 0.50 threshold)
        dd=0.55 → exp(6 * 0.05) - 1 ≈ 0.35
        dd=0.65 → exp(6 * 0.15) - 1 ≈ 1.46
        dd=0.80 → exp(6 * 0.30) - 1 ≈ 5.05 (nuclear)
    """
    if dd_magnitude is None or math.isnan(dd_magnitude):
        return 0.0
    dd_magnitude = abs(dd_magnitude)
    excess = max(0.0, dd_magnitude - config.dd_threshold)
    if excess <= 0:
        return 0.0
    return math.exp(config.dd_rate * excess) - 1.0


def compute_time_boost_single(
    time_min: Optional[float],
    max_boost: float,
    halflife_min: float,
) -> float:
    """
    Compute hyperbolic time boost for a single tier.
    
    Args:
        time_min: Time to tier in minutes (None if never hit)
        max_boost: Maximum boost value
        halflife_min: Time at which boost = max_boost / 2
    
    Returns:
        Boost value (0 to max_boost)
    """
    if time_min is None or time_min < 0:
        return 0.0
    return max_boost / (1.0 + time_min / halflife_min)


def compute_time_boost_tiered(
    time_to_1_2x_min: Optional[float],
    time_to_1_5x_min: Optional[float],
    time_to_2x_min: Optional[float],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute tiered time boost across trade stages.
    
    Args:
        time_to_1_2x_min: Time to 1.2x in minutes
        time_to_1_5x_min: Time to 1.5x in minutes
        time_to_2x_min: Time to 2x in minutes
        config: Objective configuration
    
    Returns:
        Weighted sum of tier boosts
    """
    total_boost = 0.0
    
    # Boost for fast 1.2x
    if time_to_1_2x_min is not None:
        boost_1_2x = compute_time_boost_single(
            time_to_1_2x_min,
            config.time_max_boost * config.time_1_2x_weight,
            config.time_halflife_min,
        )
        total_boost += boost_1_2x
    
    # Boost for fast 1.5x
    if time_to_1_5x_min is not None:
        boost_1_5x = compute_time_boost_single(
            time_to_1_5x_min,
            config.time_max_boost * config.time_1_5x_weight,
            config.time_halflife_min * 1.5,  # Allow more time for higher tiers
        )
        total_boost += boost_1_5x
    
    # Boost for fast 2x (main boost)
    if time_to_2x_min is not None:
        boost_2x = compute_time_boost_single(
            time_to_2x_min,
            config.time_max_boost * config.time_2x_weight,
            config.time_halflife_min * 2.0,
        )
        total_boost += boost_2x
    
    return total_boost


def compute_time_boost(
    time_to_2x_min: Optional[float],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute hyperbolic time-to-2x boost (legacy fallback).
    
    Use compute_time_boost_tiered for tier-aware scoring when data available.
    
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


# =============================================================================
# PATH QUALITY FUNCTIONS (NEW)
# =============================================================================


def compute_retention_bonus(
    retention_1_2x_above_1_1x: Optional[float],
    retention_1_5x_above_1_3x: Optional[float],
    pct_floor_hold_after_1_2x: Optional[float],
    pct_floor_hold_after_1_5x: Optional[float],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute retention bonus for "clean breakouts" where price holds gains.
    
    Args:
        retention_1_2x_above_1_1x: Median % of candles staying >= 1.1x after hitting 1.2x
        retention_1_5x_above_1_3x: Median % of candles staying >= 1.3x after hitting 1.5x
        pct_floor_hold_after_1_2x: % of trades that held floor after 1.2x
        pct_floor_hold_after_1_5x: % of trades that held floor after 1.5x
        config: Objective configuration
    
    Returns:
        Bonus value (sum of retention and floor hold bonuses)
    """
    bonus = 0.0
    
    # Retention bonus for 1.2x tier
    if retention_1_2x_above_1_1x is not None and retention_1_2x_above_1_1x >= config.retention_1_2x_threshold:
        bonus += config.retention_1_2x_bonus
    
    # Retention bonus for 1.5x tier
    if retention_1_5x_above_1_3x is not None and retention_1_5x_above_1_3x >= config.retention_1_5x_threshold:
        bonus += config.retention_1_5x_bonus
    
    # Floor hold bonus (never went below entry after hitting tier)
    if pct_floor_hold_after_1_2x is not None and pct_floor_hold_after_1_2x > 0.5:
        bonus += config.floor_hold_bonus * pct_floor_hold_after_1_2x
    
    if pct_floor_hold_after_1_5x is not None and pct_floor_hold_after_1_5x > 0.5:
        bonus += config.floor_hold_bonus * pct_floor_hold_after_1_5x
    
    return bonus


def compute_giveback_penalty(
    median_giveback_after_1_5x: Optional[float],
    median_giveback_after_2x: Optional[float],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute penalty for trades that give back gains after hitting tiers.
    
    Args:
        median_giveback_after_1_5x: Median DD from 1.5x level after hitting 1.5x (negative value)
        median_giveback_after_2x: Median DD from 2x level after hitting 2x (negative value)
        config: Objective configuration
    
    Returns:
        Penalty value (exponential growth after threshold)
    """
    penalty = 0.0
    
    # Giveback penalty after 1.5x
    if median_giveback_after_1_5x is not None and not math.isnan(median_giveback_after_1_5x):
        # Giveback is negative (e.g., -0.40 = 40% down from 1.5x)
        giveback = abs(median_giveback_after_1_5x)
        threshold = abs(config.giveback_1_5x_threshold)
        if giveback > threshold:
            excess = giveback - threshold
            penalty += (math.exp(config.giveback_1_5x_rate * excess) - 1.0) * config.giveback_1_5x_weight
    
    # Giveback penalty after 2x
    if median_giveback_after_2x is not None and not math.isnan(median_giveback_after_2x):
        giveback = abs(median_giveback_after_2x)
        threshold = abs(config.giveback_2x_threshold)
        if giveback > threshold:
            excess = giveback - threshold
            penalty += (math.exp(config.giveback_2x_rate * excess) - 1.0) * config.giveback_2x_weight
    
    return penalty


def compute_time_quality_penalty(
    median_time_underwater_pct: Optional[float],
    median_stall_score: Optional[float],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute penalty for trades spending too much time underwater or in chop.
    
    Args:
        median_time_underwater_pct: Median % of time below entry before recovery
        median_stall_score: Median % of time stuck in 1.05-1.15x chop zone
        config: Objective configuration
    
    Returns:
        Penalty value (exponential growth after threshold)
    """
    penalty = 0.0
    
    # Time underwater penalty
    if median_time_underwater_pct is not None and not math.isnan(median_time_underwater_pct):
        if median_time_underwater_pct > config.time_underwater_threshold:
            excess = median_time_underwater_pct - config.time_underwater_threshold
            penalty += (math.exp(config.time_underwater_rate * excess) - 1.0) * config.time_underwater_weight
    
    # Stall score penalty (chop zone)
    if median_stall_score is not None and not math.isnan(median_stall_score):
        if median_stall_score > config.stall_score_threshold:
            excess = median_stall_score - config.stall_score_threshold
            penalty += (math.exp(config.stall_score_rate * excess) - 1.0) * config.stall_score_weight
    
    return penalty


def compute_headfake_penalty(
    headfake_rate: Optional[float],
    median_headfake_depth: Optional[float],
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> float:
    """
    Compute penalty for headfakes (hit tier then dump below entry).
    
    Args:
        headfake_rate: % of trades that headfaked (hit 1.2x then dipped below entry)
        median_headfake_depth: Median depth of headfake dip (negative value)
        config: Objective configuration
    
    Returns:
        Penalty value (rate-based + depth-based)
    """
    penalty = 0.0
    
    # Headfake rate penalty (linear)
    if headfake_rate is not None and headfake_rate > config.headfake_rate_threshold:
        excess = headfake_rate - config.headfake_rate_threshold
        # Linear scaling from threshold to 100%
        max_excess = 1.0 - config.headfake_rate_threshold
        if max_excess > 0:
            penalty += config.headfake_rate_penalty * (excess / max_excess)
    
    # Headfake depth penalty (exponential)
    if median_headfake_depth is not None and not math.isnan(median_headfake_depth):
        depth = abs(median_headfake_depth)
        threshold = abs(config.headfake_depth_threshold)
        if depth > threshold:
            excess = depth - threshold
            penalty += (math.exp(config.headfake_depth_rate * excess) - 1.0) * config.headfake_depth_weight
    
    return penalty


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
    
    # DD metrics (tiered)
    dd_magnitude: float  # Legacy/fallback (dd_pre2x or dd_overall)
    dd_pre_1_2x: Optional[float] = None
    dd_pre_1_5x: Optional[float] = None
    dd_pre_2x: Optional[float] = None
    
    # Time metrics (tiered)
    time_to_2x_min: Optional[float] = None
    time_to_1_2x_min: Optional[float] = None
    time_to_1_5x_min: Optional[float] = None
    
    # Hit rates
    hit2x_pct: float = 0.0
    hit_1_2x_pct: float = 0.0
    hit_1_5x_pct: float = 0.0
    
    # ATH distribution
    median_ath: float = 1.0
    p75_ath: Optional[float] = None
    p95_ath: Optional[float] = None
    
    # =========================================================================
    # PATH QUALITY INPUTS (NEW)
    # =========================================================================
    # Retention metrics
    retention_1_2x_above_1_1x: Optional[float] = None
    retention_1_5x_above_1_3x: Optional[float] = None
    pct_floor_hold_after_1_2x: Optional[float] = None
    pct_floor_hold_after_1_5x: Optional[float] = None
    
    # Giveback metrics
    median_giveback_after_1_5x: Optional[float] = None
    median_giveback_after_2x: Optional[float] = None
    
    # Time quality metrics
    median_time_underwater_pct: Optional[float] = None
    median_stall_score: Optional[float] = None
    
    # Headfake metrics
    headfake_rate: Optional[float] = None
    median_headfake_depth: Optional[float] = None
    
    # Components
    base_score: float = 0.0
    dd_penalty: float = 0.0
    dd_penalty_breakdown: Optional[Dict[str, float]] = None  # Tier-wise breakdown
    time_boost: float = 0.0
    time_boost_breakdown: Optional[Dict[str, float]] = None  # Tier-wise breakdown
    discipline_bonus: float = 0.0
    tail_bonus: float = 0.0
    
    # =========================================================================
    # PATH QUALITY COMPONENTS (NEW)
    # =========================================================================
    retention_bonus: float = 0.0
    giveback_penalty: float = 0.0
    time_quality_penalty: float = 0.0
    headfake_penalty: float = 0.0
    
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
            "dd_pre_1_2x": self.dd_pre_1_2x,
            "dd_pre_1_5x": self.dd_pre_1_5x,
            "dd_pre_2x": self.dd_pre_2x,
            "time_to_2x_min": self.time_to_2x_min,
            "time_to_1_2x_min": self.time_to_1_2x_min,
            "time_to_1_5x_min": self.time_to_1_5x_min,
            "hit2x_pct": self.hit2x_pct,
            "hit_1_2x_pct": self.hit_1_2x_pct,
            "hit_1_5x_pct": self.hit_1_5x_pct,
            "median_ath": self.median_ath,
            "p75_ath": self.p75_ath,
            "p95_ath": self.p95_ath,
            "base_score": self.base_score,
            "dd_penalty": self.dd_penalty,
            "dd_penalty_breakdown": self.dd_penalty_breakdown,
            "time_boost": self.time_boost,
            "time_boost_breakdown": self.time_boost_breakdown,
            "discipline_bonus": self.discipline_bonus,
            "tail_bonus": self.tail_bonus,
            # Path quality inputs
            "retention_1_2x_above_1_1x": self.retention_1_2x_above_1_1x,
            "retention_1_5x_above_1_3x": self.retention_1_5x_above_1_3x,
            "pct_floor_hold_after_1_2x": self.pct_floor_hold_after_1_2x,
            "pct_floor_hold_after_1_5x": self.pct_floor_hold_after_1_5x,
            "median_giveback_after_1_5x": self.median_giveback_after_1_5x,
            "median_giveback_after_2x": self.median_giveback_after_2x,
            "median_time_underwater_pct": self.median_time_underwater_pct,
            "median_stall_score": self.median_stall_score,
            "headfake_rate": self.headfake_rate,
            "median_headfake_depth": self.median_headfake_depth,
            # Path quality components
            "retention_bonus": self.retention_bonus,
            "giveback_penalty": self.giveback_penalty,
            "time_quality_penalty": self.time_quality_penalty,
            "headfake_penalty": self.headfake_penalty,
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
    
    Uses tiered DD metrics when available for more accurate scoring.
    
    Args:
        summary: Summary dict from summarize_tp_sl()
        config: Objective configuration
    
    Returns:
        ObjectiveResult
    """
    # Extract R metrics
    avg_r = summary.get("avg_r", 0.0) or 0.0
    total_r = summary.get("total_r", 0.0) or 0.0
    n_trades = summary.get("alerts_ok", 0) or 0
    
    # Helper to convert DD from stored format to magnitude (positive decimal)
    def dd_to_magnitude(val: Optional[float]) -> Optional[float]:
        if val is None:
            return None
        # Values are typically stored as negative decimals (e.g., -0.30 = 30% DD)
        # or as percentages. Normalize to positive decimal.
        val = abs(val)
        if val > 1.0:  # Stored as percentage
            val = val / 100.0
        return val
    
    # Extract tiered DD metrics (new fields)
    dd_pre_1_2x = dd_to_magnitude(summary.get("median_dd_pre_1_2x"))
    dd_pre_1_5x = dd_to_magnitude(summary.get("median_dd_pre_1_5x"))
    dd_pre_2x = dd_to_magnitude(summary.get("median_dd_pre2x"))
    
    # Fallback DD (legacy)
    dd_fallback = summary.get("median_dd_initial") or summary.get("median_dd_overall") or 0.0
    dd_magnitude = dd_to_magnitude(dd_fallback) or 0.0
    
    # Extract tiered time metrics (convert to minutes)
    def time_to_min(val_s: Optional[float]) -> Optional[float]:
        if val_s is None:
            return None
        return val_s / 60.0
    
    time_to_1_2x_min = summary.get("time_to_1_2x_median_min")  # Already in minutes
    time_to_1_5x_min = summary.get("time_to_1_5x_median_min")  # Already in minutes
    time_to_2x_min = summary.get("time_to_2x_median_min")      # Already in minutes
    
    # Fallback to seconds-based if minutes not available
    if time_to_2x_min is None:
        time_to_2x_s = summary.get("median_time_to_2x_s")
        time_to_2x_min = time_to_min(time_to_2x_s)
    
    # Extract hit rates
    hit_1_2x_pct = summary.get("pct_hit_1_2x", 0.0) or 0.0
    hit_1_5x_pct = summary.get("pct_hit_1_5x", 0.0) or 0.0
    hit2x_pct = summary.get("pct_hit_2x", 0.0) or 0.0
    
    # Extract ATH metrics
    median_ath = summary.get("median_ath_mult", 1.0) or 1.0
    p75_ath = summary.get("p75_ath")
    p95_ath = summary.get("p95_ath")
    
    # =========================================================================
    # EXTRACT PATH QUALITY METRICS (NEW)
    # =========================================================================
    # Retention metrics
    retention_1_2x_above_1_1x = summary.get("median_retention_1_2x_above_1_1x")
    retention_1_5x_above_1_3x = summary.get("median_retention_1_5x_above_1_3x")
    pct_floor_hold_after_1_2x = summary.get("pct_floor_hold_after_1_2x")
    pct_floor_hold_after_1_5x = summary.get("pct_floor_hold_after_1_5x")
    
    # Giveback metrics
    median_giveback_after_1_5x = summary.get("median_giveback_after_1_5x")
    median_giveback_after_2x = summary.get("median_giveback_after_2x")
    
    # Time quality metrics
    median_time_underwater_pct = summary.get("median_time_underwater_pct")
    median_stall_score = summary.get("median_stall_score")
    
    # Headfake metrics
    headfake_rate = summary.get("headfake_rate")
    median_headfake_depth = summary.get("median_headfake_depth")
    
    # Build result with all inputs
    result = ObjectiveResult(
        avg_r=avg_r,
        total_r=total_r,
        n_trades=n_trades,
        dd_magnitude=dd_magnitude,
        dd_pre_1_2x=dd_pre_1_2x,
        dd_pre_1_5x=dd_pre_1_5x,
        dd_pre_2x=dd_pre_2x,
        time_to_2x_min=time_to_2x_min,
        time_to_1_2x_min=time_to_1_2x_min,
        time_to_1_5x_min=time_to_1_5x_min,
        hit2x_pct=hit2x_pct,
        hit_1_2x_pct=hit_1_2x_pct,
        hit_1_5x_pct=hit_1_5x_pct,
        median_ath=median_ath,
        p75_ath=p75_ath,
        p95_ath=p95_ath,
        # Path quality inputs
        retention_1_2x_above_1_1x=retention_1_2x_above_1_1x,
        retention_1_5x_above_1_3x=retention_1_5x_above_1_3x,
        pct_floor_hold_after_1_2x=pct_floor_hold_after_1_2x,
        pct_floor_hold_after_1_5x=pct_floor_hold_after_1_5x,
        median_giveback_after_1_5x=median_giveback_after_1_5x,
        median_giveback_after_2x=median_giveback_after_2x,
        median_time_underwater_pct=median_time_underwater_pct,
        median_stall_score=median_stall_score,
        headfake_rate=headfake_rate,
        median_headfake_depth=median_headfake_depth,
    )
    
    # Base score from R performance
    result.base_score = config.avg_r_weight * avg_r
    if config.total_r_weight > 0 and n_trades > 0:
        result.base_score += config.total_r_weight * (total_r / n_trades)
    
    # =========================================================================
    # TIERED DD PENALTY
    # =========================================================================
    # Use tiered penalty if we have tier data, otherwise fall back to legacy
    has_tier_data = any([dd_pre_1_2x is not None, dd_pre_1_5x is not None, dd_pre_2x is not None])
    
    if has_tier_data:
        # Compute tier-wise penalties
        penalty_1_2x = 0.0
        penalty_1_5x = 0.0
        penalty_2x = 0.0
        
        if dd_pre_1_2x is not None:
            penalty_1_2x = compute_dd_penalty_single(
                dd_pre_1_2x,
                config.dd_pre_1_2x_threshold,
                config.dd_pre_1_2x_rate,
            ) * config.dd_pre_1_2x_weight
        
        if dd_pre_1_5x is not None:
            penalty_1_5x = compute_dd_penalty_single(
                dd_pre_1_5x,
                config.dd_pre_1_5x_threshold,
                config.dd_pre_1_5x_rate,
            ) * config.dd_pre_1_5x_weight
        
        if dd_pre_2x is not None:
            penalty_2x = compute_dd_penalty_single(
                dd_pre_2x,
                config.dd_pre_2x_threshold,
                config.dd_pre_2x_rate,
            ) * config.dd_pre_2x_weight
        
        result.dd_penalty = penalty_1_2x + penalty_1_5x + penalty_2x
        result.dd_penalty_breakdown = {
            "pre_1_2x": penalty_1_2x,
            "pre_1_5x": penalty_1_5x,
            "pre_2x": penalty_2x,
        }
    else:
        # Legacy fallback
        result.dd_penalty = compute_dd_penalty(dd_magnitude, config)
        result.dd_penalty_breakdown = {"legacy": result.dd_penalty}
    
    # =========================================================================
    # TIERED TIME BOOST
    # =========================================================================
    has_time_tier_data = any([time_to_1_2x_min is not None, time_to_1_5x_min is not None])
    
    if has_time_tier_data:
        boost_1_2x = compute_time_boost_single(
            time_to_1_2x_min,
            config.time_max_boost * config.time_1_2x_weight,
            config.time_halflife_min,
        ) if time_to_1_2x_min is not None else 0.0
        
        boost_1_5x = compute_time_boost_single(
            time_to_1_5x_min,
            config.time_max_boost * config.time_1_5x_weight,
            config.time_halflife_min * 1.5,
        ) if time_to_1_5x_min is not None else 0.0
        
        boost_2x = compute_time_boost_single(
            time_to_2x_min,
            config.time_max_boost * config.time_2x_weight,
            config.time_halflife_min * 2.0,
        ) if time_to_2x_min is not None else 0.0
        
        result.time_boost = boost_1_2x + boost_1_5x + boost_2x
        result.time_boost_breakdown = {
            "1_2x": boost_1_2x,
            "1_5x": boost_1_5x,
            "2x": boost_2x,
        }
    else:
        # Legacy fallback
        result.time_boost = compute_time_boost(time_to_2x_min, config)
        result.time_boost_breakdown = {"2x": result.time_boost}
    
    # =========================================================================
    # DISCIPLINE BONUS (use earliest tier DD for most conservative check)
    # =========================================================================
    # Use dd_pre_1_2x if available (most conservative), else fall back
    dd_for_discipline = dd_pre_1_2x or dd_pre_1_5x or dd_pre_2x or dd_magnitude
    result.discipline_bonus = compute_discipline_bonus(hit2x_pct, dd_for_discipline, config)
    
    # Tail bonus
    result.tail_bonus = compute_tail_bonus(median_ath, p75_ath, p95_ath, config)
    
    # =========================================================================
    # PATH QUALITY PENALTIES/BONUSES (NEW)
    # =========================================================================
    result.retention_bonus = compute_retention_bonus(
        retention_1_2x_above_1_1x,
        retention_1_5x_above_1_3x,
        pct_floor_hold_after_1_2x,
        pct_floor_hold_after_1_5x,
        config,
    )
    
    result.giveback_penalty = compute_giveback_penalty(
        median_giveback_after_1_5x,
        median_giveback_after_2x,
        config,
    )
    
    result.time_quality_penalty = compute_time_quality_penalty(
        median_time_underwater_pct,
        median_stall_score,
        config,
    )
    
    result.headfake_penalty = compute_headfake_penalty(
        headfake_rate,
        median_headfake_depth,
        config,
    )
    
    # Confidence adjustment
    result.confidence = compute_confidence(n_trades, config)
    
    # Raw score (before confidence)
    # Includes new path quality components
    result.raw_score = (
        result.base_score
        + result.time_boost * config.time_weight
        + result.discipline_bonus
        + result.tail_bonus
        + result.retention_bonus  # NEW: bonus for clean breakouts
        - result.dd_penalty * config.dd_weight
        - result.giveback_penalty  # NEW: penalty for giving back gains
        - result.time_quality_penalty  # NEW: penalty for time underwater/stall
        - result.headfake_penalty  # NEW: penalty for headfakes
    )
    
    # Final score
    result.final_score = result.confidence * result.raw_score
    
    return result


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

def print_objective_breakdown(
    result: ObjectiveResult,
    config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG,
) -> None:
    """
    Print a breakdown of the objective function components.
    
    Shows the actual contribution of each component to the raw score,
    with correct signs (DD penalty is shown as negative since it subtracts).
    """
    # Calculate actual contributions to raw_score
    dd_contribution = -result.dd_penalty * config.dd_weight  # Negative contribution
    time_contribution = result.time_boost * config.time_weight
    
    print(f"Objective Breakdown:")
    print(f"  Base (AvgR):       {result.base_score:+.3f}")
    
    # DD Penalty breakdown (tiered if available)
    if result.dd_penalty_breakdown and len(result.dd_penalty_breakdown) > 1:
        print(f"  DD Penalty:        {dd_contribution:+.3f} (tiered)")
        for tier, penalty in result.dd_penalty_breakdown.items():
            if tier == "pre_1_2x" and result.dd_pre_1_2x is not None:
                print(f"    └ {tier}: {-penalty:.3f} (DD={result.dd_pre_1_2x:.1%})")
            elif tier == "pre_1_5x" and result.dd_pre_1_5x is not None:
                print(f"    └ {tier}: {-penalty:.3f} (DD={result.dd_pre_1_5x:.1%})")
            elif tier == "pre_2x" and result.dd_pre_2x is not None:
                print(f"    └ {tier}: {-penalty:.3f} (DD={result.dd_pre_2x:.1%})")
    else:
        print(f"  DD Penalty:        {dd_contribution:+.3f} (DD={result.dd_magnitude:.1%})")
    
    # Time Boost breakdown (tiered if available)
    if result.time_boost_breakdown and len(result.time_boost_breakdown) > 1:
        print(f"  Time Boost:        {time_contribution:+.3f} (tiered)")
        for tier, boost in result.time_boost_breakdown.items():
            if tier == "1_2x" and result.time_to_1_2x_min is not None:
                print(f"    └ t{tier}: +{boost:.3f} ({result.time_to_1_2x_min:.0f}m)")
            elif tier == "1_5x" and result.time_to_1_5x_min is not None:
                print(f"    └ t{tier}: +{boost:.3f} ({result.time_to_1_5x_min:.0f}m)")
            elif tier == "2x" and result.time_to_2x_min is not None:
                print(f"    └ t{tier}: +{boost:.3f} ({result.time_to_2x_min:.0f}m)")
    else:
        if result.time_to_2x_min is not None:
            print(f"  Time Boost:        {time_contribution:+.3f} (t2x={result.time_to_2x_min:.0f}m)")
        else:
            print(f"  Time Boost:        {time_contribution:+.3f} (no 2x)")
    
    print(f"  Discipline:        {result.discipline_bonus:+.3f}")
    print(f"  Tail Bonus:        {result.tail_bonus:+.3f}")
    
    # Path quality components (NEW)
    if result.retention_bonus > 0:
        retention_details = []
        if result.retention_1_2x_above_1_1x is not None:
            retention_details.append(f"ret_1.2x={result.retention_1_2x_above_1_1x:.0%}")
        if result.pct_floor_hold_after_1_2x is not None and result.pct_floor_hold_after_1_2x > 0:
            retention_details.append(f"floor_1.2x={result.pct_floor_hold_after_1_2x:.0%}")
        print(f"  Retention Bonus:   {result.retention_bonus:+.3f}" + (f" ({', '.join(retention_details)})" if retention_details else ""))
    
    if result.giveback_penalty > 0:
        giveback_details = []
        if result.median_giveback_after_1_5x is not None:
            giveback_details.append(f"gb_1.5x={result.median_giveback_after_1_5x:.0%}")
        if result.median_giveback_after_2x is not None:
            giveback_details.append(f"gb_2x={result.median_giveback_after_2x:.0%}")
        print(f"  Giveback Penalty:  {-result.giveback_penalty:+.3f}" + (f" ({', '.join(giveback_details)})" if giveback_details else ""))
    
    if result.time_quality_penalty > 0:
        tq_details = []
        if result.median_time_underwater_pct is not None:
            tq_details.append(f"underwater={result.median_time_underwater_pct:.0%}")
        if result.median_stall_score is not None:
            tq_details.append(f"stall={result.median_stall_score:.0%}")
        print(f"  Time Quality Pen:  {-result.time_quality_penalty:+.3f}" + (f" ({', '.join(tq_details)})" if tq_details else ""))
    
    if result.headfake_penalty > 0:
        hf_details = []
        if result.headfake_rate is not None:
            hf_details.append(f"rate={result.headfake_rate:.0%}")
        if result.median_headfake_depth is not None:
            hf_details.append(f"depth={result.median_headfake_depth:.0%}")
        print(f"  Headfake Penalty:  {-result.headfake_penalty:+.3f}" + (f" ({', '.join(hf_details)})" if hf_details else ""))
    
    print(f"  ─────────────────────")
    print(f"  Raw Score:         {result.raw_score:+.3f}")
    print(f"  × Confidence:      {result.confidence:.3f} (n={result.n_trades})")
    print(f"  ─────────────────────")
    print(f"  Final Score:       {result.final_score:+.3f}")
    
    # Verify arithmetic (including new components)
    expected_raw = (
        result.base_score
        + time_contribution
        + result.discipline_bonus
        + result.tail_bonus
        + result.retention_bonus
        + dd_contribution  # Already negated above
        - result.giveback_penalty
        - result.time_quality_penalty
        - result.headfake_penalty
    )
    if abs(expected_raw - result.raw_score) > 0.001:
        print(f"  ⚠️ ARITHMETIC CHECK FAILED: expected raw={expected_raw:+.3f}")


# =============================================================================
# Quality Filters (NEW)
# =============================================================================


@dataclass
class QualityFilterConfig:
    """
    Filters for eliminating low-quality parameter combinations.
    
    Applied AFTER scoring to filter results that pass threshold checks
    but have problematic path quality characteristics.
    
    Set any threshold to None to disable that filter.
    """
    # Headfake filters
    max_headfake_rate: Optional[float] = 0.40  # Max 40% headfake rate
    max_headfake_depth: Optional[float] = -0.25  # Max 25% headfake depth
    
    # Retention filters (minimum thresholds)
    min_retention_1_2x: Optional[float] = 0.50  # Min 50% retention after 1.2x
    min_floor_hold_1_2x: Optional[float] = 0.30  # Min 30% hold floor after 1.2x
    
    # Time quality filters
    max_time_underwater_pct: Optional[float] = 0.70  # Max 70% underwater
    max_stall_score: Optional[float] = 0.40  # Max 40% stall
    
    # Giveback filters (max acceptable giveback)
    max_giveback_after_1_5x: Optional[float] = -0.60  # Max 60% giveback after 1.5x
    max_giveback_after_2x: Optional[float] = -0.70  # Max 70% giveback after 2x
    
    def check(self, summary: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Check if a summary passes all quality filters.
        
        Args:
            summary: Summary dict from summarize_tp_sl()
            
        Returns:
            Tuple of (passed: bool, reasons: List[str])
            If passed is False, reasons contains the failed filter descriptions.
        """
        reasons = []
        
        # Headfake filters
        if self.max_headfake_rate is not None:
            headfake_rate = summary.get("headfake_rate")
            if headfake_rate is not None and headfake_rate > self.max_headfake_rate:
                reasons.append(f"headfake_rate={headfake_rate:.0%} > {self.max_headfake_rate:.0%}")
        
        if self.max_headfake_depth is not None:
            headfake_depth = summary.get("median_headfake_depth")
            if headfake_depth is not None and headfake_depth < self.max_headfake_depth:
                reasons.append(f"headfake_depth={headfake_depth:.0%} < {self.max_headfake_depth:.0%}")
        
        # Retention filters
        if self.min_retention_1_2x is not None:
            retention = summary.get("median_retention_1_2x_above_1_1x")
            if retention is not None and retention < self.min_retention_1_2x:
                reasons.append(f"retention_1.2x={retention:.0%} < {self.min_retention_1_2x:.0%}")
        
        if self.min_floor_hold_1_2x is not None:
            floor_hold = summary.get("pct_floor_hold_after_1_2x")
            if floor_hold is not None and floor_hold < self.min_floor_hold_1_2x:
                reasons.append(f"floor_hold_1.2x={floor_hold:.0%} < {self.min_floor_hold_1_2x:.0%}")
        
        # Time quality filters
        if self.max_time_underwater_pct is not None:
            underwater = summary.get("median_time_underwater_pct")
            if underwater is not None and underwater > self.max_time_underwater_pct:
                reasons.append(f"underwater={underwater:.0%} > {self.max_time_underwater_pct:.0%}")
        
        if self.max_stall_score is not None:
            stall = summary.get("median_stall_score")
            if stall is not None and stall > self.max_stall_score:
                reasons.append(f"stall={stall:.0%} > {self.max_stall_score:.0%}")
        
        # Giveback filters
        if self.max_giveback_after_1_5x is not None:
            giveback = summary.get("median_giveback_after_1_5x")
            if giveback is not None and giveback < self.max_giveback_after_1_5x:
                reasons.append(f"giveback_1.5x={giveback:.0%} < {self.max_giveback_after_1_5x:.0%}")
        
        if self.max_giveback_after_2x is not None:
            giveback = summary.get("median_giveback_after_2x")
            if giveback is not None and giveback < self.max_giveback_after_2x:
                reasons.append(f"giveback_2x={giveback:.0%} < {self.max_giveback_after_2x:.0%}")
        
        passed = len(reasons) == 0
        return (passed, reasons)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "max_headfake_rate": self.max_headfake_rate,
            "max_headfake_depth": self.max_headfake_depth,
            "min_retention_1_2x": self.min_retention_1_2x,
            "min_floor_hold_1_2x": self.min_floor_hold_1_2x,
            "max_time_underwater_pct": self.max_time_underwater_pct,
            "max_stall_score": self.max_stall_score,
            "max_giveback_after_1_5x": self.max_giveback_after_1_5x,
            "max_giveback_after_2x": self.max_giveback_after_2x,
        }


# Default quality filter (disabled by default for backwards compatibility)
DEFAULT_QUALITY_FILTER = None


# =============================================================================
# Backwards compatibility alias
# =============================================================================

# ObjectiveComponents is an alias for ObjectiveResult
ObjectiveComponents = ObjectiveResult
