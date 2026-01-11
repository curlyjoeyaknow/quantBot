# list-experiments Handler

## Overview

Lists all experiments with optional filtering.

## Location

`packages/cli/src/handlers/experiments/list-experiments.ts`

## Handler Function

`listExperimentsHandler`

## Parameters

- `--format <format>`: Output format
- `--limit <count>`: Limit number of results

## Returns

```typescript
{
  experiments: Experiment[];
  total: number;
}
```

## Related

- [[get-experiment]] - Get specific experiment
- [[find-by-parameter]] - Find by parameter

