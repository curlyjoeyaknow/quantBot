# Backtest Filters and Strategy Features Guide

## Overview

The QuantBot backtest system has two types of backtests:

1. **Baseline Backtest** (`run_baseline_all.py`) - Pure path metrics (no strategies)
2. **Strategy Backtests** (`run_strategy.py`, `run_tp_sl.py`) - Apply trading strategies

## Filters in Baseline Backtest

### ✅ Available Filters (Now Implemented!)

The baseline backtest now supports:
- Date range (`--from`, `--to`)
- Chain (`--chain`)
- **Caller filter** (`--caller`) - Filter by caller name (case-insensitive)
- **Market cap filter** (`--mcap-min`, `--mcap-max`) - Filter by market cap range (USD)

### Usage Examples

**Filter by caller:**
```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --caller "Gidion" \
  --store-duckdb
```

**Filter by market cap:**
```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --mcap-min 10000 \
  --mcap-max 100000 \
  --store-duckdb
```

**Combine filters:**
```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --caller "Gidion" \
  --mcap-min 10000 \
  --mcap-max 100000 \
  --store-duckdb
```

## Strategy Backtests (with Filters and Features)

For backtests with strategies (delayed entry, trailing stops, ladder exits, etc.), use:

### 1. TP/SL Strategy Backtest (`run_tp_sl.py`)

**Basic usage:**
```bash
python3 tools/backtest/run_tp_sl.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --tp-mult 2.0 \
  --sl-mult 0.7
```

**With filters:**
```bash
python3 tools/backtest/run_tp_sl.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --caller "caller_name" \
  --mcap-min 10000 \
  --mcap-max 100000 \
  --tp-mult 2.0 \
  --sl-mult 0.7
```

### 2. Extended Strategy Backtest (`run_strategy.py`)

Uses `lib/extended_exits.py` with full feature support:

**Delayed Entry:**
```bash
python3 tools/backtest/run_strategy.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --entry-mode wait_dip \
  --dip-percent -10 \
  --max-wait-candles 60 \
  --tp-mult 2.0 \
  --sl-mult 0.7
```

**Trailing Stop:**
```bash
python3 tools/backtest/run_strategy.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --tp-mult 5.0 \
  --trail-activation-pct 30 \
  --trail-distance-pct 15 \
  --time-stop-hours 24
```

**Ladder Exits (Tiered Stop Loss):**
```bash
python3 tools/backtest/run_strategy.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --tiered-sl \
  --tier-1-2x-sl 0.95 \
  --tier-1-5x-sl 1.10 \
  --tier-2x-sl 1.40 \
  --tier-3x-sl 2.00 \
  --tier-5x-sl 3.00
```

**Break-even Move:**
```bash
python3 tools/backtest/run_strategy.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --tp-mult 2.0 \
  --sl-mult 0.7 \
  --breakeven-trigger-pct 20 \
  --breakeven-offset-pct 0
```

**Combined Features:**
```bash
python3 tools/backtest/run_strategy.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --caller "caller_name" \
  --mcap-min 10000 \
  --mcap-max 100000 \
  --entry-mode wait_dip \
  --dip-percent -10 \
  --tp-mult 3.0 \
  --trail-activation-pct 30 \
  --trail-distance-pct 15 \
  --tiered-sl \
  --tier-2x-sl 1.40 \
  --tier-3x-sl 2.00 \
  --time-stop-hours 24
```

## Available Entry Modes

From `lib/extended_exits.py`:

- `immediate` - Enter at alert price (default)
- `wait_dip` - Wait for X% pullback before entering
- `wait_confirm` - Wait for N green candles
- `limit_better` - Enter at better price (limit order)

## Available Exit Features

### Basic TP/SL
- `--tp-mult` - Take profit multiplier (e.g., 2.0 = 2x)
- `--sl-mult` - Stop loss multiplier (e.g., 0.7 = -30%)

### Time Stop
- `--time-stop-hours` - Exit after X hours if TP/SL not hit

### Trailing Stop
- `--trail-activation-pct` - Activate trailing after +X% gain
- `--trail-distance-pct` - Trail X% from high

### Break-even Move
- `--breakeven-trigger-pct` - Move SL to entry after +X% gain
- `--breakeven-offset-pct` - Offset from entry (0 = exact entry)

### Ladder Exits (Tiered Stop Loss)
- `--tiered-sl` - Enable tiered stop loss
- `--tier-1-2x-sl` - SL after hitting 1.2x
- `--tier-1-5x-sl` - SL after hitting 1.5x
- `--tier-2x-sl` - SL after hitting 2x
- `--tier-3x-sl` - SL after hitting 3x
- `--tier-4x-sl` - SL after hitting 4x
- `--tier-5x-sl` - SL after hitting 5x

### Re-entry

Re-entry is currently experimental. To enable:

1. Use `lib/trade_simulator.py` directly
2. Or modify `run_strategy.py` to add re-entry logic

Example re-entry logic:
```python
# After TP hit, re-enter if price pulls back by X%
if exit_reason == "tp" and price_pullback_pct >= reentry_threshold:
    # Re-enter trade
    reentry_result = simulate_trade(...)
```

## Filter Options

### Caller Filter
```bash
--caller "caller_name"  # Exact match (case-insensitive)
```

### Market Cap Filter
```bash
--mcap-min 10000   # Minimum market cap (USD)
--mcap-max 100000  # Maximum market cap (USD)
```

### Multiple Callers
```bash
# Use caller groups (see lib/caller_groups.py)
--caller-group top_10
```

## Example: Complete Workflow

### Step 1: Baseline with Filters
```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --caller "caller_name" \
  --mcap-min 10000 \
  --mcap-max 100000 \
  --store-duckdb \
  --run-name "baseline_filtered"
```

### Step 2: Strategy Backtest with Same Filters
```bash
python3 tools/backtest/run_strategy.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --caller "caller_name" \
  --mcap-min 10000 \
  --mcap-max 100000 \
  --entry-mode wait_dip \
  --dip-percent -10 \
  --tp-mult 3.0 \
  --trail-activation-pct 30 \
  --trail-distance-pct 15 \
  --tiered-sl \
  --tier-2x-sl 1.40 \
  --store-duckdb \
  --run-name "strategy_filtered"
```

### Step 3: Compare Results
```bash
python3 tools/backtest/report_server.py --duckdb data/alerts.duckdb
# Open http://localhost:8080/
# Compare baseline vs strategy runs
```

## Implementation Notes

### Adding Filters to Baseline

The baseline backtest is designed for **pure path metrics** (no strategies). To add filters:

1. Modify `load_alerts()` to accept filter parameters
2. Add SQL WHERE clauses for filters
3. Add CLI arguments
4. Pass filters to `load_alerts()`

### Strategy Features

Strategy features are already implemented in:
- `lib/entry_strategies.py` - Entry logic
- `lib/stop_strategies.py` - Stop logic  
- `lib/extended_exits.py` - Extended exit types
- `lib/trade_simulator.py` - Complete trade simulation

Use `run_strategy.py` or `run_tp_sl.py` to access these features.

## Next Steps

1. **Add filters to baseline**: Modify `load_alerts()` function
2. **Use strategy scripts**: For delayed entry, trailing stops, etc.
3. **Compare results**: Use report server to compare baseline vs strategies

