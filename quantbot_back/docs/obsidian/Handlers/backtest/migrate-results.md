# migrate-results Handler

## Overview

Migrates backtest results between formats or databases.

## Location

`packages/cli/src/handlers/backtest/migrate-results.ts`

## Handler Function

`migrateResultsHandler`

## Command

```bash
quantbot backtest migrate-results [options]
```

## Examples

```bash
# Migrate results
quantbot backtest migrate-results --from data/old_results.duckdb --to data/new_results.duckdb
```

## Parameters

- `--from <path>`: Source path/database
- `--to <path>`: Destination path/database
- `--format <format>`: Output format

## Returns

```typescript
{
  success: boolean;
  migrated: number;
  errors: string[];
}
```

## Related

- [[baseline]] - Baseline backtest
- [[v1-baseline-optimizer]] - Optimization
- [[Backtesting Workflows]] - Backtesting workflows

