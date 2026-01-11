#!/usr/bin/env python3
"""
Pure time-based exit simulator.

Tests different time-based exit strategies:
1. Fixed time exits (12h, 24h, 36h, 48h)
2. Phased time exits (e.g., 12h for phase1, 36h for phase2)
3. Hybrid (time + trailing stop as safety net)

Compare against stop-based strategies to determine if time > stops.
"""

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from dataclasses import dataclass
import json
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

import duckdb
import numpy as np
import pandas as pd
from tabulate import tabulate

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent / 'lib'))
from alerts import load_alerts_from_duckdb, Alert


@dataclass
class TimeExitConfig:
    """Configuration for time-based exit strategy."""
    phase1_time_hrs: float  # Time limit for phase 1 (entry → 2x)
    phase2_time_hrs: float  # Time limit for phase 2 (2x → exit)
    safety_stop_pct: Optional[float] = None  # Optional trailing stop as safety net
    name: str = ""


@dataclass
class TimeExitResult:
    """Result of a time-based exit simulation."""
    mint: str
    caller: str
    entry_price: float
    exit_price: float
    exit_mult: float
    peak_mult: float
    time_to_exit_hrs: float
    exit_reason: str  # 'time_phase1', 'time_phase2', 'safety_stop', 'end_of_data'
    hit_2x: bool
    hit_3x: bool
    hit_4x: bool
    hit_5x: bool
    hit_10x: bool


def simulate_time_exit(
    candles: List[Dict],
    entry_price: float,
    entry_ts_ms: int,
    config: TimeExitConfig,
) -> TimeExitResult:
    """
    Simulate a trade with pure time-based exits.
    
    Phase 1 (entry → 2x):
    - Exit after phase1_time_hrs OR when hit 2x (whichever first)
    - Optional: Safety stop if price drops below safety_stop_pct
    
    Phase 2 (2x → exit):
    - Exit after phase2_time_hrs from hitting 2x
    - Optional: Safety stop trailing from peak
    """
    if not candles:
        return TimeExitResult(
            mint="", caller="", entry_price=entry_price, exit_price=entry_price,
            exit_mult=1.0, peak_mult=1.0, time_to_exit_hrs=0,
            exit_reason="no_data", hit_2x=False, hit_3x=False, hit_4x=False,
            hit_5x=False, hit_10x=False
        )
    
    # Target prices
    target_2x = entry_price * 2.0
    target_3x = entry_price * 3.0
    target_4x = entry_price * 4.0
    target_5x = entry_price * 5.0
    target_10x = entry_price * 10.0
    
    # Phase tracking
    current_phase = 1
    phase2_start_ts_ms = None
    
    # Milestone tracking
    hit_2x = False
    hit_3x = False
    hit_4x = False
    hit_5x = False
    hit_10x = False
    
    # Peak tracking
    peak_price = entry_price
    peak_mult = 1.0
    
    # Safety stop tracking (if enabled)
    safety_stop_price = None
    if config.safety_stop_pct is not None:
        safety_stop_price = entry_price * (1.0 - config.safety_stop_pct)
    
    # Time limits (in milliseconds)
    phase1_time_limit_ms = config.phase1_time_hrs * 3600 * 1000
    phase2_time_limit_ms = config.phase2_time_hrs * 3600 * 1000
    
    for candle in candles:
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
            if ts_float < 4102444800:  # 2100-01-01 in seconds
                ts_ms = int(ts_float * 1000)
            else:
                ts_ms = int(ts_float)
        else:
            continue
        
        high = float(candle['high'])
        low = float(candle['low'])
        close = float(candle['close'])
        
        # Update peak
        if high > peak_price:
            peak_price = high
            peak_mult = peak_price / entry_price
            
            # Update trailing safety stop if enabled
            if config.safety_stop_pct is not None:
                safety_stop_price = peak_price * (1.0 - config.safety_stop_pct)
        
        # Check milestone hits
        if not hit_2x and high >= target_2x:
            hit_2x = True
            current_phase = 2
            phase2_start_ts_ms = ts_ms
        
        if not hit_3x and high >= target_3x:
            hit_3x = True
        if not hit_4x and high >= target_4x:
            hit_4x = True
        if not hit_5x and high >= target_5x:
            hit_5x = True
        if not hit_10x and high >= target_10x:
            hit_10x = True
        
        # Phase 1: Entry → 2x
        if current_phase == 1:
            time_elapsed_ms = ts_ms - entry_ts_ms
            
            # Check safety stop
            if safety_stop_price is not None and low <= safety_stop_price:
                time_hrs = time_elapsed_ms / (3600 * 1000)
                return TimeExitResult(
                    mint="", caller="", entry_price=entry_price, exit_price=safety_stop_price,
                    exit_mult=safety_stop_price/entry_price, peak_mult=peak_mult,
                    time_to_exit_hrs=time_hrs, exit_reason="safety_stop_phase1",
                    hit_2x=hit_2x, hit_3x=hit_3x, hit_4x=hit_4x, hit_5x=hit_5x, hit_10x=hit_10x
                )
            
            # Check time limit
            if time_elapsed_ms >= phase1_time_limit_ms:
                time_hrs = time_elapsed_ms / (3600 * 1000)
                return TimeExitResult(
                    mint="", caller="", entry_price=entry_price, exit_price=close,
                    exit_mult=close/entry_price, peak_mult=peak_mult,
                    time_to_exit_hrs=time_hrs, exit_reason="time_phase1",
                    hit_2x=hit_2x, hit_3x=hit_3x, hit_4x=hit_4x, hit_5x=hit_5x, hit_10x=hit_10x
                )
        
        # Phase 2: 2x → exit
        elif current_phase == 2:
            time_in_phase2_ms = ts_ms - phase2_start_ts_ms
            total_time_ms = ts_ms - entry_ts_ms
            
            # Check safety stop
            if safety_stop_price is not None and low <= safety_stop_price:
                time_hrs = total_time_ms / (3600 * 1000)
                return TimeExitResult(
                    mint="", caller="", entry_price=entry_price, exit_price=safety_stop_price,
                    exit_mult=safety_stop_price/entry_price, peak_mult=peak_mult,
                    time_to_exit_hrs=time_hrs, exit_reason="safety_stop_phase2",
                    hit_2x=hit_2x, hit_3x=hit_3x, hit_4x=hit_4x, hit_5x=hit_5x, hit_10x=hit_10x
                )
            
            # Check time limit
            if time_in_phase2_ms >= phase2_time_limit_ms:
                time_hrs = total_time_ms / (3600 * 1000)
                return TimeExitResult(
                    mint="", caller="", entry_price=entry_price, exit_price=close,
                    exit_mult=close/entry_price, peak_mult=peak_mult,
                    time_to_exit_hrs=time_hrs, exit_reason="time_phase2",
                    hit_2x=hit_2x, hit_3x=hit_3x, hit_4x=hit_4x, hit_5x=hit_5x, hit_10x=hit_10x
                )
    
    # End of data
    last_candle = candles[-1]
    exit_price = float(last_candle['close'])
    
    ts_val = last_candle['timestamp']
    if isinstance(ts_val, dt_class):
        exit_ts_ms = int(ts_val.timestamp() * 1000)
    elif isinstance(ts_val, str):
        ts = dt_class.fromisoformat(ts_val.replace('Z', '+00:00'))
        exit_ts_ms = int(ts.timestamp() * 1000)
    else:
        exit_ts_ms = int(float(ts_val) * 1000 if float(ts_val) < 4102444800 else float(ts_val))
    
    time_hrs = (exit_ts_ms - entry_ts_ms) / (3600 * 1000)
    
    return TimeExitResult(
        mint="", caller="", entry_price=entry_price, exit_price=exit_price,
        exit_mult=exit_price/entry_price, peak_mult=peak_mult,
        time_to_exit_hrs=time_hrs, exit_reason="end_of_data",
        hit_2x=hit_2x, hit_3x=hit_3x, hit_4x=hit_4x, hit_5x=hit_5x, hit_10x=hit_10x
    )


def load_candles_from_parquet(
    slice_path: Path,
    mint: str,
    entry_ts_ms: int,
    end_ts_ms: int,
) -> List[Dict]:
    """Load candles for a specific token from parquet slice."""
    token_file = slice_path / f"{mint}.parquet"
    
    if not token_file.exists():
        return []
    
    try:
        df = pd.read_parquet(token_file)
        
        # Filter to time range
        df = df[(df['timestamp'] >= entry_ts_ms) & (df['timestamp'] <= end_ts_ms)]
        
        if len(df) == 0:
            return []
        
        # Convert to list of dicts
        candles = df.to_dict('records')
        return candles
    
    except Exception as e:
        print(f"Error loading candles for {mint}: {e}")
        return []


def main():
    parser = argparse.ArgumentParser(description='Time-based exit simulator')
    parser.add_argument('--duckdb', required=True, help='Path to alerts DuckDB')
    parser.add_argument('--slice', required=True, help='Path to per-token parquet slices')
    parser.add_argument('--date-from', required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--date-to', required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--min-calls', type=int, default=20, help='Minimum calls per caller')
    parser.add_argument('--threads', type=int, default=8, help='Number of threads')
    parser.add_argument('--output', default='results/time_exit_results.csv', help='Output CSV file')
    
    args = parser.parse_args()
    
    print("="*80)
    print("TIME-BASED EXIT SIMULATOR")
    print("="*80)
    print(f"Date range: {args.date_from} to {args.date_to}")
    print(f"Min calls: {args.min_calls}")
    print(f"Threads: {args.threads}")
    print()
    
    # Define time-based strategies to test
    strategies = [
        TimeExitConfig(phase1_time_hrs=12, phase2_time_hrs=12, name="12h/12h"),
        TimeExitConfig(phase1_time_hrs=12, phase2_time_hrs=24, name="12h/24h"),
        TimeExitConfig(phase1_time_hrs=12, phase2_time_hrs=36, name="12h/36h"),
        TimeExitConfig(phase1_time_hrs=24, phase2_time_hrs=24, name="24h/24h"),
        TimeExitConfig(phase1_time_hrs=24, phase2_time_hrs=36, name="24h/36h"),
        TimeExitConfig(phase1_time_hrs=24, phase2_time_hrs=48, name="24h/48h"),
        # Hybrid with safety stops
        TimeExitConfig(phase1_time_hrs=24, phase2_time_hrs=48, safety_stop_pct=0.30, name="24h/48h+30%stop"),
        TimeExitConfig(phase1_time_hrs=24, phase2_time_hrs=48, safety_stop_pct=0.40, name="24h/48h+40%stop"),
    ]
    
    print(f"Testing {len(strategies)} time-based strategies:")
    for s in strategies:
        safety = f" + {s.safety_stop_pct*100:.0f}% safety stop" if s.safety_stop_pct else ""
        print(f"  - {s.name}: Phase1={s.phase1_time_hrs}h, Phase2={s.phase2_time_hrs}h{safety}")
    print()
    
    # Load alerts
    print("Loading alerts...")
    alerts = load_alerts_from_duckdb(
        args.duckdb,
        args.date_from,
        args.date_to,
        args.min_calls
    )
    print(f"Loaded {len(alerts):,} alerts from {len(set(a.caller for a in alerts))} callers")
    
    # TODO: Implement full simulation with threading
    # For now, just show the framework
    
    print("\n✅ Time-based exit simulator framework created!")
    print("Next steps:")
    print("  1. Implement full simulation loop")
    print("  2. Add threading support")
    print("  3. Compare results with stop-based strategies")
    print("  4. Generate comprehensive report")


if __name__ == '__main__':
    main()

