"""
Entry Logic for Python Simulation

Migrated from TypeScript entry detection logic.
"""

from typing import List, Optional, Union, Dict, Any
from tools.backtest.lib.simulation.contracts import (
    Candle,
    EntryConfig,
    SimInput,
)


def detect_entry(
    candles: List[Candle],
    start_index: int,
    config: EntryConfig,
    max_wait_timestamp: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Detect entry point based on configuration.
    
    Returns:
        {
            'should_enter': bool,
            'price': float,
            'candle_index': int,
            'timestamp': int,
            'type': str,
            'description': str,
        }
    """
    if not candles or start_index >= len(candles):
        return {
            'should_enter': False,
            'price': 0.0,
            'candle_index': start_index,
            'timestamp': 0,
            'type': 'immediate',
            'description': 'No candles available',
        }
    
    start_candle = candles[start_index]
    start_price = start_candle.open
    
    # If no entry conditions, enter immediately
    if (config.initialEntry == 'none' and 
        config.trailingEntry == 'none'):
        return {
            'should_enter': True,
            'price': start_price,
            'candle_index': start_index,
            'timestamp': start_candle.timestamp,
            'type': 'immediate',
            'description': f'Immediate entry at ${start_price:.8f}',
        }
    
    # Calculate max wait timestamp
    if max_wait_timestamp is None:
        max_wait_time_minutes = config.maxWaitTime if config.maxWaitTime else 60
        max_wait_timestamp = start_candle.timestamp + (max_wait_time_minutes * 60)
    
    # Check for initial drop entry
    if config.initialEntry != 'none':
        result = detect_initial_drop_entry(
            candles,
            start_index,
            config.initialEntry,
            max_wait_timestamp,
        )
        if result['should_enter']:
            return result
    
    # Check for trailing entry
    if config.trailingEntry != 'none':
        result = detect_trailing_entry(
            candles,
            start_index,
            config.trailingEntry,
            max_wait_timestamp,
        )
        if result['should_enter']:
            return result
    
    # No entry triggered
    return {
        'should_enter': False,
        'price': start_price,
        'candle_index': start_index,
        'timestamp': start_candle.timestamp,
        'type': 'immediate',
        'description': 'No entry triggered within wait period',
    }


def detect_initial_drop_entry(
    candles: List[Candle],
    start_index: int,
    drop_percent: Union[float, str],
    max_wait_timestamp: int,
) -> Dict[str, Any]:
    """
    Detect initial drop entry (wait for price to drop X%).
    
    drop_percent is negative (e.g., -0.3 for 30% drop).
    """
    if drop_percent == 'none':
        return {'should_enter': False}
    
    drop_pct = float(drop_percent)
    start_candle = candles[start_index]
    start_price = start_candle.open
    trigger_price = start_price * (1.0 + drop_pct)  # drop_pct is negative
    
    for i in range(start_index, len(candles)):
        candle = candles[i]
        
        if candle.timestamp > max_wait_timestamp:
            break
        
        if candle.low <= trigger_price:
            return {
                'should_enter': True,
                'price': trigger_price,
                'candle_index': i,
                'timestamp': candle.timestamp,
                'type': 'initial_drop',
                'description': f'Initial drop entry at ${trigger_price:.8f} ({abs(drop_pct) * 100:.0f}% drop)',
            }
    
    return {'should_enter': False}


def detect_trailing_entry(
    candles: List[Candle],
    start_index: int,
    rebound_percent: Union[float, str],
    max_wait_timestamp: int,
) -> Dict[str, Any]:
    """
    Detect trailing entry (wait for rebound from low).
    
    rebound_percent is positive (e.g., 0.1 for 10% rebound).
    """
    if rebound_percent == 'none':
        return {'should_enter': False}
    
    rebound_pct = float(rebound_percent)
    start_candle = candles[start_index]
    start_price = start_candle.open
    
    lowest_price = start_price
    lowest_index = start_index
    
    # Find lowest price within wait period
    for i in range(start_index, len(candles)):
        candle = candles[i]
        
        if candle.timestamp > max_wait_timestamp:
            break
        
        if candle.low < lowest_price:
            lowest_price = candle.low
            lowest_index = i
    
    # Check for rebound from lowest price
    rebound_trigger = lowest_price * (1.0 + rebound_pct)
    
    for i in range(lowest_index, len(candles)):
        candle = candles[i]
        
        if candle.timestamp > max_wait_timestamp:
            break
        
        if candle.high >= rebound_trigger:
            return {
                'should_enter': True,
                'price': rebound_trigger,
                'candle_index': i,
                'timestamp': candle.timestamp,
                'type': 'trailing',
                'description': f'Trailing entry at ${rebound_trigger:.8f} ({rebound_pct * 100:.0f}% rebound from low)',
            }
    
    # Fallback: enter at end of wait period if no rebound
    fallback_candle = None
    for i in range(start_index, len(candles)):
        if candles[i].timestamp <= max_wait_timestamp:
            fallback_candle = candles[i]
        else:
            break
    
    if fallback_candle:
        return {
            'should_enter': True,
            'price': fallback_candle.close,
            'candle_index': len(candles) - 1,
            'timestamp': fallback_candle.timestamp,
            'type': 'trailing_fallback',
            'description': f'Trailing entry fallback at ${fallback_candle.close:.8f}',
        }
    
    return {'should_enter': False}

