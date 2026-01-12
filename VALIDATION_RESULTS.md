# OHLCV Pipeline Validation Results

## Phase 1: ClickHouse Connectivity ✅ PASSED

**Test**: Verify ClickHouse schema and connectivity

**Results**:

- ✅ Connection successful
- ✅ Total candles: 126,254,049
- ✅ Schema verified: `token_address, chain, timestamp, interval_seconds, open, high, low, close, volume`
- ⚠️ **Important**: Schema uses `interval_seconds` (UInt32), NOT `interval` (String)

**Data Distribution** (top 10):

- solana/1m: 76,720,039 candles
- solana/5m: 34,434,472 candles
- ethereum/1m: 5,045,464 candles
- ethereum/5m: 2,777,291 candles
- solana/1s: 1,844,924 candles
- solana/0s: 1,844,784 candles (likely data issue - 0s interval)
- bsc/1m: 1,370,282 candles
- bsc/5m: 943,175 candles
- bsc/1s: 479,751 candles
- base/1m: 309,123 candles

**Key Finding**: The ClickHouse schema is correct and has substantial data.

## Phase 2: Birdeye API Fetch ✅ PASSED

**Test**: Fetch 1 hour of 1m candles for Wrapped SOL

**Command**:

```bash
./scripts/test/test-ohlcv-fetch-direct.sh
```

**Results**:

- ✅ API connection successful
- ✅ Fetched 60 candles for 1 hour window
- ✅ All OHLC values valid (high >= low, open/close within range)
- ✅ Timestamps sequential and properly spaced (60s intervals)
- ✅ No gaps detected in test window

**Sample Data**:

```json
{
  "timestamp": 1768194660,
  "open": 142.64623917818807,
  "high": 142.73475147295505,
  "low": 142.4901780768857,
  "close": 142.73326615151018,
  "volume": 31678.637171221802
}
```

**Key Finding**: Birdeye API is working correctly and returns valid, complete data for recent time windows.

## Phase 3: Storage Write/Read ⚠️ ISSUES FOUND

**Test**: Write 10 candles to ClickHouse, read them back

**Command**:

```bash
python3 tools/validation/verify_storage_write_read.py \
  --mint So11111111111111111111111111111111111111112 \
  --from-unix <START> --to-unix <END> --interval 1m
```

**Results**:

- ✅ Candles fetched: 10
- ✅ Candles written: 10
- ❌ Candles read back: 38 (not 10!)
- ❌ Count mismatch detected
- ❌ Value mismatches detected

**Key Finding**: ClickHouse is storing DUPLICATE candles!

The table allows multiple rows with the same (token_address, chain, timestamp, interval_seconds). This means:

1. Every ingestion run creates new rows instead of updating existing ones
2. Queries return multiple rows per timestamp
3. This explains data inconsistencies

**Root Cause**: The `ohlcv_candles` table lacks a PRIMARY KEY or UNIQUE constraint on (token_address, chain, timestamp, interval_seconds).

**Impact**: This is a CRITICAL issue that affects:

- Data integrity
- Query correctness
- Storage efficiency
- All downstream analysis

## Phase 4: End-to-End Ingestion - PENDING

**Next Steps**:

1. Run ingestion for ONE alert
2. Verify candles stored in ClickHouse
3. Check for any data loss or corruption

## Phase 5: Gap Diagnosis - PENDING

**Next Steps**:

1. Validate existing slices
2. Compare slice gaps with ClickHouse gaps
3. Determine if gaps are from:
   - Birdeye API (no data available)
   - Ingestion failures
   - Slice export issues

## Known Issues

### CLI Hanging Issue

The TypeScript CLI (`pnpm tsx packages/cli/src/bin/quantbot.ts`) hangs during initialization. This appears to be a CLI infrastructure issue, NOT a data pipeline issue.

**Workaround**: Use Python scripts directly with proper environment setup:

```bash
export $(grep -v '^#' .env | grep BIRDEYE_API_KEY | head -1 | xargs)
python3 tools/validation/verify_ohlcv_fetch.py --mint <MINT> --from-unix <FROM> --to-unix <TO> --interval 1m
```

### Schema Mismatch

Many tools reference `interval` (String) but ClickHouse uses `interval_seconds` (UInt32). This needs to be addressed in:

- Coverage analysis tools
- Slice validators
- Query builders

## Recommendations

1. **Fix CLI hanging**: Debug the CLI initialization to unblock handler-based testing
2. **Schema consistency**: Update all tools to use `interval_seconds` consistently
3. **Continue validation**: Proceed with storage write/read tests using Python scripts directly
4. **Gap analysis**: Once write/read verified, analyze the 95.6% gap rate in existing slices
