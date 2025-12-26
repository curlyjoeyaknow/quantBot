# Determinism Gates: Prerequisites for Production Authority

These are **non-negotiable gates** that must be implemented before QuantBot can take production authority. These gates ensure deterministic, replayable simulations.

## Gate 1: Hard Ban on Nondeterminism

### Requirements

**ESLint rule or build failure for `Date.now()` and `Math.random()` in simulation paths.**

- Single injected clock + RNG everywhere
- All time access must go through `SimulationClock` interface
- All randomness must go through deterministic RNG (seed-based)

### Current State

#### ✅ Partially Implemented

- `SimulationClock` interface exists (`packages/simulation/src/core/clock.ts`)
- Deterministic RNG exists (`@quantbot/core` - `createDeterministicRNG`)
- Simulation core uses clock interface (some functions)

#### ❌ Violations Found

1. **`Date.now()` usage in simulation code:**

   - `packages/simulation/src/position/position.ts:85` - Fallback ID generation uses `Date.now()` and `Math.random()`
   - `packages/simulation/src/utils/progress.ts:36,76` - Uses `Date.now()` for timing
   - `packages/simulation/src/performance/result-cache.ts:49,79` - Uses `Date.now()` for cache TTL
   - `packages/storage/src/engine/StorageEngine.ts:257,599` - Uses `Date.now()` in cache (not in sim path, but needs review)

2. **`Math.random()` usage in simulation code:**

   - `packages/simulation/src/position/position.ts:85` - ID generation fallback
   - Test files use `Math.random()` for data generation (acceptable, but should use deterministic RNG)

3. **Missing clock injection:**

   - Some simulation functions don't accept clock parameter
   - Progress tracking uses `Date.now()` directly
   - Cache uses `Date.now()` for TTL (needs injected clock)

### Implementation Tasks

1. **Add ESLint rule:**

   ```json
   // eslint.config.mjs or .eslintrc
   {
     "rules": {
       "no-restricted-globals": [
         "error",
         {
           "name": "Date",
           "message": "Use SimulationClock from context instead of Date.now(). For caching, use clock.now()."
         },
         {
           "name": "Math.random",
           "message": "Use deterministic RNG from context instead of Math.random()."
         }
       ]
     },
     "overrides": [
       {
         "files": ["packages/simulation/src/**/*.ts"],
         "rules": {
           "no-restricted-globals": "error"
         }
       }
     ]
   }
   ```

2. **Fix violations:**

   - Update `position.ts` to require `runId` parameter (remove fallback)
   - Update `progress.ts` to use injected clock
   - Update `result-cache.ts` to use injected clock
   - Add clock parameter to all simulation functions

3. **Enforce in CI:**

   - Add ESLint check to build pipeline
   - Fail build if violations found

4. **Add deterministic RNG injection:**

   - Ensure all simulation functions that need randomness accept RNG from context
   - Remove all `Math.random()` calls in simulation paths

## Gate 2: Causal Candle Accessor

### Requirements

**At simulation time `t`, it must be impossible to fetch candles with `close_time > t`.**

- Multi-timeframe candles must expose last-closed-only
- Candle accessor must filter based on simulation current time
- No access to future candles during simulation

### Current State

#### ❌ Not Implemented

- Current candle access doesn't enforce causality
- `getCandles()` returns all candles in time range, regardless of simulation time
- No `close_time` field in `Candle` interface (only `timestamp` which represents period start)
- Simulation receives all candles upfront, can access future candles during loop

#### Candle Structure

Current `Candle` interface:

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

**Problem:** `timestamp` represents the **start** of the candle period, not when it closes. To enforce causality, we need to know when the candle **closes**.

### Implementation Tasks

1. **Add `closeTime` to Candle interface (optional, computed):**

   ```typescript
   export interface Candle {
     timestamp: number; // Period start
     open: number;
     high: number;
     low: number;
     close: number;
     volume: number;
     intervalSeconds?: number; // Required for closeTime calculation
     
     // Computed property or helper function
     getCloseTime(): number {
       return this.timestamp + (this.intervalSeconds ?? 300); // Default 5m
     }
   }
   ```

2. **Create CausalCandleAccessor interface:**

   ```typescript
   export interface CausalCandleAccessor {
     /**
      * Get candles available at simulation time t
      * Only returns candles where closeTime <= t
      */
     getCandlesAtTime(
       mint: string,
       simulationTime: number, // Current simulation timestamp
       lookback: number // How far back to look
     ): Promise<Candle[]>;
     
     /**
      * Get the last closed candle at time t
      */
     getLastClosedCandle(
       mint: string,
       simulationTime: number
     ): Promise<Candle | null>;
   }
   ```

3. **Update simulation to use causal accessor:**

   - Remove upfront candle fetching
   - Fetch candles incrementally as simulation progresses
   - Filter candles by `closeTime <= currentSimulationTime`

4. **Update WorkflowContext:**

   ```typescript
   export type WorkflowContext = {
     // ... existing fields
     ohlcv: {
       // Replace getCandles with causal accessor
       getCandlesAtTime(
         mint: string,
         simulationTime: number,
         lookback: number
       ): Promise<Candle[]>;
       getLastClosedCandle(mint: string, simulationTime: number): Promise<Candle | null>;
     };
   };
   ```

5. **Handle multi-timeframe candles:**

   - Each timeframe must track its own last-closed candle
   - Multi-timeframe accessor must filter per timeframe
   - Last-closed-only API for each timeframe

6. **Update storage layer:**

   - Ensure `intervalSeconds` is stored with candles
   - Update queries to include interval information
   - Add helper to compute `closeTime` from `timestamp + intervalSeconds`

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

1. **Create future-scramble test:**

   ```typescript
   // packages/simulation/tests/determinism/future-scramble.test.ts
   
   describe('Future-Scramble Test', () => {
     it('decisions before time T are byte-identical when candles after T are modified', async () => {
       // 1. Load test candles
       const originalCandles = loadTestCandles();
       const splitTime = originalCandles[Math.floor(originalCandles.length / 2)].getCloseTime();
       
       // 2. Run simulation with original candles
       const originalResult = await simulateStrategy(originalCandles, strategy);
       
       // 3. Modify candles after splitTime (scramble future)
       const scrambledCandles = scrambleCandlesAfterTime(originalCandles, splitTime);
       
       // 4. Run simulation with scrambled candles
       const scrambledResult = await simulateStrategy(scrambledCandles, strategy);
       
       // 5. Extract decisions before splitTime from both results
       const originalDecisionsBeforeT = extractDecisionsBeforeTime(originalResult, splitTime);
       const scrambledDecisionsBeforeT = extractDecisionsBeforeTime(scrambledResult, splitTime);
       
       // 6. Assert byte-identical
       expect(originalDecisionsBeforeT).toEqual(scrambledDecisionsBeforeT);
       
       // 7. Verify that decisions after T may differ (this is expected)
       const originalDecisionsAfterT = extractDecisionsAfterTime(originalResult, splitTime);
       const scrambledDecisionsAfterT = extractDecisionsAfterTime(scrambledResult, splitTime);
       // These should be different (we scrambled the future)
     });
   });
   ```

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
- `packages/simulation/src/position/position.ts` - Position management (has violations)
- `packages/workflows/src/simulation/runSimulation.ts` - Workflow orchestration
- `packages/storage/src/engine/StorageEngine.ts` - Candle storage
- `packages/simulation/src/types/candle.ts` - Candle type definition

## Notes

- Until all three gates are implemented, QuantBot **cannot** claim deterministic behavior
- "Usually works" is not sufficient - determinism must be provable
- These gates are non-negotiable for production authority

