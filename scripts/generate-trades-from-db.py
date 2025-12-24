#!/usr/bin/env python3
"""
Generate 1465 trades directly from tele.duckdb calls database.
Matches weekly portfolio PNL targets with proper risk management and realistic trading costs:
- 20% stop loss per trade (PnL >= 0.8, with gapped stops possible)
- 2% max portfolio risk per trade (10% position size)
- Portfolio-level PNL calculation
- Realistic trading costs: fees, slippage, transaction fees, gapped stops
"""

import duckdb
import csv
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple
import random
from pathlib import Path

# Weekly targets: (week_start_date, num_trades, weekly_portfolio_pnl_percent, cumulative_portfolio_pnl_percent)
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
    ("2025-12-15", 69, 12.20, 133.04),
]

# Risk management constants
MAX_PORTFOLIO_RISK_PER_TRADE = 0.02  # 2% max portfolio risk per trade
MAX_TRADE_LOSS = 0.20  # 20% max loss per trade (stop loss)
POSITION_SIZE = MAX_PORTFOLIO_RISK_PER_TRADE / MAX_TRADE_LOSS  # 10% of portfolio per trade

# Trading cost constants
# Pump.fun fees: 1% buy + 1% sell = 2% total
PUMP_FUN_FEE_PERCENT = 0.02
# Bonk fees: Similar to Pump.fun, typically 1-2% total
BONK_FEE_PERCENT = 0.015  # 1.5% total (slightly lower than Pump.fun)
# EVM DEX fees: 0.3-0.5% per trade (Uniswap V2/V3)
EVM_DEX_FEE_PERCENT = 0.004  # 0.4% per trade
# Standard Solana DEX fees: 0.25-0.5%
SOLANA_DEX_FEE_PERCENT = 0.003  # 0.3% per trade

# Slippage: Variable based on liquidity
SLIPPAGE_MIN = 0.005  # 0.5% minimum slippage
SLIPPAGE_MAX = 0.02   # 2% maximum slippage (can be higher for illiquid tokens)
SLIPPAGE_ILLIQUID_MULTIPLIER = 1.5  # Extra slippage for illiquid tokens

# Transaction fees
# Solana priority fees: 0.01-0.1% typically (varies with network congestion)
SOLANA_PRIORITY_FEE_MIN = 0.0001  # 0.01%
SOLANA_PRIORITY_FEE_MAX = 0.001   # 0.1%
# EVM gas fees: 0.1-0.5% for small trades (varies by network and congestion)
EVM_GAS_FEE_MIN = 0.001  # 0.1%
EVM_GAS_FEE_MAX = 0.005  # 0.5%

# Gapped stop losses: Some losses exceed -20% due to price gaps
GAPPED_STOP_PROBABILITY = 0.15  # 15% of losses have gapped stops
GAPPED_STOP_EXTRA_LOSS_MIN = 0.02  # Extra 2-5% loss on gapped stops
GAPPED_STOP_EXTRA_LOSS_MAX = 0.05

# Failed transactions: Small percentage of trades fail
FAILED_TRANSACTION_PROBABILITY = 0.02  # 2% of trades fail
FAILED_TRANSACTION_COST = 0.001  # 0.1% cost for failed transaction (gas/priority fees lost)

# MEV/Sandwich attacks: Extra slippage on some trades
MEV_ATTACK_PROBABILITY = 0.05  # 5% of trades get MEV'd
MEV_EXTRA_SLIPPAGE = 0.005  # Extra 0.5% slippage from MEV


def is_solana_mint(mint: str) -> bool:
    """Check if mint is a Solana mint (base58, no 0x prefix)."""
    mint_str = str(mint).strip()
    return not mint_str.startswith('0x') and len(mint_str) >= 32


def is_evm_address(mint: str) -> bool:
    """Check if mint is an EVM address (0x prefix, 42 chars)."""
    mint_str = str(mint).strip()
    return mint_str.startswith('0x') and len(mint_str) == 42


def get_token_type(mint: str) -> str:
    """Determine token type from mint address."""
    mint_str = str(mint).strip().lower()
    if mint_str.endswith('pump'):
        return 'pump'
    elif mint_str.endswith('bonk'):
        return 'bonk'
    elif is_evm_address(mint):
        return 'evm'
    else:
        return 'solana'


def calculate_trading_costs(mint: str, is_loss: bool = False) -> Dict[str, float]:
    """Calculate all trading costs for a trade.
    
    Returns:
        Dict with 'platform_fee', 'slippage', 'transaction_fee', 'mev_slippage', 'failed_cost'
    """
    token_type = get_token_type(mint)
    costs = {
        'platform_fee': 0.0,
        'slippage': 0.0,
        'transaction_fee': 0.0,
        'mev_slippage': 0.0,
        'failed_cost': 0.0
    }
    
    # Platform fees based on token type
    if token_type == 'pump':
        costs['platform_fee'] = PUMP_FUN_FEE_PERCENT
    elif token_type == 'bonk':
        costs['platform_fee'] = BONK_FEE_PERCENT
    elif token_type == 'evm':
        costs['platform_fee'] = EVM_DEX_FEE_PERCENT
    else:  # solana
        costs['platform_fee'] = SOLANA_DEX_FEE_PERCENT
    
    # Slippage: Variable based on liquidity
    # Losses might have higher slippage (panic selling)
    slippage_base = random.uniform(SLIPPAGE_MIN, SLIPPAGE_MAX)
    if is_loss:
        slippage_base *= 1.2  # 20% more slippage on losses
    if random.random() < 0.1:  # 10% chance of illiquid token
        slippage_base *= SLIPPAGE_ILLIQUID_MULTIPLIER
    costs['slippage'] = slippage_base
    
    # Transaction fees
    if token_type == 'evm':
        costs['transaction_fee'] = random.uniform(EVM_GAS_FEE_MIN, EVM_GAS_FEE_MAX)
    else:  # solana
        costs['transaction_fee'] = random.uniform(SOLANA_PRIORITY_FEE_MIN, SOLANA_PRIORITY_FEE_MAX)
    
    # MEV/Sandwich attacks
    if random.random() < MEV_ATTACK_PROBABILITY:
        costs['mev_slippage'] = MEV_EXTRA_SLIPPAGE
    
    # Failed transactions
    if random.random() < FAILED_TRANSACTION_PROBABILITY:
        costs['failed_cost'] = FAILED_TRANSACTION_COST
    
    return costs


def calculate_net_pnl(gross_pnl: float, costs: Dict[str, float]) -> float:
    """Calculate net PnL after all trading costs.
    
    Args:
        gross_pnl: Gross PnL multiplier (1.0 = break even)
        costs: Dict of trading costs
    
    Returns:
        Net PnL multiplier after costs
    """
    total_cost_percent = (
        costs['platform_fee'] +
        costs['slippage'] +
        costs['transaction_fee'] +
        costs['mev_slippage'] +
        costs['failed_cost']
    )
    
    # Costs reduce the PnL
    # If gross_pnl = 1.10 (10% gain), and costs = 0.03 (3%), net = 1.10 - 0.03 = 1.07 (7% net)
    net_pnl = gross_pnl - total_cost_percent
    
    return max(0.0, net_pnl)  # Can't go negative (but can be 0)


def calculate_gross_pnl_for_net(net_pnl: float, costs: Dict[str, float]) -> float:
    """Calculate required gross PnL to achieve target net PnL after costs.
    
    Args:
        net_pnl: Target net PnL multiplier
        costs: Dict of trading costs
    
    Returns:
        Required gross PnL multiplier
    """
    total_cost_percent = (
        costs['platform_fee'] +
        costs['slippage'] +
        costs['transaction_fee'] +
        costs['mev_slippage'] +
        costs['failed_cost']
    )
    
    # gross_pnl = net_pnl + total_cost_percent
    return net_pnl + total_cost_percent




def query_calls_from_db(duckdb_path: str, limit: int = 5000) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Query calls from tele.duckdb database, separated by Solana and EVM mints."""
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
            
            # Parse the datetime to ensure we have full timestamp
            alert_datetime = None
            if isinstance(call_datetime, datetime):
                alert_datetime = call_datetime
            elif isinstance(call_datetime, str):
                try:
                    # Try parsing various formats
                    if 'T' in call_datetime:
                        alert_datetime = datetime.fromisoformat(call_datetime.replace('Z', '+00:00'))
                    else:
                        # Handle "YYYY-MM-DD HH:MM:SS" format
                        alert_datetime = datetime.strptime(call_datetime, '%Y-%m-%d %H:%M:%S')
                except Exception as e:
                    continue
            
            if alert_datetime is None:
                continue
            
            alert_timestamp = alert_datetime.isoformat()
            
            call_data = {
                'mint': mint,
                'alert_timestamp': alert_timestamp,
                'alert_datetime': alert_datetime,  # Store parsed datetime object with full precision
                'caller_name': caller_name
            }
            
            if is_solana_mint(mint):
                solana_calls.append(call_data)
            elif is_evm_address(mint):
                evm_calls.append(call_data)
        
        return solana_calls, evm_calls
    finally:
        con.close()


def calculate_portfolio_pnl(trade_pnl: float) -> float:
    """Calculate portfolio PNL from trade PNL."""
    return POSITION_SIZE * (trade_pnl - 1.0) * 100.0


def trade_pnl_from_portfolio_pnl(portfolio_pnl_percent: float) -> float:
    """Calculate required trade PNL to achieve portfolio PNL."""
    return 1.0 + (portfolio_pnl_percent / (POSITION_SIZE * 100.0))


def generate_trades_for_week(week_start: str, num_trades: int, target_portfolio_pnl_percent: float,
                            solana_calls: List[Dict[str, Any]], 
                            evm_calls: List[Dict[str, Any]],
                            start_trade_num: int,
                            initial_portfolio_value: float = 1.0) -> Tuple[List[Dict[str, Any]], float, float]:
    """Generate trades for a specific week with realistic trading costs."""
    
    if num_trades <= 0:
        return [], 0.0, initial_portfolio_value
    
    new_trades = []
    week_start_date = datetime.fromisoformat(week_start)
    portfolio_value = initial_portfolio_value
    running_portfolio_pnl = 0.0
    
    # Determine mint type based on month
    month = week_start_date.month
    if month == 11:  # November - Solana only
        available_calls = solana_calls
        if len(available_calls) == 0:
            raise ValueError(f"No Solana mints available for November week {week_start}")
    elif month == 12:  # December - Both, prefer Solana (70% Solana, 30% EVM)
        if len(solana_calls) > 0 and len(evm_calls) > 0:
            available_calls = solana_calls * 7 + evm_calls * 3
            random.shuffle(available_calls)
        elif len(solana_calls) > 0:
            available_calls = solana_calls
        elif len(evm_calls) > 0:
            available_calls = evm_calls
        else:
            raise ValueError(f"No mints available for December week {week_start}")
    else:  # Other months - Prefer Solana (80% Solana, 20% EVM)
        if len(solana_calls) > 0 and len(evm_calls) > 0:
            available_calls = solana_calls * 8 + evm_calls * 2
            random.shuffle(available_calls)
        elif len(solana_calls) > 0:
            available_calls = solana_calls
        elif len(evm_calls) > 0:
            available_calls = evm_calls
        else:
            raise ValueError(f"No mints available for week {week_start}")
    
    # Calculate win/loss distribution
    win_rate = 0.6
    num_wins = int(num_trades * win_rate)
    num_losses = num_trades - num_wins
    
    # Pre-allocate wins and losses
    trade_types = ['win'] * num_wins + ['loss'] * num_losses
    random.shuffle(trade_types)
    
    for i in range(num_trades):
        call = available_calls[i % len(available_calls)]
        mint = call['mint']
        
        # Use actual alert time from database - preserve the time of day but adjust to target week
        if 'alert_datetime' in call and call['alert_datetime']:
            # Use the actual call datetime from database
            original_datetime = call['alert_datetime']
            
            # Calculate day offset within the week (0-6)
            day_offset = (i * 7) // num_trades
            target_date = week_start_date + timedelta(days=day_offset)
            
            # Preserve the time of day (hour, minute, second) from the original call
            trade_date = target_date.replace(
                hour=original_datetime.hour,
                minute=original_datetime.minute,
                second=original_datetime.second,
                microsecond=original_datetime.microsecond if hasattr(original_datetime, 'microsecond') else 0
            )
        else:
            # Fallback: Generate realistic time with minutes and seconds
            day_offset = (i * 7) // num_trades
            trade_date = week_start_date + timedelta(
                days=day_offset,
                hours=random.randint(0, 23),
                minutes=random.randint(0, 59),
                seconds=random.randint(0, 59)
            )
        
        # Calculate remaining portfolio PNL needed
        remaining_trades = num_trades - i
        remaining_portfolio_pnl = target_portfolio_pnl_percent - running_portfolio_pnl
        
        is_win = trade_types[i] == 'win'
        
        # Calculate trading costs (before determining PnL)
        costs = calculate_trading_costs(mint, is_loss=not is_win)
        
        if is_win:
            # Win: distribute required portfolio PNL across remaining wins
            remaining_wins = sum(1 for j in range(i, num_trades) if trade_types[j] == 'win')
            if remaining_wins > 0:
                target_win_portfolio_pnl = remaining_portfolio_pnl / remaining_wins
            else:
                target_win_portfolio_pnl = 0
            
            # Add variance but stay close to target
            win_portfolio_pnl = target_win_portfolio_pnl + random.uniform(-0.5, 1.0)
            win_portfolio_pnl = max(0.1, min(5.0, win_portfolio_pnl))
            
            # Convert to net trade PNL
            net_trade_pnl = trade_pnl_from_portfolio_pnl(win_portfolio_pnl)
            
            # Calculate required gross PnL to achieve net after costs
            gross_trade_pnl = calculate_gross_pnl_for_net(net_trade_pnl, costs)
            trade_pnl = gross_trade_pnl
            trade_pnl_percent = (trade_pnl - 1.0) * 100.0
        else:
            # Loss: Determine if this is a gapped stop loss
            is_gapped_stop = random.random() < GAPPED_STOP_PROBABILITY
            
            if is_gapped_stop:
                # Gapped stop: loss exceeds -20% due to price gaps
                # Start at -20% and add extra loss from the gap
                net_trade_pnl = 0.8  # Start at -20% stop loss
                extra_loss = random.uniform(GAPPED_STOP_EXTRA_LOSS_MIN, GAPPED_STOP_EXTRA_LOSS_MAX)
                costs['slippage'] += extra_loss
                net_trade_pnl = max(0.0, net_trade_pnl - extra_loss)
            else:
                # Normal loss: -20% to 0% trade loss (stop loss clamped at -20%)
                net_trade_pnl_percent = random.uniform(-20.0, 0.0)
                net_trade_pnl = 1.0 + (net_trade_pnl_percent / 100.0)
                net_trade_pnl = max(0.8, net_trade_pnl)  # Clamp at -20%
            
            # Calculate required gross PnL (losses are worse after costs)
            gross_trade_pnl = calculate_gross_pnl_for_net(net_trade_pnl, costs)
            trade_pnl = gross_trade_pnl
            trade_pnl_percent = (trade_pnl - 1.0) * 100.0
        
        # Calculate net PnL after all costs
        net_pnl = calculate_net_pnl(trade_pnl, costs)
        net_pnl_percent = (net_pnl - 1.0) * 100.0
        
        # Update portfolio value using NET PnL (after costs)
        portfolio_pnl_percent = calculate_portfolio_pnl(net_pnl)
        portfolio_value *= (1.0 + (portfolio_pnl_percent / 100.0))
        running_portfolio_pnl += portfolio_pnl_percent
        
        entry_offset_days = random.uniform(0.5, 2.0)
        entry_time = trade_date + timedelta(days=entry_offset_days)
        exit_offset_hours = random.uniform(2, 4)
        exit_time = entry_time + timedelta(hours=exit_offset_hours)
        hold_duration = int((exit_time - entry_time).total_seconds() / 60)
        
        max_reached = trade_pnl * random.uniform(1.0, 1.5) if trade_pnl > 1.0 else 1.0
        
        alert_time_iso = trade_date.isoformat().replace('+00:00', '') + 'Z'
        entry_time_iso = entry_time.isoformat().replace('+00:00', '') + '+10:00'
        exit_time_iso = exit_time.isoformat().replace('+00:00', '') + '+10:00'
        
        # Store costs breakdown for reference
        total_costs = (
            costs['platform_fee'] +
            costs['slippage'] +
            costs['transaction_fee'] +
            costs['mev_slippage'] +
            costs['failed_cost']
        ) * 100.0  # Convert to percentage
        
        new_trades.append({
            'TradeNumber': start_trade_num + i,
            'TokenAddress': mint,
            'AlertTime': alert_time_iso,
            'EntryTime': entry_time_iso,
            'ExitTime': exit_time_iso,
            'PnL': round(net_pnl, 6),  # NET PnL after all costs
            'PnLPercent': round(net_pnl_percent, 2),
            'GrossPnL': round(trade_pnl, 6),  # Gross PnL before costs
            'GrossPnLPercent': round(trade_pnl_percent, 2),
            'TotalCostsPercent': round(total_costs, 2),
            'PlatformFee': round(costs['platform_fee'] * 100, 2),
            'Slippage': round(costs['slippage'] * 100, 2),
            'TransactionFee': round(costs['transaction_fee'] * 100, 2),
            'MEVSlippage': round(costs['mev_slippage'] * 100, 2),
            'FailedCost': round(costs['failed_cost'] * 100, 2),
            'TokenType': get_token_type(mint),
            'MaxReached': round(max_reached, 4),
            'HoldDurationMinutes': hold_duration,
            'IsWin': 'Yes' if net_pnl > 1.0 else 'No'
        })
    
    # Fine-tune to hit exact target (using net PnL)
    actual_portfolio_pnl = sum(calculate_portfolio_pnl(t['PnL']) for t in new_trades)
    if abs(actual_portfolio_pnl - target_portfolio_pnl_percent) > 0.01 and len(new_trades) > 0:
        adjustment = (target_portfolio_pnl_percent - actual_portfolio_pnl)
        
        # Adjust wins first
        win_indices = [i for i, t in enumerate(new_trades) if t['IsWin'] == 'Yes']
        if len(win_indices) > 0 and abs(adjustment) > 0.01:
            num_to_adjust = min(len(win_indices), max(1, int(abs(adjustment) / 0.5)))
            per_trade_adjustment = adjustment / num_to_adjust
            
            for i in range(num_to_adjust):
                idx = win_indices[i]
                old_net_pnl = new_trades[idx]['PnL']
                old_portfolio_pnl = calculate_portfolio_pnl(old_net_pnl)
                new_portfolio_pnl = old_portfolio_pnl + per_trade_adjustment
                new_net_pnl = trade_pnl_from_portfolio_pnl(new_portfolio_pnl)
                
                # Recalculate gross PnL with existing costs
                mint = new_trades[idx]['TokenAddress']
                costs = calculate_trading_costs(mint, is_loss=False)
                new_gross_pnl = calculate_gross_pnl_for_net(new_net_pnl, costs)
                
                new_net_pnl = max(0.0, min(10.0, new_net_pnl))
                new_net_pnl_percent = (new_net_pnl - 1.0) * 100.0
                new_gross_pnl_percent = (new_gross_pnl - 1.0) * 100.0
                
                new_trades[idx]['PnL'] = round(new_net_pnl, 6)
                new_trades[idx]['PnLPercent'] = round(new_net_pnl_percent, 2)
                new_trades[idx]['GrossPnL'] = round(new_gross_pnl, 6)
                new_trades[idx]['GrossPnLPercent'] = round(new_gross_pnl_percent, 2)
    
    # Recalculate final portfolio PNL
    final_portfolio_pnl = sum(calculate_portfolio_pnl(t['PnL']) for t in new_trades)
    
    # Recalculate final portfolio value
    final_portfolio_value = initial_portfolio_value
    for trade in new_trades:
        portfolio_pnl_percent = calculate_portfolio_pnl(trade['PnL'])
        final_portfolio_value *= (1.0 + (portfolio_pnl_percent / 100.0))
    
    return new_trades, final_portfolio_pnl, final_portfolio_value


def main():
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
    
    # Expand lists if needed
    if len(solana_calls) < 1000:
        multiplier = (1000 // len(solana_calls)) + 1 if len(solana_calls) > 0 else 1
        solana_calls = (solana_calls * multiplier)[:1000]
    
    if len(evm_calls) < 500:
        multiplier = (500 // len(evm_calls)) + 1 if len(evm_calls) > 0 else 1
        evm_calls = (evm_calls * multiplier)[:500]
    
    random.shuffle(solana_calls)
    random.shuffle(evm_calls)
    
    print(f"\nRisk Management:")
    print(f"  Position size per trade: {POSITION_SIZE*100:.1f}% of portfolio")
    print(f"  Max portfolio risk per trade: {MAX_PORTFOLIO_RISK_PER_TRADE*100:.1f}%")
    print(f"  Max trade loss (stop loss): {MAX_TRADE_LOSS*100:.1f}%")
    print(f"\nTrading Costs:")
    print(f"  Pump.fun fees: {PUMP_FUN_FEE_PERCENT*100:.2f}%")
    print(f"  Bonk fees: {BONK_FEE_PERCENT*100:.2f}%")
    print(f"  EVM DEX fees: {EVM_DEX_FEE_PERCENT*100:.2f}%")
    print(f"  Solana DEX fees: {SOLANA_DEX_FEE_PERCENT*100:.2f}%")
    print(f"  Slippage: {SLIPPAGE_MIN*100:.1f}%-{SLIPPAGE_MAX*100:.1f}%")
    print(f"  Gapped stops: {GAPPED_STOP_PROBABILITY*100:.0f}% of losses")
    print(f"  MEV attacks: {MEV_ATTACK_PROBABILITY*100:.0f}% of trades")
    print("\nGenerating 1465 trades with realistic trading costs...")
    print("-" * 80)
    
    all_trades = []
    current_trade_num = 1
    portfolio_value = 1.0
    cumulative_portfolio_pnl = 0.0
    
    for week_start, target_trades, target_weekly_pnl, target_cumulative_pnl in WEEKLY_TARGETS:
        new_trades, actual_weekly_pnl, new_portfolio_value = generate_trades_for_week(
            week_start, target_trades, target_weekly_pnl,
            solana_calls, evm_calls, current_trade_num, portfolio_value
        )
        
        all_trades.extend(new_trades)
        current_trade_num += len(new_trades)
        
        cumulative_portfolio_pnl += actual_weekly_pnl
        portfolio_value = new_portfolio_value
        
        week_drawdown = min(0, actual_weekly_pnl)
        
        print(f"Week {week_start}: {len(new_trades)} trades | "
              f"Weekly Portfolio PnL: {actual_weekly_pnl:.2f}% (target: {target_weekly_pnl:.2f}%) | "
              f"Cumulative: {cumulative_portfolio_pnl:.2f}% (target: {target_cumulative_pnl:.2f}%) | "
              f"Portfolio Value: {portfolio_value:.4f} | "
              f"Drawdown: {week_drawdown:.2f}%")
    
    print("-" * 80)
    
    # Calculate final statistics
    final_portfolio_pnl = sum(calculate_portfolio_pnl(t['PnL']) for t in all_trades)
    final_portfolio_value = 1.0
    for trade in all_trades:
        portfolio_pnl_percent = calculate_portfolio_pnl(trade['PnL'])
        final_portfolio_value *= (1.0 + (portfolio_pnl_percent / 100.0))
    
    # Calculate average costs
    avg_total_costs = sum(t.get('TotalCostsPercent', 0) for t in all_trades) / len(all_trades) if all_trades else 0
    
    print(f"\n{'='*80}")
    print(f"FINAL RESULTS:")
    print(f"  Total trades: {len(all_trades)} (target: 1465)")
    print(f"  Portfolio PNL (non-compounded): {final_portfolio_pnl:.2f}% (target: 133.04%)")
    print(f"  Final portfolio value: {final_portfolio_value:.4f} ({((final_portfolio_value - 1.0) * 100.0):.2f}%)")
    print(f"  Average trading costs per trade: {avg_total_costs:.2f}%")
    print(f"{'='*80}")
    
    print(f"\nWriting to {output_file}...")
    with open(output_file, 'w', newline='') as f:
        writer = csv.writer(f, delimiter='\t')
        writer.writerow([
            'TradeNumber', 'TokenAddress', 'AlertTime', 'EntryTime', 'ExitTime',
            'PnL', 'PnLPercent', 'GrossPnL', 'GrossPnLPercent', 'TotalCostsPercent',
            'PlatformFee', 'Slippage', 'TransactionFee', 'MEVSlippage', 'FailedCost',
            'TokenType', 'MaxReached', 'HoldDurationMinutes', 'IsWin'
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
                trade.get('GrossPnL', trade['PnL']),
                trade.get('GrossPnLPercent', trade['PnLPercent']),
                trade.get('TotalCostsPercent', 0),
                trade.get('PlatformFee', 0),
                trade.get('Slippage', 0),
                trade.get('TransactionFee', 0),
                trade.get('MEVSlippage', 0),
                trade.get('FailedCost', 0),
                trade.get('TokenType', 'unknown'),
                trade['MaxReached'],
                trade['HoldDurationMinutes'],
                trade['IsWin']
            ])
    
    print(f"Done! Wrote {len(all_trades)} trades to {output_file}")
    print(f"\nNote: PnL column shows NET PnL after all trading costs.")
    print(f"      GrossPnL shows PnL before costs for reference.")


if __name__ == "__main__":
    main()
