# Jesse Export: Timestamp Convention & Warmup Strategy

## Critical Timestamp Convention

**ClickHouse OHLCV Schema:**

```sql
CREATE TABLE ohlcv_candles (
  token_address String,
  chain String,
  timestamp DateTime,  -- OPEN time of the bar (bar period start)
  interval String,
  open Float64,
  high Float64,
  low Float64,
  close Float64,
  volume Float64
)
```

**Convention:**

- **`timestamp` = OPEN time** (when the bar period starts)
- **Bar represents**: `[timestamp, timestamp + interval)`
- **Example**: A 5m candle at `2024-01-01 10:00:00` contains data from `10:00:00` to `10:04:59.999`

This is the **standard convention** and prevents look-ahead bias:

- A bar at timestamp T contains data from [T, T+interval)
- You cannot use data from T+interval when processing bar T
- Jesse expects this same convention

## Warmup Buffer Strategy

### Why Warmup?

Indicators need historical data to initialize:

- **Ichimoku**: 52 periods lookback
- **RSI**: 14 periods lookback
- **Moving averages**: Variable (20, 50, 200 periods)
- **MACD**: ~26 periods lookback

Without warmup, indicators are undefined at the start of backtest.

### Export Range

Export `[start - warmup, finish]` for each timeframe:

```typescript
const warmupCandles = maxIndicatorLookback + safetyPad; // e.g., 200 + 50 = 250
const warmupSeconds = warmupCandles * intervalSeconds;
const exportStart = startTime.minus({ seconds: warmupSeconds });

// Export: [exportStart, endTime]
// Trading: [startTime, endTime] (warmup excluded)
```

### Warmup Calculation

```typescript
function calculateWarmupCandles(
  interval: string,
  maxIndicatorLookback: number = 200,
  safetyPad: number = 50
): number {
  return maxIndicatorLookback + safetyPad;
}
```

**Example (5m candles, Ichimoku + RSI):**

- Max lookback: 52 (Ichimoku) + 14 (RSI) = 66 periods
- Safety pad: 50 candles
- Total warmup: 116 candles = 580 minutes = ~9.7 hours

## Jesse Import Format

Jesse's `research.store_candles()` expects:

```python
# Format: [[timestamp_ms, open, close, high, low, volume], ...]
candles = [
    [1704067200000, 100.0, 105.0, 110.0, 95.0, 1000.0],  # timestamp in milliseconds
    [1704067500000, 105.0, 108.0, 112.0, 104.0, 1200.0],
    ...
]

research.store_candles(exchange="Binance", symbol="SOL-USDT", candles=candles)
```

**Conversion:**

- ClickHouse: `timestamp` (DateTime) → Unix seconds
- Jesse: Unix **milliseconds** (multiply by 1000)
- Column order: `[timestamp, open, close, high, low, volume]`

## Tripwire Test (Look-Ahead Detection)

The "no bullshit" check that catches leakage:

### Algorithm

1. **Run original backtest** with all candles
2. **Scramble candles after time T**:
   - Swap high/low
   - Invert close price
   - Keep open unchanged
3. **Re-run backtest** with scrambled data
4. **Assert**: Decisions before time T are **identical**

### Why It Works

If decisions before T change when data after T is scrambled, there's look-ahead leakage:

- Strategy is using future data
- Indicators are peeking ahead
- Data pipeline has a bug

### Implementation

```python
def run_tripwire_test(candles, tripwire_time, strategy_func):
    # Original run
    original_decisions = strategy_func()
    
    # Scramble after T
    scrambled = [scramble(c) if c.timestamp >= tripwire_time else c for c in candles]
    
    # Re-run
    scrambled_decisions = strategy_func()
    
    # Compare decisions before T
    original_before = [d for d in original_decisions if d.timestamp < tripwire_time]
    scrambled_before = [d for d in scrambled_decisions if d.timestamp < tripwire_time]
    
    assert original_before == scrambled_before, "Look-ahead leakage detected!"
```

## Usage Example

### TypeScript (Export & Validation)

```typescript
import { exportCandlesWithWarmup, convertToJesseFormat } from './export_to_jesse';

const candles = await exportCandlesWithWarmup({
  tokenAddress: 'So11111111111111111111111111111111111111112',
  chain: 'solana',
  interval: '5m',
  startTime: DateTime.fromISO('2024-01-01T00:00:00Z'),
  endTime: DateTime.fromISO('2024-01-31T23:59:59Z'),
  maxIndicatorLookback: 200,
});

const jesseCandles = convertToJesseFormat(candles);
// Export to JSON for Python import
```

### Python (Jesse Import & Backtest)

```python
from tools.jesse.export_to_jesse import JesseExporter

exporter = JesseExporter()

# Export with warmup
candles = exporter.export_candles(
    token_address="So11111111111111111111111111111111111111112",
    chain="solana",
    interval="5m",
    start_time=datetime(2024, 1, 1, 0, 0, 0),
    end_time=datetime(2024, 1, 31, 23, 59, 59),
    max_indicator_lookback=200,
)

# Import to Jesse
exporter.import_to_jesse(
    exchange="Binance",
    symbol="SOL-USDT",
    candles=candles,
    start_time=datetime(2024, 1, 1, 0, 0, 0),  # Trading starts here
    end_time=datetime(2024, 1, 31, 23, 59, 59),
)

# Run backtest (Jesse handles warmup automatically)
research.run(start_date='2024-01-01', finish_date='2024-01-31')

# Run tripwire test
exporter.run_tripwire_test(
    exchange="Binance",
    symbol="SOL-USDT",
    candles=candles,
    tripwire_time=datetime(2024, 1, 15, 12, 0, 0),  # Scramble after this
    strategy_func=lambda: research.run(...),
)
```

## Best Practices

1. **Always use warmup**: Never start backtest without indicator initialization
2. **Safety pad**: Add 20-50 extra candles beyond max lookback
3. **Validate timestamp convention**: Ensure ClickHouse timestamp = OPEN time
4. **Run tripwire test**: Before trusting any backtest results
5. **Document indicator lookbacks**: Track max lookback across all indicators

## Common Pitfalls

### ❌ Wrong: Using close time as timestamp

```sql
-- BAD: This creates look-ahead bias
timestamp = close_time  -- You can't know close until bar ends!
```

### ✅ Correct: Using open time as timestamp

```sql
-- GOOD: Standard convention
timestamp = open_time  -- Bar period start
```

### ❌ Wrong: No warmup buffer

```python
# BAD: Indicators undefined at start
candles = export(start='2024-01-01', end='2024-01-31')
# RSI, Ichimoku, etc. are NaN for first 50+ candles
```

### ✅ Correct: Warmup buffer included

```python
# GOOD: Indicators initialized
candles = export(start='2024-01-01', end='2024-01-31', warmup=250)
# All indicators valid from first trading candle
```

## Verification Checklist

- [ ] ClickHouse timestamp = OPEN time (verified in schema)
- [ ] Warmup buffer calculated correctly (max lookback + safety pad)
- [ ] Export range includes warmup: `[start - warmup, end]`
- [ ] Trading range excludes warmup: `[start, end]`
- [ ] Jesse import format correct (milliseconds, column order)
- [ ] Tripwire test passes (no look-ahead leakage)
- [ ] All indicators initialized before first trade
