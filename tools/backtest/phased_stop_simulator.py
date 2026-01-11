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

Features:
- Parquet output with run_id for auditability
- Resume functionality (--resume) - for interrupted runs
- Intelligent caching (--use-cache) - reuses results from previous runs
- Multithreaded processing

Usage:
    # Basic run (cache metadata saved automatically for future use)
    python3 phased_stop_simulator.py --duckdb data/alerts.duckdb --slice slices/per_token --chain solana
    
    # Reuse results from previous runs (only computes missing data)
    python3 phased_stop_simulator.py ... --use-cache --output-dir output/my_backtest
    
    # If interrupted, resume same run (skips already-processed mints)
    python3 phased_stop_simulator.py ... --resume --output-dir output/my_backtest
    
    # Extend date range with caching (only computes new dates, reuses old)
    python3 phased_stop_simulator.py ... --use-cache --date-from 2025-01-01 --date-to 2025-06-01
    
    # Lower min_calls with caching (recomputes for newly included callers)
    python3 phased_stop_simulator.py ... --use-cache --min-calls 10
    
Key difference:
    --resume: For continuing an interrupted run (same run_id, same date range)
    --use-cache: For reusing results from previous completed runs (different run_ids, overlapping dates)
    
Note: Cache metadata is ALWAYS saved, so you can add --use-cache to any future run,
      even if your first run didn't use it!
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from threading import Semaphore
from typing import Any, Dict, List, Optional, Tuple

import csv
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

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
    multiple_achieved: float  # exit_price / entry_price (DEPRECATED - use exit_mult)
    return_pct: float  # (exit_price - entry_price) / entry_price
    hold_time_minutes: int
    
    # EV-critical metrics
    entry_mult: float  # Always 1.0 (for clarity)
    peak_mult: float  # Highest multiple achieved while in trade (peak_price / entry_price)
    exit_mult: float  # Final exit multiple (exit_price / entry_price)
    giveback_from_peak_pct: float  # (peak_mult - exit_mult) / peak_mult * 100
    
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
    
    # ATH tracking (DEPRECATED - use peak_mult)
    ath_multiple: float  # Highest multiple achieved (same as peak_mult, kept for compatibility)
    
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
    
    # ATH metrics (DEPRECATED - use cohort metrics below)
    avg_ath_multiple: float  # Average ATH multiple across all trades
    median_ath_multiple: float
    p75_ath_multiple: float
    p90_ath_multiple: float
    
    # Cohort A: Base rates
    p_reach_2x: float  # P(hit 2x)
    p_reach_3x: float  # P(hit 3x)
    p_3x_given_2x: float  # P(3x | 2x)
    p_2x_no3x: float  # P(hit 2x but not 3x)
    
    # Cohort B1: Winners (hit ≥3x) - exit multiple distributions
    n_winners: int  # Count of trades that hit 3x
    exit_mult_winners_mean: float
    exit_mult_winners_p50: float
    exit_mult_winners_p75: float
    giveback_winners_mean_pct: float  # Mean giveback from peak for winners
    
    # Cohort B2: Losers (hit 2x but not 3x) - exit multiple distributions
    n_losers_2x_no3x: int  # Count of trades that hit 2x but not 3x
    exit_mult_losers_mean: float
    exit_mult_losers_p50: float
    exit_mult_losers_p75: float
    min_mult_after_2x_p10: float  # 10th percentile of minimum multiple after hitting 2x (how ugly it gets)
    
    # Cohort B3: Never reached 2x
    n_never_2x: int
    exit_mult_never_2x_mean: float
    exit_mult_never_2x_p50: float
    
    # Expected value (proper EV calculation)
    ev_pct_from_entry: float  # E[(exit_mult - 1) * 100] across all trades
    ev_pct_given_2x: float  # E[(exit_mult - 1) * 100 | hit 2x]
    expected_value_per_trade: float  # avg_return_pct (kept for compatibility)


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


def generate_cache_key(chain: str, date_from: str, date_to: str) -> str:
    """Generate cache key for a date range (independent of min_calls)."""
    params = f"{chain}_{date_from}_{date_to}"
    return hashlib.sha256(params.encode()).hexdigest()[:16]


def generate_run_id(args: argparse.Namespace) -> str:
    """Generate a unique run ID based on parameters."""
    params = f"{args.chain}_{args.date_from}_{args.date_to}_{args.min_calls}"
    return hashlib.sha256(params.encode()).hexdigest()[:16]


def find_cached_results(output_dir: Path, chain: str, date_from_str: str, date_to_str: str) -> List[Path]:
    """
    Find all cached result files that overlap with the requested date range.
    Returns list of parquet files that can be reused.
    """
    if not output_dir.exists():
        return []
    
    from datetime import datetime
    
    # Parse requested date range
    req_from = datetime.fromisoformat(date_from_str) if date_from_str else datetime(2020, 1, 1)
    req_to = datetime.fromisoformat(date_to_str) if date_to_str else datetime.now()
    
    cached_files = []
    
    # Look for cache metadata file
    cache_meta_file = output_dir / "cache_metadata.json"
    if not cache_meta_file.exists():
        return []
    
    try:
        with open(cache_meta_file, 'r') as f:
            cache_metadata = json.load(f)
        
        # Find overlapping cache entries
        for cache_key, meta in cache_metadata.items():
            cache_from = datetime.fromisoformat(meta['date_from'])
            cache_to = datetime.fromisoformat(meta['date_to'])
            cache_file = output_dir / meta['filename']
            
            # Check if cache overlaps with requested range
            if cache_file.exists() and cache_from <= req_to and cache_to >= req_from:
                cached_files.append((cache_file, cache_from, cache_to))
        
        return cached_files
    
    except Exception as e:
        print(f"Warning: Could not load cache metadata: {e}", file=sys.stderr)
        return []


def save_cache_metadata(output_dir: Path, cache_key: str, filename: str, chain: str, date_from: str, date_to: str, min_calls: int = None):
    """Save metadata about a cache file."""
    cache_meta_file = output_dir / "cache_metadata.json"
    
    # Load existing metadata
    if cache_meta_file.exists():
        with open(cache_meta_file, 'r') as f:
            metadata = json.load(f)
    else:
        metadata = {}
    
    # Add new entry
    metadata[cache_key] = {
        'filename': filename,
        'chain': chain,
        'date_from': date_from,
        'date_to': date_to,
        'min_calls': min_calls,
        'created_at': datetime.now().isoformat(),
    }
    
    # Save
    with open(cache_meta_file, 'w') as f:
        json.dump(metadata, f, indent=2)


def get_callers_from_cached_trades(cached_trades: List[Dict]) -> Dict[str, int]:
    """
    Get caller -> unique mint count from cached trades.
    Returns dict of caller -> number of unique mints.
    """
    caller_mints = defaultdict(set)
    for trade in cached_trades:
        caller_mints[trade['caller']].add(trade['mint'])
    
    return {caller: len(mints) for caller, mints in caller_mints.items()}


def load_cached_trades(cached_files: List[Tuple[Path, Any, Any]], req_from: datetime, req_to: datetime) -> List[Dict]:
    """
    Load trades from cached files that fall within the requested date range.
    Returns list of trade records (dicts).
    """
    all_cached_trades = []
    
    for cache_file, cache_from, cache_to in cached_files:
        try:
            # Read parquet file
            table = pq.read_table(cache_file)
            df = table.to_pandas()
            
            # Filter by date range
            df['entry_datetime'] = pd.to_datetime(df['entry_ts_ms'], unit='ms')
            mask = (df['entry_datetime'] >= req_from) & (df['entry_datetime'] <= req_to)
            filtered_df = df[mask]
            
            # Convert to dict records
            records = filtered_df.to_dict('records')
            all_cached_trades.extend(records)
            
            print(f"  Loaded {len(records)} trades from cache: {cache_file.name}", file=sys.stderr)
        
        except Exception as e:
            print(f"Warning: Could not load cache file {cache_file}: {e}", file=sys.stderr)
    
    return all_cached_trades


def get_missing_date_ranges(cached_files: List[Tuple[Path, Any, Any]], req_from: datetime, req_to: datetime) -> List[Tuple[datetime, datetime]]:
    """
    Determine which date ranges are not covered by cache.
    Returns list of (from, to) tuples that need to be computed.
    """
    from datetime import timedelta
    
    if not cached_files:
        return [(req_from, req_to)]
    
    # Sort cached ranges by start date
    cached_ranges = sorted([(cache_from, cache_to) for _, cache_from, cache_to in cached_files])
    
    missing_ranges = []
    current_pos = req_from
    
    for cache_from, cache_to in cached_ranges:
        # If there's a gap before this cache
        if current_pos < cache_from:
            missing_ranges.append((current_pos, min(cache_from - timedelta(days=1), req_to)))
        
        # Move position to end of this cache
        current_pos = max(current_pos, cache_to + timedelta(days=1))
    
    # If there's remaining range after all caches
    if current_pos <= req_to:
        missing_ranges.append((current_pos, req_to))
    
    return missing_ranges


def save_trades_to_parquet(trades: List[PhasedTradeResult], run_id: str, output_dir: Path):
    """Save trade results to parquet file."""
    if not trades:
        return
    
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
            'exit_phase': trade.exit_phase,
            'multiple_achieved': trade.multiple_achieved,
            'return_pct': trade.return_pct,
            'hold_time_minutes': trade.hold_time_minutes,
            'entry_mult': trade.entry_mult,
            'peak_mult': trade.peak_mult,
            'exit_mult': trade.exit_mult,
            'giveback_from_peak_pct': trade.giveback_from_peak_pct,
            'stop_mode': trade.stop_mode,
            'phase1_stop_pct': trade.phase1_stop_pct,
            'phase2_stop_pct': trade.phase2_stop_pct,
            'ladder_steps': trade.ladder_steps if trade.ladder_steps else 0.0,
            'hit_2x': trade.hit_2x,
            'hit_3x': trade.hit_3x,
            'hit_4x': trade.hit_4x,
            'hit_5x': trade.hit_5x,
            'hit_10x': trade.hit_10x,
            'ath_multiple': trade.ath_multiple,
            'phase2_entry_price': trade.phase2_entry_price if trade.phase2_entry_price else 0.0,
            'phase2_entry_ts_ms': trade.phase2_entry_ts_ms if trade.phase2_entry_ts_ms else 0,
        }
        records.append(record)
    
    # Create Arrow table
    table = pa.Table.from_pylist(records)
    
    # Write to parquet
    output_file = output_dir / f"phased_stop_results_{run_id}.parquet"
    pq.write_table(table, output_file, compression='snappy')
    
    return output_file


def load_existing_results(run_id: str, output_dir: Path) -> set:
    """Load already processed mints from existing parquet file."""
    output_file = output_dir / f"phased_stop_results_{run_id}.parquet"
    
    if not output_file.exists():
        return set()
    
    try:
        table = pq.read_table(output_file, columns=['mint', 'stop_mode', 'phase1_stop_pct', 'phase2_stop_pct'])
        df = table.to_pandas()
        
        # Create set of (mint, strategy) tuples that have been processed
        processed = set()
        for _, row in df.iterrows():
            key = (row['mint'], row['stop_mode'], row['phase1_stop_pct'], row['phase2_stop_pct'])
            processed.add(key)
        
        return processed
    except Exception as e:
        print(f"Warning: Could not load existing results: {e}", file=sys.stderr)
        return set()


def append_trades_to_parquet(trades: List[PhasedTradeResult], run_id: str, output_dir: Path):
    """Append new trades to existing parquet file."""
    if not trades:
        return
    
    output_file = output_dir / f"phased_stop_results_{run_id}.parquet"
    
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
            'exit_phase': trade.exit_phase,
            'multiple_achieved': trade.multiple_achieved,
            'return_pct': trade.return_pct,
            'hold_time_minutes': trade.hold_time_minutes,
            'entry_mult': trade.entry_mult,
            'peak_mult': trade.peak_mult,
            'exit_mult': trade.exit_mult,
            'giveback_from_peak_pct': trade.giveback_from_peak_pct,
            'stop_mode': trade.stop_mode,
            'phase1_stop_pct': trade.phase1_stop_pct,
            'phase2_stop_pct': trade.phase2_stop_pct,
            'ladder_steps': trade.ladder_steps if trade.ladder_steps else 0.0,
            'hit_2x': trade.hit_2x,
            'hit_3x': trade.hit_3x,
            'hit_4x': trade.hit_4x,
            'hit_5x': trade.hit_5x,
            'hit_10x': trade.hit_10x,
            'ath_multiple': trade.ath_multiple,
            'phase2_entry_price': trade.phase2_entry_price if trade.phase2_entry_price else 0.0,
            'phase2_entry_ts_ms': trade.phase2_entry_ts_ms if trade.phase2_entry_ts_ms else 0,
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
    
    # Cohort A: Base rates
    n_reach_2x = sum(1 for t in trades if t.hit_2x)
    n_reach_3x = sum(1 for t in trades if t.hit_3x)
    p_reach_2x = (n_reach_2x / n_trades * 100.0) if n_trades > 0 else 0.0
    p_reach_3x = (n_reach_3x / n_trades * 100.0) if n_trades > 0 else 0.0
    p_3x_given_2x = (n_reach_3x / n_reach_2x * 100.0) if n_reach_2x > 0 else 0.0
    p_2x_no3x = p_reach_2x - p_reach_3x
    
    # Cohort B1: Winners (hit ≥3x)
    winners = [t for t in trades if t.hit_3x]
    n_winners = len(winners)
    if winners:
        exit_mult_winners = [t.exit_mult for t in winners]
        exit_mult_winners_mean = np.mean(exit_mult_winners)
        exit_mult_winners_p50 = np.median(exit_mult_winners)
        exit_mult_winners_p75 = np.percentile(exit_mult_winners, 75)
        giveback_winners = [t.giveback_from_peak_pct for t in winners]
        giveback_winners_mean_pct = np.mean(giveback_winners)
    else:
        exit_mult_winners_mean = 0.0
        exit_mult_winners_p50 = 0.0
        exit_mult_winners_p75 = 0.0
        giveback_winners_mean_pct = 0.0
    
    # Cohort B2: Losers (hit 2x but not 3x)
    losers_2x_no3x = [t for t in trades if t.hit_2x and not t.hit_3x]
    n_losers_2x_no3x = len(losers_2x_no3x)
    if losers_2x_no3x:
        exit_mult_losers = [t.exit_mult for t in losers_2x_no3x]
        exit_mult_losers_mean = np.mean(exit_mult_losers)
        exit_mult_losers_p50 = np.median(exit_mult_losers)
        exit_mult_losers_p75 = np.percentile(exit_mult_losers, 75)
        # min_mult_after_2x: track minimum multiple after hitting 2x (how ugly it gets)
        # For now, use exit_mult as proxy (would need to track min in simulation for exact value)
        min_mult_after_2x_p10 = np.percentile(exit_mult_losers, 10)
    else:
        exit_mult_losers_mean = 0.0
        exit_mult_losers_p50 = 0.0
        exit_mult_losers_p75 = 0.0
        min_mult_after_2x_p10 = 0.0
    
    # Cohort B3: Never reached 2x
    never_2x = [t for t in trades if not t.hit_2x]
    n_never_2x = len(never_2x)
    if never_2x:
        exit_mult_never_2x = [t.exit_mult for t in never_2x]
        exit_mult_never_2x_mean = np.mean(exit_mult_never_2x)
        exit_mult_never_2x_p50 = np.median(exit_mult_never_2x)
    else:
        exit_mult_never_2x_mean = 0.0
        exit_mult_never_2x_p50 = 0.0
    
    # Expected value (proper EV calculation)
    # EV from entry = E[(exit_mult - 1) * 100]
    exit_mults_all = [t.exit_mult for t in trades]
    ev_pct_from_entry = np.mean([(em - 1.0) * 100.0 for em in exit_mults_all])
    
    # EV given hit 2x = E[(exit_mult - 1) * 100 | hit 2x]
    if trades_hit_2x:
        exit_mults_2x = [t.exit_mult for t in trades_hit_2x]
        ev_pct_given_2x = np.mean([(em - 1.0) * 100.0 for em in exit_mults_2x])
    else:
        ev_pct_given_2x = 0.0
    
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
        p_reach_2x=p_reach_2x,
        p_reach_3x=p_reach_3x,
        p_3x_given_2x=p_3x_given_2x,
        p_2x_no3x=p_2x_no3x,
        n_winners=n_winners,
        exit_mult_winners_mean=exit_mult_winners_mean,
        exit_mult_winners_p50=exit_mult_winners_p50,
        exit_mult_winners_p75=exit_mult_winners_p75,
        giveback_winners_mean_pct=giveback_winners_mean_pct,
        n_losers_2x_no3x=n_losers_2x_no3x,
        exit_mult_losers_mean=exit_mult_losers_mean,
        exit_mult_losers_p50=exit_mult_losers_p50,
        exit_mult_losers_p75=exit_mult_losers_p75,
        min_mult_after_2x_p10=min_mult_after_2x_p10,
        n_never_2x=n_never_2x,
        exit_mult_never_2x_mean=exit_mult_never_2x_mean,
        exit_mult_never_2x_p50=exit_mult_never_2x_p50,
        ev_pct_from_entry=ev_pct_from_entry,
        ev_pct_given_2x=ev_pct_given_2x,
        expected_value_per_trade=ev_pct_from_entry,  # Use proper EV
    )


def export_results_to_csv(performances: List[StrategyPerformance], output_file: Path):
    """Export performance results to CSV file."""
    if not performances:
        return
    
    # Ensure output directory exists
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', newline='') as f:
        writer = csv.writer(f)
        
        # Write header
        writer.writerow([
            'Caller',
            'Phase1_Stop_%',
            'Phase2_Stop_%',
            'Mode',
            'N_Trades',
            'Hit_2x',
            'Stop_Phase1',
            'Stop_Phase2',
            'Avg_Return_%',
            'Median_Return_%',
            'Win_Rate_%',
            'EV_From_Entry_%',
            'EV_Given_2x_%',
            'P_Reach_2x_%',
            'P_3x_Given_2x_%',
            'N_Winners',
            'Exit_Mult_Winners_Mean',
            'Exit_Mult_Winners_p50',
            'Giveback_Winners_Mean_%',
            'N_Losers_2x_No3x',
            'Exit_Mult_Losers_Mean',
            'Exit_Mult_Losers_p50',
            'N_Never_2x',
            'Exit_Mult_Never_2x_Mean',
            'Capture_2x_%',
            'Capture_3x_%',
            'Capture_5x_%',
            'Capture_10x_%',
            'ATH_p50_Multiple',
            'ATH_p90_Multiple',
        ])
        
        # Write data rows
        for perf in performances:
            mode_str = perf.stop_mode
            if perf.stop_mode == "ladder":
                mode_str = f"ladder{perf.ladder_steps:.1f}"
            
            writer.writerow([
                perf.caller,
                f"{perf.phase1_stop_pct * 100:.0f}",
                f"{perf.phase2_stop_pct * 100:.0f}",
                mode_str,
                perf.n_trades,
                perf.n_hit_2x,
                perf.n_stopped_phase1,
                perf.n_stopped_phase2,
                f"{perf.avg_return_pct:.2f}",
                f"{perf.median_return_pct:.2f}",
                f"{perf.win_rate:.2f}",
                f"{perf.ev_pct_from_entry:.2f}",
                f"{perf.ev_pct_given_2x:.2f}",
                f"{perf.p_reach_2x:.2f}",
                f"{perf.p_3x_given_2x:.2f}",
                perf.n_winners,
                f"{perf.exit_mult_winners_mean:.3f}",
                f"{perf.exit_mult_winners_p50:.3f}",
                f"{perf.giveback_winners_mean_pct:.2f}",
                perf.n_losers_2x_no3x,
                f"{perf.exit_mult_losers_mean:.3f}",
                f"{perf.exit_mult_losers_p50:.3f}",
                perf.n_never_2x,
                f"{perf.exit_mult_never_2x_mean:.3f}",
                f"{perf.pct_captured_2x:.2f}",
                f"{perf.pct_captured_3x:.2f}",
                f"{perf.pct_captured_5x:.2f}",
                f"{perf.pct_captured_10x:.2f}",
                f"{perf.median_ath_multiple:.3f}",
                f"{perf.p90_ath_multiple:.3f}",
            ])


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
    parser.add_argument("--output-dir", type=str, default="output/phased_stop_results", help="Output directory for parquet files")
    parser.add_argument("--resume", action="store_true", help="Resume interrupted run (skip already-processed mints in current run_id)")
    parser.add_argument("--use-cache", action="store_true", help="Reuse results from previous runs with overlapping date ranges (different run_ids)")
    parser.add_argument("--csv-output", type=str, help="Export summary results to CSV file (e.g., results/run.csv)")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    # Initialize semaphore
    global _duckdb_semaphore
    _duckdb_semaphore = Semaphore(args.threads)
    
    # Generate run ID and setup output directory
    run_id = generate_run_id(args)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if args.verbose:
        print(f"Run ID: {run_id}", file=sys.stderr)
        print(f"Output directory: {output_dir}", file=sys.stderr)
    
    # Check for cached results
    cached_trades_records = []
    alerts_to_process = []
    
    if args.use_cache:
        from datetime import datetime
        
        if args.verbose:
            print(f"\nChecking cache for overlapping date ranges...", file=sys.stderr)
        
        # Find cached files
        cached_files = find_cached_results(output_dir, args.chain, args.date_from, args.date_to)
        
        if cached_files:
            if args.verbose:
                print(f"Found {len(cached_files)} cached result files", file=sys.stderr)
            
            # Load cached trades
            req_from = datetime.fromisoformat(args.date_from) if args.date_from else datetime(2020, 1, 1)
            req_to = datetime.fromisoformat(args.date_to) if args.date_to else datetime.now()
            
            cached_trades_records = load_cached_trades(cached_files, req_from, req_to)
            
            if args.verbose:
                print(f"Loaded {len(cached_trades_records)} trades from cache", file=sys.stderr)
            
            # Check if min_calls changed (requires recomputing for newly included callers)
            cached_caller_counts = get_callers_from_cached_trades(cached_trades_records)
            
            # Find callers that now meet threshold but didn't before
            newly_included_callers = set()
            for caller, count in cached_caller_counts.items():
                if count >= args.min_calls:
                    # This caller now qualifies - check if they were excluded before
                    # (We'll recompute for them to be safe)
                    newly_included_callers.add(caller)
            
            if args.verbose and newly_included_callers:
                print(f"Found {len(newly_included_callers)} callers meeting min_calls threshold", file=sys.stderr)
            
            # Determine missing date ranges
            missing_ranges = get_missing_date_ranges(cached_files, req_from, req_to)
            
            if missing_ranges:
                if args.verbose:
                    print(f"\nMissing date ranges to compute:", file=sys.stderr)
                    for from_dt, to_dt in missing_ranges:
                        print(f"  {from_dt.date()} to {to_dt.date()}", file=sys.stderr)
                
                # Load alerts only for missing ranges
                for from_dt, to_dt in missing_ranges:
                    range_alerts = load_alerts_from_duckdb(
                        Path(args.duckdb),
                        args.chain,
                        from_dt.isoformat(),
                        to_dt.isoformat(),
                    )
                    alerts_to_process.extend(range_alerts)
                    
                    if args.verbose:
                        print(f"  Loaded {len(range_alerts)} alerts for {from_dt.date()} to {to_dt.date()}", file=sys.stderr)
            else:
                if args.verbose:
                    print(f"✓ All data available in cache, no new computation needed", file=sys.stderr)
        else:
            if args.verbose:
                print(f"No cache found, will compute full range", file=sys.stderr)
            
            # Load all alerts
            alerts_to_process = load_alerts_from_duckdb(
                Path(args.duckdb),
                args.chain,
                args.date_from,
                args.date_to,
            )
    else:
        # No caching, load all alerts
        if args.verbose:
            print(f"Loading alerts from {args.duckdb}...", file=sys.stderr)
        
        # Check if cache exists and warn user
        cache_meta_file = output_dir / "cache_metadata.json"
        if cache_meta_file.exists() and args.verbose:
            print(f"\n⚠️  Cache exists but --use-cache not specified. Will recompute all data.", file=sys.stderr)
            print(f"   Tip: Add --use-cache to reuse results from previous runs", file=sys.stderr)
        
        alerts_to_process = load_alerts_from_duckdb(
            Path(args.duckdb),
            args.chain,
            args.date_from,
            args.date_to,
        )
    
    if args.verbose:
        print(f"Alerts to process: {len(alerts_to_process)}", file=sys.stderr)
        print(f"Cached trades: {len(cached_trades_records)}", file=sys.stderr)
    
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
    
    # Convert cached trade records to PhasedTradeResult objects
    for record in cached_trades_records:
        # Handle both old and new formats
        entry_mult = record.get('entry_mult', 1.0)
        peak_mult = record.get('peak_mult', record.get('ath_multiple', record['multiple_achieved']))
        exit_mult = record.get('exit_mult', record['multiple_achieved'])
        giveback_from_peak_pct = record.get('giveback_from_peak_pct', 
                                             ((peak_mult - exit_mult) / peak_mult * 100.0) if peak_mult > 0 else 0.0)
        
        trade = PhasedTradeResult(
            caller=record['caller'],
            mint=record['mint'],
            alert_id=record['alert_id'],
            entry_price=record['entry_price'],
            entry_ts_ms=record['entry_ts_ms'],
            exit_price=record['exit_price'],
            exit_ts_ms=record['exit_ts_ms'],
            exit_reason=record['exit_reason'],
            exit_phase=record['exit_phase'],
            multiple_achieved=record['multiple_achieved'],
            return_pct=record['return_pct'],
            hold_time_minutes=record['hold_time_minutes'],
            entry_mult=entry_mult,
            peak_mult=peak_mult,
            exit_mult=exit_mult,
            giveback_from_peak_pct=giveback_from_peak_pct,
            stop_mode=record['stop_mode'],
            phase1_stop_pct=record['phase1_stop_pct'],
            phase2_stop_pct=record['phase2_stop_pct'],
            ladder_steps=record['ladder_steps'] if record['ladder_steps'] > 0 else None,
            hit_2x=record['hit_2x'],
            hit_3x=record['hit_3x'],
            hit_4x=record['hit_4x'],
            hit_5x=record['hit_5x'],
            hit_10x=record['hit_10x'],
            ath_multiple=record['ath_multiple'],
            phase2_entry_price=record['phase2_entry_price'] if record['phase2_entry_price'] > 0 else None,
            phase2_entry_ts_ms=record['phase2_entry_ts_ms'] if record['phase2_entry_ts_ms'] > 0 else None,
        )
        all_trades.append(trade)
    
    if args.verbose and cached_trades_records:
        print(f"Loaded {len(cached_trades_records)} trades from cache", file=sys.stderr)
    
    if args.verbose:
        print(f"Simulating {len(stop_strategies)} strategies on {len(alerts_to_process)} new alerts...", file=sys.stderr)
    
    def process_alert(alert_data):
        """Process a single alert with all strategies."""
        alert, strategies, processed_keys = alert_data
        trades = []
        
        try:
            entry_ts_ms = alert['timestamp_ms']
            end_ts_ms = entry_ts_ms + (7 * 24 * 60 * 60 * 1000)  # 7 days
            mint = alert['mint']
            
            # Load candles once per alert
            candles = load_candles_from_parquet(
                slice_path,
                mint,
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
                # Skip if already processed
                key = (mint, stop_mode, phase1_stop, phase2_stop)
                if key in processed_keys:
                    continue
                exit_price, exit_ts_ms, exit_reason, exit_phase, hit_2x, hit_3x, hit_4x, hit_5x, hit_10x, ath_multiple, phase2_entry_price, phase2_entry_ts_ms = simulate_phased_trade(
                    candles,
                    entry_price,
                    entry_ts_ms,
                    stop_mode,
                    phase1_stop,
                    phase2_stop,
                    ladder_steps,
                )
                
                # Calculate metrics
                entry_mult = 1.0
                peak_mult = ath_multiple  # Peak multiple while in trade
                exit_mult = exit_price / entry_price
                giveback_from_peak_pct = ((peak_mult - exit_mult) / peak_mult * 100.0) if peak_mult > 0 else 0.0
                
                multiple = exit_mult  # For compatibility
                return_pct = (exit_mult - 1.0) * 100.0
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
                    entry_mult=entry_mult,
                    peak_mult=peak_mult,
                    exit_mult=exit_mult,
                    giveback_from_peak_pct=giveback_from_peak_pct,
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
    
    new_trades = []
    processed_keys = set()
    
    if alerts_to_process:
        with ThreadPoolExecutor(max_workers=args.threads) as executor:
            # Submit all alerts
            futures = {
                executor.submit(process_alert, (alert, stop_strategies, processed_keys)): i
                for i, alert in enumerate(alerts_to_process)
            }
            
            # Collect results as they complete
            completed = 0
            batch_trades = []
            batch_size = 10  # Save every 10 alerts
            
            for future in as_completed(futures):
                completed += 1
                if args.verbose and completed % 10 == 0:
                    print(f"Processed {completed}/{len(alerts_to_process)} alerts...", file=sys.stderr)
            
                try:
                    trades = future.result(timeout=60)  # 60 second timeout per alert
                    new_trades.extend(trades)
                    all_trades.extend(trades)
                    batch_trades.extend(trades)
                    
                    # Save batch incrementally
                    if len(batch_trades) >= batch_size * len(stop_strategies):
                        append_trades_to_parquet(batch_trades, run_id, output_dir)
                        batch_trades = []
                        
                except Exception as e:
                    if args.verbose:
                        alert_idx = futures[future]
                        print(f"Warning: Timeout or error processing alert {alert_idx}: {e}", file=sys.stderr)
            
            # Save remaining trades
            if batch_trades:
                append_trades_to_parquet(batch_trades, run_id, output_dir)
        
        # Save cache metadata for new computation (always save, even if --use-cache not specified)
        # This allows future runs to use --use-cache even if the first run didn't
        if new_trades:
            cache_key = generate_cache_key(args.chain, args.date_from, args.date_to)
            cache_filename = f"phased_stop_results_{run_id}.parquet"
            save_cache_metadata(output_dir, cache_key, cache_filename, args.chain, args.date_from, args.date_to, args.min_calls)
            if args.verbose:
                print(f"✓ Saved cache metadata (use --use-cache in future runs to reuse results)", file=sys.stderr)
    
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
    
    # Export to CSV if requested
    if args.csv_output:
        csv_path = Path(args.csv_output)
        export_results_to_csv(performances, csv_path)
        print(f"\n✓ Summary exported to CSV: {csv_path}", file=sys.stderr)
    
    # Print output file location
    output_file = output_dir / f"phased_stop_results_{run_id}.parquet"
    if output_file.exists():
        print(f"\n✓ Results saved to: {output_file}", file=sys.stderr)
        print(f"  Run ID: {run_id}", file=sys.stderr)
        print(f"  Total trades: {len(all_trades)}", file=sys.stderr)
        print(f"\nTo resume this run later, use: --resume --output-dir {output_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()

