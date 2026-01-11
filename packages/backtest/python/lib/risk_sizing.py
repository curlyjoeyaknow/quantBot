"""
Risk Sizing - Portfolio-based position sizing.

Core formula:
    position_pct = risk_budget / stop_distance

Where:
    risk_budget = 0.02 (2% of portfolio at risk per trade)
    stop_distance = (entry - stop) / entry

This converts raw token returns into portfolio returns under a fixed risk budget.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


# =============================================================================
# Constants
# =============================================================================

DEFAULT_RISK_BUDGET = 0.02  # 2% of portfolio at risk per trade
DEFAULT_MAX_POSITION_PCT = 1.0  # 100% max (can go lower for safety)
DEFAULT_MIN_STOP_DISTANCE = 0.02  # 2% minimum stop distance

# Fee/slippage defaults (as fractions, not bps)
DEFAULT_FEE_ENTRY = 0.003  # 30 bps
DEFAULT_FEE_EXIT = 0.003   # 30 bps
DEFAULT_SLIPPAGE_ALLOWANCE = 0.005  # 50 bps


# =============================================================================
# Core Sizing Functions
# =============================================================================

def compute_stop_distance(
    entry_price: float,
    stop_price: float,
) -> float:
    """
    Compute stop distance as a fraction of entry price.
    
    d = (entry - stop) / entry
    
    For a long position, stop < entry, so d > 0.
    
    Args:
        entry_price: Entry price
        stop_price: Stop price (must be < entry for long)
        
    Returns:
        Stop distance as a positive fraction (e.g., 0.10 for 10% stop)
    """
    if entry_price <= 0:
        return 0.0
    return max(0.0, (entry_price - stop_price) / entry_price)


def compute_stop_distance_from_mult(stop_mult: float) -> float:
    """
    Compute stop distance from a stop multiplier.
    
    stop_mult = stop_price / entry_price
    d = 1 - stop_mult
    
    Examples:
        stop_mult = 0.5 → d = 0.5 (50% stop)
        stop_mult = 0.9 → d = 0.1 (10% stop)
        stop_mult = 0.98 → d = 0.02 (2% stop)
    """
    return max(0.0, 1.0 - stop_mult)


def compute_effective_stop_distance(
    stop_distance: float,
    fee_entry: float = DEFAULT_FEE_ENTRY,
    fee_exit: float = DEFAULT_FEE_EXIT,
    slippage_allowance: float = DEFAULT_SLIPPAGE_ALLOWANCE,
) -> float:
    """
    Compute effective stop distance including fees and slippage.
    
    d_eff = d + fee_entry + fee_exit + slippage_allowance
    
    This ensures "max loss is 2%" accounts for real costs.
    
    Args:
        stop_distance: Raw stop distance (e.g., 0.10 for 10%)
        fee_entry: Entry fee as fraction (default 30 bps)
        fee_exit: Exit fee as fraction (default 30 bps)
        slippage_allowance: Slippage buffer (default 50 bps)
        
    Returns:
        Effective stop distance including costs
    """
    return stop_distance + fee_entry + fee_exit + slippage_allowance


def compute_position_pct(
    risk_budget: float,
    stop_distance: float,
    max_position_pct: float = DEFAULT_MAX_POSITION_PCT,
    min_stop_distance: float = DEFAULT_MIN_STOP_DISTANCE,
) -> float:
    """
    Compute position size as percentage of portfolio.
    
    position_pct = risk_budget / stop_distance
    
    With caps to prevent fantasy sizing.
    
    Args:
        risk_budget: Risk per trade as fraction (e.g., 0.02 for 2%)
        stop_distance: Stop distance as fraction (e.g., 0.10 for 10%)
        max_position_pct: Maximum position size (default 100%)
        min_stop_distance: Minimum stop distance to use (default 2%)
        
    Returns:
        Position size as fraction of portfolio (e.g., 0.20 for 20%)
    """
    # Enforce minimum stop distance to avoid fantasy sizing
    effective_d = max(stop_distance, min_stop_distance)
    
    # Core formula
    position_pct = risk_budget / effective_d
    
    # Cap at maximum
    return min(position_pct, max_position_pct)


def compute_portfolio_pnl(
    token_return: float,
    position_pct: float,
) -> float:
    """
    Compute portfolio PnL from token return and position size.
    
    pnl_portfolio_pct = position_pct * token_return
    
    Args:
        token_return: Token return as fraction (e.g., 5.55 for +555%)
        position_pct: Position size as fraction of portfolio
        
    Returns:
        Portfolio PnL as fraction (e.g., 1.11 for +111%)
    """
    return position_pct * token_return


def compute_r_multiple(
    portfolio_pnl: float,
    risk_budget: float = DEFAULT_RISK_BUDGET,
) -> float:
    """
    Compute R-multiple from portfolio PnL.
    
    R_multiple = pnl_portfolio_pct / risk_budget
    
    This gives a universal yardstick:
    +1R = you made +2% portfolio
    -1R = you lost -2% portfolio
    
    Args:
        portfolio_pnl: Portfolio PnL as fraction
        risk_budget: Risk budget per trade (default 2%)
        
    Returns:
        R-multiple (positive = profit, negative = loss)
    """
    if risk_budget <= 0:
        return 0.0
    return portfolio_pnl / risk_budget


# =============================================================================
# Trade Risk Record
# =============================================================================

@dataclass
class TradeRisk:
    """
    Complete risk record for a single trade.
    
    This captures both planned risk and realized reality.
    """
    # Entry mode
    entry_mode: str  # 'immediate', 'next_open', etc.
    
    # Prices
    entry_price: float
    stop_price: float
    exit_price: float
    
    # Stop distance
    stop_distance: float  # d = (entry - stop) / entry
    stop_distance_eff: float  # d_eff = d + fees + slippage
    
    # Position sizing
    position_pct: float  # 0.02 / d_eff, capped
    position_pct_uncapped: float  # 0.02 / d_eff, before cap
    was_capped: bool  # True if position was capped
    
    # Planned risk
    planned_risk_pct: float  # Should be ~2% unless capped
    
    # Token return
    token_return: float  # (exit / entry) - 1
    
    # Portfolio PnL
    portfolio_pnl_pct: float  # position_pct * token_return
    
    # R-multiple
    r_multiple: float  # portfolio_pnl_pct / 0.02
    
    # Realized vs planned (for gap/slippage analysis)
    realized_loss_pct: Optional[float] = None  # Actual loss if stop hit + gap
    gap_slippage_pct: Optional[float] = None  # Extra loss beyond planned
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "entry_mode": self.entry_mode,
            "entry_price": self.entry_price,
            "stop_price": self.stop_price,
            "exit_price": self.exit_price,
            "stop_distance": self.stop_distance,
            "stop_distance_eff": self.stop_distance_eff,
            "position_pct": self.position_pct,
            "position_pct_uncapped": self.position_pct_uncapped,
            "was_capped": self.was_capped,
            "planned_risk_pct": self.planned_risk_pct,
            "token_return": self.token_return,
            "portfolio_pnl_pct": self.portfolio_pnl_pct,
            "r_multiple": self.r_multiple,
            "realized_loss_pct": self.realized_loss_pct,
            "gap_slippage_pct": self.gap_slippage_pct,
        }


def compute_trade_risk(
    entry_price: float,
    stop_mult: float,
    exit_price: float,
    entry_mode: str = "immediate",
    risk_budget: float = DEFAULT_RISK_BUDGET,
    max_position_pct: float = DEFAULT_MAX_POSITION_PCT,
    min_stop_distance: float = DEFAULT_MIN_STOP_DISTANCE,
    fee_entry: float = DEFAULT_FEE_ENTRY,
    fee_exit: float = DEFAULT_FEE_EXIT,
    slippage_allowance: float = DEFAULT_SLIPPAGE_ALLOWANCE,
    actual_exit_low: Optional[float] = None,  # For gap/slippage tracking
) -> TradeRisk:
    """
    Compute complete risk record for a trade.
    
    Args:
        entry_price: Entry price
        stop_mult: Stop multiplier (e.g., 0.5 for 50% of entry)
        exit_price: Exit price
        entry_mode: Entry mode string
        risk_budget: Risk per trade (default 2%)
        max_position_pct: Maximum position size
        min_stop_distance: Minimum stop distance
        fee_entry: Entry fee fraction
        fee_exit: Exit fee fraction
        slippage_allowance: Slippage buffer
        actual_exit_low: Actual low at exit (for gap analysis)
        
    Returns:
        Complete TradeRisk record
    """
    # Stop price
    stop_price = entry_price * stop_mult
    
    # Stop distance
    stop_distance = compute_stop_distance_from_mult(stop_mult)
    stop_distance_eff = compute_effective_stop_distance(
        stop_distance, fee_entry, fee_exit, slippage_allowance
    )
    
    # Position sizing (uncapped first)
    effective_d = max(stop_distance_eff, min_stop_distance)
    position_pct_uncapped = risk_budget / effective_d
    position_pct = min(position_pct_uncapped, max_position_pct)
    was_capped = position_pct_uncapped > max_position_pct
    
    # Planned risk (what we expect to lose if stopped out)
    # If capped, planned risk is less than budget
    planned_risk_pct = position_pct * stop_distance_eff
    
    # Token return
    token_return = (exit_price / entry_price) - 1.0 if entry_price > 0 else 0.0
    
    # Portfolio PnL
    portfolio_pnl_pct = compute_portfolio_pnl(token_return, position_pct)
    
    # R-multiple
    r_multiple = compute_r_multiple(portfolio_pnl_pct, risk_budget)
    
    # Realized loss analysis (if we have actual exit low)
    realized_loss_pct = None
    gap_slippage_pct = None
    if actual_exit_low is not None and exit_price <= stop_price:
        # We got stopped out - what was the actual loss?
        actual_token_loss = (actual_exit_low / entry_price) - 1.0
        realized_loss_pct = position_pct * abs(actual_token_loss)
        gap_slippage_pct = realized_loss_pct - planned_risk_pct if realized_loss_pct > planned_risk_pct else 0.0
    
    return TradeRisk(
        entry_mode=entry_mode,
        entry_price=entry_price,
        stop_price=stop_price,
        exit_price=exit_price,
        stop_distance=stop_distance,
        stop_distance_eff=stop_distance_eff,
        position_pct=position_pct,
        position_pct_uncapped=position_pct_uncapped,
        was_capped=was_capped,
        planned_risk_pct=planned_risk_pct,
        token_return=token_return,
        portfolio_pnl_pct=portfolio_pnl_pct,
        r_multiple=r_multiple,
        realized_loss_pct=realized_loss_pct,
        gap_slippage_pct=gap_slippage_pct,
    )


# =============================================================================
# Batch Processing
# =============================================================================

def enrich_results_with_risk(
    results: list,
    stop_mult: float,
    entry_mode: str = "immediate",
    risk_budget: float = DEFAULT_RISK_BUDGET,
    max_position_pct: float = DEFAULT_MAX_POSITION_PCT,
    min_stop_distance: float = DEFAULT_MIN_STOP_DISTANCE,
    fee_bps: float = 30.0,
    slippage_bps: float = 50.0,
) -> list:
    """
    Enrich backtest results with risk sizing fields.
    
    Args:
        results: List of trade result dicts
        stop_mult: Stop multiplier used in backtest
        entry_mode: Entry mode string
        risk_budget: Risk per trade (default 2%)
        max_position_pct: Maximum position size
        min_stop_distance: Minimum stop distance
        fee_bps: Entry/exit fees in basis points
        slippage_bps: Slippage allowance in basis points
        
    Returns:
        Results with added risk fields
    """
    fee_frac = fee_bps / 10000.0
    slip_frac = slippage_bps / 10000.0
    
    enriched = []
    for r in results:
        # Get prices
        entry_price = r.get("entry_price") or r.get("first_price") or 1.0
        
        # Get token return from result
        token_return = r.get("tp_sl_ret") or r.get("net_return") or 0.0
        
        # Compute exit price from token return
        exit_price = entry_price * (1 + token_return)
        
        # Compute risk record
        risk = compute_trade_risk(
            entry_price=entry_price,
            stop_mult=stop_mult,
            exit_price=exit_price,
            entry_mode=entry_mode,
            risk_budget=risk_budget,
            max_position_pct=max_position_pct,
            min_stop_distance=min_stop_distance,
            fee_entry=fee_frac,
            fee_exit=fee_frac,
            slippage_allowance=slip_frac,
        )
        
        # Add risk fields to result
        enriched_r = dict(r)
        enriched_r.update({
            # Position sizing
            "stop_distance": risk.stop_distance,
            "stop_distance_eff": risk.stop_distance_eff,
            "position_pct": risk.position_pct,
            "was_capped": risk.was_capped,
            "planned_risk_pct": risk.planned_risk_pct,
            
            # Token vs portfolio returns
            "token_return": risk.token_return,
            "portfolio_pnl_pct": risk.portfolio_pnl_pct,
            "r_multiple": risk.r_multiple,
        })
        enriched.append(enriched_r)
    
    return enriched


def summarize_risk_adjusted(results: list, risk_budget: float = DEFAULT_RISK_BUDGET) -> Dict[str, Any]:
    """
    Summarize risk-adjusted results.
    
    Args:
        results: Enriched results with risk fields
        risk_budget: Risk budget per trade
        
    Returns:
        Summary dict with risk-adjusted metrics
    """
    if not results:
        return {
            "n_trades": 0,
            "total_r": 0.0,
            "avg_r": 0.0,
            "win_rate": 0.0,
            "avg_winner_r": 0.0,
            "avg_loser_r": 0.0,
            "total_portfolio_pnl_pct": 0.0,
            "avg_portfolio_pnl_pct": 0.0,
            "max_portfolio_gain_pct": 0.0,
            "max_portfolio_loss_pct": 0.0,
        }
    
    # Extract R-multiples
    r_multiples = [r.get("r_multiple", 0.0) for r in results]
    portfolio_pnls = [r.get("portfolio_pnl_pct", 0.0) for r in results]
    
    # Win/loss classification
    winners = [r for r in r_multiples if r > 0]
    losers = [r for r in r_multiples if r <= 0]
    
    # Stats
    n_trades = len(results)
    total_r = sum(r_multiples)
    avg_r = total_r / n_trades
    win_rate = len(winners) / n_trades if n_trades > 0 else 0.0
    avg_winner_r = sum(winners) / len(winners) if winners else 0.0
    avg_loser_r = sum(losers) / len(losers) if losers else 0.0
    
    total_portfolio_pnl = sum(portfolio_pnls)
    avg_portfolio_pnl = total_portfolio_pnl / n_trades
    max_gain = max(portfolio_pnls) if portfolio_pnls else 0.0
    max_loss = min(portfolio_pnls) if portfolio_pnls else 0.0
    
    # Profit factor in R terms
    sum_winners_r = sum(winners) if winners else 0.0
    sum_losers_r = abs(sum(losers)) if losers else 0.0
    profit_factor_r = sum_winners_r / sum_losers_r if sum_losers_r > 0.0001 else 999.99
    
    # Expectancy in R
    expectancy_r = avg_r
    
    return {
        "n_trades": n_trades,
        "total_r": total_r,
        "avg_r": avg_r,
        "win_rate": win_rate,
        "avg_winner_r": avg_winner_r,
        "avg_loser_r": avg_loser_r,
        "profit_factor_r": profit_factor_r,
        "expectancy_r": expectancy_r,
        "total_portfolio_pnl_pct": total_portfolio_pnl * 100,
        "avg_portfolio_pnl_pct": avg_portfolio_pnl * 100,
        "max_portfolio_gain_pct": max_gain * 100,
        "max_portfolio_loss_pct": max_loss * 100,
    }


# =============================================================================
# Examples / Documentation
# =============================================================================

def print_examples():
    """Print examples demonstrating the formulas."""
    print("=" * 70)
    print("RISK SIZING EXAMPLES")
    print("=" * 70)
    print()
    
    # Example A: 555% token win with 10% stop
    print("Example A: Token does +555%, stop is 10%")
    risk_a = compute_trade_risk(
        entry_price=1.0,
        stop_mult=0.90,  # 10% stop
        exit_price=6.55,  # +555%
    )
    print(f"  Stop distance: {risk_a.stop_distance:.1%}")
    print(f"  Position size: {risk_a.position_pct:.1%} of portfolio")
    print(f"  Token return: {risk_a.token_return:.1%}")
    print(f"  Portfolio PnL: {risk_a.portfolio_pnl_pct:.1%}")
    print(f"  R-multiple: {risk_a.r_multiple:.1f}R")
    print()
    
    # Example B: Same token return, 50% stop
    print("Example B: Same +555% token return, stop is 50%")
    risk_b = compute_trade_risk(
        entry_price=1.0,
        stop_mult=0.50,  # 50% stop
        exit_price=6.55,  # +555%
    )
    print(f"  Stop distance: {risk_b.stop_distance:.1%}")
    print(f"  Position size: {risk_b.position_pct:.1%} of portfolio")
    print(f"  Token return: {risk_b.token_return:.1%}")
    print(f"  Portfolio PnL: {risk_b.portfolio_pnl_pct:.1%}")
    print(f"  R-multiple: {risk_b.r_multiple:.1f}R")
    print()
    
    # Example C: Stop hit (loss)
    print("Example C: Stopped out at 50% stop")
    risk_c = compute_trade_risk(
        entry_price=1.0,
        stop_mult=0.50,
        exit_price=0.50,  # Exit at stop
    )
    print(f"  Stop distance: {risk_c.stop_distance:.1%}")
    print(f"  Position size: {risk_c.position_pct:.1%} of portfolio")
    print(f"  Token return: {risk_c.token_return:.1%}")
    print(f"  Portfolio PnL: {risk_c.portfolio_pnl_pct:.1%}")
    print(f"  R-multiple: {risk_c.r_multiple:.1f}R")
    print(f"  Planned risk: {risk_c.planned_risk_pct:.1%}")
    print()
    
    # Example D: Tight stop triggers capping
    print("Example D: Tight 1% stop (triggers position cap)")
    risk_d = compute_trade_risk(
        entry_price=1.0,
        stop_mult=0.99,  # 1% stop
        exit_price=1.10,  # 10% gain
        max_position_pct=0.50,  # 50% max
    )
    print(f"  Stop distance: {risk_d.stop_distance:.1%}")
    print(f"  Uncapped position: {risk_d.position_pct_uncapped:.1%}")
    print(f"  Actual position: {risk_d.position_pct:.1%} (capped: {risk_d.was_capped})")
    print(f"  Token return: {risk_d.token_return:.1%}")
    print(f"  Portfolio PnL: {risk_d.portfolio_pnl_pct:.1%}")
    print(f"  R-multiple: {risk_d.r_multiple:.1f}R")
    print()


if __name__ == "__main__":
    print_examples()

