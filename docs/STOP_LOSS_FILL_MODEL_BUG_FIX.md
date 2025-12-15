# Stop Loss Fill Model Bug Fix

## Issue
The `finalPrice` field in simulation results was incorrectly set to the last candle's close price, regardless of how the position was actually exited (stop loss, target hit, or signal exit).

## Root Cause
In `packages/simulation/src/engine.ts`, the `finalPrice` variable was initialized once at the beginning:

```typescript
const finalPrice = candles[candles.length - 1].close;
```

This value was never updated when exits occurred, leading to incorrect `finalPrice` values in the simulation results.

## Impact
- **Stop Loss Exits**: `finalPrice` showed the last candle close (0.65) instead of the stop loss price (0.7)
- **Target Exits**: `finalPrice` showed the last candle close instead of the target price
- **Signal Exits**: `finalPrice` showed the last candle close instead of the signal exit price
- **PnL Calculations**: Were correct (used actual exit prices), but `finalPrice` reporting was wrong

## Fix
Changed `finalPrice` from a constant to a mutable variable and updated it at each exit point:

1. **Stop Loss Exit** (line ~590):
   ```typescript
   finalPrice = stopLoss; // Update finalPrice to stop loss price
   ```

2. **Target Hit** (line ~620):
   ```typescript
   finalPrice = targetPrice; // Update finalPrice to last target hit
   ```

3. **Signal Exit** (line ~650):
   ```typescript
   finalPrice = candle.close; // Update finalPrice to signal exit price
   ```

4. **Final Exit** (line ~670):
   - Already uses `finalPrice` (last candle close) - correct for positions held to the end

## Testing
Added golden fixture test case "Immediate Stop Loss" that verifies:
- Stop loss triggers when `candle.low <= stopLossPrice`
- `finalPrice` equals the stop loss price (0.7), not the candle low (0.65)
- PnL calculations are correct with fees applied

## Fill Model Clarification
The simulation uses an **optimistic fill model** for stop losses:
- **Trigger**: When `candle.low <= stopLossPrice`
- **Fill Price**: At the `stopLossPrice`, not at the actual low
- **Rationale**: Assumes limit order fills at the stop price, not market order slippage to the low

This is consistent with target fills (fill at target price when high >= target).

## Files Changed
- `packages/simulation/src/engine.ts` - Fixed `finalPrice` tracking
- `packages/simulation/tests/fixtures/golden-candles.ts` - Added `immediateStopLoss` test case
- `packages/simulation/tests/golden-fixtures.test.ts` - Added test for immediate stop loss

## Result
All 10 golden fixture tests now pass, verifying correct behavior for:
- Monotonic up/down price movements
- Whipsaw (oscillating prices)
- Gappy timestamps
- Perfect target hits
- Ladder targets (multiple exits)
- Single candle edge case
- Immediate stop loss trigger
- Deterministic results

