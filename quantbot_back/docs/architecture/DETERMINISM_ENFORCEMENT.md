# Determinism Enforcement

**Status**: ✅ ENFORCED  
**Priority**: P0 (Critical Path)  
**Created**: 2025-01-25

## Overview

QuantBot enforces deterministic simulation through ESLint rules and architectural patterns. This document describes the enforcement mechanisms and migration guide.

## Enforcement Rules

### ESLint Rules

ESLint automatically blocks non-deterministic patterns in simulation and workflow code:

#### Simulation Package (`packages/simulation/src/**/*.ts`)

- ❌ `Date.now()` - Use `SimulationClock` or injected clock
- ❌ `Math.random()` - Use `DeterministicRNG` from `@quantbot/core`
- ❌ `new Date()` - Use clock abstraction

**Exceptions** (temporary, should be refactored):
- `packages/simulation/src/utils/progress.ts` - UI progress indicator (not simulation logic)
- `packages/simulation/src/performance/result-cache.ts` - Cache TTL checks (not simulation logic)

#### Workflows Package (`packages/workflows/src/**/*.ts`)

- ❌ `Date.now()` - Use `ctx.clock.nowISO()` or `SimulationClock`
- ❌ `Math.random()` - Use `DeterministicRNG` from `@quantbot/core`

**Exceptions**:
- Context/adapters directories (composition roots allowed to use `Date.now()`)

### Architecture Patterns

#### 1. Global Clock Authority

**Pattern**: All time operations go through a clock abstraction.

```typescript
// ❌ WRONG: Direct wall-clock access
const now = Date.now();

// ✅ CORRECT: Use SimulationClock
import { createClock } from '@quantbot/simulation';
const clock = createClock('m', candles[0].timestamp);
const now = clock.getCurrentTime();

// ✅ CORRECT: Use WorkflowContext clock
const now = ctx.clock.nowISO();
```

**Simulation Clock Interface**:
```typescript
interface SimulationClock {
  getCurrentTime(): number;
  advance(): void;
  fromMilliseconds(ms: number): number;
  toMilliseconds(units: number): number;
  getResolution(): ClockResolution;
}
```

#### 2. Deterministic Randomness

**Pattern**: All randomness uses seeded RNG.

```typescript
// ❌ WRONG: Non-deterministic
const value = Math.random();

// ✅ CORRECT: Deterministic RNG
import { createDeterministicRNG, seedFromString } from '@quantbot/core';
const seed = seedFromString(runId);
const rng = createDeterministicRNG(seed);
const value = rng.next();
```

**RNG Interface**:
```typescript
interface DeterministicRNG {
  next(): number; // [0, 1)
  nextInt(min: number, max: number): number;
  nextFloat(min: number, max: number): number;
  getSeed(): number;
  clone(): DeterministicRNG;
}
```

#### 3. ID Generation

**Pattern**: IDs are deterministic from run context.

```typescript
// ❌ WRONG: Non-deterministic IDs
const id = `${Date.now()}-${Math.random().toString(36)}`;

// ✅ CORRECT: Deterministic IDs
function generateId(runId: string, sequence: number): string {
  return `${runId}-pos-${sequence}`;
}

// ✅ CORRECT: Fallback with RNG
function generateId(runId?: string, timestamp?: number, rng?: DeterministicRNG): string {
  if (runId && timestamp) return `${runId}-${timestamp}`;
  if (timestamp && rng) {
    const rngValue = rng.nextInt(0, 999999);
    return `${timestamp}-${rngValue}`;
  }
  throw new Error('Cannot generate deterministic ID');
}
```

## Migration Guide

### Step 1: Identify Violations

Run ESLint to find violations:

```bash
pnpm lint
```

Or search for patterns:

```bash
# Find Date.now() usage
grep -r "Date\.now()" packages/simulation/src packages/workflows/src

# Find Math.random() usage
grep -r "Math\.random()" packages/simulation/src packages/workflows/src
```

### Step 2: Replace Date.now()

**In Simulation Code**:
```typescript
// Before
const timestamp = Date.now();

// After
import { createClock } from '@quantbot/simulation';
const clock = createClock('m', candles[0].timestamp);
const timestamp = clock.getCurrentTime();
```

**In Workflow Code**:
```typescript
// Before
const now = Date.now();

// After
const now = ctx.clock.nowISO();
```

### Step 3: Replace Math.random()

```typescript
// Before
const value = Math.random();
const int = Math.floor(Math.random() * 100);

// After
import { createDeterministicRNG, seedFromString } from '@quantbot/core';
const seed = seedFromString(runId);
const rng = createDeterministicRNG(seed);
const value = rng.next();
const int = rng.nextInt(0, 99);
```

### Step 4: Update Function Signatures

Add RNG/clock parameters to functions that need randomness or time:

```typescript
// Before
export function createPosition(params: CreatePositionParams): Position {
  const id = `${Date.now()}-${Math.random()}`;
  // ...
}

// After
export interface CreatePositionParams {
  // ... existing fields ...
  rng?: DeterministicRNG; // Optional for backward compatibility
}

export function createPosition(params: CreatePositionParams): Position {
  const id = generateId(params.runId, params.positionSequence, params.timestamp, params.rng);
  // ...
}
```

### Step 5: Propagate RNG/Clock Through Call Chain

```typescript
// Workflow generates seed
const seed = seedFromString(runId);
const rng = createDeterministicRNG(seed);

// Pass to simulation
const result = await simulateStrategy(candles, strategy, config, {
  seed,
  clockResolution: 'm',
});

// Simulation creates clock and RNG
const clock = createClock(options.clockResolution, candles[0].timestamp);
const rng = createDeterministicRNG(options.seed ?? seedFromString('default'));

// Pass to position creation
const position = createPosition({
  // ... other params ...
  rng,
});
```

## Look-Ahead Prevention

### Future-Scramble Test

Test that simulation doesn't access future candle data:

```typescript
describe('look-ahead prevention', () => {
  it('does not access future candles', () => {
    const candles = generateCandles(100);
    const scrambled = [...candles].reverse(); // Reverse order
    
    const result1 = simulateStrategy(candles, strategy);
    const result2 = simulateStrategy(scrambled, strategy);
    
    // Results should be different (not using future data incorrectly)
    expect(result1).not.toEqual(result2);
  });
});
```

### Causal Access Assertion

Verify that each candle only uses previous candles:

```typescript
it('only uses past candles for decisions', () => {
  const candles = generateCandles(100);
  let maxCandleIndex = -1;
  
  // Mock indicator calculation to track access
  const originalCalculate = calculateIndicators;
  calculateIndicators = (candles, index) => {
    expect(index).toBeGreaterThan(maxCandleIndex);
    maxCandleIndex = index;
    return originalCalculate(candles, index);
  };
  
  simulateStrategy(candles, strategy);
});
```

## Testing Requirements

### Determinism Tests

Every simulation function must have determinism tests:

```typescript
describe('determinism', () => {
  it('same inputs + same seed → same outputs', () => {
    const seed = 42;
    const result1 = simulateStrategy(candles, strategy, config, { seed });
    const result2 = simulateStrategy(candles, strategy, config, { seed });
    
    expect(result1).toEqual(result2); // Byte-identical
  });
  
  it('different seeds → different but deterministic outputs', () => {
    const result1 = simulateStrategy(candles, strategy, config, { seed: 42 });
    const result2 = simulateStrategy(candles, strategy, config, { seed: 43 });
    
    expect(result1).not.toEqual(result2); // Different
    
    // But both are deterministic
    const result1Again = simulateStrategy(candles, strategy, config, { seed: 42 });
    expect(result1Again).toEqual(result1); // Same seed → same result
  });
});
```

## Exceptions and Temporary Allowances

### Progress Indicators

`packages/simulation/src/utils/progress.ts` uses `Date.now()` for UI progress tracking. This is acceptable because:
- Not part of simulation logic
- Only affects console output
- Should be refactored to use clock abstraction eventually

### Result Cache

`packages/simulation/src/performance/result-cache.ts` uses `Date.now()` for TTL checks. This is acceptable because:
- Not part of simulation logic
- Only affects caching behavior
- Should be refactored to use clock abstraction eventually

### Composition Roots

Context/adapters directories are allowed to use `Date.now()` because they are composition roots that wire real dependencies.

## Enforcement Checklist

When adding new simulation code:

- [ ] No `Date.now()` or `new Date()` in simulation logic
- [ ] No `Math.random()` in simulation logic
- [ ] All time operations use `SimulationClock` or injected clock
- [ ] All randomness uses `DeterministicRNG`
- [ ] IDs are deterministic from run context
- [ ] Determinism tests pass
- [ ] ESLint passes without violations

## Related Documentation

- `docs/architecture/DETERMINISM.md` - Determinism contract and principles
- `packages/core/src/determinism.ts` - DeterministicRNG implementation
- `packages/simulation/src/core/clock.ts` - SimulationClock implementation
- `eslint.config.mjs` - ESLint rules configuration

## Success Criteria

- ✅ ESLint blocks `Date.now()` and `Math.random()` in simulation/workflows
- ✅ All simulation code uses clock abstraction
- ✅ All simulation code uses deterministic RNG
- ✅ Determinism tests pass
- ✅ Same inputs + seed → same outputs (byte-identical)

