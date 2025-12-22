# OHLCV Ingestion Stress Test Suite

## Overview

This comprehensive stress test suite is designed to **expose weaknesses and flaws** in the OHLCV ingestion pipeline. The tests are intentionally difficult and should **almost guarantee failures** initially, forcing improvements to the implementation rather than hacking through tests to pass.

## Philosophy

**"Does the system lie, or fail loudly?"**

Every test validates that the system either:
1. Produces correct output, or
2. Fails with a structured, actionable error

Silent failures, data corruption, and undefined behavior are unacceptable.

## Test Coverage

### 1. Input Violence (18+ tests)
- **Invalid Mint Addresses**: Empty strings, too short/long, forbidden characters (0, O, I, l), zero addresses, invalid hex, newlines, trailing spaces, zero-width spaces
- **Extreme Date Ranges**: Future dates, very old dates (10 years), reversed ranges, same start/end, huge ranges (10 years), tiny ranges (1 second), invalid timestamps (NaN)
- **Invalid Call Data**: Missing tokenId, invalid timestamps, empty calls array

### 2. API Failure Modes (12+ tests)
- **Response Failures**: Empty response body, malformed JSON, missing data fields, empty items array, null items
- **HTTP Errors**: Rate limit (429), server error (500), not found (404)
- **Timeouts**: Request timeouts, slow responses
- **Partial Failures**: Incomplete JSON, wrong data structures, invalid candle structures
- **Retry Logic**: Transient failures, partial API responses

### 3. Data Integrity (20+ tests)
- **Invalid Candles**: Negative prices, zero prices, high < low, open/close outside range, negative volume, NaN values, Infinity values, extremely large numbers
- **Data Quality**: Duplicate timestamps, out-of-order timestamps, huge gaps (years), maximum candles (5000), over maximum (5001)
- **Pathological Sequences**: Flatlines (constant price, zero volume), extreme price spikes, near-zero prices, invalid timestamps, mixed valid/invalid
- **Validation**: Candle data validation before storing, deduplication, sorting

### 4. Storage Failures (7+ tests)
- **Connection Issues**: ClickHouse connection refused, query timeouts
- **Resource Issues**: Disk full, partial writes
- **Data Issues**: Schema mismatches, concurrent write conflicts
- **Recovery**: Data preservation on storage failure

### 5. Resource Exhaustion (4+ tests)
- **Concurrency**: Too many concurrent requests (1000 tokens)
- **Memory**: Very large responses (10MB), memory exhaustion (1M candles)
- **Cache**: Cache overflow (exceeds max size)
- **Performance**: Many small requests causing memory pressure

### 6. Concurrency (2+ tests)
- **Same Token**: Concurrent ingestion of same token (should deduplicate)
- **Race Conditions**: Token grouping with many calls, concurrent writes

### 7. Boundary Conditions (3+ tests)
- **Empty Results**: Zero candles returned
- **Single Candle**: One candle only
- **Maximum Candles**: Exactly 5000 candles (API limit)

### 8. Error Recovery (2+ tests)
- **Partial Failures**: Continue processing after token failure
- **Error Tracking**: All errors tracked in result with tokenId and error message

### 9. Performance Degradation (2+ tests)
- **Slow API**: Handle slow API responses (1 second delay)
- **Many Tokens**: Efficiently handle 100 tokens

### 10. Integration Stress (2+ tests)
- **Complete Failure**: Everything fails (database, token lookup, API, storage)
- **Mixed Success/Failure**: Some tokens succeed, some fail

## Test Structure

### Fixtures (`fixtures/pathological-ohlcv.ts`)

Comprehensive fixtures covering:
- **INVALID_MINTS**: 18+ invalid mint address variations
- **EXTREME_DATE_RANGES**: 7 extreme date range scenarios
- **PATHOLOGICAL_CANDLES**: 20+ pathological candle sequences with expected behavior
- **API_FAILURE_SCENARIOS**: 12+ API failure scenarios
- **CACHE_CORRUPTION_SCENARIOS**: 5+ cache corruption scenarios
- **STORAGE_FAILURE_SCENARIOS**: 6+ storage failure scenarios
- **RESOURCE_EXHAUSTION_SCENARIOS**: 4+ resource exhaustion scenarios

### Test File (`ohlcv-ingestion.stress.test.ts`)

Organized into 10 test suites:
1. Input Violence
2. API Failure Modes
3. Data Integrity
4. Storage Failures
5. Resource Exhaustion
6. Concurrency
7. Boundary Conditions
8. Error Recovery
9. Performance Degradation
10. Integration Stress

## Running the Tests

```bash
# Run all OHLCV ingestion stress tests
pnpm test packages/ingestion/tests/stress/ohlcv-ingestion.stress.test.ts

# Run with verbose output
pnpm test packages/ingestion/tests/stress/ohlcv-ingestion.stress.test.ts --reporter=verbose

# Run specific test suite
pnpm test packages/ingestion/tests/stress/ohlcv-ingestion.stress.test.ts -t "Input Violence"
```

## Expected Behavior

### What Should Pass
- Tests that validate the system handles edge cases gracefully
- Tests that ensure errors are tracked and reported
- Tests that verify data integrity is maintained

### What Should Fail (Initially)
- Tests that expose missing error handling
- Tests that reveal data corruption risks
- Tests that show undefined behavior
- Tests that demonstrate silent failures

### Improvement Strategy

When tests fail:
1. **Don't hack the test** - Fix the implementation
2. **Add proper error handling** - Fail loudly with structured errors
3. **Validate inputs** - Reject invalid data early
4. **Add data validation** - Ensure candle data integrity
5. **Improve error recovery** - Continue processing after failures
6. **Add monitoring** - Track all errors and failures

## Key Assertions

Every test asserts:
- **No crashes**: System must not throw unhandled exceptions
- **Structured errors**: Errors must have tokenId and error message
- **Data integrity**: Invalid data must be rejected or normalized
- **Error tracking**: All failures must be tracked in result.errors
- **Graceful degradation**: System must continue processing after failures
- **No silent failures**: All failures must be reported

## Test Metrics

- **Total Tests**: 80+ individual test cases
- **Test Categories**: 10 comprehensive suites
- **Fixtures**: 70+ pathological scenarios
- **Coverage**: All major failure modes and edge cases

## Next Steps

1. Run the test suite: `pnpm test packages/ingestion/tests/stress/ohlcv-ingestion.stress.test.ts`
2. Identify failing tests
3. Fix implementation issues (don't hack tests)
4. Re-run tests to verify fixes
5. Iterate until all tests pass or fail with structured errors

## Notes

- Tests use mocks for external dependencies (repositories, engines, storage)
- Tests are designed to be deterministic and repeatable
- Tests validate both success and failure paths
- Tests ensure error messages are actionable and structured

