# replay-manifest Handler

## Overview

Generates replay manifest for simulation runs.

## Location

`packages/cli/src/handlers/research/replay-manifest.ts`

## Handler Function

`replayManifestHandler`

## Command

```bash
quantbot research replay-manifest --run-id <id> [options]
```

## Examples

```bash
# Generate replay manifest
quantbot research replay-manifest --run-id run_1234567890

# JSON output
quantbot research replay-manifest --run-id run_1234567890 --format json
```

## Parameters

- `--run-id <id>`: Run ID (required)
- `--format <format>`: Output format

## Returns

```typescript
{
  runId: string;
  manifest: ReplayManifest;
}
```

## Related

- [[show-run]] - Show run details
- [[replay-simulation]] - Replay simulation

