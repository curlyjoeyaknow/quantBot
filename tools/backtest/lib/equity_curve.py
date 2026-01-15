"""
Equity curve computation from trade events.

Computes equity curve with capital-aware position sizing.
"""

from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import json


@dataclass
class TradeEvent:
    """Single trade event."""
    timestamp_ms: int
    event_type: str  # 'entry', 'exit', 'partial_exit'
    price: float
    quantity: float
    value_usd: float
    fee_usd: float
    pnl_usd: float
    cumulative_pnl_usd: float
    position_size: float


@dataclass
class EquityPoint:
    """Single point on equity curve."""
    timestamp_ms: int
    capital: float
    pnl: float
    pnl_percent: float
    drawdown: float
    drawdown_percent: float
    position_count: int


def compute_equity_curve(
    trade_events: List[Dict[str, Any]],
    initial_capital: float = 10000.0,
    position_sizing_mode: str = 'fixed',  # 'fixed' or 'percent'
    position_size_value: float = 1000.0,  # USD or percent (0-1)
) -> Dict[str, Any]:
    """
    Compute equity curve from trade events.
    
    Args:
        trade_events: List of trade event dicts
        initial_capital: Starting capital in USD
        position_sizing_mode: 'fixed' (fixed USD) or 'percent' (% of equity)
        position_size_value: Position size (USD if fixed, 0-1 if percent)
    
    Returns:
        Dict with equity_curve, metrics, and drawdown_periods
    """
    if not trade_events:
        return {
            'equity_curve': [],
            'metrics': {
                'final_capital': initial_capital,
                'total_pnl': 0.0,
                'total_pnl_percent': 0.0,
                'max_drawdown': 0.0,
                'max_drawdown_percent': 0.0,
                'sharpe_ratio': 0.0,
                'total_trades': 0,
                'win_rate': 0.0,
            },
            'drawdown_periods': [],
        }
    
    # Sort events by timestamp
    sorted_events = sorted(trade_events, key=lambda e: e['timestamp_ms'])
    
    # Track state
    current_capital = initial_capital
    peak_capital = initial_capital
    equity_curve: List[EquityPoint] = []
    drawdown_periods: List[Dict[str, Any]] = []
    
    # Track drawdown period
    in_drawdown = False
    drawdown_start_ts = None
    drawdown_start_capital = None
    
    # Track trades
    trade_pnls: List[float] = []
    wins = 0
    losses = 0
    
    # Add initial point
    equity_curve.append(EquityPoint(
        timestamp_ms=sorted_events[0]['timestamp_ms'],
        capital=initial_capital,
        pnl=0.0,
        pnl_percent=0.0,
        drawdown=0.0,
        drawdown_percent=0.0,
        position_count=0,
    ))
    
    # Process events
    active_positions = 0
    
    for event in sorted_events:
        # Update capital based on PnL
        pnl = event.get('pnl_usd', 0.0)
        current_capital += pnl
        
        # Track trade outcomes
        if event['event_type'] == 'exit':
            trade_pnls.append(pnl)
            if pnl > 0:
                wins += 1
            else:
                losses += 1
            active_positions -= 1
        elif event['event_type'] == 'entry':
            active_positions += 1
        
        # Update peak
        if current_capital > peak_capital:
            peak_capital = current_capital
            
            # End drawdown period if we were in one
            if in_drawdown:
                drawdown_periods.append({
                    'start_ts': drawdown_start_ts,
                    'end_ts': event['timestamp_ms'],
                    'duration_ms': event['timestamp_ms'] - drawdown_start_ts,
                    'start_capital': drawdown_start_capital,
                    'trough_capital': current_capital,
                    'drawdown_pct': ((drawdown_start_capital - current_capital) / drawdown_start_capital) * 100,
                })
                in_drawdown = False
        
        # Calculate drawdown
        drawdown = peak_capital - current_capital
        drawdown_percent = (drawdown / peak_capital) * 100 if peak_capital > 0 else 0.0
        
        # Start drawdown period if needed
        if drawdown > 0 and not in_drawdown:
            in_drawdown = True
            drawdown_start_ts = event['timestamp_ms']
            drawdown_start_capital = peak_capital
        
        # Add equity point
        equity_curve.append(EquityPoint(
            timestamp_ms=event['timestamp_ms'],
            capital=current_capital,
            pnl=current_capital - initial_capital,
            pnl_percent=((current_capital - initial_capital) / initial_capital) * 100,
            drawdown=drawdown,
            drawdown_percent=drawdown_percent,
            position_count=active_positions,
        ))
    
    # Calculate metrics
    final_capital = current_capital
    total_pnl = final_capital - initial_capital
    total_pnl_percent = (total_pnl / initial_capital) * 100
    
    max_drawdown = max((point.drawdown for point in equity_curve), default=0.0)
    max_drawdown_percent = max((point.drawdown_percent for point in equity_curve), default=0.0)
    
    # Sharpe ratio (simplified - assumes daily returns)
    if len(trade_pnls) > 1:
        mean_return = sum(trade_pnls) / len(trade_pnls)
        std_return = (sum((r - mean_return) ** 2 for r in trade_pnls) / len(trade_pnls)) ** 0.5
        sharpe_ratio = (mean_return / std_return) * (252 ** 0.5) if std_return > 0 else 0.0
    else:
        sharpe_ratio = 0.0
    
    total_trades = wins + losses
    win_rate = (wins / total_trades) if total_trades > 0 else 0.0
    
    return {
        'equity_curve': [
            {
                'timestamp_ms': point.timestamp_ms,
                'capital': point.capital,
                'pnl': point.pnl,
                'pnl_percent': point.pnl_percent,
                'drawdown': point.drawdown,
                'drawdown_percent': point.drawdown_percent,
                'position_count': point.position_count,
            }
            for point in equity_curve
        ],
        'metrics': {
            'initial_capital': initial_capital,
            'final_capital': final_capital,
            'total_pnl': total_pnl,
            'total_pnl_percent': total_pnl_percent,
            'max_drawdown': max_drawdown,
            'max_drawdown_percent': max_drawdown_percent,
            'sharpe_ratio': sharpe_ratio,
            'total_trades': total_trades,
            'wins': wins,
            'losses': losses,
            'win_rate': win_rate,
        },
        'drawdown_periods': drawdown_periods,
    }


def main():
    """CLI entry point."""
    import sys
    import argparse
    
    parser = argparse.ArgumentParser(description='Compute equity curve from trade events')
    parser.add_argument('--events-json', required=True, help='JSON file with trade events')
    parser.add_argument('--initial-capital', type=float, default=10000.0, help='Initial capital')
    parser.add_argument('--position-sizing-mode', default='fixed', choices=['fixed', 'percent'])
    parser.add_argument('--position-size-value', type=float, default=1000.0)
    
    args = parser.parse_args()
    
    # Load events
    with open(args.events_json, 'r') as f:
        events = json.load(f)
    
    # Compute equity curve
    result = compute_equity_curve(
        events,
        initial_capital=args.initial_capital,
        position_sizing_mode=args.position_sizing_mode,
        position_size_value=args.position_size_value,
    )
    
    # Output JSON
    print(json.dumps(result))


if __name__ == '__main__':
    main()

