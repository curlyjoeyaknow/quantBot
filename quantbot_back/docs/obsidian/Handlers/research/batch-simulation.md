# batch-simulation Handler

## Overview

Runs batch simulations from a batch JSON file.

## Location

`packages/cli/src/handlers/research/batch-simulation.ts`

## Handler Function

`batchSimulationHandler`

## Command

```bash
quantbot research batch --batch-file <path> [options]
```

## Examples

```bash
# Run batch simulation
quantbot research batch --batch-file batches/batch-001.json

# JSON output
quantbot research batch --batch-file batches/batch-001.json --format json
```

## Parameters

- `--batch-file <path>`: Path to batch simulation request JSON file (required)
- `--format <format>`: Output format

## Workflow

1. **Read batch file**: Load batch simulation request from JSON file
2. **Create experiment context**: Initialize experiment context with artifact base directory
3. **Run batch simulation**: Execute batch simulation using `runBatchSimulation` workflow
4. **Return results**: Batch simulation results with run IDs

## Batch Request Format

```typescript
{
  requests: SimulationRequest[];
  // ... other batch configuration
}
```

## Returns

```typescript
{
  runIds: string[];
  artifacts: Artifact[];
  // ... other batch results
}
```

## Related

- [[run-simulation]] - Single simulation
- [[sweep-simulation]] - Parameter sweep
- [[list-runs]] - List simulation runs

