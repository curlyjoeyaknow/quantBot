"""
Re-entry Logic for Python Simulation

Migrated from TypeScript re-entry detection logic.
"""

from typing import List, Optional, Dict, Any
from tools.backtest.lib.simulation.contracts import (
    Candle,
    ReEntryConfig,
)


def validate_reentry_sequence(
    candles: List[Candle],
    last_exit_index: int,
    reentry_index: int,
    stop_loss_price: float,
) -> bool:
    """
    Validate that stop loss was not hit between exit and re-entry attempt.
    
    Returns True if re-entry is valid (no stop loss hit between exit and re-entry).
    """
    if last_exit_index < 0 or reentry_index <= last_exit_index:
        return False
    
    # Check if stop loss was hit between exit and re-entry
    for i in range(last_exit_index + 1, reentry_index):
        if i < len(candles):
            candle = candles[i]
            if candle.low <= stop_loss_price:
                return False  # Stop loss was hit, reject re-entry
    
    return True  # No stop loss hit, re-entry is valid

