# create-risk-model Handler

## Overview

Creates a risk model for simulation.

## Location

`packages/cli/src/handlers/research/create-risk-model.ts`

## Handler Function

`createRiskModelHandler`

## Parameters

- `--name <name>`: Model name (required)
- `--config <path>`: Configuration file path
- `--format <format>`: Output format

## Returns

```typescript
{
  modelId: string;
  name: string;
  config: RiskModelConfig;
}
```

## Related

- [[create-cost-model]] - Cost model
- [[create-execution-model]] - Execution model

