# create-cost-model Handler

## Overview

Creates a cost model for simulation.

## Location

`packages/cli/src/handlers/research/create-cost-model.ts`

## Handler Function

`createCostModelHandler`

## Parameters

- `--name <name>`: Model name (required)
- `--config <path>`: Configuration file path
- `--format <format>`: Output format

## Returns

```typescript
{
  modelId: string;
  name: string;
  config: CostModelConfig;
}
```

## Related

- [[create-execution-model]] - Execution model
- [[create-risk-model]] - Risk model

