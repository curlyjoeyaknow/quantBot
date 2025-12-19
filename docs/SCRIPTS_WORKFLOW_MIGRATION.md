# Scripts Workflow Migration Status

This document tracks which scripts have been migrated to use workflows vs. calling services directly.

## ✅ Migrated to Workflows

### 1. `scripts/test-ohlcv-ingestion.ts`
- **Before**: Called `OhlcvIngestionService.ingestForCalls()` directly
- **After**: Uses `ingestOhlcv` workflow
- **Status**: ✅ **COMPLETED**

### 2. `scripts/ingest/fetch-ohlcv-for-calls.ts`
- **Before**: Called `OhlcvIngestionService.ingestForCalls()` directly
- **After**: Uses `ingestOhlcv` workflow
- **Status**: ✅ **COMPLETED**

## ⚠️ Different Use Cases (May Not Need Migration)

### 3. `scripts/workflows/fetch-ohlcv.ts`
- **Current**: Queries Postgres for tokens, then fetches OHLCV using `fetchHybridCandles` and `insertCandles`
- **Note**: This is Postgres-based (not DuckDB-based), so it's a different use case
- **Decision**: Could create a separate workflow for Postgres-based ingestion, or keep as-is since it's a utility script
- **Status**: ⏸️ **DECISION NEEDED**

## 🔄 Complex Scripts (May Need Refactoring)

### 4. `scripts/ingest/fetch-ohlcv-for-alerts-14d.ts`
- **Current**: Directly calls Birdeye API with custom rate limiting and credit optimization
- **Complexity**: 
  - Custom rate limiter (50 RPS)
  - Credit optimization (5000 candles = 120 credits)
  - Fetches multiple intervals (1s, 15s, 1m, 5m)
  - Progress tracking
- **Options**:
  - **Option A**: Refactor to use `ingestOhlcv` workflow (simpler, but loses custom optimizations)
  - **Option B**: Keep as-is (preserves optimizations, but bypasses workflow layer)
  - **Option C**: Create specialized workflow for multi-interval fetching with rate limiting
- **Status**: ⏸️ **DECISION NEEDED**

## 📝 Summary

- **2 scripts migrated** ✅
- **1 script needs decision** (Postgres-based, different use case)
- **1 complex script needs decision** (custom optimizations)

## Recommendations

1. **For `scripts/workflows/fetch-ohlcv.ts`**: 
   - If it's a utility script, consider keeping as-is
   - If it's a common use case, create a Postgres-based ingestion workflow

2. **For `scripts/ingest/fetch-ohlcv-for-alerts-14d.ts`**:
   - If custom rate limiting/credit optimization is critical, keep as-is
   - If workflow consistency is more important, refactor to use workflow (may need to add rate limiting to workflow context)

