# show-run Handler

## Overview

Shows details of a specific research simulation run.

## Location

`packages/cli/src/handlers/research/show-run.ts`

## Handler Function

`showRunHandler`

## Command

```bash
quantbot research show --run-id <id> [options]
```

## Examples

```bash
# Show run details
quantbot research show --run-id run_1234567890

# JSON output
quantbot research show --run-id run_1234567890 --format json
```

## Parameters

- `--run-id <id>`: Run ID (required)
- `--format <format>`: Output format

## Returns

```typescript
{
  run: RunRecord;
  artifact: Artifact;
  results: SimulationResults;
}
```

## Related

- [[list-runs]] - List all runs
- [[leaderboard]] - Leaderboard
- [[replay-manifest]] - Replay manifest

