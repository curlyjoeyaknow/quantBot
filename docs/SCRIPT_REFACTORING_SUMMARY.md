# Script Refactoring Summary

## Overview

The scripts folder contained many individual script files doing similar tasks with slight variations. This refactoring introduces a **reusable middleware system** that allows you to build workflows by composing middleware components instead of writing new scripts for each variation.

## What Was Created

### 1. Core Middleware System (`packages/workflows/src/middleware/`)

- **ScriptExecutor** - Core execution engine that runs middleware in sequence
- **QueryMiddleware** - Reusable database querying
- **ProcessMiddleware** - Reusable item processing with rate limiting and error handling
- **StoreMiddleware** - Reusable result storage

### 2. Pre-built Workflows (`packages/workflows/src/workflows/`)

- **OhlcvFetchWorkflow** - Parameterized OHLCV fetching workflow
- **SimulationWorkflow** - Parameterized simulation workflow

### 3. Example Scripts (`scripts/workflows/`)

- `fetch-ohlcv.ts` - Example using OHLCV fetch workflow
- `run-simulation.ts` - Example using simulation workflow

## Key Benefits

1. **No More Duplicate Scripts** - Same workflow, different parameters
2. **Consistent Error Handling** - All scripts use same error handling patterns
3. **Built-in Rate Limiting** - Automatic rate limiting for API calls
4. **Progress Tracking** - Automatic progress logging
5. **Composable** - Mix and match middleware to create new workflows

## Migration Example

### Before (Custom Script)

```typescript
// scripts/fetch-ohlcv-for-alerts.ts
async function main() {
  const result = await pgPool.query('SELECT ...');
  
  for (const row of result.rows) {
    try {
      const candles = await fetchOHLCV(row.address, ...);
      await storeCandles(candles);
    } catch (error) {
      console.error('Error:', error);
    }
  }
}
```

### After (Workflow Middleware)

```typescript
// scripts/workflows/fetch-ohlcv.ts
const workflow = createOhlcvFetchWorkflow({
  queryType: 'alerts',
  callerNames: ['Brook'],
  limit: 100,
  // ... other parameters
});

const result = await workflow.execute(null);
```

## Usage Examples

### OHLCV Fetching

```bash
# Fetch OHLCV for Brook's alerts
ts-node scripts/workflows/fetch-ohlcv.ts \
  --query-type alerts \
  --caller Brook \
  --from 2024-01-01 \
  --limit 100

# Fetch for multiple callers with custom time windows
ts-node scripts/workflows/fetch-ohlcv.ts \
  --query-type alerts \
  --caller Brook LSY \
  --pre-window-minutes 260 \
  --post-window-minutes 1440
```

### Simulations

```bash
# Run simulation with preset strategy
ts-node scripts/workflows/run-simulation.ts \
  --strategy PT2_SL25 \
  --caller Brook \
  --from 2024-01-01

# Run with custom strategy
ts-node scripts/workflows/run-simulation.ts \
  --strategy '[{"percent":0.5,"target":2.0}]' \
  --caller Brook \
  --from 2024-01-01
```

## Building Custom Workflows

You can compose middleware to create custom workflows:

```typescript
import { ScriptExecutor, createQueryMiddleware, createProcessMiddleware } from '@quantbot/workflows';

const executor = new ScriptExecutor({
  name: 'my-workflow',
  continueOnError: true,
});

executor
  .use(createQueryMiddleware({ /* query config */ }))
  .use(createProcessMiddleware({ /* process config */ }))
  .use(createStoreMiddleware({ /* store config */ }));

const result = await executor.execute(null);
```

## Next Steps

1. **Migrate Existing Scripts** - Gradually migrate existing scripts to use workflows
2. **Add More Workflows** - Create workflows for analysis, migration, etc.
3. **Add More Middleware** - Create middleware for common patterns (filtering, aggregation, etc.)
4. **Documentation** - Add more examples and use cases

## Files Created

- `packages/workflows/src/middleware/ScriptExecutor.ts`
- `packages/workflows/src/middleware/QueryMiddleware.ts`
- `packages/workflows/src/middleware/ProcessMiddleware.ts`
- `packages/workflows/src/middleware/StoreMiddleware.ts`
- `packages/workflows/src/workflows/OhlcvFetchWorkflow.ts`
- `packages/workflows/src/workflows/SimulationWorkflow.ts`
- `scripts/workflows/fetch-ohlcv.ts`
- `scripts/workflows/run-simulation.ts`
- `docs/WORKFLOW_MIDDLEWARE.md`

See `docs/WORKFLOW_MIDDLEWARE.md` for complete documentation.

