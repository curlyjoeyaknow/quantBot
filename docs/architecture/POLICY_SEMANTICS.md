# Policy Execution Semantics

This document defines the precise semantics of risk policy execution in the backtesting system.

## Overview

Policies are executed by iterating through a candle stream chronologically, checking trigger conditions at each candle. Entry occurs at the first candle at or after the alert timestamp, using the candle's close price as the entry price.

## Entry Semantics

### Entry Point Resolution

1. **Entry timestamp**: Alert timestamp (`alertTsMs`) in milliseconds
2. **Entry candle**: First candle where `candle.timestamp * 1000 >= alertTsMs`
3. **Entry price**: `entryCandle.close` (closing price of entry candle)
4. **Entry index**: Index of entry candle in the candle array

### Edge Cases

- **No entry candle found**: If all candles are before the alert timestamp, returns `createNoEntryResult()` with zero return
- **Invalid entry price**: If entry price is not finite or <= 0, returns `createNoEntryResult()`
- **Empty candle array**: Returns `createNoEntryResult()`

## Policy Types

### Fixed Stop Policy

**Activation**: Always active from entry

**Stop Loss**:
- Trigger: `candle.low <= entryPx * (1 - stopPct)`
- Exit price: Stop price (`entryPx * (1 - stopPct)`)
- Exit reason: `'stop_loss'`

**Take Profit** (optional):
- Trigger: `candle.high >= entryPx * (1 + takeProfitPct)`
- Exit price: Take profit price (`entryPx * (1 + takeProfitPct)`)
- Exit reason: `'take_profit'`

**Precedence**: Stop loss and take profit are checked independently. If both trigger in the same candle, the first check wins (stop loss checked first).

**Example**:
```typescript
{
  kind: 'fixed_stop',
  stopPct: 0.20,        // 20% stop loss
  takeProfitPct: 1.0   // 100% take profit
}
```

### Time Stop Policy

**Activation**: Always active from entry

**Time Stop**:
- Trigger: `candle.timestamp * 1000 >= entryTsMs + maxHoldMs`
- Exit price: Close price of the candle where time limit is reached
- Exit reason: `'time_stop'`

**Take Profit** (optional):
- Trigger: `candle.high >= entryPx * (1 + takeProfitPct)`
- Exit price: Take profit price
- Exit reason: `'take_profit'`

**Precedence**: Take profit checked first, then time stop. If both trigger in the same candle, take profit wins.

**Example**:
```typescript
{
  kind: 'time_stop',
  maxHoldMs: 3600000,  // 1 hour
  takeProfitPct: 0.5   // 50% take profit
}
```

### Trailing Stop Policy

**Activation**: Trailing stop activates only after price reaches activation threshold

**Activation Threshold**:
- Activation price: `entryPx * (1 + activationPct)`
- Trailing activates when: `candle.high >= activationPrice`
- Once activated, trailing stop remains active for the remainder of the trade

**Trailing Stop**:
- Trail peak: Highest high price since activation
- Trail stop price: `trailPeak * (1 - trailPct)`
- Trigger: `candle.low <= trailStopPrice`
- Exit price: Trail stop price
- Exit reason: `'trailing_stop'`

**Hard Stop** (optional):
- Always active (independent of trailing activation)
- Trigger: `candle.low <= entryPx * (1 - hardStopPct)`
- Exit price: Hard stop price
- Exit reason: `'hard_stop'`

**Precedence**: Hard stop checked first (always active), then trailing stop (if activated).

**Example**:
```typescript
{
  kind: 'trailing_stop',
  activationPct: 0.20,  // Activate after 20% gain
  trailPct: 0.10,       // Trail 10% from peak
  hardStopPct: 0.15     // Hard stop at 15% loss (always active)
}
```

**Behavior**:
- Before activation: Only hard stop (if configured) is active
- After activation: Both hard stop and trailing stop are active
- Trail peak updates only when `candle.high > trailPeak`
- Trail stop price recalculates after each peak update

### Ladder Policy

**Activation**: Always active from entry

**Ladder Levels**:
- Levels are sorted by `multiple` (ascending)
- Each level triggers when: `candle.high >= entryPx * level.multiple`
- Partial exit: `fraction` of remaining position exits at trigger
- Levels are checked sequentially; once a level triggers, it cannot trigger again

**Stop Loss** (optional):
- Only applies to remaining position after ladder exits
- Trigger: `candle.low <= entryPx * (1 - stopPct)` AND `remainingPosition > 0`
- Exit price: Stop price
- Exit reason: `'stop_loss'`

**Position Tracking**:
- Initial position: 1.0 (100%)
- After each ladder exit: `remainingPosition -= exitFraction`
- If `remainingPosition <= 0`: All position exited, trade complete

**Final Exit**:
- If position remains at end of data: Close at last candle's close price
- Exit reason: `'end_of_data'` or `'ladder_complete'` (if all levels hit)

**Example**:
```typescript
{
  kind: 'ladder',
  levels: [
    { multiple: 2.0, fraction: 0.5 },  // Exit 50% at 2x
    { multiple: 3.0, fraction: 0.3 },   // Exit 30% at 3x
    { multiple: 4.0, fraction: 0.2 }    // Exit 20% at 4x
  ],
  stopPct: 0.20  // Stop loss on remaining position
}
```

**Behavior**:
- If price reaches 2x: Exit 50% (remaining: 50%)
- If price reaches 3x: Exit 30% of original (15% of remaining), total exited: 65%
- If price reaches 4x: Exit 20% of original (remaining: 15%)
- Stop loss applies only to remaining position

### Combo Policy

**Activation**: All sub-policies execute independently

**Execution**:
- Each sub-policy executes against the same candle stream
- First sub-policy to trigger an exit wins
- Exit reason includes which sub-policy triggered

**Precedence**: Sub-policies are evaluated in order. The first to trigger exits the trade.

**Example**:
```typescript
{
  kind: 'combo',
  policies: [
    { kind: 'fixed_stop', stopPct: 0.20 },
    { kind: 'time_stop', maxHoldMs: 3600000 }
  ]
}
```

**Behavior**:
- Both policies execute simultaneously
- If stop loss triggers before time stop: Exit with stop loss
- If time stop triggers before stop loss: Exit with time stop

## Common Behaviors

### Peak Tracking

All policies track the peak high price (`peakHigh`) from entry:
- Updated when: `candle.high > peakHigh`
- Used for tail capture calculation: `tailCapture = realizedReturn / peakReturn`

### Max Adverse Excursion (MAE)

All policies track maximum adverse excursion:
- Calculated as: `(candle.low / entryPx - 1) * 10000` (basis points)
- Updated when: `lowReturn < maxAdverseExcursionBps`
- Represents worst drawdown during the trade

### Exit Price Selection

Exit price depends on exit reason:
- **Stop loss**: Stop price (not candle low)
- **Take profit**: Take profit price (not candle high)
- **Trailing stop**: Trail stop price (not candle low)
- **Hard stop**: Hard stop price (not candle low)
- **Time stop**: Close price of exit candle
- **End of data**: Close price of last candle
- **Ladder**: Level price (not candle high) for ladder exits, close price for final exit

### Fee Application

Fees are applied after calculating gross return:
- Entry fee: `takerFeeBps` (basis points)
- Exit fee: `takerFeeBps` (basis points)
- Slippage: `slippageBps` (basis points) per trade
- Net return: `grossReturnBps - (takerFeeBps * 2) - slippageBps`

### Tail Capture

Tail capture measures how much of the peak return was captured:
- Peak return: `(peakHigh / entryPx - 1) * 10000` (basis points)
- Tail capture: `realizedReturn / peakReturn` (0-1, capped at 1.0)
- Null if peak return <= 0 (no gain)

## Edge Cases

### No Valid Entry

**Condition**: No candle found at or after alert timestamp

**Result**: `createNoEntryResult()` with:
- `realizedReturnBps: 0`
- `stopOut: false`
- `exitReason: 'no_entry'`
- `timeExposedMs: 0`

### Policy Triggers on Entry Candle

**Condition**: Stop loss or take profit triggers on the same candle as entry

**Behavior**: Policy checks occur after entry is established. If entry candle's low/high triggers a stop/take profit, exit occurs on the same candle.

**Example**: Entry at $100, stop at $80, entry candle low is $75 → Exit immediately at $80.

### Multiple Triggers in Same Candle

**Precedence Rules**:
1. Hard stop (if configured) > Trailing stop > Take profit > Time stop
2. Stop loss > Take profit (for fixed stop)
3. Stop loss > Ladder levels (for ladder policy)
4. First sub-policy to trigger (for combo policy)

### End of Data

**Condition**: No exit trigger occurs before end of candle stream

**Behavior**: Exit at last candle's close price

**Exit reason**: `'end_of_data'` (or `'ladder_complete'` if all ladder levels hit)

### Price Gaps

**Behavior**: Policies use candle OHLC values, not interpolated prices. If price gaps (e.g., candle low jumps from $100 to $50), stop loss triggers at the stop price, not necessarily at the gap.

**Example**: Entry at $100, stop at $80, next candle opens at $50 → Stop triggers at $80 (not $50).

## Performance Characteristics

- **Time complexity**: O(n) where n = number of candles
- **Space complexity**: O(1) (constant space for tracking state)
- **Deterministic**: Same inputs always produce same outputs

## Testing

All policy types have comprehensive test coverage in `packages/backtest/tests/unit/policies/policy-executor.test.ts` covering:
- Normal execution paths
- Edge cases (no entry, triggers on first candle, end of data)
- Precedence rules
- Fee calculation
- Tail capture calculation

