"""
Metrics Contract - Canonical metric definitions.

SINGLE SOURCE OF TRUTH for what each metric means.
Every view/script consumes these same definitions.

Metrics are defined in three layers:
1. Raw path metrics (computed from candle data)
2. Strategy metrics (computed after applying exits)
3. Scoring metrics (derived, for ranking callers)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Optional


# =============================================================================
# Metric Categories
# =============================================================================

class MetricCategory(str, Enum):
    """Categories of metrics."""
    PATH = "path"           # Raw price path
    STRATEGY = "strategy"   # After TP/SL/exits applied
    SCORING = "scoring"     # Derived ranking metrics


# =============================================================================
# PATH METRICS (raw price path, no strategy applied)
# =============================================================================

@dataclass(frozen=True)
class PathMetricDef:
    """Definition of a path metric."""
    name: str
    description: str
    unit: str
    sql_expr: str
    
    def __str__(self) -> str:
        return f"{self.name}: {self.description} ({self.unit})"


# Canonical path metric definitions
PATH_METRICS: Dict[str, PathMetricDef] = {
    # Basic peak/trough
    "peak_mult": PathMetricDef(
        name="peak_mult",
        description="Maximum price multiple reached (high/entry_price)",
        unit="multiple",
        sql_expr="MAX(high) / entry_price",
    ),
    "trough_mult": PathMetricDef(
        name="trough_mult",
        description="Minimum price multiple reached (low/entry_price)",
        unit="multiple",
        sql_expr="MIN(low) / entry_price",
    ),
    "final_mult": PathMetricDef(
        name="final_mult",
        description="Final price multiple at horizon end",
        unit="multiple",
        sql_expr="LAST(close ORDER BY timestamp) / entry_price",
    ),
    
    # Drawdown metrics
    "dd_initial": PathMetricDef(
        name="dd_initial",
        description="Drawdown from entry before price ever recovers above entry. "
                   "This is the initial dip you must stomach.",
        unit="fraction",
        sql_expr="""
            -- Find first candle that closes above entry (recovery point)
            -- dd_initial = (entry_price - min_low_before_recovery) / entry_price
            -- If never recovers, this is the overall max drawdown
            CASE
                WHEN MIN(CASE WHEN close >= entry_price THEN timestamp END) IS NULL THEN
                    (entry_price - MIN(low)) / entry_price
                ELSE
                    (entry_price - MIN(CASE 
                        WHEN timestamp < MIN(CASE WHEN close >= entry_price THEN timestamp END) 
                        THEN low ELSE entry_price END)) / entry_price
            END
        """,
    ),
    "dd_max": PathMetricDef(
        name="dd_max",
        description="Maximum drawdown from peak at any point in the path. "
                   "Running max of (peak_so_far - low) / peak_so_far.",
        unit="fraction",
        sql_expr="MAX((running_peak - low) / running_peak)",
    ),
    "dd_pre2x": PathMetricDef(
        name="dd_pre2x",
        description="Biggest drawdown below entry PRIOR to hitting 2x. "
                   "Only defined for paths that actually hit 2x.",
        unit="fraction",
        sql_expr="""
            CASE
                WHEN MAX(high) < entry_price * 2.0 THEN NULL
                ELSE (
                    SELECT (entry_price - MIN(low)) / entry_price
                    FROM candles c2 
                    WHERE c2.token_address = c.token_address
                      AND c2.timestamp < (
                          SELECT MIN(timestamp) FROM candles c3 
                          WHERE c3.token_address = c.token_address 
                            AND c3.high >= entry_price * 2.0
                      )
                )
            END
        """,
    ),
    "dd_pre2x_or_horizon": PathMetricDef(
        name="dd_pre2x_or_horizon",
        description="Same as dd_pre2x but defined for everyone: "
                   "drawdown before 2x OR drawdown over whole horizon if 2x never hit.",
        unit="fraction",
        sql_expr="""
            CASE
                WHEN MAX(high) >= entry_price * 2.0 THEN
                    -- dd before 2x
                    (entry_price - MIN(CASE 
                        WHEN timestamp < first_2x_ts THEN low 
                        ELSE entry_price END)) / entry_price
                ELSE
                    -- dd over whole horizon
                    (entry_price - MIN(low)) / entry_price
            END
        """,
    ),
    
    # Time metrics
    "time_to_peak_ms": PathMetricDef(
        name="time_to_peak_ms",
        description="Milliseconds from entry to peak price",
        unit="ms",
        sql_expr="(peak_timestamp - alert_timestamp_ms)",
    ),
    "time_to_2x_ms": PathMetricDef(
        name="time_to_2x_ms",
        description="Milliseconds from entry to first 2x (NULL if never hit)",
        unit="ms",
        sql_expr="""
            CASE
                WHEN MAX(high) >= entry_price * 2.0 THEN
                    (MIN(CASE WHEN high >= entry_price * 2.0 THEN timestamp END) - alert_timestamp_ms)
                ELSE NULL
            END
        """,
    ),
    "time_to_3x_ms": PathMetricDef(
        name="time_to_3x_ms",
        description="Milliseconds from entry to first 3x (NULL if never hit)",
        unit="ms",
        sql_expr="""
            CASE
                WHEN MAX(high) >= entry_price * 3.0 THEN
                    (MIN(CASE WHEN high >= entry_price * 3.0 THEN timestamp END) - alert_timestamp_ms)
                ELSE NULL
            END
        """,
    ),
    
    # Boolean flags
    "hit_2x": PathMetricDef(
        name="hit_2x",
        description="Whether price ever reached 2x",
        unit="bool",
        sql_expr="MAX(high) >= entry_price * 2.0",
    ),
    "hit_3x": PathMetricDef(
        name="hit_3x",
        description="Whether price ever reached 3x",
        unit="bool",
        sql_expr="MAX(high) >= entry_price * 3.0",
    ),
    "hit_4x": PathMetricDef(
        name="hit_4x",
        description="Whether price ever reached 4x",
        unit="bool",
        sql_expr="MAX(high) >= entry_price * 4.0",
    ),
}


# =============================================================================
# STRATEGY METRICS (after TP/SL/exits applied)
# =============================================================================

@dataclass(frozen=True)
class StrategyMetricDef:
    """Definition of a strategy-applied metric."""
    name: str
    description: str
    unit: str
    
    def __str__(self) -> str:
        return f"{self.name}: {self.description} ({self.unit})"


STRATEGY_METRICS: Dict[str, StrategyMetricDef] = {
    # Exit state
    "exit_reason": StrategyMetricDef(
        name="exit_reason",
        description="Why position was closed: 'tp', 'sl', 'time_limit', 'horizon', 'trailing'",
        unit="enum",
    ),
    "exit_mult": StrategyMetricDef(
        name="exit_mult",
        description="Price multiple at exit (exit_price / entry_price)",
        unit="multiple",
    ),
    "exit_bar_idx": StrategyMetricDef(
        name="exit_bar_idx",
        description="Index of the bar where exit occurred (0-based from entry)",
        unit="int",
    ),
    
    # Returns
    "gross_return": StrategyMetricDef(
        name="gross_return",
        description="Gross return before costs: (exit_price - entry_price) / entry_price",
        unit="fraction",
    ),
    "net_return": StrategyMetricDef(
        name="net_return",
        description="Net return after fees and slippage",
        unit="fraction",
    ),
    
    # Win/loss classification
    "is_win": StrategyMetricDef(
        name="is_win",
        description="True if net_return > 0",
        unit="bool",
    ),
    "is_tp_hit": StrategyMetricDef(
        name="is_tp_hit",
        description="True if exited due to take-profit",
        unit="bool",
    ),
    "is_sl_hit": StrategyMetricDef(
        name="is_sl_hit",
        description="True if exited due to stop-loss",
        unit="bool",
    ),
}


# =============================================================================
# SCORING METRICS (derived, for ranking callers)
# =============================================================================

@dataclass(frozen=True)
class ScoringMetricDef:
    """Definition of a scoring/ranking metric."""
    name: str
    description: str
    higher_is_better: bool
    weight: float  # Default weight in composite scores
    
    def __str__(self) -> str:
        direction = "↑" if self.higher_is_better else "↓"
        return f"{self.name} {direction}: {self.description}"


SCORING_METRICS: Dict[str, ScoringMetricDef] = {
    # Win rate family
    "win_rate": ScoringMetricDef(
        name="win_rate",
        description="Fraction of trades with net_return > 0",
        higher_is_better=True,
        weight=1.0,
    ),
    "hit_2x_rate": ScoringMetricDef(
        name="hit_2x_rate",
        description="Fraction of trades where peak_mult >= 2.0",
        higher_is_better=True,
        weight=0.8,
    ),
    "hit_3x_rate": ScoringMetricDef(
        name="hit_3x_rate",
        description="Fraction of trades where peak_mult >= 3.0",
        higher_is_better=True,
        weight=0.6,
    ),
    
    # Return family
    "avg_return": ScoringMetricDef(
        name="avg_return",
        description="Mean net_return across all trades",
        higher_is_better=True,
        weight=1.0,
    ),
    "median_return": ScoringMetricDef(
        name="median_return",
        description="Median net_return (more robust to outliers)",
        higher_is_better=True,
        weight=1.0,
    ),
    "total_return": ScoringMetricDef(
        name="total_return",
        description="Sum of net_return across all trades",
        higher_is_better=True,
        weight=0.5,
    ),
    
    # Risk-adjusted
    "profit_factor": ScoringMetricDef(
        name="profit_factor",
        description="Sum of wins / abs(sum of losses). PF > 1 is profitable.",
        higher_is_better=True,
        weight=1.0,
    ),
    "expectancy": ScoringMetricDef(
        name="expectancy",
        description="(win_rate * avg_win) + ((1-win_rate) * avg_loss). "
                   "Expected return per trade.",
        higher_is_better=True,
        weight=1.2,
    ),
    "sharpe_approx": ScoringMetricDef(
        name="sharpe_approx",
        description="avg_return / stddev(return). Higher = more consistent.",
        higher_is_better=True,
        weight=0.8,
    ),
    
    # Risk metrics
    "avg_dd_pre2x": ScoringMetricDef(
        name="avg_dd_pre2x",
        description="Average dd_pre2x_or_horizon across trades",
        higher_is_better=False,  # Lower is better
        weight=0.5,
    ),
    "max_dd": ScoringMetricDef(
        name="max_dd",
        description="Maximum drawdown across all trades",
        higher_is_better=False,
        weight=0.3,
    ),
    
    # Volume/activity
    "n_trades": ScoringMetricDef(
        name="n_trades",
        description="Number of trades (for statistical significance)",
        higher_is_better=True,
        weight=0.2,  # Small weight, mostly a filter
    ),
}


# =============================================================================
# Score Versions
# =============================================================================

@dataclass
class ScoreVersion:
    """A specific scoring formula version."""
    version: str
    description: str
    formula: str  # SQL or Python expression
    metrics_used: list  # Which metrics feed into this score
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "description": self.description,
            "formula": self.formula,
            "metrics_used": self.metrics_used,
        }


# Canonical score versions
SCORE_VERSIONS: Dict[str, ScoreVersion] = {
    "v1": ScoreVersion(
        version="v1",
        description="Simple win-rate * avg-return product",
        formula="win_rate * (1 + avg_return)",
        metrics_used=["win_rate", "avg_return"],
    ),
    "v2": ScoreVersion(
        version="v2",
        description="Expectancy-based with profit factor bonus",
        formula="""
            CASE 
                WHEN n_trades < 10 THEN 0  -- Not enough data
                ELSE expectancy * LEAST(profit_factor, 5.0) * LN(n_trades + 1)
            END
        """,
        metrics_used=["expectancy", "profit_factor", "n_trades"],
    ),
    "v3": ScoreVersion(
        version="v3",
        description="Risk-adjusted: penalize high drawdown callers",
        formula="""
            CASE
                WHEN n_trades < 10 THEN 0
                ELSE (
                    expectancy 
                    * LEAST(profit_factor, 5.0) 
                    * (1 - COALESCE(avg_dd_pre2x, 0.5))  -- DD penalty
                    * LN(n_trades + 1)
                )
            END
        """,
        metrics_used=["expectancy", "profit_factor", "avg_dd_pre2x", "n_trades"],
    ),
}


def get_score_version(version: str) -> Optional[ScoreVersion]:
    """Get a scoring version definition."""
    return SCORE_VERSIONS.get(version)


def list_score_versions() -> list:
    """List all available score versions."""
    return list(SCORE_VERSIONS.keys())


# =============================================================================
# Documentation Generator
# =============================================================================

def print_metrics_doc() -> None:
    """Print documentation for all metrics."""
    print("=" * 70)
    print("QUANTBOT METRICS CONTRACT")
    print("=" * 70)
    
    print("\n## PATH METRICS (raw price path)\n")
    for name, m in PATH_METRICS.items():
        print(f"  {name}")
        print(f"    {m.description}")
        print(f"    Unit: {m.unit}")
        print()
    
    print("\n## STRATEGY METRICS (after exits applied)\n")
    for name, m in STRATEGY_METRICS.items():
        print(f"  {name}")
        print(f"    {m.description}")
        print(f"    Unit: {m.unit}")
        print()
    
    print("\n## SCORING METRICS (for ranking callers)\n")
    for name, m in SCORING_METRICS.items():
        direction = "higher is better" if m.higher_is_better else "lower is better"
        print(f"  {name}")
        print(f"    {m.description}")
        print(f"    Direction: {direction}, Default weight: {m.weight}")
        print()
    
    print("\n## SCORE VERSIONS\n")
    for version, sv in SCORE_VERSIONS.items():
        print(f"  {version}: {sv.description}")
        print(f"    Uses: {', '.join(sv.metrics_used)}")
        print()


if __name__ == "__main__":
    print_metrics_doc()

