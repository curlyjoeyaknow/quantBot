# Research OS - Artifact Pipeline

## Overview

This document describes the end-to-end artifact pipeline for simulation runs.

## Components

### 1. Canonical RunManifest

**Location**: `packages/workflows/src/research/run-manifest.ts`

Unified manifest schema that bridges:
- CLI RunManifests (`@quantbot/core`)
- Research OS RunArtifacts

**Key Features**:
- Deterministic fingerprints from all inputs
- Versioned schema for evolution
- Artifact path tracking
- Status tracking (pending/running/completed/failed)

### 2. Experiment Runner

**Location**: `packages/workflows/src/research/experiment-runner.ts`

Orchestrates simulation runs:
- `runSingleSimulation()` - Single simulation with artifact write
- `runBatchSimulation()` - Batch runs with concurrency control
- `runParameterSweep()` - Deterministic parameter sweeps
- `replaySimulation()` - Replay by run ID

**Deterministic Sweeps**:
- Parameter combinations generated in sorted order
- Seeds derived deterministically from variation IDs
- Same parameters → same results

### 3. Artifact Storage

**Location**: `packages/workflows/src/research/artifact-storage.ts`

File-based artifact storage:
- Saves RunArtifacts as JSON files
- Maintains index of all run IDs
- Supports loading by run ID

**Storage Structure**:
```
artifacts/
  {runId}.json          - Complete RunArtifact
  index.json            - List of all run IDs
```

### 4. Simulation Adapter

**Location**: `packages/workflows/src/research/simulation-adapter.ts`

**Current Status**: Stub implementation

**Future Work**:
- Integrate with actual simulation engine
- Convert simulation results to RunArtifacts
- Collect trade events, PnL series, metrics

## End-to-End Flow

### Running a Simulation

```typescript
import { runSingleSimulation, createExperimentContext } from '@quantbot/workflows/research';

const ctx = createExperimentContext();
const request: SimulationRequest = {
  // ... simulation request
};

const artifact = await runSingleSimulation(request, ctx);
// Artifact is automatically saved to disk
```

### Replaying a Simulation

```typescript
import { replaySimulation, createExperimentContext } from '@quantbot/workflows/research';

const ctx = createExperimentContext();
const artifact = await replaySimulation('run-id-123', ctx);
// New artifact is created with same inputs, new run ID
```

### Parameter Sweep

```typescript
import { runParameterSweep, createExperimentContext } from '@quantbot/workflows/research';

const ctx = createExperimentContext();
const sweep: ParameterSweepRequest = {
  baseRequest: { /* ... */ },
  parameters: [
    { path: 'executionModel.slippage.base', values: [0.001, 0.002, 0.003] },
    { path: 'costModel.baseFee', values: [1000, 2000, 3000] },
  ],
  maxConcurrency: 4,
};

const result = await runParameterSweep(sweep, ctx);
// All combinations run deterministically, artifacts saved
```

## Integration Points

### With Existing Workflows

The Research OS is designed to work alongside existing workflows:

1. **Existing workflows** (`runSimulation`, `runSimulationDuckdb`) produce `SimulationRunResult`
2. **Research OS** produces `RunArtifact` with full traceability
3. **Future**: Bridge function to convert `SimulationRunResult` → `RunArtifact`

### With CLI

The canonical manifest is compatible with CLI manifests:
- CLI writes `manifest.json` in artifact directories
- Research OS can read CLI manifests via `fromCLIManifest()`
- Both use same fingerprint algorithm

## Determinism Guarantees

1. **Same inputs → same outputs**: All inputs are hashed, same hash → same results
2. **Deterministic seeds**: Seeds derived from variation IDs ensure reproducibility
3. **Sorted parameter combinations**: Parameter sweeps generate combinations in sorted order
4. **Fingerprint matching**: Two runs with same fingerprint are identical

## Artifact Structure

```typescript
RunArtifact {
  metadata: {
    runId: string;
    gitSha: string;
    dataSnapshotHash: string;
    strategyConfigHash: string;
    // ... all inputs hashed
  },
  request: SimulationRequest,  // Full input for replay
  tradeEvents: TradeEvent[],   // All trades executed
  pnlSeries: PnLSeries[],      // Cumulative PnL over time
  metrics: RunMetrics,         // Comprehensive metrics
}
```

## Next Steps

1. **Complete Simulation Adapter**: Integrate with actual simulation engine
2. **Bridge Function**: Convert `SimulationRunResult` → `RunArtifact`
3. **Database Storage**: Add database-backed artifact storage (optional)
4. **Artifact Analysis**: Tools to compare/analyze artifacts

