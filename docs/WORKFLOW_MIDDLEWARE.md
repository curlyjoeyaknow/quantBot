# Workflow Middleware System

## Overview

The workflow middleware system provides reusable, composable components for building script workflows. Instead of writing a new script for each variation, you can compose middleware to create parameterized workflows.

## Architecture

The system consists of:

1. **ScriptExecutor** - Core execution engine that runs middleware in sequence
2. **Middleware Components** - Reusable processing steps:
   - `QueryMiddleware` - Fetch data from databases
   - `ProcessMiddleware` - Process items (fetch OHLCV, run simulations, etc.)
   - `StoreMiddleware` - Store results
3. **Pre-built Workflows** - Common workflow patterns:
   - `OhlcvFetchWorkflow` - Fetch OHLCV candles
   - `SimulationWorkflow` - Run simulations

## Basic Usage

### Using Pre-built Workflows

```typescript
import { createOhlcvFetchWorkflow } from '@quantbot/workflows';
import { Pool } from 'pg';

const pgPool = new Pool({ /* config */ });

const workflow = createOhlcvFetchWorkflow({
  queryType: 'alerts',
  callerNames: ['Brook'],
  chains: ['solana'],
  from: new Date('2024-01-01'),
  limit: 100,
  preWindowMinutes: 260,
  postWindowMinutes: 1440,
  rateLimitMs: 1000,
  pgPool,
});

const result = await workflow.execute(null);
console.log(`Processed: ${result.metadata.processed}`);
console.log(`Success: ${result.metadata.success}`);
console.log(`Failed: ${result.metadata.failed}`);
```

### Building Custom Workflows

```typescript
import { ScriptExecutor, createQueryMiddleware, createProcessMiddleware, createStoreMiddleware } from '@quantbot/workflows';
import { Pool } from 'pg';

const executor = new ScriptExecutor({
  name: 'my-custom-workflow',
  description: 'Custom workflow example',
  rateLimitMs: 1000,
  continueOnError: true,
});

// 1. Query data
executor.use(
  createQueryMiddleware({
    type: 'postgres',
    query: 'SELECT * FROM alerts WHERE alert_price > 0',
    pool: pgPool,
  })
);

// 2. Process each item
executor.use(
  createProcessMiddleware({
    processor: async (alert, index, total) => {
      // Your processing logic here
      return processedResult;
    },
    rateLimitMs: 1000,
    continueOnError: true,
  })
);

// 3. Store results
executor.use(
  createStoreMiddleware({
    storer: async (result, index, total) => {
      // Your storage logic here
      await pgPool.query('INSERT INTO results ...');
    },
  })
);

// Execute
const result = await executor.execute(null);
```

## CLI Usage

### OHLCV Fetch Workflow

```bash
# Fetch OHLCV for Brook's alerts
ts-node scripts/workflows/fetch-ohlcv.ts \
  --query-type alerts \
  --caller Brook \
  --from 2024-01-01 \
  --limit 100 \
  --pre-window-minutes 260 \
  --post-window-minutes 1440

# Fetch for multiple callers
ts-node scripts/workflows/fetch-ohlcv.ts \
  --query-type alerts \
  --caller Brook LSY \
  --chain solana \
  --min-alert-count 5
```

### Simulation Workflow

```bash
# Run simulation with preset strategy
ts-node scripts/workflows/run-simulation.ts \
  --strategy PT2_SL25 \
  --caller Brook \
  --from 2024-01-01 \
  --limit 1000

# Run with custom JSON strategy
ts-node scripts/workflows/run-simulation.ts \
  --strategy '[{"percent":0.5,"target":2.0},{"percent":0.5,"target":5.0}]' \
  --caller Brook \
  --from 2024-01-01
```

## Middleware Reference

### QueryMiddleware

Fetches data from databases.

```typescript
createQueryMiddleware({
  type: 'postgres' | 'clickhouse' | 'custom',
  query: 'SELECT ...',
  params?: any[],
  pool?: Pool, // For postgres
  client?: any, // For clickhouse
  transform?: (row: any) => any, // Transform each row
})
```

### ProcessMiddleware

Processes items in the input array.

```typescript
createProcessMiddleware({
  processor: async (item, index, total) => {
    // Process item
    return result;
  },
  rateLimitMs?: number,
  continueOnError?: boolean,
  progressInterval?: number,
})
```

### StoreMiddleware

Stores processed results.

```typescript
createStoreMiddleware({
  storer: async (item, index, total) => {
    // Store item
  },
  batchSize?: number,
  continueOnError?: boolean,
})
```

## Migration Guide

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
      // Handle error
    }
  }
}
```

### After (Workflow Middleware)

```typescript
// scripts/workflows/fetch-ohlcv.ts
const workflow = createOhlcvFetchWorkflow({
  queryType: 'alerts',
  // ... parameters
});

const result = await workflow.execute(null);
```

## Benefits

1. **Reusability** - Same workflow, different parameters
2. **Consistency** - All scripts use same error handling, rate limiting, progress tracking
3. **Composability** - Mix and match middleware to create new workflows
4. **Maintainability** - Fix bugs once, benefits all scripts
5. **Testability** - Test middleware independently

## Examples

See `scripts/workflows/` for example implementations.

