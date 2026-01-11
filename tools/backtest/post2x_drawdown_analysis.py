#!/usr/bin/env python3
"""
Post-2x Drawdown Analysis

Computes drawdown distributions after hitting 2x and before hitting higher multiples (3x, 4x, 5x).

For tokens that:
- reached 2x (t2x = first time price reaches 2.0× entry)
- later reached 3x (t3x = first time price reaches 3.0× entry)

Computes:
- DD_post2x_to3x = worst drop from 2x price in window [t2x, t3x]
- DD_post2x_to4x for those that go ≥4x
- DD_post2x_to5x for those that go ≥5x

Then computes distribution statistics (p50, p75, p90) per caller.

Usage:
    python3 post2x_drawdown_analysis.py --duckdb data/alerts.duckdb --slice slices/per_token --chain solana
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from threading import Semaphore
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# Global semaphore to limit concurrent DuckDB connections (prevent resource exhaustion)
_duckdb_semaphore = None

# Add project root and lib to path so imports work correctly
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(Path(__file__).parent))

# Import directly from module files to avoid __init__.py dependency chain
# We need to manually import dependencies first
import duckdb
from datetime import datetime, timedelta, timezone

# Now import the specific modules we need
import importlib
import importlib.util
lib_dir = Path(__file__).parent / "lib"

# Import alerts module by adding to sys.modules manually
alerts_path = lib_dir / "alerts.py"
spec = importlib.util.spec_from_file_location("lib.alerts", alerts_path)
alerts_mod = importlib.util.module_from_spec(spec)
sys.modules["lib.alerts"] = alerts_mod
spec.loader.exec_module(alerts_mod)
load_alerts = alerts_mod.load_alerts

# Import helpers similarly
helpers_path = lib_dir / "helpers.py"
spec = importlib.util.spec_from_file_location("lib.helpers", helpers_path)
helpers_mod = importlib.util.module_from_spec(spec)
sys.modules["lib.helpers"] = helpers_mod
spec.loader.exec_module(helpers_mod)
ceil_ms_to_interval_ts_ms = helpers_mod.ceil_ms_to_interval_ts_ms
sql_escape = helpers_mod.sql_escape


@dataclass
class Post2xMetrics:
    """Post-2x drawdown metrics for a single call."""
    caller: str
    mint: str
    alert_id: Optional[int]
    
    # Multiples reached
    hit_2x: bool
    hit_3x: bool
    hit_4x: bool
    hit_5x: bool
    
    # Timestamps (ms) when multiples were first hit
    t_2x_ms: Optional[int]
    t_3x_ms: Optional[int]
    t_4x_ms: Optional[int]
    t_5x_ms: Optional[int]
    
    # Entry price
    entry_price: float
    
    # Post-2x drawdowns (as decimal, e.g., 0.20 = 20% drawdown from 2x price)
    dd_post2x_to3x_pct: Optional[float]  # Only if hit 2x AND hit 3x
    dd_post2x_to4x_pct: Optional[float]  # Only if hit 2x AND hit 4x
    dd_post2x_to5x_pct: Optional[float]  # Only if hit 2x AND hit 5x
    
    # Drawdowns for NON-WINNERS (saved from nuke)
    dd_post2x_no3x_pct: Optional[float]  # 2x but NOT 3x
    dd_post3x_no4x_pct: Optional[float]  # 3x but NOT 4x
    dd_post4x_no5x_pct: Optional[float]  # 4x but NOT 5x


@dataclass
class CallerDistribution:
    """Distribution statistics for a caller."""
    caller: str
    n_calls: int
    
    # Counts
    n_hit_2x: int
    n_hit_2x_and_3x: int  # Eligible for dd_post2x_to3x
    n_hit_2x_and_4x: int  # Eligible for dd_post2x_to4x
    n_hit_2x_and_5x: int  # Eligible for dd_post2x_to5x
    n_hit_2x_not_3x: int  # Hit 2x but NOT 3x (saved from nuke)
    n_hit_3x_not_4x: int  # Hit 3x but NOT 4x
    n_hit_4x_not_5x: int  # Hit 4x but NOT 5x
    
    # DD_post2x_to3x distribution
    dd_post2x_to3x_p50: Optional[float]
    dd_post2x_to3x_p75: Optional[float]
    dd_post2x_to3x_p90: Optional[float]
    
    # DD_post2x_to4x distribution
    dd_post2x_to4x_p50: Optional[float]
    dd_post2x_to4x_p75: Optional[float]
    dd_post2x_to4x_p90: Optional[float]
    
    # DD_post2x_to5x distribution
    dd_post2x_to5x_p50: Optional[float]
    dd_post2x_to5x_p75: Optional[float]
    dd_post2x_to5x_p90: Optional[float]
    
    # DD for tokens that DON'T reach next milestone (saved from nuke)
    dd_post2x_no3x_p50: Optional[float]  # 2x but NOT 3x
    dd_post2x_no3x_p75: Optional[float]
    dd_post2x_no3x_p90: Optional[float]
    
    dd_post3x_no4x_p50: Optional[float]  # 3x but NOT 4x
    dd_post3x_no4x_p75: Optional[float]
    dd_post3x_no4x_p90: Optional[float]
    
    dd_post4x_no5x_p50: Optional[float]  # 4x but NOT 5x
    dd_post4x_no5x_p75: Optional[float]
    dd_post4x_no5x_p90: Optional[float]
    
    # Percentage requiring >X% drawdown (stopout rates for winners)
    pct_dd_post2x_to3x_gt_5pct: Optional[float]
    pct_dd_post2x_to3x_gt_10pct: Optional[float]
    pct_dd_post2x_to3x_gt_15pct: Optional[float]
    pct_dd_post2x_to3x_gt_20pct: Optional[float]
    pct_dd_post2x_to3x_gt_25pct: Optional[float]
    pct_dd_post2x_to3x_gt_30pct: Optional[float]
    pct_dd_post2x_to3x_gt_40pct: Optional[float]
    
    pct_dd_post2x_to4x_gt_5pct: Optional[float]
    pct_dd_post2x_to4x_gt_10pct: Optional[float]
    pct_dd_post2x_to4x_gt_15pct: Optional[float]
    pct_dd_post2x_to4x_gt_20pct: Optional[float]
    pct_dd_post2x_to4x_gt_25pct: Optional[float]
    pct_dd_post2x_to4x_gt_30pct: Optional[float]
    pct_dd_post2x_to4x_gt_40pct: Optional[float]
    
    pct_dd_post2x_to5x_gt_5pct: Optional[float]
    pct_dd_post2x_to5x_gt_10pct: Optional[float]
    pct_dd_post2x_to5x_gt_15pct: Optional[float]
    pct_dd_post2x_to5x_gt_20pct: Optional[float]
    pct_dd_post2x_to5x_gt_25pct: Optional[float]
    pct_dd_post2x_to5x_gt_30pct: Optional[float]
    pct_dd_post2x_to5x_gt_40pct: Optional[float]
    
    # Stopout rates for NON-winners (saved from nuke)
    pct_dd_post2x_no3x_gt_5pct: Optional[float]
    pct_dd_post2x_no3x_gt_10pct: Optional[float]
    pct_dd_post2x_no3x_gt_15pct: Optional[float]
    pct_dd_post2x_no3x_gt_20pct: Optional[float]
    pct_dd_post2x_no3x_gt_25pct: Optional[float]
    pct_dd_post2x_no3x_gt_30pct: Optional[float]
    pct_dd_post2x_no3x_gt_40pct: Optional[float]
    
    pct_dd_post3x_no4x_gt_5pct: Optional[float]
    pct_dd_post3x_no4x_gt_10pct: Optional[float]
    pct_dd_post3x_no4x_gt_15pct: Optional[float]
    pct_dd_post3x_no4x_gt_20pct: Optional[float]
    pct_dd_post3x_no4x_gt_25pct: Optional[float]
    pct_dd_post3x_no4x_gt_30pct: Optional[float]
    pct_dd_post3x_no4x_gt_40pct: Optional[float]
    
    pct_dd_post4x_no5x_gt_5pct: Optional[float]
    pct_dd_post4x_no5x_gt_10pct: Optional[float]
    pct_dd_post4x_no5x_gt_15pct: Optional[float]
    pct_dd_post4x_no5x_gt_20pct: Optional[float]
    pct_dd_post4x_no5x_gt_25pct: Optional[float]
    pct_dd_post4x_no5x_gt_30pct: Optional[float]
    pct_dd_post4x_no5x_gt_40pct: Optional[float]


def compute_post2x_dd(
    candles: List[Dict],
    entry_price: float,
    t0_ms: int,
    interval_seconds: int = 300,
) -> Post2xMetrics:
    """
    Compute post-2x drawdown metrics from candle data.
    
    Args:
        candles: List of candle dicts with keys: timestamp, high, low, close
        entry_price: Entry price (p0)
        t0_ms: Alert timestamp in milliseconds
        interval_seconds: Candle interval in seconds
        
    Returns:
        Post2xMetrics object
    """
    if not candles or entry_price <= 0:
        return Post2xMetrics(
            caller="",
            mint="",
            alert_id=None,
            hit_2x=False,
            hit_3x=False,
            hit_4x=False,
            hit_5x=False,
            t_2x_ms=None,
            t_3x_ms=None,
            t_4x_ms=None,
            t_5x_ms=None,
            entry_price=entry_price,
            dd_post2x_to3x_pct=None,
            dd_post2x_to4x_pct=None,
            dd_post2x_to5x_pct=None,
            dd_post2x_no3x_pct=None,
            dd_post3x_no4x_pct=None,
            dd_post4x_no5x_pct=None,
        )
    
    # Targets
    target_2x = entry_price * 2.0
    target_3x = entry_price * 3.0
    target_4x = entry_price * 4.0
    target_5x = entry_price * 5.0
    
    # Find first hit timestamps (using high)
    t_2x_ms: Optional[int] = None
    t_3x_ms: Optional[int] = None
    t_4x_ms: Optional[int] = None
    t_5x_ms: Optional[int] = None
    
    # Price at 2x (use the 2x price itself)
    price_at_2x = target_2x
    
    # Track minimum low in each window
    # For winners: track in [t2x, tNx] window
    min_low_post2x_to3x: Optional[float] = None
    min_low_post2x_to4x: Optional[float] = None
    min_low_post2x_to5x: Optional[float] = None
    
    # For non-winners: track in [t2x, end_of_data] window
    min_low_post2x_all: Optional[float] = None
    min_low_post3x_all: Optional[float] = None
    min_low_post4x_all: Optional[float] = None
    
    for candle in candles:
        # Convert timestamp to ms
        ts_val = candle['timestamp']
        from datetime import datetime as dt_class
        
        if isinstance(ts_val, dt_class):
            # DuckDB returns datetime objects
            ts_ms = int(ts_val.timestamp() * 1000)
        elif isinstance(ts_val, str):
            ts = dt_class.fromisoformat(ts_val.replace('Z', '+00:00'))
            ts_ms = int(ts.timestamp() * 1000)
        elif isinstance(ts_val, (int, float)):
            # Assume seconds if < year 2100, else ms
            ts_float = float(ts_val)
            if ts_float < 4102444800:  # 2100-01-01 in seconds
                ts_ms = int(ts_float * 1000)
            else:
                ts_ms = int(ts_float)
        else:
            continue
        
        high = float(candle['high'])
        low = float(candle['low'])
        
        # Detect first hits (using high)
        if t_2x_ms is None and high >= target_2x:
            t_2x_ms = ts_ms
            price_at_2x = target_2x  # Use target price as reference
        
        if t_3x_ms is None and high >= target_3x:
            t_3x_ms = ts_ms
        
        if t_4x_ms is None and high >= target_4x:
            t_4x_ms = ts_ms
        
        if t_5x_ms is None and high >= target_5x:
            t_5x_ms = ts_ms
        
        # Track minimum low in windows
        if t_2x_ms is not None and ts_ms >= t_2x_ms:
            # For WINNERS: track in specific windows [t2x, tNx]
            if t_3x_ms is not None and ts_ms <= t_3x_ms:
                if min_low_post2x_to3x is None or low < min_low_post2x_to3x:
                    min_low_post2x_to3x = low
            
            if t_4x_ms is not None and ts_ms <= t_4x_ms:
                if min_low_post2x_to4x is None or low < min_low_post2x_to4x:
                    min_low_post2x_to4x = low
            
            if t_5x_ms is not None and ts_ms <= t_5x_ms:
                if min_low_post2x_to5x is None or low < min_low_post2x_to5x:
                    min_low_post2x_to5x = low
            
            # For ALL post-2x candles (used for non-winners)
            if min_low_post2x_all is None or low < min_low_post2x_all:
                min_low_post2x_all = low
        
        # Track post-3x for 3x-but-not-4x
        if t_3x_ms is not None and ts_ms >= t_3x_ms:
            if min_low_post3x_all is None or low < min_low_post3x_all:
                min_low_post3x_all = low
        
        # Track post-4x for 4x-but-not-5x
        if t_4x_ms is not None and ts_ms >= t_4x_ms:
            if min_low_post4x_all is None or low < min_low_post4x_all:
                min_low_post4x_all = low
    
    # Compute drawdowns (positive magnitude: 0% to 100%)
    # DD = 1 - (min_price / price_at_2x)
    # If min_price > price_at_2x, DD is negative (price went up), clamp to 0
    
    # For WINNERS (reached next milestone)
    dd_post2x_to3x_pct = None
    if t_2x_ms is not None and t_3x_ms is not None and min_low_post2x_to3x is not None:
        dd_raw = 1.0 - (min_low_post2x_to3x / price_at_2x)
        dd_post2x_to3x_pct = max(0.0, dd_raw)  # Clamp to 0 if price went up
    
    dd_post2x_to4x_pct = None
    if t_2x_ms is not None and t_4x_ms is not None and min_low_post2x_to4x is not None:
        dd_raw = 1.0 - (min_low_post2x_to4x / price_at_2x)
        dd_post2x_to4x_pct = max(0.0, dd_raw)
    
    dd_post2x_to5x_pct = None
    if t_2x_ms is not None and t_5x_ms is not None and min_low_post2x_to5x is not None:
        dd_raw = 1.0 - (min_low_post2x_to5x / price_at_2x)
        dd_post2x_to5x_pct = max(0.0, dd_raw)
    
    # For NON-WINNERS (saved from nuke)
    dd_post2x_no3x_pct = None
    if t_2x_ms is not None and t_3x_ms is None and min_low_post2x_all is not None:
        # Hit 2x but NOT 3x - use entire post-2x window
        dd_raw = 1.0 - (min_low_post2x_all / price_at_2x)
        dd_post2x_no3x_pct = max(0.0, dd_raw)
    
    dd_post3x_no4x_pct = None
    if t_3x_ms is not None and t_4x_ms is None and min_low_post3x_all is not None:
        # Hit 3x but NOT 4x - use entire post-3x window
        price_at_3x = entry_price * 3.0
        dd_raw = 1.0 - (min_low_post3x_all / price_at_3x)
        dd_post3x_no4x_pct = max(0.0, dd_raw)
    
    dd_post4x_no5x_pct = None
    if t_4x_ms is not None and t_5x_ms is None and min_low_post4x_all is not None:
        # Hit 4x but NOT 5x - use entire post-4x window
        price_at_4x = entry_price * 4.0
        dd_raw = 1.0 - (min_low_post4x_all / price_at_4x)
        dd_post4x_no5x_pct = max(0.0, dd_raw)
    
    return Post2xMetrics(
        caller="",  # Will be filled by caller
        mint="",  # Will be filled by caller
        alert_id=None,
        hit_2x=t_2x_ms is not None,
        hit_3x=t_3x_ms is not None,
        hit_4x=t_4x_ms is not None,
        hit_5x=t_5x_ms is not None,
        t_2x_ms=t_2x_ms,
        t_3x_ms=t_3x_ms,
        t_4x_ms=t_4x_ms,
        t_5x_ms=t_5x_ms,
        entry_price=entry_price,
        dd_post2x_to3x_pct=dd_post2x_to3x_pct,
        dd_post2x_to4x_pct=dd_post2x_to4x_pct,
        dd_post2x_to5x_pct=dd_post2x_to5x_pct,
        dd_post2x_no3x_pct=dd_post2x_no3x_pct,
        dd_post3x_no4x_pct=dd_post3x_no4x_pct,
        dd_post4x_no5x_pct=dd_post4x_no5x_pct,
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
        import sys
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


def compute_distribution_stats(
    values: List[float],
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Compute p50, p75, p90 percentiles."""
    if not values:
        return None, None, None
    
    arr = np.array(values)
    p50 = float(np.percentile(arr, 50))
    p75 = float(np.percentile(arr, 75))
    p90 = float(np.percentile(arr, 90))
    return p50, p75, p90


def aggregate_by_caller(
    metrics_list: List[Post2xMetrics],
) -> List[CallerDistribution]:
    """Aggregate metrics by caller and compute distribution statistics."""
    by_caller: Dict[str, List[Post2xMetrics]] = defaultdict(list)
    
    for m in metrics_list:
        if m.caller:
            by_caller[m.caller].append(m)
    
    distributions: List[CallerDistribution] = []
    
    for caller, metrics in sorted(by_caller.items()):
        n_calls = len(metrics)
        n_hit_2x = sum(1 for m in metrics if m.hit_2x)
        n_hit_2x_and_3x = sum(1 for m in metrics if m.hit_2x and m.hit_3x)
        n_hit_2x_and_4x = sum(1 for m in metrics if m.hit_2x and m.hit_4x)
        n_hit_2x_and_5x = sum(1 for m in metrics if m.hit_2x and m.hit_5x)
        
        # NON-winners (saved from nuke)
        n_hit_2x_not_3x = sum(1 for m in metrics if m.hit_2x and not m.hit_3x)
        n_hit_3x_not_4x = sum(1 for m in metrics if m.hit_3x and not m.hit_4x)
        n_hit_4x_not_5x = sum(1 for m in metrics if m.hit_4x and not m.hit_5x)
        
        # Collect drawdown values for WINNERS (reach next milestone)
        dd_2x_to3x = [m.dd_post2x_to3x_pct for m in metrics if m.dd_post2x_to3x_pct is not None]
        dd_2x_to4x = [m.dd_post2x_to4x_pct for m in metrics if m.dd_post2x_to4x_pct is not None]
        dd_2x_to5x = [m.dd_post2x_to5x_pct for m in metrics if m.dd_post2x_to5x_pct is not None]
        
        # Collect drawdown values for NON-WINNERS (saved from nuke)
        dd_2x_no3x = [m.dd_post2x_no3x_pct for m in metrics if m.dd_post2x_no3x_pct is not None]
        dd_3x_no4x = [m.dd_post3x_no4x_pct for m in metrics if m.dd_post3x_no4x_pct is not None]
        dd_4x_no5x = [m.dd_post4x_no5x_pct for m in metrics if m.dd_post4x_no5x_pct is not None]
        
        # Distribution stats for winners
        p50_3x, p75_3x, p90_3x = compute_distribution_stats(dd_2x_to3x)
        p50_4x, p75_4x, p90_4x = compute_distribution_stats(dd_2x_to4x)
        p50_5x, p75_5x, p90_5x = compute_distribution_stats(dd_2x_to5x)
        
        # Distribution stats for non-winners
        p50_2x_no3x, p75_2x_no3x, p90_2x_no3x = compute_distribution_stats(dd_2x_no3x)
        p50_3x_no4x, p75_3x_no4x, p90_3x_no4x = compute_distribution_stats(dd_3x_no4x)
        p50_4x_no5x, p75_4x_no5x, p90_4x_no5x = compute_distribution_stats(dd_4x_no5x)
        
        # Percentage thresholds (capture/save rates)
        def pct_lte(values: List[float], threshold: float) -> Optional[float]:
            """Percentage of values <= threshold (capture rate for winners)."""
            if not values:
                return None
            count = sum(1 for v in values if v <= threshold)
            return (count / len(values)) * 100.0
        
        def pct_gt(values: List[float], threshold: float) -> Optional[float]:
            """Percentage of values > threshold (save rate for losers)."""
            if not values:
                return None
            count = sum(1 for v in values if v > threshold)
            return (count / len(values)) * 100.0
        
        dist = CallerDistribution(
            caller=caller,
            n_calls=n_calls,
            n_hit_2x=n_hit_2x,
            n_hit_2x_and_3x=n_hit_2x_and_3x,
            n_hit_2x_and_4x=n_hit_2x_and_4x,
            n_hit_2x_and_5x=n_hit_2x_and_5x,
            n_hit_2x_not_3x=n_hit_2x_not_3x,
            n_hit_3x_not_4x=n_hit_3x_not_4x,
            n_hit_4x_not_5x=n_hit_4x_not_5x,
            # Winners (reach next milestone)
            dd_post2x_to3x_p50=p50_3x,
            dd_post2x_to3x_p75=p75_3x,
            dd_post2x_to3x_p90=p90_3x,
            dd_post2x_to4x_p50=p50_4x,
            dd_post2x_to4x_p75=p75_4x,
            dd_post2x_to4x_p90=p90_4x,
            dd_post2x_to5x_p50=p50_5x,
            dd_post2x_to5x_p75=p75_5x,
            dd_post2x_to5x_p90=p90_5x,
            # Non-winners (saved from nuke)
            dd_post2x_no3x_p50=p50_2x_no3x,
            dd_post2x_no3x_p75=p75_2x_no3x,
            dd_post2x_no3x_p90=p90_2x_no3x,
            dd_post3x_no4x_p50=p50_3x_no4x,
            dd_post3x_no4x_p75=p75_3x_no4x,
            dd_post3x_no4x_p90=p90_3x_no4x,
            dd_post4x_no5x_p50=p50_4x_no5x,
            dd_post4x_no5x_p75=p75_4x_no5x,
            dd_post4x_no5x_p90=p90_4x_no5x,
            # 2x→3x stopout rates
            # Capture rates for winners (Keep@X% = % of winners captured with X% trail)
            pct_dd_post2x_to3x_gt_5pct=pct_lte(dd_2x_to3x, 0.05),
            pct_dd_post2x_to3x_gt_10pct=pct_lte(dd_2x_to3x, 0.10),
            pct_dd_post2x_to3x_gt_15pct=pct_lte(dd_2x_to3x, 0.15),
            pct_dd_post2x_to3x_gt_20pct=pct_lte(dd_2x_to3x, 0.20),
            pct_dd_post2x_to3x_gt_25pct=pct_lte(dd_2x_to3x, 0.25),
            pct_dd_post2x_to3x_gt_30pct=pct_lte(dd_2x_to3x, 0.30),
            pct_dd_post2x_to3x_gt_40pct=pct_lte(dd_2x_to3x, 0.40),
            # 2x→4x capture rates
            pct_dd_post2x_to4x_gt_5pct=pct_lte(dd_2x_to4x, 0.05),
            pct_dd_post2x_to4x_gt_10pct=pct_lte(dd_2x_to4x, 0.10),
            pct_dd_post2x_to4x_gt_15pct=pct_lte(dd_2x_to4x, 0.15),
            pct_dd_post2x_to4x_gt_20pct=pct_lte(dd_2x_to4x, 0.20),
            pct_dd_post2x_to4x_gt_25pct=pct_lte(dd_2x_to4x, 0.25),
            pct_dd_post2x_to4x_gt_30pct=pct_lte(dd_2x_to4x, 0.30),
            pct_dd_post2x_to4x_gt_40pct=pct_lte(dd_2x_to4x, 0.40),
            # 2x→5x capture rates
            pct_dd_post2x_to5x_gt_5pct=pct_lte(dd_2x_to5x, 0.05),
            pct_dd_post2x_to5x_gt_10pct=pct_lte(dd_2x_to5x, 0.10),
            pct_dd_post2x_to5x_gt_15pct=pct_lte(dd_2x_to5x, 0.15),
            pct_dd_post2x_to5x_gt_20pct=pct_lte(dd_2x_to5x, 0.20),
            pct_dd_post2x_to5x_gt_25pct=pct_lte(dd_2x_to5x, 0.25),
            pct_dd_post2x_to5x_gt_30pct=pct_lte(dd_2x_to5x, 0.30),
            pct_dd_post2x_to5x_gt_40pct=pct_lte(dd_2x_to5x, 0.40),
            # Non-winners stopout rates (saved from nuke)
            pct_dd_post2x_no3x_gt_5pct=pct_gt(dd_2x_no3x, 0.05),
            pct_dd_post2x_no3x_gt_10pct=pct_gt(dd_2x_no3x, 0.10),
            pct_dd_post2x_no3x_gt_15pct=pct_gt(dd_2x_no3x, 0.15),
            pct_dd_post2x_no3x_gt_20pct=pct_gt(dd_2x_no3x, 0.20),
            pct_dd_post2x_no3x_gt_25pct=pct_gt(dd_2x_no3x, 0.25),
            pct_dd_post2x_no3x_gt_30pct=pct_gt(dd_2x_no3x, 0.30),
            pct_dd_post2x_no3x_gt_40pct=pct_gt(dd_2x_no3x, 0.40),
            pct_dd_post3x_no4x_gt_5pct=pct_gt(dd_3x_no4x, 0.05),
            pct_dd_post3x_no4x_gt_10pct=pct_gt(dd_3x_no4x, 0.10),
            pct_dd_post3x_no4x_gt_15pct=pct_gt(dd_3x_no4x, 0.15),
            pct_dd_post3x_no4x_gt_20pct=pct_gt(dd_3x_no4x, 0.20),
            pct_dd_post3x_no4x_gt_25pct=pct_gt(dd_3x_no4x, 0.25),
            pct_dd_post3x_no4x_gt_30pct=pct_gt(dd_3x_no4x, 0.30),
            pct_dd_post3x_no4x_gt_40pct=pct_gt(dd_3x_no4x, 0.40),
            pct_dd_post4x_no5x_gt_5pct=pct_gt(dd_4x_no5x, 0.05),
            pct_dd_post4x_no5x_gt_10pct=pct_gt(dd_4x_no5x, 0.10),
            pct_dd_post4x_no5x_gt_15pct=pct_gt(dd_4x_no5x, 0.15),
            pct_dd_post4x_no5x_gt_20pct=pct_gt(dd_4x_no5x, 0.20),
            pct_dd_post4x_no5x_gt_25pct=pct_gt(dd_4x_no5x, 0.25),
            pct_dd_post4x_no5x_gt_30pct=pct_gt(dd_4x_no5x, 0.30),
            pct_dd_post4x_no5x_gt_40pct=pct_gt(dd_4x_no5x, 0.40),
        )
        distributions.append(dist)
    
    return distributions


def main():
    parser = argparse.ArgumentParser(
        description="Analyze post-2x drawdown distributions per caller"
    )
    parser.add_argument(
        "--duckdb",
        required=True,
        help="Path to DuckDB alerts database",
    )
    parser.add_argument(
        "--slice",
        required=True,
        type=Path,
        help="Path to Parquet slice (file or directory)",
    )
    parser.add_argument(
        "--chain",
        default="solana",
        help="Chain name (default: solana)",
    )
    parser.add_argument(
        "--date-from",
        help="Start date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--date-to",
        help="End date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=300,
        help="Candle interval in seconds (default: 300 = 5m)",
    )
    parser.add_argument(
        "--horizon-hours",
        type=int,
        default=48,
        help="Lookforward window in hours (default: 48)",
    )
    parser.add_argument(
        "--min-calls",
        type=int,
        default=10,
        help="Minimum calls per caller to include (default: 10)",
    )
    parser.add_argument(
        "--output",
        choices=["json", "table"],
        default="table",
        help="Output format (default: table)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print progress",
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=8,
        help="Number of parallel threads for processing (default: 8)",
    )
    
    args = parser.parse_args()
    
    # Initialize global semaphore to limit concurrent DuckDB connections
    # Limit to 4 concurrent connections regardless of thread count to prevent resource exhaustion
    global _duckdb_semaphore
    _duckdb_semaphore = Semaphore(min(4, args.threads))
    
    # Load alerts
    from datetime import datetime
    date_from = datetime.fromisoformat(args.date_from) if args.date_from else datetime(2024, 1, 1)
    date_to = datetime.fromisoformat(args.date_to) if args.date_to else datetime.now()
    
    if args.verbose:
        print(f"Loading alerts from {args.duckdb}...", file=sys.stderr)
    
    alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
    
    if args.verbose:
        print(f"Loaded {len(alerts)} alerts", file=sys.stderr)
    
    # Process alerts in parallel
    metrics_list: List[Post2xMetrics] = []
    horizon_ms = args.horizon_hours * 3600 * 1000
    
    def process_alert(alert_data):
        """Process a single alert (for parallel execution)."""
        try:
            i, alert = alert_data
            
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
        except KeyboardInterrupt:
            raise
        except Exception as e:
            if args.verbose:
                print(f"Error in process_alert: {e}", file=sys.stderr)
            return None
        
        if not candles:
            return None
        
        # Find entry price (first candle close at/after entry)
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
        
        # Compute metrics
        metrics = compute_post2x_dd(
            candles,
            entry_price,
            alert.ts_ms,
            args.interval_seconds,
        )
        metrics.caller = alert.caller
        metrics.mint = alert.mint
        
        return metrics
    
    # Use ThreadPoolExecutor for parallel processing
    if args.verbose:
        print(f"Processing {len(alerts)} alerts with {args.threads} threads...", file=sys.stderr)
    
    with ThreadPoolExecutor(max_workers=args.threads) as executor:
        # Submit all tasks
        futures = {
            executor.submit(process_alert, (i, alert)): i 
            for i, alert in enumerate(alerts)
        }
        
        # Collect results as they complete
        completed = 0
        for future in as_completed(futures):
            completed += 1
            if args.verbose and completed % 100 == 0:
                print(f"Processed {completed}/{len(alerts)} alerts...", file=sys.stderr)
            
            try:
                result = future.result(timeout=30)  # 30 second timeout per alert
                if result is not None:
                    metrics_list.append(result)
            except Exception as e:
                if args.verbose:
                    alert_idx = futures[future]
                    alert = alerts[alert_idx]
                    print(f"Warning: Timeout or error processing alert {alert_idx} (mint: {alert.mint}): {e}", file=sys.stderr)
    
    if args.verbose:
        print(f"Computed metrics for {len(metrics_list)} calls", file=sys.stderr)
    
    # Aggregate by caller
    distributions = aggregate_by_caller(metrics_list)
    
    # Filter by min calls
    distributions = [d for d in distributions if d.n_calls >= args.min_calls]
    
    # Sort by n_hit_2x_and_3x descending (most relevant first)
    distributions.sort(key=lambda d: d.n_hit_2x_and_3x or 0, reverse=True)
    
    # Output
    if args.output == "json":
        output = []
        for dist in distributions:
            output.append({
                "caller": dist.caller,
                "n_calls": dist.n_calls,
                "n_hit_2x": dist.n_hit_2x,
                "n_hit_2x_and_3x": dist.n_hit_2x_and_3x,
                "n_hit_2x_and_4x": dist.n_hit_2x_and_4x,
                "n_hit_2x_and_5x": dist.n_hit_2x_and_5x,
                "dd_post2x_to3x": {
                    "p50_pct": dist.dd_post2x_to3x_p50 * 100.0 if dist.dd_post2x_to3x_p50 is not None else None,
                    "p75_pct": dist.dd_post2x_to3x_p75 * 100.0 if dist.dd_post2x_to3x_p75 is not None else None,
                    "p90_pct": dist.dd_post2x_to3x_p90 * 100.0 if dist.dd_post2x_to3x_p90 is not None else None,
                    "stopout_5pct": dist.pct_dd_post2x_to3x_gt_5pct,
                    "stopout_10pct": dist.pct_dd_post2x_to3x_gt_10pct,
                    "stopout_15pct": dist.pct_dd_post2x_to3x_gt_15pct,
                    "stopout_20pct": dist.pct_dd_post2x_to3x_gt_20pct,
                    "stopout_25pct": dist.pct_dd_post2x_to3x_gt_25pct,
                    "stopout_30pct": dist.pct_dd_post2x_to3x_gt_30pct,
                    "stopout_40pct": dist.pct_dd_post2x_to3x_gt_40pct,
                },
                "dd_post2x_to4x": {
                    "p50_pct": dist.dd_post2x_to4x_p50 * 100.0 if dist.dd_post2x_to4x_p50 is not None else None,
                    "p75_pct": dist.dd_post2x_to4x_p75 * 100.0 if dist.dd_post2x_to4x_p75 is not None else None,
                    "p90_pct": dist.dd_post2x_to4x_p90 * 100.0 if dist.dd_post2x_to4x_p90 is not None else None,
                    "stopout_5pct": dist.pct_dd_post2x_to4x_gt_5pct,
                    "stopout_10pct": dist.pct_dd_post2x_to4x_gt_10pct,
                    "stopout_15pct": dist.pct_dd_post2x_to4x_gt_15pct,
                    "stopout_20pct": dist.pct_dd_post2x_to4x_gt_20pct,
                    "stopout_25pct": dist.pct_dd_post2x_to4x_gt_25pct,
                    "stopout_30pct": dist.pct_dd_post2x_to4x_gt_30pct,
                    "stopout_40pct": dist.pct_dd_post2x_to4x_gt_40pct,
                },
                "dd_post2x_to5x": {
                    "p50_pct": dist.dd_post2x_to5x_p50 * 100.0 if dist.dd_post2x_to5x_p50 is not None else None,
                    "p75_pct": dist.dd_post2x_to5x_p75 * 100.0 if dist.dd_post2x_to5x_p75 is not None else None,
                    "p90_pct": dist.dd_post2x_to5x_p90 * 100.0 if dist.dd_post2x_to5x_p90 is not None else None,
                    "stopout_5pct": dist.pct_dd_post2x_to5x_gt_5pct,
                    "stopout_10pct": dist.pct_dd_post2x_to5x_gt_10pct,
                    "stopout_15pct": dist.pct_dd_post2x_to5x_gt_15pct,
                    "stopout_20pct": dist.pct_dd_post2x_to5x_gt_20pct,
                    "stopout_25pct": dist.pct_dd_post2x_to5x_gt_25pct,
                    "stopout_30pct": dist.pct_dd_post2x_to5x_gt_30pct,
                    "stopout_40pct": dist.pct_dd_post2x_to5x_gt_40pct,
                },
            })
        print(json.dumps(output, indent=2))
    else:
        # Table output - show all three metrics (2x→3x, 2x→4x, 2x→5x)
        print("\n" + "=" * 160)
        print("POST-2X DRAWDOWN ANALYSIS BY CALLER")
        print("=" * 160)
        print("\nDD_2x→3x (tokens that reached 3x)")
        print("-" * 160)
        print(f"{'Caller':<25} {'N':>4} {'2x→3x':>6} {'p50':>6} {'p75':>6} {'p90':>6} ", end="")
        print(f"{'Keep@5%':>8} {'Keep@10%':>9} {'Keep@15%':>9} {'Keep@20%':>9} {'Keep@25%':>9} {'Keep@30%':>9} {'Keep@40%':>9}")
        print("-" * 160)
        
        for dist in distributions:
            if dist.n_hit_2x_and_3x == 0:
                continue
            
            p50 = f"{dist.dd_post2x_to3x_p50*100:.1f}%" if dist.dd_post2x_to3x_p50 is not None else "N/A"
            p75 = f"{dist.dd_post2x_to3x_p75*100:.1f}%" if dist.dd_post2x_to3x_p75 is not None else "N/A"
            p90 = f"{dist.dd_post2x_to3x_p90*100:.1f}%" if dist.dd_post2x_to3x_p90 is not None else "N/A"
            
            print(f"{dist.caller:<25} {dist.n_calls:>4} {dist.n_hit_2x_and_3x:>6} {p50:>6} {p75:>6} {p90:>6} ", end="")
            print(f"{dist.pct_dd_post2x_to3x_gt_5pct:>7.1f}%" if dist.pct_dd_post2x_to3x_gt_5pct is not None else "     N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to3x_gt_10pct:>8.1f}%" if dist.pct_dd_post2x_to3x_gt_10pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to3x_gt_15pct:>8.1f}%" if dist.pct_dd_post2x_to3x_gt_15pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to3x_gt_20pct:>8.1f}%" if dist.pct_dd_post2x_to3x_gt_20pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to3x_gt_25pct:>8.1f}%" if dist.pct_dd_post2x_to3x_gt_25pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to3x_gt_30pct:>8.1f}%" if dist.pct_dd_post2x_to3x_gt_30pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to3x_gt_40pct:>8.1f}%" if dist.pct_dd_post2x_to3x_gt_40pct is not None else "      N/A")
        
        print("\n" + "-" * 160)
        print("\nDD_2x→4x (tokens that reached 4x)")
        print("-" * 160)
        print(f"{'Caller':<25} {'N':>4} {'2x→4x':>6} {'p50':>6} {'p75':>6} {'p90':>6} ", end="")
        print(f"{'Keep@5%':>8} {'Keep@10%':>9} {'Keep@15%':>9} {'Keep@20%':>9} {'Keep@25%':>9} {'Keep@30%':>9} {'Keep@40%':>9}")
        print("-" * 160)
        
        for dist in distributions:
            if dist.n_hit_2x_and_4x == 0:
                continue
            
            p50 = f"{dist.dd_post2x_to4x_p50*100:.1f}%" if dist.dd_post2x_to4x_p50 is not None else "N/A"
            p75 = f"{dist.dd_post2x_to4x_p75*100:.1f}%" if dist.dd_post2x_to4x_p75 is not None else "N/A"
            p90 = f"{dist.dd_post2x_to4x_p90*100:.1f}%" if dist.dd_post2x_to4x_p90 is not None else "N/A"
            
            print(f"{dist.caller:<25} {dist.n_calls:>4} {dist.n_hit_2x_and_4x:>6} {p50:>6} {p75:>6} {p90:>6} ", end="")
            print(f"{dist.pct_dd_post2x_to4x_gt_5pct:>7.1f}%" if dist.pct_dd_post2x_to4x_gt_5pct is not None else "     N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to4x_gt_10pct:>8.1f}%" if dist.pct_dd_post2x_to4x_gt_10pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to4x_gt_15pct:>8.1f}%" if dist.pct_dd_post2x_to4x_gt_15pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to4x_gt_20pct:>8.1f}%" if dist.pct_dd_post2x_to4x_gt_20pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to4x_gt_25pct:>8.1f}%" if dist.pct_dd_post2x_to4x_gt_25pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to4x_gt_30pct:>8.1f}%" if dist.pct_dd_post2x_to4x_gt_30pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to4x_gt_40pct:>8.1f}%" if dist.pct_dd_post2x_to4x_gt_40pct is not None else "      N/A")
        
        print("\n" + "-" * 160)
        print("\nDD_2x→5x (tokens that reached 5x)")
        print("-" * 160)
        print(f"{'Caller':<25} {'N':>4} {'2x→5x':>6} {'p50':>6} {'p75':>6} {'p90':>6} ", end="")
        print(f"{'Keep@5%':>8} {'Keep@10%':>9} {'Keep@15%':>9} {'Keep@20%':>9} {'Keep@25%':>9} {'Keep@30%':>9} {'Keep@40%':>9}")
        print("-" * 160)
        
        for dist in distributions:
            if dist.n_hit_2x_and_5x == 0:
                continue
            
            p50 = f"{dist.dd_post2x_to5x_p50*100:.1f}%" if dist.dd_post2x_to5x_p50 is not None else "N/A"
            p75 = f"{dist.dd_post2x_to5x_p75*100:.1f}%" if dist.dd_post2x_to5x_p75 is not None else "N/A"
            p90 = f"{dist.dd_post2x_to5x_p90*100:.1f}%" if dist.dd_post2x_to5x_p90 is not None else "N/A"
            
            print(f"{dist.caller:<25} {dist.n_calls:>4} {dist.n_hit_2x_and_5x:>6} {p50:>6} {p75:>6} {p90:>6} ", end="")
            print(f"{dist.pct_dd_post2x_to5x_gt_5pct:>7.1f}%" if dist.pct_dd_post2x_to5x_gt_5pct is not None else "     N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to5x_gt_10pct:>8.1f}%" if dist.pct_dd_post2x_to5x_gt_10pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to5x_gt_15pct:>8.1f}%" if dist.pct_dd_post2x_to5x_gt_15pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to5x_gt_20pct:>8.1f}%" if dist.pct_dd_post2x_to5x_gt_20pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to5x_gt_25pct:>8.1f}%" if dist.pct_dd_post2x_to5x_gt_25pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to5x_gt_30pct:>8.1f}%" if dist.pct_dd_post2x_to5x_gt_30pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_to5x_gt_40pct:>8.1f}%" if dist.pct_dd_post2x_to5x_gt_40pct is not None else "      N/A")
        
        # Add NON-WINNERS table (saved from nuke)
        print("\n" + "-" * 160)
        print("\nDD_2x_NO3x (tokens that hit 2x but NEVER hit 3x - saved from nuke)")
        print("-" * 160)
        print(f"{'Caller':<25} {'N':>4} {'2x¬3x':>6} {'p50':>6} {'p75':>6} {'p90':>6} ", end="")
        print(f"{'Save@5%':>8} {'Save@10%':>9} {'Save@15%':>9} {'Save@20%':>9} {'Save@25%':>9} {'Save@30%':>9} {'Save@40%':>9}")
        print("-" * 160)
        
        for dist in distributions:
            if dist.n_hit_2x_not_3x == 0:
                continue
            
            p50 = f"{dist.dd_post2x_no3x_p50*100:.1f}%" if dist.dd_post2x_no3x_p50 is not None else "N/A"
            p75 = f"{dist.dd_post2x_no3x_p75*100:.1f}%" if dist.dd_post2x_no3x_p75 is not None else "N/A"
            p90 = f"{dist.dd_post2x_no3x_p90*100:.1f}%" if dist.dd_post2x_no3x_p90 is not None else "N/A"
            
            print(f"{dist.caller:<25} {dist.n_calls:>4} {dist.n_hit_2x_not_3x:>6} {p50:>6} {p75:>6} {p90:>6} ", end="")
            print(f"{dist.pct_dd_post2x_no3x_gt_5pct:>7.1f}%" if dist.pct_dd_post2x_no3x_gt_5pct is not None else "     N/A", end=" ")
            print(f"{dist.pct_dd_post2x_no3x_gt_10pct:>8.1f}%" if dist.pct_dd_post2x_no3x_gt_10pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_no3x_gt_15pct:>8.1f}%" if dist.pct_dd_post2x_no3x_gt_15pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_no3x_gt_20pct:>8.1f}%" if dist.pct_dd_post2x_no3x_gt_20pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_no3x_gt_25pct:>8.1f}%" if dist.pct_dd_post2x_no3x_gt_25pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_no3x_gt_30pct:>8.1f}%" if dist.pct_dd_post2x_no3x_gt_30pct is not None else "      N/A", end=" ")
            print(f"{dist.pct_dd_post2x_no3x_gt_40pct:>8.1f}%" if dist.pct_dd_post2x_no3x_gt_40pct is not None else "      N/A")
        
        print("\n" + "=" * 160)
        print("\n+EV ANALYSIS:")
        print("- Keep@X% on WINNERS: % of 3x/4x/5x runners you'd CAPTURE with X% trailing stop")
        print("- Save@X% on NON-WINNERS: % of nukes you'd exit before full round-trip")
        print("\nIf Save@X% is high AND Keep@X% is high, the stop is +EV")
        print("\nExample: If Keep@20% = 85% and Save@20% = 80%, a 20% trail is highly +EV")
        print("         (You capture 85% of winners AND save 80% of losers from full nuke)")
        print("\nLadder Design:")
        print("- After 2x: Choose X% where Keep@X% is high (>80%) AND Save@X% is high (>70%)")
        print("- After 3x: Tighten (continuation is stronger, fewer nukes)")
        print("- After 4x: Tighten more (rare territory, protect gains)")


if __name__ == "__main__":
    main()

