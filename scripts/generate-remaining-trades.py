#!/usr/bin/env python3
"""
Generate remaining trades from Aug 25 to Dec 15, 2025.
Pulls real mint addresses from tele.duckdb and ensures weekly/monthly profit targets.
"""

import duckdb
import json
import csv
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple
import random
from pathlib import Path
from collections import defaultdict


def query_calls_from_db(duckdb_path: str, limit: int = 2000) -> List[Dict[str, Any]]:
    """Query calls from tele.duckdb database."""
    con = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        # Check if user_calls_d table exists
        tables = con.execute("SHOW TABLES").fetchall()
        table_names = [t[0] for t in tables]
        
        if 'user_calls_d' not in table_names:
            print(f"Warning: user_calls_d not found. Available tables: {', '.join(table_names)}")
            return []
        
        # Query calls with mint addresses
        query = """
            SELECT DISTINCT
                mint,
                call_datetime,
                caller_name
            FROM user_calls_d
            WHERE mint IS NOT NULL 
              AND TRIM(CAST(mint AS VARCHAR)) != ''
              AND call_datetime IS NOT NULL
            ORDER BY call_datetime DESC
            LIMIT ?
        """
        
        result = con.execute(query, [limit]).fetchall()
        
        calls = []
        for row in result:
            mint = str(row[0])
            call_datetime = row[1]
            caller_name = row[2] if len(row) > 2 else None
            
            # Convert datetime to ISO format
            if isinstance(call_datetime, datetime):
                alert_timestamp = call_datetime.isoformat()
            elif isinstance(call_datetime, str):
                alert_timestamp = call_datetime
            else:
                continue
            
            calls.append({
                'mint': mint,
                'alert_timestamp': alert_timestamp,
                'caller_name': caller_name
            })
        
        return calls
    finally:
        con.close()


def parse_existing_trades(csv_data: str) -> List[Dict[str, Any]]:
    """Parse the existing trades from the user's CSV-like data."""
    lines = csv_data.strip().split('\n')
    if not lines:
        return []
    
    # Skip header if present
    if 'TradeNumber' in lines[0]:
        lines = lines[1:]
    
    trades = []
    for line in lines:
        if not line.strip():
            continue
        
        parts = line.split('\t')
        if len(parts) < 10:
            continue
        
        try:
            trade_num = int(parts[0])
            token_address = parts[1].strip()
            alert_time = parts[2].strip()
            entry_time = parts[3].strip()
            exit_time = parts[4].strip()
            pnl = float(parts[5]) if parts[5] else 1.0
            pnl_percent = float(parts[6]) if parts[6] else 0.0
            max_reached = float(parts[7]) if parts[7] else 1.0
            hold_duration = int(parts[8]) if parts[8] else 120
            is_win = parts[9].strip() == 'Yes'
            
            trades.append({
                'TradeNumber': trade_num,
                'TokenAddress': token_address,
                'AlertTime': alert_time,
                'EntryTime': entry_time,
                'ExitTime': exit_time,
                'PnL': pnl,
                'PnLPercent': pnl_percent,
                'MaxReached': max_reached,
                'HoldDurationMinutes': hold_duration,
                'IsWin': is_win
            })
        except (ValueError, IndexError) as e:
            print(f"Warning: Skipping malformed line: {line[:50]}... Error: {e}")
            continue
    
    return trades


def calculate_current_profit(trades: List[Dict[str, Any]]) -> Dict[str, float]:
    """Calculate current profit metrics."""
    if not trades:
        return {'non_compounded': 0.0, 'compounded': 1.0}
    
    # Non-compounded: sum of all PnLPercent
    non_compounded = sum(t['PnLPercent'] for t in trades) / 100.0
    
    # Compounded: product of all PnL values
    compounded = 1.0
    for t in trades:
        compounded *= t['PnL']
    
    return {
        'non_compounded': non_compounded,
        'compounded': compounded,
        'compounded_percent': (compounded - 1.0) * 100.0
    }


def get_week_start(date: datetime) -> datetime:
    """Get the Monday of the week containing the date."""
    days_since_monday = date.weekday()
    monday = date - timedelta(days=days_since_monday)
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def get_month(date: datetime) -> str:
    """Get month string (Aug, Sep, etc.)."""
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return months[date.month - 1]


def group_trades_by_week(trades: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Group trades by week start date."""
    week_trades = defaultdict(list)
    
    for trade in trades:
        try:
            # Parse alert time
            alert_str = trade['AlertTime']
            if alert_str.endswith('Z'):
                alert_str = alert_str[:-1] + '+00:00'
            alert_date = datetime.fromisoformat(alert_str.replace('+10:00', '+00:00'))
            week_start = get_week_start(alert_date)
            week_key = week_start.strftime('%Y-%m-%d')
            week_trades[week_key].append(trade)
        except Exception as e:
            print(f"Warning: Could not parse date for trade {trade.get('TradeNumber', '?')}: {e}")
    
    return dict(week_trades)


def group_trades_by_month(trades: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Group trades by month."""
    month_trades = defaultdict(list)
    
    for trade in trades:
        try:
            alert_str = trade['AlertTime']
            if alert_str.endswith('Z'):
                alert_str = alert_str[:-1] + '+00:00'
            alert_date = datetime.fromisoformat(alert_str.replace('+10:00', '+00:00'))
            month_key = get_month(alert_date)
            month_trades[month_key].append(trade)
        except Exception as e:
            print(f"Warning: Could not parse date for trade {trade.get('TradeNumber', '?')}: {e}")
    
    return dict(month_trades)




# Weekly targets: (week_start_date, num_trades, weekly_pnl_percent, cumulative_pnl_percent)
WEEKLY_TARGETS = [
    ("2025-08-25", 130, 18.40, 18.40),
    ("2025-09-01", 135, 17.11, 35.51),
    ("2025-09-08", 167, 12.77, 48.28),
    ("2025-09-15", 114, 16.89, 65.17),
    ("2025-09-22", 58, 8.70, 73.87),
    ("2025-09-29", 65, 9.00, 82.87),
    ("2025-10-06", 67, 4.13, 87.00),
    ("2025-10-13", 65, 2.29, 89.29),
    ("2025-10-20", 67, 0.62, 89.91),
    ("2025-10-27", 68, 2.14, 92.05),
    ("2025-11-03", 55, 0.22, 92.27),
    ("2025-11-10", 47, -2.54, 89.73),
    ("2025-11-17", 39, 1.45, 91.18),
    ("2025-11-24", 81, 4.83, 96.01),
    ("2025-12-01", 115, 9.34, 105.35),
    ("2025-12-08", 123, 15.49, 120.84),
    ("2025-12-15", 151, 12.20, 133.04),
]

# Monthly targets: (month, monthly_pnl_percent, cumulative_pnl_percent, cumulative_compounded)
MONTHLY_TARGETS = {
    "Jul": (0.00, 0.00, 1.00),
    "Aug": (18.40, 18.40, 1.184),
    "Sep": (55.47, 98.68, 1.9868),
    "Oct": (18.18, 137.06, 1.9206),
    "Nov": (3.96, 146.25, 1.9625),
    "Dec": (37.03, 248.90, 2.4890),
}


def generate_trades_for_week(week_start: str, num_trades: int, target_pnl_percent: float,
                            existing_trades_in_week: List[Dict[str, Any]],
                            calls: List[Dict[str, Any]], 
                            start_trade_num: int) -> Tuple[List[Dict[str, Any]], float]:
    """Generate trades for a specific week to meet the target PnL."""
    
    # Calculate existing PnL for this week
    existing_pnl = sum(t['PnLPercent'] for t in existing_trades_in_week)
    existing_count = len(existing_trades_in_week)
    
    # Calculate needed PnL
    needed_pnl_percent = target_pnl_percent - existing_pnl
    needed_trades = num_trades - existing_count
    
    if needed_trades <= 0:
        return [], existing_pnl
    
    # Calculate average PnL per trade needed
    avg_pnl_per_trade = needed_pnl_percent / needed_trades if needed_trades > 0 else 0
    
    # Generate trades
    new_trades = []
    week_start_date = datetime.fromisoformat(week_start)
    
    # Distribute trades across the week (Mon-Sun)
    for i in range(needed_trades):
        # Distribute evenly across the week
        day_offset = (i * 7) // needed_trades
        trade_date = week_start_date + timedelta(days=day_offset, hours=random.randint(0, 23))
        
        # Select a call
        call = calls[i % len(calls)]
        
        # Generate PnL to meet target
        # Use a realistic distribution: 60% win rate
        if random.random() < 0.6:  # Win
            # Wins: distribute around the needed average
            base_pnl = 1.0 + (avg_pnl_per_trade / 100.0) * 1.5  # Scale up for losses
            pnl = max(1.0, min(3.0, base_pnl + random.uniform(-0.05, 0.3)))
        else:  # Loss
            # Losses: -20% to 0%
            pnl = random.uniform(0.8, 1.0)
        
        pnl_percent = (pnl - 1.0) * 100.0
        
        # Generate entry/exit times
        entry_offset_days = random.uniform(0.5, 2.0)
        entry_time = trade_date + timedelta(days=entry_offset_days)
        exit_offset_hours = random.uniform(2, 4)
        exit_time = entry_time + timedelta(hours=exit_offset_hours)
        hold_duration = int((exit_time - entry_time).total_seconds() / 60)
        
        # Max reached
        max_reached = pnl * random.uniform(1.0, 1.5) if pnl > 1.0 else 1.0
        
        # Format times
        alert_time_iso = trade_date.isoformat().replace('+00:00', '') + 'Z'
        entry_time_iso = entry_time.isoformat().replace('+00:00', '') + '+10:00'
        exit_time_iso = exit_time.isoformat().replace('+00:00', '') + '+10:00'
        
        new_trades.append({
            'TradeNumber': start_trade_num + i,
            'TokenAddress': call['mint'],
            'AlertTime': alert_time_iso,
            'EntryTime': entry_time_iso,
            'ExitTime': exit_time_iso,
            'PnL': round(pnl, 6),
            'PnLPercent': round(pnl_percent, 2),
            'MaxReached': round(max_reached, 4),
            'HoldDurationMinutes': hold_duration,
            'IsWin': 'Yes' if pnl > 1.0 else 'No'
        })
    
    # Adjust last few trades to hit exact target
    actual_pnl = existing_pnl + sum(t['PnLPercent'] for t in new_trades)
    if abs(actual_pnl - target_pnl_percent) > 0.1 and len(new_trades) > 0:
        adjustment = (target_pnl_percent - actual_pnl) / min(5, len(new_trades))
        for i in range(min(5, len(new_trades))):
            idx = len(new_trades) - 1 - i
            old_pnl = new_trades[idx]['PnL']
            new_pnl = old_pnl + (adjustment / 100.0)
            new_pnl = max(0.5, min(5.0, new_pnl))
            new_trades[idx]['PnL'] = round(new_pnl, 6)
            new_trades[idx]['PnLPercent'] = round((new_pnl - 1.0) * 100.0, 2)
            new_trades[idx]['IsWin'] = 'Yes' if new_pnl > 1.0 else 'No'
    
    final_pnl = existing_pnl + sum(t['PnLPercent'] for t in new_trades)
    return new_trades, final_pnl


def generate_remaining_trades(existing_trades: List[Dict[str, Any]],
                             calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Generate remaining trades to match weekly targets."""
    
    # Group existing trades by week
    week_trades = group_trades_by_week(existing_trades)
    
    # Shuffle calls
    available_calls = calls.copy()
    random.shuffle(available_calls)
    if len(available_calls) < 2000:
        multiplier = (2000 // len(available_calls)) + 1
        available_calls = (available_calls * multiplier)[:2000]
    
    # Generate trades for each week
    all_new_trades = []
    current_trade_num = len(existing_trades) + 1
    
    print("\nGenerating trades by week:")
    print("-" * 80)
    
    # Track all trades processed so far for cumulative calculation
    all_trades_so_far = []
    
    for week_start, target_trades, target_weekly_pnl, target_cumulative_pnl in WEEKLY_TARGETS:
        existing_in_week = week_trades.get(week_start, [])
        existing_count = len(existing_in_week)
        existing_pnl = sum(t['PnLPercent'] for t in existing_in_week)
        
        new_trades, actual_pnl = generate_trades_for_week(
            week_start, target_trades, target_weekly_pnl,
            existing_in_week, available_calls, current_trade_num
        )
        
        all_new_trades.extend(new_trades)
        current_trade_num += len(new_trades)
        
        # Add to running list
        all_trades_so_far.extend(existing_in_week)
        all_trades_so_far.extend(new_trades)
        
        # Calculate cumulative: sum of all PnLPercent so far
        cumulative_pnl_percent = sum(t['PnLPercent'] for t in all_trades_so_far)
        
        # Calculate cumulative compounded
        cumulative_compounded = 1.0
        for trade in all_trades_so_far:
            cumulative_compounded *= trade['PnL']
        cumulative_compounded_percent = (cumulative_compounded - 1.0) * 100.0
        
        print(f"Week {week_start}: {existing_count} existing + {len(new_trades)} new = "
              f"{existing_count + len(new_trades)} total | "
              f"Weekly PnL: {actual_pnl:.2f}% (target: {target_weekly_pnl:.2f}%) | "
              f"Cumulative: {cumulative_pnl_percent:.2f}% (target: {target_cumulative_pnl:.2f}%) | "
              f"Compounded: {cumulative_compounded_percent:.2f}%")
    
    print("-" * 80)
    
    return all_new_trades


def main():
    # Configuration
    duckdb_path = "data/tele.duckdb"
    existing_trades_file = "existing_trades.txt"
    output_file = "all_trades_1547.csv"
    
    # Read existing trades
    print("Reading existing trades...")
    if not Path(existing_trades_file).exists():
        print(f"Error: {existing_trades_file} not found.")
        print("Please create this file with your existing trades data (tab-separated)")
        return
    
    with open(existing_trades_file, 'r') as f:
        existing_trades_data = f.read()
    
    existing_trades = parse_existing_trades(existing_trades_data)
    print(f"Parsed {len(existing_trades)} existing trades")
    
    # Query calls from database
    print(f"\nQuerying calls from {duckdb_path}...")
    calls = query_calls_from_db(duckdb_path, limit=2000)
    print(f"Found {len(calls)} calls in database")
    
    if len(calls) == 0:
        print("Warning: No calls found in database. Using placeholder mints.")
        calls = [{'mint': f'PLACEHOLDER_{i:04d}', 'alert_timestamp': '', 'caller_name': None} 
                 for i in range(2000)]
    
    # Generate remaining trades
    print("\nGenerating remaining trades to match weekly targets...")
    new_trades = generate_remaining_trades(existing_trades, calls)
    
    # Combine all trades
    all_trades = existing_trades + new_trades
    all_trades.sort(key=lambda t: t['TradeNumber'])
    
    # Verify final profit
    final_profit = calculate_current_profit(all_trades)
    print(f"\n{'='*80}")
    print(f"FINAL RESULTS:")
    print(f"  Total trades: {len(all_trades)} (target: 1547)")
    print(f"  Non-compounded: {final_profit['non_compounded']*100:.2f}% (target: 133.04%)")
    print(f"  Compounded: {final_profit['compounded_percent']:.2f}% (target: 248.90%)")
    print(f"{'='*80}")
    
    # Verify monthly breakdown
    month_trades = group_trades_by_month(all_trades)
    print("\nMonthly breakdown:")
    cumulative_compounded = 1.0
    for month in ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]:
        trades_in_month = month_trades.get(month, [])
        monthly_pnl = sum(t['PnLPercent'] for t in trades_in_month)
        for trade in trades_in_month:
            cumulative_compounded *= trade['PnL']
        target_monthly, target_cumulative, target_compounded = MONTHLY_TARGETS[month]
        print(f"  {month}: {len(trades_in_month)} trades, {monthly_pnl:.2f}% "
              f"(target: {target_monthly:.2f}%) | "
              f"Cumulative: {cumulative_compounded*100-100:.2f}% "
              f"(target: {target_cumulative:.2f}%)")
    
    # Write to CSV
    print(f"\nWriting to {output_file}...")
    with open(output_file, 'w', newline='') as f:
        writer = csv.writer(f, delimiter='\t')
        # Write header
        writer.writerow([
            'TradeNumber', 'TokenAddress', 'AlertTime', 'EntryTime', 'ExitTime',
            'PnL', 'PnLPercent', 'MaxReached', 'HoldDurationMinutes', 'IsWin'
        ])
        
        # Write trades
        for trade in all_trades:
            writer.writerow([
                trade['TradeNumber'],
                trade['TokenAddress'],
                trade['AlertTime'],
                trade['EntryTime'],
                trade['ExitTime'],
                trade['PnL'],
                trade['PnLPercent'],
                trade['MaxReached'],
                trade['HoldDurationMinutes'],
                trade['IsWin']
            ])
    
    print(f"Done! Wrote {len(all_trades)} trades to {output_file}")


if __name__ == "__main__":
    main()

