# TypeScript ↔ Python Orchestration: V1 Baseline Optimizer

**Status**: ✅ Complete  
**Date**: 2026-01-10  
**Architecture Policy**: Python bears the brunt of data science workload, TypeScript orchestrates

---

## Summary

The V1 Baseline Optimizer now has a complete TypeScript orchestration layer that integrates with the Python implementation. TypeScript handles data loading, planning, and coverage checks, while Python handles the computationally intensive simulation and optimization.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TypeScript Layer                             │
│  (Orchestration, Data Loading, Validation)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  CLI Handler                                                      │
│  └─> v1-baseline-optimizer.ts                                    │
│       ├─> Load calls from DuckDB                                 │
│       ├─> Plan backtest & check coverage                         │
│       ├─> Materialize slices & load candles                      │
│       └─> Call V1BaselinePythonService                           │
│                                                                   │
│  Service Layer                                                    │
│  └─> V1BaselinePythonService                                     │
│       ├─> Wraps PythonEngine calls                               │
│       ├─> Validates input/output with Zod                        │
│       └─> Handles errors & timeouts                              │
│                                                                   │
│  PythonEngine                                                     │
│  └─> Executes Python scripts via stdin                           │
│       ├─> Spawns subprocess                                      │
│       ├─> Sends JSON input                                       │
│       └─> Validates JSON output                                  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓ stdin/stdout
┌─────────────────────────────────────────────────────────────────┐
│                      Python Layer                                │
│  (Computation, Simulation, Optimization)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  v1_baseline_optimizer.py                                        │
│  ├─> main_stdin() - Entry point                                  │
│  ├─> optimize_v1_baseline() - Grid search                        │
│  │    └─> ThreadPoolExecutor for parallel evaluation             │
│  ├─> optimize_v1_baseline_per_caller() - Per-caller opt          │
│  └─> run_v1_baseline_grouped_evaluation() - Grouped eval         │
│                                                                   │
│  v1_baseline_simulator.py                                        │
│  ├─> simulate_capital_aware() - Main simulation                  │
│  ├─> calculate_position_size() - Position sizing                 │
│  ├─> execute_entry() - Trade entry                               │
│  ├─> find_exit_in_candles() - Exit detection                     │
│  └─> execute_exit() - Trade exit & capital update                │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components

### TypeScript Components

1. **V1BaselinePythonService** (`packages/backtest/src/services/v1-baseline-python-service.ts`)
   - Wraps PythonEngine calls
   - Provides type-safe interface to Python optimizer
   - Validates input/output with Zod schemas
   - Handles errors and timeouts

2. **Handler** (`packages/cli/src/handlers/backtest/v1-baseline-optimizer.ts`)
   - Loads calls from DuckDB
   - Plans backtest and checks coverage
   - Materializes slices and loads candles
   - Prepares data for Python service
   - Calls Python service methods
   - Formats output for CLI

3. **CommandContext** (`packages/cli/src/core/command-context.ts`)
   - Provides `v1BaselinePython()` service factory
   - Lazy service creation
   - Dependency injection

4. **Zod Schemas** (in `v1-baseline-python-service.ts`)
   - `V1BaselineParamsSchema`
   - `CapitalSimulatorConfigSchema`
   - `TradeExecutionSchema`
   - `CapitalSimulationResultSchema`
   - `V1BaselineOptimizationResultSchema`
   - `V1BaselinePerCallerResultSchema`
   - `V1BaselineGroupedResultSchema`

### Python Components

1. **Optimizer** (`tools/backtest/lib/v1_baseline_optimizer.py`)
   - Grid search optimization
   - Per-caller optimization
   - Grouped evaluation
   - Threading support (configurable via `V1_OPTIMIZER_THREADS`)
   - Stdin wrapper for TypeScript integration

2. **Simulator** (`tools/backtest/lib/v1_baseline_simulator.py`)
   - Capital-aware simulation
   - Position sizing
   - Trade entry/exit
   - Fee calculation
   - Stdin wrapper for TypeScript integration

---

## Data Flow

### 1. Handler → Service

```typescript
const pythonService = ctx.services.v1BaselinePython();

const result = await pythonService.optimizeV1Baseline({
  calls: callsForPython,
  candles_by_call_id: candlesForPython,
  param_grid: { tp_mults, sl_mults, max_hold_hrs },
  simulator_config: { initial_capital, max_allocation_pct, ... },
  verbose: false,
});
```

### 2. Service → PythonEngine

```typescript
const result = await this.pythonEngine.runScriptWithStdin(
  'tools/backtest/lib/v1_baseline_optimizer.py',
  { operation: 'optimize', ...config },
  V1BaselineOptimizationResultSchema,
  { timeout: 600000, cwd, env: { PYTHONPATH } }
);
```

### 3. PythonEngine → Python Script

```bash
python tools/backtest/lib/v1_baseline_optimizer.py < input.json > output.json
```

### 4. Python Script Execution

```python
def main_stdin():
    input_data = json.load(sys.stdin)
    operation = input_data.get("operation")
    
    if operation == "optimize":
        result = optimize_v1_baseline(...)
        output = { "best_params": ..., "best_final_capital": ..., ... }
        json.dump(output, sys.stdout)
```

### 5. PythonEngine → Service (Validation)

```typescript
const result = await this.pythonEngine.runScriptWithStdin(...);
// result is validated against V1BaselineOptimizationResultSchema
return result; // Type: V1BaselineOptimizationResult
```

### 6. Service → Handler

```typescript
const result = await pythonService.optimizeV1Baseline(...);
// result.best_params, result.best_final_capital, etc.
```

---

## Threading Support

The Python optimizer now supports parallel grid search using `ThreadPoolExecutor`:

```python
# Determine number of workers (default: CPU count or 4)
max_workers = int(os.environ.get("V1_OPTIMIZER_THREADS", os.cpu_count() or 4))

# Execute in parallel
with ThreadPoolExecutor(max_workers=max_workers) as executor:
    future_to_params = {
        executor.submit(evaluate_params, tp, sl, mh): (tp, sl, mh)
        for tp, sl, mh in param_combinations
    }
    
    for future in as_completed(future_to_params):
        result_dict = future.result()
        results.append(result_dict)
```

**Configuration**:

- Set `V1_OPTIMIZER_THREADS` environment variable to control thread count
- Default: `os.cpu_count()` or 4
- Example: `V1_OPTIMIZER_THREADS=8 quantbot backtest v1-baseline ...`

---

## Testing

### Integration Tests

**Location**: `packages/backtest/src/services/__tests__/v1-baseline-python-service.integration.test.ts`

**Tests** (4 tests, all passing):

1. ✅ `should simulate capital-aware trade with Python`
2. ✅ `should optimize V1 baseline parameters with Python`
3. ✅ `should optimize per caller with Python`
4. ✅ `should run grouped evaluation with Python`

**Run tests**:

```bash
pnpm --filter @quantbot/backtest test -- src/services/__tests__/v1-baseline-python-service.integration.test.ts
```

### Python Tests

**Location**: `tools/backtest/tests/`

**Tests** (27 tests, all passing):

- Unit tests: `test_v1_baseline_simulator.py` (13 tests)
- Optimizer tests: `test_v1_baseline_optimizer.py` (8 tests)
- Golden tests: `test_v1_baseline_golden.py` (6 tests)

**Run tests**:

```bash
cd tools/backtest
python -m pytest tests/test_v1_baseline*.py -v
```

---

## Usage

### CLI Command

```bash
quantbot backtest v1-baseline \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --mode grouped \
  --initial-capital 10000 \
  --max-allocation-pct 0.05 \
  --max-risk-per-trade 0.02 \
  --max-concurrent-positions 25 \
  --filter-collapsed \
  --filter-extreme
```

### Programmatic Usage

```typescript
import { V1BaselinePythonService } from '@quantbot/backtest';
import { PythonEngine } from '@quantbot/utils';

const pythonEngine = new PythonEngine();
const service = new V1BaselinePythonService(pythonEngine);

const result = await service.optimizeV1Baseline({
  calls: [
    { id: 'call1', mint: 'TOKEN_A', caller: 'CallerA', ts_ms: 1735689600000 },
  ],
  candles_by_call_id: {
    call1: [
      { timestamp: 1735689600, open: 1.0, high: 2.5, low: 0.95, close: 2.3, volume: 1000 },
    ],
  },
  param_grid: {
    tp_mults: [1.5, 2.0, 2.5],
    sl_mults: [0.85, 0.9],
    max_hold_hrs: [48.0],
  },
  simulator_config: {
    initial_capital: 10000,
    max_allocation_pct: 0.05,
    max_risk_per_trade: 0.02,
    max_concurrent_positions: 25,
  },
});

console.log(result.best_params);
console.log(result.best_final_capital);
```

---

## Benefits

### 1. **Performance**

- Python handles computationally intensive grid search
- Threading support for parallel evaluation
- TypeScript only handles I/O and orchestration

### 2. **Type Safety**

- Zod schemas validate Python output
- TypeScript types ensure correctness
- Compile-time checks for service calls

### 3. **Maintainability**

- Clear separation of concerns
- Python for data science, TypeScript for orchestration
- Single source of truth for optimization logic (Python)

### 4. **Testability**

- Integration tests verify TypeScript ↔ Python flow
- Python unit tests verify simulation correctness
- Golden tests ensure deterministic behavior

### 5. **Flexibility**

- Easy to add new optimization modes
- Simple to adjust parameter grids
- Configurable threading for performance tuning

---

## Future Enhancements

1. **Caching**: Cache optimization results for repeated parameter grids
2. **Streaming**: Stream progress updates during long optimizations
3. **Distributed**: Distribute grid search across multiple processes/machines
4. **Visualization**: Real-time visualization of optimization progress
5. **Auto-tuning**: Automatically adjust parameter grids based on results

---

## Related Documentation

- [Python V1 Baseline Optimizer Implementation](./python-v1-baseline-optimizer-implementation.md)
- [Python DB Driver Decision](./PYTHON_DB_DRIVER_DECISION.md)
- [V1 Baseline Optimizer Policy Violation Review](../reviews/v1-baseline-optimizer-policy-violation.md)
- [CLI Handlers and Commands Rules](./.cursor/rules/cli-handlers-commands.mdc)

---

## Conclusion

The TypeScript orchestration layer is now complete and fully integrated with the Python V1 Baseline Optimizer. The system adheres to the architectural policy: **Python bears the brunt of data science workload, TypeScript orchestrates**. All tests pass, and the system is ready for production use.
