# V1 Baseline Optimizer - Policy Violation Analysis

**Date**: 2025-01-10  
**Status**: ❌ **VIOLATION FOUND**  
**Policy**: PYTHON bears the brunt of the data science workload; TypeScript orchestrates

## Executive Summary

The `v1-baseline-optimizer` handler and its optimization logic **violate the architectural policy** that Python should handle data science workloads while TypeScript orchestrates. Currently, **ALL optimization, simulation, and evaluation logic is implemented in TypeScript**, which is incorrect.

## Current Implementation Analysis

### TypeScript Files Doing Data Science Work ❌

1. **`packages/cli/src/handlers/backtest/v1-baseline-optimizer.ts`**
   - Handler orchestrates, but calls TypeScript optimization functions (correct pattern, wrong target)

2. **`packages/backtest/src/optimization/v1-baseline-optimizer.ts`**
   - ❌ **Grid search over parameter combinations** (tp_mult, sl_mult, max_hold_hrs)
   - ❌ **Per-caller optimization logic**
   - ❌ **Grouped evaluation logic**
   - ❌ **Result ranking and filtering**

3. **`packages/backtest/src/optimization/capital-simulator.ts`** (489 lines)
   - ❌ **Capital-aware simulation** (path-dependent capital management)
   - ❌ **Position sizing calculations** (risk-based, allocation-based)
   - ❌ **Trade execution logic** (entry/exit detection)
   - ❌ **Exit detection** (TP/SL/Time exits from candle streams)
   - ❌ **PnL and fee calculations**
   - ❌ **Capital state management** (free cash, total capital, unrealized PnL)

### What Should Be in Python ✅

All of the above data science work should be in Python:

1. **Capital Simulator** (`tools/backtest/lib/v1_baseline_simulator.py`)
   - Position sizing calculations
   - Trade execution (entry/exit from candles)
   - Capital state management
   - PnL and fee calculations

2. **Optimizer** (`tools/backtest/lib/v1_baseline_optimizer.py`)
   - Grid search over parameter space
   - Per-caller optimization
   - Grouped evaluation
   - Result ranking and filtering

### What Should Stay in TypeScript ✅

1. **Handler** (`packages/cli/src/handlers/backtest/v1-baseline-optimizer.ts`)
   - ✅ Data loading (calls, candles)
   - ✅ Parameter validation and schema checking
   - ✅ Calling Python script via PythonEngine
   - ✅ Result formatting for CLI output
   - ❌ Currently calls TypeScript optimization functions (MUST CHANGE)

## Policy Reference

From architecture documents and rules:

> **PYTHON bears the brunt of the data science workload**  
> **TypeScript orchestrates**

### Allowed Python Usage (from `PYTHON_DB_DRIVER_DECISION.md`):

- ✅ **Batch/analytics operations**:
  - Feature transforms
  - Big aggregation queries
  - Report generation
  - Snapshot loading
  - Bulk artifact writes
  - **Optimization and simulation** (data science workload)

### Pattern to Follow

Looking at existing correct patterns:

**Example: `packages/simulation/src/simulation-service.ts`**
```typescript
// ✅ CORRECT: Service wraps PythonEngine calls
export class SimulationService {
  constructor(private readonly pythonEngine: PythonEngine) {}
  
  async runSimulation(config: SimulationConfig): Promise<SimulationOutput> {
    const scriptPath = 'tools/simulation/run_simulation.py';
    const result = await this.pythonEngine.runScriptWithStdin(
      scriptPath,
      config,
      SimulationOutputSchema,
      { timeout: 300000 }
    );
    return result;
  }
}
```

**Example: Existing Python Optimizer (`tools/backtest/lib/optimizer.py`)**
- ✅ Python handles grid search
- ✅ Python handles backtest execution
- ✅ Python handles result ranking
- ✅ TypeScript calls via CLI (or could call via PythonEngine)

## Comparison with Existing Python Optimizer

There **IS** an existing Python optimizer at `tools/backtest/lib/optimizer.py`, but it's for a different use case (TP/SL grid search without capital constraints). This shows the **correct pattern**:

1. Python script (`run_optimizer.py`) handles all optimization logic
2. Python library (`lib/optimizer.py`) contains core algorithms
3. TypeScript doesn't implement optimization logic

**V1 Baseline Optimizer should follow the same pattern.**

## Required Changes

### 1. Create Python Capital Simulator

**File**: `tools/backtest/lib/v1_baseline_simulator.py`

```python
"""
V1 Baseline Capital-Aware Simulator

Simulates trading with finite capital, position constraints, and path-dependent capital management.
"""

from dataclasses import dataclass
from typing import List, Dict, Optional
# ... implementation of capital simulation logic currently in capital-simulator.ts
```

**Responsibilities**:
- Position sizing (`calculatePositionSize`)
- Trade entry execution (`executeEntry`)
- Exit detection (`findExitInCandles`, `checkAndExecuteExits`)
- Capital state management (`CapitalState`)
- PnL and fee calculations

### 2. Create Python V1 Baseline Optimizer

**File**: `tools/backtest/lib/v1_baseline_optimizer.py`

```python
"""
V1 Baseline Optimizer

Performs grid search over parameter combinations to find optimal TP/SL parameters
with capital-aware simulation.
"""

from typing import List, Dict, Optional
from .v1_baseline_simulator import simulate_capital_aware
# ... implementation of optimization logic currently in v1-baseline-optimizer.ts
```

**Responsibilities**:
- Grid search (`optimizeV1Baseline`)
- Per-caller optimization (`optimizeV1BaselinePerCaller`)
- Grouped evaluation (`runV1BaselineGroupedEvaluation`)
- Result ranking and filtering

### 3. Create Python CLI Script

**File**: `tools/backtest/run_v1_baseline_optimizer.py`

```python
#!/usr/bin/env python3
"""
V1 Baseline Optimizer CLI

Run capital-aware optimization via Python script.
"""

import json
import sys
from lib.v1_baseline_optimizer import optimize_v1_baseline
# ... CLI argument parsing and script execution
```

### 4. Create TypeScript Service

**File**: `packages/backtest/src/services/v1-baseline-optimizer-service.ts` (or in storage package)

```typescript
/**
 * V1 Baseline Optimizer Service
 * 
 * Wraps PythonEngine calls for v1-baseline optimization.
 * TypeScript orchestrates; Python does the data science work.
 */
export class V1BaselineOptimizerService {
  constructor(private readonly pythonEngine: PythonEngine) {}
  
  async optimizeV1Baseline(
    config: V1BaselineOptimizerConfig
  ): Promise<V1BaselineOptimizationResult> {
    const scriptPath = 'tools/backtest/run_v1_baseline_optimizer.py';
    const result = await this.pythonEngine.runScriptWithStdin(
      scriptPath,
      config,
      V1BaselineOptimizationResultSchema,
      { timeout: 600000 } // 10 minutes for optimization
    );
    return result;
  }
}
```

### 5. Update Handler to Use Service

**File**: `packages/cli/src/handlers/backtest/v1-baseline-optimizer.ts`

```typescript
export async function v1BaselineOptimizerHandler(
  args: V1BaselineOptimizerArgs,
  ctx: CommandContext
): Promise<unknown> {
  // ✅ Data loading (TypeScript orchestration)
  const calls = await loadCalls(args.from, args.to);
  const candlesByCallId = await loadCandles(calls);
  
  // ✅ Call Python service (TypeScript orchestration)
  const service = ctx.services.v1BaselineOptimizer();
  const result = await service.optimizeV1Baseline({
    calls,
    candlesByCallId,
    paramGrid: { tpMults: args.tpMults, ... },
    simulatorConfig: { initialCapital: args.initialCapital, ... },
    mode: args.mode,
  });
  
  // ✅ Format output (TypeScript orchestration)
  return formatOutput(result, args.format);
}
```

### 6. Remove TypeScript Optimization Logic

**Delete or deprecate**:
- `packages/backtest/src/optimization/v1-baseline-optimizer.ts` (move logic to Python)
- `packages/backtest/src/optimization/capital-simulator.ts` (move logic to Python)

**Keep only types/interfaces** needed for TypeScript-Python boundary:
- Type definitions for config
- Type definitions for results
- Zod schemas for validation

## Migration Steps

1. ✅ **Phase 1: Create Python implementation**
   - Implement capital simulator in Python
   - Implement optimizer in Python
   - Add tests for Python code

2. ✅ **Phase 2: Create TypeScript service wrapper**
   - Create service that calls Python via PythonEngine
   - Add Zod schemas for input/output validation
   - Add service to CommandContext

3. ✅ **Phase 3: Update handler**
   - Update handler to use service instead of direct TypeScript functions
   - Remove TypeScript optimization logic

4. ✅ **Phase 4: Testing and validation**
   - Ensure results match between old (TS) and new (Python) implementations
   - Regression tests to prevent drift
   - Performance benchmarking

5. ✅ **Phase 5: Cleanup**
   - Remove deprecated TypeScript optimization files
   - Update documentation
   - Update tests

## Testing Strategy

### Golden Tests

Create golden test fixtures to ensure Python implementation produces same results as TypeScript:

```python
# tests/test_v1_baseline_golden.py
def test_capital_simulator_golden():
    """Golden test: compare Python vs TypeScript simulator outputs."""
    # Load fixture with known inputs/outputs
    # Run Python implementation
    # Compare outputs (allow small numerical differences)
```

### Regression Tests

Ensure optimization results are stable:

```python
def test_optimization_regression():
    """Regression test: ensure optimization produces consistent results."""
    config = load_regression_config()
    result = optimize_v1_baseline(config)
    assert result.best_params == expected_best_params
```

## Performance Considerations

**Current Concern**: Spawning Python subprocess per optimization run might be slower.

**Solutions**:
1. Use long-lived Python worker (not spawn-per-call) for batch operations
2. Batch multiple optimizations in single Python script invocation
3. Accept process overhead as trade-off for correct architecture

**Note**: The policy explicitly allows Python for batch/analytics operations, which optimization qualifies as.

## Open Questions

1. **Should we maintain backward compatibility?**
   - Option A: Keep TypeScript implementation as deprecated fallback
   - Option B: Hard migration (recommended - cleaner)

2. **Where should the service live?**
   - Option A: `packages/backtest/src/services/` (domain-specific)
   - Option B: `packages/storage/src/services/` (consistent with other Python wrappers)
   - **Recommendation**: `packages/backtest/src/services/` (backtest is the domain)

3. **Should we reuse existing `lib/optimizer.py` infrastructure?**
   - Existing optimizer has different objective (TP/SL without capital)
   - May be able to share some utilities
   - **Recommendation**: Create new `lib/v1_baseline_optimizer.py` but reuse patterns

## Conclusion

The v1-baseline-optimizer **currently violates the architectural policy**. All optimization and simulation logic must be moved to Python, with TypeScript only orchestrating (loading data, calling Python, formatting output).

This is a **significant refactor** but necessary to maintain architectural consistency and enable proper data science tooling (numpy, scipy, pandas, etc.) for future optimizations.

