# find-by-parameter Handler

## Overview

Finds experiments by parameter value.

## Location

`packages/cli/src/handlers/experiments/find-by-parameter.ts`

## Handler Function

`findByParameterHandler`

## Parameters

- `--parameter <name>`: Parameter name (required)
- `--value <value>`: Parameter value (required)
- `--format <format>`: Output format

## Returns

```typescript
{
  experiments: Experiment[];
  total: number;
}
```

## Related

- [[get-experiment]] - Get specific experiment
- [[list-experiments]] - List all experiments

