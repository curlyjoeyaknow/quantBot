# Research Services Usage Guide

This guide demonstrates how to use `DataSnapshotService` and `ExecutionRealityService` in your workflows and experiments.

## Overview

The Research Services provide:

- **DataSnapshotService**: Create reproducible data snapshots for simulations
- **ExecutionRealityService**: Apply realistic execution models, cost models, and risk constraints

## DataSnapshotService

### Basic Usage

```typescript
import { DataSnapshotService } from '@quantbot/workflows/research/services';
import { createProductionContext } from '@quantbot/workflows/context/createProductionContext';

// Create service with production context
const ctx = createProductionContext();
const dataService = new DataSnapshotService(ctx);

// Create a snapshot
const snapshot = await dataService.createSnapshot({
  timeRange: {
    fromISO: '2024-01-01T00:00:00Z',
    toISO: '2024-01-02T00:00:00Z',
  },
  sources: [
    { venue: 'pump.fun', chain: 'solana' },
  ],
  filters: {
    callerNames: ['caller1', 'caller2'],
    mintAddresses: ['mint1', 'mint2'],
    minVolume: 1000,
  },
});

// Load data from snapshot
const data = await dataService.loadSnapshot(snapshot);
console.log(`Loaded ${data.candles.length} candles and ${data.calls.length} calls`);

// Verify snapshot integrity
const isValid = await dataService.verifySnapshot(snapshot);
console.log(`Snapshot is valid: ${isValid}`);
```

### Creating Snapshots for Different Scenarios

#### 1. Snapshot for Specific Callers

```typescript
const snapshot = await dataService.createSnapshot({
  timeRange: {
    fromISO: '2024-01-01T00:00:00Z',
    toISO: '2024-01-31T23:59:59Z',
  },
  sources: [{ venue: 'pump.fun' }],
  filters: {
    callerNames: ['alpha-caller', 'beta-caller'],
  },
});
```

#### 2. Snapshot for High-Volume Tokens

```typescript
const snapshot = await dataService.createSnapshot({
  timeRange: {
    fromISO: '2024-01-01T00:00:00Z',
    toISO: '2024-01-02T00:00:00Z',
  },
  sources: [{ venue: 'pump.fun' }],
  filters: {
    minVolume: 10000, // Only tokens with volume >= 10k
  },
});
```

#### 3. Snapshot for Specific Mints

```typescript
const snapshot = await dataService.createSnapshot({
  timeRange: {
    fromISO: '2024-01-01T00:00:00Z',
    toISO: '2024-01-02T00:00:00Z',
  },
  sources: [{ venue: 'pump.fun' }],
  filters: {
    mintAddresses: [
      'So11111111111111111111111111111111111111112',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    ],
  },
});
```

### Snapshot Integrity

Snapshots include a content hash that ensures data integrity:

```typescript
// Create snapshot
const snapshot = await dataService.createSnapshot({ /* ... */ });

// Later, verify it hasn't been tampered with
const isValid = await dataService.verifySnapshot(snapshot);
if (!isValid) {
  throw new Error('Snapshot integrity check failed!');
}

// Load data (automatically verifies integrity)
const data = await dataService.loadSnapshot(snapshot);
```

## ExecutionRealityService

### Creating Execution Models from Calibration Data

```typescript
import { ExecutionRealityService } from '@quantbot/workflows/research/services';
import { createProductionContext } from '@quantbot/workflows/context/createProductionContext';

const ctx = createProductionContext();
const executionService = new ExecutionRealityService(ctx);

// Create execution model from live trading data
const executionModel = executionService.createExecutionModelFromCalibration({
  latencySamples: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500], // ms
  slippageSamples: [
    {
      tradeSize: 100,
      expectedPrice: 100.0,
      actualPrice: 100.1,
      marketVolume24h: 1000000,
    },
    {
      tradeSize: 200,
      expectedPrice: 100.0,
      actualPrice: 100.2,
      marketVolume24h: 1000000,
    },
  ],
  failureRate: 0.01, // 1% failure rate
  partialFillRate: 0.1, // 10% partial fill rate
});

// Use in simulation request
const request = {
  dataSnapshot: snapshot,
  strategy: { /* ... */ },
  executionModel,
  // ...
};
```

### Creating Cost Models

```typescript
// Create cost model from fee structure
const costModel = executionService.createCostModelFromFees({
  baseFee: 5000, // lamports
  priorityFeeRange: {
    min: 1000, // micro-lamports per CU
    max: 10000,
  },
  tradingFeePercent: 0.01, // 1%
});

// Apply to a trade
const tradeCost = executionService.applyCostModel(
  {
    value: 100000, // trade value in lamports
    priority: 'high', // 'low' | 'medium' | 'high'
  },
  costModel
);
console.log(`Total cost: ${tradeCost} lamports`);
```

### Creating Risk Models

```typescript
// Create risk model from constraints
const riskModel = executionService.createRiskModelFromConstraints({
  maxDrawdownPercent: 20, // 20% max drawdown
  maxLossPerDay: 1000, // USD
  maxConsecutiveLosses: 5,
  maxPositionSize: 500, // USD
});

// Check if trade is allowed
const check = executionService.checkRiskConstraints(
  {
    currentDrawdown: 0.15, // 15%
    lossToday: 500, // USD
    consecutiveLosses: 2,
    currentExposure: 300, // USD
    tradesToday: 10,
  },
  riskModel
);

if (!check.allowed) {
  console.log(`Trade blocked: ${check.reason}`);
  console.log(`Hit limit: ${check.hitLimit}`);
}
```

### Applying Execution Models to Trades

```typescript
// Simulate trade execution
const result = await executionService.applyExecutionModel(
  {
    type: 'entry', // or 'exit'
    asset: 'mint-address',
    quantity: 1.0,
    expectedPrice: 100.0,
    marketVolume24h: 1000000,
  },
  executionModel,
  () => Math.random() // Random number generator
);

console.log(`Executed price: ${result.executedPrice}`);
console.log(`Latency: ${result.latencyMs}ms`);
console.log(`Failed: ${result.failed}`);
console.log(`Partial fill: ${result.partialFill}`);
if (result.fillPercentage) {
  console.log(`Fill percentage: ${result.fillPercentage * 100}%`);
}
```

## Complete Example: Running a Simulation

```typescript
import { DataSnapshotService, ExecutionRealityService } from '@quantbot/workflows/research/services';
import { runSingleSimulation } from '@quantbot/workflows/research';
import { createExperimentContext } from '@quantbot/workflows/research/context';
import { createProductionContext } from '@quantbot/workflows/context/createProductionContext';
import { createHash } from 'crypto';

async function runSimulation() {
  // Create contexts
  const workflowCtx = createProductionContext();
  const experimentCtx = createExperimentContext({
    workflowContext: workflowCtx,
    artifactBaseDir: './artifacts',
  });

  // Create services
  const dataService = new DataSnapshotService(workflowCtx);
  const executionService = new ExecutionRealityService(workflowCtx);

  // Step 1: Create data snapshot
  const snapshot = await dataService.createSnapshot({
    timeRange: {
      fromISO: '2024-01-01T00:00:00Z',
      toISO: '2024-01-02T00:00:00Z',
    },
    sources: [{ venue: 'pump.fun', chain: 'solana' }],
    filters: {
      callerNames: ['alpha-caller'],
      minVolume: 1000,
    },
  });

  // Step 2: Create execution model from calibration
  const executionModel = executionService.createExecutionModelFromCalibration({
    latencySamples: [100, 200, 300, 400, 500],
    slippageSamples: [
      {
        tradeSize: 100,
        expectedPrice: 100.0,
        actualPrice: 100.1,
        marketVolume24h: 1000000,
      },
    ],
    failureRate: 0.01,
  });

  // Step 3: Create cost model
  const costModel = executionService.createCostModelFromFees({
    baseFee: 5000,
    priorityFeeRange: { min: 1000, max: 10000 },
    tradingFeePercent: 0.01,
  });

  // Step 4: Create risk model
  const riskModel = executionService.createRiskModelFromConstraints({
    maxDrawdownPercent: 20,
    maxLossPerDay: 1000,
    maxConsecutiveLosses: 5,
    maxPositionSize: 500,
  });

  // Step 5: Create strategy
  const strategy = {
    strategyId: 'strategy-001',
    name: 'momentum-breakout',
    config: {
      targets: [{ target: 2, percent: 0.5 }],
    },
    configHash: createHash('sha256')
      .update(JSON.stringify({ targets: [{ target: 2, percent: 0.5 }] }))
      .digest('hex'),
  };

  // Step 6: Run simulation
  const artifact = await runSingleSimulation(
    {
      dataSnapshot: snapshot,
      strategy,
      executionModel,
      costModel,
      riskModel,
      runConfig: {
        seed: 12345,
        timeResolutionMs: 1000,
        errorMode: 'collect',
        includeEventLogs: true,
      },
    },
    experimentCtx
  );

  // Step 7: Analyze results
  console.log(`Run ID: ${artifact.metadata.runId}`);
  console.log(`Return: ${artifact.metrics.return}`);
  console.log(`Drawdown: ${artifact.metrics.drawdown}`);
  console.log(`Hit Rate: ${artifact.metrics.hitRate}`);
  console.log(`Trades: ${artifact.metrics.trades.total}`);

  return artifact;
}
```

## Best Practices

### 1. Snapshot Reusability

Create snapshots once and reuse them across multiple simulations:

```typescript
// Create snapshot once
const snapshot = await dataService.createSnapshot({ /* ... */ });

// Reuse for multiple simulations
for (const strategy of strategies) {
  const artifact = await runSingleSimulation({
    dataSnapshot: snapshot, // Same snapshot
    strategy,
    // ...
  });
}
```

### 2. Calibration Data Collection

Collect calibration data from live trading:

```typescript
// Collect latency samples from live trades
const latencySamples: number[] = [];
const slippageSamples: Array<{
  tradeSize: number;
  expectedPrice: number;
  actualPrice: number;
  marketVolume24h: number;
}> = [];

// ... collect from live trading ...

// Create execution model
const executionModel = executionService.createExecutionModelFromCalibration({
  latencySamples,
  slippageSamples,
  failureRate: calculateFailureRate(liveTrades),
});
```

### 3. Risk Management

Always check risk constraints before executing trades:

```typescript
const check = executionService.checkRiskConstraints(
  {
    currentDrawdown: calculateDrawdown(currentPnl, peakPnl),
    lossToday: calculateLossToday(tradesToday),
    consecutiveLosses: countConsecutiveLosses(recentTrades),
    currentExposure: calculateExposure(openPositions),
    tradesToday: countTradesToday(trades),
  },
  riskModel
);

if (!check.allowed) {
  // Stop trading or reduce position size
  return;
}
```

### 4. Deterministic Randomness

Use seeded random number generators for reproducible simulations:

```typescript
import { createSeededRandom } from '@quantbot/utils';

const random = createSeededRandom(12345); // Same seed = same results

const result = await executionService.applyExecutionModel(
  trade,
  executionModel,
  random
);
```

## Error Handling

```typescript
try {
  const snapshot = await dataService.createSnapshot({ /* ... */ });
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Invalid snapshot parameters:', error.message);
  } else {
    console.error('Failed to create snapshot:', error);
  }
}

try {
  const data = await dataService.loadSnapshot(snapshot);
} catch (error) {
  if (error.message.includes('integrity check failed')) {
    console.error('Snapshot has been tampered with!');
  } else {
    console.error('Failed to load snapshot:', error);
  }
}
```

## Performance Considerations

- **Snapshot Creation**: Can be slow for large time ranges. Consider creating snapshots in advance.
- **Data Loading**: Loading large snapshots can be memory-intensive. Consider pagination for very large datasets.
- **Execution Model Application**: Very fast (microseconds per trade).
- **Risk Constraint Checking**: Very fast (microseconds per check).

## See Also

- [Research OS Contract](./SIMULATION_CONTRACT.md) - Full contract specification
- [Testing Summary](../packages/workflows/src/research/TESTING_SUMMARY.md) - Test coverage and examples
