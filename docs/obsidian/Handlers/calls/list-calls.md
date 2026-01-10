# list-calls Handler

## Overview

Lists calls from DuckDB in a readable format.

## Location

`packages/cli/src/handlers/calls/list-calls.ts`

## Handler Function

`listCallsHandler`

## Command

```bash
quantbot calls list [options]
```

## Examples

```bash
# List all calls (default limit 1000)
quantbot calls list --duckdb data/alerts.duckdb

# List calls with date range
quantbot calls list --duckdb data/alerts.duckdb --from-iso 2025-05-01 --to-iso 2026-01-07

# Filter by caller name
quantbot calls list --duckdb data/alerts.duckdb --caller-name Brook

# Custom limit
quantbot calls list --duckdb data/alerts.duckdb --limit 5000

# JSON output
quantbot calls list --duckdb data/alerts.duckdb --format json
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (required)
- `--from-iso <date>`: Start date (ISO 8601)
- `--to-iso <date>`: End date (ISO 8601)
- `--caller-name <name>`: Filter by caller name
- `--limit <count>`: Limit number of results (default: 1000)
- `--format <format>`: Output format

## Implementation

- Uses `queryCallsDuckdb` workflow from `@quantbot/workflows`
- Creates minimal workflow context (no StorageEngine, no Birdeye dependencies)
- Resolves DuckDB path to absolute
- Defaults to wide date range if not specified (2000-01-01 to 2100-12-31)

## Returns

```typescript
{
  calls: CallRecord[];
  total: number;
  dateRange?: {
    from?: string;
    to?: string;
  };
}
```

## Related

- [[Backtesting Workflows]] - Uses calls for backtesting

