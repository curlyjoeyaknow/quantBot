#!/usr/bin/env python3
"""
Delayed entry analysis - test waiting for dips after alert.

Tests what happens if we wait for price to drop X% below alert price before entering.

Entry strategies:
1. Immediate (0%) - Enter at alert price
2. Wait for dip: -5%, -10%, -15%, -20%, -25%, -30%, -40%, -50%

For each delayed entry:
- Track if the dip ever occurs
- Track time to dip
- Track exit multiple from delayed entry price
- Compare EV vs immediate entry

Stop calculation options:
1. From alert price (original) - Stops calculated from alert price
2. From entry price (adjusted) - Stops calculated from actual entry price
"""

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import json

import duckdb
import numpy as np
import pandas as pd
from tabulate import tabulate

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent / 'lib'))
from alerts import load_alerts_from_duckdb, Alert


@dataclass
class DelayedEntryResult:
    """Result of delayed entry simulation."""
    dip_pct: float  # Target dip percentage (e.g., -0.10 for -10%)
    dip_occurred: bool  # Did price drop to target?
    time_to_dip_hrs: Optional[float]  # Hours until dip (if occurred)
    entry_price: float  # Actual entry price
    exit_mult_from_entry: float  # Exit multiple from entry price
    exit_mult_from_alert: float  # Exit multiple from alert price
    hit_2x_from_entry: bool
    hit_3x_from_entry: bool
    peak_mult_from_entry: float
    missed_opportunity: bool  # True if dip never occurred (missed trade)


def simulate_delayed_entry(
    candles: List[Dict],
    alert_price: float,
    alert_ts_ms: int,
    dip_pct: float,
    stop_mode: str,
    phase1_stop_pct: float,
    phase2_stop_pct: float,
    stop_from_alert: bool = True,
) -> DelayedEntryResult:
    """
    Simulate waiting for a dip before entering.
    
    Args:
        candles: Candle data
        alert_price: Price at alert
        alert_ts_ms: Timestamp of alert
        dip_pct: Target dip (e.g., -0.10 for -10%)
        stop_mode: 'static', 'trailing', or 'ladder'
        phase1_stop_pct: Phase 1 stop percentage
        phase2_stop_pct: Phase 2 stop percentage
        stop_from_alert: If True, calculate stops from alert price. If False, from entry price.
    
    Returns:
        DelayedEntryResult with trade outcome
    """
    if not candles:
        return DelayedEntryResult(
            dip_pct=dip_pct,
            dip_occurred=False,
            time_to_dip_hrs=None,
            entry_price=alert_price,
            exit_mult_from_entry=1.0,
            exit_mult_from_alert=1.0,
            hit_2x_from_entry=False,
            hit_3x_from_entry=False,
            peak_mult_from_entry=1.0,
            missed_opportunity=True,
        )
    
    target_entry_price = alert_price * (1.0 + dip_pct)  # dip_pct is negative
    
    # Phase 1: Wait for dip
    dip_occurred = False
    entry_ts_ms = None
    actual_entry_price = None
    time_to_dip_hrs = None
    
    for i, candle in enumerate(candles):
        # Parse timestamp
        ts_val = candle['timestamp']
        from datetime import datetime as dt_class
        
        if isinstance(ts_val, dt_class):
            ts_ms = int(ts_val.timestamp() * 1000)
        elif isinstance(ts_val, str):
            ts = dt_class.fromisoformat(ts_val.replace('Z', '+00:00'))
            ts_ms = int(ts.timestamp() * 1000)
        elif isinstance(ts_val, (int, float)):
            ts_float = float(ts_val)
            if ts_float < 4102444800:
                ts_ms = int(ts_float * 1000)
            else:
                ts_ms = int(ts_float)
        else:
            continue
        
        low = float(candle['low'])
        close = float(candle['close'])
        
        # Check if dip occurred
        if low <= target_entry_price:
            dip_occurred = True
            entry_ts_ms = ts_ms
            actual_entry_price = target_entry_price  # Assume we enter at target
            time_to_dip_hrs = (ts_ms - alert_ts_ms) / (1000 * 3600)
            
            # Phase 2: Simulate trade from this entry
            remaining_candles = candles[i:]
            
            # Determine reference price for stops
            reference_price = alert_price if stop_from_alert else actual_entry_price
            
            # Simulate trade (simplified - just track outcome)
            exit_price, peak_price, hit_2x, hit_3x = simulate_trade_from_entry(
                remaining_candles,
                actual_entry_price,
                entry_ts_ms,
                reference_price,
                stop_mode,
                phase1_stop_pct,
                phase2_stop_pct,
            )
            
            return DelayedEntryResult(
                dip_pct=dip_pct,
                dip_occurred=True,
                time_to_dip_hrs=time_to_dip_hrs,
                entry_price=actual_entry_price,
                exit_mult_from_entry=exit_price / actual_entry_price,
                exit_mult_from_alert=exit_price / alert_price,
                hit_2x_from_entry=hit_2x,
                hit_3x_from_entry=hit_3x,
                peak_mult_from_entry=peak_price / actual_entry_price,
                missed_opportunity=False,
            )
    
    # Dip never occurred - missed trade
    return DelayedEntryResult(
        dip_pct=dip_pct,
        dip_occurred=False,
        time_to_dip_hrs=None,
        entry_price=alert_price,
        exit_mult_from_entry=1.0,
        exit_mult_from_alert=1.0,
        hit_2x_from_entry=False,
        hit_3x_from_entry=False,
        peak_mult_from_entry=1.0,
        missed_opportunity=True,
    )


def simulate_trade_from_entry(
    candles: List[Dict],
    entry_price: float,
    entry_ts_ms: int,
    reference_price: float,
    stop_mode: str,
    phase1_stop_pct: float,
    phase2_stop_pct: float,
) -> Tuple[float, float, bool, bool]:
    """
    Simplified trade simulation from entry point.
    
    Returns: (exit_price, peak_price, hit_2x, hit_3x)
    """
    if not candles:
        return (entry_price, entry_price, False, False)
    
    # Calculate targets from entry price
    target_2x = entry_price * 2.0
    target_3x = entry_price * 3.0
    
    # Calculate stops from reference price
    phase1_stop_price = reference_price * (1.0 - phase1_stop_pct)
    phase2_stop_price = None
    
    hit_2x = False
    hit_3x = False
    peak_price = entry_price
    current_phase = 1
    
    # For trailing stops
    trailing_peak = entry_price
    trailing_stop = phase1_stop_price
    
    for candle in candles:
        high = float(candle['high'])
        low = float(candle['low'])
        close = float(candle['close'])
        
        # Update peak
        if high > peak_price:
            peak_price = high
        
        # Check milestones
        if not hit_2x and high >= target_2x:
            hit_2x = True
            current_phase = 2
            if stop_mode == 'static':
                phase2_stop_price = reference_price * 2.0 * (1.0 - phase2_stop_pct)
            elif stop_mode == 'trailing':
                trailing_peak = target_2x
                trailing_stop = trailing_peak * (1.0 - phase2_stop_pct)
        
        if not hit_3x and high >= target_3x:
            hit_3x = True
        
        # Update trailing stop
        if stop_mode == 'trailing':
            if high > trailing_peak:
                trailing_peak = high
                if current_phase == 1:
                    trailing_stop = trailing_peak * (1.0 - phase1_stop_pct)
                else:
                    trailing_stop = trailing_peak * (1.0 - phase2_stop_pct)
        
        # Check stops
        if stop_mode == 'static':
            if current_phase == 1 and low <= phase1_stop_price:
                return (phase1_stop_price, peak_price, hit_2x, hit_3x)
            elif current_phase == 2 and phase2_stop_price and low <= phase2_stop_price:
                return (phase2_stop_price, peak_price, hit_2x, hit_3x)
        elif stop_mode == 'trailing':
            if low <= trailing_stop:
                return (trailing_stop, peak_price, hit_2x, hit_3x)
    
    # End of data
    last_close = float(candles[-1]['close'])
    return (last_close, peak_price, hit_2x, hit_3x)


def main():
    parser = argparse.ArgumentParser(description='Delayed entry analysis')
    parser.add_argument('parquet_file', help='Path to phased stop results parquet file')
    parser.add_argument('--stop-mode', choices=['static', 'trailing', 'ladder'], required=True)
    parser.add_argument('--phase1-stop', type=float, required=True, help='Phase1 stop % (e.g., 0.15)')
    parser.add_argument('--phase2-stop', type=float, required=True, help='Phase2 stop % (e.g., 0.50)')
    parser.add_argument('--stop-from', choices=['alert', 'entry'], default='alert',
                       help='Calculate stops from alert price or entry price')
    parser.add_argument('--output', choices=['table', 'json'], default='table')
    
    args = parser.parse_args()
    
    print("="*80)
    print("DELAYED ENTRY ANALYSIS")
    print("="*80)
    print(f"Stop mode: {args.stop_mode}")
    print(f"Phase1: {args.phase1_stop*100:.0f}%, Phase2: {args.phase2_stop*100:.0f}%")
    print(f"Stops calculated from: {args.stop_from} price")
    print()
    
    # Load existing results to get base comparison
    df = pd.read_parquet(args.parquet_file)
    
    # Filter to strategy
    base_df = df[
        (df['stop_mode'] == args.stop_mode) &
        (df['phase1_stop_pct'] == args.phase1_stop) &
        (df['phase2_stop_pct'] == args.phase2_stop)
    ].copy()
    
    print(f"Base strategy (immediate entry):")
    print(f"  Trades: {len(base_df):,}")
    print(f"  Mean exit: {base_df['exit_mult'].mean():.2f}x")
    print(f"  EV: {(base_df['exit_mult'].mean() - 1.0) * 100:.1f}%")
    print(f"  Winners (≥3x): {(base_df['hit_3x'].sum() / len(base_df) * 100):.1f}%")
    print()
    
    # TODO: Implement full delayed entry simulation
    # This requires:
    # 1. Load alerts from DuckDB
    # 2. Load candles for each alert
    # 3. For each dip percentage, simulate delayed entry
    # 4. Aggregate results
    
    print("⚠️  Full simulation not yet implemented")
    print()
    print("Next steps:")
    print("  1. Load alerts from DuckDB")
    print("  2. Load candles for each token")
    print("  3. Simulate delayed entry for each dip %")
    print("  4. Compare results vs immediate entry")
    print()
    print("Dip percentages to test:")
    dip_pcts = [-0.05, -0.10, -0.15, -0.20, -0.25, -0.30, -0.40, -0.50]
    for dip in dip_pcts:
        print(f"  {dip*100:.0f}%")


if __name__ == '__main__':
    main()

