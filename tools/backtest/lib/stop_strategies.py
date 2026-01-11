"""
Stop strategy library - modular stop loss logic for backtests.

Provides reusable stop strategies:
1. Static stops (fixed % below reference price)
2. Trailing stops (follow peak)
3. Ladder stops (step up at intervals)
4. Time stops (exit after X hours)
5. Hybrid stops (combine multiple strategies)

All strategies return ExitResult with:
- exit_price: float
- exit_ts_ms: int
- exit_reason: str
- peak_mult: float
- hit_milestones: Dict[str, bool]
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from datetime import datetime as dt_class


@dataclass
class ExitResult:
    """Result of stop strategy execution."""
    exit_price: float  # Final exit price
    exit_ts_ms: int  # Exit timestamp (ms)
    exit_reason: str  # Why trade exited
    peak_mult: float  # Peak multiple from entry
    hit_2x: bool
    hit_3x: bool
    hit_4x: bool
    hit_5x: bool
    hit_10x: bool
    ath_multiple: float  # All-time high multiple


@dataclass
class PhaseConfig:
    """Configuration for a single phase."""
    stop_pct: float  # Stop percentage (e.g., 0.15 for 15%)
    target_mult: Optional[float] = None  # Target multiple to advance phase (e.g., 2.0 for 2x)


def static_stop(
    candles: List[Dict],
    entry_price: float,
    entry_ts_ms: int,
    reference_price: float,
    phases: List[PhaseConfig],
    max_duration_hrs: float = 48.0,
) -> ExitResult:
    """
    Static stop strategy - stops fixed at reference price × (1 - stop_pct).
    
    Phases advance when target multiples are hit, but stops remain anchored
    at the reference price (or phase entry price).
    
    Args:
        candles: Candles after entry
        entry_price: Actual entry price
        entry_ts_ms: Entry timestamp (ms)
        reference_price: Price to calculate stops from (alert or entry)
        phases: List of phase configurations
        max_duration_hrs: Maximum trade duration (default 48h)
    
    Returns:
        ExitResult with exit details
    """
    if not candles:
        return _no_data_exit(entry_price, entry_ts_ms)
    
    # Initialize phase tracking
    current_phase = 0
    phase_entry_prices = [reference_price]  # Track price at each phase entry
    
    # Calculate initial stop
    current_stop = reference_price * (1.0 - phases[0].stop_pct)
    
    # Track milestones
    hit_2x = False
    hit_3x = False
    hit_4x = False
    hit_5x = False
    hit_10x = False
    peak_price = entry_price
    ath_multiple = 1.0
    
    for candle in candles:
        ts_ms = _parse_timestamp_ms(candle['timestamp'])
        high = float(candle['high'])
        low = float(candle['low'])
        close = float(candle['close'])
        
        # Check max duration
        time_elapsed_hrs = (ts_ms - entry_ts_ms) / (1000 * 3600)
        if time_elapsed_hrs >= max_duration_hrs:
            return ExitResult(
                exit_price=close,
                exit_ts_ms=ts_ms,
                exit_reason="end_of_data",
                peak_mult=peak_price / entry_price,
                hit_2x=hit_2x,
                hit_3x=hit_3x,
                hit_4x=hit_4x,
                hit_5x=hit_5x,
                hit_10x=hit_10x,
                ath_multiple=ath_multiple,
            )
        
        # Update peak
        if high > peak_price:
            peak_price = high
            ath_multiple = peak_price / entry_price
        
        # Check milestones and phase advancement
        if not hit_2x and high >= entry_price * 2.0:
            hit_2x = True
            if current_phase == 0 and len(phases) > 1 and phases[0].target_mult == 2.0:
                current_phase = 1
                phase_entry_prices.append(entry_price * 2.0)
                current_stop = phase_entry_prices[-1] * (1.0 - phases[1].stop_pct)
        
        if not hit_3x and high >= entry_price * 3.0:
            hit_3x = True
        
        if not hit_4x and high >= entry_price * 4.0:
            hit_4x = True
        
        if not hit_5x and high >= entry_price * 5.0:
            hit_5x = True
        
        if not hit_10x and high >= entry_price * 10.0:
            hit_10x = True
        
        # Check stop
        if low <= current_stop:
            return ExitResult(
                exit_price=current_stop,
                exit_ts_ms=ts_ms,
                exit_reason=f"stopped_phase{current_phase + 1}",
                peak_mult=peak_price / entry_price,
                hit_2x=hit_2x,
                hit_3x=hit_3x,
                hit_4x=hit_4x,
                hit_5x=hit_5x,
                hit_10x=hit_10x,
                ath_multiple=ath_multiple,
            )
    
    # End of data
    last_close = float(candles[-1]['close'])
    last_ts = _parse_timestamp_ms(candles[-1]['timestamp'])
    
    return ExitResult(
        exit_price=last_close,
        exit_ts_ms=last_ts,
        exit_reason="end_of_data",
        peak_mult=peak_price / entry_price,
        hit_2x=hit_2x,
        hit_3x=hit_3x,
        hit_4x=hit_4x,
        hit_5x=hit_5x,
        hit_10x=hit_10x,
        ath_multiple=ath_multiple,
    )


def trailing_stop(
    candles: List[Dict],
    entry_price: float,
    entry_ts_ms: int,
    phases: List[PhaseConfig],
    max_duration_hrs: float = 48.0,
) -> ExitResult:
    """
    Trailing stop strategy - stop follows peak price.
    
    Args:
        candles: Candles after entry
        entry_price: Actual entry price
        entry_ts_ms: Entry timestamp (ms)
        phases: List of phase configurations
        max_duration_hrs: Maximum trade duration (default 48h)
    
    Returns:
        ExitResult with exit details
    """
    if not candles:
        return _no_data_exit(entry_price, entry_ts_ms)
    
    # Initialize
    current_phase = 0
    trailing_peak = entry_price
    trailing_stop = entry_price * (1.0 - phases[0].stop_pct)
    
    # Track milestones
    hit_2x = False
    hit_3x = False
    hit_4x = False
    hit_5x = False
    hit_10x = False
    peak_price = entry_price
    ath_multiple = 1.0
    
    for candle in candles:
        ts_ms = _parse_timestamp_ms(candle['timestamp'])
        high = float(candle['high'])
        low = float(candle['low'])
        close = float(candle['close'])
        
        # Check max duration
        time_elapsed_hrs = (ts_ms - entry_ts_ms) / (1000 * 3600)
        if time_elapsed_hrs >= max_duration_hrs:
            return ExitResult(
                exit_price=close,
                exit_ts_ms=ts_ms,
                exit_reason="end_of_data",
                peak_mult=peak_price / entry_price,
                hit_2x=hit_2x,
                hit_3x=hit_3x,
                hit_4x=hit_4x,
                hit_5x=hit_5x,
                hit_10x=hit_10x,
                ath_multiple=ath_multiple,
            )
        
        # Update peak
        if high > peak_price:
            peak_price = high
            ath_multiple = peak_price / entry_price
        
        # Check milestones and phase advancement
        if not hit_2x and high >= entry_price * 2.0:
            hit_2x = True
            if current_phase == 0 and len(phases) > 1 and phases[0].target_mult == 2.0:
                current_phase = 1
                trailing_peak = entry_price * 2.0
                trailing_stop = trailing_peak * (1.0 - phases[1].stop_pct)
        
        if not hit_3x and high >= entry_price * 3.0:
            hit_3x = True
        
        if not hit_4x and high >= entry_price * 4.0:
            hit_4x = True
        
        if not hit_5x and high >= entry_price * 5.0:
            hit_5x = True
        
        if not hit_10x and high >= entry_price * 10.0:
            hit_10x = True
        
        # Update trailing stop
        if high > trailing_peak:
            trailing_peak = high
            trailing_stop = trailing_peak * (1.0 - phases[current_phase].stop_pct)
        
        # Check stop
        if low <= trailing_stop:
            return ExitResult(
                exit_price=trailing_stop,
                exit_ts_ms=ts_ms,
                exit_reason=f"stopped_phase{current_phase + 1}",
                peak_mult=peak_price / entry_price,
                hit_2x=hit_2x,
                hit_3x=hit_3x,
                hit_4x=hit_4x,
                hit_5x=hit_5x,
                hit_10x=hit_10x,
                ath_multiple=ath_multiple,
            )
    
    # End of data
    last_close = float(candles[-1]['close'])
    last_ts = _parse_timestamp_ms(candles[-1]['timestamp'])
    
    return ExitResult(
        exit_price=last_close,
        exit_ts_ms=last_ts,
        exit_reason="end_of_data",
        peak_mult=peak_price / entry_price,
        hit_2x=hit_2x,
        hit_3x=hit_3x,
        hit_4x=hit_4x,
        hit_5x=hit_5x,
        hit_10x=hit_10x,
        ath_multiple=ath_multiple,
    )


def _no_data_exit(entry_price: float, entry_ts_ms: int) -> ExitResult:
    """Return exit result for no data case."""
    return ExitResult(
        exit_price=entry_price,
        exit_ts_ms=entry_ts_ms,
        exit_reason="no_data",
        peak_mult=1.0,
        hit_2x=False,
        hit_3x=False,
        hit_4x=False,
        hit_5x=False,
        hit_10x=False,
        ath_multiple=1.0,
    )


def _parse_timestamp_ms(ts_val) -> int:
    """Parse timestamp to milliseconds."""
    if isinstance(ts_val, dt_class):
        return int(ts_val.timestamp() * 1000)
    elif isinstance(ts_val, str):
        ts = dt_class.fromisoformat(ts_val.replace('Z', '+00:00'))
        return int(ts.timestamp() * 1000)
    elif isinstance(ts_val, (int, float)):
        ts_float = float(ts_val)
        if ts_float < 4102444800:  # Seconds
            return int(ts_float * 1000)
        else:  # Already milliseconds
            return int(ts_float)
    else:
        raise ValueError(f"Unknown timestamp type: {type(ts_val)}")


# Stop strategy registry
STOP_STRATEGIES = {
    'static': static_stop,
    'trailing': trailing_stop,
}

