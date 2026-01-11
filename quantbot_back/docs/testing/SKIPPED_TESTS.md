# Skipped Tests Inventory (49 total)

## Summary by Action

| Action | Count | Tests |
|--------|-------|-------|
| **DELETE** | 17 | Birdeye manual skip (1) + Moved functionality (16) |
| **MIGRATE** | 16 | Moved functionality tests → @quantbot/ohlcv |
| **FIX & UN-SKIP** | 5 | DuckDB idempotency goldens |
| **KEEP GATED** | 27 | DB stress tests (RUN_DB_STRESS=1) |

---

## 1. DELETE (17 tests)

### `packages/api-clients/tests/unit/birdeye-client.test.ts` (1 test)
- ❌ **DELETE**: `it.skip('should fetch OHLCV data successfully')`
- **Reason**: Lone `it.skip()` fossilizes bugs. Either:
  - Delete it, OR
  - Convert to gated integration test (`RUN_NET_TESTS=1` + `BIRDEYE_API_KEY`)

### `packages/simulation/tests/candles_comprehensive.test.ts` (16 tests)
- ❌ **DELETE**: All tests in these skipped describe blocks:
  - `describe.skip('fetchHybridCandles')` - 12 tests:
    1. `should fetch candles successfully for Solana`
    2. `should fetch candles successfully for Ethereum`
    3. `should handle API errors gracefully`
    4. `should handle empty response data`
    5. `should handle unsuccessful API response`
    6. `should handle different chain types`
    7. `should handle malformed candle data`
    8. `should handle missing candle properties`
    9. `should use cached data when available`
    10. `should save candles to cache after fetching`
    11. (2 more tests in this block)
  - `describe.skip('Cache functionality')` - 2 tests:
    1. `should create cache directory if it does not exist`
    2. `should handle cache read errors gracefully`
  - `describe.skip('API integration')` - 2 tests:
    1. (2 tests in this block)
- **Reason**: Functionality moved to `@quantbot/ohlcv`. Keeping as "reference" is dead weight.
- **Action**: Port best 3-5 tests to `@quantbot/ohlcv`, delete the rest.

---

## 2. MIGRATE (16 tests)

### `packages/simulation/tests/candles_comprehensive.test.ts` (16 tests)
- 🔄 **MIGRATE**: Same 16 tests as above, but port the valuable ones to `@quantbot/ohlcv`
- **Priority tests to migrate**:
  1. `should fetch candles successfully for Solana` (core functionality)
  2. `should handle API errors gracefully` (error handling)
  3. `should handle malformed candle data` (robustness)
  4. `should use cached data when available` (cache behavior)
  5. `should handle different chain types` (multi-chain support)

---

## 3. FIX & UN-SKIP (5 tests) - HIGHEST VALUE

### `packages/storage/tests/golden/idempotency.golden.test.ts` (5 tests)
- 💎 **FIX & UN-SKIP**: These test core idempotency invariants
  1. `it.skip('GOLDEN: upsert same data twice should produce one record')`
  2. `it.skip('GOLDEN: upsert with updated data should update existing record')`
  3. `it.skip('GOLDEN: different tokens should create separate records')`
  4. `it.skip('GOLDEN: same mint different interval should create separate records')`
  5. `it.skip('GOLDEN: should preserve exact case of mint addresses')`
- **Current blocker**: "require proper DuckDB Python script setup"
- **Solutions**:
  1. **Preferred**: Mock Python layer, call DuckDB repository directly
  2. **Alternative**: Use in-memory DuckDB + seed fixtures in test setup
  3. **Fallback**: Gate behind `RUN_DUCKDB_GOLDENS=1` + provide setup script
- **Goal**: Get these unskipped ASAP (idempotency is critical)

---

## 4. KEEP GATED (27 tests) - HEALTHY

### `packages/workflows/tests/integration/ohlcv/analyzeCoverage.integration.test.ts` (13 tests)
- ✅ **KEEP GATED**: Requires `RUN_DB_STRESS=1` + ClickHouse + DuckDB
  1. `should analyze caller coverage with real DuckDB data`
  2. `should filter by specific caller`
  3. `should generate fetch plan when requested`
  4. `should handle month range filtering`
  5. `should handle non-existent caller gracefully`
  6. `should handle minimum coverage threshold of 0`
  7. `should handle maximum coverage threshold of 1`
  8. `should handle concurrent analysis requests`
  9. `should handle non-existent DuckDB file`
  10. `should handle corrupted DuckDB file`
  11. (3 more tests in this suite)

### `packages/workflows/tests/integration/runSimulation.integration.test.ts` (3 tests)
- ✅ **KEEP GATED**: Requires `RUN_DB_STRESS=1` + ClickHouse + Postgres
  1. `it.skip('INTEGRATION: runs simulation with real database and OHLCV')` - Manual skip
  2. `INTEGRATION: handles missing strategy gracefully` - Gated by `describe.skipIf`
  3. `INTEGRATION: handles empty date range (no calls)` - Gated by `describe.skipIf`
- **Note**: Remove Postgres mention from comments (migrating away from Postgres)

### `packages/workflows/tests/golden/ohlcv/surgicalOhlcvFetch.golden.test.ts` (11 tests)
- ✅ **KEEP GATED**: Requires `RUN_DB_STRESS=1` + ClickHouse + DuckDB
  1. `should analyze coverage and show top gaps without fetching`
  2. `should show what would be fetched without actually fetching`
  3. `should fetch gaps for specific caller`
  4. `should fetch gaps for specific month`
  5. `should fetch gaps for specific caller and month`
  6. `should handle case where all callers have good coverage`
  7. `should return fully JSON-serializable results`
  8. `should have consistent task result structure`
  9. `should collect errors without failing fast`
  10. `should track duration accurately`
  11. `should complete within reasonable time for dry run`

---

## Recommended Actions

### Immediate (Before Next Merge)
1. ✅ Delete the lone `it.skip()` in Birdeye client (or convert to gated integration test)
2. ✅ Delete or migrate the 16 "moved functionality" tests in simulation package

### High Priority (This Sprint)
3. 💎 **Fix the 5 idempotency golden tests** - These are critical invariants
   - Mock Python layer OR use in-memory DuckDB
   - Get them running in CI

### Nice to Have (Next Sprint)
4. 🔧 Create `pnpm test:db-stress` script that:
   - Starts ClickHouse (docker compose)
   - Seeds DuckDB fixtures
   - Runs only gated tests
   - Turns "skipped forever" into "run nightly / before merge"

5. 📝 Update `runSimulation.integration.test.ts` comments to remove Postgres references

---

## Test Gate Summary

| Gate | Count | Purpose |
|------|-------|---------|
| `RUN_DB_STRESS=1` | 27 | Heavy ClickHouse/DB tests |
| Manual `it.skip()` | 2 | Temporary disables (should be fixed/deleted) |
| `describe.skip()` | 16 | Moved functionality (should be deleted/migrated) |
| Setup blocker | 5 | Idempotency tests (should be fixed) |

