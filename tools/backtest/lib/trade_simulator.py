"""
Trade simulator - combines entry and stop strategies.

Modular trade simulation that:
1. Executes entry strategy
2. Executes stop strategy on remaining candles
3. Returns comprehensive trade result

Usage:
    from lib.trade_simulator import simulate_trade
    from lib.entry_strategies import delayed_entry_dip
    from lib.stop_strategies import trailing_stop, PhaseConfig
    
    result = simulate_trade(
        candles=candles,
        alert_price=1.0,
        alert_ts_ms=alert_ts,
        entry_strategy=delayed_entry_dip,
        entry_params={'dip_pct': -0.10},
        stop_strategy=trailing_stop,
        stop_params={
            'phases': [
                PhaseConfig(stop_pct=0.15, target_mult=2.0),
                PhaseConfig(stop_pct=0.50),
            ]
        },
    )
"""

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from entry_strategies import EntryResult, immediate_entry
from stop_strategies import ExitResult, PhaseConfig, trailing_stop


@dataclass
class TradeResult:
    """Complete trade result combining entry and exit."""
    # Entry details
    entry_occurred: bool
    entry_price: float
    entry_ts_ms: int
    time_to_entry_hrs: float
    missed_reason: Optional[str]
    
    # Exit details (only if entry occurred)
    exit_price: Optional[float]
    exit_ts_ms: Optional[int]
    exit_reason: Optional[str]
    
    # Performance metrics (only if entry occurred)
    entry_mult: float  # Always 1.0
    peak_mult: Optional[float]
    exit_mult: Optional[float]
    exit_mult_from_alert: Optional[float]
    giveback_from_peak_pct: Optional[float]
    
    # Milestones (only if entry occurred)
    hit_2x: Optional[bool]
    hit_3x: Optional[bool]
    hit_4x: Optional[bool]
    hit_5x: Optional[bool]
    hit_10x: Optional[bool]
    ath_multiple: Optional[float]
    
    # Reference prices
    alert_price: float
    reference_price: float  # Price used for stop calculations


def simulate_trade(
    candles: List[Dict],
    alert_price: float,
    alert_ts_ms: int,
    entry_strategy: Callable = immediate_entry,
    entry_params: Optional[Dict[str, Any]] = None,
    stop_strategy: Callable = trailing_stop,
    stop_params: Optional[Dict[str, Any]] = None,
    stop_reference: str = 'alert',  # 'alert' or 'entry'
) -> TradeResult:
    """
    Simulate a complete trade with entry and stop strategies.
    
    Args:
        candles: All candles after alert
        alert_price: Price at alert
        alert_ts_ms: Alert timestamp (ms)
        entry_strategy: Entry strategy function
        entry_params: Parameters for entry strategy
        stop_strategy: Stop strategy function
        stop_params: Parameters for stop strategy
        stop_reference: Calculate stops from 'alert' or 'entry' price
    
    Returns:
        TradeResult with complete trade details
    """
    entry_params = entry_params or {}
    stop_params = stop_params or {}
    
    # Execute entry strategy
    entry_result: EntryResult = entry_strategy(
        candles=candles,
        alert_price=alert_price,
        alert_ts_ms=alert_ts_ms,
        **entry_params
    )
    
    # If entry didn't occur, return early
    if not entry_result.entry_occurred:
        return TradeResult(
            entry_occurred=False,
            entry_price=alert_price,
            entry_ts_ms=alert_ts_ms,
            time_to_entry_hrs=entry_result.time_to_entry_hrs,
            missed_reason=entry_result.missed_reason,
            exit_price=None,
            exit_ts_ms=None,
            exit_reason=None,
            entry_mult=1.0,
            peak_mult=None,
            exit_mult=None,
            exit_mult_from_alert=None,
            giveback_from_peak_pct=None,
            hit_2x=None,
            hit_3x=None,
            hit_4x=None,
            hit_5x=None,
            hit_10x=None,
            ath_multiple=None,
            alert_price=alert_price,
            reference_price=alert_price,
        )
    
    # Determine reference price for stops
    reference_price = alert_price if stop_reference == 'alert' else entry_result.entry_price
    
    # Execute stop strategy on remaining candles
    # Check if stop strategy needs reference_price (static_stop does, trailing_stop doesn't)
    import inspect
    sig = inspect.signature(stop_strategy)
    if 'reference_price' in sig.parameters:
        exit_result: ExitResult = stop_strategy(
            candles=entry_result.candles_after_entry,
            entry_price=entry_result.entry_price,
            entry_ts_ms=entry_result.entry_ts_ms,
            reference_price=reference_price,
            **stop_params
        )
    else:
        exit_result: ExitResult = stop_strategy(
            candles=entry_result.candles_after_entry,
            entry_price=entry_result.entry_price,
            entry_ts_ms=entry_result.entry_ts_ms,
            **stop_params
        )
    
    # Calculate performance metrics
    exit_mult = exit_result.exit_price / entry_result.entry_price
    exit_mult_from_alert = exit_result.exit_price / alert_price
    
    giveback_from_peak_pct = None
    if exit_result.peak_mult > 1.0:
        peak_price = entry_result.entry_price * exit_result.peak_mult
        giveback_from_peak_pct = (peak_price - exit_result.exit_price) / peak_price * 100.0
    
    return TradeResult(
        entry_occurred=True,
        entry_price=entry_result.entry_price,
        entry_ts_ms=entry_result.entry_ts_ms,
        time_to_entry_hrs=entry_result.time_to_entry_hrs,
        missed_reason=None,
        exit_price=exit_result.exit_price,
        exit_ts_ms=exit_result.exit_ts_ms,
        exit_reason=exit_result.exit_reason,
        entry_mult=1.0,
        peak_mult=exit_result.peak_mult,
        exit_mult=exit_mult,
        exit_mult_from_alert=exit_mult_from_alert,
        giveback_from_peak_pct=giveback_from_peak_pct,
        hit_2x=exit_result.hit_2x,
        hit_3x=exit_result.hit_3x,
        hit_4x=exit_result.hit_4x,
        hit_5x=exit_result.hit_5x,
        hit_10x=exit_result.hit_10x,
        ath_multiple=exit_result.ath_multiple,
        alert_price=alert_price,
        reference_price=reference_price,
    )


def simulate_trade_grid(
    candles: List[Dict],
    alert_price: float,
    alert_ts_ms: int,
    entry_strategies: List[tuple],  # [(strategy_fn, params, name), ...]
    stop_strategies: List[tuple],  # [(strategy_fn, params, name), ...]
    stop_reference: str = 'alert',
) -> List[Dict[str, Any]]:
    """
    Simulate a grid of entry × stop strategy combinations.
    
    Args:
        candles: All candles after alert
        alert_price: Price at alert
        alert_ts_ms: Alert timestamp (ms)
        entry_strategies: List of (function, params, name) tuples
        stop_strategies: List of (function, params, name) tuples
        stop_reference: Calculate stops from 'alert' or 'entry' price
    
    Returns:
        List of dicts with strategy names and results
    """
    results = []
    
    for entry_fn, entry_params, entry_name in entry_strategies:
        for stop_fn, stop_params, stop_name in stop_strategies:
            result = simulate_trade(
                candles=candles,
                alert_price=alert_price,
                alert_ts_ms=alert_ts_ms,
                entry_strategy=entry_fn,
                entry_params=entry_params,
                stop_strategy=stop_fn,
                stop_params=stop_params,
                stop_reference=stop_reference,
            )
            
            results.append({
                'entry_strategy': entry_name,
                'stop_strategy': stop_name,
                'result': result,
            })
    
    return results

