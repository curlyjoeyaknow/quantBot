"""
Trailing Stop Logic for Python Simulation

Migrated from TypeScript trailing stop logic.
"""

from typing import List, Optional, Dict, Any
from tools.backtest.lib.simulation.contracts import (
    Candle,
    StopLossConfig,
)


def init_trailing_stop_state(
    entry_price: float,
    stop_config: StopLossConfig,
) -> Dict[str, Any]:
    """
    Initialize rolling trailing stop state.
    
    Returns:
        {
            'entry_price': float,
            'current_stop': float,
            'peak_price': float,
            'window_prices': List[float],
        }
    """
    initial_stop = entry_price * (1.0 + stop_config.initial)
    
    return {
        'entry_price': entry_price,
        'current_stop': initial_stop,
        'peak_price': entry_price,
        'window_prices': [],
    }


def update_rolling_trailing_stop(
    state: Dict[str, Any],
    candle: Candle,
    candle_index: int,
    trailing_percent: float,
    window_size: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Update rolling trailing stop state.
    
    If window_size is provided, uses rolling window of prices.
    Otherwise, uses peak price from entry.
    """
    # Update peak price
    if candle.high > state['peak_price']:
        state['peak_price'] = candle.high
    
    # Update window prices if window_size is provided
    if window_size is not None:
        state['window_prices'].append(candle.high)
        if len(state['window_prices']) > window_size:
            state['window_prices'].pop(0)
        
        # Use peak from window
        window_peak = max(state['window_prices'])
        state['current_stop'] = window_peak * (1.0 - trailing_percent)
    else:
        # Use overall peak
        state['current_stop'] = state['peak_price'] * (1.0 - trailing_percent)
    
    # Ensure stop doesn't go below entry price (if trailing moved to entry)
    if state['current_stop'] < state['entry_price']:
        state['current_stop'] = state['entry_price']
    
    return state

