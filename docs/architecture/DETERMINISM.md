# Determinism Contract

**Status**: 📋 ARCHITECTURE DOCUMENTATION  
**Priority**: P0 (Critical Path)  
**Created**: 2025-01-23

## Overview

All simulations in QuantBot must be **deterministic and replayable**. This means:

- **Same inputs + same seed → byte-identical outputs**
- **Different seeds → different but deterministic outputs**
- **All randomness is seeded** (no `Math.random()` or `Date.now()`)

This contract ensures:
- **Reproducibility**: Can replay any simulation exactly
- **Debugging**: Same bug reproduces consistently
- **Testing**: Tests are deterministic and reliable
- **Experiments**: Can compare strategy variants fairly

## Core Principles

### 1. Seeded Randomness

**All randomness must use seeded RNG, never `Math.random()`**

```typescript
// ❌ WRONG: Non-deterministic
const value = Math.random();

// ✅ CORRECT: Deterministic
import { createDeterministicRNG } from '@quantbot/core';
const rng = createDeterministicRNG(seed);
const value = rng.next();
```

### 2. Clock Abstraction

**All time operations must use clock port, never `Date.now()`**

```typescript
// ❌ WRONG: Non-deterministic
const now = Date.now();

// ✅ CORRECT: Deterministic (via clock port)
const now = ctx.clock.nowMs();
```

### 3. Versioned Inputs

**All simulation inputs must include version fields**

```typescript
const input: SimInput = {
  run_id: 'run-123',
  // ... other fields ...
  contractVersion: '1.0.0',  // ✅ Required
  seed: 42,                  // ✅ Required for determinism
  dataVersion: '1.0.0',      // ✅ Optional but recommended
  strategyVersion: '1.0.0', // ✅ Optional but recommended
};
```

### 4. Seed Generation

**Seeds should be generated from run IDs or other deterministic inputs**

```typescript
import { SeedManager, defaultSeedManager } from '@quantbot/core';

// Generate seed from run ID
const seed = defaultSeedManager.generateFromRunId(runId);

// Generate seed from multiple inputs
const seed = defaultSeedManager.generateFromInputs(strategyId, dataHash);
```

## Determinism Contract Schema

All simulation inputs must conform to `DeterminismContractSchema`:

```typescript
{
  contractVersion: string;  // Version of simulation engine/contract
  seed?: number;            // Random seed (required for determinism)
  dataVersion?: string;     // Version of input data schema
  strategyVersion?: string; // Version of strategy definition
  inputHash?: string;       // Hash of inputs (for reproducibility checks)
}
```

## Implementation Requirements

### Simulation Engine

**All simulation functions must:**

1. Accept `seed` parameter (or generate from run ID)
2. Use `DeterministicRNG` for all randomness
3. Use clock port for all time operations
4. Return deterministic results

```typescript
export async function simulateStrategy(
  candles: readonly Candle[],
  strategy: StrategyLeg[],
  // ... config ...
  options?: SimulationOptions & { seed?: number }
): Promise<SimulationResult> {
  // Generate seed from run ID if not provided
  const seed = options?.seed ?? seedFromString(runId);
  const rng = createDeterministicRNG(seed);
  
  // Use rng for all randomness
  // Use clock port for all time operations
  // ...
}
```

### Execution Models

**All execution models must:**

1. Accept `DeterministicRNG` as parameter
2. Use RNG for all random sampling (latency, slippage, failures)
3. Never use `Math.random()` or `Date.now()`

```typescript
export function sampleLatency(
  model: LatencyModel,
  rng: DeterministicRNG  // ✅ Required parameter
): number {
  // Use rng.next() instead of Math.random()
  const u1 = rng.next();
  const u2 = rng.next();
  // ...
}
```

### Position Management

**Position operations must:**

1. Use deterministic ID generation (not `Date.now()`)
2. Use clock port for timestamps
3. Never use `Math.random()` for IDs

```typescript
// ❌ WRONG
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36)}`;
}

// ✅ CORRECT
function generateId(rng: DeterministicRNG, clock: ClockPort): string {
  return `${clock.nowMs()}-${rng.nextInt(0, 999999)}`;
}
```

## Seed Management

### SeedManager

The `SeedManager` class provides deterministic seed generation:

```typescript
import { SeedManager, defaultSeedManager } from '@quantbot/core';

// Generate seed from run ID
const seed = defaultSeedManager.generateFromRunId('run-123');

// Generate seed from strategy and data
const seed = defaultSeedManager.generateFromStrategyAndData(
  'strategy-1',
  'data-hash-abc'
);

// Generate seed from experiment metadata
const seed = defaultSeedManager.generateFromExperiment(
  'exp-1',
  'strategy-name',
  'snapshot-hash'
);
```

### Seed Propagation

**Seeds must be propagated through the call chain:**

1. **Workflow** generates seed from run ID
2. **Simulation** receives seed in options
3. **Execution models** receive RNG instance
4. **All random operations** use RNG

```typescript
// Workflow
const seed = seedManager.generateFromRunId(runId);
const result = await simulateStrategy(candles, strategy, config, {
  seed,
  executionModel,
});

// Simulation
const rng = createDeterministicRNG(seed);
const latency = sampleLatency(model, rng);

// Execution model
const rng = createDeterministicRNG(seed);
const slippage = sampleSlippage(model, rng);
```

## Versioning

### Contract Version

**`contractVersion`** identifies the simulation engine version:

- Changes when simulation logic changes
- Used to detect incompatible replays
- Format: `MAJOR.MINOR.PATCH` (semver)

### Data Version

**`dataVersion`** identifies the input data schema version:

- Changes when candle schema or format changes
- Used to detect data incompatibilities
- Format: `MAJOR.MINOR.PATCH` (semver)

### Strategy Version

**`strategyVersion`** identifies the strategy definition version:

- Changes when strategy schema changes
- Used to detect strategy incompatibilities
- Format: `MAJOR.MINOR.PATCH` (semver)

## Testing Requirements

### Determinism Tests

**All simulations must have determinism tests:**

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

### Property Tests

**Property tests verify determinism invariants:**

- Same seed → same sequence
- Different seeds → different sequences
- Seed generation is deterministic

## Migration Checklist

When refactoring code to be deterministic:

- [ ] Replace all `Math.random()` with `DeterministicRNG`
- [ ] Replace all `Date.now()` with clock port
- [ ] Add `seed` parameter to all simulation functions
- [ ] Propagate RNG through execution models
- [ ] Add version fields to all input schemas
- [ ] Add determinism tests
- [ ] Verify same inputs + seed → same outputs

## Enforcement

### ESLint Rules

ESLint blocks non-deterministic patterns:

- ❌ `Math.random()` in simulation code
- ❌ `Date.now()` in simulation code
- ✅ `DeterministicRNG` required for randomness
- ✅ Clock port required for time operations

### Architecture Tests

Architecture tests verify:

- No `Math.random()` in simulation package
- No `Date.now()` in simulation package
- All simulation functions accept seed parameter
- All execution models use RNG

## Related Documentation

- `packages/core/src/determinism.ts` - Determinism types and RNG implementation
- `packages/core/src/seed-manager.ts` - Seed generation utilities
- `packages/simulation/src/types/contracts.ts` - Simulation input/output schemas
- `packages/simulation/tests/unit/determinism.test.ts` - Determinism tests

## Success Criteria

- ✅ All simulations accept seed parameter
- ✅ Same inputs + seed → byte-identical outputs
- ✅ Determinism tests pass
- ✅ No `Math.random()` or `Date.now()` in simulation code
- ✅ All execution models use `DeterministicRNG`
- ✅ Documentation complete
