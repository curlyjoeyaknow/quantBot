# alert-coverage-map Handler

## Overview

Shows coverage statistics mapped to alerts.

## Location

`packages/cli/src/handlers/ohlcv/alert-coverage-map.ts`

## Handler Function

`alertCoverageMapHandler`

## Command

```bash
quantbot ohlcv alert-coverage-map [options]
```

## Examples

```bash
# Show alert coverage map
quantbot ohlcv alert-coverage-map --duckdb data/alerts.duckdb

# Filter by date range
quantbot ohlcv alert-coverage-map --duckdb data/alerts.duckdb --from 2025-05-01 --to 2026-01-07
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database
- `--from <date>`: Start date filter
- `--to <date>`: End date filter
- `--format <format>`: Output format

## Returns

```typescript
{
  alerts: AlertCoverage[];
  totalAlerts: number;
  coveredAlerts: number;
  coveragePercent: number;
}
```

## Related

- [[coverage-map]] - Interval statistics
- [[analyze-detailed-coverage]] - Detailed analysis
- [[coverage-dashboard]] - Interactive dashboard
- [[OHLCV Coverage Analysis]] - Main coverage analysis workflow

