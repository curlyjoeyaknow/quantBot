# Simulation Package Migration to Backtest

## Overview

The `@quantbot/simulation` package has been migrated into `@quantbot/backtest`. All simulation functionality is now consolidated in a unified module.

## Migration Date

Migration completed: 2024

## What Changed

1. **Python Simulation**: Core simulation logic migrated from TypeScript to Python
   - Location: `tools/backtest/lib/simulation/`
   - Main module: `simulator.py`
   - Helper modules: `entry.py`, `reentry.py`, `trailing_stop.py`

2. **TypeScript Simulation**: Remains available in `@quantbot/backtest` package
   - Location: `packages/backtest/src/sim/`
   - Provides same API as before

3. **Backward Compatibility**: `@quantbot/simulation` package now re-exports from `@quantbot/backtest`
   - All existing imports continue to work
   - Package is marked as deprecated

## Migration Guide

### Update Imports

**Before:**
```typescript
import { simulateStrategy } from '@quantbot/simulation';
import { runOverlaySimulation } from '@quantbot/simulation';
import { calculateIchimoku } from '@quantbot/simulation/indicators';
import type { ExecutionModel } from '@quantbot/simulation/execution-models';
```

**After:**
```typescript
import { simulateStrategy } from '@quantbot/backtest';
import { runOverlaySimulation } from '@quantbot/backtest';
import { calculateIchimoku } from '@quantbot/backtest';
import type { ExecutionModel } from '@quantbot/backtest';
```

### Using Python Simulation

The Python simulation is now the primary implementation. To use it:

```typescript
import { PythonSimulationService } from '@quantbot/backtest';
import { PythonEngine } from '@quantbot/utils';

const pythonEngine = new PythonEngine();
const simulationService = new PythonSimulationService(pythonEngine);

const result = await simulationService.runSimulation(simInput);
```

### Validate Python Setup

```bash
quantbot backtest validate-simulation
```

## Testing

All migration tests are passing:
- 10 parallel tests comparing Python vs TypeScript simulation outputs
- All tests confirm identical behavior between implementations
- No regressions detected

## Files Structure

```
tools/backtest/lib/simulation/
├── __init__.py
├── contracts.py           # Canonical contracts (SimInput, SimResult)
├── simulator.py           # Main Python simulator
├── entry.py               # Entry detection logic
├── reentry.py             # Re-entry validation
└── trailing_stop.py       # Trailing stop management

packages/backtest/src/sim/
├── core/                  # Core simulation logic (TypeScript)
├── indicators/            # Technical indicators
├── execution-models/      # Execution models
├── signals/               # Signal evaluation
└── ...                    # Other simulation modules
```

## Status

- ✅ Python simulation: Fully functional and tested
- ✅ TypeScript simulation: Available via backward compatibility
- ✅ Tests: All 10 parallel tests passing
- ✅ Backward compatibility: Working
- ⚠️ TypeScript build: Some type mismatches in execution models (non-blocking)

## Next Steps

1. Update all code to use `@quantbot/backtest` directly
2. Remove `@quantbot/simulation` package in a future major version
3. Consolidate execution model types (remove old definition)

## Rollback

If issues arise, the TypeScript simulation remains available at:
- `packages/backtest/src/sim/core/simulator.ts`
- Can be used directly via `@quantbot/backtest`

