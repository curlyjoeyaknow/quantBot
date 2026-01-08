# Integration Hardening Pass

**Date**: 2026-01-06  
**Status**: ✅ Complete

## Objective

Lock in the integration between `@quantbot/backtest` and `@quantbot/simulation` to prevent drift via re-export sprawl. Make the integration "boring and unbreakable."

## Checklist Completed

### 1. ✅ Dependency Graph Sanity

**Result**: No circular dependencies detected.

- Verified `@quantbot/simulation` does NOT import from `@quantbot/backtest` (even indirectly)
- Confirmed `@quantbot/backtest` CAN import from `@quantbot/simulation` (expected)
- Added automated check: `scripts/check-dependency-cycles.sh`

**Action**: Engine now uses re-exported `runOverlaySimulation` from `@quantbot/simulation` directly instead of local bridge.

### 2. ✅ Contract Tests for Re-exported Modules

**Created 5 contract test suites**:

1. **`indicators.contract.test.ts`** - Tests EMA, SMA, RSI, Ichimoku, MACD
   - Verifies symbols exist and are callable
   - Ensures deterministic output
   - Tests warmup/boundary behavior (early candles)
   - Validates call signature stability

2. **`overlay-simulation.contract.test.ts`** - Tests `runOverlaySimulation`
   - Verifies structure matches `OverlaySimulationResult` type
   - Tests multiple overlays (take_profit, stop_loss, time_exit)
   - Ensures deterministic output
   - Validates call signature stability

3. **`execution-models.contract.test.ts`** - Tests execution models
   - Tests `createPumpfunExecutionModel`, `createPumpswapExecutionModel`, `createMinimalExecutionModel`
   - Verifies explicit separation between Pump.fun and PumpSwap defaults
   - Tests `calculateSlippage` and `sampleLatency` with seeded RNG
   - Ensures latency sampling determinism

4. **`signal-eval.contract.test.ts`** - Tests signal evaluation
   - Tests `evaluateSignalGroup`
   - Verifies deterministic output
   - Tests boundary conditions (early candles)

5. **`path-metrics.contract.test.ts`** - Tests path metrics
   - Tests `computePathMetrics` and `calculatePeriodAthAtlFromCandles`
   - Verifies structure matches expected types
   - Tests boundary conditions

**Purpose**: These tests prevent "minor refactor in simulation broke backtest API" from becoming your new hobby.

### 3. ✅ Single Source of Truth Enforcement

**Analysis**: The `packages/backtest/src/sim/` directory contains:

- **Local implementations** (not duplicates):
  - `BacktestBaselineService` - backtest-specific
  - `DuckDBStorageService`, `ClickHouseService`, `SimulationService` - backtest-specific storage
  - `CausalCandleAccessor` - backtest-specific types
  - `calculateTradeFee` - backtest-specific execution utility

- **Re-export bridges** (not duplicates):
  - `overlay-simulation.ts` - re-exports from `@quantbot/simulation` (now unused by engine, kept for backwards compat)

**Action**: Engine now imports `runOverlaySimulation` directly from `@quantbot/simulation` instead of local bridge.

### 4. ✅ Runtime/Side-Effect Audit

**Findings**:
- Simulation imports don't auto-init global caches
- No heavyweight optional deps pulled at import time
- Tree-shaking remains viable (exports are explicit)

**No action needed**: Integration is already side-effect free.

### 5. ✅ Dependency Cycle Check in CI

**Created**: `scripts/check-dependency-cycles.sh`

- Checks that simulation does not import from backtest
- Verifies backtest imports from simulation (expected)
- Warns about indirect cycles via other packages

**Next step**: Add to CI pipeline (recommended in `package.json` scripts or GitHub Actions).

## Changes Made

### Code Changes

1. **`packages/backtest/src/engine/index.ts`**
   - Changed import from `'../sim/overlay-simulation.js'` to `'@quantbot/simulation'`
   - Now uses re-exported version directly (single source of truth)

### New Files

1. **Contract Tests** (5 files):
   - `packages/backtest/tests/contract/indicators.contract.test.ts`
   - `packages/backtest/tests/contract/overlay-simulation.contract.test.ts`
   - `packages/backtest/tests/contract/execution-models.contract.test.ts`
   - `packages/backtest/tests/contract/signal-eval.contract.test.ts`
   - `packages/backtest/tests/contract/path-metrics.contract.test.ts`

2. **Dependency Cycle Check**:
   - `scripts/check-dependency-cycles.sh`

## Gotchas Addressed

### Indicator Warmup / Boundary Behavior
- Contract tests cover "early candles" scenarios
- Tests verify graceful handling of insufficient history

### Latency Sampling Determinism
- Contract tests use seeded RNG for deterministic results
- Tests verify same inputs produce same outputs

### Pump.fun vs PumpSwap Execution
- Contract tests verify explicit separation between factory defaults
- Tests ensure no accidental mixing of execution models

## Next Steps (Completed)

1. ✅ **Added to CI**: Created `.github/workflows/integration-hardening.yml` with dependency cycle check and contract tests
2. ✅ **Test scripts**: Added `test:contract` and `check:dependency-cycles` scripts to root `package.json`
3. ✅ **Contract tests**: 5 test suites created covering all high-value re-exported modules
4. **Monitor**: Watch for contract test failures when simulation package changes (ongoing)
5. **Documentation**: Update release notes when simulation package changes (ongoing)

## Release Notes Template

When simulation package changes, document:

```
## Backtest Integration Changes

Backtest now delegates X/Y/Z to Simulation; behavior should be identical except for:
- [List any measurable diffs]
- [Slippage model defaults]
- [Latency sampling]
- [Indicator edge behavior at warmup boundaries]
```

## Win Condition

✅ **Achieved**: Contract-test suite that makes Simulation refactors safe.

- ✅ 5 contract test files covering all high-value re-exported modules
- ✅ 55/55 tests passing (100% pass rate)
- ✅ Dependency cycle check prevents architectural drift
- ✅ Single source of truth enforced (engine uses re-exported version)
- ✅ Determinism verified (seeded RNG, deterministic outputs)
- ✅ Tests import directly from `@quantbot/simulation` to avoid dependency issues

**Result**: One engine, many entry points. Integration is now "boring and unbreakable."

## Test Results

```
Test Files  5 passed (5)
Tests  55 passed (55)
```

All contract tests verify:
- Symbols exist and are callable
- Deterministic output for same inputs
- Call signature stability
- Boundary condition handling (early candles, insufficient history)

