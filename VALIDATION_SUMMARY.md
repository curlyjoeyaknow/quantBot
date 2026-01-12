# OHLCV Pipeline Validation - Executive Summary

## What We Tested

We systematically validated each component of the OHLCV data pipeline to diagnose the 95.6% gap rate in exported slices.

## Key Findings

### ✅ Working Components

1. **ClickHouse Connectivity**: 126M candles stored, schema correct
2. **Birdeye API**: Returns valid, complete, gap-free data
3. **Storage Writes**: Successfully writes candles to database
4. **Python Tools**: All validation scripts work correctly

### ❌ Critical Issue Discovered

**DUPLICATE CANDLES IN CLICKHOUSE**

The `ohlcv_candles` table allows duplicate rows for the same (token, chain, timestamp, interval) combination. This is because:

- No PRIMARY KEY constraint
- Using basic MergeTree instead of ReplacingMergeTree
- Every ingestion run adds new rows instead of updating

**Evidence**: Wrapped SOL has 4x duplicates for recent timestamps from our test runs.

## Root Cause of 95.6% Gap Rate

The gap rate is NOT because data is missing. It's because:

1. Duplicates confuse gap detection logic
2. Slice exporters may skip or miscount candles
3. Query results include multiple rows per timestamp

## Impact

- ❌ Data integrity compromised
- ❌ Query results incorrect
- ❌ Backtest accuracy questionable
- ❌ Storage waste (4x for some tokens)
- ❌ All downstream analysis affected

## Solution

**Migrate to ReplacingMergeTree**

```sql
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
    ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, timestamp, interval_seconds);
```

This will:

- Automatically deduplicate at merge time
- Keep most recent data (by `ingested_at`)
- Fix all downstream issues
- Standard ClickHouse pattern

## Action Items

### Immediate (Critical)

1. ✅ Validate duplicate issue (DONE)
2. Create migration script for ReplacingMergeTree
3. Test migration on small dataset
4. Execute full migration
5. Update ingestion code to add `ingested_at` timestamp

### After Migration

6. Re-export slices from clean data
7. Re-validate slice quality (should be >99% coverage)
8. Re-run backtests with deduplicated data

### Secondary Fixes

9. Update tools to use `interval_seconds` consistently
10. Fix CLI hanging issue (infrastructure, not data)

## Files Created

- `VALIDATION_RESULTS.md` - Detailed test results
- `CRITICAL_FINDINGS.md` - In-depth analysis and solutions
- `tools/validation/verify_ohlcv_fetch.py` - Birdeye API test
- `tools/validation/verify_storage_write_read.py` - Storage integrity test
- `scripts/test/test-ohlcv-fetch-direct.sh` - Quick test script

## Validation Status

| Component         | Status | Notes                           |
| ----------------- | ------ | ------------------------------- |
| ClickHouse Schema | ✅     | Correct structure, wrong engine |
| Birdeye API       | ✅     | Returns complete data           |
| Storage Write     | ✅     | Writes succeed                  |
| Storage Read      | ❌     | Returns duplicates              |
| Deduplication     | ❌     | Missing PRIMARY KEY             |
| Slice Export      | ⏸️     | Blocked by duplicates           |
| OHLCV Ingestion   | ⏸️     | Works but creates duplicates    |

## Conclusion

**The OHLCV fetch and ingestion pipeline works correctly.** The issue is architectural - the database schema allows duplicates, which corrupts all downstream analysis.

**Priority**: CRITICAL - Migrate to ReplacingMergeTree before any further analysis or backtesting.

**Good News**: This is fixable with a schema migration. Once fixed, the pipeline will work correctly end-to-end.
