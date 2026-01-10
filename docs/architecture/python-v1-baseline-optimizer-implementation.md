# Python V1 Baseline Optimizer Implementation

**Status**: ✅ Complete (Phase 1)  
**Date**: 2026-01-10  
**Policy**: Python bears the brunt of data science workload, TypeScript orchestrates

## Overview

Complete Python implementation of the V1 Baseline capital-aware optimizer, ported from TypeScript. This implementation moves 909 lines of data science logic from TypeScript to Python, adhering to the architectural policy that **Python handles computation, TypeScript handles orchestration**.

## Implementation Summary

### Phase 1: Python Implementation (Complete)

All Python components are implemented and tested:

1. ✅ **Capital Simulator** (`lib/v1_baseline_simulator.py`) - 564 lines
2. ✅ **Grid Search Optimizer** (`lib/v1_baseline_optimizer.py`) - 345 lines
3. ✅ **CLI Script** (`run_v1_baseline_optimizer.py`) - Template ready
4. ✅ **Unit Tests** (27 tests, all passing)
5. ✅ **Golden Tests** (6 deterministic scenarios)

### Phase 2: TypeScript Orchestration (Next)

TypeScript layer will be wired up after Python scripts work individually (as requested).

## Files Created

### Core Library

```
tools/backtest/lib/
├── v1_baseline_simulator.py      # Capital-aware simulator (564 lines)
└── v1_baseline_optimizer.py      # Grid search optimizer (345 lines)
```

### CLI

```
tools/backtest/
└── run_v1_baseline_optimizer.py  # CLI script (template)
```

### Tests

```
tools/backtest/tests/
├── test_v1_baseline_simulator.py  # 13 unit tests
├── test_v1_baseline_optimizer.py  # 8 optimizer tests
└── test_v1_baseline_golden.py     # 6 golden tests
```

## Test Results

All 27 tests pass:

```bash
cd tools/backtest
python -m pytest tests/test_v1_baseline*.py -v
# 27 passed in 0.15s
```

### Test Coverage

**Simulator Tests (13)**:
- Position sizing (risk, allocation, cash constraints)
- Entry execution (at alert time, delayed)
- Exit detection (TP, SL, time)
- Capital state management
- Fee calculation
- Concurrent position limits
- Path-dependent capital
- Minimum executable size

**Optimizer Tests (8)**:
- Grid search (all combinations, defaults)
- Result ranking (by final capital)
- Per-caller optimization
- Collapsed capital detection
- Extreme parameter detection
- Grouped evaluation with filtering
- Parameter averaging

**Golden Tests (6)**:
- Simple pump scenario (TP exit)
- Instant rug scenario (SL exit)
- Multi-call capital constraint
- Optimizer finds best params
- Concurrent position limit
- Fee calculation exactness

## Architecture

### Data Flow

```
Alerts (DuckDB) → Candles (Slice) → Python Simulator → Optimization Results
```

### Key Components

#### 1. Capital Simulator

**File**: `lib/v1_baseline_simulator.py`

**Core Function**:
```python
def simulate_capital_aware(
    calls: List[Dict[str, Any]],
    candles_by_call_id: Dict[str, List[Dict[str, Any]]],
    params: V1BaselineParams,
    config: Optional[CapitalSimulatorConfig] = None,
) -> CapitalSimulationResult
```

**Features**:
- Initial capital: C₀ = 10,000
- Max allocation per trade: 4% of free cash
- Max risk per trade: $200
- Max concurrent positions: 25
- Position sizing: `min(size_risk, size_alloc, free_cash)`
- Trade lifecycle: TP at `tp_mult`, SL at `sl_mult`, Time exit at 48h
- Objective: maximize final capital (C_final)

#### 2. Grid Search Optimizer

**File**: `lib/v1_baseline_optimizer.py`

**Core Functions**:
```python
def optimize_v1_baseline(...) -> V1BaselineOptimizationResult
def optimize_v1_baseline_per_caller(...) -> Dict[str, V1BaselinePerCallerResult]
def run_v1_baseline_grouped_evaluation(...) -> Dict[str, Any]
```

**Features**:
- Grid search over TP/SL/max_hold_hrs
- Per-caller optimization
- Collapsed capital detection (C_final < C₀)
- Extreme parameter detection (SL < 0.88 or TP > 4.0)
- Grouped evaluation with filtering

#### 3. CLI Script

**File**: `run_v1_baseline_optimizer.py`

**Usage**:
```bash
python3 run_v1_baseline_optimizer.py \
  --from 2025-12-01 --to 2025-12-24 \
  --mode both \
  --initial-capital 10000 \
  --max-allocation-pct 0.04
```

**Note**: Slice loading not yet implemented in CLI. Script serves as template for integration.

## Data Structures

### Candle Format (Python dict from DuckDB)

```python
{
    "timestamp": float,  # seconds (converted to ms in simulator)
    "open": float,
    "high": float,
    "low": float,
    "close": float,
    "volume": float
}
```

### Call/Alert Format

```python
{
    "id": str,
    "mint": str,
    "caller": str,
    "ts_ms": int  # milliseconds
}
```

## Default Parameter Grids

```python
DEFAULT_TP_MULTS = [1.5, 2.0, 2.5, 3.0, 4.0, 5.0]
DEFAULT_SL_MULTS = [0.85, 0.88, 0.9, 0.92, 0.95]
DEFAULT_MAX_HOLD_HRS = [48.0]
```

Total combinations: 6 × 5 × 1 = 30

## Key Differences from TypeScript

### 1. Data Types

| TypeScript | Python |
|------------|--------|
| `interface` | `@dataclass` |
| `Map<K, V>` | `Dict[K, V]` |
| `Array<T>` | `List[T]` |
| `Candle` (class) | `dict` (from DuckDB) |

### 2. Timestamp Handling

- TypeScript: `DateTime` (Luxon), milliseconds
- Python: `int` (milliseconds), `datetime` for parsing

### 3. Candle Format

- TypeScript: `Candle` class with `timestamp` in seconds
- Python: `dict` with `timestamp` in seconds (converted to ms in simulator)

## Integration Points

### Current State

Python implementation is **standalone and tested**. Can be called directly:

```python
from lib.v1_baseline_simulator import simulate_capital_aware, V1BaselineParams
from lib.v1_baseline_optimizer import optimize_v1_baseline

# Simulate
result = simulate_capital_aware(calls, candles_by_call_id, params)

# Optimize
opt_result = optimize_v1_baseline(calls, candles_by_call_id, param_grid)
```

### Next Steps (Phase 2: TypeScript Orchestration)

1. **Create TypeScript Service** (`packages/backtest/src/services/v1-baseline-python-service.ts`)
   - Wraps `PythonEngine` calls
   - Validates input/output with Zod schemas
   - Handles errors and logging

2. **Update Handler** (`packages/cli/src/handlers/backtest/v1-baseline-optimizer.ts`)
   - Replace direct calls to TypeScript simulator/optimizer
   - Call Python service instead
   - Keep data loading and result formatting in TypeScript

3. **Add to CommandContext** (`packages/cli/src/core/command-context.ts`)
   - Add `v1BaselinePythonService()` method
   - Lazy initialization with `PythonEngine`

4. **Integration Tests**
   - Verify TypeScript → Python → TypeScript round-trip
   - Compare results with TypeScript implementation (parity check)
   - Test error handling and edge cases

## Verification

### Run All Tests

```bash
cd tools/backtest
python -m pytest tests/test_v1_baseline*.py -v
```

### Run Specific Test Suites

```bash
# Simulator tests
python -m pytest tests/test_v1_baseline_simulator.py -v

# Optimizer tests
python -m pytest tests/test_v1_baseline_optimizer.py -v

# Golden tests
python -m pytest tests/test_v1_baseline_golden.py -v
```

### Direct Usage (Python REPL)

```python
import sys
sys.path.insert(0, 'tools/backtest')

from lib.v1_baseline_simulator import *
from lib.v1_baseline_optimizer import *

# Create test data
calls = [{"id": "call1", "mint": "TOKEN_A", "caller": "Test", "ts_ms": 1735689600000}]
candles = [
    {"timestamp": 1735689600, "open": 1.0, "high": 1.05, "low": 0.95, "close": 1.0, "volume": 1000},
    {"timestamp": 1735689660, "open": 1.0, "high": 2.5, "low": 0.95, "close": 2.3, "volume": 1000},
]
candles_by_call_id = {"call1": candles}

# Simulate
params = V1BaselineParams(tp_mult=2.0, sl_mult=0.85)
result = simulate_capital_aware(calls, candles_by_call_id, params)
print(f"Final capital: ${result.final_capital:.2f}")

# Optimize
opt_result = optimize_v1_baseline(calls, candles_by_call_id)
print(f"Best params: {opt_result.best_params}")
```

## Success Criteria (Phase 1) ✅

All criteria met:

- [x] All unit tests pass
- [x] Golden tests match expected values
- [x] CLI script template created
- [x] Code follows Python best practices
- [x] Documentation complete
- [x] CHANGELOG updated

## Next Phase

**Phase 2: TypeScript Orchestration**

Wire up TypeScript handler to call Python scripts via `PythonEngine`. This will complete the migration and allow the `quantbot backtest v1-baseline-optimizer` command to use the Python implementation.

See: `docs/reviews/v1-baseline-optimizer-policy-violation.md` for migration plan.

## References

- Original TypeScript implementation: `packages/backtest/src/optimization/`
- Policy document: `docs/architecture/PYTHON_DB_DRIVER_DECISION.md`
- Migration plan: `docs/reviews/v1-baseline-optimizer-policy-violation.md`
- CLI pattern: `tools/backtest/run_optimizer.py`


