# Research OS Workflow Examples

This document provides practical, runnable examples for using the Research OS to run simulations, analyze results, and manage experiments.

## Table of Contents

1. [Complete Workflow: From Snapshot to Leaderboard](#complete-workflow)
2. [Creating Data Snapshots](#creating-snapshots)
3. [Running Simulations](#running-simulations)
4. [Replaying Simulations](#replaying-simulations)
5. [Analyzing Results with Leaderboard](#analyzing-results)
6. [Programmatic Usage](#programmatic-usage)

## Complete Workflow: From Snapshot to Leaderboard

### Step 1: Create a Data Snapshot

```bash
# Create a snapshot for a specific time range and caller
quantbot research create-snapshot \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-02T00:00:00Z \
  --caller alpha-caller \
  --min-volume 1000 \
  --format json > snapshot.json
```

**Output:**
```json
{
  "snapshotId": "snapshot_20240101_alpha_1000",
  "timeRange": {
    "fromISO": "2024-01-01T00:00:00Z",
    "toISO": "2024-01-02T00:00:00Z"
  },
  "sources": [{"venue": "pump.fun", "chain": "solana"}],
  "filters": {
    "callerNames": ["alpha-caller"],
    "minVolume": 1000
  },
  "contentHash": "abc123..."
}
```

### Step 2: Create Execution and Cost Models

```bash
# Create execution model with latency samples
quantbot research create-execution-model \
  --latency-samples "100,200,300,400,500" \
  --failure-rate 0.01 \
  --partial-fill-rate 0.1 \
  --venue pumpfun \
  --format json > execution-model.json

# Create cost model
quantbot research create-cost-model \
  --base-fee 5000 \
  --priority-fee-min 1000 \
  --priority-fee-max 10000 \
  --trading-fee-percent 0.01 \
  --format json > cost-model.json
```

### Step 3: Create a Simulation Request

Create `request.json`:

```json
{
  "dataSnapshot": {
    "snapshotId": "snapshot_20240101_alpha_1000",
    "timeRange": {
      "fromISO": "2024-01-01T00:00:00Z",
      "toISO": "2024-01-02T00:00:00Z"
    },
    "sources": [{"venue": "pump.fun", "chain": "solana"}],
    "filters": {
      "callerNames": ["alpha-caller"],
      "minVolume": 1000
    },
    "contentHash": "abc123..."
  },
  "strategy": {
    "strategyId": "momentum-breakout-v1",
    "name": "momentum-breakout",
    "config": {
      "targets": [{"target": 2.0, "percent": 0.5}],
      "stopLoss": {"percent": 0.25},
      "reEntry": {"enabled": true, "maxReEntries": 2}
    },
    "configHash": "def456..."
  },
  "executionModel": {
    "latency": {
      "mean": 300,
      "stdDev": 150,
      "distribution": "normal"
    },
    "slippage": {
      "base": 0.001,
      "volumeFactor": 0.0001
    },
    "failureRate": 0.01,
    "partialFillRate": 0.1
  },
  "costModel": {
    "baseFee": 5000,
    "priorityFeeRange": {"min": 1000, "max": 10000},
    "tradingFeePercent": 0.01
  },
  "riskModel": {
    "maxDrawdownPercent": 20,
    "maxLossPerDay": 1000,
    "maxConsecutiveLosses": 5,
    "maxPositionSize": 500
  },
  "runConfig": {
    "seed": 12345,
    "timeResolutionMs": 1000,
    "errorMode": "collect",
    "includeEventLogs": true
  }
}
```

### Step 4: Run the Simulation

```bash
# Run the simulation
quantbot research run --request-file request.json --format json > run-result.json
```

**Output:**
```json
{
  "runId": "run_20240101_123456",
  "metadata": {
    "runId": "run_20240101_123456",
    "createdAt": "2024-01-01T12:00:00Z",
    "strategyConfigHash": "def456...",
    "dataSnapshotHash": "abc123..."
  },
  "metrics": {
    "return": {
      "total": 1.15,
      "perTrade": 0.05
    },
    "hitRate": {
      "overall": 0.65
    },
    "drawdown": {
      "max": 0.12
    },
    "trades": {
      "total": 20,
      "winners": 13,
      "losers": 7
    }
  }
}
```

The simulation creates artifacts in `artifacts/run_20240101_123456/`:
- `manifest.json` - Canonical run manifest
- `metrics.json` - Detailed metrics
- `events.json` - Trade events (if `includeEventLogs: true`)
- `pnl-series.json` - PnL time series

### Step 5: Replay from Manifest

```bash
# Replay the simulation using the manifest
quantbot research replay-manifest \
  --manifest artifacts/run_20240101_123456/manifest.json \
  --format json > replay-result.json
```

This re-runs the simulation with the exact same parameters, useful for:
- Verifying determinism
- Testing code changes
- Debugging specific runs

### Step 6: View Leaderboard

```bash
# Show top 10 runs by return
quantbot research leaderboard \
  --criteria return \
  --order desc \
  --limit 10

# Show top runs by win rate for a specific strategy
quantbot research leaderboard \
  --criteria winRate \
  --strategy-name momentum-breakout \
  --order desc \
  --limit 20

# Filter by snapshot and minimum thresholds
quantbot research leaderboard \
  --criteria profitFactor \
  --snapshot-id snapshot_20240101_alpha_1000 \
  --min-return 1.1 \
  --min-win-rate 0.6 \
  --format table
```

**Table Output:**
```
┌──────┬──────────────────────┬─────────────────────┬──────────────┬──────────┬─────────┬──────────────┬─────────────┐
│ Rank │ RunId                │ Strategy            │ Snapshot     │ Score    │ Return  │ WinRate      │ MaxDrawdown │
├──────┼──────────────────────┼─────────────────────┼──────────────┼──────────┼─────────┼──────────────┼─────────────┤
│ 1    │ run_20240101_123456  │ momentum-breakout   │ snapshot_... │ 1.1500   │ +15.00% │ 65.00%       │ 12.00%      │
│ 2    │ run_20240101_234567  │ momentum-breakout   │ snapshot_... │ 1.1200   │ +12.00% │ 60.00%       │ 15.00%      │
└──────┴──────────────────────┴─────────────────────┴──────────────┴──────────┴─────────┴──────────────┴─────────────┘
```

## Creating Snapshots

### Basic Snapshot

```bash
quantbot research create-snapshot \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-31T23:59:59Z \
  --venue pump.fun \
  --format json
```

### Snapshot with Filters

```bash
# Filter by caller names
quantbot research create-snapshot \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-02T00:00:00Z \
  --caller alpha-caller \
  --caller beta-caller \
  --format json

# Filter by mint addresses
quantbot research create-snapshot \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-02T00:00:00Z \
  --mint So11111111111111111111111111111111111111112 \
  --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --format json

# Filter by minimum volume
quantbot research create-snapshot \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-02T00:00:00Z \
  --min-volume 10000 \
  --format json
```

## Running Simulations

### Single Simulation

```bash
# Run from request file
quantbot research run --request-file request.json

# Output as JSON
quantbot research run --request-file request.json --format json > result.json
```

### Batch Simulations

Create `batch.json`:

```json
{
  "requests": [
    {
      "dataSnapshot": { /* ... */ },
      "strategy": { /* ... */ },
      "executionModel": { /* ... */ },
      "costModel": { /* ... */ },
      "riskModel": { /* ... */ },
      "runConfig": { /* ... */ }
    },
    {
      "dataSnapshot": { /* ... */ },
      "strategy": { /* different strategy */ },
      "executionModel": { /* ... */ },
      "costModel": { /* ... */ },
      "riskModel": { /* ... */ },
      "runConfig": { /* ... */ }
    }
  ]
}
```

```bash
quantbot research batch --batch-file batch.json
```

### Parameter Sweep

Create `sweep.json`:

```json
{
  "baseRequest": {
    "dataSnapshot": { /* ... */ },
    "executionModel": { /* ... */ },
    "costModel": { /* ... */ },
    "riskModel": { /* ... */ },
    "runConfig": { /* ... */ }
  },
  "sweepParams": {
    "strategy.config.targets[0].target": [1.5, 2.0, 2.5, 3.0],
    "strategy.config.stopLoss.percent": [0.2, 0.25, 0.3]
  }
}
```

```bash
quantbot research sweep --sweep-file sweep.json
```

## Replaying Simulations

### Replay by Run ID

```bash
quantbot research replay --run-id run_20240101_123456
```

### Replay from Manifest (Recommended)

```bash
# Replay using manifest file
quantbot research replay-manifest \
  --manifest artifacts/run_20240101_123456/manifest.json

# Output as JSON
quantbot research replay-manifest \
  --manifest artifacts/run_20240101_123456/manifest.json \
  --format json > replay.json
```

## Analyzing Results

### List All Runs

```bash
# List all runs
quantbot research list

# Paginated list
quantbot research list --limit 10 --offset 0

# JSON output
quantbot research list --format json > runs.json
```

### Show Run Details

```bash
quantbot research show --run-id run_20240101_123456

# JSON output
quantbot research show --run-id run_20240101_123456 --format json > run-details.json
```

### Leaderboard Examples

```bash
# Top 10 by return
quantbot research leaderboard --criteria return --limit 10

# Top runs by win rate
quantbot research leaderboard --criteria winRate --order desc --limit 20

# Filter by strategy
quantbot research leaderboard \
  --criteria profitFactor \
  --strategy-name momentum-breakout \
  --order desc

# Filter by snapshot
quantbot research leaderboard \
  --criteria return \
  --snapshot-id snapshot_20240101_alpha_1000 \
  --order desc

# Filter with minimum thresholds
quantbot research leaderboard \
  --criteria return \
  --min-return 1.1 \
  --min-win-rate 0.6 \
  --order desc

# All criteria options
quantbot research leaderboard --criteria return
quantbot research leaderboard --criteria winRate
quantbot research leaderboard --criteria profitFactor
quantbot research leaderboard --criteria sharpeRatio
quantbot research leaderboard --criteria maxDrawdown
quantbot research leaderboard --criteria totalTrades
quantbot research leaderboard --criteria avgReturnPerTrade
```

## Programmatic Usage

### TypeScript/JavaScript

```typescript
import { 
  runSingleSimulation,
  replaySimulation,
  calculateLeaderboard,
  createExperimentContext 
} from '@quantbot/workflows';
import { DataSnapshotService } from '@quantbot/workflows/research/services';
import { createProductionContext } from '@quantbot/workflows/context/createProductionContext';

// Create contexts
const workflowCtx = createProductionContext();
const experimentCtx = createExperimentContext({
  artifactBaseDir: './artifacts',
});

// Create snapshot
const dataService = new DataSnapshotService(workflowCtx);
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

// Run simulation
const artifact = await runSingleSimulation(
  {
    dataSnapshot: snapshot,
    strategy: {
      strategyId: 'momentum-breakout-v1',
      name: 'momentum-breakout',
      config: {
        targets: [{ target: 2.0, percent: 0.5 }],
      },
      configHash: 'def456...',
    },
    executionModel: { /* ... */ },
    costModel: { /* ... */ },
    riskModel: { /* ... */ },
    runConfig: {
      seed: 12345,
      timeResolutionMs: 1000,
      errorMode: 'collect',
    },
  },
  experimentCtx
);

console.log(`Run ID: ${artifact.metadata.runId}`);
console.log(`Return: ${artifact.metrics.return.total}`);

// Replay simulation
const replayed = await replaySimulation(artifact.metadata.runId, experimentCtx);

// Calculate leaderboard
const leaderboard = await calculateLeaderboard(
  {
    criteria: 'return',
    order: 'desc',
    limit: 10,
    minReturn: 1.1,
    minWinRate: 0.6,
  },
  experimentCtx
);

console.log('Top runs:', leaderboard);
```

### Python (via CLI)

```python
import subprocess
import json

# Run simulation
result = subprocess.run(
    [
        'quantbot', 'research', 'run',
        '--request-file', 'request.json',
        '--format', 'json'
    ],
    capture_output=True,
    text=True
)

artifact = json.loads(result.stdout)
print(f"Run ID: {artifact['metadata']['runId']}")

# Get leaderboard
leaderboard_result = subprocess.run(
    [
        'quantbot', 'research', 'leaderboard',
        '--criteria', 'return',
        '--limit', '10',
        '--format', 'json'
    ],
    capture_output=True,
    text=True
)

leaderboard = json.loads(leaderboard_result.stdout)
for entry in leaderboard['entries']:
    print(f"{entry['rank']}. {entry['runId']}: {entry['score']:.4f}")
```

## Common Workflows

### Compare Strategies on Same Snapshot

```bash
# 1. Create snapshot once
quantbot research create-snapshot \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-02T00:00:00Z \
  --caller alpha-caller \
  --format json > snapshot.json

# 2. Run multiple strategies (modify request.json for each)
quantbot research run --request-file request-strategy1.json
quantbot research run --request-file request-strategy2.json
quantbot research run --request-file request-strategy3.json

# 3. Compare on leaderboard
quantbot research leaderboard \
  --criteria return \
  --snapshot-id snapshot_20240101_alpha \
  --order desc
```

### Find Best Strategy Parameters

```bash
# 1. Create parameter sweep
# Edit sweep.json with different target/stopLoss values

# 2. Run sweep
quantbot research sweep --sweep-file sweep.json

# 3. Find best parameters
quantbot research leaderboard \
  --criteria return \
  --order desc \
  --limit 5
```

### Verify Determinism

```bash
# 1. Run simulation
quantbot research run --request-file request.json

# 2. Replay from manifest
quantbot research replay-manifest \
  --manifest artifacts/run_*/manifest.json

# 3. Compare metrics (should be identical)
quantbot research show --run-id <original-run-id>
quantbot research show --run-id <replayed-run-id>
```

## Tips and Best Practices

1. **Reuse Snapshots**: Create snapshots once and reuse them across multiple simulations to save time and ensure consistency.

2. **Use Manifests**: Always use `replay-manifest` instead of `replay` when you have the manifest file - it's more reliable and explicit.

3. **Filter Early**: Use snapshot filters (caller, mint, volume) to reduce data size and improve performance.

4. **Set Seeds**: Always set a `seed` in `runConfig` for reproducible results.

5. **Collect Errors**: Use `errorMode: "collect"` to continue processing even when individual calls fail.

6. **Leaderboard Filters**: Use `--min-return` and `--min-win-rate` to filter out poor-performing runs early.

7. **JSON Output**: Use `--format json` when piping to other tools or scripts.

8. **Artifact Location**: Artifacts are stored in `artifacts/run_<runId>/` relative to the current working directory.

## See Also

- [Research Services Usage Guide](../guides/research-services-usage.md) - Detailed service documentation
- [Research OS Integration Guide](../guides/research-services-integration.md) - Integration patterns
- [Simulation Workflow Guide](../guides/simulation-workflow.md) - Core simulation concepts

