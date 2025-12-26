# Workflow Clock Usage Refactor Summary

## Overview

Comprehensive review and refactoring of clock/time usage across the workflows package to enforce determinism and eliminate `Date.now()` violations.

## Changes Made

### 1. ESLint Rule Enhancements

**Added `new Date()` constructor ban**:

- Extended `no-restricted-syntax` rule to catch `new Date()` usage
- Applied to both workflows and adapters
- Exception: Only composition roots may use `new Date()` to create clock adapters

**Enhanced adapter rules**:

- Added `Math.random()` ban to adapter rules
- Added `new Date()` ban to adapter rules
- Clarified that adapters must accept `ClockPort` dependencies

### 2. Fixed Violations

#### Causal Candle Accessor (`causal-candle-accessor.ts`)

- ✅ Added `ClockPort` to constructor
- ✅ Replaced all `Date.now()` calls with `clock.nowMs()`
- ✅ Updated `createProductionContext` to pass clock to accessor

#### Data Snapshot Service (`DataSnapshotService.ts`)

- ✅ Changed `new Date().toISOString()` to use `ctx.clock.nowISO()`
- ✅ Added fallback to `DateTime.utc().toISO()` for backward compatibility

#### Metrics Calculator (`metrics.ts`)

- ✅ Changed `calculatePnLSeries` to accept optional `timestampISO` parameter
- ✅ Removed `new Date().toISOString()` from default empty series
- ✅ Updated callers to pass timestamp when needed

#### Run Sim Presets (`runSimPresets.ts`)

- ✅ Added optional `clock` parameter to `RunSimPresetsSpec`
- ✅ Changed `new Date().toISOString()` to use `spec.clock.nowISO()`
- ✅ Added fallback to `DateTime.utc().toISO()` for backward compatibility

#### Execution Stub Adapter (`executionStubAdapter.ts`)

- ✅ Replaced `Math.random()` with deterministic RNG
- ✅ Created `getRandomSuffix()` function using `createDeterministicRNG` and `seedFromString`
- ✅ All random generation is now deterministic and reproducible

#### Telemetry Console Adapter (`telemetryConsoleAdapter.ts`)

- ✅ Made `clock` parameter required (removed fallback to `Date.now()`)
- ✅ All time access now uses injected `ClockPort`

#### Smoke Tests

- ✅ Updated `smokeMarketDataPort.ts` to use `ports.clock.nowMs()` instead of `DateTime.now()`
- ✅ `smokeStatePort.ts` already using `ports.clock.nowMs()` correctly

### 3. Architecture Improvements

#### Clock Dependency Injection Pattern

**Before**:

```typescript
// ❌ Direct Date.now() usage
const timestamp = Date.now();
const timestampISO = new Date().toISOString();
```

**After**:

```typescript
// ✅ Injected clock dependency
const timestamp = clock.nowMs();
const timestampISO = ctx.clock.nowISO();
```

#### Deterministic Random Number Generation

**Before**:

```typescript
// ❌ Non-deterministic randomness
const randomSuffix = Math.random().toString(36).substring(7);
```

**After**:

```typescript
// ✅ Deterministic RNG with seed
const seed = seedFromString(`${request.tokenAddress}-${request.side}-${clock.nowMs()}`);
const rng = createDeterministicRNG(seed);
const randomSuffix = Math.floor(rng.next() * 36 ** 7).toString(36);
```

### 4. Boundary Compliance

All adapters comply with architecture boundaries:

- ✅ Adapters import from `@quantbot/storage` and `@quantbot/api-clients` (allowed - they implement ports)
- ✅ No direct storage imports in workflow business logic
- ✅ All time access goes through injected dependencies

## Files Modified

### Core Changes

1. `packages/workflows/src/context/causal-candle-accessor.ts` - Added ClockPort dependency
2. `packages/workflows/src/context/createProductionContext.ts` - Pass clock to causal accessor
3. `packages/workflows/src/research/services/DataSnapshotService.ts` - Use ctx.clock
4. `packages/workflows/src/research/metrics.ts` - Accept optional timestamp parameter
5. `packages/workflows/src/slices/runSimPresets.ts` - Accept optional clock parameter
6. `packages/workflows/src/adapters/executionStubAdapter.ts` - Use deterministic RNG
7. `packages/workflows/src/adapters/telemetryConsoleAdapter.ts` - Require clock parameter
8. `packages/workflows/src/dev/smokeMarketDataPort.ts` - Use ports.clock

### Storage Layer Changes (Future Work - Completed)

- `packages/storage/src/engine/StorageEngine.ts` - Added ClockPort injection for cache TTL checks
- `packages/ohlcv/src/ohlcv-service.ts` - Added ClockPort injection for in-memory cache
- `packages/storage/src/cache/ohlcv-cache.ts` - Added ClockPort injection for cache TTL checks

### Configuration

- `eslint.config.mjs` - Enhanced rules for `new Date()` and `Math.random()` bans
- `docs/architecture/date-now-usage-policy.md` - Comprehensive usage policy document with clock mocking examples

## Testing Impact

### Benefits

- ✅ All workflows are now deterministic (can be mocked in tests)
- ✅ Clock can be controlled in tests for time-dependent logic
- ✅ Random number generation is reproducible (same seed → same output)

### Test Updates Required

- Tests that mock adapters must provide `ClockPort` in config
- Tests that check timestamps can use deterministic clocks
- Property tests can verify deterministic behavior
- Storage layer tests can now use deterministic clocks for cache TTL testing

## Backward Compatibility

### Breaking Changes

- `createTelemetryConsoleAdapter()` now requires `clock` parameter (was optional)
- `calculatePnLSeries()` signature changed (added optional `timestampISO` parameter)
- `runSimPresets()` spec now accepts optional `clock` parameter

### Migration Guide

**For adapter factories**:

```typescript
// Before
const telemetry = createTelemetryConsoleAdapter({ prefix: 'quantbot' });

// After
const clock = createSystemClock();
const telemetry = createTelemetryConsoleAdapter({ prefix: 'quantbot', clock });
```

**For workflow functions**:

```typescript
// Before
const pnlSeries = calculatePnLSeries(tradeEvents);

// After
const pnlSeries = calculatePnLSeries(tradeEvents, 1.0, ctx.clock.nowISO());
```

## Enforcement

### ESLint Rules

- ✅ `no-restricted-properties` catches `Date.now()` and `Math.random()`
- ✅ `no-restricted-syntax` catches `new Date()` constructor
- ✅ Applied to workflows, adapters (with composition root exceptions)

### Exceptions

- Composition roots (`createProductionPorts.ts`, etc.) may use `Date.now()` to create clock adapters
- Test files may use `Date.now()` for performance measurements

## Future Work

1. ✅ **Storage Layer Migration**: Migrate storage engine cache TTL checks to use clock injection
   - ✅ `StorageEngine` now accepts optional `ClockPort` in config
   - ✅ `OHLCVService` now accepts optional `ClockPort` in constructor
   - ✅ `OHLCVCache` now accepts optional `ClockPort` in constructor
   - All cache TTL checks now use injected clock instead of `Date.now()`
   - Backward compatible: defaults to system clock if not provided

2. **More Deterministic Tests**: Update all tests to use deterministic clocks
   - ✅ Updated `OHLCVCache` TTL expiration test to use deterministic clock (no more `setTimeout`)
   - ✅ Added `StorageEngine` cache TTL expiration test with deterministic clock
   - Tests can now use deterministic clocks for `StorageEngine`, `OHLCVService`, and `OHLCVCache`
   - See [Date.now() Usage Policy](./date-now-usage-policy.md) for clock mocking examples

3. ✅ **Documentation**: Add examples showing clock mocking patterns
   - ✅ Added comprehensive clock mocking examples to `date-now-usage-policy.md`
   - ✅ Examples include: basic mocks, fixed time clocks, advancing clocks, storage layer mocks

4. **Type Safety**: Consider adding TypeScript types that prevent accidental `Date` usage
   - Could add branded types or lint rules to prevent `Date` constructor usage
   - Current ESLint rules catch most violations

## Related Documentation

- [Date.now() Usage Policy](./date-now-usage-policy.md) - Complete policy document
- [Determinism Gates](./determinism-gates.md) - Requirements for deterministic simulations
- [Workflow Architecture](./WORKFLOW_ARCHITECTURE.md) - Context and dependency injection patterns
