"""
Caller scoring for risk-adjusted ranking.

Implements caller_scored_v2 logic:
- Exponential risk penalty after 50% drawdown magnitude
- Speed boost for fast time-to-2x
- Synergy bonus for high hit rate + low risk
- Tail bonus for fat right tail (p75/p95)
- Confidence shrink for sample size

Key design choices:
1. Penalty uses median_dd_pre2x_or_horizon (not just dd_pre2x)
   Because dd_pre2x is undefined for non-2x alerts. If you only punish
   dd_pre2x, callers who rarely hit 2x dodge the risk penalty entirely.

2. Penalty is exponential after 50% drawdown magnitude (calibrated for crypto)
   So 55% hurts a bit, 60% hurts, 75%+ is basically disqualification.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


# =============================================================================
# Scoring Configuration
# =============================================================================

@dataclass
class ScoringConfig:
    """
    Configuration for caller scoring.
    
    Tunables for the scoring formula (calibrated for crypto caller data).
    """
    # Risk penalty parameters
    risk_threshold: float = 0.50  # DD magnitude above this triggers penalty
    risk_rate: float = 8.0        # Exponential rate (8 makes 75% very painful)
    risk_weight: float = 1.0      # Multiplier for risk penalty
    
    # Timing boost parameters  
    timing_max_boost: float = 0.80  # Max boost when ultra-fast (80% lift)
    timing_halflife_min: float = 60.0  # Halflife in minutes for decay
    
    # Discipline bonus (synergy for hit2x >= 40% AND dd <= 55%)
    discipline_hit2x_threshold: float = 40.0  # % threshold
    discipline_dd_threshold: float = 0.55     # DD magnitude threshold
    discipline_bonus: float = 0.60            # Bonus amount
    
    # Tail bonus weights
    tail_p75_weight: float = 0.15
    tail_p95_weight: float = 0.10
    
    # Confidence shrink (sample size adjustment)
    confidence_k: float = 50.0  # sqrt(n / (n + k))
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "risk_threshold": self.risk_threshold,
            "risk_rate": self.risk_rate,
            "risk_weight": self.risk_weight,
            "timing_max_boost": self.timing_max_boost,
            "timing_halflife_min": self.timing_halflife_min,
            "discipline_hit2x_threshold": self.discipline_hit2x_threshold,
            "discipline_dd_threshold": self.discipline_dd_threshold,
            "discipline_bonus": self.discipline_bonus,
            "tail_p75_weight": self.tail_p75_weight,
            "tail_p95_weight": self.tail_p95_weight,
            "confidence_k": self.confidence_k,
        }


# Default config
DEFAULT_SCORING_CONFIG = ScoringConfig()


# =============================================================================
# Scoring Functions
# =============================================================================

def compute_risk_penalty(
    dd_magnitude: float,
    threshold: float = 0.30,
    rate: float = 15.0,
) -> float:
    """
    Compute exponential risk penalty.
    
    Penalty = 0 when dd_magnitude <= threshold
    Penalty = exp(rate * (dd_magnitude - threshold)) - 1 when > threshold
    
    Examples (rate=15):
        40% DD → exp(15 * 0.10) - 1 ≈ 3.48
        50% DD → exp(15 * 0.20) - 1 ≈ 19.1
        60% DD → exp(15 * 0.30) - 1 ≈ 89.0
    
    Args:
        dd_magnitude: Drawdown magnitude as positive fraction (e.g., 0.40 for 40%)
        threshold: Threshold below which penalty is 0
        rate: Exponential rate (higher = steeper)
        
    Returns:
        Penalty value (0 = no penalty, higher = worse)
    """
    if dd_magnitude <= threshold:
        return 0.0
    return math.exp(rate * (dd_magnitude - threshold)) - 1.0


def compute_timing_boost(
    median_t2x_min: Optional[float],
    halflife_min: float = 60.0,
) -> float:
    """
    Compute timing boost for fast time-to-2x.
    
    boost = exp(-t / halflife)
    
    Examples:
        30 min → exp(-0.5) ≈ 0.61
        60 min → exp(-1.0) ≈ 0.37
        120 min → exp(-2.0) ≈ 0.14
    
    Args:
        median_t2x_min: Median time-to-2x in minutes (None if no 2x)
        halflife_min: Halflife for decay
        
    Returns:
        Boost signal in [0, 1]
    """
    if median_t2x_min is None or median_t2x_min <= 0:
        return 0.0
    return math.exp(-median_t2x_min / halflife_min)


def compute_discipline_bonus(
    hit2x_pct: float,
    dd_magnitude: float,
    hit2x_threshold: float = 50.0,
    dd_threshold: float = 0.30,
    bonus: float = 0.60,
) -> float:
    """
    Compute discipline bonus for callers with high hit rate AND low risk.
    
    Synergy bonus: hit2x >= 50% AND dd <= 30% → big bump.
    
    Args:
        hit2x_pct: Hit rate percentage (0-100)
        dd_magnitude: Drawdown magnitude as positive fraction
        hit2x_threshold: Hit rate threshold for bonus
        dd_threshold: DD threshold for bonus
        bonus: Bonus amount
        
    Returns:
        Bonus value (0 or bonus amount)
    """
    if hit2x_pct >= hit2x_threshold and dd_magnitude <= dd_threshold:
        return bonus
    return 0.0


def compute_tail_bonus(
    median_ath: float,
    p75_ath: Optional[float],
    p95_ath: Optional[float],
    p75_weight: float = 0.15,
    p95_weight: float = 0.10,
) -> float:
    """
    Compute tail bonus for fat right tail.
    
    Rewards p75 and p95 above median without letting it dominate.
    
    Args:
        median_ath: Median ATH multiplier
        p75_ath: 75th percentile ATH
        p95_ath: 95th percentile ATH
        p75_weight: Weight for p75 contribution
        p95_weight: Weight for p95 contribution
        
    Returns:
        Tail bonus value
    """
    bonus = 0.0
    if p75_ath is not None:
        bonus += p75_weight * max(p75_ath - median_ath, 0.0)
    if p95_ath is not None and p75_ath is not None:
        bonus += p95_weight * max(p95_ath - p75_ath, 0.0)
    return bonus


def compute_confidence(n: int, k: float = 50.0) -> float:
    """
    Compute confidence shrink for sample size.
    
    confidence = sqrt(n / (n + k))
    
    This keeps small samples from dominating:
        n=30, k=50 → sqrt(30/80) ≈ 0.61
        n=100, k=50 → sqrt(100/150) ≈ 0.82
        n=500, k=50 → sqrt(500/550) ≈ 0.95
    
    Args:
        n: Sample size
        k: Constant for shrinkage
        
    Returns:
        Confidence multiplier in (0, 1)
    """
    if n <= 0:
        return 0.0
    return math.sqrt(n / (n + k))


def score_caller_v2(
    caller_stats: Dict[str, Any],
    config: ScoringConfig = DEFAULT_SCORING_CONFIG,
) -> Dict[str, Any]:
    """
    Compute v2 score for a caller.
    
    Formula:
        score_v2 = confidence * (
            (base_upside + tail_bonus) * timing_mult
            + discipline_bonus
            - risk_weight * risk_penalty
        )
    
    Where:
        base_upside = (median_ath - 1) * (hit2x_pct / 100)
        timing_mult = 1 + max_boost * fast2x_signal
    
    Args:
        caller_stats: Dict with caller statistics
        config: Scoring configuration
        
    Returns:
        Dict with scoring components and final score
    """
    # Extract fields
    n = caller_stats.get("n", 0)
    median_ath = caller_stats.get("median_ath") or 1.0
    p75_ath = caller_stats.get("p75_ath")
    p95_ath = caller_stats.get("p95_ath")
    hit2x_pct = caller_stats.get("hit2x_pct") or 0.0
    median_t2x_hrs = caller_stats.get("median_t2x_hrs")
    
    # Prefer pre2x_or_horizon, fallback to pre2x, then overall
    dd_pct = caller_stats.get("median_dd_pre2x_or_horizon_pct")
    if dd_pct is None:
        dd_pct = caller_stats.get("median_dd_pre2x_pct")
    if dd_pct is None:
        dd_pct = caller_stats.get("median_dd_overall_pct") or 0.0
    
    # Convert DD percent to magnitude (positive fraction)
    # DD is typically stored as negative percentage (e.g., -45.2% means 45.2% drawdown)
    risk_mag = max(0.0, -dd_pct / 100.0) if dd_pct is not None else 0.0
    
    # Convert median_t2x_hrs to minutes
    median_t2x_min = (median_t2x_hrs * 60.0) if median_t2x_hrs is not None else None
    
    # Compute components
    base_upside = max(median_ath - 1.0, 0.0) * (hit2x_pct / 100.0)
    
    tail_bonus = compute_tail_bonus(
        median_ath, p75_ath, p95_ath,
        config.tail_p75_weight, config.tail_p95_weight
    )
    
    fast2x_signal = compute_timing_boost(median_t2x_min, config.timing_halflife_min)
    timing_mult = 1.0 + config.timing_max_boost * fast2x_signal
    
    risk_penalty = compute_risk_penalty(
        risk_mag, config.risk_threshold, config.risk_rate
    )
    
    discipline_bonus = compute_discipline_bonus(
        hit2x_pct, risk_mag,
        config.discipline_hit2x_threshold,
        config.discipline_dd_threshold,
        config.discipline_bonus
    )
    
    confidence = compute_confidence(n, config.confidence_k)
    
    # Final score
    score_v2 = confidence * (
        (base_upside + tail_bonus) * timing_mult
        + discipline_bonus
        - config.risk_weight * risk_penalty
    )
    
    return {
        # Original stats preserved
        **caller_stats,
        # Scoring components
        "risk_dd_pct": dd_pct,
        "risk_mag": risk_mag,
        "median_t2x_min": median_t2x_min,
        "base_upside": base_upside,
        "tail_bonus": tail_bonus,
        "fast2x_signal": fast2x_signal,
        "timing_mult": timing_mult,
        "risk_penalty": risk_penalty,
        "discipline_bonus": discipline_bonus,
        "confidence": confidence,
        "score_v2": score_v2,
    }


def score_callers_v2(
    callers: List[Dict[str, Any]],
    config: ScoringConfig = DEFAULT_SCORING_CONFIG,
    min_n: int = 0,
) -> List[Dict[str, Any]]:
    """
    Score all callers with v2 scoring and rank by score.
    
    Args:
        callers: List of caller stats dicts
        config: Scoring configuration
        min_n: Minimum sample size to include
        
    Returns:
        Scored callers sorted by score_v2 descending
    """
    scored = []
    for c in callers:
        if c.get("n", 0) < min_n:
            continue
        scored.append(score_caller_v2(c, config))
    
    # Sort by score_v2 descending
    scored.sort(key=lambda x: x.get("score_v2", 0.0), reverse=True)
    
    # Add rank
    for i, s in enumerate(scored, 1):
        s["rank_v2"] = i
    
    return scored


def print_scored_leaderboard(
    scored: List[Dict[str, Any]],
    limit: int = 30,
) -> None:
    """
    Print a formatted scored leaderboard.
    
    Args:
        scored: List of scored caller dicts
        limit: Max callers to show
    """
    import sys
    
    if not scored:
        print("No scored callers.", file=sys.stderr)
        return
    
    print(f"{'Rank':<5} {'Caller':<24} {'n':>5} {'Score':>8} {'Hit2x%':>7} {'T2x':>6} {'RiskDD':>7} {'RiskPen':>8} {'Disc':>5}")
    print("-" * 95)
    
    for s in scored[:limit]:
        caller = (s.get("caller") or "-")[:23]
        n = s.get("n", 0)
        score = s.get("score_v2", 0.0)
        hit2x = s.get("hit2x_pct", 0.0)
        t2x_min = s.get("median_t2x_min")
        risk_dd = s.get("risk_dd_pct", 0.0)
        risk_pen = s.get("risk_penalty", 0.0)
        disc = s.get("discipline_bonus", 0.0)
        
        t2x_str = f"{t2x_min:.0f}m" if t2x_min is not None else "-"
        
        print(
            f"{s.get('rank_v2', 0):<5} "
            f"{caller:<24} "
            f"{n:>5} "
            f"{score:>8.2f} "
            f"{hit2x:>6.1f}% "
            f"{t2x_str:>6} "
            f"{risk_dd:>6.1f}% "
            f"{risk_pen:>8.2f} "
            f"{disc:>5.2f}"
        )


# =============================================================================
# DuckDB View SQL Generator
# =============================================================================

def generate_caller_scored_v2_sql(config: ScoringConfig = DEFAULT_SCORING_CONFIG) -> str:
    """
    Generate SQL to create the baseline.caller_scored_v2 view in DuckDB.
    
    This produces a view that matches the Python scoring logic.
    
    Args:
        config: Scoring configuration
        
    Returns:
        SQL string to create the view
    """
    return f"""
-- Creates baseline.caller_scored_v2
-- Matches Python scoring logic in lib/scoring.py

CREATE SCHEMA IF NOT EXISTS baseline;

CREATE OR REPLACE VIEW baseline.caller_scored_v2 AS
WITH src AS (
  SELECT
    run_id,
    caller,
    n,

    median_ath,
    p75_ath,
    COALESCE(p95_ath, p75_ath) AS p95_ath,  -- Fallback if p95 not computed

    hit2x_pct,
    hit3x_pct,
    hit4x_pct,
    hit5x_pct,

    median_t2x_hrs,

    -- Prefer "pre2x_or_horizon" because it exists even when 2x is never hit.
    COALESCE(median_dd_pre2x_or_horizon_pct, median_dd_pre2x_pct, median_dd_overall_pct) AS risk_dd_pct,
    median_dd_pre2x_pct,
    median_dd_pre2x_or_horizon_pct,
    median_dd_overall_pct

  FROM baseline.caller_stats_f
),
feat AS (
  SELECT
    *,
    -- Convert dd pct (-63.8) -> magnitude as decimal (0.638)
    GREATEST(0.0, -risk_dd_pct / 100.0) AS risk_mag,

    -- Convert median_t2x_hrs to minutes for nicer intuition
    CASE
      WHEN median_t2x_hrs IS NULL THEN NULL
      ELSE median_t2x_hrs * 60.0
    END AS median_t2x_min,

    -- Base upside: median edge times hit-rate
    (GREATEST(median_ath - 1.0, 0.0) * (hit2x_pct / 100.0)) AS base_upside,

    -- Tail bonus: reward p75 & p95 above median (fat right tail)
    ({config.tail_p75_weight} * GREATEST(p75_ath - median_ath, 0.0))
    + ({config.tail_p95_weight} * GREATEST(p95_ath - p75_ath, 0.0)) AS tail_bonus,

    -- Fast 2x boost in [0..1], only when median_t2x exists
    CASE
      WHEN median_t2x_hrs IS NULL THEN 0.0
      ELSE exp(-(median_t2x_hrs * 60.0) / {config.timing_halflife_min})
    END AS fast2x_signal,

    -- Confidence shrink so small-ish samples don't dominate
    sqrt(n * 1.0 / (n + {config.confidence_k})) AS confidence

  FROM src
),
pen AS (
  SELECT
    *,
    -- Exponential penalty once risk_mag exceeds threshold
    CASE
      WHEN risk_mag <= {config.risk_threshold} THEN 0.0
      ELSE exp({config.risk_rate} * (risk_mag - {config.risk_threshold})) - 1.0
    END AS risk_penalty,

    -- Synergy bonus: high hit rate + low risk
    CASE
      WHEN hit2x_pct >= {config.discipline_hit2x_threshold} AND risk_mag <= {config.discipline_dd_threshold} THEN {config.discipline_bonus}
      ELSE 0.0
    END AS discipline_bonus
  FROM feat
),
score AS (
  SELECT
    *,
    -- Timing multiplier: max ~ +{int(config.timing_max_boost*100)}% lift when ultra-fast, fades with time
    (1.0 + {config.timing_max_boost} * fast2x_signal) AS timing_mult,

    -- Final score:
    confidence
      * (
          ((base_upside + tail_bonus) * (1.0 + {config.timing_max_boost} * fast2x_signal))
          + discipline_bonus
          - ({config.risk_weight} * risk_penalty)
        ) AS score_v2

  FROM pen
)
SELECT
  run_id,
  caller,
  n,

  median_ath,
  p75_ath,
  p95_ath,

  hit2x_pct,
  hit3x_pct,
  hit4x_pct,
  hit5x_pct,

  median_t2x_hrs,
  median_t2x_min,

  median_dd_pre2x_pct,
  median_dd_pre2x_or_horizon_pct,
  median_dd_overall_pct,
  risk_dd_pct,
  risk_mag,

  base_upside,
  tail_bonus,
  fast2x_signal,
  discipline_bonus,
  risk_penalty,
  confidence,
  timing_mult,

  score_v2,
  row_number() OVER (PARTITION BY run_id ORDER BY score_v2 DESC) AS rank_v2

FROM score;
"""

