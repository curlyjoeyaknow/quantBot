#!/usr/bin/env python3
"""
Time-based exit analysis for phased stop simulator results.

Analyzes:
1. Time-to-peak for winners
2. Time-to-exit distribution
3. Optimal hold time per caller
4. Time-stratified exit performance (12h/24h/36h/48h)
"""

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
from dataclasses import dataclass
import json

import duckdb
import numpy as np
import pandas as pd
from tabulate import tabulate


@dataclass
class TimeMetrics:
    """Time-based metrics for a cohort."""
    count: int
    time_to_peak_mean_hrs: float
    time_to_peak_median_hrs: float
    time_to_peak_p25_hrs: float
    time_to_peak_p75_hrs: float
    time_to_peak_p90_hrs: float
    time_to_exit_mean_hrs: float
    time_to_exit_median_hrs: float
    peak_within_12h_pct: float
    peak_within_24h_pct: float
    peak_within_36h_pct: float
    peak_within_48h_pct: float


def load_trades_from_parquet(parquet_path: str) -> pd.DataFrame:
    """Load trades from parquet file."""
    print(f"Loading trades from {parquet_path}...")
    df = pd.read_parquet(parquet_path)
    print(f"Loaded {len(df):,} trades")
    return df


def calculate_time_metrics(
    trades: pd.DataFrame,
    entry_ts_col: str = 'entry_ts_ms',
    exit_ts_col: str = 'exit_ts_ms',
) -> pd.DataFrame:
    """
    Calculate time-based metrics for each trade.
    
    Adds columns:
    - time_to_exit_hrs: Hours from entry to exit
    - time_to_peak_hrs: Hours from entry to peak (estimated from exit if not available)
    """
    df = trades.copy()
    
    # Calculate time to exit
    df['time_to_exit_hrs'] = (df[exit_ts_col] - df[entry_ts_col]) / (1000 * 3600)
    
    # Estimate time to peak
    # For now, we'll use a heuristic: if stopped, peak was likely near exit time
    # If end_of_data, peak could be anywhere in the window
    # TODO: Add actual peak_ts_ms tracking to simulator
    
    # For stopped trades, assume peak was shortly before exit
    df['time_to_peak_hrs'] = df['time_to_exit_hrs']
    
    # For end_of_data trades, we don't know exactly when peak occurred
    # Use exit time as upper bound
    
    return df


def analyze_time_to_peak(df: pd.DataFrame, cohort_name: str) -> TimeMetrics:
    """Analyze time-to-peak distribution for a cohort."""
    if len(df) == 0:
        return TimeMetrics(
            count=0,
            time_to_peak_mean_hrs=0,
            time_to_peak_median_hrs=0,
            time_to_peak_p25_hrs=0,
            time_to_peak_p75_hrs=0,
            time_to_peak_p90_hrs=0,
            time_to_exit_mean_hrs=0,
            time_to_exit_median_hrs=0,
            peak_within_12h_pct=0,
            peak_within_24h_pct=0,
            peak_within_36h_pct=0,
            peak_within_48h_pct=0,
        )
    
    time_to_peak = df['time_to_peak_hrs']
    time_to_exit = df['time_to_exit_hrs']
    
    return TimeMetrics(
        count=len(df),
        time_to_peak_mean_hrs=time_to_peak.mean(),
        time_to_peak_median_hrs=time_to_peak.median(),
        time_to_peak_p25_hrs=time_to_peak.quantile(0.25),
        time_to_peak_p75_hrs=time_to_peak.quantile(0.75),
        time_to_peak_p90_hrs=time_to_peak.quantile(0.90),
        time_to_exit_mean_hrs=time_to_exit.mean(),
        time_to_exit_median_hrs=time_to_exit.median(),
        peak_within_12h_pct=(time_to_peak <= 12).sum() / len(df) * 100,
        peak_within_24h_pct=(time_to_peak <= 24).sum() / len(df) * 100,
        peak_within_36h_pct=(time_to_peak <= 36).sum() / len(df) * 100,
        peak_within_48h_pct=(time_to_peak <= 48).sum() / len(df) * 100,
    )


def simulate_time_based_exits(
    df: pd.DataFrame,
    time_windows: List[int] = [12, 24, 36, 48],
) -> Dict[int, Dict]:
    """
    Simulate time-based exits at different time windows.
    
    For each time window, calculate what the exit multiple would have been
    if we exited at exactly that time.
    
    Returns: {time_window: {metrics}}
    """
    results = {}
    
    for time_window_hrs in time_windows:
        # For each trade, determine exit multiple at time_window_hrs
        # This requires knowing the price at that exact time
        # For now, we'll use a simplified approach:
        # - If trade exited before time_window, use actual exit
        # - If trade exited after time_window, we need to interpolate
        
        # TODO: This requires access to full candle data
        # For now, just analyze the existing exits
        
        trades_within_window = df[df['time_to_exit_hrs'] <= time_window_hrs].copy()
        
        if len(trades_within_window) == 0:
            results[time_window_hrs] = {
                'count': 0,
                'mean_exit_mult': 0,
                'median_exit_mult': 0,
                'ev_pct': 0,
            }
            continue
        
        results[time_window_hrs] = {
            'count': len(trades_within_window),
            'mean_exit_mult': trades_within_window['exit_mult'].mean(),
            'median_exit_mult': trades_within_window['exit_mult'].median(),
            'ev_pct': (trades_within_window['exit_mult'].mean() - 1.0) * 100,
            'p_reach_2x': (trades_within_window['hit_2x'].sum() / len(trades_within_window) * 100),
            'p_reach_3x': (trades_within_window['hit_3x'].sum() / len(trades_within_window) * 100),
        }
    
    return results


def analyze_per_caller(df: pd.DataFrame) -> pd.DataFrame:
    """Analyze optimal hold time per caller."""
    caller_stats = []
    
    for caller in df['caller'].unique():
        caller_df = df[df['caller'] == caller]
        
        if len(caller_df) < 10:  # Skip callers with too few trades
            continue
        
        # Calculate metrics
        winners = caller_df[caller_df['hit_3x'] == True]
        
        stats = {
            'caller': caller,
            'total_trades': len(caller_df),
            'winners': len(winners),
            'win_rate_pct': len(winners) / len(caller_df) * 100,
            'mean_exit_mult': caller_df['exit_mult'].mean(),
            'median_exit_mult': caller_df['exit_mult'].median(),
            'ev_pct': (caller_df['exit_mult'].mean() - 1.0) * 100,
        }
        
        # Time metrics
        if len(winners) > 0:
            stats['winner_time_to_exit_median_hrs'] = winners['time_to_exit_hrs'].median()
            stats['winner_time_to_exit_p75_hrs'] = winners['time_to_exit_hrs'].quantile(0.75)
        else:
            stats['winner_time_to_exit_median_hrs'] = 0
            stats['winner_time_to_exit_p75_hrs'] = 0
        
        stats['all_time_to_exit_median_hrs'] = caller_df['time_to_exit_hrs'].median()
        
        caller_stats.append(stats)
    
    return pd.DataFrame(caller_stats).sort_values('ev_pct', ascending=False)


def main():
    parser = argparse.ArgumentParser(description='Time-based exit analysis')
    parser.add_argument('parquet_file', help='Path to phased stop results parquet file')
    parser.add_argument('--stop-mode', choices=['static', 'trailing', 'ladder'], help='Filter by stop mode')
    parser.add_argument('--phase1-stop', type=float, help='Filter by phase1 stop % (e.g., 0.20 for 20%)')
    parser.add_argument('--phase2-stop', type=float, help='Filter by phase2 stop % (e.g., 0.30 for 30%)')
    parser.add_argument('--caller', help='Filter by specific caller')
    parser.add_argument('--min-trades', type=int, default=10, help='Minimum trades per caller for analysis')
    parser.add_argument('--output', choices=['table', 'json'], default='table', help='Output format')
    
    args = parser.parse_args()
    
    # Load data
    df = load_trades_from_parquet(args.parquet_file)
    
    # Apply filters
    if args.stop_mode:
        df = df[df['stop_mode'] == args.stop_mode]
        print(f"Filtered to {args.stop_mode} mode: {len(df):,} trades")
    
    if args.phase1_stop is not None:
        df = df[df['phase1_stop_pct'] == args.phase1_stop]
        print(f"Filtered to phase1={args.phase1_stop*100:.0f}%: {len(df):,} trades")
    
    if args.phase2_stop is not None:
        df = df[df['phase2_stop_pct'] == args.phase2_stop]
        print(f"Filtered to phase2={args.phase2_stop*100:.0f}%: {len(df):,} trades")
    
    if args.caller:
        df = df[df['caller'] == args.caller]
        print(f"Filtered to caller '{args.caller}': {len(df):,} trades")
    
    if len(df) == 0:
        print("No trades after filtering!")
        return
    
    # Calculate time metrics
    df = calculate_time_metrics(df)
    
    print("\n" + "="*80)
    print("TIME-BASED EXIT ANALYSIS")
    print("="*80)
    
    # 1. Overall time-to-exit distribution
    print("\n### Overall Time-to-Exit Distribution ###\n")
    time_to_exit = df['time_to_exit_hrs']
    print(f"Mean: {time_to_exit.mean():.1f} hours")
    print(f"Median: {time_to_exit.median():.1f} hours")
    print(f"P25: {time_to_exit.quantile(0.25):.1f} hours")
    print(f"P75: {time_to_exit.quantile(0.75):.1f} hours")
    print(f"P90: {time_to_exit.quantile(0.90):.1f} hours")
    print(f"Max: {time_to_exit.max():.1f} hours")
    
    # 2. Time-to-peak by cohort (more granular)
    print("\n### Time-to-Peak by Cohort ###\n")
    
    # More granular cohorts
    cohort_10x = df[df['hit_10x'] == True]
    cohort_5x = df[(df['hit_5x'] == True) & (df['hit_10x'] == False)]
    cohort_4x = df[(df['hit_4x'] == True) & (df['hit_5x'] == False)]
    cohort_3x = df[(df['hit_3x'] == True) & (df['hit_4x'] == False)]
    cohort_2x_no3x = df[(df['hit_2x'] == True) & (df['hit_3x'] == False)]
    cohort_never_2x = df[df['hit_2x'] == False]
    
    cohorts = {
        '≥10x': cohort_10x,
        '5x-10x': cohort_5x,
        '4x-5x': cohort_4x,
        '3x-4x': cohort_3x,
        '2x-3x': cohort_2x_no3x,
        '<2x': cohort_never_2x,
    }
    
    cohort_table = []
    for cohort_name, cohort_df in cohorts.items():
        if len(cohort_df) == 0:
            continue
        
        time_to_exit = cohort_df['time_to_exit_hrs']
        
        cohort_table.append([
            cohort_name,
            len(cohort_df),
            f"{time_to_exit.median():.1f}h",
            f"{time_to_exit.mean():.1f}h",
            f"{time_to_exit.quantile(0.90):.1f}h",
            f"{(time_to_exit <= 2).sum() / len(cohort_df) * 100:.0f}%",
            f"{(time_to_exit <= 4).sum() / len(cohort_df) * 100:.0f}%",
            f"{(time_to_exit <= 6).sum() / len(cohort_df) * 100:.0f}%",
            f"{(time_to_exit <= 9).sum() / len(cohort_df) * 100:.0f}%",
            f"{(time_to_exit <= 12).sum() / len(cohort_df) * 100:.0f}%",
        ])
    
    print(tabulate(
        cohort_table,
        headers=['Cohort', 'N', 'Median', 'Mean', 'P90', '≤2h', '≤4h', '≤6h', '≤9h', '≤12h'],
        tablefmt='simple'
    ))
    
    # 3. Time-stratified exit simulation (more granular)
    print("\n### Time-Stratified Exit Performance ###\n")
    print("(Analyzing trades that exited within each time window)\n")
    
    time_windows = [2, 4, 6, 9, 12, 18, 24, 36, 48]
    time_results = simulate_time_based_exits(df, time_windows)
    
    time_table = []
    for window_hrs in time_windows:
        result = time_results[window_hrs]
        time_table.append([
            f"{window_hrs}h",
            result['count'],
            f"{result['mean_exit_mult']:.2f}x",
            f"{result['median_exit_mult']:.2f}x",
            f"{result['ev_pct']:.1f}%",
            f"{result['p_reach_2x']:.0f}%",
            f"{result['p_reach_3x']:.0f}%",
        ])
    
    print(tabulate(
        time_table,
        headers=['Window', 'Trades', 'Mean Exit', 'Median Exit', 'EV%', 'P(2x)', 'P(3x)'],
        tablefmt='simple'
    ))
    
    # 4. Per-caller analysis
    print("\n### Optimal Hold Time Per Caller (Top 20 by EV) ###\n")
    
    caller_df = analyze_per_caller(df)
    caller_df = caller_df[caller_df['total_trades'] >= args.min_trades]
    
    if len(caller_df) > 0:
        top_callers = caller_df.head(20)
        
        caller_table = []
        for _, row in top_callers.iterrows():
            caller_table.append([
                row['caller'][:30],
                row['total_trades'],
                f"{row['win_rate_pct']:.0f}%",
                f"{row['ev_pct']:.1f}%",
                f"{row['median_exit_mult']:.2f}x",
                f"{row['all_time_to_exit_median_hrs']:.0f}h",
                f"{row['winner_time_to_exit_median_hrs']:.0f}h" if row['winners'] > 0 else "N/A",
            ])
        
        print(tabulate(
            caller_table,
            headers=['Caller', 'Trades', 'Win%', 'EV%', 'Med Exit', 'Med Time', 'Win Time'],
            tablefmt='simple'
        ))
    else:
        print(f"No callers with >={args.min_trades} trades")
    
    # 5. Key insights
    print("\n" + "="*80)
    print("KEY INSIGHTS")
    print("="*80 + "\n")
    
    # Insight 1: When do winners peak?
    all_winners = df[df['hit_3x'] == True]
    if len(all_winners) > 0:
        winner_time = all_winners['time_to_exit_hrs']
        print(f"✓ Winners (≥3x) typically exit within {winner_time.median():.0f} hours")
        print(f"  - {(winner_time <= 2).sum() / len(all_winners) * 100:.0f}% exit within 2h")
        print(f"  - {(winner_time <= 6).sum() / len(all_winners) * 100:.0f}% exit within 6h")
        print(f"  - {(winner_time <= 12).sum() / len(all_winners) * 100:.0f}% exit within 12h")
    
    # Insight 2: Optimal time window
    best_window = max(time_results.items(), key=lambda x: x[1]['ev_pct'])
    print(f"\n✓ Best time window: {best_window[0]}h (EV: {best_window[1]['ev_pct']:.1f}%)")
    
    # Insight 3: Time vs stops
    stopped_trades = df[df['exit_reason'].str.contains('stopped')]
    end_of_data_trades = df[df['exit_reason'] == 'end_of_data']
    
    print(f"\n✓ Exit reasons:")
    print(f"  - Stopped: {len(stopped_trades)} ({len(stopped_trades)/len(df)*100:.0f}%)")
    print(f"  - End of data: {len(end_of_data_trades)} ({len(end_of_data_trades)/len(df)*100:.0f}%)")
    
    if len(end_of_data_trades) > 0:
        eod_ev = (end_of_data_trades['exit_mult'].mean() - 1.0) * 100
        stopped_ev = (stopped_trades['exit_mult'].mean() - 1.0) * 100 if len(stopped_trades) > 0 else 0
        print(f"\n✓ EV comparison:")
        print(f"  - Stopped trades: {stopped_ev:.1f}%")
        print(f"  - End of data trades: {eod_ev:.1f}%")
        
        if eod_ev > stopped_ev * 2:
            print(f"\n💡 INSIGHT: Time-based exits (end_of_data) have {eod_ev/stopped_ev:.1f}x better EV!")
            print(f"   Consider using time-based exits as primary strategy.")


if __name__ == '__main__':
    main()

