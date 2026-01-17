#!/usr/bin/env python2
"""
Wash-and-Rebound Strategy Simulator

Implements a 3-state machine:
- IN_POSITION: Track peak, exit on 20% trailing stop from peak
- WAIT_FOR_WASH: Wait for 50% drop from peak_at_exit
- WAIT_FOR_REBOUND: Wait for 20% rebound from wash_low, then re-enter

Deterministic 1m execution:
- Exit fill = peak * 0.80 (stop price)
- Re-entry fill = wash_low * 1.20 (trigger price)
- Wick-aware (uses candle.high and candle.low)
- Avoids same-candle paradoxes
- Optional cooldown after exit
- Max reentries per token

Usage:
    python3 wash_rebound_simulator.py --duckdb data/alerts.duckdb --slice slices/per_token --chain solana
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import hashlib

# Add project root to path
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root))

import duckdb


@dataclass(frozen=True)
class Alert:
    """An alert representing a token call at a specific time."""
    mint: str
    ts_ms: int
    caller: str


def duckdb_table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    """Check if a table exists in the DuckDB database."""
    q = """
    SELECT COUNT(*)::INT
    FROM information_schema.tables
    WHERE table_name = ?
    """
    result = conn.execute(q, [table_name]).fetchone()
    return result[0] > 0 if result else False


@dataclass
class WashReboundTradeResult:
    """Result of a simulated trade with wash-and-rebound strategy."""
    caller: str
    mint: str
    alert_id: Optional[int]
    
    # Entry
    entry_price: float
    entry_ts_ms: int
    
    # Exit
    exit_price: float
    exit_ts_ms: int
    exit_reason: str  # "trailing_stop", "end_of_data"
    
    # Performance
    return_pct: float
    hold_time_minutes: int
    peak_mult: float  # Highest multiple achieved (peak_price / entry_price)
    exit_mult: float  # Final exit multiple (exit_price / entry_price)
    giveback_from_peak_pct: float  # (peak_mult - exit_mult) / peak_mult * 100
    
    # Strategy details
    trail_pct: float  # Trailing stop percentage
    wash_pct: float  # Wash threshold percentage
    rebound_pct: float  # Rebound threshold percentage
    max_reentries: int
    cooldown_candles: int
    actual_reentries: int  # Number of re-entries that occurred
    
    # Milestones
    hit_2x: bool
    hit_3x: bool
    hit_4x: bool
    hit_5x: bool
    hit_10x: bool


def simulate_wash_rebound_trade(
    candles: List[Dict],
    entry_price: float,
    entry_ts_ms: int,
    trail_pct: float = 0.20,
    wash_pct: float = 0.50,
    rebound_pct: float = 0.20,
    max_reentries: int = 3,
    cooldown_candles: int = 1,
) -> Tuple[float, int, str, float, float, int, bool, bool, bool, bool, bool]:
    """
    Simulate a trade with wash-and-rebound strategy.
    
    Returns:
        (exit_price, exit_ts_ms, exit_reason, peak_mult, exit_mult, actual_reentries,
         hit_2x, hit_3x, hit_4x, hit_5x, hit_10x)
    """
    if not candles:
        return (entry_price, entry_ts_ms, "end_of_data", 1.0, 1.0, 0, False, False, False, False, False)
    
    # State machine states
    IN_POSITION = 'IN_POSITION'
    WAIT_FOR_WASH = 'WAIT_FOR_WASH'
    WAIT_FOR_REBOUND = 'WAIT_FOR_REBOUND'
    
    state = IN_POSITION
    peak = entry_price
    peak_at_exit: Optional[float] = None
    wash_low: Optional[float] = None
    wash_low_candle_idx: Optional[int] = None  # Track which candle established wash_low
    
    # Trade tracking
    reentry_count = 0
    current_entry_px = entry_price
    cooldown_until_idx: Optional[int] = None
    
    # Aggregate metrics
    cumulative_multiplier = 1.0
    overall_peak_high = entry_price
    last_exit_px = entry_price
    last_exit_ts_ms = entry_ts_ms
    exit_reason = 'end_of_data'
    
    # Milestone tracking
    hit_2x = False
    hit_3x = False
    hit_4x = False
    hit_5x = False
    hit_10x = False
    
    target_2x = entry_price * 2.0
    target_3x = entry_price * 3.0
    target_4x = entry_price * 4.0
    target_5x = entry_price * 5.0
    target_10x = entry_price * 10.0
    
    from datetime import datetime as dt_class
    
    for i, candle in enumerate(candles):
        # Parse timestamp
        ts_val = candle['timestamp']
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
        
        # Track overall peak
        if high > overall_peak_high:
            overall_peak_high = high
        
        # Check milestones
        if not hit_2x and high >= target_2x:
            hit_2x = True
        if not hit_3x and high >= target_3x:
            hit_3x = True
        if not hit_4x and high >= target_4x:
            hit_4x = True
        if not hit_5x and high >= target_5x:
            hit_5x = True
        if not hit_10x and high >= target_10x:
            hit_10x = True
        
        if state == IN_POSITION:
            # Update peak since entry
            if high > peak:
                peak = high
            
            # Check trailing stop exit: if candle.low <= peak * (1 - trail_pct)
            trailing_stop_price = peak * (1 - trail_pct)
            if low <= trailing_stop_price:
                # Exit at stop price (deterministic fill)
                exit_px = trailing_stop_price
                # Compound return: multiply by (1 + return) for this trade
                trade_return = exit_px / current_entry_px
                cumulative_multiplier *= trade_return
                last_exit_px = exit_px
                last_exit_ts_ms = ts_ms
                exit_reason = 'trailing_stop'
                
                # Record peak_at_exit and transition to WAIT_FOR_WASH
                peak_at_exit = peak
                state = WAIT_FOR_WASH
                wash_low = None
                wash_low_candle_idx = None
                cooldown_until_idx = i + cooldown_candles
                
                # Check if we can re-enter (haven't hit max reentries)
                if reentry_count >= max_reentries:
                    # No more re-entries allowed, we're done
                    break
                continue
        
        elif state == WAIT_FOR_WASH:
            # Check if cooldown is still active
            if cooldown_until_idx is not None and i < cooldown_until_idx:
                continue
            
            # Wash condition: if candle.low <= peak_at_exit * (1 - wash_pct)
            if peak_at_exit is not None:
                wash_threshold = peak_at_exit * (1 - wash_pct)
                if low <= wash_threshold:
                    # Wash triggered - set wash_low and transition to WAIT_FOR_REBOUND
                    wash_low = low
                    wash_low_candle_idx = i
                    state = WAIT_FOR_REBOUND
                    continue
        
        elif state == WAIT_FOR_REBOUND:
            # Update wash_low if price dips further
            if wash_low is not None and low < wash_low:
                wash_low = low
                wash_low_candle_idx = i
            
            # Re-entry rule: if candle.high >= wash_low * (1 + rebound_pct)
            # BUT: avoid same-candle rebound (must be after the candle that established wash_low)
            if wash_low is not None and wash_low_candle_idx is not None and i > wash_low_candle_idx:
                rebound_threshold = wash_low * (1 + rebound_pct)
                if high >= rebound_threshold:
                    # Re-enter at trigger price (deterministic fill)
                    reentry_px = rebound_threshold
                    current_entry_px = reentry_px
                    reentry_count += 1
                    
                    # Reset state for new position
                    state = IN_POSITION
                    peak = max(reentry_px, high)  # Start tracking peak from re-entry
                    peak_at_exit = None
                    wash_low = None
                    wash_low_candle_idx = None
                    cooldown_until_idx = None
                    continue
    
    # If still in position at end, close at last candle
    if state == IN_POSITION:
        last_candle = candles[-1]
        exit_px = float(last_candle['close'])
        # Compound return for final trade
        trade_return = exit_px / current_entry_px
        cumulative_multiplier *= trade_return
        last_exit_px = exit_px
        
        ts_val = last_candle['timestamp']
        if isinstance(ts_val, dt_class):
            exit_ts_ms = int(ts_val.timestamp() * 1000)
        elif isinstance(ts_val, str):
            ts = dt_class.fromisoformat(ts_val.replace('Z', '+00:00'))
            exit_ts_ms = int(ts.timestamp() * 1000)
        else:
            exit_ts_ms = int(float(ts_val) * 1000 if float(ts_val) < 4102444800 else float(ts_val))
        
        exit_reason = 'end_of_data'
    else:
        # Already exited via trailing stop (last_exit_px and last_exit_ts_ms are set)
        exit_px = last_exit_px
        exit_ts_ms = last_exit_ts_ms
    
    # Calculate final metrics
    peak_mult = overall_peak_high / entry_price
    exit_mult = exit_px / entry_price  # Use actual exit price, not cumulative multiplier
    giveback_from_peak_pct = ((peak_mult - exit_mult) / peak_mult * 100.0) if peak_mult > 0 else 0.0
    
    return (exit_px, exit_ts_ms, exit_reason, peak_mult, exit_mult, reentry_count,
            hit_2x, hit_3x, hit_4x, hit_5x, hit_10x)


def catalog_run_in_duckdb(
    duckdb_path: Path,
    output_file: Path,
    trade_count: int,
    args: argparse.Namespace,
    trades: List[WashReboundTradeResult],
):
    """Catalog this run in DuckDB simulation_runs table."""
    from datetime import datetime
    
    # Generate run_id from parameters
    params_str = f"{args.chain}_{args.date_from}_{args.date_to}_{args.trail_pct}_{args.wash_pct}_{args.rebound_pct}"
    run_id = f"wash_rebound_{hashlib.sha256(params_str.encode()).hexdigest()[:12]}"
    
    # Calculate aggregate metrics
    if trades:
        total_return_pct = sum(t.return_pct for t in trades) / len(trades) if trades else 0.0
        avg_return_pct = np.mean([t.return_pct for t in trades])
        win_rate = sum(1 for t in trades if t.return_pct > 0) / len(trades) if trades else 0.0
        max_loss = min(t.return_pct for t in trades) if trades else 0.0
        max_gain = max(t.return_pct for t in trades) if trades else 0.0
    else:
        total_return_pct = 0.0
        avg_return_pct = 0.0
        win_rate = 0.0
        max_loss = 0.0
        max_gain = 0.0
    
    # Connect to DuckDB (use the alerts database)
    conn = duckdb.connect(str(duckdb_path))
    
    try:
        # Create simulation_runs table if it doesn't exist
        conn.execute("""
            CREATE TABLE IF NOT EXISTS simulation_runs (
                run_id TEXT PRIMARY KEY,
                strategy_id TEXT,
                strategy_type TEXT,
                caller_name TEXT,
                total_return_pct REAL,
                avg_return_pct REAL,
                max_drawdown_pct REAL,
                max_gain_pct REAL,
                sharpe_ratio REAL,
                win_rate REAL,
                total_trades INTEGER,
                created_at TIMESTAMP,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                output_file TEXT,
                parameters JSON
            )
        """)
        
        # Prepare run metadata
        now = datetime.now()
        created_at = now.isoformat()
        start_time = datetime.fromisoformat(args.date_from).isoformat() if args.date_from else None
        end_time = datetime.fromisoformat(args.date_to).isoformat() if args.date_to else None
        
        parameters_json = json.dumps({
            'trail_pct': args.trail_pct,
            'wash_pct': args.wash_pct,
            'rebound_pct': args.rebound_pct,
            'max_reentries': args.max_reentries,
            'cooldown_candles': args.cooldown_candles,
            'chain': args.chain,
            'min_calls': args.min_calls,
        })
        
        # Insert or replace run record
        conn.execute("""
            INSERT OR REPLACE INTO simulation_runs
            (run_id, strategy_id, strategy_type, caller_name, total_return_pct, avg_return_pct,
             max_drawdown_pct, max_gain_pct, sharpe_ratio, win_rate, total_trades,
             created_at, start_time, end_time, output_file, parameters)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            run_id,
            'wash_rebound',  # strategy_id
            'wash_rebound',  # strategy_type
            None,  # caller_name (aggregate across all callers)
            total_return_pct,
            avg_return_pct,
            max_loss,  # max_drawdown_pct
            max_gain,  # max_gain_pct
            None,  # sharpe_ratio (not calculated)
            win_rate,
            trade_count,
            created_at,
            start_time,
            end_time,
            str(output_file),
            parameters_json,
        ])
    finally:
        conn.close()


def generate_run_id(args: argparse.Namespace) -> str:
    """Generate a unique run ID based on parameters."""
    params = f"{args.chain}_{args.date_from}_{args.date_to}_{args.trail_pct}_{args.wash_pct}_{args.rebound_pct}_{args.max_reentries}_{args.cooldown_candles}"
    return hashlib.sha256(params.encode()).hexdigest()[:16]


def load_existing_results(run_id: str, output_dir: Path) -> set:
    """Load already processed mints from existing parquet file."""
    output_file = output_dir / f"wash_rebound_results_{run_id}.parquet"
    
    if not output_file.exists():
        return set()
    
    try:
        table = pq.read_table(output_file, columns=['mint'])
        df = table.to_pandas()
        
        # Create set of processed mints
        processed = set(df['mint'].unique().tolist())
        return processed
    except Exception as e:
        print(f"Warning: Could not load existing results: {e}", file=sys.stderr)
        return set()


def append_trades_to_parquet(trades: List[WashReboundTradeResult], run_id: str, output_dir: Path):
    """Append new trades to existing parquet file."""
    if not trades:
        return
    
    output_file = output_dir / f"wash_rebound_results_{run_id}.parquet"
    
    # Convert trades to records
    records = []
    for trade in trades:
        records.append({
            'caller': trade.caller,
            'mint': trade.mint,
            'alert_id': trade.alert_id if trade.alert_id else 0,
            'entry_price': trade.entry_price,
            'entry_ts_ms': trade.entry_ts_ms,
            'exit_price': trade.exit_price,
            'exit_ts_ms': trade.exit_ts_ms,
            'exit_reason': trade.exit_reason,
            'return_pct': trade.return_pct,
            'hold_time_minutes': trade.hold_time_minutes,
            'peak_mult': trade.peak_mult,
            'exit_mult': trade.exit_mult,
            'giveback_from_peak_pct': trade.giveback_from_peak_pct,
            'trail_pct': trade.trail_pct,
            'wash_pct': trade.wash_pct,
            'rebound_pct': trade.rebound_pct,
            'max_reentries': trade.max_reentries,
            'cooldown_candles': trade.cooldown_candles,
            'actual_reentries': trade.actual_reentries,
            'hit_2x': trade.hit_2x,
            'hit_3x': trade.hit_3x,
            'hit_4x': trade.hit_4x,
            'hit_5x': trade.hit_5x,
            'hit_10x': trade.hit_10x,
        })
    
    # Create new table
    new_table = pa.Table.from_pylist(records)
    
    # If file exists, read and concatenate
    if output_file.exists():
        existing_table = pq.read_table(output_file)
        combined_table = pa.concat_tables([existing_table, new_table])
    else:
        combined_table = new_table
    
    # Write combined table
    pq.write_table(combined_table, output_file, compression='snappy')


def load_candles_from_parquet(
    slice_path: Path,
    mint: str,
    entry_ts_ms: int,
    end_ts_ms: int,
    interval_seconds: int = 60,  # 1m candles
) -> List[Dict]:
    """Load candles from parquet slice."""
    import duckdb
    
    con = None
    try:
        con = duckdb.connect(":memory:")
        con.execute("SET temp_directory='/tmp/duckdb_temp'")
        con.execute("SET max_memory='512MB'")
        con.execute("SET threads=1")
        
        # Check if slice path exists
        if not slice_path.exists():
            return []
        
        is_partitioned = slice_path.is_dir()
        
        if is_partitioned:
            parquet_glob = f"{slice_path.as_posix()}/**/*.parquet"
            try:
                con.execute(f"""
                    CREATE TEMP TABLE candles_temp AS
                    SELECT token_address, timestamp, open, high, low, close, volume
                    FROM parquet_scan('{parquet_glob}', hive_partitioning=true)
                    WHERE token_address = '{mint}'
                """)
            except Exception as e:
                # If parquet_scan fails, return empty list
                return []
        else:
            try:
                con.execute(f"""
                    CREATE TEMP TABLE candles_temp AS
                    SELECT token_address, timestamp, open, high, low, close, volume
                    FROM parquet_scan('{slice_path.as_posix()}')
                    WHERE token_address = '{mint}'
                """)
            except Exception as e:
                # If parquet_scan fails, return empty list
                return []
        
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


def load_alerts_from_duckdb(
    duckdb_path: Path,
    chain: str,
    date_from: Optional[str],
    date_to: Optional[str],
) -> List[Dict]:
    """Load alerts from DuckDB directly."""
    from datetime import datetime, timedelta
    
    # Convert string dates to datetime
    dt_from = datetime.fromisoformat(date_from) if date_from else datetime(2020, 1, 1)
    dt_to = datetime.fromisoformat(date_to) if date_to else datetime.now()
    
    conn = duckdb.connect(str(duckdb_path), read_only=True)
    from_ms = int(dt_from.timestamp() * 1000)
    to_ms_excl = int((dt_to + timedelta(days=1)).timestamp() * 1000)
    
    # Try canon.alerts_final first (has mint, chain, caller_name, alert_ts_ms)
    # Check if canon schema exists and has alerts_final table
    has_alerts_final = False
    try:
        conn.execute("SELECT 1 FROM canon.alerts_final LIMIT 1").fetchone()
        has_alerts_final = True
    except:
        pass
    
    has_caller_links = duckdb_table_exists(conn, "caller_links_d")
    has_user_calls = duckdb_table_exists(conn, "user_calls_d")
    
    if not has_alerts_final and not has_caller_links and not has_user_calls:
        conn.close()
        raise SystemExit(f"No alerts source found in DuckDB: {duckdb_path}")
    
    alerts: List[Alert] = []
    
    # Try canon.alerts_final first (preferred - has all alerts)
    if has_alerts_final:
        sql = """
        SELECT DISTINCT
          mint::TEXT AS mint,
          alert_ts_ms::BIGINT AS ts_ms,
          COALESCE(caller_name, '')::TEXT AS caller
        FROM canon.alerts_final
        WHERE mint IS NOT NULL
          AND alert_ts_ms >= ?
          AND alert_ts_ms < ?
          AND lower(chain) = lower(?)
        """
        params = [from_ms, to_ms_excl, chain]
        
        for mint, ts_ms, caller in conn.execute(sql, params).fetchall():
            if mint:
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=(caller or "").strip()))
    
    # Fallback to caller_links_d
    if (not alerts) and has_caller_links:
        cols = [r[1].lower() for r in conn.execute("PRAGMA table_info('caller_links_d')").fetchall()]
        has_chain = "chain" in cols
        has_caller_name = "caller_name" in cols
        has_trigger_from_name = "trigger_from_name" in cols
        
        if has_caller_name and has_trigger_from_name:
            caller_expr = "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller"
        elif has_caller_name:
            caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
        elif has_trigger_from_name:
            caller_expr = "COALESCE(trigger_from_name, '')::TEXT AS caller"
        else:
            caller_expr = "''::TEXT AS caller"
        
        sql = f"""
        SELECT DISTINCT
          mint::TEXT AS mint,
          trigger_ts_ms::BIGINT AS ts_ms,
          {caller_expr}
        FROM caller_links_d
        WHERE mint IS NOT NULL
          AND trigger_ts_ms >= ?
          AND trigger_ts_ms <  ?
        """
        params = [from_ms, to_ms_excl]
        if has_chain:
            sql += " AND lower(chain) = lower(?)"
            params.append(chain)
        
        for mint, ts_ms, caller in conn.execute(sql, params).fetchall():
            if mint:
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=(caller or "").strip()))
    
    # Fallback to user_calls_d (if canon.alerts_final and caller_links_d both failed)
    if (not alerts) and has_user_calls:
        cols = [r[1].lower() for r in conn.execute("PRAGMA table_info('user_calls_d')").fetchall()]
        has_chain = "chain" in cols
        ts_col = "call_ts_ms" if "call_ts_ms" in cols else ("trigger_ts_ms" if "trigger_ts_ms" in cols else None)
        if ts_col is None:
            conn.close()
            raise SystemExit(f"No timestamp column found in user_calls_d: {cols}")
        
        has_caller_name = "caller_name" in cols
        has_trigger_from_name = "trigger_from_name" in cols
        
        if has_caller_name and has_trigger_from_name:
            caller_expr = "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller"
        elif has_caller_name:
            caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
        elif has_trigger_from_name:
            caller_expr = "COALESCE(trigger_from_name, '')::TEXT AS caller"
        else:
            caller_expr = "''::TEXT AS caller"
        
        sql = f"""
        SELECT DISTINCT
          mint::TEXT AS mint,
          {ts_col}::BIGINT AS ts_ms,
          {caller_expr}
        FROM user_calls_d
        WHERE mint IS NOT NULL
          AND {ts_col} >= ?
          AND {ts_col} <  ?
        """
        params = [from_ms, to_ms_excl]
        if has_chain:
            sql += " AND lower(chain) = lower(?)"
            params.append(chain)
        
        for mint, ts_ms, caller in conn.execute(sql, params).fetchall():
            if mint:
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=(caller or "").strip()))
    
    conn.close()
    alerts.sort(key=lambda a: (a.ts_ms, a.mint))
    
    # Convert to dict format
    result = []
    for alert in alerts:
        result.append({
            'id': None,
            'caller': alert.caller,
            'mint': alert.mint,
            'timestamp_ms': alert.ts_ms,
            'entry_price': None,  # Will be filled from first candle
        })
    
    return result


def main():
    parser = argparse.ArgumentParser(description="Wash-and-rebound strategy simulator")
    parser.add_argument("--duckdb", type=str, required=True, help="Path to alerts DuckDB")
    parser.add_argument("--slice", type=str, required=True, help="Path to candle slice directory")
    parser.add_argument("--chain", type=str, default="solana", help="Chain name")
    parser.add_argument("--date-from", type=str, help="Start date (ISO 8601)")
    parser.add_argument("--date-to", type=str, help="End date (ISO 8601)")
    parser.add_argument("--min-calls", type=int, default=10, help="Minimum calls per caller")
    parser.add_argument("--trail-pct", type=float, default=0.20, help="Trailing stop percentage (default: 0.20 = 20%%)")
    parser.add_argument("--wash-pct", type=float, default=0.50, help="Wash threshold percentage (default: 0.50 = 50%%)")
    parser.add_argument("--rebound-pct", type=float, default=0.20, help="Rebound threshold percentage (default: 0.20 = 20%%)")
    parser.add_argument("--max-reentries", type=int, default=3, help="Maximum re-entries per token (default: 3)")
    parser.add_argument("--cooldown-candles", type=int, default=1, help="Cooldown candles after exit (default: 1)")
    parser.add_argument("--output-dir", type=str, default="output/wash_rebound_results", help="Output directory for parquet files")
    parser.add_argument("--resume", action="store_true", help="Resume interrupted run (skip already-processed mints)")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    # Generate run ID for this configuration
    run_id = generate_run_id(args)
    
    # Validate paths
    duckdb_path = Path(args.duckdb)
    if not duckdb_path.exists():
        print(f"Error: DuckDB file not found: {duckdb_path}", file=sys.stderr)
        sys.exit(1)
    
    slice_path = Path(args.slice)
    if not slice_path.exists():
        print(f"Error: Slice directory not found: {slice_path}", file=sys.stderr)
        sys.exit(1)
    
    # Load alerts
    print(f"Loading alerts from {args.duckdb}...", file=sys.stderr)
    sys.stderr.flush()
    
    alerts = load_alerts_from_duckdb(
        Path(args.duckdb),
        args.chain,
        args.date_from,
        args.date_to,
    )
    
    print(f"Loaded {len(alerts)} alerts", file=sys.stderr)
    sys.stderr.flush()
    
    if not alerts:
        print("No alerts found. Exiting.", file=sys.stderr)
        return
    
    # Check for existing results if resuming
    processed_mints = set()
    existing_trades = []
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if args.resume:
        processed_mints = load_existing_results(run_id, output_dir)
        if processed_mints:
            print(f"Resuming run {run_id}: Found {len(processed_mints)} already-processed mints", file=sys.stderr)
            # Load existing trades for summary
            output_file = output_dir / f"wash_rebound_results_{run_id}.parquet"
            if output_file.exists():
                try:
                    table = pq.read_table(output_file)
                    existing_trades = table.to_pandas().to_dict('records')
                    print(f"Loaded {len(existing_trades)} existing trades", file=sys.stderr)
                except Exception as e:
                    print(f"Warning: Could not load existing trades: {e}", file=sys.stderr)
        else:
            print(f"No existing results found for run {run_id}. Starting fresh.", file=sys.stderr)
    else:
        print(f"Starting new run {run_id}", file=sys.stderr)
    
    sys.stderr.flush()
    
    # Simulate trades
    new_trades = []
    
    # Filter out already-processed mints if resuming
    alerts_to_process = [a for a in alerts if a['mint'] not in processed_mints] if args.resume else alerts
    
    print(f"Processing {len(alerts_to_process)} alerts...", file=sys.stderr)
    if args.resume and len(processed_mints) > 0:
        print(f"  (Skipping {len(alerts) - len(alerts_to_process)} already-processed mints)", file=sys.stderr)
    sys.stderr.flush()
    
    for i, alert in enumerate(alerts_to_process):
        if (i + 1) % 100 == 0:
            print(f"  Processed {i + 1}/{len(alerts_to_process)} alerts...", file=sys.stderr)
            sys.stderr.flush()
        try:
            entry_ts_ms = alert['timestamp_ms']
            end_ts_ms = entry_ts_ms + (7 * 24 * 60 * 60 * 1000)  # 7 days
            mint = alert['mint']
            
            # Load candles
            try:
                candles = load_candles_from_parquet(
                    slice_path,
                    mint,
                    entry_ts_ms,
                    end_ts_ms,
                )
            except Exception as e:
                if args.verbose:
                    print(f"Warning: Error loading candles for {mint}: {e}", file=sys.stderr)
                continue
            
            if not candles:
                continue
            
            # Get entry price from first candle at or after entry timestamp
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
                continue
            
            # Simulate trade
            exit_price, exit_ts_ms, exit_reason, peak_mult, exit_mult, actual_reentries, \
                hit_2x, hit_3x, hit_4x, hit_5x, hit_10x = simulate_wash_rebound_trade(
                candles,
                entry_price,
                entry_ts_ms,
                trail_pct=args.trail_pct,
                wash_pct=args.wash_pct,
                rebound_pct=args.rebound_pct,
                max_reentries=args.max_reentries,
                cooldown_candles=args.cooldown_candles,
            )
            
            # Calculate metrics
            return_pct = (exit_mult - 1.0) * 100.0
            hold_time_minutes = (exit_ts_ms - entry_ts_ms) // (1000 * 60)
            giveback_from_peak_pct = ((peak_mult - exit_mult) / peak_mult * 100.0) if peak_mult > 0 else 0.0
            
            trade = WashReboundTradeResult(
                caller=alert['caller'],
                mint=alert['mint'],
                alert_id=alert['id'],
                entry_price=entry_price,
                entry_ts_ms=entry_ts_ms,
                exit_price=exit_price,
                exit_ts_ms=exit_ts_ms,
                exit_reason=exit_reason,
                return_pct=return_pct,
                hold_time_minutes=hold_time_minutes,
                peak_mult=peak_mult,
                exit_mult=exit_mult,
                giveback_from_peak_pct=giveback_from_peak_pct,
                trail_pct=args.trail_pct,
                wash_pct=args.wash_pct,
                rebound_pct=args.rebound_pct,
                max_reentries=args.max_reentries,
                cooldown_candles=args.cooldown_candles,
                actual_reentries=actual_reentries,
                hit_2x=hit_2x,
                hit_3x=hit_3x,
                hit_4x=hit_4x,
                hit_5x=hit_5x,
                hit_10x=hit_10x,
            )
            
            new_trades.append(trade)
        
        except Exception as e:
            print(f"Warning: Error processing alert {alert.get('mint', 'unknown')}: {e}", file=sys.stderr)
            if args.verbose:
                import traceback
                traceback.print_exc()
            sys.stderr.flush()
    
    print(f"Completed processing. Generated {len(new_trades)} new trades.", file=sys.stderr)
    sys.stderr.flush()
    
    # Save new trades to parquet (append if resuming, create new otherwise)
    output_file = output_dir / f"wash_rebound_results_{run_id}.parquet"
    
    if new_trades:
        if args.resume and output_file.exists():
            append_trades_to_parquet(new_trades, run_id, output_dir)
            print(f"✓ Appended {len(new_trades)} trades to existing file", file=sys.stderr)
        else:
            # Create new file
            records = []
            for trade in new_trades:
                records.append({
                    'caller': trade.caller,
                    'mint': trade.mint,
                    'alert_id': trade.alert_id if trade.alert_id else 0,
                    'entry_price': trade.entry_price,
                    'entry_ts_ms': trade.entry_ts_ms,
                    'exit_price': trade.exit_price,
                    'exit_ts_ms': trade.exit_ts_ms,
                    'exit_reason': trade.exit_reason,
                    'return_pct': trade.return_pct,
                    'hold_time_minutes': trade.hold_time_minutes,
                    'peak_mult': trade.peak_mult,
                    'exit_mult': trade.exit_mult,
                    'giveback_from_peak_pct': trade.giveback_from_peak_pct,
                    'trail_pct': trade.trail_pct,
                    'wash_pct': trade.wash_pct,
                    'rebound_pct': trade.rebound_pct,
                    'max_reentries': trade.max_reentries,
                    'cooldown_candles': trade.cooldown_candles,
                    'actual_reentries': trade.actual_reentries,
                    'hit_2x': trade.hit_2x,
                    'hit_3x': trade.hit_3x,
                    'hit_4x': trade.hit_4x,
                    'hit_5x': trade.hit_5x,
                    'hit_10x': trade.hit_10x,
                })
            table = pa.Table.from_pylist(records)
            pq.write_table(table, output_file, compression='snappy')
            print(f"✓ Saved {len(new_trades)} trades to {output_file}", file=sys.stderr)
    
    # Load all trades (existing + new) for aggregation
    all_trades = []
    if output_file.exists():
        try:
            table = pq.read_table(output_file)
            all_trades = table.to_pandas().to_dict('records')
        except Exception as e:
            print(f"Warning: Could not load all trades for aggregation: {e}", file=sys.stderr)
            all_trades = new_trades
    else:
        all_trades = new_trades
    
    # Count unique mints per caller
    caller_mint_counts = defaultdict(set)
    for trade in all_trades:
        if isinstance(trade, dict):
            caller_mint_counts[trade['caller']].add(trade['mint'])
        else:
            caller_mint_counts[trade.caller].add(trade.mint)
        caller_mint_counts[trade.caller].add(trade.mint)
    
    # Filter callers by min calls
    valid_callers = {caller for caller, mints in caller_mint_counts.items() if len(mints) >= args.min_calls}
    
    print(f"Found {len(valid_callers)} callers with >= {args.min_calls} calls", file=sys.stderr)
    sys.stderr.flush()
    
    # Filter trades to valid callers
    valid_trades = [t for t in all_trades if (t['caller'] if isinstance(t, dict) else t.caller) in valid_callers]
    
    # Catalog run in DuckDB if we have trades
    if valid_trades:
        output_file = output_dir / f"wash_rebound_results_{run_id}.parquet"
        
        # Catalog run in DuckDB (use all trades for metrics, not just new ones)
        try:
            # Convert dict trades to objects for catalog function
            catalog_trades = []
            for trade in valid_trades[:100]:  # Use sample for catalog (first 100)
                if isinstance(trade, dict):
                    # Create WashReboundTradeResult from dict
                    catalog_trades.append(WashReboundTradeResult(
                        caller=trade['caller'],
                        mint=trade['mint'],
                        alert_id=trade.get('alert_id', None),
                        entry_price=trade['entry_price'],
                        entry_ts_ms=trade['entry_ts_ms'],
                        exit_price=trade['exit_price'],
                        exit_ts_ms=trade['exit_ts_ms'],
                        exit_reason=trade['exit_reason'],
                        return_pct=trade['return_pct'],
                        hold_time_minutes=trade['hold_time_minutes'],
                        peak_mult=trade['peak_mult'],
                        exit_mult=trade['exit_mult'],
                        giveback_from_peak_pct=trade['giveback_from_peak_pct'],
                        trail_pct=trade['trail_pct'],
                        wash_pct=trade['wash_pct'],
                        rebound_pct=trade['rebound_pct'],
                        max_reentries=trade['max_reentries'],
                        cooldown_candles=trade['cooldown_candles'],
                        actual_reentries=trade['actual_reentries'],
                        hit_2x=trade['hit_2x'],
                        hit_3x=trade['hit_3x'],
                        hit_4x=trade['hit_4x'],
                        hit_5x=trade['hit_5x'],
                        hit_10x=trade['hit_10x'],
                    ))
                else:
                    catalog_trades.append(trade)
            
            catalog_run_in_duckdb(
                Path(args.duckdb),
                output_file,
                len(valid_trades),
                args,
                new_trades if new_trades else catalog_trades,
            )
            print(f"✓ Cataloged run in DuckDB", file=sys.stderr)
            sys.stderr.flush()
        except Exception as e:
            print(f"Warning: Failed to catalog run in DuckDB: {e}", file=sys.stderr)
            if args.verbose:
                import traceback
                traceback.print_exc()
        
        # Print summary
        print("\n" + "=" * 100)
        print("WASH-AND-REBOUND STRATEGY RESULTS")
        print("=" * 100)
        print(f"\nStrategy Parameters:")
        print(f"  Trail %: {args.trail_pct * 100:.0f}%")
        print(f"  Wash %: {args.wash_pct * 100:.0f}%")
        print(f"  Rebound %: {args.rebound_pct * 100:.0f}%")
        print(f"  Max Reentries: {args.max_reentries}")
        print(f"  Cooldown Candles: {args.cooldown_candles}")
        
        # Convert dicts to objects for statistics if needed
        def get_value(trade, key):
            return trade[key] if isinstance(trade, dict) else getattr(trade, key)
        
        print(f"\nTrade Statistics:")
        print(f"  Total Trades: {len(valid_trades)}")
        if valid_trades:
            returns = [get_value(t, 'return_pct') for t in valid_trades]
            peak_mults = [get_value(t, 'peak_mult') for t in valid_trades]
            exit_mults = [get_value(t, 'exit_mult') for t in valid_trades]
            givebacks = [get_value(t, 'giveback_from_peak_pct') for t in valid_trades]
            reentries = [get_value(t, 'actual_reentries') for t in valid_trades]
            hit_2x_count = sum(1 for t in valid_trades if get_value(t, 'hit_2x'))
            hit_3x_count = sum(1 for t in valid_trades if get_value(t, 'hit_3x'))
            hit_5x_count = sum(1 for t in valid_trades if get_value(t, 'hit_5x'))
            
            print(f"  Avg Return %: {np.mean(returns):.2f}%")
            print(f"  Median Return %: {np.median(returns):.2f}%")
            print(f"  Avg Peak Mult: {np.mean(peak_mults):.3f}x")
            print(f"  Avg Exit Mult: {np.mean(exit_mults):.3f}x")
            print(f"  Avg Giveback %: {np.mean(givebacks):.2f}%")
            print(f"  Avg Reentries: {np.mean(reentries):.2f}")
            print(f"  Hit 2x: {hit_2x_count} ({hit_2x_count / len(valid_trades) * 100:.1f}%)")
            print(f"  Hit 3x: {hit_3x_count} ({hit_3x_count / len(valid_trades) * 100:.1f}%)")
            print(f"  Hit 5x: {hit_5x_count} ({hit_5x_count / len(valid_trades) * 100:.1f}%)")
        print("=" * 100)
        
        print(f"\nRun ID: {run_id}")
        if args.resume:
            print(f"  Resume mode: Skipped {len(processed_mints)} already-processed mints", file=sys.stderr)
        print(f"  Output file: {output_file}", file=sys.stderr)


if __name__ == "__main__":
    main()

