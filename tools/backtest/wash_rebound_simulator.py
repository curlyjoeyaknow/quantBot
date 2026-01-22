#!/usr/bin/env python3
"""
Wash-and-Rebound Strategy Simulator

A 3-state trading strategy:
1. IN_POSITION: Trailing stop at -20% from peak
2. WAIT_FOR_WASH: Waiting for -50% drop from peak_at_exit
3. WAIT_FOR_REBOUND: Waiting for +20% rebound from wash_low

Features:
- Deterministic fills at exact trigger prices
- Wick-aware execution (uses candle high/low)
- Same-candle prevention (no immediate re-entry)
- Parquet output with run_id for auditability
- Resume functionality (--resume) - for interrupted runs
- DuckDB cataloging of runs

Usage:
    python3 wash_rebound_simulator.py \
      --duckdb data/alerts.duckdb \
      --slice slices/per_token \
      --chain solana \
      --trail-pct 0.20 \
      --wash-pct 0.50 \
      --rebound-pct 0.20 \
      --resume
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pyarrow as pa
import pyarrow.parquet as pq
import duckdb

# Add project root to path
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root))

# Global semaphore to limit concurrent DuckDB connections
_duckdb_semaphore = None


@dataclass
class Alert:
    """An alert representing a token call at a specific time."""
    mint: str
    ts_ms: int
    caller: str
    mcap_usd: Optional[float] = None


def duckdb_table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    """Check if a table exists in the DuckDB database."""
    try:
        # Try to query the table directly (works for schema-qualified names like canon.alerts_final)
        conn.execute(f"SELECT 1 FROM {table_name} LIMIT 1").fetchone()
        return True
    except Exception:
        # Fallback: check information_schema
        try:
            q = """
            SELECT COUNT(*)::INT
            FROM information_schema.tables
            WHERE table_name = ?
            """
            result = conn.execute(q, [table_name]).fetchone()
            return result[0] > 0 if result else False
        except Exception:
            return False


def load_alerts_from_duckdb(
    duckdb_path: Path,
    chain: str,
    date_from: Optional[str],
    date_to: Optional[str],
) -> List[Alert]:
    """Load alerts from DuckDB, prioritizing canon.alerts_final."""
    con = duckdb.connect(str(duckdb_path))
    
    try:
        # Convert date strings to timestamps
        from_ts_ms = None
        to_ts_ms = None
        
        if date_from:
            dt_from = datetime.fromisoformat(date_from.replace('Z', '+00:00'))
            from_ts_ms = int(dt_from.timestamp() * 1000)
        
        if date_to:
            dt_to = datetime.fromisoformat(date_to.replace('Z', '+00:00'))
            to_ts_ms = int(dt_to.timestamp() * 1000)
        
        alerts = []
        
        # Try canon.alerts_final first (most comprehensive)
        has_caller_links = duckdb_table_exists(con, 'caller_links_d')
        
        # Check for canon.alerts_final (schema-qualified)
        has_canon_alerts = False
        try:
            con.execute("SELECT 1 FROM canon.alerts_final LIMIT 1").fetchone()
            has_canon_alerts = True
        except Exception:
            pass
        
        if has_canon_alerts:
            if has_caller_links:
                # Join with caller_links_d to get mcap_usd
                query = """
                SELECT DISTINCT
                  a.mint::TEXT AS mint,
                  a.alert_ts_ms::BIGINT AS ts_ms,
                  COALESCE(a.caller_name, '')::TEXT AS caller,
                  c.mcap_usd::DOUBLE AS mcap_usd
                FROM canon.alerts_final a
                LEFT JOIN caller_links_d c
                  ON c.mint = a.mint
                  AND c.trigger_ts_ms = a.alert_ts_ms
                WHERE a.mint IS NOT NULL
                  AND lower(a.chain) = lower(?)
                """
                params = [chain]
                if from_ts_ms:
                    query += " AND a.alert_ts_ms >= ?"
                    params.append(from_ts_ms)
                if to_ts_ms:
                    query += " AND a.alert_ts_ms <= ?"
                    params.append(to_ts_ms)
                
                rows = con.execute(query, params).fetchall()
            else:
                # No caller_links_d, just load from canon.alerts_final
                query = """
                SELECT DISTINCT
                  mint::TEXT AS mint,
                  alert_ts_ms::BIGINT AS ts_ms,
                  COALESCE(caller_name, '')::TEXT AS caller,
                  NULL::DOUBLE AS mcap_usd
                FROM canon.alerts_final
                WHERE mint IS NOT NULL
                  AND lower(chain) = lower(?)
                """
                params = [chain]
                if from_ts_ms:
                    query += " AND alert_ts_ms >= ?"
                    params.append(from_ts_ms)
                if to_ts_ms:
                    query += " AND alert_ts_ms <= ?"
                    params.append(to_ts_ms)
                
                rows = con.execute(query, params).fetchall()
            
            for row in rows:
                alerts.append(Alert(
                    mint=row[0],
                    ts_ms=int(row[1]),
                    caller=(row[2] or "").strip(),
                    mcap_usd=float(row[3]) if row[3] is not None else None
                ))
        
        # Fallback to caller_links_d
        if not alerts and duckdb_table_exists(con, 'caller_links_d'):
            # Get column names to build caller expression
            cols_result = con.execute("PRAGMA table_info('caller_links_d')").fetchall()
            cols = [r[1].lower() for r in cols_result]
            has_caller_name = "caller_name" in cols
            has_trigger_from_name = "trigger_from_name" in cols
            has_chain = "chain" in cols
            
            if has_caller_name and has_trigger_from_name:
                caller_expr = "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller"
            elif has_caller_name:
                caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
            elif has_trigger_from_name:
                caller_expr = "COALESCE(trigger_from_name, '')::TEXT AS caller"
            else:
                caller_expr = "''::TEXT AS caller"
            
            query = f"""
            SELECT DISTINCT
                mint::TEXT AS mint,
                trigger_ts_ms::BIGINT AS ts_ms,
                {caller_expr},
                NULL::DOUBLE AS mcap_usd
            FROM caller_links_d
            WHERE mint IS NOT NULL
            """
            params = []
            if has_chain:
                query += " AND lower(chain) = lower(?)"
                params.append(chain)
            if from_ts_ms:
                query += " AND trigger_ts_ms >= ?"
                params.append(from_ts_ms)
            if to_ts_ms:
                query += " AND trigger_ts_ms <= ?"
                params.append(to_ts_ms)
            
            rows = con.execute(query, params).fetchall()
            for row in rows:
                alerts.append(Alert(
                    mint=row[0],
                    ts_ms=int(row[1]),
                    caller=(row[2] or "").strip(),
                    mcap_usd=None
                ))
        
        # Fallback to user_calls_d
        if not alerts and duckdb_table_exists(con, 'user_calls_d'):
            # Get column names
            cols_result = con.execute("PRAGMA table_info('user_calls_d')").fetchall()
            cols = [r[1].lower() for r in cols_result]
            has_caller_name = "caller_name" in cols
            has_trigger_from_name = "trigger_from_name" in cols
            has_chain = "chain" in cols
            
            # Find timestamp column
            if "call_ts_ms" in cols:
                ts_col = "call_ts_ms"
            elif "trigger_ts_ms" in cols:
                ts_col = "trigger_ts_ms"
            else:
                ts_col = None
            
            if ts_col:
                if has_caller_name and has_trigger_from_name:
                    caller_expr = "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller"
                elif has_caller_name:
                    caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
                elif has_trigger_from_name:
                    caller_expr = "COALESCE(trigger_from_name, '')::TEXT AS caller"
                else:
                    caller_expr = "''::TEXT AS caller"
                
                query = f"""
                SELECT DISTINCT
                    mint::TEXT AS mint,
                    {ts_col}::BIGINT AS ts_ms,
                    {caller_expr},
                    NULL::DOUBLE AS mcap_usd
                FROM user_calls_d
                WHERE mint IS NOT NULL
                """
                params = []
                if has_chain:
                    query += " AND lower(chain) = lower(?)"
                    params.append(chain)
                if from_ts_ms:
                    query += f" AND {ts_col} >= ?"
                    params.append(from_ts_ms)
                if to_ts_ms:
                    query += f" AND {ts_col} <= ?"
                    params.append(to_ts_ms)
                
                rows = con.execute(query, params).fetchall()
                for row in rows:
                    alerts.append(Alert(
                        mint=row[0],
                        ts_ms=int(row[1]),
                        caller=(row[2] or "").strip(),
                        mcap_usd=None
                    ))
        
        return alerts
    
    finally:
        con.close()


def load_candles_from_parquet(
    slice_path: Path,
    mint: str,
    entry_ts_ms: int,
    end_ts_ms: int,
    interval_seconds: int = 60,  # 1-minute candles
) -> List[Dict]:
    """Load candles from parquet slice."""
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
            # Normalize timestamp to milliseconds
            ts_val = row[0]
            if isinstance(ts_val, datetime):
                ts_ms = int(ts_val.timestamp() * 1000)
            elif isinstance(ts_val, str):
                ts = datetime.fromisoformat(ts_val.replace('Z', '+00:00'))
                ts_ms = int(ts.timestamp() * 1000)
            elif isinstance(ts_val, (int, float)):
                ts_float = float(ts_val)
                if ts_float < 4102444800:  # 2100-01-01 in seconds
                    ts_ms = int(ts_float * 1000)
                else:
                    ts_ms = int(ts_float)
            else:
                continue
            
            candles.append({
                'timestamp': ts_ms,
                'open': float(row[1]),
                'high': float(row[2]),
                'low': float(row[3]),
                'close': float(row[4]),
                'volume': float(row[5]) if row[5] is not None else 0.0,
            })
        
        return candles
    
    finally:
        if con:
            con.close()
        if _duckdb_semaphore is not None:
            _duckdb_semaphore.release()


@dataclass
class WashReboundTradeResult:
    """Result of a simulated wash-and-rebound trade."""
    caller: str
    mint: str
    alert_id: Optional[int]
    
    # Entry
    entry_price: float
    entry_ts_ms: int
    
    # Exit
    exit_price: float
    exit_ts_ms: int
    exit_reason: str  # "trailing_stop", "wash_rebound", "end_of_data"
    
    # Performance
    return_pct: float
    hold_time_minutes: int
    entry_mult: float
    peak_mult: float
    exit_mult: float
    giveback_from_peak_pct: float
    
    # Strategy parameters
    trail_pct: float
    wash_pct: float
    rebound_pct: float
    max_reentries: int
    cooldown_candles: int
    
    # Trade sequence
    n_reentries: int
    total_return_compounded: float  # Compounded return across all trades


def simulate_wash_rebound_trade(
    candles: List[Dict],
    entry_price: float,
    entry_ts_ms: int,
    trail_pct: float,
    wash_pct: float,
    rebound_pct: float,
    max_reentries: int = 3,
    cooldown_candles: int = 1,
    fees: float = 0.001,  # 0.1% per trade
) -> Tuple[float, int, str, float, float, float, float, int, float]:
    """
    Simulate a wash-and-rebound trade.
    
    Returns:
        (exit_price, exit_ts_ms, exit_reason, peak_mult, exit_mult, giveback_pct, 
         n_reentries, total_return_compounded)
    """
    if not candles:
        return (entry_price, entry_ts_ms, "end_of_data", 1.0, 1.0, 0.0, 0, 0.0)
    
    # State machine: IN_POSITION, WAIT_FOR_WASH, WAIT_FOR_REBOUND
    state = "IN_POSITION"
    
    # Position tracking
    current_entry_price = entry_price
    current_entry_ts_ms = entry_ts_ms
    peak_price = entry_price
    peak_at_exit = None  # Peak when we exit IN_POSITION
    wash_low = None  # Lowest price during wash
    wash_low_ts_ms = None
    
    # Re-entry tracking
    n_reentries = 0
    last_exit_candle_idx = -1
    
    # Compounded return
    total_return_compounded = 0.0
    
    # Find entry candle index
    entry_candle_idx = -1
    for i, candle in enumerate(candles):
        if candle['timestamp'] >= entry_ts_ms:
            entry_candle_idx = i
            break
    
    if entry_candle_idx == -1:
        # Entry after all candles
        last_candle = candles[-1]
        return (last_candle['close'], last_candle['timestamp'], "end_of_data", 
                1.0, last_candle['close'] / entry_price, 0.0, 0, 0.0)
    
    # Process candles starting from entry
    for i in range(entry_candle_idx, len(candles)):
        candle = candles[i]
        ts_ms = candle['timestamp']
        high = candle['high']
        low = candle['low']
        close = candle['close']
        
        if state == "IN_POSITION":
            # Update peak
            if high > peak_price:
                peak_price = high
            
            # Check trailing stop: exit if low <= peak * (1 - trail_pct)
            trailing_stop_price = peak_price * (1.0 - trail_pct)
            if low <= trailing_stop_price:
                # Exit at trailing stop
                exit_price = trailing_stop_price
                exit_mult = exit_price / current_entry_price
                return_pct = (exit_price - current_entry_price) / current_entry_price
                
                # Apply fees
                return_pct_after_fees = return_pct - (fees * 2)  # Entry + exit fees
                total_return_compounded += return_pct_after_fees
                
                # Transition to WAIT_FOR_WASH
                state = "WAIT_FOR_WASH"
                peak_at_exit = peak_price
                wash_low = close  # Start tracking wash from current close
                wash_low_ts_ms = ts_ms
                last_exit_candle_idx = i
                
                # Check if we can re-enter (cooldown and max reentries)
                if n_reentries >= max_reentries:
                    # Max reentries reached, exit permanently
                    return (exit_price, ts_ms, "max_reentries", 
                           peak_price / entry_price, exit_mult, 
                           (peak_price - exit_price) / peak_price * 100.0,
                           n_reentries, total_return_compounded)
        
        elif state == "WAIT_FOR_WASH":
            # Update wash low
            if low < wash_low:
                wash_low = low
                wash_low_ts_ms = ts_ms
            
            # Check if we hit wash threshold: low <= peak_at_exit * (1 - wash_pct)
            wash_threshold = peak_at_exit * (1.0 - wash_pct)
            if low <= wash_threshold:
                # Transition to WAIT_FOR_REBOUND
                state = "WAIT_FOR_REBOUND"
        
        elif state == "WAIT_FOR_REBOUND":
            # Check if we hit rebound threshold: high >= wash_low * (1 + rebound_pct)
            rebound_threshold = wash_low * (1.0 + rebound_pct)
            if high >= rebound_threshold:
                # Re-enter at rebound threshold
                # Check cooldown: must be at least cooldown_candles after last exit
                if i - last_exit_candle_idx >= cooldown_candles:
                    current_entry_price = rebound_threshold
                    current_entry_ts_ms = ts_ms
                    peak_price = rebound_threshold
                    state = "IN_POSITION"
                    n_reentries += 1
                    peak_at_exit = None
                    wash_low = None
                    wash_low_ts_ms = None
    
    # End of data - exit at last close
    last_candle = candles[-1]
    exit_price = last_candle['close']
    exit_ts_ms = last_candle['timestamp']
    
    # Calculate final metrics
    peak_mult = peak_price / entry_price
    exit_mult = exit_price / current_entry_price
    
    # If still in position, calculate return
    if state == "IN_POSITION":
        return_pct = (exit_price - current_entry_price) / current_entry_price
        return_pct_after_fees = return_pct - (fees * 2)
        total_return_compounded += return_pct_after_fees
    
    giveback_pct = ((peak_price - exit_price) / peak_price * 100.0) if peak_price > exit_price else 0.0
    
    return (exit_price, exit_ts_ms, "end_of_data", peak_mult, exit_mult, 
           giveback_pct, n_reentries, total_return_compounded)


def generate_run_id(args: argparse.Namespace) -> str:
    """Generate a unique run ID based on parameters."""
    params = f"{args.chain}_{args.trail_pct}_{args.wash_pct}_{args.rebound_pct}_{args.max_reentries}_{args.cooldown_candles}"
    if args.date_from:
        params += f"_{args.date_from}"
    if args.date_to:
        params += f"_{args.date_to}"
    return hashlib.sha256(params.encode()).hexdigest()[:16]


def catalog_run_in_duckdb(
    duckdb_path: Path,
    run_id: str,
    output_file: Path,
    args: argparse.Namespace,
    n_trades: int,
    total_return_pct: float,
    avg_return_pct: float,
) -> None:
    """Catalog run metadata in DuckDB."""
    con = duckdb.connect(str(duckdb_path))
    
    try:
        # Create table if it doesn't exist
        con.execute("""
            CREATE TABLE IF NOT EXISTS simulation_runs (
                run_id VARCHAR PRIMARY KEY,
                strategy_type VARCHAR,
                chain VARCHAR,
                trail_pct DOUBLE,
                wash_pct DOUBLE,
                rebound_pct DOUBLE,
                max_reentries INTEGER,
                cooldown_candles INTEGER,
                date_from VARCHAR,
                date_to VARCHAR,
                output_file VARCHAR,
                n_trades INTEGER,
                total_return_pct DOUBLE,
                avg_return_pct DOUBLE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Insert or update run record
        con.execute("""
            INSERT OR REPLACE INTO simulation_runs
            (run_id, strategy_type, chain, trail_pct, wash_pct, rebound_pct,
             max_reentries, cooldown_candles, date_from, date_to, output_file,
             n_trades, total_return_pct, avg_return_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            run_id,
            "wash_rebound",
            args.chain,
            args.trail_pct,
            args.wash_pct,
            args.rebound_pct,
            args.max_reentries,
            args.cooldown_candles,
            args.date_from,
            args.date_to,
            str(output_file),
            n_trades,
            total_return_pct,
            avg_return_pct,
        ])
        
        con.commit()
    
    finally:
        con.close()


def load_existing_results(run_id: str, output_dir: Path) -> set:
    """Load already processed mints from existing parquet file."""
    output_file = output_dir / f"wash_rebound_results_{run_id}.parquet"
    
    if not output_file.exists():
        return set()
    
    try:
        table = pq.read_table(output_file, columns=['mint'])
        df = table.to_pandas()
        return set(df['mint'].unique())
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
        record = {
            'run_id': run_id,
            'caller': trade.caller,
            'mint': trade.mint,
            'alert_id': trade.alert_id,
            'entry_price': trade.entry_price,
            'entry_ts_ms': trade.entry_ts_ms,
            'exit_price': trade.exit_price,
            'exit_ts_ms': trade.exit_ts_ms,
            'exit_reason': trade.exit_reason,
            'return_pct': trade.return_pct,
            'hold_time_minutes': trade.hold_time_minutes,
            'entry_mult': trade.entry_mult,
            'peak_mult': trade.peak_mult,
            'exit_mult': trade.exit_mult,
            'giveback_from_peak_pct': trade.giveback_from_peak_pct,
            'trail_pct': trade.trail_pct,
            'wash_pct': trade.wash_pct,
            'rebound_pct': trade.rebound_pct,
            'max_reentries': trade.max_reentries,
            'cooldown_candles': trade.cooldown_candles,
            'n_reentries': trade.n_reentries,
            'total_return_compounded': trade.total_return_compounded,
        }
        records.append(record)
    
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
    
    return output_file


def save_trades_to_parquet(trades: List[WashReboundTradeResult], run_id: str, output_dir: Path):
    """Save trade results to parquet file."""
    if not trades:
        return None
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Convert trades to records
    records = []
    for trade in trades:
        record = {
            'run_id': run_id,
            'caller': trade.caller,
            'mint': trade.mint,
            'alert_id': trade.alert_id,
            'entry_price': trade.entry_price,
            'entry_ts_ms': trade.entry_ts_ms,
            'exit_price': trade.exit_price,
            'exit_ts_ms': trade.exit_ts_ms,
            'exit_reason': trade.exit_reason,
            'return_pct': trade.return_pct,
            'hold_time_minutes': trade.hold_time_minutes,
            'entry_mult': trade.entry_mult,
            'peak_mult': trade.peak_mult,
            'exit_mult': trade.exit_mult,
            'giveback_from_peak_pct': trade.giveback_from_peak_pct,
            'trail_pct': trade.trail_pct,
            'wash_pct': trade.wash_pct,
            'rebound_pct': trade.rebound_pct,
            'max_reentries': trade.max_reentries,
            'cooldown_candles': trade.cooldown_candles,
            'n_reentries': trade.n_reentries,
            'total_return_compounded': trade.total_return_compounded,
        }
        records.append(record)
    
    # Create Arrow table
    table = pa.Table.from_pylist(records)
    
    # Write to parquet
    output_file = output_dir / f"wash_rebound_results_{run_id}.parquet"
    pq.write_table(table, output_file, compression='snappy')
    
    return output_file


def main():
    parser = argparse.ArgumentParser(description='Wash-and-Rebound Strategy Simulator')
    parser.add_argument('--duckdb', type=str, required=True, help='Path to DuckDB database')
    parser.add_argument('--slice', type=str, required=True, help='Path to parquet slice directory')
    parser.add_argument('--chain', type=str, required=True, help='Chain name (e.g., solana)')
    parser.add_argument('--trail-pct', type=float, default=0.20, help='Trailing stop percentage (default: 0.20)')
    parser.add_argument('--wash-pct', type=float, default=0.50, help='Wash threshold percentage (default: 0.50)')
    parser.add_argument('--rebound-pct', type=float, default=0.20, help='Rebound threshold percentage (default: 0.20)')
    parser.add_argument('--max-reentries', type=int, default=3, help='Maximum re-entries (default: 3)')
    parser.add_argument('--cooldown-candles', type=int, default=1, help='Cooldown candles after exit (default: 1)')
    parser.add_argument('--date-from', type=str, help='Start date (ISO format)')
    parser.add_argument('--date-to', type=str, help='End date (ISO format)')
    parser.add_argument('--output-dir', type=str, default='output', help='Output directory (default: output)')
    parser.add_argument('--resume', action='store_true', help='Resume from existing results')
    parser.add_argument('--verbose', action='store_true', help='Verbose output')
    
    args = parser.parse_args()
    
    # Validate paths
    duckdb_path = Path(args.duckdb)
    if not duckdb_path.exists():
        print(f"Error: DuckDB file not found: {duckdb_path}", file=sys.stderr)
        sys.exit(1)
    
    slice_path = Path(args.slice)
    if not slice_path.exists():
        print(f"Error: Slice directory not found: {slice_path}", file=sys.stderr)
        sys.exit(1)
    
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate run ID
    run_id = generate_run_id(args)
    
    # Load existing results if resuming
    processed_mints = set()
    if args.resume:
        processed_mints = load_existing_results(run_id, output_dir)
        if processed_mints:
            print(f"Resuming run {run_id}: {len(processed_mints)} mints already processed", file=sys.stderr)
            sys.stderr.flush()
    
    # Load alerts
    print(f"Loading alerts from {duckdb_path}...", file=sys.stderr)
    sys.stderr.flush()
    alerts = load_alerts_from_duckdb(duckdb_path, args.chain, args.date_from, args.date_to)
    print(f"Loaded {len(alerts)} alerts", file=sys.stderr)
    sys.stderr.flush()
    
    if not alerts:
        print("No alerts found", file=sys.stderr)
        sys.exit(1)
    
    # Filter out already processed mints if resuming
    if args.resume and processed_mints:
        alerts = [a for a in alerts if a.mint not in processed_mints]
        print(f"Processing {len(alerts)} remaining alerts", file=sys.stderr)
        sys.stderr.flush()
    
    # Process alerts
    trades = []
    total_processed = 0
    
    print(f"Processing {len(alerts)} alerts...", file=sys.stderr)
    sys.stderr.flush()
    
    for alert in alerts:
        try:
            # Load candles (48 hours after alert)
            end_ts_ms = alert.ts_ms + (48 * 60 * 60 * 1000)
            candles = load_candles_from_parquet(
                slice_path,
                alert.mint,
                alert.ts_ms,
                end_ts_ms,
                interval_seconds=60
            )
            
            if not candles:
                if args.verbose:
                    print(f"  No candles for {alert.mint}", file=sys.stderr)
                continue
            
            # Get entry price from first candle
            entry_price = candles[0]['close']
            entry_ts_ms = candles[0]['timestamp']
            
            # Simulate trade
            exit_price, exit_ts_ms, exit_reason, peak_mult, exit_mult, giveback_pct, n_reentries, total_return_compounded = simulate_wash_rebound_trade(
                candles,
                entry_price,
                entry_ts_ms,
                args.trail_pct,
                args.wash_pct,
                args.rebound_pct,
                args.max_reentries,
                args.cooldown_candles,
            )
            
            # Calculate metrics
            return_pct = (exit_price - entry_price) / entry_price
            hold_time_minutes = (exit_ts_ms - entry_ts_ms) // (60 * 1000)
            
            trade = WashReboundTradeResult(
                caller=alert.caller,
                mint=alert.mint,
                alert_id=None,
                entry_price=entry_price,
                entry_ts_ms=entry_ts_ms,
                exit_price=exit_price,
                exit_ts_ms=exit_ts_ms,
                exit_reason=exit_reason,
                return_pct=return_pct,
                hold_time_minutes=hold_time_minutes,
                entry_mult=1.0,
                peak_mult=peak_mult,
                exit_mult=exit_mult,
                giveback_from_peak_pct=giveback_pct,
                trail_pct=args.trail_pct,
                wash_pct=args.wash_pct,
                rebound_pct=args.rebound_pct,
                max_reentries=args.max_reentries,
                cooldown_candles=args.cooldown_candles,
                n_reentries=n_reentries,
                total_return_compounded=total_return_compounded,
            )
            
            trades.append(trade)
            total_processed += 1
            
            if args.verbose and total_processed % 100 == 0:
                print(f"  Processed {total_processed} alerts...", file=sys.stderr)
                sys.stderr.flush()
        
        except Exception as e:
            print(f"Error processing {alert.mint}: {e}", file=sys.stderr)
            sys.stderr.flush()
            continue
    
    # Save results
    if args.resume and processed_mints:
        output_file = append_trades_to_parquet(trades, run_id, output_dir)
    else:
        output_file = save_trades_to_parquet(trades, run_id, output_dir)
    
    if output_file:
        print(f"Saved {len(trades)} trades to {output_file}", file=sys.stderr)
        sys.stderr.flush()
        
        # Catalog run in DuckDB
        if trades:
            total_return_pct = sum(t.return_pct for t in trades)
            avg_return_pct = total_return_pct / len(trades) if trades else 0.0
            catalog_run_in_duckdb(
                duckdb_path,
                run_id,
                output_file,
                args,
                len(trades),
                total_return_pct,
                avg_return_pct,
            )
            print(f"Cataloged run {run_id} in DuckDB", file=sys.stderr)
            sys.stderr.flush()
    
    # Print summary
    if trades:
        callers = defaultdict(int)
        for trade in trades:
            callers[trade.caller] += 1
        
        print(f"\nCompleted processing. Generated {len(trades)} trades.", file=sys.stderr)
        print(f"Found {len(callers)} callers with >= 1 trade", file=sys.stderr)
        sys.stderr.flush()
    else:
        print("Completed processing. Generated 0 trades.", file=sys.stderr)
        sys.stderr.flush()


if __name__ == '__main__':
    main()

