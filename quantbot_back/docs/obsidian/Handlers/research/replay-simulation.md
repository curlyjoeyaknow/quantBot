# replay-simulation Handler

## Overview

Replays a simulation from a manifest.

## Location

`packages/cli/src/handlers/research/replay-simulation.ts`

## Handler Function

`replaySimulationHandler`

## Command

```bash
quantbot research replay --run-id <id> [options]
```

## Examples

```bash
# Replay simulation by run ID
quantbot research replay --run-id run_1234567890

# JSON output
quantbot research replay --run-id run_1234567890 --format json
```

## Parameters

- `--run-id <id>`: Run ID to replay (required)
- `--format <format>`: Output format

## Returns

```typescript
{
  runId: string;
  replayed: boolean;
  results: SimulationResults;
}
```

## Related

- [[replay-manifest]] - Generate manifest
- [[run-simulation]] - Run new simulation

