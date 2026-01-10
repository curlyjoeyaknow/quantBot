# ClickHouse → Jesse Schema Mapping

## ClickHouse OHLCV Table Schema

```sql
CREATE TABLE quantbot.ohlcv_candles (
  token_address String,      -- Token mint address (full, case-preserved)
  chain String,              -- Blockchain: solana, ethereum, bsc, base, etc.
  timestamp DateTime,         -- OPEN time of bar (bar period start)
  interval String,           -- Candle interval: '1m', '5m', '15m', '1h'
  open Float64,              -- Opening price
  high Float64,              -- Highest price in interval
  low Float64,               -- Lowest price in interval
  close Float64,             -- Closing price
  volume Float64             -- Volume in quote currency
)
ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, timestamp)
```

## Timestamp Convention (CRITICAL)

**ClickHouse `timestamp` = OPEN time of the bar**

- **Meaning**: When the bar period **starts**
- **Bar represents**: `[timestamp, timestamp + interval)`
- **Example**: 
  - Candle at `2024-01-01 10:00:00` with interval `5m`
  - Contains data from `10:00:00` to `10:04:59.999`
  - You **cannot** use data from `10:05:00` when processing this candle

**This is the standard convention and prevents look-ahead bias.**

## Jesse Import Format

Jesse's `research.store_candles()` expects:

```python
# Format: [[timestamp_ms, open, close, high, low, volume], ...]
# Note: Column order is [timestamp, open, close, high, low, volume]
# Note: timestamp is in MILLISECONDS (not seconds)

candles = [
    [1704067200000, 100.0, 105.0, 110.0, 95.0, 1000.0],
    [1704067500000, 105.0, 108.0, 112.0, 104.0, 1200.0],
    ...
]

research.store_candles(
    exchange="Binance",
    symbol="SOL-USDT",
    candles=candles
)
```

## Mapping Rules

| ClickHouse Column | Type | Jesse Format | Conversion |
|------------------|------|--------------|------------|
| `timestamp` | `DateTime` | `timestamp` (ms) | `toUnixTimestamp(timestamp) * 1000` |
| `open` | `Float64` | `open` | Direct copy |
| `high` | `Float64` | `high` | Direct copy |
| `low` | `Float64` | `low` | Direct copy |
| `close` | `Float64` | `close` | Direct copy |
| `volume` | `Float64` | `volume` | Direct copy |
| `interval` | `String` | N/A | Used for filtering only |
| `chain` | `String` | N/A | Used for filtering only |
| `token_address` | `String` | N/A | Used for filtering only |

## SQL Query for Export

```sql
SELECT
  toUnixTimestamp(timestamp) * 1000 as timestamp_ms,  -- Convert to milliseconds
  open,
  close,  -- Note: Jesse expects [timestamp, open, close, high, low, volume]
  high,
  low,
  volume
FROM quantbot.ohlcv_candles
WHERE token_address = 'So11111111111111111111111111111111111111112'
  AND chain = 'solana'
  AND interval = '5m'
  AND timestamp >= '2024-01-01 00:00:00' - INTERVAL 250 * 5 MINUTE  -- Warmup buffer
  AND timestamp <= '2024-01-31 23:59:59'
ORDER BY timestamp ASC
```

## Python Conversion Function

```python
def clickhouse_to_jesse(row):
    """
    Convert ClickHouse row to Jesse format.
    
    Args:
        row: ClickHouse query result row
          - timestamp: DateTime (bar OPEN time)
          - open, high, low, close, volume: Float64
    
    Returns:
        List: [timestamp_ms, open, close, high, low, volume]
    """
    timestamp_ms = int(row['timestamp'].timestamp() * 1000)
    return [
        timestamp_ms,
        float(row['open']),
        float(row['close']),  # Note: close comes before high/low in Jesse format
        float(row['high']),
        float(row['low']),
        float(row['volume']),
    ]
```

## TypeScript Conversion Function

```typescript
interface ClickHouseRow {
  timestamp: Date;  // DateTime from ClickHouse
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function clickhouseToJesse(row: ClickHouseRow): number[] {
  const timestampMs = Math.floor(row.timestamp.getTime());
  return [
    timestampMs,
    row.open,
    row.close,  // Note: close before high/low
    row.high,
    row.low,
    row.volume,
  ];
}
```

## Complete Export Example

```python
from clickhouse_driver import Client
from jesse import research
from datetime import datetime, timedelta

# Connect to ClickHouse
ch = Client(host='localhost', database='quantbot')

# Calculate warmup (250 candles for 5m = 1250 minutes = ~21 hours)
warmup_candles = 250
interval_seconds = 300  # 5 minutes
warmup_seconds = warmup_candles * interval_seconds

# Export range
start_time = datetime(2024, 1, 1, 0, 0, 0)
end_time = datetime(2024, 1, 31, 23, 59, 59)
export_start = start_time - timedelta(seconds=warmup_seconds)

# Query ClickHouse
query = """
SELECT
  timestamp,
  open,
  high,
  low,
  close,
  volume
FROM quantbot.ohlcv_candles
WHERE token_address = %(token_address)s
  AND chain = %(chain)s
  AND interval = %(interval)s
  AND timestamp >= %(export_start)s
  AND timestamp <= %(end_time)s
ORDER BY timestamp ASC
"""

rows = ch.execute(query, {
  'token_address': 'So11111111111111111111111111111111111111112',
  'chain': 'solana',
  'interval': '5m',
  'export_start': export_start,
  'end_time': end_time,
})

# Convert to Jesse format
jesse_candles = []
for row in rows:
  timestamp_ms = int(row[0].timestamp() * 1000)  # DateTime to milliseconds
  jesse_candles.append([
    timestamp_ms,
    float(row[1]),  # open
    float(row[4]),  # close (note: close before high/low)
    float(row[2]),  # high
    float(row[3]),  # low
    float(row[5]),  # volume
  ])

# Import to Jesse
research.store_candles(
  exchange="Binance",
  symbol="SOL-USDT",
  candles=jesse_candles
)

print(f"✅ Imported {len(jesse_candles)} candles")
print(f"   Warmup: {sum(1 for c in jesse_candles if c[0] < int(start_time.timestamp() * 1000))} candles")
print(f"   Trading: {len(jesse_candles) - sum(1 for c in jesse_candles if c[0] < int(start_time.timestamp() * 1000))} candles")
```

## Validation Checklist

- [ ] **Timestamp convention**: ClickHouse timestamp = OPEN time (verified)
- [ ] **Conversion**: DateTime → Unix milliseconds (multiply by 1000)
- [ ] **Column order**: `[timestamp, open, close, high, low, volume]` (Jesse format)
- [ ] **Warmup buffer**: Export includes `[start - warmup, end]`
- [ ] **Trading range**: Backtest runs on `[start, end]` (warmup excluded)
- [ ] **Data integrity**: No NaN values, high >= low, etc.

## Common Mistakes

### ❌ Wrong: Using close time as timestamp
```python
# BAD: Creates look-ahead bias
timestamp = close_time  # You can't know close until bar ends!
```

### ✅ Correct: Using open time as timestamp
```python
# GOOD: Standard convention
timestamp = open_time  # Bar period start
```

### ❌ Wrong: Timestamp in seconds
```python
# BAD: Jesse expects milliseconds
timestamp = int(row['timestamp'].timestamp())  # Wrong!
```

### ✅ Correct: Timestamp in milliseconds
```python
# GOOD: Jesse format
timestamp = int(row['timestamp'].timestamp() * 1000)  # Correct!
```

### ❌ Wrong: Wrong column order
```python
# BAD: Wrong order
[timestamp, open, high, low, close, volume]  # Wrong!
```

### ✅ Correct: Jesse column order
```python
# GOOD: Jesse format
[timestamp, open, close, high, low, volume]  # Correct!
```

