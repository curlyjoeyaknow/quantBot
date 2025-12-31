# Strategy Builder Wizard

## Overview

The Strategy Builder Wizard is a web-based UI for creating trading strategies through a guided 5-step process. It produces valid strategy JSON that can be used with the pure simulator engine.

## Quick Start

**Step 1: Navigate to strategy-ui directory**

```bash
cd /home/memez/quantBot/strategy-ui
# or from repo root:
cd strategy-ui
```

**Step 2: Install dependencies (if not already done)**

```bash
pip install -r requirements.txt
```

**Step 3: Start the server**

```bash
./run.sh
# or
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Step 4: Open the wizard in your browser**

Navigate to: **http://localhost:8000/strategies/wizard**

## Wizard Steps

### Step 1: Entry Signal

Choose how the strategy enters positions:

- **Immediate** - Enter immediately when simulation starts
- **Signal-based** - Wait for a technical indicator signal
  - **RSI Below** - Enter when RSI falls below threshold
    - Period (default: 14)
    - Threshold (default: 30)
  - **EMA Cross** - Enter on EMA crossover
    - Fast period (default: 12)
    - Slow period (default: 26)
    - Direction (bullish/bearish)

**Entry Delay** (optional):
- None - Enter immediately when signal triggers
- Wait N Candles - Delay entry by N candles after signal

### Step 2: Risk Management

Configure stop loss and risk controls:

- **Stop Loss (%)** - Hard stop loss percentage (required)
  - Example: 12 = -12% stop loss
- **Break-even after first target** (optional)
  - Move stop to entry price after first profit target is hit

### Step 3: Profit Taking

Configure how the strategy exits profitable positions:

**Targets**:
- Add one or more profit targets
- Each target specifies:
  - **Size (%)** - Percentage of position to exit (0-100)
  - **Profit (%)** - Profit percentage to trigger exit
- Target sizes must sum to ≤ 100%

**Trailing Stop** (optional):
- Enable trailing stop
- **Trail (%)** - Trailing stop distance
- **Activate at Profit (%)** - Minimum profit before trailing activates

### Step 4: Time Constraints

Optional time-based exit:

- **Exit after N candles** - Force exit if position held too long
- **Max Candles in Trade** - Maximum holding period

### Step 5: Execution

Configure execution parameters:

- **Fill Model** - How fills are calculated
  - `open` - Fill at candle open price
  - `close` - Fill at candle close price (default)
- **Fee (bps)** - Trading fee in basis points (default: 10)
- **Slippage (bps)** - Slippage in basis points (default: 30)

## Strategy Summary

The wizard displays a plain-English summary of the strategy as you build it:

```
Entry: RSI(14) < 30, then wait 3 candles.
Stop: -12%. Break-even after first target.
Take profit: 25% at +10%, 25% at +20%.
Trail: 6% after +12%.
Fill: close. Fees 10 bps, slippage 30 bps.
```

## JSON Preview

Toggle "Show Advanced (JSON)" to see the generated strategy JSON:

```json
{
  "entry": {
    "mode": "signal",
    "signal": {
      "type": "rsi_below",
      "period": 14,
      "value": 30
    },
    "delay": {
      "mode": "candles",
      "n": 3
    }
  },
  "exits": {
    "targets": [
      { "size_pct": 25, "profit_pct": 10 },
      { "size_pct": 25, "profit_pct": 20 }
    ],
    "trailing": {
      "enabled": true,
      "trail_pct": 6,
      "activate_profit_pct": 12
    }
  },
  "stops": {
    "stop_loss_pct": 12,
    "break_even_after_first_target": true
  },
  "execution": {
    "fill_model": "close",
    "fee_bps": 10,
    "slippage_bps": 30
  }
}
```

## Validation

The wizard performs live validation:

- Target sizes must sum to ≤ 100%
- Stop loss must be ≥ 0%
- At least one exit mechanism required (targets, trailing, time exit, or stop loss)
- All numeric fields must be valid numbers

Validation errors are displayed in real-time.

## Saving Strategies

Click "Save Strategy" to persist the strategy:

1. Strategy JSON is validated
2. Strategy is saved to the database
3. Redirects to strategies list

## Advanced Edit

When "Show Advanced (JSON)" is enabled, you can:

- View the generated JSON
- Manually edit the JSON (for power users)
- Copy/paste strategy configurations

**Note**: Manual JSON edits are not validated by the wizard UI. Invalid JSON will be caught when saving.

## Integration

Strategies created with the wizard can be used with:

- Pure simulator engine (`simulateToken()`)
- Simulation workflows (`runSimulation()`)
- CLI commands (`quantbot simulation run-duckdb`)

## Future Enhancements

Phase 2 (planned):
- Block-based advanced mode (drag-and-drop)
- Strategy templates/presets
- Parameter sweeps
- Multiple entry conditions

