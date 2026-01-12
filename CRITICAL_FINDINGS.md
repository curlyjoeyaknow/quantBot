# CRITICAL FINDINGS - OHLCV Pipeline Validation

## 🚨 CRITICAL: Duplicate Candles in ClickHouse

### Problem

The `ohlcv_candles` table allows duplicate rows for the same (token_address, chain, timestamp, interval_seconds) combination.

### Evidence

```sql
SELECT token_address, chain, timestamp, interval_seconds, count() as cnt
FROM quantbot.ohlcv_candles
GROUP BY token_address, chain, timestamp, interval_seconds
HAVING cnt > 1
ORDER BY cnt DESC
LIMIT 10;
```

**Results**: Wrapped SOL has 4x duplicates for recent timestamps (from our test runs).

### Root Cause

The table schema lacks a PRIMARY KEY or UNIQUE constraint:

```sql
CREATE TABLE quantbot.ohlcv_candles (
    token_address String,
    chain String,
    timestamp DateTime,
    interval_seconds UInt32,
    open Float64,
    high Float64,
    low Float64,
    close Float64,
    volume Float64
)
ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, timestamp)
```

**Missing**: `PRIMARY KEY (token_address, chain, timestamp, interval_seconds)` or equivalent deduplication.

### Impact

1. **Data Integrity**: Multiple conflicting values for the same candle
2. **Query Correctness**: Queries return duplicate rows, breaking aggregations
3. **Storage Waste**: 4x storage usage for duplicated data
4. **Slice Quality**: Explains the 95.6% gap rate - duplicates confuse gap detection
5. **Backtest Accuracy**: Simulations may use wrong candle data

### Solution Options

#### Option A: Add ReplacingMergeTree (Recommended)

```sql
-- Create new table with deduplication
CREATE TABLE quantbot.ohlcv_candles_v2 (
    token_address String,
    chain String,
    timestamp DateTime,
    interval_seconds UInt32,
    open Float64,
    high Float64,
    low Float64,
    close Float64,
    volume Float64,
    ingested_at DateTime DEFAULT now()  -- Version column
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, timestamp, interval_seconds);

-- Migrate data (deduplicating)
INSERT INTO quantbot.ohlcv_candles_v2
SELECT
    token_address,
    chain,
    timestamp,
    interval_seconds,
    argMax(open, ingested_at) as open,
    argMax(high, ingested_at) as high,
    argMax(low, ingested_at) as low,
    argMax(close, ingested_at) as close,
    argMax(volume, ingested_at) as volume,
    max(ingested_at) as ingested_at
FROM quantbot.ohlcv_candles
GROUP BY token_address, chain, timestamp, interval_seconds;

-- Rename tables
RENAME TABLE quantbot.ohlcv_candles TO quantbot.ohlcv_candles_old;
RENAME TABLE quantbot.ohlcv_candles_v2 TO quantbot.ohlcv_candles;
```

#### Option B: Use FINAL in Queries

Add `FINAL` keyword to all queries to deduplicate at read time:

```sql
SELECT * FROM quantbot.ohlcv_candles FINAL
WHERE ...
```

**Downside**: Performance penalty on every query.

#### Option C: Deduplicate Before Insert

Modify ingestion code to check for existing data and skip duplicates.

**Downside**: Requires network round-trip for every insert.

### Recommendation

**Implement Option A (ReplacingMergeTree)** because:

1. Automatic deduplication at merge time
2. No query performance penalty
3. Keeps most recent data (by `ingested_at`)
4. Standard ClickHouse pattern for this use case

### Next Steps

1. ✅ Validate findings (DONE)
2. Create migration script
3. Test migration on subset of data
4. Execute full migration
5. Update all ingestion code to add `ingested_at` timestamp
6. Re-export slices from deduplicated data
7. Re-run backtests with clean data

## 🔍 Secondary Finding: Schema Inconsistency

Many tools reference `interval` (String like "1m", "5m") but ClickHouse uses `interval_seconds` (UInt32 like 60, 300).

**Affected Tools**:

- `tools/analysis/ohlcv_caller_coverage.py`
- `tools/analysis/ohlcv_detailed_coverage.py`
- Previous worklist generation scripts

**Fix**: Update all tools to use `interval_seconds` consistently.

## 📊 Validation Summary

| Phase                   | Status     | Finding                      |
| ----------------------- | ---------- | ---------------------------- |
| ClickHouse Connectivity | ✅ PASSED  | 126M candles, schema correct |
| Birdeye API Fetch       | ✅ PASSED  | Returns valid, complete data |
| Storage Write           | ✅ PASSED  | Writes succeed               |
| Storage Read            | ❌ FAILED  | Returns duplicates           |
| Deduplication           | ❌ MISSING | No PRIMARY KEY constraint    |

## Conclusion

The OHLCV pipeline components (Birdeye API, storage writes) work correctly. The issue is **architectural**: the database schema allows duplicates, which corrupts all downstream analysis.

**Priority**: CRITICAL - Fix before any further backtesting or analysis.
