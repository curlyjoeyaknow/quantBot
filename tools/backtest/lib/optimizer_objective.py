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
    
    # Components
    base_score: float = 0.0
    dd_penalty: float = 0.0
    dd_penalty_breakdown: Optional[Dict[str, float]] = None  # Tier-wise breakdown
    time_boost: float = 0.0
    time_boost_breakdown: Optional[Dict[str, float]] = None  # Tier-wise breakdown
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
    print(f"  DD Penalty:        {dd_contribution:+.3f} (DD={result.dd_magnitude:.1%})")
    if result.time_to_2x_min is not None:
        print(f"  Time Boost:        {time_contribution:+.3f} (t2x={result.time_to_2x_min:.0f}m)")
    else:
        print(f"  Time Boost:        {time_contribution:+.3f} (no 2x)")
    print(f"  Discipline:        {result.discipline_bonus:+.3f}")
    print(f"  Tail Bonus:        {result.tail_bonus:+.3f}")
    print(f"  ─────────────────────")
    print(f"  Raw Score:         {result.raw_score:+.3f}")
    print(f"  × Confidence:      {result.confidence:.3f} (n={result.n_trades})")
    print(f"  ─────────────────────")
    print(f"  Final Score:       {result.final_score:+.3f}")
    
    # Verify arithmetic
    expected_raw = (
        result.base_score
        + time_contribution
        + result.discipline_bonus
        + result.tail_bonus
        + dd_contribution  # Already negated above
    )
    if abs(expected_raw - result.raw_score) > 0.001:
        print(f"  ⚠️ ARITHMETIC CHECK FAILED: expected raw={expected_raw:+.3f}")


# =============================================================================
# Backwards compatibility alias
# =============================================================================

# ObjectiveComponents is an alias for ObjectiveResult
ObjectiveComponents = ObjectiveResult
