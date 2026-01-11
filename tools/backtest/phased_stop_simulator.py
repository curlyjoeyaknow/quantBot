#!/usr/bin/env python3
"""
Phased Stop Strategy Simulator

Tests different stop strategies for two distinct phases:
1. Phase 1 (1x→2x): Entry to first profit target (2x)
2. Phase 2 (2x+): After hitting 2x, trail until stopped out

Compares:
- Universal stop (same % for both phases)
- Phased stops (different % for each phase)

This answers: "Do I need tighter stops pre-2x and looser stops post-2x, or does one size fit all?"

Usage:
    python3 phased_stop_simulator.py --duckdb data/alerts.duckdb --slice slices/per_token --chain solana
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from threading import Semaphore
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# Add project root to path for tools.shared imports
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root))

# Import alerts module
import importlib.util
lib_dir = Path(__file__).parent / "lib"
alerts_spec = importlib.util.spec_from_file_location("alerts", lib_dir / "alerts.py")
alerts_mod = importlib.util.module_from_spec(alerts_spec)
sys.modules['alerts'] = alerts_mod
alerts_spec.loader.exec_module(alerts_mod)
load_alerts = alerts_mod.load_alerts

# Global semaphore to limit concurrent DuckDB connections
_duckdb_semaphore = None


@dataclass
class PhasedTradeResult:
    """Result of a simulated trade with phased stop strategy."""
    caller: str
    mint: str
    alert_id: Optional[int]
    
    # Entry
    entry_price: float
    entry_ts_ms: int
    
    # Exit
    exit_price: float
    exit_ts_ms: int
    exit_reason: str  # "stopped_phase1", "stopped_phase2", "end_of_data"
    exit_phase: int  # 1 or 2
    
    # Performance
    multiple_achieved: float  # exit_price / entry_price
    return_pct: float  # (exit_price - entry_price) / entry_price
    hold_time_minutes: int
    
    # Strategy details
    stop_mode: str  # "static", "trailing", "ladder"
    phase1_stop_pct: float  # Stop % for 1x→2x phase
    phase2_stop_pct: float  # Stop % for 2x+ phase
    ladder_steps: Optional[float]
    
    # Milestones
    hit_2x: bool
    hit_3x: bool
    hit_4x: bool
    hit_5x: bool
    hit_10x: bool
    
    # ATH tracking
    ath_multiple: float  # Highest multiple achieved (exit_price / entry_price or peak / entry_price)
    
    # Phase transition
    phase2_entry_price: Optional[float]  # Price when entering phase 2 (at 2x)
    phase2_entry_ts_ms: Optional[int]


@dataclass
class StrategyPerformance:
    """Aggregated performance for a phased stop strategy."""
    caller: str
    stop_mode: str
    phase1_stop_pct: float
    phase2_stop_pct: float
    ladder_steps: Optional[float]
    
    # Trade counts
    n_trades: int
    n_hit_2x: int
    n_stopped_phase1: int
    n_stopped_phase2: int
    
    # Returns
    total_return_pct: float
    avg_return_pct: float
    median_return_pct: float
    p25_return_pct: float
    p75_return_pct: float
    win_rate: float  # % of trades with positive return
    
    # Multiples
    avg_multiple: float
    median_multiple: float
    
    # Risk metrics
    max_loss_pct: float
    max_gain_pct: float
    
    # Capture metrics
    pct_captured_2x: float  # % that reached 2x
    pct_captured_3x: float  # % of 2x runners that reached 3x
    pct_captured_4x: float
    pct_captured_5x: float
    pct_captured_10x: float
    
    # ATH metrics
    avg_ath_multiple: float  # Average ATH multiple across all trades
    median_ath_multiple: float
    p75_ath_multiple: float
    p90_ath_multiple: float
    
    # Expected value
    expected_value_per_trade: float  # avg_return_pct


def simulate_phased_trade(
    candles: List[Dict],
    entry_price: float,
    entry_ts_ms: int,
    stop_mode: str,
    phase1_stop_pct: float,
    phase2_stop_pct: float,
    ladder_steps: float = 0.5,
) -> Tuple[float, int, str, int, bool, bool, bool, bool, bool, float, Optional[float], Optional[int]]:
    """
    Simulate a trade with phased stop strategy.
    
    Returns:
        (exit_price, exit_ts_ms, exit_reason, exit_phase, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x,
         ath_multiple, phase2_entry_price, phase2_entry_ts_ms)
    """
    if not candles:
        return (entry_price, entry_ts_ms, "end_of_data", 1, False, False, False, False, False, 1.0, None, None)
    
    # Target prices
    target_2x = entry_price * 2.0
    target_3x = entry_price * 3.0
    target_4x = entry_price * 4.0
    target_5x = entry_price * 5.0
    target_10x = entry_price * 10.0
    
    # Phase tracking
    current_phase = 1
    phase2_entry_price = None
    phase2_entry_ts_ms = None
    
    # Milestone tracking
    hit_2x = False
    hit_3x = False
    hit_4x = False
    hit_5x = False
    hit_10x = False
    
    # ATH tracking
    ath_price = entry_price
    ath_multiple = 1.0
    
    # Phase 1 tracking (1x→2x)
    phase1_peak = entry_price
    phase1_stop_price = entry_price * (1.0 - phase1_stop_pct)
    phase1_ladder_anchor = entry_price
    
    # Phase 2 tracking (2x+)
    phase2_peak = None
    phase2_stop_price = None
    phase2_ladder_anchor = None
    
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
        
        # Check milestone hits
        if not hit_2x and high >= target_2x:
            hit_2x = True
            current_phase = 2
            phase2_entry_price = target_2x
            phase2_entry_ts_ms = ts_ms
            phase2_peak = target_2x
            
            # Initialize phase 2 stop
            if stop_mode == "static":
                phase2_stop_price = target_2x * (1.0 - phase2_stop_pct)
            elif stop_mode == "trailing":
                phase2_stop_price = target_2x * (1.0 - phase2_stop_pct)
            elif stop_mode == "ladder":
                phase2_ladder_anchor = target_2x
                phase2_stop_price = target_2x * (1.0 - phase2_stop_pct)
        
        if not hit_3x and high >= target_3x:
            hit_3x = True
        if not hit_4x and high >= target_4x:
            hit_4x = True
        if not hit_5x and high >= target_5x:
            hit_5x = True
        if not hit_10x and high >= target_10x:
            hit_10x = True
        
        # Track ATH
        if high > ath_price:
            ath_price = high
            ath_multiple = ath_price / entry_price
        
        # Phase 1: 1x→2x
        if current_phase == 1:
            # Update peak and stop
            if stop_mode == "trailing":
                if high > phase1_peak:
                    phase1_peak = high
                    phase1_stop_price = phase1_peak * (1.0 - phase1_stop_pct)
            elif stop_mode == "ladder":
                # Calculate ladder anchor
                current_multiple = high / entry_price
                if current_multiple >= 1.0:
                    anchor_multiple = max(1.0, int(current_multiple / ladder_steps) * ladder_steps)
                    new_anchor = entry_price * anchor_multiple
                    if new_anchor > phase1_ladder_anchor:
                        phase1_ladder_anchor = new_anchor
                        phase1_stop_price = phase1_ladder_anchor * (1.0 - phase1_stop_pct)
            
            # Check stop
            if low <= phase1_stop_price:
                exit_price = phase1_stop_price
                return (exit_price, ts_ms, "stopped_phase1", 1, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x,
                       ath_multiple, phase2_entry_price, phase2_entry_ts_ms)
        
        # Phase 2: 2x+
        elif current_phase == 2:
            # Update peak and stop
            if stop_mode == "static":
                # Stop stays at 2x level
                pass
            elif stop_mode == "trailing":
                if high > phase2_peak:
                    phase2_peak = high
                    phase2_stop_price = phase2_peak * (1.0 - phase2_stop_pct)
            elif stop_mode == "ladder":
                # Calculate ladder anchor from entry price
                current_multiple = high / entry_price
                anchor_multiple = max(2.0, int(current_multiple / ladder_steps) * ladder_steps)
                new_anchor = entry_price * anchor_multiple
                if new_anchor > phase2_ladder_anchor:
                    phase2_ladder_anchor = new_anchor
                    phase2_stop_price = phase2_ladder_anchor * (1.0 - phase2_stop_pct)
            
            # Check stop
            if low <= phase2_stop_price:
                exit_price = phase2_stop_price
                return (exit_price, ts_ms, "stopped_phase2", 2, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x,
                       ath_multiple, phase2_entry_price, phase2_entry_ts_ms)
    
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
    
    return (exit_price, exit_ts_ms, "end_of_data", current_phase, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x,
           ath_multiple, phase2_entry_price, phase2_entry_ts_ms)


def load_candles_from_parquet(
    slice_path: Path,
    mint: str,
    entry_ts_ms: int,
    end_ts_ms: int,
    interval_seconds: int = 300,
) -> List[Dict]:
    """Load candles from parquet slice."""
    import duckdb
    
    global _duckdb_semaphore
    
    if _duckdb_semaphore is not None:
        _duckdb_semaphore.acquire()
    
    con = None
    try:
        con = duckdb.connect(":memory:")
        con.execute("SET temp_directory='/tmp/duckdb_temp'")
        con.execute("SET max_memory='512MB'")
        con.execute("SET threads=1")
        
        is_partitioned = slice_path.is_dir()
        
        if is_partitioned:
            parquet_glob = f"{slice_path.as_posix()}/**/*.parquet"
            con.execute(f"""
                CREATE TEMP TABLE candles_temp AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{parquet_glob}', hive_partitioning=true)
                WHERE token_address = '{mint}'
            """)
        else:
            con.execute(f"""
                CREATE TEMP TABLE candles_temp AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{slice_path.as_posix()}')
                WHERE token_address = '{mint}'
            """)
        
        # Filter by time window
        entry_ts_sec = entry_ts_ms // 1000
        end_ts_sec = end_ts_ms // 1000
        
        result = con.execute(f"""
            SELECT timestamp, open, high, low, close, volume
            FROM candles_temp
            WHERE epoch(timestamp) >= {entry_ts_sec}
              AND epoch(timestamp) <= {end_ts_sec}
            ORDER BY timestamp ASC
        """).fetchall()
        
        candles = []
        for row in result:
            candles.append({
                'timestamp': row[0],
                'open': row[1],
                'high': row[2],
                'low': row[3],
                'close': row[4],
                'volume': row[5],
            })
        
        return candles
    
    finally:
        if con:
            con.close()
        if _duckdb_semaphore is not None:
            _duckdb_semaphore.release()


def load_alerts_from_duckdb(
    duckdb_path: Path,
    chain: str,
    date_from: Optional[str],
    date_to: Optional[str],
) -> List[Dict]:
    """Load alerts from DuckDB using lib/alerts.py."""
    from datetime import datetime
    
    # Convert string dates to datetime
    dt_from = datetime.fromisoformat(date_from) if date_from else datetime(2020, 1, 1)
    dt_to = datetime.fromisoformat(date_to) if date_to else datetime.now()
    
    # Load using lib function
    alert_objects = load_alerts(str(duckdb_path), chain, dt_from, dt_to)
    
    # Convert to dict format (entry_price will be determined from candles)
    alerts = []
    for alert in alert_objects:
        alerts.append({
            'id': None,  # Alert object doesn't have id
            'caller': alert.caller,
            'mint': alert.mint,
            'timestamp_ms': alert.ts_ms,
            'entry_price': None,  # Will be filled from first candle
        })
    
    return alerts


def aggregate_performance(trades: List[PhasedTradeResult]) -> StrategyPerformance:
    """Aggregate trade results into performance metrics."""
    if not trades:
        return None
    
    caller = trades[0].caller
    stop_mode = trades[0].stop_mode
    phase1_stop_pct = trades[0].phase1_stop_pct
    phase2_stop_pct = trades[0].phase2_stop_pct
    ladder_steps = trades[0].ladder_steps
    
    n_trades = len(trades)
    n_hit_2x = sum(1 for t in trades if t.hit_2x)
    n_stopped_phase1 = sum(1 for t in trades if t.exit_reason == "stopped_phase1")
    n_stopped_phase2 = sum(1 for t in trades if t.exit_reason == "stopped_phase2")
    
    returns = [t.return_pct for t in trades]
    multiples = [t.multiple_achieved for t in trades]
    
    total_return_pct = sum(returns)
    avg_return_pct = np.mean(returns)
    median_return_pct = np.median(returns)
    p25_return_pct = np.percentile(returns, 25)
    p75_return_pct = np.percentile(returns, 75)
    
    win_rate = sum(1 for r in returns if r > 0) / len(returns) * 100.0
    
    avg_multiple = np.mean(multiples)
    median_multiple = np.median(multiples)
    
    max_loss_pct = min(returns)
    max_gain_pct = max(returns)
    
    # Capture metrics
    pct_captured_2x = (n_hit_2x / n_trades * 100.0) if n_trades > 0 else 0.0
    
    trades_hit_2x = [t for t in trades if t.hit_2x]
    pct_captured_3x = (sum(1 for t in trades_hit_2x if t.hit_3x) / len(trades_hit_2x) * 100.0) if trades_hit_2x else 0.0
    pct_captured_4x = (sum(1 for t in trades_hit_2x if t.hit_4x) / len(trades_hit_2x) * 100.0) if trades_hit_2x else 0.0
    pct_captured_5x = (sum(1 for t in trades_hit_2x if t.hit_5x) / len(trades_hit_2x) * 100.0) if trades_hit_2x else 0.0
    pct_captured_10x = (sum(1 for t in trades_hit_2x if t.hit_10x) / len(trades_hit_2x) * 100.0) if trades_hit_2x else 0.0
    
    # ATH metrics
    ath_multiples = [t.ath_multiple for t in trades]
    avg_ath_multiple = np.mean(ath_multiples)
    median_ath_multiple = np.median(ath_multiples)
    p75_ath_multiple = np.percentile(ath_multiples, 75)
    p90_ath_multiple = np.percentile(ath_multiples, 90)
    
    return StrategyPerformance(
        caller=caller,
        stop_mode=stop_mode,
        phase1_stop_pct=phase1_stop_pct,
        phase2_stop_pct=phase2_stop_pct,
        ladder_steps=ladder_steps,
        n_trades=n_trades,
        n_hit_2x=n_hit_2x,
        n_stopped_phase1=n_stopped_phase1,
        n_stopped_phase2=n_stopped_phase2,
        total_return_pct=total_return_pct,
        avg_return_pct=avg_return_pct,
        median_return_pct=median_return_pct,
        p25_return_pct=p25_return_pct,
        p75_return_pct=p75_return_pct,
        win_rate=win_rate,
        avg_multiple=avg_multiple,
        median_multiple=median_multiple,
        max_loss_pct=max_loss_pct,
        max_gain_pct=max_gain_pct,
        pct_captured_2x=pct_captured_2x,
        pct_captured_3x=pct_captured_3x,
        pct_captured_4x=pct_captured_4x,
        pct_captured_5x=pct_captured_5x,
        pct_captured_10x=pct_captured_10x,
        avg_ath_multiple=avg_ath_multiple,
        median_ath_multiple=median_ath_multiple,
        p75_ath_multiple=p75_ath_multiple,
        p90_ath_multiple=p90_ath_multiple,
        expected_value_per_trade=avg_return_pct,
    )


def print_results(performances: List[StrategyPerformance], output_format: str):
    """Print performance results."""
    if output_format == "json":
        output = []
        for perf in performances:
            output.append({
                "caller": perf.caller,
                "stop_mode": perf.stop_mode,
                "phase1_stop_pct": perf.phase1_stop_pct,
                "phase2_stop_pct": perf.phase2_stop_pct,
                "ladder_steps": perf.ladder_steps,
                "n_trades": perf.n_trades,
                "n_hit_2x": perf.n_hit_2x,
                "n_stopped_phase1": perf.n_stopped_phase1,
                "n_stopped_phase2": perf.n_stopped_phase2,
                "avg_return_pct": perf.avg_return_pct,
                "median_return_pct": perf.median_return_pct,
                "win_rate": perf.win_rate,
                "expected_value_per_trade": perf.expected_value_per_trade,
                "pct_captured_2x": perf.pct_captured_2x,
                "pct_captured_3x": perf.pct_captured_3x,
            })
        print(json.dumps(output, indent=2))
    
    else:  # table
        print("\n" + "=" * 180)
        print("PHASED STOP STRATEGY PERFORMANCE BY CALLER")
        print("=" * 180)
        
        # Group by caller
        by_caller = defaultdict(list)
        for perf in performances:
            by_caller[perf.caller].append(perf)
        
        for caller, perfs in sorted(by_caller.items()):
            print(f"\n{caller}")
            print("-" * 180)
            print(f"{'P1%':<6} {'P2%':<6} {'Mode':<10} {'N':>5} {'Hit2x':>6} {'Stop1':>6} {'Stop2':>6} "
                  f"{'AvgRet%':>8} {'MedRet%':>8} {'WinRate%':>9} {'EV/Trade%':>10} "
                  f"{'Cap2x%':>7} {'Cap3x%':>7} {'Cap5x%':>7} {'Cap10x%':>8} {'ATH_p50':>8} {'ATH_p90':>8}")
            print("-" * 200)
            
            for perf in sorted(perfs, key=lambda p: p.expected_value_per_trade, reverse=True):
                mode_str = perf.stop_mode
                if perf.stop_mode == "ladder":
                    mode_str = f"ladder{perf.ladder_steps:.1f}"
                
                print(f"{perf.phase1_stop_pct*100:>5.0f}% {perf.phase2_stop_pct*100:>5.0f}% "
                      f"{mode_str:<10} {perf.n_trades:>5} {perf.n_hit_2x:>6} "
                      f"{perf.n_stopped_phase1:>6} {perf.n_stopped_phase2:>6} "
                      f"{perf.avg_return_pct:>7.1f}% {perf.median_return_pct:>7.1f}% "
                      f"{perf.win_rate:>8.1f}% {perf.expected_value_per_trade:>9.1f}% "
                      f"{perf.pct_captured_2x:>6.1f}% {perf.pct_captured_3x:>6.1f}% "
                      f"{perf.pct_captured_5x:>6.1f}% {perf.pct_captured_10x:>7.1f}% "
                      f"{perf.median_ath_multiple:>7.2f}x {perf.p90_ath_multiple:>7.2f}x")
        
        print("\n" + "=" * 200)
        print("\nLegend:")
        print("  P1% = Phase 1 stop % (1x→2x)")
        print("  P2% = Phase 2 stop % (2x+)")
        print("  Mode = Stop mode (static/trailing/ladder)")
        print("  N = Number of trades")
        print("  Hit2x = Number that reached 2x")
        print("  Stop1 = Stopped out in phase 1")
        print("  Stop2 = Stopped out in phase 2")
        print("  AvgRet% = Average return %")
        print("  MedRet% = Median return %")
        print("  WinRate% = % of trades with positive return")
        print("  EV/Trade% = Expected value per trade (avg return)")
        print("  Cap2x% = % that captured 2x")
        print("  Cap3x% = % of 2x runners that captured 3x")
        print("  Cap5x% = % of 2x runners that captured 5x")
        print("  Cap10x% = % of 2x runners that captured 10x")
        print("  ATH_p50 = Median ATH multiple (peak / entry)")
        print("  ATH_p90 = 90th percentile ATH multiple")
        print("\nInterpretation:")
        print("  - Compare universal stops (P1%=P2%) vs phased stops (P1%≠P2%)")
        print("  - Higher EV/Trade% = better strategy")
        print("  - If phased stops (e.g., 10%/20%) beat universal (20%/20%), use different stops per phase")


def main():
    parser = argparse.ArgumentParser(description="Phased stop strategy simulator")
    parser.add_argument("--duckdb", type=str, required=True, help="Path to alerts DuckDB")
    parser.add_argument("--slice", type=str, required=True, help="Path to candle slice directory")
    parser.add_argument("--chain", type=str, default="solana", help="Chain name")
    parser.add_argument("--date-from", type=str, help="Start date (ISO 8601)")
    parser.add_argument("--date-to", type=str, help="End date (ISO 8601)")
    parser.add_argument("--min-calls", type=int, default=10, help="Minimum calls per caller")
    parser.add_argument("--threads", type=int, default=4, help="Number of threads")
    parser.add_argument("--output", choices=["table", "json"], default="table", help="Output format")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    # Initialize semaphore
    global _duckdb_semaphore
    _duckdb_semaphore = Semaphore(args.threads)
    
    # Load alerts
    if args.verbose:
        print(f"Loading alerts from {args.duckdb}...", file=sys.stderr)
    
    alerts = load_alerts_from_duckdb(
        Path(args.duckdb),
        args.chain,
        args.date_from,
        args.date_to,
    )
    
    if args.verbose:
        print(f"Loaded {len(alerts)} alerts", file=sys.stderr)
    
    # Define stop strategies to test
    stop_strategies = [
        # Universal stops (same % for both phases)
        ("static", 0.10, 0.10, 0.5),
        ("static", 0.15, 0.15, 0.5),
        ("static", 0.20, 0.20, 0.5),
        ("static", 0.25, 0.25, 0.5),
        ("static", 0.30, 0.30, 0.5),
        ("static", 0.35, 0.35, 0.5),
        ("static", 0.40, 0.40, 0.5),
        ("static", 0.50, 0.50, 0.5),
        ("static", 0.60, 0.60, 0.5),
        ("trailing", 0.10, 0.10, 0.5),
        ("trailing", 0.15, 0.15, 0.5),
        ("trailing", 0.20, 0.20, 0.5),
        ("trailing", 0.25, 0.25, 0.5),
        ("trailing", 0.30, 0.30, 0.5),
        ("trailing", 0.35, 0.35, 0.5),
        ("trailing", 0.40, 0.40, 0.5),
        ("trailing", 0.50, 0.50, 0.5),
        ("trailing", 0.60, 0.60, 0.5),
        # Phased stops (tighter pre-2x, looser post-2x)
        ("static", 0.10, 0.20, 0.5),
        ("static", 0.10, 0.30, 0.5),
        ("static", 0.10, 0.40, 0.5),
        ("static", 0.10, 0.50, 0.5),
        ("static", 0.15, 0.30, 0.5),
        ("static", 0.15, 0.40, 0.5),
        ("static", 0.15, 0.50, 0.5),
        ("static", 0.20, 0.40, 0.5),
        ("static", 0.20, 0.50, 0.5),
        ("static", 0.20, 0.60, 0.5),
        ("trailing", 0.10, 0.20, 0.5),
        ("trailing", 0.10, 0.30, 0.5),
        ("trailing", 0.10, 0.40, 0.5),
        ("trailing", 0.10, 0.50, 0.5),
        ("trailing", 0.15, 0.30, 0.5),
        ("trailing", 0.15, 0.40, 0.5),
        ("trailing", 0.15, 0.50, 0.5),
        ("trailing", 0.20, 0.40, 0.5),
        ("trailing", 0.20, 0.50, 0.5),
        ("trailing", 0.20, 0.60, 0.5),
        # Ladder strategies
        ("ladder", 0.15, 0.15, 0.5),
        ("ladder", 0.20, 0.20, 0.5),
        ("ladder", 0.30, 0.30, 0.5),
        ("ladder", 0.40, 0.40, 0.5),
        ("ladder", 0.10, 0.30, 0.5),
        ("ladder", 0.10, 0.40, 0.5),
        ("ladder", 0.15, 0.40, 0.5),
        ("ladder", 0.20, 0.50, 0.5),
    ]
    
    # Simulate trades with multithreading
    all_trades = []
    slice_path = Path(args.slice)
    
    if args.verbose:
        print(f"Simulating {len(stop_strategies)} strategies on {len(alerts)} alerts...", file=sys.stderr)
    
    def process_alert(alert_data):
        """Process a single alert with all strategies."""
        alert, strategies = alert_data
        trades = []
        
        try:
            entry_ts_ms = alert['timestamp_ms']
            end_ts_ms = entry_ts_ms + (7 * 24 * 60 * 60 * 1000)  # 7 days
            
            # Load candles once per alert
            candles = load_candles_from_parquet(
                slice_path,
                alert['mint'],
                entry_ts_ms,
                end_ts_ms,
            )
            
            if not candles:
                return trades
            
            # Get entry price from first candle
            entry_price = None
            from datetime import datetime as dt_class
            for candle in candles:
                ts = candle['timestamp']
                if isinstance(ts, dt_class):
                    ts_ms = int(ts.timestamp() * 1000)
                elif isinstance(ts, str):
                    ts_dt = dt_class.fromisoformat(ts.replace('Z', '+00:00'))
                    ts_ms = int(ts_dt.timestamp() * 1000)
                elif isinstance(ts, (int, float)):
                    ts_float = float(ts)
                    ts_ms = int(ts_float * 1000) if ts_float < 4102444800 else int(ts_float)
                else:
                    continue
                
                if ts_ms >= entry_ts_ms:
                    entry_price = float(candle['close'])
                    break
            
            if entry_price is None or entry_price <= 0:
                return trades
            
            # Test each strategy
            for stop_mode, phase1_stop, phase2_stop, ladder_steps in strategies:
                exit_price, exit_ts_ms, exit_reason, exit_phase, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x, ath_multiple, phase2_entry_price, phase2_entry_ts_ms = simulate_phased_trade(
                    candles,
                    entry_price,
                    entry_ts_ms,
                    stop_mode,
                    phase1_stop,
                    phase2_stop,
                    ladder_steps,
                )
                
                multiple = exit_price / entry_price
                return_pct = (exit_price - entry_price) / entry_price * 100.0
                hold_time_minutes = (exit_ts_ms - entry_ts_ms) // (1000 * 60)
                
                trade = PhasedTradeResult(
                    caller=alert['caller'],
                    mint=alert['mint'],
                    alert_id=alert['id'],
                    entry_price=entry_price,
                    entry_ts_ms=entry_ts_ms,
                    exit_price=exit_price,
                    exit_ts_ms=exit_ts_ms,
                    exit_reason=exit_reason,
                    exit_phase=exit_phase,
                    multiple_achieved=multiple,
                    return_pct=return_pct,
                    hold_time_minutes=hold_time_minutes,
                    stop_mode=stop_mode,
                    phase1_stop_pct=phase1_stop,
                    phase2_stop_pct=phase2_stop,
                    ladder_steps=ladder_steps,
                    hit_2x=hit_2x,
                    hit_3x=hit_3x,
                    hit_4x=hit_4x,
                    hit_5x=hit_5x,
                    hit_10x=hit_10x,
                    ath_multiple=ath_multiple,
                    phase2_entry_price=phase2_entry_price,
                    phase2_entry_ts_ms=phase2_entry_ts_ms,
                )
                
                trades.append(trade)
        
        except Exception as e:
            if args.verbose:
                print(f"Warning: Error processing alert {alert.get('mint', 'unknown')}: {e}", file=sys.stderr)
        
        return trades
    
    # Use ThreadPoolExecutor for parallel processing
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    with ThreadPoolExecutor(max_workers=args.threads) as executor:
        # Submit all alerts
        futures = {
            executor.submit(process_alert, (alert, stop_strategies)): i
            for i, alert in enumerate(alerts)
        }
        
        # Collect results as they complete
        completed = 0
        for future in as_completed(futures):
            completed += 1
            if args.verbose and completed % 10 == 0:
                print(f"Processed {completed}/{len(alerts)} alerts...", file=sys.stderr)
            
            try:
                trades = future.result(timeout=60)  # 60 second timeout per alert
                all_trades.extend(trades)
            except Exception as e:
                if args.verbose:
                    alert_idx = futures[future]
                    print(f"Warning: Timeout or error processing alert {alert_idx}: {e}", file=sys.stderr)
    
    if args.verbose:
        print(f"Simulated {len(all_trades)} total trades", file=sys.stderr)
    
    # Count unique mints per caller (across all strategies)
    caller_mint_counts = defaultdict(set)
    for trade in all_trades:
        caller_mint_counts[trade.caller].add(trade.mint)
    
    # Filter callers by min calls
    valid_callers = {caller for caller, mints in caller_mint_counts.items() if len(mints) >= args.min_calls}
    
    if args.verbose:
        print(f"Found {len(valid_callers)} callers with >= {args.min_calls} calls", file=sys.stderr)
    
    # Aggregate by caller and strategy
    by_caller_strategy = defaultdict(list)
    for trade in all_trades:
        if trade.caller not in valid_callers:
            continue
        key = (trade.caller, trade.stop_mode, trade.phase1_stop_pct, trade.phase2_stop_pct, trade.ladder_steps)
        by_caller_strategy[key].append(trade)
    
    # Generate performance metrics
    performances = []
    for (caller, stop_mode, phase1_stop, phase2_stop, ladder_steps), trades in by_caller_strategy.items():
        perf = aggregate_performance(trades)
        if perf:
            performances.append(perf)
    
    # Print results
    print_results(performances, args.output)


if __name__ == "__main__":
    main()

