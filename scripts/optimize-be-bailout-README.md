# Break-Even Bailout Optimization

This script generates exit plan configurations for optimizing the Break-Even Bailout Rule (V1.1) with **fixed TP/SL bands** while optimizing other parameters.

## Parameters

### Fixed TP/SL Bands (Explored)

The optimization workflow uses **fixed TP/SL bands** that are explored while optimizing other parameters:

- **TP multiples**: 5.2x, 5.45x, 5.7x (default band)
- **SL values**: 2000 bps (20%), 2500 bps (25%), 3000 bps (30%) (default band)

**Total TP/SL combinations**: 3 × 3 = 9

For each TP/SL pair, all other parameters are optimized.

### Optimized Parameters (Per TP/SL Pair)

- **be_armed_dd_pct**: {10%, 15%, 20%, 25%, 30%} (5 values)
- **max_hold_ms**: {30min, 60min, 120min, 240min, 48h (full horizon), none} (6 values)
- **Ladder configs**: 4 variants per TP
  - No ladder (full exit at TP)
  - 50% at TP, 50% hold
  - 30% at TP, 70% hold
  - 25% at TP, 25% at 6x, 50% hold

**Total configurations**: 9 TP/SL pairs × 5 BE DD% × 6 max hold × 4 ladder = **1,080 configurations**

### Customizing TP/SL Bands

Edit `scripts/optimize-be-bailout.ts` to change the bands:

```typescript
// Fixed TP/SL bands (explore these combinations while optimizing other parameters)
const TP_MULTIPLES = [5.2, 5.45, 5.7]; // Customize TP band
const SL_BPS_VALUES = [2000, 2500, 3000]; // Customize SL band
```

## Break-Even Bailout Rule Logic

For each trade:

1. **Track max drawdown from entry**
   - `dd_max = min(dd_max, (price - entry_price) / entry_price)`
   - Updated on every candle using the low price

2. **Arm break-even protection**
   - When `dd_max <= -be_armed_dd_pct`, mark trade as BE-armed
   - Once armed, stays armed for the remainder of the trade

3. **Exit at break-even once armed**
   - If BE-armed and price returns to entry_price (crosses from below), exit at entry_price
   - Realized PnL = 0 (minus fees/slippage if modeled)

4. **Otherwise**
   - Trade exits normally via:
     - TP rule (ladder levels)
     - SL rule (hard stop at 25%)
     - Max hold time (if configured)

## Usage

### 1. Generate Configurations

```bash
pnpm exec tsx scripts/optimize-be-bailout.ts
```

This generates `optimize-be-bailout-configs.json` with exit plan configurations (default: 900).

The output includes:
- `fixedBands`: The TP/SL bands being explored
- `configs`: All configurations, each with a unique `configId` that includes TP/SL values

### 2. Run Optimization

Use the generated configs with your backtest runner. Each config should be tested against your call dataset.

Example integration:

```typescript
import { readFileSync } from 'fs';
import { simulateExitPlan } from '@quantbot/backtest/src/exits/simulate-exit-plan.js';
import type { ExitPlan } from '@quantbot/backtest/src/exits/exit-plan.js';

const configs = JSON.parse(readFileSync('optimize-be-bailout-configs.json', 'utf-8'));

for (const config of configs.configs) {
  const exitPlan = config.exitPlan as ExitPlan;
  
  // Run backtest for each call
  for (const call of calls) {
    const result = simulateExitPlan({
      candles: callCandles,
      entryTsMs: call.createdAt,
      entryPx: entryPrice,
      plan: exitPlan,
      taker_fee_bps: 30,
      slippage_bps: 10,
    });
    
    // Accumulate results
    // ...
  }
  
  // Calculate total R (final capital)
  // Rank by total R
}
```

### 3. Objective

**Maximize final capital over the run** (total R).

Rank configurations by:
- Total realized return across all trades
- Final capital after all trades

## Key Properties

- **No re-entry logic**: Each trade is independent
- **No structure detection**: Pure price-based rules
- **One extra boolean flag**: `beArmed` state
- **One extra parameter**: `be_armed_dd_pct`
- **Fully path-aware**: Tracks drawdown through entire trade path
- **Compatible with tail strategies**: Doesn't interfere with TP/SL logic

## Output Format

The generated JSON contains:

```json
{
  "fixedBands": {
    "tpMultiples": [5.2, 5.45, 5.7],
    "slBpsValues": [2000, 2500, 3000],
    "note": "Each TP/SL combination is tested with all other parameter combinations"
  },
  "configs": [
    {
      "configId": "tp_5p2x_sl_25pct_be_10pct_hold_30min_ladder_none",
      "tpMultiple": 5.2,
      "slBps": 2500,
      "exitPlan": {
        "trailing": { ... },
        "break_even_bailout": { ... },
        "max_hold_ms": 1800000,
        "ladder": { ... }
      }
    }
  ]
}
```

## Next Steps

1. Integrate with your backtest runner
2. Run all configurations (default: 900) against your call dataset
3. Rank by total R (final capital)
4. Analyze top performers to understand:
   - Which TP/SL bands perform best
   - Optimal `be_armed_dd_pct` threshold per TP/SL band
   - Impact of time-based exits per TP/SL band
   - Impact of partial exit strategies per TP/SL band
   - Interaction between BE bailout and other rules
5. Iterate on parameter space if needed (adjust TP/SL bands or other parameters)

