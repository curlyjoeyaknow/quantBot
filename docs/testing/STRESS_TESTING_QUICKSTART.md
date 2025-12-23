# Stress Testing Quick Start

## TL;DR

```bash
# Run all stress tests
pnpm test:stress

# Run specific category
pnpm test packages/ingestion/tests/stress/input-violence
pnpm test packages/utils/tests/stress/contract-brutality
pnpm test packages/storage/tests/stress/storage-discipline
```

## What Are Stress Tests?

Stress tests validate that the system handles adversarial conditions gracefully. They answer: **"Does the system lie, or fail loudly?"**

Every stress test ensures the system either:
1. Produces correct output, or
2. Fails with a structured, actionable error

**Silent failures and data corruption are unacceptable.**

## 6 Test Categories

| Category | Location | What It Tests |
|----------|----------|---------------|
| **Input Violence** | `packages/ingestion/tests/stress/input-violence/` | Address extraction with malicious inputs |
| **Contract Brutality** | `packages/utils/tests/stress/contract-brutality/` | Python bridge failure modes |
| **Storage Discipline** | `packages/storage/tests/stress/storage-discipline/` | DuckDB/ClickHouse idempotency |
| **Pipeline Invariants** | `packages/ingestion/tests/stress/pipeline-invariants/` | Run manifest completeness |
| **Simulation Stress** | `packages/simulation/tests/stress/simulation-stress/` | Pathological candle sequences |
| **Chaos Engineering** | `packages/utils/tests/stress/chaos/` | Subprocess failures, resource exhaustion |

## Top 12 High-Leverage Tests

If you're short on time, these provide maximum ROI:

1. ✅ Python tool returns non-JSON → bridge fails cleanly
2. ✅ Python tool returns JSON wrong schema → Zod rejects
3. ✅ Python tool timeout → killed + structured error
4. ✅ Tool writes logs to stdout → treated as invalid
5. ✅ Telegram extraction handles punctuation + zero-width spaces
6. ✅ EVM mixed-case invalid checksum rejected
7. ✅ Solana forbidden base58 chars rejected
8. ✅ Rejections table always written with reason
9. ✅ DuckDB lock contention handled
10. ✅ ClickHouse partial ingest is idempotent
11. ✅ Simulation: timestamps out of order rejected
12. ✅ Simulation: stop+target same candle follows defined order

## Common Commands

```bash
# Run all stress tests
pnpm test:stress

# Run with verbose output
pnpm test:stress --reporter=verbose

# Run specific test file
pnpm vitest packages/ingestion/tests/stress/input-violence/address-extraction.stress.test.ts

# Run specific test by name
pnpm vitest -t "should handle punctuation-wrapped addresses"

# Run in watch mode (for development)
pnpm vitest --watch packages/ingestion/tests/stress/input-violence
```

## When to Run Stress Tests

### Always
- Before major releases
- After refactoring critical paths
- When adding new validation logic

### Optional
- During development (use watch mode)
- In CI/CD (add to pre-release checks)
- When debugging edge cases

### Not Required
- Every commit (too slow)
- For trivial changes (docs, comments)

## Adding a New Stress Test

1. **Choose category**: Input violence, contract brutality, etc.
2. **Create test file**: `*.stress.test.ts` in appropriate directory
3. **Use fixtures**: Import from `fixtures/` directory
4. **Follow pattern**:

```typescript
import { describe, it, expect } from 'vitest';
import { EDGE_CASES } from '../fixtures/edge-cases.js';

describe('Feature Stress Tests', () => {
  EDGE_CASES.forEach((testCase) => {
    it(testCase.description, async () => {
      const result = await systemUnderTest(testCase.input);

      if (testCase.expectedValid) {
        expect(result.success).toBe(true);
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toBe(testCase.expectedError);
      }
    });
  });
});
```

5. **Run it**: `pnpm vitest path/to/your.stress.test.ts`

## Debugging Failed Tests

```bash
# Run with verbose output
pnpm test:stress --reporter=verbose

# Run single test
pnpm vitest -t "specific test name"

# Add console.log in test
it('should handle edge case', () => {
  console.log('Input:', input);
  console.log('Result:', result);
  // ...
});
```

## Key Files

- **Config**: `vitest.stress.config.ts`
- **Guide**: `docs/STRESS_TESTING.md`
- **Summary**: `docs/STRESS_TESTING_SUMMARY.md`
- **Fixtures**: `packages/*/tests/stress/fixtures/`

## Philosophy

> "If you can't explain why something is missing, your system is lying to you."

Stress tests enforce this by:
- Requiring rejections table with reasons
- Validating error messages are actionable
- Testing idempotency and determinism
- Simulating real-world failures

## Examples

### Input Violence
```typescript
// Test: Address with zero-width space
const input = '\u200BSo11111111111111111111111111111111111111112';
const result = extractAddress(input);
expect(result.valid[0].address).not.toMatch(/\u200B/); // Stripped
```

### Contract Brutality
```typescript
// Test: Python tool returns non-JSON
vi.mocked(execSync).mockReturnValue(Buffer.from('Not JSON'));
await expect(engine.runScript('/script.py', {}, schema))
  .rejects.toThrow(ValidationError);
```

### Storage Discipline
```typescript
// Test: Idempotency
await storage.storeStrategy('test', data);
await storage.storeStrategy('test', data); // Should not duplicate
```

### Simulation Stress
```typescript
// Test: Out-of-order timestamps
const outOfOrder = [
  { timestamp: 100, ... },
  { timestamp: 50, ... }, // Out of order
];
await expect(engine.runSimulation(outOfOrder))
  .rejects.toThrow('non_monotonic_timestamps');
```

## FAQ

**Q: Do stress tests contribute to coverage?**
A: No, coverage is disabled for stress tests.

**Q: How long do stress tests take?**
A: ~30 seconds for all tests (configurable timeout).

**Q: Should I run stress tests on every commit?**
A: No, they're optional but recommended before releases.

**Q: Can I run stress tests in watch mode?**
A: Yes: `pnpm vitest --watch packages/*/tests/stress`

**Q: What if a stress test fails?**
A: Either fix the bug or update the test if behavior changed intentionally.

## Next Steps

1. Read full guide: `docs/STRESS_TESTING.md`
2. Run tests: `pnpm test:stress`
3. Add new tests: Follow patterns in existing tests
4. Integrate with CI/CD: Add to pre-release checks

## Resources

- [Full Guide](./STRESS_TESTING.md)
- [Implementation Summary](./STRESS_TESTING_SUMMARY.md)
- [Testing Rules](../.cursor/rules/testing.mdc)
- [Changelog](../CHANGELOG.md)

