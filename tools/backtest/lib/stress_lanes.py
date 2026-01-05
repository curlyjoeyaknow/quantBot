"""
Stress Lane Matrix for Robust Backtesting.

Defines multiple execution scenarios (lanes) to stress-test strategies:
- Baseline: Normal fees and slippage
- Worse: Elevated fees/slippage
- Ugly: Extreme slippage (illiquid conditions)
- Latency: Delayed entry (1+ candle lag)
- Gap Model: Conservative stop fills (stop gapping)

Two modes:
1. Analytical: Fast estimation without re-running backtests (discovery phase)
2. Full-run: Actual backtest re-runs with modified parameters (validation phase)

Scoring: Maximin - rank by min(lane_scores) to force anti-fragility.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median
from typing import Any, Dict, List, Optional, Tuple


# =============================================================================
# STRESS LANE CONFIGURATION
# =============================================================================

@dataclass
class StressLane:
    """
    Configuration for a single stress lane.
    
    Each lane represents a different execution/market condition scenario.
    """
    name: str
    
    # Execution costs (basis points)
    fee_bps: float = 50.0
    slippage_bps: float = 100.0
    
    # Entry timing
    latency_candles: int = 0  # Shift entry to Nth next candle's open
    
    # Stop gap modeling
    stop_gap_prob: float = 0.15   # Probability stop gaps through
    stop_gap_mult: float = 1.5    # When gapped, loss is multiplied by this
    
    # Description for reporting
    description: str = ""
    
    def __post_init__(self):
        if not self.description:
            parts = []
            parts.append(f"fees={self.fee_bps}bps")
            parts.append(f"slip={self.slippage_bps}bps")
            if self.latency_candles > 0:
                parts.append(f"lat+{self.latency_candles}")
            if self.stop_gap_prob > 0.15:
                parts.append(f"gap={self.stop_gap_prob:.0%}")
            self.description = " ".join(parts)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "fee_bps": self.fee_bps,
            "slippage_bps": self.slippage_bps,
            "latency_candles": self.latency_candles,
            "stop_gap_prob": self.stop_gap_prob,
            "stop_gap_mult": self.stop_gap_mult,
            "description": self.description,
        }


# =============================================================================
# LANE PRESETS
# =============================================================================

# Basic lane set - minimal stress testing
STRESS_LANES_BASIC = [
    StressLane(
        name="baseline",
        fee_bps=50,
        slippage_bps=100,
        latency_candles=0,
        stop_gap_prob=0.15,
        stop_gap_mult=1.5,
        description="Normal execution conditions",
    ),
    StressLane(
        name="worse",
        fee_bps=75,
        slippage_bps=150,
        latency_candles=0,
        stop_gap_prob=0.15,
        stop_gap_mult=1.5,
        description="Elevated costs (congested market)",
    ),
]

# Full lane set - comprehensive stress testing
STRESS_LANES_FULL = [
    StressLane(
        name="baseline",
        fee_bps=50,
        slippage_bps=100,
        latency_candles=0,
        stop_gap_prob=0.15,
        stop_gap_mult=1.5,
        description="Normal execution conditions",
    ),
    StressLane(
        name="worse",
        fee_bps=75,
        slippage_bps=150,
        latency_candles=0,
        stop_gap_prob=0.15,
        stop_gap_mult=1.5,
        description="Elevated costs (congested market)",
    ),
    StressLane(
        name="ugly",
        fee_bps=50,
        slippage_bps=200,
        latency_candles=0,
        stop_gap_prob=0.15,
        stop_gap_mult=1.5,
        description="Extreme slippage (illiquid/volatile)",
    ),
    StressLane(
        name="latency_1",
        fee_bps=50,
        slippage_bps=100,
        latency_candles=1,
        stop_gap_prob=0.15,
        stop_gap_mult=1.5,
        description="+1 candle entry delay",
    ),
    StressLane(
        name="gap_model",
        fee_bps=50,
        slippage_bps=100,
        latency_candles=0,
        stop_gap_prob=0.25,
        stop_gap_mult=2.0,
        description="Conservative stop fills (25% gap, 2x loss)",
    ),
]

# Extended lane set - includes latency_2 and combined stress
STRESS_LANES_EXTENDED = STRESS_LANES_FULL + [
    StressLane(
        name="latency_2",
        fee_bps=50,
        slippage_bps=100,
        latency_candles=2,
        stop_gap_prob=0.15,
        stop_gap_mult=1.5,
        description="+2 candle entry delay",
    ),
    StressLane(
        name="combined_stress",
        fee_bps=75,
        slippage_bps=175,
        latency_candles=1,
        stop_gap_prob=0.20,
        stop_gap_mult=1.75,
        description="Combined adverse conditions",
    ),
]

# Adversarial lane set - war room level testing
STRESS_LANES_ADVERSARIAL = STRESS_LANES_EXTENDED + [
    StressLane(
        name="fee_spike",
        fee_bps=150,  # 3x normal fees
        slippage_bps=100,
        latency_candles=0,
        stop_gap_prob=0.15,
        stop_gap_mult=1.5,
        description="Fee spike (3x normal) - high priority period",
    ),
    StressLane(
        name="slip_spike",
        fee_bps=50,
        slippage_bps=500,  # 5x normal slippage
        latency_candles=0,
        stop_gap_prob=0.15,
        stop_gap_mult=1.5,
        description="Slippage spike (5x) - flash crash / pump",
    ),
    StressLane(
        name="delayed_exit",
        fee_bps=50,
        slippage_bps=150,
        latency_candles=0,
        stop_gap_prob=0.35,  # 35% stop gap probability
        stop_gap_mult=2.5,   # When gapped, very bad fills
        description="Delayed exits (35% gap @ 2.5x)",
    ),
    StressLane(
        name="full_stress",
        fee_bps=100,
        slippage_bps=250,
        latency_candles=2,
        stop_gap_prob=0.30,
        stop_gap_mult=2.0,
        description="Full stress - everything at once",
    ),
]

# Default matrix (full set)
STRESS_LANE_MATRIX = STRESS_LANES_FULL


def get_stress_lanes(preset: str = "full") -> List[StressLane]:
    """
    Get stress lane configuration by preset name.
    
    Args:
        preset: "basic", "full", "extended", "adversarial", "lite", 
                or custom comma-separated lane names
    
    Returns:
        List of StressLane configurations
    """
    presets = {
        "basic": STRESS_LANES_BASIC,
        "lite": STRESS_LANES_BASIC,  # Alias
        "full": STRESS_LANES_FULL,
        "extended": STRESS_LANES_EXTENDED,
        "adversarial": STRESS_LANES_ADVERSARIAL,
    }
    
    if preset in presets:
        return presets[preset]
    
    # Custom: comma-separated lane names from adversarial set (most complete)
    lane_names = [n.strip().lower() for n in preset.split(",")]
    all_lanes = {lane.name: lane for lane in STRESS_LANES_ADVERSARIAL}
    
    result = []
    for name in lane_names:
        if name in all_lanes:
            result.append(all_lanes[name])
    
    return result if result else STRESS_LANES_FULL


# =============================================================================
# ANALYTICAL STRESS SIMULATION
# =============================================================================

def simulate_lane_stress_analytical(
    base_test_r: float,
    base_slippage_bps: float,
    avg_r: float,
    win_rate: float,
    n_trades: int,
    avg_r_loss: float,
    lane: StressLane,
) -> Tuple[float, Dict[str, Any]]:
    """
    Analytically simulate stressed R for a single lane.
    
    This is a fast approximation for the discovery phase.
    Does NOT re-run backtests - applies formulas to base results.
    
    Args:
        base_test_r: Original TestR from backtest
        base_slippage_bps: Slippage used in original backtest
        avg_r: Average R per trade
        win_rate: Win rate (0-1)
        n_trades: Number of trades
        avg_r_loss: Average R on losing trades (negative)
        lane: StressLane configuration
    
    Returns:
        (stressed_r, breakdown_dict)
    """
    breakdown = {
        "lane": lane.name,
        "base_test_r": base_test_r,
        "adjustments": {},
    }
    
    if n_trades <= 0:
        return 0.0, breakdown
    
    total_hit = 0.0
    
    # 1. Slippage differential
    # Each bps of slippage costs ~0.01% per trade
    # Convert to R impact: assume avg trade is ~1R at risk
    slippage_delta_bps = lane.slippage_bps - base_slippage_bps
    if slippage_delta_bps != 0:
        # R impact per trade ≈ slippage_delta_bps / 10000
        r_per_trade_hit = slippage_delta_bps / 10000.0
        slippage_hit = r_per_trade_hit * n_trades
        breakdown["adjustments"]["slippage_delta"] = {
            "delta_bps": slippage_delta_bps,
            "hit_r": slippage_hit,
        }
        total_hit += slippage_hit
    
    # 2. Fee differential (similar logic)
    # Assuming base fee was 30bps
    base_fee_bps = 30.0  # Typical base fee
    fee_delta_bps = lane.fee_bps - base_fee_bps
    if fee_delta_bps > 0:
        r_per_trade_hit = fee_delta_bps / 10000.0
        fee_hit = r_per_trade_hit * n_trades
        breakdown["adjustments"]["fee_delta"] = {
            "delta_bps": fee_delta_bps,
            "hit_r": fee_hit,
        }
        total_hit += fee_hit
    
    # 3. Stop gap modeling
    # Some losing trades have worse exits than expected
    n_losses = int(n_trades * (1.0 - win_rate))
    if lane.stop_gap_prob > 0 and n_losses > 0:
        n_gapped = int(n_losses * lane.stop_gap_prob)
        # Extra loss per gapped trade
        extra_loss_per_gap = abs(avg_r_loss) * (lane.stop_gap_mult - 1.0)
        gap_hit = extra_loss_per_gap * n_gapped
        breakdown["adjustments"]["stop_gap"] = {
            "n_losses": n_losses,
            "n_gapped": n_gapped,
            "extra_loss_per": extra_loss_per_gap,
            "hit_r": gap_hit,
        }
        total_hit += gap_hit
    
    # 4. Latency modeling (analytical approximation)
    # Entry delay typically hurts: assume price moved unfavorably
    # Conservative estimate: 0.5% adverse move per candle delay
    if lane.latency_candles > 0:
        adverse_move_pct = 0.005 * lane.latency_candles  # 0.5% per candle
        # This reduces win rate effective return
        latency_hit = adverse_move_pct * n_trades
        breakdown["adjustments"]["latency"] = {
            "candles": lane.latency_candles,
            "adverse_move_pct": adverse_move_pct,
            "hit_r": latency_hit,
        }
        total_hit += latency_hit
    
    stressed_r = base_test_r - total_hit
    breakdown["total_hit"] = total_hit
    breakdown["stressed_r"] = stressed_r
    breakdown["stress_pct"] = (total_hit / abs(base_test_r)) if base_test_r != 0 else 0.0
    
    return stressed_r, breakdown


def simulate_all_lanes_analytical(
    base_test_r: float,
    base_slippage_bps: float,
    avg_r: float,
    win_rate: float,
    n_trades: int,
    avg_r_loss: float,
    lanes: List[StressLane] = None,
) -> Dict[str, Any]:
    """
    Simulate all stress lanes analytically.
    
    Args:
        base_test_r: Original TestR from backtest
        base_slippage_bps: Slippage used in original backtest
        avg_r: Average R per trade
        win_rate: Win rate (0-1)
        n_trades: Number of trades
        avg_r_loss: Average R on losing trades (negative)
        lanes: List of StressLane configs (default: STRESS_LANE_MATRIX)
    
    Returns:
        Dict with lane results and aggregate scores
    """
    if lanes is None:
        lanes = STRESS_LANE_MATRIX
    
    lane_results = {}
    for lane in lanes:
        stressed_r, breakdown = simulate_lane_stress_analytical(
            base_test_r=base_test_r,
            base_slippage_bps=base_slippage_bps,
            avg_r=avg_r,
            win_rate=win_rate,
            n_trades=n_trades,
            avg_r_loss=avg_r_loss,
            lane=lane,
        )
        lane_results[lane.name] = {
            "stressed_r": stressed_r,
            "breakdown": breakdown,
        }
    
    # Compute aggregate scores
    stressed_rs = [lane_results[l.name]["stressed_r"] for l in lanes]
    
    return {
        "lane_results": lane_results,
        "lane_scores": {l.name: lane_results[l.name]["stressed_r"] for l in lanes},
        "min_score": min(stressed_rs) if stressed_rs else 0.0,
        "median_score": median(stressed_rs) if stressed_rs else 0.0,
        "p25_score": sorted(stressed_rs)[len(stressed_rs) // 4] if len(stressed_rs) >= 4 else min(stressed_rs) if stressed_rs else 0.0,
    }


# =============================================================================
# LANE SCORING (MAXIMIN)
# =============================================================================

@dataclass
class LaneScoreResult:
    """Result of lane scoring for a candidate."""
    
    # Per-lane results
    lane_scores: Dict[str, float]
    lane_details: Dict[str, Dict[str, Any]]
    
    # Aggregate scores
    robust_score: float      # min(lane_scores) - THE KEY
    median_score: float      # median(lane_scores)
    p25_score: float         # 25th percentile
    mean_score: float        # mean(lane_scores)
    
    # Which lane is the "killer"?
    worst_lane: str
    worst_lane_score: float
    
    # Gate pass/fail per lane
    lanes_passing: int
    lanes_total: int
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "lane_scores": self.lane_scores,
            "robust_score": self.robust_score,
            "median_score": self.median_score,
            "p25_score": self.p25_score,
            "mean_score": self.mean_score,
            "worst_lane": self.worst_lane,
            "worst_lane_score": self.worst_lane_score,
            "lanes_passing": self.lanes_passing,
            "lanes_total": self.lanes_total,
        }


def compute_lane_scores(
    lane_results: Dict[str, float],
    min_score_threshold: float = 0.0,
) -> LaneScoreResult:
    """
    Compute aggregate scores from lane results.
    
    The key metric is robust_score = min(lane_scores).
    This forces anti-fragility: you can't hide from your worst case.
    
    Args:
        lane_results: Dict mapping lane name to TestR for that lane
        min_score_threshold: Minimum score to "pass" a lane (default: 0, must be profitable)
    
    Returns:
        LaneScoreResult with all aggregate metrics
    """
    if not lane_results:
        return LaneScoreResult(
            lane_scores={},
            lane_details={},
            robust_score=-999.0,
            median_score=0.0,
            p25_score=0.0,
            mean_score=0.0,
            worst_lane="none",
            worst_lane_score=-999.0,
            lanes_passing=0,
            lanes_total=0,
        )
    
    scores = list(lane_results.values())
    sorted_scores = sorted(scores)
    
    # Find worst lane
    worst_lane = min(lane_results.keys(), key=lambda k: lane_results[k])
    worst_score = lane_results[worst_lane]
    
    # Count passing lanes
    lanes_passing = sum(1 for s in scores if s >= min_score_threshold)
    
    # Compute percentiles
    n = len(sorted_scores)
    p25_idx = max(0, n // 4 - 1) if n >= 4 else 0
    median_idx = n // 2
    
    return LaneScoreResult(
        lane_scores=lane_results,
        lane_details={},  # Populated separately if needed
        robust_score=worst_score,
        median_score=sorted_scores[median_idx] if n > 0 else 0.0,
        p25_score=sorted_scores[p25_idx] if n > 0 else 0.0,
        mean_score=sum(scores) / n if n > 0 else 0.0,
        worst_lane=worst_lane,
        worst_lane_score=worst_score,
        lanes_passing=lanes_passing,
        lanes_total=len(lane_results),
    )


# =============================================================================
# FULL-RUN STRESS VALIDATION (for champions)
# =============================================================================

@dataclass
class ChampionValidationResult:
    """Result of full stress lane validation for an island champion."""
    
    island_id: int
    params: Dict[str, Any]
    
    # Discovery phase score (before stress lanes)
    discovery_score: float
    
    # Per-lane full backtest results
    lane_results: Dict[str, Dict[str, Any]]
    
    # Lane scoring
    lane_score_result: LaneScoreResult
    
    # Final ranking score (robust_score from lanes)
    validation_score: float
    
    # Improvement/degradation from discovery
    score_delta: float
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "island_id": self.island_id,
            "params": self.params,
            "discovery_score": self.discovery_score,
            "lane_results": {
                lane: {
                    "test_r": result.get("test_r"),
                    "ratio": result.get("ratio"),
                    "passes_gates": result.get("passes_gates"),
                }
                for lane, result in self.lane_results.items()
            },
            "lane_scores": self.lane_score_result.lane_scores,
            "robust_score": self.lane_score_result.robust_score,
            "worst_lane": self.lane_score_result.worst_lane,
            "validation_score": self.validation_score,
            "score_delta": self.score_delta,
        }


def print_lane_matrix(champions: List[ChampionValidationResult]) -> None:
    """Print stress lane validation matrix for champions."""
    if not champions:
        print("No champions to display.")
        return
    
    # Get lane names from first champion
    lane_names = list(champions[0].lane_results.keys()) if champions[0].lane_results else []
    
    print(f"\n{'='*80}")
    print("ISLAND CHAMPIONS (stress lane validation):")
    print("─" * 80)
    
    for champ in champions:
        params = champ.params
        print(f"\nIsland {champ.island_id} Champion: TP={params.get('tp_mult', 0):.2f}x SL={params.get('sl_mult', 0):.2f}x")
        
        for lane_name in lane_names:
            result = champ.lane_results.get(lane_name, {})
            test_r = result.get("test_r", 0)
            ratio = result.get("ratio", 0)
            passes = result.get("passes_gates", False)
            gate_str = "✓" if passes else "✗"
            
            print(f"  {lane_name:12s}: TestR={test_r:+6.1f}  Ratio={ratio:.2f}  {gate_str}")
        
        print(f"  → robust_score (min): {champ.lane_score_result.robust_score:+.1f}")
    
    # Print maximin winner
    if champions:
        winner = max(champions, key=lambda c: c.validation_score)
        params = winner.params
        print(f"\n{'='*80}")
        print(f"MAXIMIN WINNER: Island {winner.island_id} (TP={params.get('tp_mult', 0):.2f}x SL={params.get('sl_mult', 0):.2f}x)")
        print(f"  Survives worst-case lanes better than alternatives.")
        print(f"  Robust score: {winner.validation_score:+.1f}")
        print(f"  Worst lane: {winner.lane_score_result.worst_lane}")
        print("=" * 80)

