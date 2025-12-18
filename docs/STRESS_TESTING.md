# Stress Testing Guide

## Overview

The stress testing suite validates that QuantBot handles adversarial conditions gracefully. These tests answer the critical question: **"Does the system lie, or fail loudly?"**

## Philosophy

Every stress test validates that the system either:
1. Produces correct output, or
2. Fails with a structured, actionable error

**Silent failures and data corruption are unacceptable.**

## Test Categories

### 1. Input Violence

**Location**: `packages/ingestion/tests/stress/input-violence/`

Tests that extraction and validation handle malicious/malformed inputs:

- Punctuation-wrapped addresses: `(So11...112)`, `mint,`, `mint.`
- Invisible characters: zero-width spaces, non-breaking spaces
- Line breaks mid-address
- Markdown/code blocks
- URLs containing base58-ish strings
- Multiple/repeated candidates
- Ticker-like noise: `$SOL`, `SOL/USDT`
- Obfuscation attempts
- Solana forbidden chars: `0`, `O`, `I`, `l`
- EVM checksum validation
- Zero address handling

**Goal**: Extraction must produce rejections table with reasons, not silently drop candidates.

### 2. Contract Brutality

**Location**: `packages/utils/tests/stress/contract-brutality/`

Tests Python bridge failure modes:

- Malformed JSON outputs (not JSON, partial, invalid syntax)
- Wrong schemas (type mismatches, arrays instead of objects)
- Missing required fields
- Process failures (nonzero exit, stderr, timeouts, hangs)
- Stdout contamination (logs mixed with data)
- Huge outputs (exceeding maxBuffer)
- Determinism violations

**Goal**: Handler/executor should produce structured errors and never corrupt state.

### 3. Storage Discipline

**Location**: `packages/storage/tests/stress/storage-discipline/`

Tests database boundary conditions:

#### DuckDB
- Write failures (disk full, permissions)
- Concurrent access (lock contention)
- Schema migration mismatches
- Idempotency (same input → same result)
- Artifact integrity (DuckDB + parquet consistency)

#### ClickHouse
- Network failures (unavailable, timeout)
- Partial insert failures
- Duplicate prevention (unique keys)
- Time zone handling (UTC consistency)
- Batch operations (large datasets)
- Concurrent inserts

**Goal**: Idempotency + clear "what state changed" reporting.

### 4. Pipeline Invariants

**Location**: `packages/ingestion/tests/stress/pipeline-invariants/`

Tests system-wide guarantees:

- Run manifest completeness (run_id, input_hash, tool_version, git_commit, artifacts)
- Stable input hashing (same input → same hash)
- Artifact tracking (all paths recorded)
- Run reuse detection (same input + options → reuse)
- Status tracking (pending → running → completed/failed)
- Audit trail (complete history queryable)

**Goal**: You can always explain why something is missing.

### 5. Simulation Stress

**Location**: `packages/simulation/tests/stress/simulation-stress/`

Tests simulation engine edge cases:

- Flatline sequences (constant price, zero volume)
- Spike sequences (extreme outliers, near-zero prices)
- Gap sequences (missing candles)
- Duplicate timestamps
- Out-of-order timestamps
- Invalid data (negative prices, zero prices, high < low)
- Tiny datasets (insufficient for indicators)
- Order-of-events ambiguity (stop + target same candle)
- Numerical stability (very small/large prices, rounding)

**Goal**: Define semantics and enforce them deterministically.

### 6. Chaos Engineering

**Location**: `packages/utils/tests/stress/chaos/`

Meta-tests that simulate real-world failures:

- Random subprocess kills (SIGKILL, SIGTERM)
- Artifact corruption (corrupted files, missing files)
- Disk full scenarios (read-only directories)
- File deletion during execution
- Environment chaos (missing PYTHONPATH, bad Python)
- Concurrent chaos (parallel subprocess calls, file writes)
- Resource exhaustion (large outputs, many calls)

**Goal**: System should detect failures and provide clear errors.

## Running Stress Tests

### Run All Stress Tests

```bash
pnpm test:stress
```

### Run Specific Category

```bash
pnpm test packages/ingestion/tests/stress/input-violence
pnpm test packages/utils/tests/stress/contract-brutality
pnpm test packages/storage/tests/stress/storage-discipline
pnpm test packages/ingestion/tests/stress/pipeline-invariants
pnpm test packages/simulation/tests/stress/simulation-stress
pnpm test packages/utils/tests/stress/chaos
```

### Run with Verbose Output

```bash
pnpm test:stress --reporter=verbose
```

### Run Specific Test File

```bash
pnpm vitest packages/ingestion/tests/stress/input-violence/address-extraction.stress.test.ts
```

## High-Leverage Tests (Top 12)

If you're short on time, implement these first for maximum ROI:

1. **Python tool returns non-JSON** → bridge fails cleanly
2. **Python tool returns JSON wrong schema** → Zod rejects
3. **Python tool timeout** → killed + structured error
4. **Tool writes logs to stdout** → treated as invalid (force stderr for logs)
5. **Telegram extraction handles punctuation + zero-width spaces**
6. **EVM mixed-case invalid checksum rejected**
7. **Solana forbidden base58 chars rejected**
8. **Rejections table always written with reason**
9. **DuckDB lock contention handled** (retry or fail-fast)
10. **ClickHouse partial ingest is idempotent on rerun**
11. **Simulation: timestamps out of order rejected or sorted deterministically**
12. **Simulation: stop+target same candle follows defined order rule**

## Test Structure

Each stress test follows this pattern:

```typescript
describe('Feature Stress Tests', () => {
  describe('Edge case category', () => {
    it('should handle specific edge case', async () => {
      // Setup: Create adversarial input
      const maliciousInput = '...';

      // Execute: Run system under test
      const result = await systemUnderTest(maliciousInput);

      // Assert: Either correct or structured error
      if (result.success) {
        expect(result.data).toBeDefined();
      } else {
        expect(result.error).toBeDefined();
        expect(result.error.length).toBeGreaterThan(0);
      }
    });
  });
});
```

## Fixtures

Shared test fixtures are in `tests/stress/fixtures/`:

- `malicious-addresses.ts` - Address extraction edge cases
- `malformed-json.ts` - Invalid Python outputs
- `nasty-candles.ts` - Pathological candle sequences

## Configuration

Stress tests use a dedicated Vitest config (`vitest.stress.config.ts`):

- **Timeout**: 30 seconds (stress tests may be slower)
- **Isolation**: Each test runs in isolation
- **Threads**: Up to 4 threads
- **Coverage**: Disabled (stress tests don't contribute to coverage)
- **Reporter**: Verbose (detailed output)

## Adding New Stress Tests

1. **Choose category**: Input violence, contract brutality, storage discipline, etc.
2. **Create test file**: `*.stress.test.ts` in appropriate directory
3. **Use fixtures**: Import from `fixtures/` directory
4. **Follow pattern**: Setup → Execute → Assert (correct or structured error)
5. **Document expected behavior**: Clear test descriptions
6. **Update this guide**: Add new test to relevant section

## Integration with CI/CD

Stress tests are **optional but recommended** before releases:

```bash
# Pre-release checklist
pnpm test:unit
pnpm test:integration
pnpm test:properties
pnpm test:stress  # Optional but recommended
```

## Debugging Failed Stress Tests

When a stress test fails:

1. **Read the error message**: Stress tests provide detailed context
2. **Check the fixture**: Verify input is as expected
3. **Run with verbose output**: `pnpm test:stress --reporter=verbose`
4. **Isolate the test**: Run single test file
5. **Add logging**: Use `console.log` or debugger
6. **Check system state**: Verify no side effects from previous tests

## Best Practices

1. **Keep tests tiny**: Each test should answer one question
2. **Use descriptive names**: Test name should explain what's being tested
3. **Provide context in errors**: Include input, expected, actual
4. **Don't mock too much**: Stress tests should test real behavior
5. **Test both success and failure**: Verify correct handling of both
6. **Document assumptions**: Explain why test expects certain behavior
7. **Keep fixtures realistic**: Use real-world adversarial inputs

## References

- [Keep a Changelog](https://keepachangelog.com)
- [Property-Based Testing](https://hypothesis.works)
- [Chaos Engineering Principles](https://principlesofchaos.org)
- [QuantBot Testing Rules](.cursor/rules/testing.mdc)

