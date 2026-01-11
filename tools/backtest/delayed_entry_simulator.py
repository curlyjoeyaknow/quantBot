#!/usr/bin/env python3
"""
Delayed Entry Simulator - test waiting for dips after alert.

Uses modular trade_simulator with delayed_entry_dip strategy.

Tests entry strategies:
- Immediate (0%)
- Wait for dip: -5%, -10%, -15%, -20%, -25%, -30%, -40%, -50%

For each strategy, compares:
- Dip occurrence rate
- Time to dip
- Realized EV (trades that entered)
- Opportunity-adjusted EV (including missed trades)
- Winner capture rate (≥3x)

Usage:
    python3 delayed_entry_simulator.py \\
        --duckdb data/alerts.duckdb \\
        --slice slices/per_token \\
        --chain solana \\
        --date-from 2025-05-01 \\
        --date-to 2025-07-31 \\
        --stop-mode trailing \\
        --phase1-stop 0.15 \\
        --phase2-stop 0.50 \\
        --stop-from alert \\
        --output-dir output/delayed_entry
"""

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, TimeoutError, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from threading import Semaphore
from typing import Dict, List, Optional

import duckdb
import numpy as np
import pandas as pd
from tabulate import tabulate

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent / 'lib'))
from alerts import load_alerts_from_duckdb, Alert
from entry_strategies import immediate_entry, delayed_entry_dip
from stop_strategies import static_stop, trailing_stop, PhaseConfig
from trade_simulator import simulate_trade, TradeResult


# DIP percentages to test
DIP_PERCENTAGES = [0.0, -0.05, -0.10, -0.15, -0.20, -0.25, -0.30, -0.40, -0.50]


@dataclass
class DelayedEntryAggregation:
    """Aggregated results for a single dip percentage."""
    dip_pct: float
    total_alerts: int
    entries_occurred: int
    entries_missed: int
    dip_rate: float
    
    # Time to entry
    time_to_entry_hrs_p50: Optional[float]
    time_to_entry_hrs_p75: Optional[float]
    time_to_entry_hrs_p90: Optional[float]
    
    # Performance (trades that entered)
    realized_ev_pct: Optional[float]
    realized_exit_mult_mean: Optional[float]
    realized_exit_mult_p50: Optional[float]
    realized_exit_mult_p75: Optional[float]
    
    # Opportunity-adjusted (including missed)
    opportunity_adj_ev_pct: float
    
    # Winners
    winners_count: int
    winners_pct: float
    
    # Comparison to immediate
    ev_delta_vs_immediate: Optional[float]


def load_candles_for_mint(
    slice_dir: Path,
    mint: str,
    alert_ts_ms: int,
    max_duration_hrs: float = 48.0,
) -> List[Dict]:
    """Load candles for a mint after alert timestamp."""
    mint_file = slice_dir / f"{mint}.parquet"
    
    if not mint_file.exists():
        return []
    
    try:
        df = pd.read_parquet(mint_file)
        
        # Convert timestamp to ms if needed
        if df['timestamp'].dtype == 'object':
            df['timestamp'] = pd.to_datetime(df['timestamp'])
        
        if df['timestamp'].dtype == 'datetime64[ns]':
            df['timestamp_ms'] = (df['timestamp'].astype('int64') // 10**6)
        else:
            df['timestamp_ms'] = df['timestamp']
        
        # Filter to after alert
        end_ts_ms = alert_ts_ms + int(max_duration_hrs * 3600 * 1000)
        df_filtered = df[
            (df['timestamp_ms'] >= alert_ts_ms) &
            (df['timestamp_ms'] <= end_ts_ms)
        ].copy()
        
        # Sort by timestamp
        df_filtered = df_filtered.sort_values('timestamp_ms')
        
        return df_filtered.to_dict('records')
    
    except Exception as e:
        print(f"Error loading candles for {mint}: {e}", file=sys.stderr)
        return []


def simulate_alert_delayed_entry(
    alert: Alert,
    slice_dir: Path,
    dip_pct: float,
    stop_mode: str,
    phase1_stop_pct: float,
    phase2_stop_pct: float,
    stop_from: str,
    max_duration_hrs: float = 48.0,
) -> Optional[TradeResult]:
    """Simulate delayed entry for a single alert."""
    # Load candles
    candles = load_candles_for_mint(
        slice_dir,
        alert.mint,
        alert.timestamp_ms,
        max_duration_hrs,
    )
    
    if not candles:
        return None
    
    # Get alert price (first candle close)
    alert_price = float(candles[0]['close'])
    
    # Configure entry strategy
    if dip_pct == 0.0:
        entry_strategy = immediate_entry
        entry_params = {}
    else:
        entry_strategy = delayed_entry_dip
        entry_params = {'dip_pct': dip_pct}
    
    # Configure stop strategy
    phases = [
        PhaseConfig(stop_pct=phase1_stop_pct, target_mult=2.0),
        PhaseConfig(stop_pct=phase2_stop_pct),
    ]
    
    if stop_mode == 'static':
        stop_strategy = static_stop
    elif stop_mode == 'trailing':
        stop_strategy = trailing_stop
    else:
        raise ValueError(f"Unknown stop mode: {stop_mode}")
    
    stop_params = {'phases': phases, 'max_duration_hrs': max_duration_hrs}
    
    # Simulate trade
    result = simulate_trade(
        candles=candles,
        alert_price=alert_price,
        alert_ts_ms=alert.timestamp_ms,
        entry_strategy=entry_strategy,
        entry_params=entry_params,
        stop_strategy=stop_strategy,
        stop_params=stop_params,
        stop_reference=stop_from,
    )
    
    return result


def aggregate_delayed_entry_results(
    results: List[TradeResult],
    dip_pct: float,
    immediate_ev: Optional[float] = None,
) -> DelayedEntryAggregation:
    """Aggregate results for a single dip percentage."""
    total_alerts = len(results)
    
    # Separate entered vs missed
    entered = [r for r in results if r.entry_occurred]
    missed = [r for r in results if not r.entry_occurred]
    
    entries_occurred = len(entered)
    entries_missed = len(missed)
    dip_rate = entries_occurred / total_alerts if total_alerts > 0 else 0.0
    
    # Time to entry (for entered trades)
    time_to_entry_hrs = [r.time_to_entry_hrs for r in entered if r.time_to_entry_hrs is not None]
    time_to_entry_hrs_p50 = np.percentile(time_to_entry_hrs, 50) if time_to_entry_hrs else None
    time_to_entry_hrs_p75 = np.percentile(time_to_entry_hrs, 75) if time_to_entry_hrs else None
    time_to_entry_hrs_p90 = np.percentile(time_to_entry_hrs, 90) if time_to_entry_hrs else None
    
    # Performance (entered trades only)
    if entered:
        exit_mults = [r.exit_mult for r in entered if r.exit_mult is not None]
        realized_ev_pct = (np.mean(exit_mults) - 1.0) * 100.0 if exit_mults else None
        realized_exit_mult_mean = np.mean(exit_mults) if exit_mults else None
        realized_exit_mult_p50 = np.percentile(exit_mults, 50) if exit_mults else None
        realized_exit_mult_p75 = np.percentile(exit_mults, 75) if exit_mults else None
    else:
        realized_ev_pct = None
        realized_exit_mult_mean = None
        realized_exit_mult_p50 = None
        realized_exit_mult_p75 = None
    
    # Opportunity-adjusted EV (missed = 0x)
    all_exit_mults = []
    for r in results:
        if r.entry_occurred and r.exit_mult is not None:
            all_exit_mults.append(r.exit_mult)
        else:
            all_exit_mults.append(0.0)  # Missed trade = 0x
    
    opportunity_adj_ev_pct = (np.mean(all_exit_mults) - 1.0) * 100.0 if all_exit_mults else 0.0
    
    # Winners (≥3x from entry)
    winners = [r for r in entered if r.hit_3x]
    winners_count = len(winners)
    winners_pct = winners_count / total_alerts * 100.0 if total_alerts > 0 else 0.0
    
    # Comparison to immediate
    ev_delta_vs_immediate = None
    if immediate_ev is not None:
        ev_delta_vs_immediate = opportunity_adj_ev_pct - immediate_ev
    
    return DelayedEntryAggregation(
        dip_pct=dip_pct,
        total_alerts=total_alerts,
        entries_occurred=entries_occurred,
        entries_missed=entries_missed,
        dip_rate=dip_rate,
        time_to_entry_hrs_p50=time_to_entry_hrs_p50,
        time_to_entry_hrs_p75=time_to_entry_hrs_p75,
        time_to_entry_hrs_p90=time_to_entry_hrs_p90,
        realized_ev_pct=realized_ev_pct,
        realized_exit_mult_mean=realized_exit_mult_mean,
        realized_exit_mult_p50=realized_exit_mult_p50,
        realized_exit_mult_p75=realized_exit_mult_p75,
        opportunity_adj_ev_pct=opportunity_adj_ev_pct,
        winners_count=winners_count,
        winners_pct=winners_pct,
        ev_delta_vs_immediate=ev_delta_vs_immediate,
    )


def main():
    parser = argparse.ArgumentParser(description='Delayed entry simulator')
    parser.add_argument('--duckdb', required=True, help='Path to alerts DuckDB')
    parser.add_argument('--slice', required=True, help='Path to sliced candles directory')
    parser.add_argument('--chain', default='solana', help='Chain name')
    parser.add_argument('--date-from', help='Start date (YYYY-MM-DD)')
    parser.add_argument('--date-to', help='End date (YYYY-MM-DD)')
    parser.add_argument('--min-calls', type=int, default=35, help='Min calls per caller')
    parser.add_argument('--stop-mode', choices=['static', 'trailing'], required=True)
    parser.add_argument('--phase1-stop', type=float, required=True, help='Phase1 stop % (e.g., 0.15)')
    parser.add_argument('--phase2-stop', type=float, required=True, help='Phase2 stop % (e.g., 0.50)')
    parser.add_argument('--stop-from', choices=['alert', 'entry'], default='alert',
                       help='Calculate stops from alert or entry price')
    parser.add_argument('--threads', type=int, default=8, help='Number of threads')
    parser.add_argument('--output-dir', default='output/delayed_entry', help='Output directory')
    parser.add_argument('--output', choices=['table', 'json'], default='table')
    
    args = parser.parse_args()
    
    # Create output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("="*80)
    print("DELAYED ENTRY SIMULATOR")
    print("="*80)
    print(f"Stop mode: {args.stop_mode}")
    print(f"Phase1: {args.phase1_stop*100:.0f}%, Phase2: {args.phase2_stop*100:.0f}%")
    print(f"Stops calculated from: {args.stop_from} price")
    print(f"Threads: {args.threads}")
    print()
    
    # Load alerts
    print("Loading alerts...")
    alerts = load_alerts_from_duckdb(
        duckdb_path=args.duckdb,
        chain=args.chain,
        date_from=args.date_from,
        date_to=args.date_to,
        min_calls=args.min_calls,
    )
    print(f"Loaded {len(alerts):,} alerts")
    print()
    
    slice_dir = Path(args.slice)
    
    # Simulate for each dip percentage
    all_aggregations = []
    immediate_ev = None
    
    for dip_pct in DIP_PERCENTAGES:
        print(f"Simulating {dip_pct*100:.0f}% dip strategy...")
        
        results = []
        
        with ThreadPoolExecutor(max_workers=args.threads) as executor:
            futures = {
                executor.submit(
                    simulate_alert_delayed_entry,
                    alert,
                    slice_dir,
                    dip_pct,
                    args.stop_mode,
                    args.phase1_stop,
                    args.phase2_stop,
                    args.stop_from,
                ): alert
                for alert in alerts
            }
            
            for future in as_completed(futures):
                try:
                    result = future.result(timeout=30)
                    if result:
                        results.append(result)
                except TimeoutError:
                    print(".", end="", flush=True)
                except Exception as e:
                    print(f"Error: {e}", file=sys.stderr)
        
        print(f" {len(results):,} trades")
        
        # Aggregate
        agg = aggregate_delayed_entry_results(results, dip_pct, immediate_ev)
        all_aggregations.append(agg)
        
        # Store immediate EV for comparison
        if dip_pct == 0.0:
            immediate_ev = agg.opportunity_adj_ev_pct
    
    print()
    print("="*80)
    print("RESULTS")
    print("="*80)
    print()
    
    # Print summary table
    table_data = []
    for agg in all_aggregations:
        table_data.append([
            f"{agg.dip_pct*100:.0f}%",
            f"{agg.dip_rate*100:.1f}%",
            f"{agg.time_to_entry_hrs_p50:.2f}h" if agg.time_to_entry_hrs_p50 else "N/A",
            f"{agg.realized_ev_pct:.1f}%" if agg.realized_ev_pct is not None else "N/A",
            f"{agg.opportunity_adj_ev_pct:.1f}%",
            f"{agg.winners_pct:.1f}%",
            f"{agg.ev_delta_vs_immediate:+.1f}%" if agg.ev_delta_vs_immediate is not None else "—",
        ])
    
    headers = [
        "Entry",
        "Dip Rate",
        "Time (P50)",
        "Realized EV",
        "Opp-Adj EV",
        "Winners",
        "vs Immediate",
    ]
    
    print(tabulate(table_data, headers=headers, tablefmt='simple'))
    print()
    
    # Find optimal
    best_agg = max(all_aggregations, key=lambda x: x.opportunity_adj_ev_pct)
    print(f"🎯 Optimal strategy: {best_agg.dip_pct*100:.0f}% dip")
    print(f"   Opportunity-adjusted EV: {best_agg.opportunity_adj_ev_pct:.1f}%")
    print(f"   Dip occurrence rate: {best_agg.dip_rate*100:.1f}%")
    print(f"   Winner capture rate: {best_agg.winners_pct:.1f}%")
    print()
    
    # Save results
    output_file = output_dir / f"delayed_entry_{args.stop_mode}_{int(args.phase1_stop*100)}_{int(args.phase2_stop*100)}.json"
    with open(output_file, 'w') as f:
        json.dump([asdict(agg) for agg in all_aggregations], f, indent=2)
    
    print(f"Results saved to: {output_file}")


if __name__ == '__main__':
    main()

