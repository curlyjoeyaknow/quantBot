# run-lab Handler

## Overview

Runs lab experiments with signal normalization and execution.

## Location

`packages/cli/src/handlers/lab/run-lab.ts`

## Handler Function

`runLabHandler`

## Parameters

- `--duckdb <path>`: Path to DuckDB database
- `--caller <name>`: Caller name filter
- `--from <date>`: Start date
- `--to <date>`: End date
- `--format <format>`: Output format

## Workflow

1. **Load calls**: Query calls from DuckDB
2. **Normalize signals**: Convert DuckDB calls to CallSignal format
3. **Run lab**: Execute lab workflow with normalized signals
4. **Return results**: Lab execution results

## Signal Normalization

Converts DuckDB call format to CallSignal:
- `mint` → `tokenAddress`
- `alert_timestamp` → `alertTime`
- `caller_name` → `caller`
- `price_usd` → `priceUsd`

## Returns

```typescript
{
  runId: string;
  signalsProcessed: number;
  results: LabRunResult;
}
```

## Related

- [[Backtesting Workflows]] - Uses lab for backtesting

