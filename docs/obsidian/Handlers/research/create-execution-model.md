# create-execution-model Handler

## Overview

Creates an execution model for simulation.

## Location

`packages/cli/src/handlers/research/create-execution-model.ts`

## Handler Function

`createExecutionModelHandler`

## Parameters

- `--name <name>`: Model name (required)
- `--venue <venue>`: Execution venue (pumpfun, pumpswap, raydium, etc.)
- `--config <path>`: Configuration file path
- `--format <format>`: Output format

## Returns

```typescript
{
  modelId: string;
  name: string;
  venue: string;
  config: ExecutionModelConfig;
}
```

## Related

- [[create-cost-model]] - Cost model
- [[create-risk-model]] - Risk model

