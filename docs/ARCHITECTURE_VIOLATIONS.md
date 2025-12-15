# Architecture Violations - Current State

**Date:** 2025-12-14  
**Status:** Documenting violations before refactoring

## Critical Violations

### ❌ Simulation Package Imports Storage

**Files with `@quantbot/storage` imports:**
1. `packages/simulation/src/sinks.ts`
2. `packages/simulation/src/storage/result-cache.ts`
3. `packages/simulation/src/storage/storage-sink.ts`
4. `packages/simulation/src/storage/strategy-storage.ts`

**Violation:** Simulation should be pure compute - no database access.

**Fix:** Move these to workflows/CLI layer.

---

### ❌ OHLCV Imports from Simulation

**Files importing `fetchHybridCandles` from `@quantbot/simulation`:**
1. `packages/ohlcv/src/historical-candles.ts`
2. `packages/ohlcv/src/ohlcv-engine.ts`
3. `packages/ohlcv/src/ohlcv-service.ts`

**Violation:** OHLCV (data acquisition) should not depend on simulation (compute).

**Fix:** Move `fetchHybridCandles` from simulation to OHLCV.

---

### ❌ Simulation Engine Fetches Candles

**File:** `packages/simulation/src/engine.ts`

**Violation:** `HybridCandleProvider` calls `fetchHybridCandles()` - simulation should only accept candles as input.

**Current code:**
```typescript
class HybridCandleProvider implements CandleDataProvider {
  async fetchCandles(target: SimulationTarget): Promise<Candle[]> {
    return fetchHybridCandles(...); // ❌ Network/DB call in simulation!
  }
}
```

**Fix:** Remove `CandleDataProvider` from simulation. Workflows should fetch candles and pass them to simulation.

---

### ❌ Simulation Package Dependencies

**Current `package.json` dependencies:**
```json
{
  "@quantbot/analytics": "workspace:*",  // ❌ Questionable
  "@quantbot/storage": "workspace:*",    // ❌ FORBIDDEN
  "axios": "^1.7.9"                      // ❌ FORBIDDEN (network calls)
}
```

**Should only have:**
```json
{
  "@quantbot/core": "workspace:*",       // ✅ Types only
  "@quantbot/utils": "workspace:*",      // ✅ Utilities (logger, etc.)
  "luxon": "^3.7.2",                     // ✅ Date/time
  "uuid": "^11.1.0",                     // ✅ ID generation
  "zod": "^4.1.13"                       // ✅ Validation
}
```

---

## Dependency Graph Issues

### Current (WRONG):
```
simulation
  ├── storage ❌
  ├── analytics ❓
  └── candles.ts (has fetchHybridCandles with network/DB calls) ❌

ohlcv
  └── simulation (to get fetchHybridCandles) ❌ CIRCULAR!
```

### Target (CORRECT):
```
simulation
  └── core (types only) ✅

ohlcv
  ├── storage ✅
  ├── api-clients ✅
  └── candles.ts (fetchHybridCandles lives here) ✅

workflows/CLI
  ├── ohlcv ✅
  ├── simulation ✅
  └── storage ✅
```

---

## Files That Need Moving

### From simulation → ohlcv:
- `packages/simulation/src/candles.ts` → `packages/ohlcv/src/candles.ts`
  - Contains `fetchHybridCandles` (data acquisition)

### From simulation → workflows/CLI:
- `packages/simulation/src/core/orchestrator.ts` → `packages/cli/src/workflows/`
- `packages/simulation/src/storage/*` → `packages/cli/src/workflows/storage/` or archive
- `packages/simulation/src/sinks/*` → `packages/cli/src/workflows/sinks/` or archive

### Remove from simulation:
- All `@quantbot/storage` imports
- All `axios`/network code
- All `fetchHybridCandles` calls

---

## Next Steps

1. ✅ Remove `@quantbot/storage` from simulation package.json (DONE)
2. ⏳ Move `fetchHybridCandles` from simulation to OHLCV
3. ⏳ Remove storage imports from simulation source files
4. ⏳ Update simulation engine to only accept candles (no fetching)
5. ⏳ Move orchestrator to workflows/CLI
6. ⏳ Update all imports across codebase

---

## Impact Assessment

**Breaking Changes:**
- All code using `fetchHybridCandles` from `@quantbot/simulation` will break
- All code using simulation orchestrator will need updates
- All code using simulation storage sinks will need updates

**Affected Packages:**
- `@quantbot/simulation` - Major refactor
- `@quantbot/ohlcv` - Import changes
- `@quantbot/cli` - Will need to handle orchestration
- All scripts using simulation

**Testing:**
- All simulation tests will need updates
- OHLCV tests will need updates
- Integration tests will need updates

