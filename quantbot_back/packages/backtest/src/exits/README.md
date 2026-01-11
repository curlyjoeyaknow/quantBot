# Exit Plan System

A comprehensive exit management system for backtesting that supports:

- **Ladder exits**: Progressive profit-taking at multiple price levels
- **Trailing stops**: Dynamic stop-loss that follows price movement
- **Indicator-based exits**: Technical analysis signals (Ichimoku, EMA crosses, RSI, volume spikes)
- **Time-based exits**: Maximum hold duration limits

## Architecture

### Core Components

1. **`exit-plan.ts`**: Type definitions for all exit strategies
2. **`simulate-exit-plan.ts`**: Main simulation engine (single loop over candles)
3. **`indicator-eval.ts`**: Indicator signal evaluation
4. **`fills-to-trade.ts`**: Converts exit fills to trade PnL metrics
5. **`default-exit-plans.ts`**: Pre-configured exit strategies

### Indicator Utilities

Located in `../indicators/series.ts`:

- EMA (Exponential Moving Average)
- RSI (Relative Strength Index)
- Ichimoku Tenkan/Kijun lines
- Volume Z-score (for spike detection)
- Cross detection helpers

## Usage Example

```typescript
import { simulateExitPlan } from './simulate-exit-plan.js';
import { fillsToNetReturnPct } from './fills-to-trade.js';
import { defaultPumpLadderTrail } from './default-exit-plans.js';

// Simulate exit plan
const result = simulateExitPlan({
  candles: sortedCandles,
  entryTsMs: entryTimestamp * 1000,
  entryPx: entryPrice,
  plan: defaultPumpLadderTrail,
  taker_fee_bps: 30, // 0.3%
  slippage_bps: 50,  // 0.5%
});

// Convert fills to PnL
const pnl = fillsToNetReturnPct({
  positionUsd: 1000,
  entryPx: entryPrice,
  fills: result.fills,
});

console.log(`Net return: ${pnl.netReturnPct.toFixed(2)}%`);
console.log(`Exit reason: ${result.exitReason}`);
```

## Integration with Existing Engine

The exit plan system is designed to work alongside your existing `backtestCall()` function. You can:

1. Replace the overlay simulation with exit plan simulation
2. Use fills to compute multi-part exits
3. Maintain compatibility with existing `Trade` shape by aggregating fills to VWAP

### Example Integration

```typescript
// In engine/index.ts
import { simulateExitPlan } from '../exits/simulate-exit-plan.js';
import { fillsToNetReturnPct } from '../exits/fills-to-trade.js';

// Instead of runOverlaySimulation:
const exitResult = simulateExitPlan({
  candles: executionSlice,
  entryTsMs: entryPoint.tsMs,
  entryPx: entryPoint.px,
  plan: strategy.exitPlan, // Add to StrategyV1
  taker_fee_bps: strategy.fees.takerFeeBps,
  slippage_bps: strategy.fees.slippageBps,
});

const pnl = fillsToNetReturnPct({
  positionUsd: strategy.position.notionalUsd,
  entryPx: entryPoint.px,
  fills: exitResult.fills,
});

// Create Trade with aggregated exit
const trade: Trade = {
  // ... existing fields
  exit: {
    tsMs: exitResult.exitTsMs,
    px: exitResult.exitPxVwap,
    reason: exitResult.exitReason,
  },
  pnl: {
    grossReturnPct: pnl.grossReturnPct,
    netReturnPct: pnl.netReturnPct,
    feesUsd: (pnl.grossReturnPct - pnl.netReturnPct) / 100 * strategy.position.notionalUsd,
    slippageUsd: 0, // Already included in fills
  },
};
```

## Features

### Ladder Exits

- Multiple profit targets (multiples or percentages)
- Fraction-based position sizing per level
- Automatically sorted by price level

### Trailing Stops

- Configurable trailing distance (basis points)
- Activation thresholds (multiple or percentage)
- Hard stop-loss option
- Intrabar policy for stop vs. TP priority

### Indicator Exits

- **Ichimoku crosses**: Tenkan/Kijun bearish/bullish crossovers
- **EMA crosses**: Fast/slow moving average crossovers
- **RSI levels**: Cross above/below threshold
- **Volume spikes**: Z-score based anomaly detection
- ANY/ALL mode for rule combination

### Intrabar Policies

- `STOP_FIRST`: Conservative - stops trigger before profits in same candle
- `TP_FIRST`: Optimistic - profits trigger before stops
- `HIGH_THEN_LOW`: Check high-based rules first, then low-based
- `LOW_THEN_HIGH`: Check low-based rules first, then high-based

## Design Notes

- **Single loop**: One pass over candles for performance
- **Friction modeling**: Fees and slippage applied per fill
- **Position tracking**: Remaining fraction tracked through fills
- **Idempotent**: No side effects, deterministic results
- **Backtest-friendly**: Pure functions, no I/O, no randomness
