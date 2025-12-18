# Stress Testing Suite

This directory contains stress tests that validate system behavior under adversarial conditions.

## Philosophy

**Tests answer: "Does the system lie, or fail loudly?"**

Every test validates that the system either:
1. Produces correct output, or
2. Fails with a structured, actionable error

Silent failures and data corruption are unacceptable.

## Test Categories

### 1. Input Violence (`input-violence/`)
Tests extraction and validation against malicious/malformed inputs.

- Punctuation-wrapped addresses
- Invisible characters (zero-width spaces, non-breaking spaces)
- Unicode lookalikes
- Line breaks mid-address
- Markdown/code blocks
- URLs containing base58-ish strings
- Multiple/repeated candidates
- Ticker-like noise ($SOL, SOL/USDT)
- Obfuscation attempts

### 2. Contract Brutality (`contract-brutality/`)
Tests Python bridge failure modes.

- Malformed JSON outputs
- Wrong schemas
- Missing required fields
- Process failures (exit codes, timeouts, hangs)
- Stderr contamination
- Huge outputs
- Determinism violations

### 3. Storage Discipline (`storage-discipline/`)
Tests database boundary conditions.

- Partial write failures
- Concurrent access
- Schema mismatches
- Idempotency violations
- Time zone issues

### 4. Pipeline Invariants (`pipeline-invariants/`)
Tests system-wide guarantees.

- Run manifest completeness
- Data deduplication keys
- Rejection tracking
- Audit trail completeness

### 5. Simulation Stress (`simulation-stress/`)
Tests simulation engine edge cases.

- Nasty candle sequences (flatlines, spikes, gaps)
- Order-of-events ambiguity
- Numerical stability
- Tiny datasets

### 6. OHLCV Ingestion Stress (`ohlcv-ingestion.stress.test.ts`)
Comprehensive stress tests for OHLCV ingestion pipeline.

- **Input Violence**: Invalid mint addresses, extreme date ranges, malformed call data
- **API Failure Modes**: Rate limiting, timeouts, malformed responses, partial failures
- **Data Integrity**: Invalid candles (NaN, negative prices, high < low), duplicates, out-of-order
- **Storage Failures**: ClickHouse connection failures, partial writes, concurrent conflicts
- **Resource Exhaustion**: Too many concurrent requests, huge datasets, memory pressure
- **Concurrency**: Race conditions, concurrent ingestion of same token, token grouping
- **Boundary Conditions**: Empty results, single candle, maximum candles (5000)
- **Error Recovery**: Partial failures, error tracking, continuation after failures
- **Performance Degradation**: Slow API responses, many tokens, large time ranges
- **Integration Stress**: Complete failure scenarios, mixed success/failure

### 7. Chaos Engineering (`chaos/`)
Meta-tests that simulate real-world failures.

- Random subprocess kills
- Artifact corruption
- Disk full scenarios
- Network failures

## Running Tests

```bash
# Run all stress tests
pnpm test:stress

# Run specific category
pnpm test packages/ingestion/tests/stress/input-violence

# Run with verbose output
pnpm test:stress --reporter=verbose
```

## Adding New Tests

1. Choose appropriate category
2. Create test file with descriptive name
3. Use fixtures from `fixtures/` directory
4. Follow pattern: setup → execute → assert (correct or structured error)
5. Document expected behavior in test description

## Fixtures

Shared test fixtures are in `fixtures/`:
- `malicious-addresses.ts` - Address extraction edge cases
- `malformed-json.ts` - Invalid Python outputs
- `pathological-ohlcv.ts` - OHLCV ingestion edge cases (invalid mints, extreme dates, pathological candles, API failures, cache corruption, storage failures, resource exhaustion)
- `nasty-candles.ts` - Pathological candle sequences
- `corrupt-artifacts.ts` - Damaged files for chaos tests

