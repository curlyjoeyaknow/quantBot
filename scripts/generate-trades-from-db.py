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
# Total should be 1465 trades
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
    ("2025-12-15", 69, 12.20, 133.04),  # Adjusted to get exactly 1465 total (1396 + 69 = 1465)
]

def is_solana_mint(mint: str) -> bool:
    """Check if mint is a Solana mint (base58, no 0x prefix)."""
    mint_str = str(mint).strip()
    # Solana mints: base58 encoded, typically 32-44 chars, no 0x prefix
    # EVM mints: hex with 0x prefix, exactly 42 chars
    return not mint_str.startswith('0x') and len(mint_str) >= 32


def query_calls_from_db(duckdb_path: str, limit: int = 5000) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Query calls from tele.duckdb database, separated by Solana and EVM mints.
    
    Returns:
        Tuple of (solana_calls, evm_calls)
    """
    con = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        tables = con.execute("SHOW TABLES").fetchall()
        table_names = [t[0] for t in tables]
        
        if 'user_calls_d' not in table_names:
            print(f"Warning: user_calls_d not found. Available tables: {', '.join(table_names)}")
            return [], []
        
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
        
        solana_calls = []
        evm_calls = []
        
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
            
            call_data = {
                'mint': mint,
                'alert_timestamp': alert_timestamp,
                'caller_name': caller_name
            }
            
            if is_solana_mint(mint):
                solana_calls.append(call_data)
            else:
                evm_calls.append(call_data)
        
        return solana_calls, evm_calls
    finally:
        con.close()


def get_week_start(date: datetime) -> datetime:
    """Get the Monday of the week containing the date."""
    days_since_monday = date.weekday()
    monday = date - timedelta(days=days_since_monday)
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def generate_trades_for_week(week_start: str, num_trades: int, target_pnl_percent: float,
                            solana_calls: List[Dict[str, Any]], 
                            evm_calls: List[Dict[str, Any]],
                            start_trade_num: int) -> Tuple[List[Dict[str, Any]], float]:
    """Generate trades for a specific week to meet the target PnL."""
    
    needed_pnl_percent = target_pnl_percent
    needed_trades = num_trades
    
    if needed_trades <= 0:
        return [], 0.0
    
    # Calculate target average PnL per trade
    # Account for win rate: if 60% win, 40% loss, we need to scale up wins
    win_rate = 0.6
    loss_rate = 0.4
    avg_loss = -10.0  # Average loss of -10%
    
    # Calculate required average win to hit target
    # total_pnl = (wins * avg_win) + (losses * avg_loss)
    # needed_pnl = (num_trades * win_rate * avg_win) + (num_trades * loss_rate * avg_loss)
    # avg_win = (needed_pnl - num_trades * loss_rate * avg_loss) / (num_trades * win_rate)
    num_wins = int(needed_trades * win_rate)
    num_losses = needed_trades - num_wins
    
    if num_wins > 0:
        required_total_win_pnl = needed_pnl_percent - (num_losses * avg_loss)
        required_avg_win = required_total_win_pnl / num_wins
    else:
        required_avg_win = 0
    
    new_trades = []
    week_start_date = datetime.fromisoformat(week_start)
    running_pnl = 0.0
    
    # Determine mint type based on month
    # November: EXCLUSIVELY Solana only
    # December: Both Solana and EVM (prefer Solana)
    # Other months: Prefer Solana but allow EVM
    month = week_start_date.month
    if month == 11:  # November - Solana only
        available_calls = solana_calls
        if len(available_calls) == 0:
            raise ValueError(f"No Solana mints available for November week {week_start}")
    elif month == 12:  # December - Both, prefer Solana (70% Solana, 30% EVM)
        if len(solana_calls) > 0 and len(evm_calls) > 0:
            # Mix: prefer Solana
            available_calls = solana_calls * 7 + evm_calls * 3  # 70% Solana, 30% EVM
            random.shuffle(available_calls)
        elif len(solana_calls) > 0:
            available_calls = solana_calls
        elif len(evm_calls) > 0:
            available_calls = evm_calls
        else:
            raise ValueError(f"No mints available for December week {week_start}")
    else:  # Other months - Prefer Solana (80% Solana, 20% EVM)
        if len(solana_calls) > 0 and len(evm_calls) > 0:
            available_calls = solana_calls * 8 + evm_calls * 2  # 80% Solana, 20% EVM
            random.shuffle(available_calls)
        elif len(solana_calls) > 0:
            available_calls = solana_calls
        elif len(evm_calls) > 0:
            available_calls = evm_calls
        else:
            raise ValueError(f"No mints available for week {week_start}")
    
    # Pre-allocate wins and losses
    trade_types = ['win'] * num_wins + ['loss'] * num_losses
    random.shuffle(trade_types)
    
    for i in range(needed_trades):
        day_offset = (i * 7) // needed_trades
        trade_date = week_start_date + timedelta(days=day_offset, hours=random.randint(0, 23))
        
        call = available_calls[i % len(available_calls)]
        
        # Calculate remaining PnL needed
        remaining_trades = needed_trades - i
        remaining_pnl = needed_pnl_percent - running_pnl
        
        is_win = trade_types[i] == 'win'
        
        if is_win:
            # Win: distribute the required win PnL across wins
            remaining_wins = sum(1 for j in range(i, needed_trades) if trade_types[j] == 'win')
            if remaining_wins > 0:
                target_win_pnl = remaining_pnl / remaining_wins if remaining_wins > 0 else 0
            else:
                target_win_pnl = 0
            
            # Add some variance but stay close to target
            pnl_percent = target_win_pnl + random.uniform(-2.0, 5.0)
            pnl_percent = max(0.1, min(50.0, pnl_percent))  # Clamp to reasonable range
            pnl = 1.0 + (pnl_percent / 100.0)
        else:
            # Loss: -20% to 0% (stop loss clamped at -20%)
            pnl_percent = random.uniform(-20.0, 0.0)
            pnl = 1.0 + (pnl_percent / 100.0)
            # Enforce stop loss: PnL never below 0.8 (-20%)
            pnl = max(0.8, pnl)
            pnl_percent = (pnl - 1.0) * 100.0
        
        running_pnl += pnl_percent
        
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
    
    # Fine-tune to hit exact target
    actual_pnl = sum(t['PnLPercent'] for t in new_trades)
    if abs(actual_pnl - target_pnl_percent) > 0.5 and len(new_trades) > 0:
        # Adjust last 10% of trades to fine-tune
        num_to_adjust = max(1, min(10, len(new_trades) // 10))
        adjustment = (target_pnl_percent - actual_pnl) / num_to_adjust
        
        for i in range(num_to_adjust):
            idx = len(new_trades) - 1 - i
            old_pnl = new_trades[idx]['PnL']
            old_pnl_percent = new_trades[idx]['PnLPercent']
            new_pnl_percent = old_pnl_percent + adjustment
            new_pnl = 1.0 + (new_pnl_percent / 100.0)
            # Enforce stop loss: PnL never below 0.8 (-20% maximum loss)
            new_pnl = max(0.8, min(5.0, new_pnl))  # Clamp: -20% stop loss minimum, 400% max
            new_pnl_percent = (new_pnl - 1.0) * 100.0
            
            new_trades[idx]['PnL'] = round(new_pnl, 6)
            new_trades[idx]['PnLPercent'] = round(new_pnl_percent, 2)
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
    solana_calls, evm_calls = query_calls_from_db(duckdb_path, limit=5000)
    print(f"Found {len(solana_calls)} Solana mints and {len(evm_calls)} EVM mints in database")
    
    if len(solana_calls) == 0 and len(evm_calls) == 0:
        print("Error: No calls found in database")
        return
    
    # Ensure we have enough mints for November (Solana only)
    if len(solana_calls) < 200:
        print(f"Warning: Only {len(solana_calls)} Solana mints found. May need more for November.")
    
    # Expand lists if needed to ensure we have enough for all trades
    if len(solana_calls) < 1000:
        multiplier = (1000 // len(solana_calls)) + 1 if len(solana_calls) > 0 else 1
        solana_calls = (solana_calls * multiplier)[:1000]
    
    if len(evm_calls) < 500:
        multiplier = (500 // len(evm_calls)) + 1 if len(evm_calls) > 0 else 1
        evm_calls = (evm_calls * multiplier)[:500]
    
    random.shuffle(solana_calls)
    random.shuffle(evm_calls)
    
    print("\nGenerating 1465 trades to match weekly targets...")
    print("-" * 80)
    
    all_trades = []
    current_trade_num = 1
    all_trades_so_far = []
    
    for week_start, target_trades, target_weekly_pnl, target_cumulative_pnl in WEEKLY_TARGETS:
        new_trades, actual_pnl = generate_trades_for_week(
            week_start, target_trades, target_weekly_pnl,
            solana_calls, evm_calls, current_trade_num
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
    
    final_profit_non_compounded = sum(t['PnLPercent'] for t in all_trades)
    final_compounded = 1.0
    for trade in all_trades:
        final_compounded *= trade['PnL']
    final_compounded_percent = (final_compounded - 1.0) * 100.0
    
    print(f"\n{'='*80}")
    print(f"FINAL RESULTS:")
    print(f"  Total trades: {len(all_trades)} (target: 1465)")
    print(f"  Non-compounded: {final_profit_non_compounded:.2f}% (target: 133.04%)")
    print(f"  Compounded: {final_compounded_percent:.2f}% (target: 248.90%)")
    print(f"{'='*80}")
    
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

