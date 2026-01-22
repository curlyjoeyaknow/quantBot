# Edge Cases and Boundary Conditions

This document catalogs edge cases and boundary conditions in the backtesting system, along with their handling.

## Entry Edge Cases

### Call Timestamp Before First Candle

**Scenario**: Alert timestamp is before the first candle in the stream

**Current Behavior**:
- Entry candle is the first candle (if `entryIdx === -1`, uses first candle)
- Entry price is first candle's close
- Entry timestamp is first candle's timestamp

**Rationale**: Assumes entry occurs at first available candle if alert is before data starts.

**Example**:
```
Alert: 2024-01-01 00:00:00
First candle: 2024-01-01 01:00:00
Entry: First candle (01:00:00)
```

### All Candles After Entry Timestamp

**Scenario**: All candles are after the alert timestamp (no entry candle found)

**Current Behavior**:
- Returns `createNoEntryResult()` with zero return
- `exitReason: 'no_entry'`
- Trade is excluded from results

**Rationale**: Cannot execute trade without entry candle.

### Entry Candle Has Invalid Price

**Scenario**: Entry candle has zero, negative, or non-finite price

**Current Behavior**:
- Returns `createNoEntryResult()` with zero return
- Trade is excluded from results

**Rationale**: Invalid entry price prevents meaningful trade execution.

## Policy Execution Edge Cases

### Policy Triggers on Entry Candle

**Scenario**: Stop loss or take profit triggers on the same candle as entry

**Current Behavior**:
- Policy checks occur after entry is established
- If entry candle's low/high triggers exit, exit occurs on same candle
- `timeExposedMs` may be 0 or very small

**Example**:
```
Entry: $100 (candle close)
Stop: $80
Entry candle low: $75
Result: Exit at $80 on entry candle
```

### Multiple Triggers in Same Candle

**Scenario**: Multiple exit conditions trigger in the same candle

**Precedence Rules**:
1. Hard stop > Trailing stop > Take profit > Time stop
2. Stop loss > Take profit (fixed stop)
3. Stop loss > Ladder levels (ladder policy)
4. First sub-policy (combo policy)

**Current Behavior**: First check in precedence order wins.

### Trailing Stop Never Activates

**Scenario**: Price never reaches activation threshold

**Current Behavior**:
- Trailing stop never activates
- Only hard stop (if configured) can trigger exit
- If no hard stop, trade continues until end of data or other policy triggers

**Example**:
```
Entry: $100
Activation: $120 (20% gain)
Trail: 10% from peak
Price never exceeds $120
Result: Trailing stop never activates, only hard stop applies
```

### Ladder Levels Hit Out of Order

**Scenario**: Price gaps past multiple ladder levels

**Current Behavior**:
- Levels are checked sequentially in sorted order
- If price gaps past level 2x to 4x, only 2x triggers (first check)
- Subsequent candles can trigger remaining levels

**Example**:
```
Entry: $100
Levels: [2x, 3x, 4x]
Candle high: $450 (4.5x)
Result: 2x level triggers (first check), remaining levels checked on next candle
```

### Combo Policy: All Sub-Policies Trigger Simultaneously

**Scenario**: Multiple sub-policies trigger exit in the same candle

**Current Behavior**:
- First sub-policy in array order wins
- Exit reason reflects the winning sub-policy

**Rationale**: Deterministic behavior requires fixed precedence.

## Data Quality Edge Cases

### Empty Candle Array

**Scenario**: No candles provided for a call

**Current Behavior**:
- Returns `createNoEntryResult()` with zero return
- Trade excluded from results

### Duplicate Timestamps

**Scenario**: Multiple candles with same timestamp

**Current Behavior**:
- Integrity checker flags duplicates as critical issue
- Policy executor uses first candle encountered (deterministic but may be incorrect)
- **Recommendation**: Deduplicate candles before policy execution

### Timestamp Gaps

**Scenario**: Large gaps between candles (e.g., missing hours/days)

**Current Behavior**:
- Policy executor continues normally
- Integrity checker flags gaps exceeding `maxGapIntervals`
- No interpolation or gap filling

**Example**:
```
Candle 1: 10:00
Candle 2: 15:00 (5 hour gap)
Policy: Time stop at 1 hour
Result: Time stop triggers at 15:00 (next candle after 1 hour)
```

### Price Anomalies

**Scenario**: Zero, negative, or extreme price spikes

**Current Behavior**:
- Integrity checker flags anomalies
- Policy executor may produce unexpected results if prices are invalid
- **Recommendation**: Filter invalid candles before execution

## Coverage Edge Cases

### Call Too New

**Scenario**: All candles are after call timestamp (no pre-alert data)

**Current Behavior**:
- Coverage check returns `eligible: false, reason: 'too_new'`
- Call excluded from backtest

**Rationale**: Need pre-alert candles for indicator warmup and context.

### Insufficient Candles

**Scenario**: Fewer candles than required minimum

**Current Behavior**:
- Coverage check returns `eligible: false, reason: 'missing_range'`
- Call excluded from backtest

**Rationale**: Need minimum candles for reliable simulation.

### Missing Interval

**Scenario**: No candles for requested interval (e.g., requesting 5m but only 1m available)

**Current Behavior**:
- Coverage check returns `eligible: false, reason: 'missing_interval'`
- Call excluded from backtest

## Optimization Edge Cases

### No Feasible Policy

**Scenario**: All policies violate constraints

**Current Behavior**:
- Optimizer returns `bestPolicy: null`
- `feasiblePolicies: []`
- Result indicates no feasible solution

### Validation Split: Empty Sets

**Scenario**: Validation split produces empty training or validation set

**Current Behavior**:
- Overfitting detection skipped if validation set too small
- `validationSampleTooSmall: true`
- Optimizer continues with training set only

### Overfitting Detection: Identical Scores

**Scenario**: Training and validation scores are identical

**Current Behavior**:
- `overfittingDetected: false`
- `severity: 'none'`
- `scoreGap: 0`

## Performance Edge Cases

### Very Long Candle Streams

**Scenario**: Thousands of candles per call

**Current Behavior**:
- Policy executor iterates through all candles (O(n))
- Performance degrades linearly with candle count
- **Recommendation**: Limit max hold time to reduce candle count

### Many Calls

**Scenario**: Thousands of calls in single backtest

**Current Behavior**:
- Each call processed sequentially
- Memory usage scales with number of calls
- **Recommendation**: Batch processing or parallelization

## Integration Edge Cases

### Schema Mismatch

**Scenario**: Database schema version doesn't match required version

**Current Behavior**:
- Schema version check fails in CI
- Migration required before execution
- **Recommendation**: Run migrations before backtest

### ClickHouse Unavailable

**Scenario**: ClickHouse database not accessible

**Current Behavior**:
- Coverage check fails
- Backtest cannot proceed
- **Recommendation**: Health checks before execution

## Recommendations

### Pre-Execution Validation

1. **Deduplicate candles**: Remove duplicate timestamps before execution
2. **Filter invalid prices**: Remove candles with zero/negative prices
3. **Validate gaps**: Flag or fill large timestamp gaps
4. **Check coverage**: Ensure sufficient candles before execution

### Post-Execution Validation

1. **Verify invariants**: `realizedReturn <= peakReturn`, `tailCapture <= 1.0`
2. **Check exit reasons**: Ensure all exits have valid reasons
3. **Validate timestamps**: Entry timestamp <= exit timestamp

### Error Handling

1. **Graceful degradation**: Return zero return instead of throwing
2. **Logging**: Log all edge cases for analysis
3. **Metrics**: Track edge case frequency

## Testing Coverage

Edge cases are tested in:
- `packages/backtest/tests/unit/policies/policy-executor.test.ts`
- `packages/backtest/tests/unit/integrity/candle-integrity.test.ts`
- `packages/backtest/tests/unit/coverage.test.ts` (if exists)

