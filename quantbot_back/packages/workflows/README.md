# @quantbot/workflows

Orchestration layer for QuantBot simulation workflows.

## Purpose

This package provides high-level workflow orchestration that coordinates:
- Strategy retrieval
- Call data fetching
- OHLCV candle retrieval
- Simulation execution
- Results persistence

## Key Concepts

### WorkflowContext
Dependency injection container that provides:
- `clock`: Time source (for deterministic testing)
- `ids`: ID generation (for deterministic testing)
- `logger`: Logging interface
- `repos`: Data access layer (strategies, calls, simulation runs/results)
- `ohlcv`: Candle data provider
- `simulation`: Pure compute engine

### runSimulation Workflow
Main workflow that:
1. Validates input spec (Zod schema)
2. Loads strategy by name
3. Fetches calls in date range
4. Deduplicates calls by ID
5. For each call:
   - Fetches candles with time window
   - Runs simulation
   - Captures per-call errors (doesn't fail entire run)
6. Computes aggregate statistics (PnL min/max/mean/median)
7. Persists results (unless dryRun=true)

## Testing

See `README_TESTING.md` and `tests/MUTATION_CHECKLIST.md`.

Golden test suite covers:
- Dry run vs persist modes
- Error handling (missing strategy, invalid dates, per-call errors)
- Deduplication and ordering
- Windowing logic
- Statistics correctness

## Usage Example

```typescript
import { runSimulation } from "@quantbot/workflows";
import { DateTime } from "luxon";

const result = await runSimulation(
  {
    strategyName: "IchimokuV1",
    callerName: "Brook",
    from: DateTime.fromISO("2025-10-01T00:00:00.000Z"),
    to: DateTime.fromISO("2025-12-01T00:00:00.000Z"),
    options: {
      dryRun: false,
      preWindowMinutes: 60,
      postWindowMinutes: 120
    }
  },
  context
);

console.log(result.totals);
console.log(result.pnl);
```

