# Determinism Contract

**Status**: 📋 ARCHITECTURE  
**Created**: 2025-01-23  
**Related**: `packages/core/src/determinism.ts`, Phase I Task 1.2

## Overview

All simulations in the Quant Research Lab must be **deterministic and replayable**. This means:

1. **Seeded Randomness**: Same seed + same inputs → same outputs
2. **Versioned Inputs**: All inputs include version fields
3. **Replayable**: Can re-run any experiment byte-for-byte

## Core Principle

> If you can't re-run an experiment byte-for-byte, it doesn't exist.

## Deterministic Contract

Every simulation input must satisfy the `DeterminismContract`:

```typescript
{
  contractVersion: string;  // Version of simulation engine/contract
  seed?: number;            // Random seed for deterministic execution
  dataVersion?: string;     // Version of input data schema
  strategyVersion?: string; // Version of strategy definition
  inputHash?: string;       // Hash of inputs for reproducibility checks
}
```

## Random Number Generation

### Never Use `Math.random()`

❌ **Forbidden:**
```typescript
const randomValue = Math.random();
```

✅ **Required:**
```typescript
import { createDeterministicRNG } from '@quantbot/core/determinism';

const rng = createDeterministicRNG(seed);
const randomValue = rng.next();
```

### Using Deterministic RNG

```typescript
import { createDeterministicRNG, seedFromString } from '@quantbot/core/determinism';

// Option 1: Explicit seed
const rng = createDeterministicRNG(42);

// Option 2: Generate seed from string (e.g., run ID)
const seed = seedFromString('run-12345');
const rng = createDeterministicRNG(seed);

// Generate random numbers
const value = rng.next();              // [0, 1)
const intValue = rng.nextInt(1, 10);   // [1, 10] inclusive
const floatValue = rng.nextFloat(0, 100); // [0, 100)
```

## Seed Management

### Seed Generation

Seeds should be:
- **Deterministic**: Generated from run ID or other deterministic input
- **Unique**: Different experiments get different seeds
- **Reproducible**: Same run ID → same seed

```typescript
import { seedFromString } from '@quantbot/core/determinism';

// Generate seed from run ID
const runId = 'exp-20250123-123456';
const seed = seedFromString(runId);

// Or use hash of inputs
const inputHash = hashInputs(strategy, data, config);
const seed = seedFromString(inputHash);
```

### SeedManager

The `SeedManager` class (to be implemented) generates deterministic seeds from run IDs:

```typescript
class SeedManager {
  generateFromRunId(runId: string): number {
    return seedFromString(runId);
  }
  
  generateFromInputs(inputs: DeterminismContract): number {
    const hash = hashInputs(inputs);
    return seedFromString(hash);
  }
}
```

## Versioning

### Contract Version

Every simulation must specify the contract version it expects:

```typescript
const input: SimInput = {
  contractVersion: '1.0.0',
  // ... other fields
};
```

### Data Version

Input data should include version information:

```typescript
const input: SimInput = {
  dataVersion: '1.2.0',  // Version of candle data schema
  candles: [...],
  // ... other fields
};
```

### Strategy Version

Strategy definitions should be versioned:

```typescript
const strategy: StrategyConfig = {
  version: '2.1.0',
  name: 'MyStrategy',
  // ... strategy config
};
```

## Non-Deterministic Patterns (Forbidden)

### Date/Time

❌ **Forbidden:**
```typescript
const now = Date.now();
const timestamp = new Date();
```

✅ **Required:**
```typescript
// Use clock from context (injected, deterministic)
const now = ctx.clock.nowMs();
const timestamp = ctx.clock.now();
```

### Random Values

❌ **Forbidden:**
```typescript
const random = Math.random();
const randomInt = Math.floor(Math.random() * 10);
```

✅ **Required:**
```typescript
const rng = createDeterministicRNG(seed);
const random = rng.next();
const randomInt = rng.nextInt(0, 9);
```

### UUID Generation

❌ **Forbidden:**
```typescript
import { randomUUID } from 'crypto';
const id = randomUUID();
```

✅ **Required:**
```typescript
// Generate deterministic ID from run ID + index
const id = `${runId}-${index}`;
// Or use seeded UUID generation (to be implemented)
```

## Testing Determinism

### Test Same Inputs + Same Seed → Same Outputs

```typescript
import { describe, it, expect } from 'vitest';
import { simulateStrategy } from '@quantbot/simulation';
import { createDeterministicRNG } from '@quantbot/core/determinism';

describe('Determinism', () => {
  it('same inputs + same seed → same outputs', () => {
    const seed = 42;
    const inputs = { /* ... */ };
    
    const result1 = simulateStrategy(inputs, createDeterministicRNG(seed));
    const result2 = simulateStrategy(inputs, createDeterministicRNG(seed));
    
    expect(result1).toEqual(result2);  // Byte-identical
  });
  
  it('same inputs + different seed → different but deterministic outputs', () => {
    const inputs = { /* ... */ };
    
    const result1 = simulateStrategy(inputs, createDeterministicRNG(42));
    const result2 = simulateStrategy(inputs, createDeterministicRNG(43));
    
    // Results are different
    expect(result1).not.toEqual(result2);
    
    // But both are deterministic (re-run gives same result)
    const result1Again = simulateStrategy(inputs, createDeterministicRNG(42));
    expect(result1Again).toEqual(result1);
  });
});
```

## Enforcement

### ESLint Rules

ESLint rules prevent non-deterministic patterns:

- `no-restricted-properties` blocks `Math.random()` in handlers
- `no-restricted-properties` blocks `Date.now()` in handlers
- See `eslint.config.mjs` for enforcement

### Runtime Validation

The simulation contract validator ensures:
- All inputs include version fields
- Seed is provided (or can be generated deterministically)
- No non-deterministic operations in simulation code

## Migration Checklist

When refactoring code for determinism:

- [ ] Replace `Math.random()` with `DeterministicRNG`
- [ ] Replace `Date.now()` with injected clock
- [ ] Add version fields to all inputs
- [ ] Generate deterministic seeds from run IDs
- [ ] Add determinism tests
- [ ] Verify same inputs + seed → same outputs

## References

- `packages/core/src/determinism.ts` - Determinism types and RNG
- `packages/core/src/seed-manager.ts` - Seed management (to be implemented)
- `packages/simulation/src/types/contracts.ts` - Simulation contract schema
- `docs/ARCHITECTURE.md` - Overall architecture

