"""
Entry strategy library - modular entry logic for backtests.

Provides reusable entry strategies:
1. Immediate entry (at alert price)
2. Delayed entry (wait for dip)
3. Limit order entry (enter at specific price)
4. Time-delayed entry (wait X minutes/hours)

All strategies return EntryResult with:
- entry_occurred: bool
- entry_price: float
- entry_ts_ms: int
- time_to_entry_hrs: float
- candles_after_entry: List[Dict]
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from datetime import datetime as dt_class


@dataclass
class EntryResult:
    """Result of entry strategy execution."""
    entry_occurred: bool  # Did entry happen?
    entry_price: float  # Actual entry price
    entry_ts_ms: int  # Entry timestamp (ms)
    time_to_entry_hrs: float  # Hours from alert to entry
    candles_after_entry: List[Dict]  # Remaining candles after entry
    missed_reason: Optional[str] = None  # Why entry didn't occur (if applicable)


def immediate_entry(
    candles: List[Dict],
    alert_price: float,
    alert_ts_ms: int,
) -> EntryResult:
    """
    Immediate entry at alert price.
    
    Args:
        candles: All candles after alert
        alert_price: Price at alert
        alert_ts_ms: Alert timestamp (ms)
    
    Returns:
        EntryResult with entry at alert price
    """
    return EntryResult(
        entry_occurred=True,
        entry_price=alert_price,
        entry_ts_ms=alert_ts_ms,
        time_to_entry_hrs=0.0,
        candles_after_entry=candles,
    )


def delayed_entry_dip(
    candles: List[Dict],
    alert_price: float,
    alert_ts_ms: int,
    dip_pct: float,
    max_wait_hrs: Optional[float] = None,
) -> EntryResult:
    """
    Wait for price to dip X% below alert before entering.
    
    Args:
        candles: All candles after alert
        alert_price: Price at alert
        alert_ts_ms: Alert timestamp (ms)
        dip_pct: Target dip percentage (negative, e.g., -0.10 for -10%)
        max_wait_hrs: Maximum hours to wait (None = wait forever)
    
    Returns:
        EntryResult with entry at dip price (or missed if dip never occurred)
    """
    if not candles:
        return EntryResult(
            entry_occurred=False,
            entry_price=alert_price,
            entry_ts_ms=alert_ts_ms,
            time_to_entry_hrs=0.0,
            candles_after_entry=[],
            missed_reason="no_candles",
        )
    
    target_entry_price = alert_price * (1.0 + dip_pct)  # dip_pct is negative
    
    for i, candle in enumerate(candles):
        ts_ms = _parse_timestamp_ms(candle['timestamp'])
        time_elapsed_hrs = (ts_ms - alert_ts_ms) / (1000 * 3600)
        
        # Check max wait time
        if max_wait_hrs and time_elapsed_hrs > max_wait_hrs:
            return EntryResult(
                entry_occurred=False,
                entry_price=alert_price,
                entry_ts_ms=alert_ts_ms,
                time_to_entry_hrs=time_elapsed_hrs,
                candles_after_entry=[],
                missed_reason=f"timeout_{max_wait_hrs}h",
            )
        
        low = float(candle['low'])
        
        # Check if dip occurred
        if low <= target_entry_price:
            return EntryResult(
                entry_occurred=True,
                entry_price=target_entry_price,
                entry_ts_ms=ts_ms,
                time_to_entry_hrs=time_elapsed_hrs,
                candles_after_entry=candles[i:],
            )
    
    # Dip never occurred within observation window
    return EntryResult(
        entry_occurred=False,
        entry_price=alert_price,
        entry_ts_ms=alert_ts_ms,
        time_to_entry_hrs=(
            (_parse_timestamp_ms(candles[-1]['timestamp']) - alert_ts_ms) / (1000 * 3600)
            if candles else 0.0
        ),
        candles_after_entry=[],
        missed_reason="dip_never_occurred",
    )


def delayed_entry_time(
    candles: List[Dict],
    alert_price: float,
    alert_ts_ms: int,
    wait_hrs: float,
) -> EntryResult:
    """
    Wait X hours after alert, then enter at market price.
    
    Args:
        candles: All candles after alert
        alert_price: Price at alert
        alert_ts_ms: Alert timestamp (ms)
        wait_hrs: Hours to wait before entering
    
    Returns:
        EntryResult with entry after time delay
    """
    if not candles:
        return EntryResult(
            entry_occurred=False,
            entry_price=alert_price,
            entry_ts_ms=alert_ts_ms,
            time_to_entry_hrs=0.0,
            candles_after_entry=[],
            missed_reason="no_candles",
        )
    
    target_entry_ts_ms = alert_ts_ms + int(wait_hrs * 3600 * 1000)
    
    for i, candle in enumerate(candles):
        ts_ms = _parse_timestamp_ms(candle['timestamp'])
        
        if ts_ms >= target_entry_ts_ms:
            # Enter at this candle's open/close (use close for simplicity)
            entry_price = float(candle['close'])
            time_elapsed_hrs = (ts_ms - alert_ts_ms) / (1000 * 3600)
            
            return EntryResult(
                entry_occurred=True,
                entry_price=entry_price,
                entry_ts_ms=ts_ms,
                time_to_entry_hrs=time_elapsed_hrs,
                candles_after_entry=candles[i:],
            )
    
    # Time target not reached within observation window
    return EntryResult(
        entry_occurred=False,
        entry_price=alert_price,
        entry_ts_ms=alert_ts_ms,
        time_to_entry_hrs=(
            (_parse_timestamp_ms(candles[-1]['timestamp']) - alert_ts_ms) / (1000 * 3600)
            if candles else 0.0
        ),
        candles_after_entry=[],
        missed_reason="observation_window_ended",
    )


def limit_order_entry(
    candles: List[Dict],
    alert_price: float,
    alert_ts_ms: int,
    limit_price: float,
    max_wait_hrs: Optional[float] = None,
) -> EntryResult:
    """
    Place limit order at specific price.
    
    Args:
        candles: All candles after alert
        alert_price: Price at alert
        alert_ts_ms: Alert timestamp (ms)
        limit_price: Target entry price
        max_wait_hrs: Maximum hours to wait (None = wait forever)
    
    Returns:
        EntryResult with entry at limit price (or missed if never filled)
    """
    if not candles:
        return EntryResult(
            entry_occurred=False,
            entry_price=alert_price,
            entry_ts_ms=alert_ts_ms,
            time_to_entry_hrs=0.0,
            candles_after_entry=[],
            missed_reason="no_candles",
        )
    
    for i, candle in enumerate(candles):
        ts_ms = _parse_timestamp_ms(candle['timestamp'])
        time_elapsed_hrs = (ts_ms - alert_ts_ms) / (1000 * 3600)
        
        # Check max wait time
        if max_wait_hrs and time_elapsed_hrs > max_wait_hrs:
            return EntryResult(
                entry_occurred=False,
                entry_price=alert_price,
                entry_ts_ms=alert_ts_ms,
                time_to_entry_hrs=time_elapsed_hrs,
                candles_after_entry=[],
                missed_reason=f"timeout_{max_wait_hrs}h",
            )
        
        low = float(candle['low'])
        high = float(candle['high'])
        
        # Check if limit order would be filled
        if low <= limit_price <= high:
            return EntryResult(
                entry_occurred=True,
                entry_price=limit_price,
                entry_ts_ms=ts_ms,
                time_to_entry_hrs=time_elapsed_hrs,
                candles_after_entry=candles[i:],
            )
    
    # Limit order never filled
    return EntryResult(
        entry_occurred=False,
        entry_price=alert_price,
        entry_ts_ms=alert_ts_ms,
        time_to_entry_hrs=(
            (_parse_timestamp_ms(candles[-1]['timestamp']) - alert_ts_ms) / (1000 * 3600)
            if candles else 0.0
        ),
        candles_after_entry=[],
        missed_reason="limit_never_filled",
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


# Entry strategy registry for easy lookup
ENTRY_STRATEGIES = {
    'immediate': immediate_entry,
    'delayed_dip': delayed_entry_dip,
    'delayed_time': delayed_entry_time,
    'limit_order': limit_order_entry,
}

