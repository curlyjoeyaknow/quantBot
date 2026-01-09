# run-simulation Handler

## Overview

Runs a single research simulation from a request JSON file. **CRITICAL**: This handler includes snapshotRef in the result's `_manifest` property so that `execute()` can create a proper RunManifest with snapshot references.

## Location

`packages/cli/src/handlers/research/run-simulation.ts`

## Handler Function

`runSimulationHandler`

## Command

```bash
quantbot research run --request-file <path> [options]
```

## Examples

```bash
# Run simulation from request file
quantbot research run --request-file requests/simulation-001.json

# JSON output
quantbot research run --request-file requests/simulation-001.json --format json
```

## Parameters

- `--request-file <path>`: Path to simulation request JSON file (required)
- `--format <format>`: Output format

## Workflow

1. **Read request file**: Load simulation request from JSON file
2. **Create experiment context**: Initialize experiment context with artifact base directory
3. **Run simulation**: Execute simulation using `runSingleSimulation` workflow
4. **Load snapshot reference**: Load full `DataSnapshotRef` from snapshot storage
5. **Include in manifest**: Add `snapshotRef` to result's `_manifest` for RunManifest creation
6. **Return artifact**: Simulation artifact with manifest

## Critical Note

The handler includes `snapshotRef` in the result's `_manifest` property so that `execute()` can create a proper RunManifest with snapshot references. The workflow's request contains `snapshotId`, but we need the full `DataSnapshotRef`.

## Returns

```typescript
{
  artifact: Artifact;
  _manifest: {
    snapshotRef: DataSnapshotRef;
    // ... other manifest data
  };
}
```

## Related

- [[batch-simulation]] - Batch simulations
- [[sweep-simulation]] - Parameter sweep
- [[create-snapshot]] - Create data snapshot
- [[show-run]] - Show run details

