# Architecture Refactoring Plan

**Date:** 2025-12-14  
**Goal:** Align codebase with three-layer architecture

## Current Problems

### 1. Simulation Package Violations

**Forbidden dependencies in `@quantbot/simulation`:**
- ❌ `@quantbot/storage` - Should not import storage
- ❌ `@quantbot/api-clients` - Should not make network calls
- ❌ `@quantbot/ohlcv` - Should not fetch candles
- ❌ `@quantbot/ingestion` - Should not ingest data

**Current violations:**
- `packages/simulation/src/candles.ts` - Contains `fetchHybridCandles` which:
  - Makes Birdeye API calls (axios)
  - Queries ClickHouse
  - Reads/writes CSV cache
  - This is **data acquisition**, not simulation!

- `packages/simulation/src/storage/*` - Storage sinks and helpers
  - Should be in workflows/orchestration layer

- `packages/simulation/src/core/orchestrator.ts` - Orchestration logic
  - Should be in workflows/CLI layer

### 2. OHLCV Package Violations

**Wrong dependency:**
- ❌ `@quantbot/simulation` - OHLCV imports `fetchHybridCandles` from simulation
  - This creates a circular dependency
  - `fetchHybridCandles` should live in OHLCV, not simulation

### 3. Missing Workflows Layer

**Current state:**
- `packages/workflows/` - Empty (only tsconfig.json)
- Workflows scattered in:
  - CLI commands (`packages/cli/src/commands/*.ts`)
  - Scripts (`scripts/workflows/*.ts`)
  - Simulation orchestrator (wrong place!)

## Target Architecture

### Layer 1: Data Acquisition
**Package:** `@quantbot/ohlcv`

**Responsibility:** "Given mint + interval + window, return candles"

**Allowed:**
- ✅ Cache (LRU, CSV)
- ✅ ClickHouse queries
- ✅ Birdeye API calls
- ✅ Storage operations

**Exports:**
- `OHLCVEngine.getCandles(mint, interval, window)` → `Candle[]`
- `fetchHybridCandles()` - Move from simulation

### Layer 2: Pure Compute
**Package:** `@quantbot/simulation`

**Responsibility:** "Given candles + strategy config, compute trades/results"

**Forbidden:**
- ❌ No network calls
- ❌ No database access
- ❌ No OHLCV imports
- ❌ No storage imports

**Allowed:**
- ✅ Math operations
- ✅ State transitions
- ✅ Indicator calculations
- ✅ Strategy evaluation

**Exports:**
- `SimulationEngine.run(candles: Candle[], config: SimConfig)` → `SimResult`

### Layer 3: Orchestration
**Location:** `packages/cli/src/commands/*.ts` or `packages/workflows/`

**Responsibility:** "load alerts → acquire candles → call simulation → persist results → output report"

**Allowed:**
- ✅ All I/O operations
- ✅ Database access
- ✅ Network calls
- ✅ Glue code

**Flow:**
```
CLI command 
  → workflow handler 
  → ohlcvService.getCandles() 
  → simulationEngine.run(candles, cfg) 
  → storage.saveResults()
```

## Refactoring Steps

### Step 1: Remove Storage Dependency from Simulation ✅
- [x] Remove `@quantbot/storage` from `packages/simulation/package.json`
- [ ] Remove storage imports from simulation source files
- [ ] Move storage sinks to workflows/CLI

### Step 2: Move fetchHybridCandles to OHLCV
- [ ] Move `packages/simulation/src/candles.ts` → `packages/ohlcv/src/candles.ts`
- [ ] Update all imports of `fetchHybridCandles`
- [ ] Remove `@quantbot/simulation` dependency from OHLCV
- [ ] Update OHLCV engine to use local `fetchHybridCandles`

### Step 3: Remove Network/DB Code from Simulation Engine
- [ ] Remove `fetchHybridCandles` call from `engine.ts`
- [ ] Update `SimulationEngine.run()` to only accept candles as input
- [ ] Remove all axios/API imports from simulation
- [ ] Remove all storage imports from simulation

### Step 4: Move Orchestration to Workflows/CLI
- [ ] Move `packages/simulation/src/core/orchestrator.ts` → `packages/cli/src/workflows/` or `packages/workflows/`
- [ ] Move storage sinks to workflows layer
- [ ] Update CLI commands to use new orchestrator location

### Step 5: Update Core Package
- [ ] Ensure `@quantbot/core` only has types (Candle, Alert, Mint, SimConfig, SimResult)
- [ ] Add Zod validators to core types
- [ ] Remove any business logic from core

### Step 6: Update Tests
- [ ] Update simulation tests to pass candles directly (no fetching)
- [ ] Update OHLCV tests to use local `fetchHybridCandles`
- [ ] Add integration tests for workflow layer

## Files to Move/Refactor

### Move from simulation to ohlcv:
- `packages/simulation/src/candles.ts` → `packages/ohlcv/src/candles.ts`

### Move from simulation to workflows/CLI:
- `packages/simulation/src/core/orchestrator.ts` → `packages/cli/src/workflows/simulation-orchestrator.ts`
- `packages/simulation/src/storage/*` → `packages/cli/src/workflows/storage/` or archive

### Remove from simulation:
- All `@quantbot/storage` imports
- All `axios`/network code
- All database access

## Verification Checklist

After refactoring, verify:

- [ ] `packages/simulation/package.json` has NO:
  - `@quantbot/storage`
  - `@quantbot/api-clients`
  - `@quantbot/ohlcv`
  - `@quantbot/ingestion`
  - `axios`

- [ ] `packages/simulation/src/engine.ts` has NO:
  - `fetchHybridCandles` calls
  - Storage imports
  - Network imports

- [ ] `packages/ohlcv/src/ohlcv-engine.ts` has NO:
  - `@quantbot/simulation` imports

- [ ] All workflows are in:
  - `packages/cli/src/commands/*.ts` OR
  - `packages/workflows/src/*.ts`

- [ ] Simulation engine signature:
  ```typescript
  run(candles: Candle[], config: SimConfig): SimResult
  ```
  (No mint, no network calls, just candles + config)

## Notes

- This is a breaking change - all code using simulation will need updates
- Tests will need significant refactoring
- CLI commands are the natural place for workflows (they already orchestrate)
- Consider creating `packages/workflows/` if orchestration logic grows large

