# Date.now() Usage Policy

This document defines where `Date.now()` is allowed and forbidden in the QuantBot codebase.

## Principle

**All time access must be deterministic for testing.** This means business logic and workflows must use injected clock dependencies, not `Date.now()` directly.

## Where Date.now() is FORBIDDEN

### 1. Workflow Business Logic

**Location**: `packages/workflows/src/**/*.ts` (except composition roots)

**Rule**: Use `ctx.clock.nowISO()` or `ports.clock.nowMs()` instead.

**Example - ❌ WRONG**:

```typescript
export async function runWorkflow(spec: WorkflowSpec, ctx: WorkflowContext) {
  const timestamp = Date.now(); // ❌ FORBIDDEN
  // ...
}
```

**Example - ✅ CORRECT**:

```typescript
export async function runWorkflow(spec: WorkflowSpec, ctx: WorkflowContext) {
  const timestampISO = ctx.clock.nowISO(); // ✅ CORRECT
  // or if you need milliseconds:
  const timestampMs = new Date(ctx.clock.nowISO()).getTime(); // ✅ CORRECT
}
```

### 2. Simulation Code

**Location**: `packages/simulation/src/**/*.ts`

**Rule**: Use `SimulationClock` interface or injected clock from context.

**Enforcement**: ESLint rule `no-restricted-properties` with error level.

### 3. Adapters (with exceptions)

**Location**: `packages/workflows/src/**/adapters/**/*.ts`

**Rule**: Adapters should accept a `ClockPort` dependency and use `clock.nowMs()` instead of `Date.now()`.

**Exception**: Factory functions in composition roots (e.g., `createProductionPorts.ts`) may use `Date.now()` to create clock adapters.

**Example - ❌ WRONG**:

```typescript
export function createExecutionAdapter(config: Config): ExecutionPort {
  function checkTimeout() {
    if (Date.now() - lastCheck > timeout) { // ❌ FORBIDDEN
      // ...
    }
  }
}
```

**Example - ✅ CORRECT**:

```typescript
export function createExecutionAdapter(config: Config & { clock: ClockPort }): ExecutionPort {
  function checkTimeout() {
    if (config.clock.nowMs() - lastCheck > timeout) { // ✅ CORRECT
      // ...
    }
  }
}
```

## Where Date.now() is ALLOWED

### 1. Composition Roots

**Location**:

- `packages/workflows/src/**/context/create*.ts`
- `packages/cli/src/core/clock-adapter.ts`

**Rule**: These files create clock adapters and are the only place where `Date.now()` is allowed.

**Example - ✅ CORRECT**:

```typescript
// packages/workflows/src/context/createProductionPorts.ts
function createSystemClock(): ClockPort {
  return { nowMs: () => Date.now() }; // ✅ ALLOWED - creating clock adapter
}
```

### 2. Test Performance Measurements

**Location**: Test files (`**/*.test.ts`, `**/*.spec.ts`)

**Rule**: Tests may use `Date.now()` to measure test execution time, not for business logic.

**Example - ✅ CORRECT**:

```typescript
it('should complete within time limit', async () => {
  const startTime = Date.now(); // ✅ ALLOWED - measuring test performance
  await runWorkflow(spec, mockContext);
  const duration = Date.now() - startTime;
  expect(duration).toBeLessThan(1000);
});
```

### 3. Test Directory/File Names

**Location**: Test files

**Rule**: Tests may use `Date.now()` to generate unique test directory or file names.

**Example - ✅ CORRECT**:

```typescript
const testDir = join(tmpdir(), `test-${Date.now()}`); // ✅ ALLOWED - unique test directory
```

### 4. Infrastructure Layer (Storage)

**Status**: Currently allowed, but should be migrated to clock injection

**Location**: `packages/storage/src/**/*.ts`

**Rule**: Storage layer currently uses `Date.now()` for cache TTL checks. This is acceptable for now, but should be migrated to accept clock dependencies for better testability.

**Note**: This is a known technical debt. Future work should inject `ClockPort` into storage engine and cache classes.

## ESLint Enforcement

### Workflows Package

**Rule**: `no-restricted-properties` with error level

**Pattern**: Blocks `Date.now()` and `Math.random()` in:

- `packages/workflows/src/**/*.ts` (except `context/**` and `adapters/**`)
- `packages/workflows/src/**/adapters/**/*.ts` (except composition roots)

### Simulation Package

**Rule**: `no-restricted-properties` with error level

**Pattern**: Blocks `Date.now()` and `Math.random()` in:

- `packages/simulation/src/**/*.ts`

### Core Handlers

**Rule**: `no-restricted-properties` with error level

**Pattern**: Blocks `Date.now()` and `Math.random()` in:

- `packages/core/src/handlers/**/*.ts`

## Migration Guide

### Step 1: Identify Date.now() Usage

Use grep to find all usages:

```bash
grep -r "Date\.now()" packages/workflows/src
```

### Step 2: Determine Context

- **Business logic**: Must use `ctx.clock.nowISO()` or `ports.clock.nowMs()`
- **Adapter**: Must accept `ClockPort` in config and use `clock.nowMs()`
- **Composition root**: Keep `Date.now()` to create clock adapter

### Step 3: Update Code

**For workflows**:

```typescript
// Before
const timestamp = Date.now();

// After
const timestampISO = ctx.clock.nowISO();
// or if you need ms:
const timestampMs = new Date(ctx.clock.nowISO()).getTime();
```

**For adapters**:

```typescript
// Before
export function createAdapter(config: Config) {
  const now = Date.now();
}

// After
export function createAdapter(config: Config & { clock: ClockPort }) {
  const now = config.clock.nowMs();
}
```

### Step 4: Update Factory Calls

**In composition roots**:

```typescript
// Before
const adapter = createAdapter({ /* config */ });

// After
const clock = createSystemClock(); // Uses Date.now() here only
const adapter = createAdapter({ ...config, clock });
```

## Testing Considerations

### Mocking Clock in Tests

#### Basic Mock Clock

```typescript
const mockClock = {
  nowISO: () => '2024-01-01T00:00:00.000Z',
  nowMs: () => 1704067200000,
};

const mockContext = {
  clock: mockClock,
  // ... other context fields
};
```

#### Deterministic Clock with Fixed Time

```typescript
// For tests that need a fixed timestamp
const fixedTime = 1704067200000; // 2024-01-01T00:00:00.000Z
const fixedClock: ClockPort = {
  nowMs: () => fixedTime,
};

// For WorkflowContext (uses nowISO)
const fixedWorkflowClock = {
  nowISO: () => '2024-01-01T00:00:00.000Z',
};

const mockContext: WorkflowContext = {
  clock: fixedWorkflowClock,
  // ... other fields
};
```

#### Advancing Clock for Time-Dependent Tests

```typescript
// Clock that can be advanced for testing time-dependent logic
class TestClock implements ClockPort {
  private currentTime: number;

  constructor(initialTime: number = Date.now()) {
    this.currentTime = initialTime;
  }

  nowMs(): number {
    return this.currentTime;
  }

  advance(ms: number): void {
    this.currentTime += ms;
  }

  setTime(time: number): void {
    this.currentTime = time;
  }
}

// Usage in tests
const testClock = new TestClock(1704067200000);
const storageEngine = new StorageEngine({ clock: testClock });

// Test cache expiration
await storageEngine.storeCandles(/* ... */);
testClock.advance(61000); // Advance 61 seconds (past 60s TTL)
// Cache should be expired now
```

#### Mocking Clock for Storage Layer

```typescript
// StorageEngine with deterministic clock
const fixedTime = 1704067200000;
const clock: ClockPort = { nowMs: () => fixedTime };
const storageEngine = new StorageEngine({ clock });

// OHLCVService with deterministic clock
const ohlcvService = new OHLCVService(clock);

// OHLCVCache with deterministic clock
const ohlcvCache = new OHLCVCache(2000, clock);
```

#### Mocking Clock in Workflow Tests

```typescript
import { createMockContext } from '../helpers/mockContext.js';

// Mock context already includes a fixed clock
const ctx = createMockContext({
  strategy: mockStrategy,
  calls: mockCalls,
});

// Or create custom clock
const customClock = {
  nowISO: () => '2025-12-15T00:00:00.000Z',
};

const customCtx = {
  ...createMockContext(),
  clock: customClock,
};
```

### Deterministic Tests

By using injected clocks, tests can be deterministic:

- Same inputs → same outputs
- No flaky tests due to timing
- Can test time-dependent logic easily
- Cache TTL checks are predictable
- Time-based assertions are stable

## Related Documentation

- [Determinism Gates](./determinism-gates.md) - Requirements for deterministic simulations
- [Workflow Architecture](./WORKFLOW_ARCHITECTURE.md) - Workflow context and dependency injection
- [Testing Rules](../.cursor/rules/testing-workflows.mdc) - Testing best practices

## Questions?

If you're unsure whether `Date.now()` is allowed in a specific location:

1. Check this document
2. Check ESLint errors (they will catch violations)
3. Ask in code review

**Remember**: When in doubt, inject a clock dependency rather than using `Date.now()` directly.
