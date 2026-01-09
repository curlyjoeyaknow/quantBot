# list-runs Handler

## Overview

Lists research simulation runs.

## Location

`packages/cli/src/handlers/research/list-runs.ts`

## Handler Function

`listRunsHandler`

## Command

```bash
quantbot research list [options]
```

## Examples

```bash
# List all runs
quantbot research list

# Limit results
quantbot research list --limit 50

# With offset for pagination
quantbot research list --limit 50 --offset 100

# JSON output
quantbot research list --format json
```

## Parameters

- `--format <format>`: Output format
- `--limit <count>`: Limit number of results
- `--offset <count>`: Offset for pagination

## Returns

```typescript
{
  runs: RunRecord[];
  total: number;
}
```

## Related

- [[show-run]] - Show specific run
- [[leaderboard]] - Leaderboard
- [[replay-manifest]] - Replay manifest

