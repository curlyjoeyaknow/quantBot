# Research OS - Experiment Engine

This module implements **Branch A** of the Quant Research Lab roadmap: the Research OS simulation and experiment engine.

## Overview

The Research OS provides:

1. **Simulation Contract** - Immutable "physics API" for all simulations
2. **Run Artifacts** - Immutable, versioned outputs
3. **Experiment Runner** - Orchestrates single, batch, and sweep runs
4. **Metrics Calculator** - Comprehensive, mandatory metrics
5. **Artifact Storage** - Persistent storage and retrieval

## Architecture

### Simulation Contract

The contract defines the canonical input/output shape for all simulations:

```typescript
import type { SimulationRequest } from '@quantbot/workflows/research';

const request: SimulationRequest = {
  dataSnapshot: {
    snapshotId: 'snapshot-001',
    contentHash: 'abc123...',
    timeRange: { fromISO: '2024-01-01T00:00:00Z', toISO: '2024-01-02T00:00:00Z' },
    sources: [{ venue: 'pump.fun', chain: 'solana' }],
    createdAtISO: '2024-01-01T00:00:00Z',
  },
  strategy: {
    strategyId: 'strategy-001',
    name: 'momentum-breakout',
    config: { /* strategy config */ },
    configHash: 'def456...',
  },
  executionModel: {
    latency: { p50: 100, p90: 200, p99: 500 },
    slippage: { base: 0.001, volumeImpact: 0.0001 },
  },
  costModel: {
    baseFee: 5000,
    tradingFee: 0.01,
  },
  riskModel: {
    maxDrawdown: 0.2,
    maxLossPerDay: 1000,
  },
  runConfig: {
    seed: 12345,
    timeResolutionMs: 1000,
    errorMode: 'collect',
  },
};
```

### Run Artifacts

Every simulation produces a `RunArtifact`:

```typescript
import type { RunArtifact } from '@quantbot/workflows/research';

const artifact: RunArtifact = {
  metadata: {
    runId: 'run-001',
    gitSha: 'abc123...',
    dataSnapshotHash: 'def456...',
    strategyConfigHash: 'ghi789...',
    createdAtISO: '2024-01-01T00:00:00Z',
    // ... more metadata
  },
  request: { /* original request */ },
  tradeEvents: [ /* all trades */ ],
  pnlSeries: [ /* PnL over time */ ],
  metrics: {
    return: { total: 1.12 },
    drawdown: { max: 0.05 },
    hitRate: { overall: 0.6 },
    trades: { total: 100, entries: 50, exits: 50 },
    tailLoss: { worstTrade: -0.1 },
    feeSensitivity: { totalFees: 50 },
    // ... more metrics
  },
};
```

## Usage

### Single Simulation

```typescript
import { createExperimentContext, runSingleSimulation } from '@quantbot/workflows/research';

const ctx = createExperimentContext();
const artifact = await runSingleSimulation(request, ctx);
console.log('Run ID:', artifact.metadata.runId);
console.log('Total Return:', artifact.metrics.return.total);
```

### Batch Simulations

```typescript
import { runBatchSimulation } from '@quantbot/workflows/research';

const batch = {
  baseRequest: request,
  variations: [
    { variationId: 'var-1', overrides: { runConfig: { seed: 111 } } },
    { variationId: 'var-2', overrides: { runConfig: { seed: 222 } } },
  ],
  maxConcurrency: 4,
};

const result = await runBatchSimulation(batch, ctx);
console.log('Successful:', result.successful.length);
console.log('Failed:', result.failed.length);
```

### Parameter Sweep

```typescript
import { runParameterSweep } from '@quantbot/workflows/research';

const sweep = {
  baseRequest: request,
  parameters: [
    {
      path: 'executionModel.slippage.base',
      values: [0.001, 0.002, 0.003],
    },
    {
      path: 'riskModel.maxDrawdown',
      values: [0.1, 0.2, 0.3],
    },
  ],
  maxConcurrency: 4,
};

const result = await runParameterSweep(sweep, ctx);
// Tests all combinations: 3 * 3 = 9 runs
```

### Replay Simulation

```typescript
import { replaySimulation } from '@quantbot/workflows/research';

const artifact = await replaySimulation('run-001', ctx);
// Re-runs with same inputs, produces new run ID
```

## Metrics

All runs produce mandatory metrics:

- **Return**: Total return, annualized, per-trade
- **Drawdown**: Max, average, recovery time
- **Hit Rate**: Overall, entries, exits
- **Trades**: Total, entries, exits, reentries, failed
- **Tail Loss**: Worst trade, P5, P1
- **Fee Sensitivity**: Total fees, as % of return, per trade
- **Latency Sensitivity**: Average, P90, P99 (if modeled)
- **Risk**: Sharpe, Sortino, max exposure, limit hits

## Artifact Storage

Artifacts are stored in `{baseDir}/artifacts/`:

```
artifacts/
  ├── run-001.json
  ├── run-002.json
  └── index.json
```

The index file tracks all run IDs for fast listing.

## Integration Status

### ✅ Completed

- [x] Simulation contract (inputs/outputs)
- [x] Run artifact model
- [x] Experiment runner (single, batch, sweep, replay)
- [x] Metrics calculator
- [x] Artifact storage (file-based)
- [x] Context factory

### 🚧 In Progress

- [ ] CLI commands for experiments (next priority)

### ✅ Completed

- [x] Full simulation adapter implementation
- [x] Integration with existing simulation engine
- [x] Data snapshot loading (Branch B) - `@quantbot/data-observatory` integrated
- [x] Execution model application (Branch C) - `@quantbot/simulation/execution-models` integrated
- [x] Cost model application (Branch C)
- [x] Risk model application (Branch C)
- [x] Integration tests for all branches (Branch A + B + C)

## Interface Contracts

### DataSnapshotRef (Branch B)

```typescript
{
  snapshotId: string;
  contentHash: string; // SHA-256
  timeRange: { fromISO: string; toISO: string };
  sources: Array<{ venue: string; chain?: string }>;
  filters?: { callerNames?: string[]; mintAddresses?: string[]; minVolume?: number };
  schemaVersion: string;
  createdAtISO: string;
}
```

### ExecutionModel / CostModel / RiskModel (Branch C)

See `contract.ts` for full schemas.

## Next Steps

1. ✅ **Implement full simulation adapter** - Complete
2. ✅ **Branch B integration** - Complete (`@quantbot/data-observatory`)
3. ✅ **Branch C integration** - Complete (`@quantbot/simulation/execution-models`)
4. ⏳ **Add CLI commands** - `quantbot research run`, `quantbot research sweep`, etc. (next priority)
5. ⏳ **Production integration verification** - Ensure services accessible via WorkflowContext
6. ⏳ **Edge case testing** - Empty data, large datasets, malformed inputs

## Guarantees

1. **Determinism**: Same inputs (including seed) = same outputs
2. **Replayability**: Can re-run any simulation with same inputs
3. **Versioning**: All inputs/outputs are versioned
4. **Immutability**: Artifacts are immutable once created
5. **Completeness**: All required metrics are always present

