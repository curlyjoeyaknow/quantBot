# Simulation Engine

DuckDB-based simulation engine for backtesting trading strategies.

## Features

- **Immediate Entry**: Enter at alert time price
- **Profit Targets**: Multiple profit targets with partial exits
- **Stop Loss**: Fixed percentage stop loss
- **Trailing Stop**: Dynamic trailing stop with activation threshold
- **Metrics**: Return, drawdown, Sharpe ratio, win rate

## Usage

### Python API

```python
import duckdb
from simulation import DuckDBSimulator, StrategyConfig

# Connect to DuckDB
con = duckdb.connect('tele.duckdb')
simulator = DuckDBSimulator(con)

# Define strategy
strategy = StrategyConfig(
    strategy_id='my_strategy',
    name='My Strategy',
    entry_type='immediate',
    profit_targets=[
        {'target': 2.0, 'percent': 0.5},  # Exit 50% at 2x
        {'target': 3.0, 'percent': 0.5}  # Exit 50% at 3x
    ],
    stop_loss_pct=0.2,  # 20% stop loss
    trailing_stop_pct=0.1,  # 10% trailing stop
    trailing_activation_pct=0.2  # Activate after 20% gain
)

# Run simulation
result = simulator.run_simulation(
    strategy,
    mint='So11111111111111111111111111111111111111112',
    alert_timestamp=datetime(2024, 1, 1, 12, 0, 0),
    initial_capital=1000.0
)

print(f"Final capital: ${result['final_capital']:.2f}")
print(f"Return: {result['total_return_pct']:.2f}%")
```

### CLI

```bash
python3 tools/telegram/cli/simulate.py \
  --duckdb tele.duckdb \
  --strategy strategy.json \
  --mint So11111111111111111111111111111111111111112
```

## Strategy Configuration

```json
{
  "strategy_id": "test_strategy",
  "name": "Test Strategy",
  "entry_type": "immediate",
  "profit_targets": [
    {"target": 2.0, "percent": 0.5},
    {"target": 3.0, "percent": 0.5}
  ],
  "stop_loss_pct": 0.2,
  "trailing_stop_pct": 0.1,
  "trailing_activation_pct": 0.2,
  "maker_fee": 0.001,
  "taker_fee": 0.001,
  "slippage": 0.005
}
```

## Database Schema

Simulations are stored in:
- `simulation_strategies`: Strategy definitions
- `simulation_runs`: Simulation results
- `simulation_events`: Individual trade events

