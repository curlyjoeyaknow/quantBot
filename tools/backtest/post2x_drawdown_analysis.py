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
from typing import Dict, List, Optional, Tuple

import numpy as np

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
    
    # Percentage requiring >X% drawdown (e.g., >20% = 0.20)
    pct_dd_post2x_to3x_gt_10pct: Optional[float]
    pct_dd_post2x_to3x_gt_20pct: Optional[float]
    pct_dd_post2x_to3x_gt_30pct: Optional[float]
    
    pct_dd_post2x_to4x_gt_10pct: Optional[float]
    pct_dd_post2x_to4x_gt_20pct: Optional[float]
    pct_dd_post2x_to4x_gt_30pct: Optional[float]
    
    pct_dd_post2x_to5x_gt_10pct: Optional[float]
    pct_dd_post2x_to5x_gt_20pct: Optional[float]
    pct_dd_post2x_to5x_gt_30pct: Optional[float]


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
    min_low_post2x_to3x: Optional[float] = None
    min_low_post2x_to4x: Optional[float] = None
    min_low_post2x_to5x: Optional[float] = None
    
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
        if t_2x_ms is not None:
            # Window [t2x, t3x] for dd_post2x_to3x
            if t_3x_ms is not None and ts_ms >= t_2x_ms and ts_ms <= t_3x_ms:
                if min_low_post2x_to3x is None or low < min_low_post2x_to3x:
                    min_low_post2x_to3x = low
            
            # Window [t2x, t4x] for dd_post2x_to4x
            if t_4x_ms is not None and ts_ms >= t_2x_ms and ts_ms <= t_4x_ms:
                if min_low_post2x_to4x is None or low < min_low_post2x_to4x:
                    min_low_post2x_to4x = low
            
            # Window [t2x, t5x] for dd_post2x_to5x
            if t_5x_ms is not None and ts_ms >= t_2x_ms and ts_ms <= t_5x_ms:
                if min_low_post2x_to5x is None or low < min_low_post2x_to5x:
                    min_low_post2x_to5x = low
    
    # Compute drawdowns
    # DD = 1 - (min_price / price_at_2x)
    dd_post2x_to3x_pct = None
    if t_2x_ms is not None and t_3x_ms is not None and min_low_post2x_to3x is not None:
        dd_post2x_to3x_pct = 1.0 - (min_low_post2x_to3x / price_at_2x)
    
    dd_post2x_to4x_pct = None
    if t_2x_ms is not None and t_4x_ms is not None and min_low_post2x_to4x is not None:
        dd_post2x_to4x_pct = 1.0 - (min_low_post2x_to4x / price_at_2x)
    
    dd_post2x_to5x_pct = None
    if t_2x_ms is not None and t_5x_ms is not None and min_low_post2x_to5x is not None:
        dd_post2x_to5x_pct = 1.0 - (min_low_post2x_to5x / price_at_2x)
    
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
    
    con = duckdb.connect(":memory:")
    try:
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
    finally:
        con.close()


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
        
        # Collect drawdown values
        dd_2x_to3x = [m.dd_post2x_to3x_pct for m in metrics if m.dd_post2x_to3x_pct is not None]
        dd_2x_to4x = [m.dd_post2x_to4x_pct for m in metrics if m.dd_post2x_to4x_pct is not None]
        dd_2x_to5x = [m.dd_post2x_to5x_pct for m in metrics if m.dd_post2x_to5x_pct is not None]
        
        # Distribution stats
        p50_3x, p75_3x, p90_3x = compute_distribution_stats(dd_2x_to3x)
        p50_4x, p75_4x, p90_4x = compute_distribution_stats(dd_2x_to4x)
        p50_5x, p75_5x, p90_5x = compute_distribution_stats(dd_2x_to5x)
        
        # Percentage thresholds
        def pct_gt(values: List[float], threshold: float) -> Optional[float]:
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
            dd_post2x_to3x_p50=p50_3x,
            dd_post2x_to3x_p75=p75_3x,
            dd_post2x_to3x_p90=p90_3x,
            dd_post2x_to4x_p50=p50_4x,
            dd_post2x_to4x_p75=p75_4x,
            dd_post2x_to4x_p90=p90_4x,
            dd_post2x_to5x_p50=p50_5x,
            dd_post2x_to5x_p75=p75_5x,
            dd_post2x_to5x_p90=p90_5x,
            pct_dd_post2x_to3x_gt_10pct=pct_gt(dd_2x_to3x, 0.10),
            pct_dd_post2x_to3x_gt_20pct=pct_gt(dd_2x_to3x, 0.20),
            pct_dd_post2x_to3x_gt_30pct=pct_gt(dd_2x_to3x, 0.30),
            pct_dd_post2x_to4x_gt_10pct=pct_gt(dd_2x_to4x, 0.10),
            pct_dd_post2x_to4x_gt_20pct=pct_gt(dd_2x_to4x, 0.20),
            pct_dd_post2x_to4x_gt_30pct=pct_gt(dd_2x_to4x, 0.30),
            pct_dd_post2x_to5x_gt_10pct=pct_gt(dd_2x_to5x, 0.10),
            pct_dd_post2x_to5x_gt_20pct=pct_gt(dd_2x_to5x, 0.20),
            pct_dd_post2x_to5x_gt_30pct=pct_gt(dd_2x_to5x, 0.30),
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
            
            result = future.result()
            if result is not None:
                metrics_list.append(result)
    
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
                    "pct_gt_10pct": dist.pct_dd_post2x_to3x_gt_10pct,
                    "pct_gt_20pct": dist.pct_dd_post2x_to3x_gt_20pct,
                    "pct_gt_30pct": dist.pct_dd_post2x_to3x_gt_30pct,
                },
                "dd_post2x_to4x": {
                    "p50_pct": dist.dd_post2x_to4x_p50 * 100.0 if dist.dd_post2x_to4x_p50 is not None else None,
                    "p75_pct": dist.dd_post2x_to4x_p75 * 100.0 if dist.dd_post2x_to4x_p75 is not None else None,
                    "p90_pct": dist.dd_post2x_to4x_p90 * 100.0 if dist.dd_post2x_to4x_p90 is not None else None,
                    "pct_gt_10pct": dist.pct_dd_post2x_to4x_gt_10pct,
                    "pct_gt_20pct": dist.pct_dd_post2x_to4x_gt_20pct,
                    "pct_gt_30pct": dist.pct_dd_post2x_to4x_gt_30pct,
                },
                "dd_post2x_to5x": {
                    "p50_pct": dist.dd_post2x_to5x_p50 * 100.0 if dist.dd_post2x_to5x_p50 is not None else None,
                    "p75_pct": dist.dd_post2x_to5x_p75 * 100.0 if dist.dd_post2x_to5x_p75 is not None else None,
                    "p90_pct": dist.dd_post2x_to5x_p90 * 100.0 if dist.dd_post2x_to5x_p90 is not None else None,
                    "pct_gt_10pct": dist.pct_dd_post2x_to5x_gt_10pct,
                    "pct_gt_20pct": dist.pct_dd_post2x_to5x_gt_20pct,
                    "pct_gt_30pct": dist.pct_dd_post2x_to5x_gt_30pct,
                },
            })
        print(json.dumps(output, indent=2))
    else:
        # Table output
        print("\nPost-2x Drawdown Analysis by Caller")
        print("=" * 120)
        print(f"{'Caller':<20} {'Calls':>6} {'Hit2x':>6} {'2x→3x':>6} {'2x→4x':>6} {'2x→5x':>6} ", end="")
        print(f"{'DD_2x→3x (p50/p75/p90 %)':<25} {'%>10%':>7} {'%>20%':>7} {'%>30%':>7}")
        print("-" * 120)
        
        for dist in distributions:
            if dist.n_hit_2x_and_3x == 0:
                continue  # Skip callers with no 2x→3x data
            
            dd_3x_str = "N/A"
            if dist.dd_post2x_to3x_p50 is not None:
                p50 = dist.dd_post2x_to3x_p50 * 100.0
                p75 = dist.dd_post2x_to3x_p75 * 100.0 if dist.dd_post2x_to3x_p75 is not None else None
                p90 = dist.dd_post2x_to3x_p90 * 100.0 if dist.dd_post2x_to3x_p90 is not None else None
                dd_3x_str = f"{p50:.1f}/{p75:.1f}/{p90:.1f}" if p75 and p90 else f"{p50:.1f}"
            
            pct_gt_10 = dist.pct_dd_post2x_to3x_gt_10pct
            pct_gt_20 = dist.pct_dd_post2x_to3x_gt_20pct
            pct_gt_30 = dist.pct_dd_post2x_to3x_gt_30pct
            
            print(f"{dist.caller:<20} {dist.n_calls:>6} {dist.n_hit_2x:>6} {dist.n_hit_2x_and_3x:>6} "
                  f"{dist.n_hit_2x_and_4x:>6} {dist.n_hit_2x_and_5x:>6} {dd_3x_str:<25} ", end="")
            print(f"{pct_gt_10:.1f}%" if pct_gt_10 is not None else "N/A", end="  ")
            print(f"{pct_gt_20:.1f}%" if pct_gt_20 is not None else "N/A", end="  ")
            print(f"{pct_gt_30:.1f}%" if pct_gt_30 is not None else "N/A")
        
        print("\n" + "=" * 120)
        print("\nInterpretation:")
        print("- DD_2x→3x: Worst drawdown from 2x price between hitting 2x and hitting 3x")
        print("- p50/p75/p90: Median, 75th percentile, 90th percentile of drawdowns")
        print("- %>X%: Percentage of tokens requiring more than X% drawdown to reach 3x")


if __name__ == "__main__":
    main()

