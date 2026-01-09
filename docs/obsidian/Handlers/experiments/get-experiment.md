# get-experiment Handler

## Overview

Retrieves a specific experiment by ID.

## Location

`packages/cli/src/handlers/experiments/get-experiment.ts`

## Handler Function

`getExperimentHandler`

## Parameters

- `--id <id>`: Experiment ID (required)
- `--format <format>`: Output format

## Returns

```typescript
{
  experiment: Experiment | null;
  found: boolean;
}
```

## Related

- [[list-experiments]] - List all experiments
- [[find-by-parameter]] - Find by parameter

