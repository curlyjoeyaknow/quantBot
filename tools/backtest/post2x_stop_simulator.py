#!/usr/bin/env python3
"""
Post-2x Stop Strategy Simulator

Simulates actual trades with different trailing stop strategies starting at 2x.
Calculates real P&L, win rates, and other performance metrics to determine
which stop strategy is optimal for each caller.

This complements post2x_drawdown_analysis.py by showing actual expected value
instead of just theoretical capture rates.

Usage:
    python3 post2x_stop_simulator.py --duckdb data/alerts.duckdb --slice slices/per_token --chain solana
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

# Global semaphore to limit concurrent DuckDB connections
_duckdb_semaphore = None


@dataclass
class TradeResult:
    """Result of a single simulated trade."""
    caller: str
    mint: str
    alert_id: Optional[int]
    
    # Entry
    entry_price: float
    entry_ts_ms: int
    
    # Exit
    exit_price: float
    exit_ts_ms: int
    exit_reason: str  # "2x_not_hit", "stopped_out", "time_exit", "end_of_data"
    
    # Performance
    multiple_achieved: float  # exit_price / entry_price
    return_pct: float  # (exit_price - entry_price) / entry_price
    hold_time_minutes: int
    
    # Strategy details
    stop_mode: str  # "static", "trailing", "ladder"
    stop_pct: float  # e.g., 0.20 for 20% stop
    ladder_steps: Optional[float]  # e.g., 0.5 for 0.5x intervals
    
    # Milestones hit before exit
    hit_2x: bool
    hit_3x: bool
    hit_4x: bool
    hit_5x: bool


@dataclass
class StrategyPerformance:
    """Aggregated performance metrics for a strategy."""
    caller: str
    stop_mode: str
    stop_pct: float
    ladder_steps: Optional[float]
    
    # Trade counts
    n_trades: int
    n_hit_2x: int
    n_stopped_out: int
    n_time_exit: int
    
    # Returns
    total_return_pct: float
    avg_return_pct: float
    median_return_pct: float
    win_rate: float  # % of trades with positive return
    
    # Multiples
    avg_multiple: float
    median_multiple: float
    
    # Risk metrics
    max_loss_pct: float
    sharpe_ratio: Optional[float]
    
    # Capture metrics (for comparison with drawdown analysis)
    pct_captured_3x: float  # % of 3x runners captured
    pct_captured_4x: float
    pct_captured_5x: float


def get_ladder_anchor(current_price: float, entry_price: float, ladder_steps: float) -> float:
    """
    Get the ladder anchor price for the current price level.
    
    For ladder_steps=0.5: anchors at 2.0x, 2.5x, 3.0x, 3.5x, 4.0x, etc.
    For ladder_steps=1.0: anchors at 2.0x, 3.0x, 4.0x, 5.0x, etc.
    
    Returns the highest ladder level at or below current price.
    """
    if current_price < entry_price * 2.0:
        return entry_price * 2.0  # Below 2x, anchor at 2x
    
    # Calculate which ladder step we're at
    multiple = current_price / entry_price
    # Round down to nearest ladder step
    ladder_level = int(multiple / ladder_steps) * ladder_steps
    # Ensure we're at least at 2.0x
    ladder_level = max(2.0, ladder_level)
    
    return entry_price * ladder_level


def simulate_trade(
    candles: List[Dict],
    entry_price: float,
    entry_ts_ms: int,
    stop_mode: str,
    stop_pct: float,
    ladder_steps: float,
    max_hold_minutes: int = 1440,
) -> Optional[TradeResult]:
    """
    Simulate a single trade with specified stop strategy.
    
    Entry: At entry_price (first candle close at/after alert)
    Exit: When stopped out, or max hold time reached
    
    Returns TradeResult or None if no valid entry.
    """
    if not candles or entry_price <= 0:
        return None
    
    # Targets
    target_2x = entry_price * 2.0
    target_3x = entry_price * 3.0
    target_4x = entry_price * 4.0
    target_5x = entry_price * 5.0
    
    # Track milestones
    hit_2x = False
    hit_3x = False
    hit_4x = False
    hit_5x = False
    
    # Track stop level
    stop_anchor = entry_price  # Initial anchor (will move to 2x when hit)
    in_trade = True
    at_2x = False  # Flag to track when we've hit 2x
    
    exit_price = None
    exit_ts_ms = None
    exit_reason = None
    
    from datetime import datetime as dt_class
    
    for candle in candles:
        # Convert timestamp
        ts_val = candle['timestamp']
        if isinstance(ts_val, dt_class):
            ts_ms = int(ts_val.timestamp() * 1000)
        elif isinstance(ts_val, str):
            ts = dt_class.fromisoformat(ts_val.replace('Z', '+00:00'))
            ts_ms = int(ts.timestamp() * 1000)
        elif isinstance(ts_val, (int, float)):
            ts_float = float(ts_val)
            ts_ms = int(ts_float * 1000) if ts_float < 4102444800 else int(ts_float)
        else:
            continue
        
        if ts_ms < entry_ts_ms:
            continue
        
        high = float(candle['high'])
        low = float(candle['low'])
        close = float(candle['close'])
        
        # Check time exit
        hold_time_ms = ts_ms - entry_ts_ms
        if hold_time_ms > max_hold_minutes * 60 * 1000:
            exit_price = close
            exit_ts_ms = ts_ms
            exit_reason = "time_exit"
            break
        
        # Detect milestone hits
        if not hit_2x and high >= target_2x:
            hit_2x = True
            at_2x = True
            stop_anchor = target_2x  # Move stop anchor to 2x
        
        if not hit_3x and high >= target_3x:
            hit_3x = True
        
        if not hit_4x and high >= target_4x:
            hit_4x = True
        
        if not hit_5x and high >= target_5x:
            hit_5x = True
        
        # If we haven't hit 2x yet, no stop logic applies
        if not at_2x:
            continue
        
        # Update stop anchor based on mode
        if stop_mode == "static":
            # Stop stays at 2x
            pass
        elif stop_mode == "trailing":
            # Stop moves with every new high
            if high > stop_anchor:
                stop_anchor = high
        elif stop_mode == "ladder":
            # Stop moves at ladder intervals
            current_anchor = get_ladder_anchor(high, entry_price, ladder_steps)
            if current_anchor > stop_anchor:
                stop_anchor = current_anchor
        
        # Calculate stop level
        stop_level = stop_anchor * (1.0 - stop_pct)
        
        # Check if stopped out (using low of candle)
        if low <= stop_level:
            exit_price = stop_level  # Assume we exit at stop level
            exit_ts_ms = ts_ms
            exit_reason = "stopped_out"
            break
    
    # If we didn't exit, use last candle
    if exit_price is None:
        if candles:
            last_candle = candles[-1]
            ts_val = last_candle['timestamp']
            if isinstance(ts_val, dt_class):
                exit_ts_ms = int(ts_val.timestamp() * 1000)
            elif isinstance(ts_val, str):
                ts = dt_class.fromisoformat(ts_val.replace('Z', '+00:00'))
                exit_ts_ms = int(ts.timestamp() * 1000)
            elif isinstance(ts_val, (int, float)):
                ts_float = float(ts_val)
                exit_ts_ms = int(ts_float * 1000) if ts_float < 4102444800 else int(ts_float)
            exit_price = float(last_candle['close'])
            exit_reason = "end_of_data" if at_2x else "2x_not_hit"
    
    if exit_price is None or exit_ts_ms is None:
        return None
    
    # Calculate performance metrics
    multiple_achieved = exit_price / entry_price
    return_pct = (exit_price - entry_price) / entry_price
    hold_time_minutes = int((exit_ts_ms - entry_ts_ms) / (60 * 1000))
    
    return TradeResult(
        caller="",  # Will be filled by caller
        mint="",
        alert_id=None,
        entry_price=entry_price,
        entry_ts_ms=entry_ts_ms,
        exit_price=exit_price,
        exit_ts_ms=exit_ts_ms,
        exit_reason=exit_reason,
        multiple_achieved=multiple_achieved,
        return_pct=return_pct,
        hold_time_minutes=hold_time_minutes,
        stop_mode=stop_mode,
        stop_pct=stop_pct,
        ladder_steps=ladder_steps if stop_mode == "ladder" else None,
        hit_2x=hit_2x,
        hit_3x=hit_3x,
        hit_4x=hit_4x,
        hit_5x=hit_5x,
    )


def load_candles_from_parquet(
    slice_path: Path,
    mint: str,
    entry_ts_ms: int,
    end_ts_ms: int,
    interval_seconds: int = 300,
) -> List[Dict]:
    """Load candles from parquet slice for a specific mint and time window."""
    import duckdb
    
    global _duckdb_semaphore
    
    # Acquire semaphore to limit concurrent DuckDB connections
    if _duckdb_semaphore is not None:
        _duckdb_semaphore.acquire()
    
    con = None
    try:
        con = duckdb.connect(":memory:")
        # Limit resources per connection to prevent exhaustion
        con.execute("SET temp_directory='/tmp/duckdb_temp'")
        con.execute("SET max_memory='512MB'")
        con.execute("SET threads=1")
        
        # Check if slice is partitioned or single file
        is_partitioned = slice_path.is_dir()
        
        # Import helpers
        sys.path.insert(0, str(Path(__file__).parent / "lib"))
        from helpers import sql_escape
        
        if is_partitioned:
            parquet_glob = f"{slice_path.as_posix()}/**/*.parquet"
            con.execute(f"""
                CREATE TEMP TABLE candles_temp AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{parquet_glob}', hive_partitioning=true)
                WHERE token_address = '{sql_escape(mint)}'
            """)
        else:
            con.execute(f"""
                CREATE TEMP TABLE candles_temp AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{sql_escape(slice_path.as_posix())}')
                WHERE token_address = '{sql_escape(mint)}'
            """)
        
        # Query candles in time window
        # Convert ms to timestamp (DuckDB expects seconds)
        entry_ts_sec = entry_ts_ms / 1000.0
        end_ts_sec = end_ts_ms / 1000.0
        
        rows = con.execute(f"""
            SELECT timestamp, open, high, low, close, volume
            FROM candles_temp
            WHERE timestamp >= to_timestamp({entry_ts_sec})
              AND timestamp < to_timestamp({end_ts_sec})
            ORDER BY timestamp
        """).fetchall()
        
        cols = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
        return [dict(zip(cols, r)) for r in rows]
    except Exception as e:
        # Log error but don't crash the whole process
        print(f"Warning: Failed to load candles for {mint}: {e}", file=sys.stderr)
        return []
    finally:
        if con is not None:
            try:
                con.close()
            except:
                pass
        # Release semaphore
        if _duckdb_semaphore is not None:
            _duckdb_semaphore.release()


def aggregate_strategy_performance(
    trades: List[TradeResult],
    caller: str,
    stop_mode: str,
    stop_pct: float,
    ladder_steps: Optional[float],
) -> StrategyPerformance:
    """Aggregate trade results into strategy performance metrics."""
    if not trades:
        return StrategyPerformance(
            caller=caller,
            stop_mode=stop_mode,
            stop_pct=stop_pct,
            ladder_steps=ladder_steps,
            n_trades=0,
            n_hit_2x=0,
            n_stopped_out=0,
            n_time_exit=0,
            total_return_pct=0.0,
            avg_return_pct=0.0,
            median_return_pct=0.0,
            win_rate=0.0,
            avg_multiple=0.0,
            median_multiple=0.0,
            max_loss_pct=0.0,
            sharpe_ratio=None,
            pct_captured_3x=0.0,
            pct_captured_4x=0.0,
            pct_captured_5x=0.0,
        )
    
    n_trades = len(trades)
    n_hit_2x = sum(1 for t in trades if t.hit_2x)
    n_stopped_out = sum(1 for t in trades if t.exit_reason == "stopped_out")
    n_time_exit = sum(1 for t in trades if t.exit_reason == "time_exit")
    
    returns = [t.return_pct for t in trades]
    multiples = [t.multiple_achieved for t in trades]
    
    total_return_pct = sum(returns) * 100.0
    avg_return_pct = np.mean(returns) * 100.0
    median_return_pct = np.median(returns) * 100.0
    
    win_rate = sum(1 for r in returns if r > 0) / n_trades * 100.0
    
    avg_multiple = np.mean(multiples)
    median_multiple = np.median(multiples)
    
    max_loss_pct = min(returns) * 100.0
    
    # Sharpe ratio (assuming 0% risk-free rate)
    if len(returns) > 1:
        sharpe_ratio = np.mean(returns) / np.std(returns) if np.std(returns) > 0 else None
    else:
        sharpe_ratio = None
    
    # Capture rates
    n_hit_3x_total = sum(1 for t in trades if t.hit_3x)
    n_hit_4x_total = sum(1 for t in trades if t.hit_4x)
    n_hit_5x_total = sum(1 for t in trades if t.hit_5x)
    
    # Count how many we captured (exited at or above milestone)
    n_captured_3x = sum(1 for t in trades if t.hit_3x and t.multiple_achieved >= 3.0)
    n_captured_4x = sum(1 for t in trades if t.hit_4x and t.multiple_achieved >= 4.0)
    n_captured_5x = sum(1 for t in trades if t.hit_5x and t.multiple_achieved >= 5.0)
    
    pct_captured_3x = (n_captured_3x / n_hit_3x_total * 100.0) if n_hit_3x_total > 0 else 0.0
    pct_captured_4x = (n_captured_4x / n_hit_4x_total * 100.0) if n_hit_4x_total > 0 else 0.0
    pct_captured_5x = (n_captured_5x / n_hit_5x_total * 100.0) if n_hit_5x_total > 0 else 0.0
    
    return StrategyPerformance(
        caller=caller,
        stop_mode=stop_mode,
        stop_pct=stop_pct,
        ladder_steps=ladder_steps,
        n_trades=n_trades,
        n_hit_2x=n_hit_2x,
        n_stopped_out=n_stopped_out,
        n_time_exit=n_time_exit,
        total_return_pct=total_return_pct,
        avg_return_pct=avg_return_pct,
        median_return_pct=median_return_pct,
        win_rate=win_rate,
        avg_multiple=avg_multiple,
        median_multiple=median_multiple,
        max_loss_pct=max_loss_pct,
        sharpe_ratio=sharpe_ratio,
        pct_captured_3x=pct_captured_3x,
        pct_captured_4x=pct_captured_4x,
        pct_captured_5x=pct_captured_5x,
    )


def print_performance_table(performances: List[StrategyPerformance], args):
    """Print formatted performance comparison table."""
    if not performances:
        print("No performance data to display.")
        return
    
    # Group by caller
    by_caller: Dict[str, List[StrategyPerformance]] = defaultdict(list)
    for perf in performances:
        by_caller[perf.caller].append(perf)
    
    for caller, perfs in sorted(by_caller.items()):
        print("\n" + "=" * 160)
        print(f"CALLER: {caller}")
        print("=" * 160)
        
        # Sort by avg return descending
        perfs_sorted = sorted(perfs, key=lambda p: p.avg_return_pct, reverse=True)
        
        print(f"\n{'Mode':<10} {'Stop%':>6} {'Steps':>6} {'Trades':>7} {'Hit2x':>6} {'StopOut':>8} ", end="")
        print(f"{'AvgRet%':>8} {'MedRet%':>8} {'WinRate%':>9} {'AvgMult':>8} {'MaxLoss%':>9} ", end="")
        print(f"{'Sharpe':>7} {'Cap3x%':>7} {'Cap4x%':>7} {'Cap5x%':>7}")
        print("-" * 160)
        
        for perf in perfs_sorted:
            steps_str = f"{perf.ladder_steps:.1f}" if perf.ladder_steps is not None else "N/A"
            sharpe_str = f"{perf.sharpe_ratio:.2f}" if perf.sharpe_ratio is not None else "N/A"
            
            print(f"{perf.stop_mode:<10} {perf.stop_pct*100:>5.0f}% {steps_str:>6} {perf.n_trades:>7} ", end="")
            print(f"{perf.n_hit_2x:>6} {perf.n_stopped_out:>8} ", end="")
            print(f"{perf.avg_return_pct:>7.1f}% {perf.median_return_pct:>7.1f}% {perf.win_rate:>8.1f}% ", end="")
            print(f"{perf.avg_multiple:>7.2f}x {perf.max_loss_pct:>8.1f}% ", end="")
            print(f"{sharpe_str:>7} {perf.pct_captured_3x:>6.1f}% {perf.pct_captured_4x:>6.1f}% {perf.pct_captured_5x:>6.1f}%")
    
    print("\n" + "=" * 160)
    print("\nInterpretation:")
    print("- AvgRet%: Average return per trade (higher is better)")
    print("- WinRate%: Percentage of profitable trades")
    print("- AvgMult: Average exit multiple (e.g., 2.5x = exited at 2.5× entry)")
    print("- Sharpe: Risk-adjusted return (higher is better)")
    print("- Cap3x/4x/5x%: % of tokens that hit milestone and we captured (exited at/above milestone)")
    print("\nOptimal Strategy: Highest AvgRet% with acceptable Sharpe and capture rates")


def main():
    parser = argparse.ArgumentParser(
        description="Simulate post-2x trailing stop strategies and calculate P&L"
    )
    parser.add_argument(
        "--duckdb",
        type=Path,
        required=True,
        help="Path to DuckDB alerts database",
    )
    parser.add_argument(
        "--slice",
        type=Path,
        required=True,
        help="Path to parquet candle slice directory",
    )
    parser.add_argument(
        "--chain",
        type=str,
        default="solana",
        help="Chain name (default: solana)",
    )
    parser.add_argument(
        "--date-from",
        type=str,
        help="Start date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--date-to",
        type=str,
        help="End date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--min-calls",
        type=int,
        default=10,
        help="Minimum calls per caller to include (default: 10)",
    )
    parser.add_argument(
        "--post-window-minutes",
        type=int,
        default=1440,
        help="Post-alert window in minutes (default: 1440 = 24h)",
    )
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=300,
        help="Candle interval in seconds (default: 300 = 5m)",
    )
    parser.add_argument(
        "--stop-modes",
        type=str,
        nargs="+",
        default=["static", "trailing", "ladder"],
        help="Stop modes to test (default: all)",
    )
    parser.add_argument(
        "--stop-pcts",
        type=float,
        nargs="+",
        default=[0.10, 0.15, 0.20, 0.25, 0.30],
        help="Stop percentages to test (default: 10%%, 15%%, 20%%, 25%%, 30%%)",
    )
    parser.add_argument(
        "--ladder-steps",
        type=float,
        nargs="+",
        default=[0.5, 1.0],
        help="Ladder step sizes to test (default: 0.5, 1.0)",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=4,
        help="Number of parallel threads (default: 4)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print progress",
    )
    parser.add_argument(
        "--output",
        type=str,
        choices=["table", "json"],
        default="table",
        help="Output format (default: table)",
    )
    
    args = parser.parse_args()
    
    # Initialize global semaphore
    global _duckdb_semaphore
    _duckdb_semaphore = Semaphore(min(4, args.threads))
    
    # Load alerts
    from datetime import datetime
    
    if args.verbose:
        print(f"Loading alerts from {args.duckdb}...", file=sys.stderr)
    
    # Import alerts loader
    sys.path.insert(0, str(Path(__file__).parent / "lib"))
    from alerts import load_alerts
    
    date_from = datetime.fromisoformat(args.date_from) if args.date_from else None
    date_to = datetime.fromisoformat(args.date_to) if args.date_to else None
    
    alerts = load_alerts(
        str(args.duckdb),
        chain=args.chain,
        date_from=date_from,
        date_to=date_to,
    )
    
    if args.verbose:
        print(f"Loaded {len(alerts)} alerts", file=sys.stderr)
    
    # Import helpers
    from helpers import ceil_ms_to_interval_ts_ms
    
    # Calculate horizon
    horizon_ms = args.post_window_minutes * 60 * 1000
    
    # Simulate all strategies
    all_trades: List[TradeResult] = []
    
    # Generate strategy combinations
    strategies = []
    for stop_mode in args.stop_modes:
        for stop_pct in args.stop_pcts:
            if stop_mode == "ladder":
                for ladder_step in args.ladder_steps:
                    strategies.append((stop_mode, stop_pct, ladder_step))
            else:
                strategies.append((stop_mode, stop_pct, None))
    
    if args.verbose:
        print(f"Testing {len(strategies)} strategy combinations on {len(alerts)} alerts...", file=sys.stderr)
    
    # Process each alert with each strategy
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    def process_alert_strategy(item):
        """Process a single alert with a single strategy."""
        try:
            alert, (stop_mode, stop_pct, ladder_steps) = item
            
            # Calculate entry and end timestamps
            entry_ts_ms = ceil_ms_to_interval_ts_ms(alert.ts_ms, args.interval_seconds)
            end_ts_ms = entry_ts_ms + horizon_ms
            
            # Load candles
            try:
                candles = load_candles_from_parquet(
                    args.slice,
                    alert.mint,
                    entry_ts_ms,
                    end_ts_ms,
                    args.interval_seconds,
                )
            except Exception as e:
                if args.verbose:
                    print(f"Warning: Failed to load candles for {alert.mint}: {e}", file=sys.stderr)
                return None
            
            if not candles:
                return None
            
            # Find entry price
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
                return None
            
            # Simulate trade
            trade = simulate_trade(
                candles,
                entry_price,
                entry_ts_ms,
                stop_mode,
                stop_pct,
                ladder_steps if stop_mode == "ladder" else 1.0,
                args.post_window_minutes,
            )
            
            if trade:
                trade.caller = alert.caller
                trade.mint = alert.mint
                trade.alert_id = None  # Alert doesn't have id attribute
            
            return trade
        except KeyboardInterrupt:
            raise
        except Exception as e:
            if args.verbose:
                print(f"Error in process_alert_strategy: {e}", file=sys.stderr)
            return None
    
    # Create all (alert, strategy) combinations
    tasks = [(alert, strategy) for alert in alerts for strategy in strategies]
    
    with ThreadPoolExecutor(max_workers=args.threads) as executor:
        futures = {executor.submit(process_alert_strategy, task): i for i, task in enumerate(tasks)}
        
        completed = 0
        for future in as_completed(futures):
            completed += 1
            if args.verbose and completed % 1000 == 0:
                print(f"Processed {completed}/{len(tasks)} simulations...", file=sys.stderr)
            
            try:
                trade = future.result(timeout=30)
                if trade is not None:
                    all_trades.append(trade)
            except Exception as e:
                if args.verbose:
                    print(f"Warning: Simulation failed: {e}", file=sys.stderr)
    
    if args.verbose:
        print(f"Completed {len(all_trades)} successful trades", file=sys.stderr)
    
    # Aggregate by caller and strategy
    performances: List[StrategyPerformance] = []
    
    # Group trades by (caller, stop_mode, stop_pct, ladder_steps)
    trade_groups: Dict[Tuple, List[TradeResult]] = defaultdict(list)
    for trade in all_trades:
        key = (trade.caller, trade.stop_mode, trade.stop_pct, trade.ladder_steps)
        trade_groups[key].append(trade)
    
    # Filter by min_calls and aggregate
    for (caller, stop_mode, stop_pct, ladder_steps), trades in trade_groups.items():
        # Count unique alerts for this caller
        caller_alerts = [a for a in alerts if a.caller == caller]
        if len(caller_alerts) < args.min_calls:
            continue
        
        perf = aggregate_strategy_performance(trades, caller, stop_mode, stop_pct, ladder_steps)
        performances.append(perf)
    
    # Output results
    if args.output == "json":
        output = []
        for perf in performances:
            output.append({
                "caller": perf.caller,
                "stop_mode": perf.stop_mode,
                "stop_pct": perf.stop_pct,
                "ladder_steps": perf.ladder_steps,
                "n_trades": perf.n_trades,
                "n_hit_2x": perf.n_hit_2x,
                "avg_return_pct": perf.avg_return_pct,
                "median_return_pct": perf.median_return_pct,
                "win_rate": perf.win_rate,
                "avg_multiple": perf.avg_multiple,
                "sharpe_ratio": perf.sharpe_ratio,
                "pct_captured_3x": perf.pct_captured_3x,
                "pct_captured_4x": perf.pct_captured_4x,
                "pct_captured_5x": perf.pct_captured_5x,
            })
        print(json.dumps(output, indent=2))
    else:
        print_performance_table(performances, args)


if __name__ == "__main__":
    main()

