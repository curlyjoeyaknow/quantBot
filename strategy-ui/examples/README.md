# Example Strategies and Filters

This directory contains example strategy configurations you can use as templates.

## Strategies

### `example_strategy.json`
Simple take-profit strategy with:
- Immediate entry (no signal)
- Two profit targets (50% @ 10%, 50% @ 20%)
- 5% stop loss
- Close price fills

### `example_strategy_rsi.json`
RSI-based entry strategy:
- Entry when RSI(14) < 30 (oversold)
- Single profit target (100% @ 15%)
- 10% stop loss
- Close price fills

### `example_strategy_ema_cross.json`
EMA crossover strategy with trailing stop:
- Entry on bullish EMA(9) cross above EMA(21)
- 1 candle delay after signal
- Two profit targets (50% @ 10%, 50% @ 20%)
- Trailing stop (5% trail, activates at 10% profit)
- Break-even stop after first target
- Open price fills

## Filters

### `example_filter.json`
Simple filter with token list (currently just WSOL as example).

## Usage

### Via Web UI

1. Copy the JSON from an example file
2. Go to http://localhost:8000/strategies/new
3. Paste into the Strategy JSON textarea
4. Enter a name
5. Save

### Via Python Script

```python
import duckdb
import json
from pathlib import Path

conn = duckdb.connect("data/app.duckdb")

# Load and insert strategy
with open("examples/example_strategy.json") as f:
    strategy_data = json.load(f)

strategy_id = "example_strat_1"
conn.execute(
    "INSERT OR REPLACE INTO strategies VALUES (?, ?, ?, now())",
    [strategy_id, strategy_data["name"], json.dumps(strategy_data)]
)

# Load and insert filter
with open("examples/example_filter.json") as f:
    filter_data = json.load(f)

filter_id = "example_filter_1"
conn.execute(
    "INSERT OR REPLACE INTO filters VALUES (?, ?, ?, now())",
    [filter_id, filter_data["name"], json.dumps(filter_data)]
)

print(f"Strategy ID: {strategy_id}")
print(f"Filter ID: {filter_id}")
```

### Via API

```bash
# Create strategy
curl -X POST http://localhost:8000/api/strategies \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "name=Example Strategy" \
  -d "json_str=$(cat examples/example_strategy.json | jq -c)"
```

## Strategy Fields Explained

### Entry
- `mode`: `"immediate"` or `"signal"`
- `signal`: Signal config (if mode is "signal")
  - `type`: `"rsi_below"` or `"ema_cross"`
  - For RSI: `period`, `value`
  - For EMA: `fast`, `slow`, `direction` ("bull" or "bear")
- `delay`: Entry delay config
  - `mode`: `"none"` or `"candles"`
  - `n`: Number of candles to wait (if mode is "candles")

### Exits
- `targets`: Array of profit targets
  - `size_pct`: Percentage of position to exit (0-100)
  - `profit_pct`: Profit percentage target
- `trailing`: Trailing stop config
  - `enabled`: true/false
  - `trail_pct`: Trailing percentage
  - `activate_profit_pct`: Profit % to activate trailing
- `time_exit`: Time-based exit
  - `enabled`: true/false
  - `max_candles_in_trade`: Maximum candles to hold

### Stops
- `stop_loss_pct`: Hard stop loss percentage
- `break_even_after_first_target`: Move stop to break-even after first target

### Execution
- `fill_model`: `"open"` or `"close"` (which price to use for fills)
- `fee_bps`: Fee in basis points (25 = 0.25%)
- `slippage_bps`: Slippage in basis points (10 = 0.1%)

See `app/services/simulator_spec.md` for full specification.

