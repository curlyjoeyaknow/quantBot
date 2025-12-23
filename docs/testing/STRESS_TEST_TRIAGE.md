# Stress Test Triage Guide

## Quick Start

```bash
# Run the debug script to see failure patterns
./scripts/debug-stress.sh

# Run offline stress tests only (default)
pnpm test:stress

# Run with database tests
pnpm test:stress:db

# Run with chaos tests
pnpm test:stress:chaos

# Run everything
pnpm test:stress:all
```

## Understanding Test Failures

When you see 58 failures in < 1 second, they usually cluster into 2-3 root causes:

### 1. Missing Environment Dependencies (Most Common)

**Symptoms:**
- `ECONNREFUSED` (database connection refused)
- `ENOENT` (file not found)
- `env var undefined`

**Fix:**
Tests requiring external services are now gated behind environment variables:
- `RUN_DB_STRESS=1` - ClickHouse, DuckDB, Postgres tests
- `RUN_CHAOS_TESTS=1` - Subprocess chaos tests
- `RUN_INTEGRATION_STRESS=1` - Full integration tests

**By default, stress tests run offline** (no external services required).

### 2. Fixture Path Issues

**Symptoms:**
- `Cannot find module '../fixtures/...'`
- `ENOENT: no such file or directory`

**Fix:**
- Check that fixture files exist in `packages/*/tests/stress/fixtures/`
- Verify import paths use relative paths or `import.meta.url`
- Ensure `vitest.stress.config.ts` includes correct test patterns

### 3. Mock vs Real Implementation Mismatch

**Symptoms:**
- `expected function to have been called` but service is undefined
- Zod parse errors (schema mismatch)
- `TypeError: Cannot read property 'X' of undefined`

**Fix:**
- Stress tests use mocks for foundation testing
- If test requires real implementation, it should be gated or moved to integration tests
- Check that mocks match expected interfaces

## Triage Process

### Step 1: Run Debug Script

```bash
./scripts/debug-stress.sh
```

This will:
1. Show all failures with verbose output
2. Re-run serially (removes concurrency noise)
3. Print vitest config

### Step 2: Categorize Failures

Look for patterns in the first 10-20 failure messages:

```bash
# Count failure types
pnpm test:stress 2>&1 | grep -E "ECONNREFUSED|ENOENT|Cannot find|TypeError" | sort | uniq -c
```

Common buckets:
- **DB connection errors** → Gate behind `RUN_DB_STRESS=1`
- **File not found** → Fix fixture paths
- **Type errors** → Fix mock implementations
- **Schema errors** → Fix Zod schemas

### Step 3: Fix the Biggest Bucket First

Don't bounce around. Fix the category with the most failures first.

**Example:**
- 40 failures are `ECONNREFUSED` → Gate DB tests
- 15 failures are `ENOENT` → Fix fixture paths
- 3 failures are type errors → Fix mocks

Fix the 40 first, then the 15, then the 3.

## Test Gating Pattern

Tests that require external services use the gating pattern:

```typescript
import { shouldRunDbStress, TEST_GATES } from '@quantbot/utils/src/test-helpers/test-gating';

describe.skipIf(!shouldRunDbStress())(
  'Database Stress Tests',
  () => {
    // ... tests ...
  },
  `DB stress tests require ${TEST_GATES.DB_STRESS}=1`
);
```

Available gates:
- `shouldRunDbStress()` - Database tests
- `shouldRunChaosTests()` - Chaos engineering tests
- `shouldRunIntegrationStress()` - Integration tests

## Target State

After cleanup, you want:

✅ `pnpm test:stress` passes offline (bridge + extraction + invariants + simulation edge cases)

✅ `RUN_DB_STRESS=1 pnpm test:stress` enables DB idempotency tests

✅ `RUN_CHAOS_TESTS=1 pnpm test:stress` enables chaos/subprocess-kill tests

✅ `RUN_INTEGRATION_STRESS=1 pnpm test:stress` enables full integration tests

## Common Fixes

### Fix 1: Gate DB Tests

**Before:**
```typescript
describe('ClickHouse Tests', () => {
  it('should connect', async () => {
    const client = new ClickHouseClient(); // ❌ Fails if DB not running
  });
});
```

**After:**
```typescript
import { shouldRunDbStress, TEST_GATES } from '@quantbot/utils/src/test-helpers/test-gating';

describe.skipIf(!shouldRunDbStress())(
  'ClickHouse Tests',
  () => {
    it('should connect', async () => {
      const client = new ClickHouseClient(); // ✅ Only runs if RUN_DB_STRESS=1
    });
  },
  `DB stress tests require ${TEST_GATES.DB_STRESS}=1`
);
```

### Fix 2: Fix Fixture Paths

**Before:**
```typescript
import { FIXTURES } from '../fixtures/data'; // ❌ Wrong path
```

**After:**
```typescript
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesPath = join(__dirname, '../fixtures/data.ts');

// Or use relative import
import { FIXTURES } from '../fixtures/data.js'; // ✅ Correct extension
```

### Fix 3: Fix Mock Interfaces

**Before:**
```typescript
const mockService = {
  doSomething: vi.fn(),
  // Missing required method
};
```

**After:**
```typescript
const mockService = {
  doSomething: vi.fn(),
  doSomethingElse: vi.fn(), // ✅ Match actual interface
} as unknown as RealService;
```

## Next Steps

1. Run `./scripts/debug-stress.sh`
2. Identify top 3 failure patterns
3. Fix the biggest bucket first
4. Re-run and verify failures decrease
5. Repeat until all tests pass (or are properly gated)

## See Also

- `docs/STRESS_TESTING.md` - Full stress testing guide
- `docs/STRESS_TESTING_QUICKSTART.md` - Quick reference
- `vitest.stress.config.ts` - Stress test configuration

