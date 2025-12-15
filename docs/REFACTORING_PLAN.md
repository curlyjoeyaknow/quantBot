# Architectural Refactoring Plan

**Date:** 2025-01-XX  
**Status:** Ready to execute

## Root Cause

`fetchHybridCandles()` living in `@quantbot/simulation` poisoned the dependency graph and forced everything else to bend around it.

## Refactoring Sequence (MUST DO IN ORDER)

### PR1: Break Circular Dependency FIRST ⏳

**Goal:** Move `fetchHybridCandles` out of simulation into OHLCV

**Why first:** Until the cycle is gone, TypeScript/project refs and test isolation will keep fighting you.

**Tasks:**

1. Move `packages/simulation/src/candles.ts` → `packages/ohlcv/src/candles.ts`
   - Keep only acquisition logic (fetchHybridCandles, cache, DB lookup)
   - Split pure helpers (normalization, alignment, resampling) to simulation if needed
2. Add temporary deprecated re-export in simulation:

   ```typescript
   // packages/simulation/src/candles.ts (temporary shim)
   /**
    * @deprecated Use @quantbot/ohlcv instead
    */
   export { fetchHybridCandles } from '@quantbot/ohlcv';
   ```

3. Update imports progressively (not all at once)

**Files to move:**

- `packages/simulation/src/candles.ts` → `packages/ohlcv/src/candles.ts`

**Files to update:**

- All files importing `fetchHybridCandles` from `@quantbot/simulation`

---

### PR2: Make Simulation Truly Pure ⏳

**Goal:** Kill HybridCandleProvider and any "provider" that fetches

**Why:** If you keep any fetching surface in simulation, somebody will "just quickly" implement it again later.

**Tasks:**

1. Remove `HybridCandleProvider` from `packages/simulation/src/engine.ts`
2. Update `simulateStrategy` signature:

   ```typescript
   // Before: accepts SimulationTarget (fetches candles)
   // After: accepts Candle[] directly
   simulateStrategy(candles: Candle[], strategy: Strategy[], ...)
   ```

3. Remove all axios/network imports from simulation
4. Remove all DB/ClickHouse imports from simulation

**Files to modify:**

- `packages/simulation/src/engine.ts` - Remove CandleDataProvider
- `packages/simulation/src/candles.ts` - Remove (moved in PR1)
- All files with network/DB imports

---

### PR3: Split Sinks into Pure vs IO ⏳

**Goal:** Separate pure compute from orchestration

**Tasks:**

1. **Keep in simulation:**
   - Memory sink
   - JSON sink
   - Console sink
   - Event collector (in-memory)

2. **Move to workflows/CLI:**
   - `packages/simulation/src/storage/storage-sink.ts` → `packages/cli/src/workflows/storage-sink.ts`
   - `packages/simulation/src/storage/result-cache.ts` → `packages/cli/src/workflows/result-cache.ts`
   - `packages/simulation/src/storage/strategy-storage.ts` → `packages/cli/src/workflows/strategy-storage.ts`

**Files to move:**

- `packages/simulation/src/storage/*` → `packages/cli/src/workflows/storage/`
- `packages/simulation/src/sinks.ts` → Split (keep pure, move IO)

---

### PR4: Clean Dependency Set ⏳

**Goal:** Remove analytics dependency from simulation

**Tasks:**

1. Remove `@quantbot/analytics` from `packages/simulation/package.json`
2. Move ATH/ATL helpers to simulation as math utilities OR create `@quantbot/math` package
3. Update period-metrics to use local math instead of analytics

**Files to modify:**

- `packages/simulation/package.json`
- `packages/simulation/src/period-metrics/period-metrics.ts`

---

## Target Dependency Graph

```
simulation
  └── core (types only) ✅
  └── utils (logger, etc.) ✅

ohlcv
  ├── storage ✅
  ├── api-clients ✅
  └── candles.ts (fetchHybridCandles lives here) ✅

workflows/CLI
  ├── ohlcv ✅
  ├── simulation ✅
  └── storage ✅
```

## Enforcement

**ESLint Import Firewall:** ✅ Already added to `eslint.config.mjs`

**Architectural Tests:** ✅ Already added to `packages/simulation/tests/architectural/import-rules.test.ts`

## Success Criteria

After refactoring:

- ✅ Simulation has zero network/DB imports
- ✅ OHLCV has zero simulation imports
- ✅ All tests pass
- ✅ ESLint import firewall passes
- ✅ Architectural tests pass
