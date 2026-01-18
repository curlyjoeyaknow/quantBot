#!/usr/bin/env python3
"""
Generate interactive drill-down HTML report with OHLCV charts per trade.
"""

import pandas as pd
import numpy as np
import json
from datetime import datetime
from glob import glob
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed

def load_ohlcv_for_mint(mint: str, parquet_dir: str = 'slices/per_token') -> list:
    """Load OHLCV data for a specific mint from parquet files.
    
    Handles multiple files for the same mint by merging and deduplicating.
    """
    parquet_files = glob(f'{parquet_dir}/*.parquet')
    all_candles = []
    
    for f in parquet_files:
        try:
            df = pd.read_parquet(f)
            if len(df) == 0:
                continue
            
            # Check if this file contains data for our mint
            # Some files might have multiple tokens, so filter by mint
            if 'token_address' in df.columns:
                df_filtered = df[df['token_address'] == mint].copy()
            elif len(df) > 0 and df.iloc[0].get('token_address') == mint:
                # Single token per file case
                df_filtered = df.copy()
            else:
                continue
            
            if len(df_filtered) == 0:
                continue
            
            # Convert to list of candles
            for _, row in df_filtered.iterrows():
                all_candles.append({
                    'time': int(row['timestamp'].timestamp()),
                    'open': round(row['open'], 10),
                    'high': round(row['high'], 10),
                    'low': round(row['low'], 10),
                    'close': round(row['close'], 10),
                    'volume': round(row['volume'], 2),
                })
        except Exception:
            continue
    
    if not all_candles:
        return []
    
    # Deduplicate by timestamp (keep first occurrence if duplicates)
    seen_times = set()
    unique_candles = []
    for candle in all_candles:
        if candle['time'] not in seen_times:
            seen_times.add(candle['time'])
            unique_candles.append(candle)
    
    # Sort by time
    return sorted(unique_candles, key=lambda x: x['time'])

def get_token_metadata(mint: str, row: pd.Series) -> dict:
    """Get token name and symbol from row data or return defaults."""
    # Try to get from CSV columns first
    token_name = None
    token_symbol = None
    
    if 'token_name' in row.index and pd.notna(row.get('token_name')):
        token_name = str(row['token_name']).strip()
    if 'token_symbol' in row.index and pd.notna(row.get('token_symbol')):
        token_symbol = str(row['token_symbol']).strip()
    
    # If not found, use defaults
    if not token_name:
        token_name = 'Unknown Token'
    if not token_symbol:
        token_symbol = mint[:4].upper() if len(mint) >= 4 else 'UNK'
    
    return {
        'token_name': token_name,
        'token_symbol': token_symbol,
    }

def process_single_trade(args):
    """Process a single trade - designed for multiprocessing."""
    row_dict, parquet_dir, risk_per_trade, default_tp_mult, default_sl_mult = args
    
    # Convert dict back to Series for compatibility
    row = pd.Series(row_dict)
    mint = row['mint']
    
    # Load OHLCV data
    ohlcv = load_ohlcv_for_mint(mint, parquet_dir)
    
    if len(ohlcv) < 5:
        return None
    
    # Parse alert timestamp
    alert_ts = pd.to_datetime(row['alert_ts_utc']).timestamp()
    
    # Get horizon hours (default 48 if not specified)
    horizon_hours = float(row.get('horizon_hours', 48)) if pd.notna(row.get('horizon_hours', None)) else 48.0
    horizon_seconds = int(horizon_hours * 3600)
    
    # Filter OHLCV to only show horizon window (from alert to alert + horizon)
    alert_ts_unix = int(alert_ts)
    horizon_end_ts = alert_ts_unix + horizon_seconds
    
    # Filter candles to horizon window
    horizon_ohlcv = [
        c for c in ohlcv 
        if alert_ts_unix <= c['time'] <= horizon_end_ts
    ]
    
    if len(horizon_ohlcv) < 5:
        # If not enough candles in horizon, try to include some pre-alert context
        # Include 1 hour before alert and full horizon after
        pre_alert_ts = alert_ts_unix - 3600
        horizon_ohlcv = [
            c for c in ohlcv 
            if pre_alert_ts <= c['time'] <= horizon_end_ts
        ]
    
    if len(horizon_ohlcv) < 5:
        return None
    
    # Get token metadata
    token_meta = get_token_metadata(mint, row)
    
    # Calculate trade events (use full ohlcv for event detection, but display only horizon)
    event_data = calculate_trade_events(row, ohlcv, risk_per_trade, default_tp_mult, default_sl_mult)
    
    trade = {
        'id': row['alert_id'],
        'mint': mint,  # Full mint address - NEVER truncate
        'token_name': token_meta['token_name'],
        'token_symbol': token_meta['token_symbol'],
        'display_name': f"{token_meta['token_name']} ({token_meta['token_symbol']})",
        'alert_ts': row['alert_ts_utc'],
        'alert_ts_unix': alert_ts_unix,
        'horizon_end_ts': horizon_end_ts,
        'ath_mult': round(row['ath_mult'], 2),
        'time_to_2x': row['time_to_2x_s'] if 'time_to_2x_s' in row and pd.notna(row['time_to_2x_s']) else None,
        'time_to_5x': row['time_to_5x_s'] if 'time_to_5x_s' in row and pd.notna(row['time_to_5x_s']) else None,
        'time_to_10x': row.get('time_to_10x_s') if 'time_to_10x_s' in row and pd.notna(row.get('time_to_10x_s')) else None,
        'dd_overall': round(row['dd_overall'] * 100, 1),
        'tp_sl_ret': round(row['tp_sl_ret'] * 100, 1),
        'exit_reason': row['tp_sl_exit_reason'],
        'entry_price': row['entry_price'],
        'ohlcv': horizon_ohlcv,  # Only horizon window candles
        **event_data,  # Add event data
    }
    
    return trade

def calculate_trade_events(row, ohlcv, risk_per_trade: float = 0.02, default_tp_mult: float = 80.0, default_sl_mult: float = 0.7):
    """Calculate trade events timeline from row data and OHLCV."""
    alert_ts = pd.to_datetime(row['alert_ts_utc']).timestamp()
    entry_price = float(row['entry_price'])
    
    # Get actual return from CSV (more accurate than calculating from exit price)
    # tp_sl_ret is stored as (exit_price / entry_price - 1), so:
    # For 80x: (80 - 1) = 79.0, multiply by 100 = 7900%
    # For 48.76x: (48.76 - 1) = 47.76, multiply by 100 = 4776%
    # We multiply by 100 to convert to percentage
    tp_sl_ret_raw = row.get('tp_sl_ret', None)
    if pd.notna(tp_sl_ret_raw):
        try:
            tp_sl_ret_val = float(tp_sl_ret_raw)
            actual_return_pct = tp_sl_ret_val * 100
        except (ValueError, TypeError):
            actual_return_pct = None
    else:
        actual_return_pct = None
    
    # Try to get TP/SL from row, or use defaults
    tp_mult = float(row.get('tp_mult', default_tp_mult)) if pd.notna(row.get('tp_mult', None)) else default_tp_mult
    sl_mult = float(row.get('sl_mult', default_sl_mult)) if pd.notna(row.get('sl_mult', None)) else default_sl_mult
    
    # Calculate prices
    tp_price = entry_price * tp_mult
    sl_price = entry_price * sl_mult
    
    # Calculate position size (2% risk per trade)
    # Position size = risk_per_trade / (entry_price - sl_price) * entry_price
    risk_amount = entry_price - sl_price
    if risk_amount > 0:
        position_size_pct = risk_per_trade / (risk_amount / entry_price)
    else:
        position_size_pct = 0.06  # Default 6% if can't calculate
    
    # Entry time: alert + 30 seconds delay (typical execution delay)
    entry_ts = alert_ts + 30
    entry_time = datetime.fromtimestamp(entry_ts).strftime('%Y-%m-%d %H:%M:%S')
    
    # Find exit time and price from OHLCV based on exit_reason
    exit_reason = str(row.get('tp_sl_exit_reason', 'horizon'))
    exit_ts = None
    exit_price = None
    exit_time_str = None
    
    events = []
    
    # Add alert event
    events.append({
        'time': int(alert_ts),
        'time_str': datetime.fromtimestamp(alert_ts).strftime('%Y-%m-%d %H:%M:%S'),
        'type': 'alert',
        'description': f'Alert received',
        'price': None,
        'change_pct': None,
        'portfolio_impact_pct': None,
    })
    
    # Add entry event
    events.append({
        'time': int(entry_ts),
        'time_str': entry_time,
        'type': 'entry',
        'description': f'Trade opened (executed at {entry_time})',
        'price': entry_price,
        'change_pct': 0.0,
        'position_size_pct': round(position_size_pct * 100, 2),
        'portfolio_impact_pct': None,
    })
    
    # Add stop loss set event
    events.append({
        'time': int(entry_ts),
        'time_str': entry_time,
        'type': 'stop_loss_set',
        'description': f'Stop loss set at ${sl_price:.8f} ({sl_mult*100:.0f}%)',
        'price': sl_price,
        'change_pct': round((sl_mult - 1) * 100, 1),
        'portfolio_impact_pct': None,  # No impact when setting
    })
    
    # Find exit event from OHLCV
    if exit_reason == 'sl':
        # Find when price hit stop loss
        for candle in ohlcv:
            if candle['low'] <= sl_price:
                exit_ts = candle['time']
                exit_price = sl_price
                exit_time_str = datetime.fromtimestamp(exit_ts).strftime('%Y-%m-%d %H:%M:%S')
                # Always use actual return from CSV for SL exits (accounts for fees, slippage)
                if actual_return_pct is not None and pd.notna(actual_return_pct):
                    ret_pct = actual_return_pct
                else:
                    # Fallback: calculate from SL multiplier if CSV return not available
                    ret_pct = (sl_mult - 1) * 100
                # Portfolio impact = position_size_pct * (return_pct / 100)
                portfolio_impact_pct = position_size_pct * (ret_pct / 100)
                events.append({
                    'time': exit_ts,
                    'time_str': exit_time_str,
                    'type': 'stop_loss_triggered',
                    'description': f'Stop loss triggered - {ret_pct:.1f}%',
                    'price': sl_price,
                    'change_pct': round(ret_pct, 1),
                    'portfolio_impact_pct': round(portfolio_impact_pct * 100, 2),
                })
                break
    elif exit_reason == 'tp':
        # Find when price hit take profit
        for candle in ohlcv:
            if candle['high'] >= tp_price:
                exit_ts = candle['time']
                exit_price = tp_price
                exit_time_str = datetime.fromtimestamp(exit_ts).strftime('%Y-%m-%d %H:%M:%S')
                # Always use actual return from CSV for TP exits (more accurate than TP multiplier)
                # The actual return accounts for fees, slippage, and exact exit price
                if actual_return_pct is not None and pd.notna(actual_return_pct):
                    ret_pct = actual_return_pct
                else:
                    # Fallback: calculate from TP multiplier if CSV return not available
                    ret_pct = (tp_mult - 1) * 100
                # Portfolio impact = position_size_pct * (return_pct / 100)
                # For 4776.2% return with 6.67% position: 6.67% * 47.762 = 318.7%
                portfolio_impact_pct = position_size_pct * (ret_pct / 100)
                events.append({
                    'time': exit_ts,
                    'time_str': exit_time_str,
                    'type': 'take_profit',
                    'description': f'Take profit hit - {ret_pct:.1f}%',
                    'price': tp_price,
                    'change_pct': round(ret_pct, 1),
                    'portfolio_impact_pct': round(portfolio_impact_pct * 100, 2),
                })
                break
    else:
        # Horizon exit - use last candle
        if ohlcv:
            last_candle = ohlcv[-1]
            exit_ts = last_candle['time']
            exit_price = last_candle['close']
            exit_time_str = datetime.fromtimestamp(exit_ts).strftime('%Y-%m-%d %H:%M:%S')
            # Use actual return from CSV if available, otherwise calculate from price
            if actual_return_pct is not None and pd.notna(actual_return_pct):
                ret_pct = actual_return_pct
            else:
                ret_pct = (exit_price / entry_price - 1) * 100
            # Portfolio impact = position_size_pct * (return_pct / 100)
            # For +111.7% return with 6.67% position: 6.67% * 1.117 = 7.45% portfolio impact
            portfolio_impact_pct = position_size_pct * (ret_pct / 100)
            events.append({
                'time': exit_ts,
                'time_str': exit_time_str,
                'type': 'horizon_exit',
                'description': f'Horizon exit - {ret_pct:.1f}%',
                'price': exit_price,
                'change_pct': round(ret_pct, 1),
                'portfolio_impact_pct': round(portfolio_impact_pct * 100, 2),
            })
    
    # Sort events by time
    events.sort(key=lambda x: x['time'])
    
    return {
        'events': events,
        'tp_mult': tp_mult,
        'sl_mult': sl_mult,
        'tp_price': tp_price,
        'sl_price': sl_price,
        'position_size_pct': position_size_pct,
        'entry_ts': int(entry_ts),
        'exit_ts': exit_ts,
        'exit_price': exit_price,
        'exit_time_str': exit_time_str,
    }

def generate_drilldown_report(csv_path: str, output_path: str = None, max_trades_per_caller: int = None, risk_per_trade: float = 0.02, default_tp_mult: float = 80.0, default_sl_mult: float = 0.7, max_workers: int = None):
    """Generate interactive drill-down HTML report."""
    
    print("Loading results...")
    df = pd.read_csv(csv_path)
    valid = df[df['status'] == 'ok'].copy()
    
    # Deduplicate by mint
    valid = valid.drop_duplicates(subset='mint', keep='first')
    
    # Filter outliers
    valid = valid[valid['ath_mult'] <= 1000]
    
    if output_path is None:
        output_path = csv_path.replace('.csv', '_drilldown.html')
    
    # Get list of callers with counts
    caller_counts = valid['caller'].value_counts()
    callers = caller_counts.index.tolist()
    
    print(f"Processing {len(callers)} callers...")
    
    # Build trades data with OHLCV
    trades_by_caller = {}
    
    # Prepare all trades for parallel processing
    all_trade_args = []
    caller_trade_map = {}  # Map to track which caller each trade belongs to
    
    # Process ALL callers and ALL trades (no limits)
    for caller in callers:
        caller_trades = valid[valid['caller'] == caller]
        # Apply limit only if specified
        if max_trades_per_caller is not None:
            caller_trades = caller_trades.head(max_trades_per_caller)
        
        for idx, (_, row) in enumerate(caller_trades.iterrows()):
            # Convert row to dict for pickling
            row_dict = row.to_dict()
            args = (row_dict, 'slices/per_token', risk_per_trade, default_tp_mult, default_sl_mult)
            all_trade_args.append(args)
            caller_trade_map[len(all_trade_args) - 1] = caller
    
    print(f"Processing {len(all_trade_args)} trades in parallel...")
    
    # Process trades in parallel
    trades_by_caller = {}
    completed_count = 0
    
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_single_trade, args): idx for idx, args in enumerate(all_trade_args)}
        
        for future in as_completed(futures):
            idx = futures[future]
            caller = caller_trade_map[idx]
            
            try:
                trade = future.result()
                if trade is not None:
                    if caller not in trades_by_caller:
                        trades_by_caller[caller] = {
                            'count': int(caller_counts[caller]),
                            'trades': []
                        }
                    trades_by_caller[caller]['trades'].append(trade)
            except Exception as e:
                print(f"  Error processing trade {idx}: {e}", file=sys.stderr)
            
            completed_count += 1
            if completed_count % 10 == 0:
                print(f"  Processed {completed_count}/{len(all_trade_args)} trades...")
    
    # Print summary
    total_trades_loaded = 0
    for caller, data in trades_by_caller.items():
        trade_count = len(data['trades'])
        total_trades_loaded += trade_count
        print(f"  {caller}: {trade_count} trades loaded")
    
    if total_trades_loaded == 0:
        print("WARNING: No trades were successfully loaded! HTML will be empty.", file=sys.stderr)
        print("This might be due to:", file=sys.stderr)
        print("  1. Pickle errors (multiprocessing issues)", file=sys.stderr)
        print("  2. Missing OHLCV data", file=sys.stderr)
        print("  3. All trades filtered out", file=sys.stderr)
    
    # Calculate comprehensive caller stats for leaderboard
    caller_stats = []
    for caller, data in trades_by_caller.items():
        trades = data['trades']
        if not trades:
            continue
        
        # Calculate returns
        returns = [t['tp_sl_ret'] for t in trades]
        wins = [r for r in returns if r > 0]
        losses = [r for r in returns if r < 0]
        win_rate = (len(wins) / len(returns) * 100) if returns else 0
        
        # Calculate median ATH
        ath_values = [t['ath_mult'] for t in trades if t['ath_mult'] is not None and t['ath_mult'] > 0]
        median_ath = round(np.median(ath_values), 2) if ath_values else 0
        
        caller_stats.append({
            'name': caller,
            'total_calls': data['count'],
            'loaded_trades': len(trades),
            'avg_ath': round(np.mean([t['ath_mult'] for t in trades]), 2) if trades else 0,
            'median_ath': median_ath,
            'hit_2x': sum(1 for t in trades if t['time_to_2x'] is not None),
            'hit_5x': sum(1 for t in trades if t['time_to_5x'] is not None),
            'avg_return': round(np.mean(returns), 1) if returns else 0,
            'median_return': round(np.median(returns), 1) if returns else 0,
            'win_rate': round(win_rate, 1),
            'total_wins': len(wins),
            'total_losses': len(losses),
        })
    
    print(f"\nGenerating HTML report...")
    print(f"Summary: {len(all_trade_args)} trades processed, {total_trades_loaded} trades loaded, {len(caller_stats)} callers with stats")
    
    # Generate HTML
    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QuantBot Trade Drill-Down</title>
    <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg-primary: #0a0e17;
            --bg-secondary: #111827;
            --bg-card: #1a2234;
            --bg-hover: #243044;
            --accent-green: #10b981;
            --accent-red: #ef4444;
            --accent-blue: #3b82f6;
            --accent-purple: #8b5cf6;
            --accent-amber: #f59e0b;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --border-color: #2d3748;
        }}
        
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        
        body {{
            font-family: 'Space Grotesk', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
        }}
        
        .container {{
            max-width: 1800px;
            margin: 0 auto;
            padding: 1.5rem;
        }}
        
        .nav-bar {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            padding: 1rem 1.5rem;
            background: var(--bg-card);
            border-radius: 12px;
            border: 1px solid var(--border-color);
        }}
        
        .nav-title {{
            display: flex;
            align-items: center;
            gap: 1rem;
        }}
        
        h1 {{
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--accent-green);
            margin: 0;
        }}
        
        .nav-buttons {{
            display: flex;
            gap: 0.75rem;
        }}
        
        .nav-btn {{
            background: var(--bg-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            padding: 0.5rem 1rem;
            border-radius: 8px;
            font-family: inherit;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.2s;
        }}
        
        .nav-btn:hover {{
            background: var(--bg-hover);
            border-color: var(--accent-blue);
        }}
        
        .nav-btn.active {{
            background: var(--accent-blue);
            border-color: var(--accent-blue);
            color: white;
        }}
        
        .page {{
            display: none;
        }}
        
        .page.active {{
            display: block;
        }}
        
        .leaderboard-container {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            overflow: hidden;
        }}
        
        .leaderboard-header {{
            padding: 1.5rem;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
        }}
        
        .leaderboard-header h2 {{
            font-size: 1.25rem;
            font-weight: 600;
            margin: 0;
        }}
        
        .leaderboard-table {{
            width: 100%;
            border-collapse: collapse;
        }}
        
        .leaderboard-table th {{
            text-align: left;
            padding: 1rem 1.5rem;
            border-bottom: 2px solid var(--border-color);
            color: var(--text-secondary);
            font-weight: 600;
            font-size: 0.85rem;
            text-transform: uppercase;
            background: var(--bg-secondary);
        }}
        
        .leaderboard-table td {{
            padding: 1rem 1.5rem;
            border-bottom: 1px solid var(--border-color);
            font-size: 0.9rem;
        }}
        
        .leaderboard-table tr {{
            cursor: pointer;
            transition: background 0.2s;
        }}
        
        .leaderboard-table tr:hover {{
            background: var(--bg-hover);
        }}
        
        .leaderboard-table .rank {{
            font-family: 'JetBrains Mono', monospace;
            font-weight: 600;
            color: var(--text-muted);
            width: 60px;
        }}
        
        .leaderboard-table .caller-name {{
            font-weight: 600;
            color: var(--accent-blue);
        }}
        
        .leaderboard-table .stat-value {{
            font-family: 'JetBrains Mono', monospace;
            text-align: right;
        }}
        
        .leaderboard-table .stat-positive {{
            color: var(--accent-green);
        }}
        
        .leaderboard-table .stat-negative {{
            color: var(--accent-red);
        }}
        
        .caller-select {{
            display: flex;
            align-items: center;
            gap: 1rem;
        }}
        
        .caller-select label {{
            color: var(--text-secondary);
            font-size: 0.9rem;
        }}
        
        select {{
            background: var(--bg-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            padding: 0.5rem 1rem;
            border-radius: 8px;
            font-family: inherit;
            font-size: 0.9rem;
            cursor: pointer;
            min-width: 250px;
        }}
        
        select:hover {{
            border-color: var(--accent-blue);
        }}
        
        .main-grid {{
            display: grid;
            grid-template-columns: 1fr 400px;
            gap: 1.5rem;
        }}
        
        @media (max-width: 1200px) {{
            .main-grid {{ grid-template-columns: 1fr; }}
        }}
        
        .event-log {{
            background: var(--bg-secondary);
            border-top: 1px solid var(--border-color);
            padding: 1rem 1.5rem;
            max-height: 300px;
            overflow-y: auto;
        }}
        
        .event-log-title {{
            font-size: 0.85rem;
            font-weight: 600;
            margin-bottom: 0.75rem;
            color: var(--text-secondary);
        }}
        
        .event-table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 0.8rem;
        }}
        
        .event-table th {{
            text-align: left;
            padding: 0.5rem;
            border-bottom: 2px solid var(--border-color);
            color: var(--text-secondary);
            font-weight: 600;
            font-size: 0.75rem;
            text-transform: uppercase;
        }}
        
        .event-table td {{
            padding: 0.5rem;
            border-bottom: 1px solid var(--border-color);
            font-family: 'JetBrains Mono', monospace;
        }}
        
        .event-table tr:hover {{
            background: var(--bg-hover);
        }}
        
        .event-table .event-type {{
            font-family: 'Space Grotesk', sans-serif;
            color: var(--text-primary);
        }}
        
        .event-type-alert {{ color: var(--accent-amber); }}
        .event-type-entry {{ color: var(--accent-blue); }}
        .event-type-stop_loss_set {{ color: var(--accent-red); }}
        .event-type-stop_loss_triggered {{ color: var(--accent-red); font-weight: 600; }}
        .event-type-take_profit {{ color: var(--accent-green); font-weight: 600; }}
        .event-type-horizon_exit {{ color: var(--text-secondary); }}
        
        .event-table .price {{
            color: var(--text-primary);
        }}
        
        .event-table .change-positive {{
            color: var(--accent-green);
        }}
        
        .event-table .change-negative {{
            color: var(--accent-red);
        }}
        
        .event-table .impact-positive {{
            color: var(--accent-green);
        }}
        
        .event-table .impact-negative {{
            color: var(--accent-red);
        }}
        
        .chart-section {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            overflow: hidden;
        }}
        
        .chart-header {{
            padding: 1rem 1.5rem;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}
        
        .chart-title {{
            font-size: 1rem;
            font-weight: 600;
        }}
        
        .trade-info {{
            display: flex;
            gap: 1.5rem;
            font-size: 0.85rem;
        }}
        
        .trade-info-item {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        
        .trade-info-label {{
            color: var(--text-muted);
        }}
        
        .trade-info-value {{
            font-family: 'JetBrains Mono', monospace;
            font-weight: 600;
        }}
        
        .trade-info-value.positive {{ color: var(--accent-green); }}
        .trade-info-value.negative {{ color: var(--accent-red); }}
        
        #chart-container {{
            height: 500px;
            width: 100%;
        }}
        
        .legend {{
            display: flex;
            justify-content: center;
            gap: 2rem;
            padding: 0.75rem;
            background: var(--bg-secondary);
            border-top: 1px solid var(--border-color);
            font-size: 0.8rem;
        }}
        
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        
        .legend-marker {{
            width: 12px;
            height: 12px;
            border-radius: 2px;
        }}
        
        .legend-marker.alert {{ background: var(--accent-amber); }}
        .legend-marker.entry {{ background: var(--accent-blue); }}
        .legend-marker.exit {{ background: var(--accent-purple); }}
        .legend-marker.ath {{ background: var(--accent-green); }}
        
        .trades-section {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            max-height: 700px;
            overflow: hidden;
        }}
        
        .trades-header {{
            padding: 1rem 1.5rem;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            flex-shrink: 0;
        }}
        
        .trades-header h2 {{
            font-size: 1rem;
            font-weight: 600;
        }}
        
        .trades-list {{
            flex: 1;
            overflow-y: auto;
            min-height: 0;
        }}
        
        .trade-row {{
            padding: 0.75rem 1rem;
            border-bottom: 1px solid var(--border-color);
            cursor: pointer;
            transition: background 0.2s;
            display: grid;
            grid-template-columns: 1fr auto auto;
            gap: 0.75rem;
            align-items: center;
        }}
        
        .trade-row:hover {{
            background: var(--bg-hover);
        }}
        
        .trade-row.selected {{
            background: var(--bg-hover);
            border-left: 3px solid var(--accent-blue);
        }}
        
        .trade-mint {{
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.8rem;
            color: var(--text-secondary);
        }}
        
        .trade-date {{
            font-size: 0.75rem;
            color: var(--text-muted);
        }}
        
        .trade-ath {{
            font-family: 'JetBrains Mono', monospace;
            font-weight: 600;
            font-size: 0.9rem;
        }}
        
        .trade-ath.high {{ color: var(--accent-green); }}
        .trade-ath.medium {{ color: var(--accent-amber); }}
        .trade-ath.low {{ color: var(--text-secondary); }}
        
        .trade-return {{
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.85rem;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
        }}
        
        .trade-return.positive {{
            background: rgba(16, 185, 129, 0.2);
            color: var(--accent-green);
        }}
        
        .trade-return.negative {{
            background: rgba(239, 68, 68, 0.2);
            color: var(--accent-red);
        }}
        
        .no-data {{
            padding: 2rem;
            text-align: center;
            color: var(--text-muted);
        }}
        
        .caller-stats {{
            display: flex;
            gap: 1rem;
            margin-top: 0.5rem;
            font-size: 0.8rem;
            color: var(--text-secondary);
        }}
        
        .caller-stat {{
            display: flex;
            align-items: center;
            gap: 0.25rem;
        }}
        
        .caller-stat-value {{
            font-family: 'JetBrains Mono', monospace;
            color: var(--text-primary);
        }}
    </style>
</head>
    <body>
    <div class="container">
        <nav class="nav-bar">
            <div class="nav-title">
                <h1>⚡ QuantBot Backtest Report</h1>
            </div>
            <div class="nav-buttons">
                <button class="nav-btn active" onclick="showPage('leaderboard', this)">Leaderboard</button>
                <button class="nav-btn" onclick="showPage('caller-detail', this)" id="caller-detail-btn" style="display: none;">Caller Detail</button>
            </div>
        </nav>
        
        <!-- Leaderboard Page -->
        <div id="leaderboard-page" class="page active">
            <div class="leaderboard-container">
                <div class="leaderboard-header">
                    <h2>Caller Leaderboard</h2>
                    <p style="margin-top: 0.5rem; color: var(--text-secondary); font-size: 0.9rem;">
                        Click on a caller to view their alerts and trades
                    </p>
                </div>
                <table class="leaderboard-table">
                    <thead>
                        <tr>
                            <th class="rank">#</th>
                            <th>Caller</th>
                            <th style="text-align: right;">Total Calls</th>
                            <th style="text-align: right;">Avg ATH</th>
                            <th style="text-align: right;">Median ATH</th>
                            <th style="text-align: right;">2x Rate</th>
                            <th style="text-align: right;">5x Rate</th>
                            <th style="text-align: right;">Avg Return</th>
                            <th style="text-align: right;">Win Rate</th>
                        </tr>
                    </thead>
                    <tbody id="leaderboard-body">
                    </tbody>
                </table>
            </div>
        </div>
        
        <!-- Caller Detail Page -->
        <div id="caller-detail-page" class="page">
            <div class="nav-bar" style="margin-bottom: 1rem;">
                <div class="nav-title">
                    <h2 id="caller-detail-title" style="font-size: 1.25rem; margin: 0;">Caller: <span id="caller-name-display"></span></h2>
                </div>
                <div class="caller-select">
                    <label>View Alerts:</label>
                    <select id="caller-dropdown" onchange="onCallerChange()">
                        <option value="">-- Choose a caller --</option>
                        {' '.join([f'<option value="{c["name"]}">{c["name"]} ({c["total_calls"]} calls)</option>' for c in sorted(caller_stats, key=lambda x: -x['total_calls'])])}
                    </select>
                </div>
            </div>
            
            <div id="caller-info" style="display: none; margin-bottom: 1.5rem; padding: 1rem 1.5rem; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color);">
                <div class="caller-stats">
                    <div class="caller-stat">Total Calls: <span class="caller-stat-value" id="stat-total"></span></div>
                    <div class="caller-stat">Avg ATH: <span class="caller-stat-value" id="stat-ath"></span></div>
                    <div class="caller-stat">Median ATH: <span class="caller-stat-value" id="stat-median-ath"></span></div>
                    <div class="caller-stat">2x Rate: <span class="caller-stat-value" id="stat-2x"></span></div>
                    <div class="caller-stat">5x Rate: <span class="caller-stat-value" id="stat-5x"></span></div>
                    <div class="caller-stat">Avg Return: <span class="caller-stat-value" id="stat-return"></span></div>
                    <div class="caller-stat">Win Rate: <span class="caller-stat-value" id="stat-winrate"></span></div>
                </div>
            </div>
            
            <div class="main-grid">
            <div class="chart-section">
                <div class="chart-header">
                    <div class="chart-title" id="chart-title">Select a trade to view chart</div>
                    <div class="trade-info" id="trade-info" style="display: none;">
                        <div class="trade-info-item">
                            <span class="trade-info-label">ATH:</span>
                            <span class="trade-info-value positive" id="info-ath"></span>
                        </div>
                        <div class="trade-info-item">
                            <span class="trade-info-label">Return:</span>
                            <span class="trade-info-value" id="info-return"></span>
                        </div>
                        <div class="trade-info-item">
                            <span class="trade-info-label">Exit:</span>
                            <span class="trade-info-value" id="info-exit"></span>
                        </div>
                    </div>
                </div>
                <div id="chart-container"></div>
                <div class="legend">
                    <div class="legend-item"><div class="legend-marker alert"></div> Alert</div>
                    <div class="legend-item"><div class="legend-marker entry"></div> Entry</div>
                    <div class="legend-item"><div class="legend-marker exit"></div> Exit</div>
                    <div class="legend-item"><div class="legend-marker ath"></div> ATH</div>
                </div>
                <div class="event-log" id="event-log" style="display: none;">
                    <div class="event-log-title">Trade Event Log</div>
                    <div id="event-list"></div>
                </div>
            </div>
            
            <div class="trades-section">
                <div class="trades-header">
                    <h2>Trades (<span id="trades-count">0</span>)</h2>
                </div>
                <div class="trades-list" id="trades-list">
                    <div class="no-data">Select a caller to view trades</div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Trade data
        const tradeData = {json.dumps(trades_by_caller)};
        const callerStats = {json.dumps(caller_stats)};
        
        // Check if we have any data
        const hasData = Object.keys(tradeData).length > 0 && callerStats.length > 0;
        const totalTradesProcessed = {len(all_trade_args)};
        const totalTradesLoaded = {total_trades_loaded};
        
        let chart = null;
        let candleSeries = null;
        let currentTrades = [];
        let selectedTradeIndex = -1;
        let currentPage = 'leaderboard';
        
        // Initialize on page load
        window.addEventListener('DOMContentLoaded', () => {{
            if (!hasData) {{
                // Show error message if no data
                const leaderboardBody = document.getElementById('leaderboard-body');
                if (leaderboardBody) {{
                    leaderboardBody.innerHTML = `
                        <tr>
                            <td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                                <h3 style="color: var(--accent-red); margin-bottom: 1rem;">⚠️ No Trade Data Available</h3>
                                <p>No trades were successfully loaded for this run.</p>
                                <p style="margin-top: 1rem;"><strong>Statistics:</strong></p>
                                <ul style="text-align: left; display: inline-block; margin-top: 0.5rem;">
                                    <li>Trades processed: ${{totalTradesProcessed}}</li>
                                    <li>Trades loaded: ${{totalTradesLoaded}}</li>
                                </ul>
                                <p style="margin-top: 1rem;"><strong>Possible causes:</strong></p>
                                <ul style="text-align: left; display: inline-block; margin-top: 0.5rem;">
                                    <li>Multiprocessing/pickle errors during generation</li>
                                    <li>Missing OHLCV data in slices/per_token/ directory</li>
                                    <li>All trades were filtered out or failed validation</li>
                                </ul>
                                <p style="margin-top: 1rem; color: var(--text-secondary); font-size: 0.9rem;">
                                    Check server logs (stderr) for detailed error messages.
                                </p>
                            </td>
                        </tr>
                    `;
                }}
                return;
            }}
            
            // Always render leaderboard first
            renderLeaderboard();
            
            // If we're on the caller detail page, auto-select first caller
            const callerDetailPage = document.getElementById('caller-detail-page');
            if (callerDetailPage && callerDetailPage.classList.contains('active')) {{
                const dropdown = document.getElementById('caller-dropdown');
                if (dropdown && dropdown.options.length > 1) {{
                    dropdown.selectedIndex = 1;
                    onCallerChange();
                }}
            }}
        }});
        
        // Render leaderboard table
        function renderLeaderboard() {{
            if (!hasData) {{
                console.warn('No data available for leaderboard');
                return;
            }}
            
            const tbody = document.getElementById('leaderboard-body');
            const sortedStats = [...callerStats].sort((a, b) => {{
                // Sort by total calls first, then by avg ATH
                if (b.total_calls !== a.total_calls) return b.total_calls - a.total_calls;
                return b.avg_ath - a.avg_ath;
            }});
            
            tbody.innerHTML = sortedStats.map((stat, idx) => {{
                const rank = idx + 1;
                const medianAth = stat.median_ath || stat.avg_ath;
                const winRate = stat.win_rate || 0;
                const returnClass = stat.avg_return >= 0 ? 'stat-positive' : 'stat-negative';
                const winRateClass = winRate >= 50 ? 'stat-positive' : 'stat-negative';
                const hit2xRate = Math.round(100 * stat.hit_2x / stat.loaded_trades);
                const hit5xRate = Math.round(100 * stat.hit_5x / stat.loaded_trades);
                
                return `
                    <tr onclick="viewCaller('${{stat.name}}')" style="cursor: pointer;">
                        <td class="rank">${{rank}}</td>
                        <td class="caller-name">${{stat.name}}</td>
                        <td class="stat-value">${{stat.total_calls}}</td>
                        <td class="stat-value">${{stat.avg_ath}}x</td>
                        <td class="stat-value">${{medianAth}}x</td>
                        <td class="stat-value">${{hit2xRate}}%</td>
                        <td class="stat-value">${{hit5xRate}}%</td>
                        <td class="stat-value ${{returnClass}}">${{stat.avg_return > 0 ? '+' : ''}}${{stat.avg_return}}%</td>
                        <td class="stat-value ${{winRateClass}}">${{winRate.toFixed(1)}}%</td>
                    </tr>
                `;
            }}).join('');
        }}
        
        // Navigate to caller detail view
        function viewCaller(callerName) {{
            // Find the caller detail button and activate it
            const callerDetailBtn = document.getElementById('caller-detail-btn');
            if (callerDetailBtn) {{
                callerDetailBtn.style.display = 'block';
            }}
            showPage('caller-detail', callerDetailBtn);
            document.getElementById('caller-name-display').textContent = callerName;
            document.getElementById('caller-dropdown').value = callerName;
            onCallerChange();
        }}
        
        // Page navigation
        function showPage(pageName, buttonElement) {{
            // Hide all pages
            document.querySelectorAll('.page').forEach(page => {{
                page.classList.remove('active');
            }});
            
            // Show selected page
            const pageElement = document.getElementById(pageName + '-page');
            if (pageElement) {{
                pageElement.classList.add('active');
            }}
            
            // Update nav buttons
            document.querySelectorAll('.nav-btn').forEach(btn => {{
                btn.classList.remove('active');
            }});
            
            // Activate the correct button
            if (buttonElement) {{
                buttonElement.classList.add('active');
            }} else {{
                // If called programmatically without button, find it by page name
                document.querySelectorAll('.nav-btn').forEach(btn => {{
                    const btnText = btn.textContent.toLowerCase().trim();
                    const pageMatch = (pageName === 'leaderboard' && btnText === 'leaderboard') ||
                                     (pageName === 'caller-detail' && btnText === 'caller detail');
                    if (pageMatch) {{
                        btn.classList.add('active');
                    }}
                }});
            }}
            
            // Show/hide caller detail button based on page
            const callerDetailBtn = document.getElementById('caller-detail-btn');
            if (callerDetailBtn) {{
                if (pageName === 'caller-detail') {{
                    callerDetailBtn.style.display = 'block';
                }} else {{
                    callerDetailBtn.style.display = 'none';
                }}
            }}
            
            currentPage = pageName;
        }}
        
        function onCallerChange() {{
            const caller = document.getElementById('caller-dropdown').value;
            
            if (!caller || !tradeData[caller]) {{
                document.getElementById('trades-list').innerHTML = '<div class="no-data">Select a caller to view trades</div>';
                document.getElementById('trades-count').textContent = '0';
                document.getElementById('caller-info').style.display = 'none';
                document.getElementById('caller-name-display').textContent = '';
                clearChart();
                return;
            }}
            
            // Update caller name display
            document.getElementById('caller-name-display').textContent = caller;
            
            // Update caller stats
            const stats = callerStats.find(s => s.name === caller);
            if (stats) {{
                document.getElementById('caller-info').style.display = 'block';
                document.getElementById('stat-total').textContent = stats.total_calls;
                document.getElementById('stat-ath').textContent = stats.avg_ath + 'x';
                const medianAth = stats.median_ath || stats.avg_ath;
                document.getElementById('stat-median-ath').textContent = medianAth + 'x';
                document.getElementById('stat-2x').textContent = Math.round(100 * stats.hit_2x / stats.loaded_trades) + '%';
                document.getElementById('stat-5x').textContent = Math.round(100 * stats.hit_5x / stats.loaded_trades) + '%';
                document.getElementById('stat-return').textContent = stats.avg_return + '%';
                const winRate = stats.win_rate || 0;
                document.getElementById('stat-winrate').textContent = winRate.toFixed(1) + '%';
            }}
            
            currentTrades = tradeData[caller].trades;
            renderTrades();
            
            // Auto-select first trade
            if (currentTrades.length > 0) {{
                selectTrade(0);
            }}
        }}
        
        function renderTrades() {{
            const container = document.getElementById('trades-list');
            document.getElementById('trades-count').textContent = currentTrades.length;
            
            if (currentTrades.length === 0) {{
                container.innerHTML = '<div class="no-data">No trades found</div>';
                return;
            }}
            
            container.innerHTML = currentTrades.map((trade, idx) => {{
                const athClass = trade.ath_mult >= 5 ? 'high' : (trade.ath_mult >= 2 ? 'medium' : 'low');
                const retClass = trade.tp_sl_ret >= 0 ? 'positive' : 'negative';
                const selected = idx === selectedTradeIndex ? 'selected' : '';
                
                return `
                    <div class="trade-row ${{selected}}" onclick="selectTrade(${{idx}})">
                        <div>
                            <div class="trade-mint">${{trade.display_name || (trade.token_name + ' (' + trade.token_symbol + ')')}}</div>
                            <div class="trade-mint-address" style="font-size: 0.7rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;">${{trade.mint}}</div>
                            <div class="trade-date">${{trade.alert_ts}}</div>
                        </div>
                        <div class="trade-ath ${{athClass}}">${{trade.ath_mult}}x</div>
                        <div class="trade-return ${{retClass}}">${{trade.tp_sl_ret > 0 ? '+' : ''}}${{trade.tp_sl_ret}}%</div>
                    </div>
                `;
            }}).join('');
        }}
        
        function selectTrade(idx) {{
            selectedTradeIndex = idx;
            renderTrades();
            
            const trade = currentTrades[idx];
            renderChart(trade);
        }}
        
        function clearChart() {{
            if (chart) {{
                chart.remove();
                chart = null;
            }}
            document.getElementById('chart-title').textContent = 'Select a trade to view chart';
            document.getElementById('trade-info').style.display = 'none';
            document.getElementById('event-log').style.display = 'none';
        }}
        
        function renderChart(trade) {{
            const container = document.getElementById('chart-container');
            
            // Remove existing chart
            if (chart) {{
                chart.remove();
            }}
            
            // Update header
            const displayName = trade.display_name || (trade.token_name + ' (' + trade.token_symbol + ')');
            document.getElementById('chart-title').textContent = displayName + ' - ' + trade.mint;
            document.getElementById('trade-info').style.display = 'flex';
            document.getElementById('info-ath').textContent = trade.ath_mult + 'x';
            
            const returnEl = document.getElementById('info-return');
            returnEl.textContent = (trade.tp_sl_ret > 0 ? '+' : '') + trade.tp_sl_ret + '%';
            returnEl.className = 'trade-info-value ' + (trade.tp_sl_ret >= 0 ? 'positive' : 'negative');
            
            document.getElementById('info-exit').textContent = trade.exit_reason || 'N/A';
            
            // Render event log
            renderEventLog(trade);
            
            // Create chart
            chart = LightweightCharts.createChart(container, {{
                width: container.clientWidth,
                height: 500,
                layout: {{
                    background: {{ type: 'solid', color: '#1a2234' }},
                    textColor: '#94a3b8',
                }},
                grid: {{
                    vertLines: {{ color: '#2d3748' }},
                    horzLines: {{ color: '#2d3748' }},
                }},
                crosshair: {{
                    mode: LightweightCharts.CrosshairMode.Normal,
                }},
                timeScale: {{
                    timeVisible: true,
                    secondsVisible: false,
                }},
                rightPriceScale: {{
                    visible: true,
                    borderColor: '#2d3748',
                    scaleMargins: {{
                        top: 0.1,
                        bottom: 0.1,
                    }},
                    entireTextOnly: false,
                    ticksVisible: true,
                    autoScale: true,
                }},
                leftPriceScale: {{
                    visible: false,
                }},
                localization: {{
                    priceFormatter: (price) => {{
                        if (price === 0 || !isFinite(price)) return '0.00';
                        return price.toFixed(8);
                    }},
                }},
            }});
            
            // Add candlestick series
            candleSeries = chart.addCandlestickSeries({{
                upColor: '#10b981',
                downColor: '#ef4444',
                borderUpColor: '#10b981',
                borderDownColor: '#ef4444',
                wickUpColor: '#10b981',
                wickDownColor: '#ef4444',
                priceFormat: {{
                    type: 'price',
                    precision: 8,
                    minMove: 0.00000001,
                }},
                priceScaleId: 'right',
            }});
            
            // Filter and set candles (only horizon window)
            const horizonCandles = trade.ohlcv.filter(c => {{
                return c.time >= trade.alert_ts_unix && c.time <= (trade.horizon_end_ts || trade.alert_ts_unix + 48 * 3600);
            }});
            
            candleSeries.setData(horizonCandles);
            
            // Collect markers for all events
            const markers = [];
            
            // Add price lines and markers from events
            if (trade.events && trade.events.length > 0) {{
                trade.events.forEach(event => {{
                    if (event.type === 'alert') {{
                        markers.push({{
                            time: event.time,
                            position: 'belowBar',
                            color: '#f59e0b',
                            shape: 'arrowUp',
                            text: 'ALERT',
                        }});
                    }} else if (event.type === 'entry') {{
                        markers.push({{
                            time: event.time,
                            position: 'belowBar',
                            color: '#3b82f6',
                            shape: 'arrowUp',
                            text: 'ENTRY',
                        }});
                    }} else if (event.type === 'stop_loss_triggered') {{
                        markers.push({{
                            time: event.time,
                            position: 'aboveBar',
                            color: '#ef4444',
                            shape: 'arrowDown',
                            text: 'SL EXIT',
                            size: 2,
                        }});
                    }} else if (event.type === 'take_profit') {{
                        markers.push({{
                            time: event.time,
                            position: 'aboveBar',
                            color: '#10b981',
                            shape: 'arrowDown',
                            text: 'TP EXIT',
                            size: 2,
                        }});
                    }} else if (event.type === 'horizon_exit') {{
                        markers.push({{
                            time: event.time,
                            position: 'aboveBar',
                            color: '#94a3b8',
                            shape: 'arrowDown',
                            text: 'HORIZON EXIT',
                            size: 2,
                        }});
                    }}
                }});
                
                candleSeries.setMarkers(markers);
            }}
            
            // Add price lines
            if (trade.entry_price && isFinite(trade.entry_price)) {{
                candleSeries.createPriceLine({{
                    price: trade.entry_price,
                    color: '#3b82f6',
                    lineWidth: 2,
                    lineStyle: LightweightCharts.LineStyle.Solid,
                    axisLabelVisible: true,
                    title: 'Entry $' + trade.entry_price.toFixed(8),
                }});
            }}
            
            if (trade.sl_price && isFinite(trade.sl_price)) {{
                candleSeries.createPriceLine({{
                    price: trade.sl_price,
                    color: '#ef4444',
                    lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'SL $' + trade.sl_price.toFixed(8) + ' (' + (trade.sl_mult * 100).toFixed(0) + '%)',
                }});
            }}
            
            if (trade.tp_price && isFinite(trade.tp_price)) {{
                candleSeries.createPriceLine({{
                    price: trade.tp_price,
                    color: '#10b981',
                    lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'TP $' + trade.tp_price.toFixed(8) + ' (' + (trade.tp_mult * 100).toFixed(0) + '%)',
                }});
            }}
            
            // Add ATH price line
            const athPrice = trade.entry_price * trade.ath_mult;
            if (athPrice && isFinite(athPrice)) {{
                candleSeries.createPriceLine({{
                    price: athPrice,
                    color: '#10b981',
                    lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dotted,
                    axisLabelVisible: true,
                    title: 'ATH ' + trade.ath_mult + 'x',
                }});
            }}
            
            chart.timeScale().fitContent();
            
            // Handle resize
            window.addEventListener('resize', () => {{
                if (chart) {{
                    chart.applyOptions({{ width: container.clientWidth }});
                }}
            }});
        }}
        
        function renderEventLog(trade) {{
            const eventLog = document.getElementById('event-log');
            const eventList = document.getElementById('event-list');
            
            if (!trade.events || trade.events.length === 0) {{
                eventLog.style.display = 'none';
                return;
            }}
            
            eventLog.style.display = 'block';
            
            let html = '<table class="event-table">';
            html += '<thead><tr>';
            html += '<th>Event</th>';
            html += '<th style="text-align: right;">Price ($)</th>';
            html += '<th style="text-align: right;">Change (%)</th>';
            html += '<th style="text-align: right;">Portfolio Impact (%)</th>';
            html += '</tr></thead><tbody>';
            
            trade.events.forEach(event => {{
                const priceStr = event.price ? '$' + event.price.toFixed(8) : '-';
                const changePct = event.change_pct !== null && event.change_pct !== undefined 
                    ? (event.change_pct > 0 ? '+' : '') + event.change_pct.toFixed(1) + '%'
                    : '-';
                const changeClass = event.change_pct > 0 ? 'change-positive' : (event.change_pct < 0 ? 'change-negative' : '');
                const impactPct = event.portfolio_impact_pct !== null && event.portfolio_impact_pct !== undefined
                    ? (event.portfolio_impact_pct > 0 ? '+' : '') + event.portfolio_impact_pct.toFixed(2) + '%'
                    : '-';
                const impactClass = event.portfolio_impact_pct > 0 ? 'impact-positive' : (event.portfolio_impact_pct < 0 ? 'impact-negative' : '');
                
                // Get event name from type
                let eventName = event.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                if (event.type === 'stop_loss_set') eventName = 'Stop Loss Set';
                if (event.type === 'stop_loss_triggered') eventName = 'Stop Loss Triggered';
                if (event.type === 'take_profit') eventName = 'Take Profit';
                if (event.type === 'horizon_exit') eventName = 'Horizon Exit';
                
                html += '<tr>';
                html += '<td class="event-type event-type-' + event.type + '">' + eventName + '</td>';
                html += '<td class="price" style="text-align: right;">' + priceStr + '</td>';
                html += '<td class="' + changeClass + '" style="text-align: right;">' + changePct + '</td>';
                html += '<td class="' + impactClass + '" style="text-align: right;">' + impactPct + '</td>';
                html += '</tr>';
            }});
            
            html += '</tbody></table>';
            eventList.innerHTML = html;
        }}
        
    </script>
</body>
</html>
'''
    
    with open(output_path, 'w') as f:
        f.write(html)
    
    print(f"\nReport generated: {output_path}")
    return output_path

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Generate drill-down HTML report')
    parser.add_argument('csv_path', nargs='?', default='results/strategy_results.csv', help='Path to CSV results file')
    parser.add_argument('--output', '-o', help='Output HTML file path')
    parser.add_argument('--risk-per-trade', type=float, default=0.02, help='Risk per trade as fraction (default: 0.02 = 2%%)')
    parser.add_argument('--max-trades', type=int, default=50, help='Max trades per caller (default: 50)')
    parser.add_argument('--tp-mult', type=float, default=80.0, help='Default TP multiplier (default: 80.0)')
    parser.add_argument('--sl-mult', type=float, default=0.7, help='Default SL multiplier (default: 0.7)')
    parser.add_argument('--workers', type=int, default=None, help='Number of worker processes (default: CPU count)')
    args = parser.parse_args()
    
    generate_drilldown_report(args.csv_path, args.output, args.max_trades, args.risk_per_trade, args.tp_mult, args.sl_mult, args.workers)

