# Determinism Gates: Prerequisites for Production Authority

These are **non-negotiable gates** that must be implemented before QuantBot can take production authority. These gates ensure deterministic, replayable simulations.

## Gate 1: Hard Ban on Nondeterminism

### Requirements

**ESLint rule or build failure for `Date.now()` and `Math.random()` in simulation paths.**

- Single injected clock + RNG everywhere
- All time access must go through `SimulationClock` interface
- All randomness must go through deterministic RNG (seed-based)

### Current State

#### ✅ Implemented

- `SimulationClock` interface exists (`packages/simulation/src/core/clock.ts`)
- Deterministic RNG exists (`@quantbot/core` - `createDeterministicRNG`)
- Simulation core uses clock interface
- **All violations fixed:**
  - ✅ `position.ts` - Fixed (no longer uses `Date.now()` or `Math.random()`)
  - ✅ `progress.ts` - Fixed (uses injected `ProgressClock` interface)
  - ✅ `result-cache.ts` - Fixed (uses injected `CacheClock` interface)
- ESLint rules enforce ban on `Date.now()`, `new Date()`, and `Math.random()` in simulation code
- ESLint exceptions removed (no longer needed)

#### ⚠️ Remaining Items (Not Violations)

- ✅ `packages/storage/src/engine/StorageEngine.ts` - **FIXED**: Now accepts optional `ClockPort` injection (defaults to system clock for backward compatibility)
- ✅ `packages/ohlcv/src/ohlcv-service.ts` - **FIXED**: Now accepts optional `ClockPort` injection
- ✅ `packages/storage/src/cache/ohlcv-cache.ts` - **FIXED**: Now accepts optional `ClockPort` injection
- Test files use `Math.random()` for data generation (acceptable for test fixtures)

### Implementation Tasks

1. **✅ ESLint rule (COMPLETED):**

   ✅ **COMPLETED**: ESLint rule updated in `eslint.config.mjs`:
   - Added `no-restricted-syntax` to ban `new Date()` constructor
   - Added `no-restricted-properties` to ban `Date.now()` and `Math.random()`
   - Rule enforces: `Date.now()`, `new Date()`, and `Math.random()` are banned in simulation code
   - No exceptions needed (all violations fixed)

2. **✅ Fix violations (COMPLETED):**

   - ✅ `position.ts` - Fixed (no longer uses `Date.now()` or `Math.random()`, throws error if no deterministic inputs)
   - ✅ `progress.ts` - Fixed (accepts optional `ProgressClock` interface, defaults to `Date.now()` for backward compatibility)
   - ✅ `result-cache.ts` - Fixed (accepts optional `CacheClock` interface, defaults to `Date.now()` for backward compatibility)
   - ✅ `StorageEngine` - Fixed (accepts optional `ClockPort` in config, all cache TTL checks use injected clock)
   - ✅ `OHLCVService` - Fixed (accepts optional `ClockPort` in constructor, in-memory cache uses injected clock)
   - ✅ `OHLCVCache` - Fixed (accepts optional `ClockPort` in constructor, cache TTL checks use injected clock)
   - ✅ ESLint exceptions removed (no longer needed)
   - ✅ Tests updated to use deterministic clocks (OHLCVCache and StorageEngine TTL tests)

3. **Enforce in CI (TODO):**

   - Add ESLint check to build pipeline
   - Fail build if violations found

4. **Add deterministic RNG injection (TODO):**

   - Ensure all simulation functions that need randomness accept RNG from context
   - Remove all `Math.random()` calls in simulation paths (test files are acceptable)

## Gate 2: Causal Candle Accessor

### Requirements

**At simulation time `t`, it must be impossible to fetch candles with `close_time > t`.**

- Multi-timeframe candles must expose last-closed-only
- Candle accessor must filter based on simulation current time
- No access to future candles during simulation

### Current State

#### ✅ Implemented

Gate 2 is now **IMPLEMENTED** with the following components:

1. **✅ Causal accessor utilities (COMPLETED):**

   ✅ **COMPLETED**: Helper functions in `packages/simulation/src/types/causal-accessor.ts`:
   - `getCandleCloseTime()` - Compute close time from timestamp + interval
   - `getCandleCloseTimeFromInterval()` - Compute close time using interval string
   - `filterCandlesByCloseTime()` - Filter candles by close time
   - `getLastClosedCandle()` - Get last closed candle at simulation time
   
   These utilities filter candles to ensure only closed candles are accessible.

2. **✅ CausalCandleAccessor interface (COMPLETED):**

   ✅ **COMPLETED**: `CausalCandleAccessor` interface and `CausalCandleWrapper` class in `packages/simulation/src/types/causal-accessor.ts`
   
   The interface provides:
   - `getCandlesAtTime()` - Get candles closed at or before simulation time
   - `getLastClosedCandle()` - Get the last closed candle at simulation time
   
   `CausalCandleWrapper` wraps pre-fetched candles and provides causal filtering.

3. **✅ Storage-based causal accessor (COMPLETED):**

   ✅ **COMPLETED**: `StorageCausalCandleAccessor` class in `packages/workflows/src/context/causal-candle-accessor.ts`
   - Wraps `StorageEngine` and provides causal access
   - Implements caching to reduce repeated queries
   - Filters candles by `closeTime <= simulationTime`

4. **✅ Simulation integration (COMPLETED):**

   ✅ **COMPLETED**: New `simulateStrategyWithCausalAccessor()` function in `packages/simulation/src/core/simulator.ts`
   - Uses time-based iteration instead of candle array iteration
   - Fetches candles incrementally using `candleAccessor.getCandlesAtTime()`
   - Updates indicators incrementally as new candles arrive
   - Ensures only closed candles are accessible at each simulation time step

5. **✅ WorkflowContext integration (COMPLETED):**

   ✅ **COMPLETED**: Updated `WorkflowContext` in `packages/workflows/src/types.ts`
   - Added `ohlcv.causalAccessor: CausalCandleAccessor` (primary)
   - Kept `ohlcv.getCandles()` for backward compatibility (legacy)
   - Wired `StorageCausalCandleAccessor` in `createProductionContext()`

6. **✅ Workflow integration (COMPLETED):**

   ✅ **COMPLETED**: Updated `runSimulation` workflow in `packages/workflows/src/simulation/runSimulation.ts`
   - Uses causal accessor instead of upfront candle fetching
   - Passes `candleAccessor`, `startTime`, `endTime` to simulation
   - Updated `ctx.simulation.run()` to accept new signature

7. **✅ Incremental indicators (COMPLETED):**

   ✅ **COMPLETED**: `updateIndicatorsIncremental()` function in `packages/simulation/src/indicators/incremental.ts`
   - Maintains indicator state across time steps
   - Supports lookback window for indicators that need history
   - Updates indicators as new candles arrive

### Implementation Details

**Candle Structure:**

The `Candle` interface uses `timestamp` to represent the **start** of the candle period. Close time is calculated as `timestamp + intervalSeconds`:

```typescript
export interface Candle {
  timestamp: number; // Unix timestamp in seconds (period start)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

**Causal Filtering:**

Candles are filtered using `filterCandlesByCloseTimeInterval()` which ensures:
- `closeTime = timestamp + intervalSeconds`
- Only candles where `closeTime <= simulationTime` are returned

**Time-Based Iteration:**

The new `simulateStrategyWithCausalAccessor()` function:
- Iterates by time steps (e.g., 5 minutes for 5m candles)
- Fetches candles incrementally at each time step
- Updates indicators incrementally as new candles arrive
- Never accesses candles with `closeTime > currentSimulationTime`

### Testing

✅ **Tests created** in `packages/simulation/tests/determinism/causal-accessor.test.ts`:
- Verifies `getCandlesAtTime()` only returns candles with `closeTime <= simulationTime`
- Tests causal filtering at exact close time boundaries
- Verifies Gate 2 compliance (no future candle access)

### Remaining Tasks

- Multi-timeframe support (if needed in future)
- Performance optimization (caching already implemented)
- Integration tests comparing causal vs. upfront fetching results

## Gate 3: Future-Scramble Test

### Requirements

**Modify candles after time T. Assert all decisions before T are byte-identical.**

- Test that changes to future candles don't affect past decisions
- Verify deterministic behavior under data mutations
- Catch any accidental future-dependence

### Current State

#### ❌ Not Implemented

- No future-scramble test exists
- No verification that past decisions are unchanged by future data

### Implementation Tasks

1. **✅ Create future-scramble test (COMPLETED):**

   ✅ **COMPLETED**: Future-scramble test created in `packages/simulation/tests/determinism/future-scramble.test.ts`
   
   The test:
   - Creates test candles and runs simulation with original data
   - Scrambles candles after a split time T
   - Runs simulation again with scrambled data
   - Verifies that decisions before T are byte-identical
   - Tests multiple split points (early, middle, late)
   - Tests missing candles scenario

2. **Helper functions:**

   - `scrambleCandlesAfterTime(candles, time)`: Modify prices/volumes of candles after time T
   - `extractDecisionsBeforeTime(result, time)`: Extract events/decisions before time T
   - `extractDecisionsAfterTime(result, time)`: Extract events/decisions after time T

3. **Test multiple scenarios:**

   - Different split points (early, middle, late)
   - Different scramble patterns (price changes, volume changes, missing candles)
   - Different strategies (entry/exit logic should be tested)

4. **Integration with CI:**

   - Run future-scramble test in CI
   - Fail if any decision before T differs
   - Document expected behavior

## Implementation Priority

1. **Gate 1 (Hard Ban)** - Highest priority
   - Required for any deterministic simulation
   - Relatively straightforward to implement
   - Can be done incrementally

2. **Gate 2 (Causal Candle Accessor)** - High priority
   - Required for correct simulation behavior
   - More complex, requires architecture changes
   - Blocks production use

3. **Gate 3 (Future-Scramble Test)** - High priority
   - Required to prove determinism
   - Should be implemented alongside Gate 2
   - Provides confidence in implementation

## Testing Strategy

1. **Unit tests** for each gate
2. **Integration tests** for causal accessor
3. **Regression tests** to prevent future violations
4. **CI enforcement** - fail build if gates not met

## Documentation

- Update architecture docs to explain determinism requirements
- Document causal accessor API
- Add examples of correct usage
- Document future-scramble test methodology

## Related Files

- `packages/simulation/src/core/clock.ts` - Clock interface
- `packages/simulation/src/core/simulator.ts` - Main simulation logic
- `packages/simulation/src/position/position.ts` - Position management (violations fixed)
- `packages/storage/src/engine/StorageEngine.ts` - Candle storage (clock injection added)
- `packages/ohlcv/src/ohlcv-service.ts` - OHLCV service (clock injection added)
- `packages/storage/src/cache/ohlcv-cache.ts` - OHLCV cache (clock injection added)
- `packages/workflows/src/simulation/runSimulation.ts` - Workflow orchestration
- `packages/simulation/src/types/candle.ts` - Candle type definition

## Notes

- Until all three gates are implemented, QuantBot **cannot** claim deterministic behavior
- "Usually works" is not sufficient - determinism must be provable
- These gates are non-negotiable for production authority

