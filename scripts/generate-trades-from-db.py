#!/usr/bin/env python3
"""
Generate 1465 trades directly from tele.duckdb calls database.
Matches weekly and monthly profit targets.
"""

import duckdb
import csv
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple
import random
from pathlib import Path

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

def query_calls_from_db(duckdb_path: str, limit: int = 2000) -> List[Dict[str, Any]]:
    """Query calls from tele.duckdb database."""
    con = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        tables = con.execute("SHOW TABLES").fetchall()
        table_names = [t[0] for t in tables]
        
        if 'user_calls_d' not in table_names:
            print(f"Warning: user_calls_d not found. Available tables: {', '.join(table_names)}")
            return []
        
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


def get_week_start(date: datetime) -> datetime:
    """Get the Monday of the week containing the date."""
    days_since_monday = date.weekday()
    monday = date - timedelta(days=days_since_monday)
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def generate_trades_for_week(week_start: str, num_trades: int, target_pnl_percent: float,
                            calls: List[Dict[str, Any]], 
                            start_trade_num: int) -> Tuple[List[Dict[str, Any]], float]:
    """Generate trades for a specific week to meet the target PnL."""
    
    needed_pnl_percent = target_pnl_percent
    needed_trades = num_trades
    
    if needed_trades <= 0:
        return [], 0.0
    
    avg_pnl_per_trade = needed_pnl_percent / needed_trades if needed_trades > 0 else 0
    
    new_trades = []
    week_start_date = datetime.fromisoformat(week_start)
    
    for i in range(needed_trades):
        day_offset = (i * 7) // needed_trades
        trade_date = week_start_date + timedelta(days=day_offset, hours=random.randint(0, 23))
        
        call = calls[i % len(calls)]
        
        if random.random() < 0.6:  # Win
            base_pnl = 1.0 + (avg_pnl_per_trade / 100.0) * 1.5
            pnl = max(1.0, min(3.0, base_pnl + random.uniform(-0.05, 0.3)))
        else:  # Loss
            pnl = random.uniform(0.8, 1.0)
        
        pnl_percent = (pnl - 1.0) * 100.0
        
        entry_offset_days = random.uniform(0.5, 2.0)
        entry_time = trade_date + timedelta(days=entry_offset_days)
        exit_offset_hours = random.uniform(2, 4)
        exit_time = entry_time + timedelta(hours=exit_offset_hours)
        hold_duration = int((exit_time - entry_time).total_seconds() / 60)
        
        max_reached = pnl * random.uniform(1.0, 1.5) if pnl > 1.0 else 1.0
        
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
    
    actual_pnl = sum(t['PnLPercent'] for t in new_trades)
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
    
    final_pnl = sum(t['PnLPercent'] for t in new_trades)
    return new_trades, final_pnl


def main():
    # Get project root (parent of scripts directory)
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    duckdb_path = str(project_root / "data" / "tele.duckdb")
    output_file = str(script_dir / "trades_1465.csv")
    
    print(f"Querying calls from {duckdb_path}...")
    calls = query_calls_from_db(duckdb_path, limit=2000)
    print(f"Found {len(calls)} calls in database")
    
    if len(calls) == 0:
        print("Error: No calls found in database")
        return
    
    random.shuffle(calls)
    if len(calls) < 2000:
        multiplier = (2000 // len(calls)) + 1
        calls = (calls * multiplier)[:2000]
    
    print("\nGenerating 1465 trades to match weekly targets...")
    print("-" * 80)
    
    all_trades = []
    current_trade_num = 1
    all_trades_so_far = []
    
    for week_start, target_trades, target_weekly_pnl, target_cumulative_pnl in WEEKLY_TARGETS:
        new_trades, actual_pnl = generate_trades_for_week(
            week_start, target_trades, target_weekly_pnl,
            calls, current_trade_num
        )
        
        all_trades.extend(new_trades)
        current_trade_num += len(new_trades)
        
        all_trades_so_far.extend(new_trades)
        cumulative_pnl_percent = sum(t['PnLPercent'] for t in all_trades_so_far)
        
        cumulative_compounded = 1.0
        for trade in all_trades_so_far:
            cumulative_compounded *= trade['PnL']
        cumulative_compounded_percent = (cumulative_compounded - 1.0) * 100.0
        
        print(f"Week {week_start}: {len(new_trades)} trades | "
              f"Weekly PnL: {actual_pnl:.2f}% (target: {target_weekly_pnl:.2f}%) | "
              f"Cumulative: {cumulative_pnl_percent:.2f}% (target: {target_cumulative_pnl:.2f}%) | "
              f"Compounded: {cumulative_compounded_percent:.2f}%")
    
    print("-" * 80)
    
    final_profit_non_compounded = sum(t['PnLPercent'] for t in all_trades) / 100.0
    final_compounded = 1.0
    for trade in all_trades:
        final_compounded *= trade['PnL']
    final_compounded_percent = (final_compounded - 1.0) * 100.0
    
    print(f"\nFINAL RESULTS:")
    print(f"  Total trades: {len(all_trades)} (target: 1465)")
    print(f"  Non-compounded: {final_profit_non_compounded*100:.2f}% (target: 133.04%)")
    print(f"  Compounded: {final_compounded_percent:.2f}% (target: 248.90%)")
    
    print(f"\nWriting to {output_file}...")
    with open(output_file, 'w', newline='') as f:
        writer = csv.writer(f, delimiter='\t')
        writer.writerow([
            'TradeNumber', 'TokenAddress', 'AlertTime', 'EntryTime', 'ExitTime',
            'PnL', 'PnLPercent', 'MaxReached', 'HoldDurationMinutes', 'IsWin'
        ])
        
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

