# Global Clock Authority Pattern

**Status**: ✅ IMPLEMENTED  
**Priority**: P0 (Critical Path)  
**Created**: 2025-01-25

## Overview

QuantBot enforces a **global clock authority** pattern where all time operations in simulation go through a single `SimulationClock` instance. This ensures:

1. **Determinism**: Same inputs → same time values
2. **Testability**: Clock can be mocked/controlled in tests
3. **No Wall-Clock Access**: Strategies cannot access real time

## Architecture

### Clock Creation

The clock is created **once** at the start of simulation and passed to all functions that need time:

```typescript
// In simulateStrategy()
const clock: SimulationClock = createClock(clockResolution, candles[0]?.timestamp ?? 0);
```

### Clock Interface

```typescript
interface SimulationClock {
  getCurrentTime(): number;        // Current simulation time
  advance(): void;                   // Advance by one tick
  fromMilliseconds(ms: number): number;  // Convert ms to clock units
  toMilliseconds(units: number): number; // Convert clock units to ms
  getResolution(): ClockResolution; // 'ms' | 's' | 'm' | 'h'
}
```

### Clock Resolution

Clock resolution determines the granularity of time operations:

- `'ms'`: Millisecond precision (for high-frequency strategies)
- `'s'`: Second precision (default for most strategies)
- `'m'`: Minute precision (for daily/hourly strategies)
- `'h'`: Hour precision (for long-term strategies)

## Usage Pattern

### ✅ CORRECT: Clock Passed as Parameter

```typescript
function handleTrailingEntry(
  candles: readonly Candle[],
  indicators: readonly LegacyIndicatorData[],
  trailingPercent: number,
  maxWaitTime: number,
  entrySignal: SignalGroup | undefined,
  events: LegacySimulationEvent[],
  clock: SimulationClock  // ✅ Clock passed as parameter
): {
  triggered: boolean;
  price: number;
  entryDelay: number;
  // ...
} {
  const maxWaitTimestamp = candles[0].timestamp + clock.toMilliseconds(maxWaitTime);
  // ...
  return {
    triggered: true,
    entryDelay: clock.fromMilliseconds(candle.timestamp - candles[0].timestamp),
    // ...
  };
}
```

### ❌ WRONG: Direct Time Access

```typescript
// ❌ WRONG: Direct timestamp access
function badFunction(candles: Candle[]) {
  const now = Date.now(); // ❌ Non-deterministic
  const delay = now - candles[0].timestamp; // ❌ Uses wall-clock time
}

// ❌ WRONG: Creating new clock
function badFunction(candles: Candle[]) {
  const clock = createClock('m', Date.now()); // ❌ Uses wall-clock time
}
```

## Enforcement

### ESLint Rules

ESLint blocks `Date.now()` and `new Date()` in simulation code:

```typescript
// ❌ Blocked by ESLint
const now = Date.now();
const date = new Date();
```

### Architecture Tests

Integration tests verify clock usage:

```typescript
describe('Clock Authority', () => {
  it('all time operations use SimulationClock', () => {
    // Verify no Date.now() in simulation paths
  });
});
```

## Clock Propagation

### Entry Point: `simulateStrategy()`

```typescript
export async function simulateStrategy(
  candles: readonly Candle[],
  strategy: StrategyLeg[],
  // ... config ...
  options?: SimulationOptions
): Promise<SimulationResult> {
  // Create clock once at entry point
  const clockResolution: ClockResolution = options?.clockResolution ?? 'm';
  const clock: SimulationClock = createClock(clockResolution, candles[0]?.timestamp ?? 0);
  
  // Pass clock to all functions that need time
  const result = handleInitialEntry(candles, indicators, entryCfg, events, clock);
  // ...
}
```

### Helper Functions

All helper functions that need time receive clock as parameter:

```typescript
function handleInitialEntry(
  candles: readonly Candle[],
  indicators: readonly LegacyIndicatorData[],
  dropPercent: number,
  entrySignal: SignalGroup | undefined,
  events: LegacySimulationEvent[],
  clock: SimulationClock  // ✅ Clock passed down
): { triggered: boolean; price: number; entryDelay: number } {
  // Use clock for time calculations
  const entryDelay = clock.fromMilliseconds(candle.timestamp - candles[0].timestamp);
  // ...
}
```

## Testing

### Mock Clock

Tests can provide a mock clock for deterministic testing:

```typescript
describe('Simulation with Mock Clock', () => {
  it('uses provided clock for time calculations', () => {
    const mockClock = {
      getCurrentTime: () => 1000,
      advance: () => {},
      fromMilliseconds: (ms: number) => ms / 60_000, // Convert to minutes
      toMilliseconds: (units: number) => units * 60_000,
      getResolution: () => 'm' as ClockResolution,
    };
    
    // Pass mock clock to simulation
    // ...
  });
});
```

### Determinism Tests

Verify that same inputs produce same time values:

```typescript
describe('Clock Determinism', () => {
  it('same candles + same clock resolution → same time values', () => {
    const candles = generateCandles(10, 1000);
    const clock1 = createClock('m', candles[0].timestamp);
    const clock2 = createClock('m', candles[0].timestamp);
    
    expect(clock1.getCurrentTime()).toBe(clock2.getCurrentTime());
    expect(clock1.fromMilliseconds(60000)).toBe(clock2.fromMilliseconds(60000));
  });
});
```

## Comparison with Jesse

### Jesse's Approach

- Engine owns time completely
- Strategies are stepped candle-by-candle
- No ambient clock access possible

### QuantBot's Approach

- Clock created at simulation entry point
- Clock passed as parameter to all functions
- ESLint blocks wall-clock access
- Strategies cannot access time directly (must receive clock)

## Migration Checklist

When refactoring code to use clock:

- [ ] Remove all `Date.now()` calls
- [ ] Remove all `new Date()` calls
- [ ] Add `clock: SimulationClock` parameter to functions that need time
- [ ] Use `clock.fromMilliseconds()` and `clock.toMilliseconds()` for conversions
- [ ] Use `clock.getCurrentTime()` instead of `Date.now()`
- [ ] Pass clock from `simulateStrategy()` entry point
- [ ] Update tests to provide mock clock
- [ ] Verify ESLint passes

## Related Documentation

- `docs/architecture/DETERMINISM.md` - Determinism contract
- `docs/architecture/DETERMINISM_ENFORCEMENT.md` - Enforcement rules
- `packages/simulation/src/core/clock.ts` - Clock implementation
- `packages/simulation/src/core/simulator.ts` - Clock usage example

## Success Criteria

- ✅ Clock created once at simulation entry point
- ✅ Clock passed as parameter to all functions
- ✅ No `Date.now()` or `new Date()` in simulation code
- ✅ ESLint blocks wall-clock access
- ✅ Tests use mock clocks
- ✅ Same inputs → same time values

