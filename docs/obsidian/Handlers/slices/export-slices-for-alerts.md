# export-slices-for-alerts Handler

## Overview

Exports slices for alerts in a date range.

## Location

`packages/cli/src/handlers/slices/export-slices-for-alerts.ts`

## Handler Function

`exportSlicesForAlertsHandler`

## Command

```bash
quantbot slices export-for-alerts [options]
```

## Examples

```bash
# Export slices for alerts in date range
quantbot slices export-for-alerts --duckdb data/alerts.duckdb --from 2025-05-01 --to 2026-01-07 --output-dir slices/2025-05
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (required)
- `--from <date>`: Start date (ISO 8601) (required)
- `--to <date>`: End date (ISO 8601) (required)
- `--output-dir <dir>`: Output directory (required)
- `--format <format>`: Output format

## Returns

```typescript
{
  slicesExported: number;
  outputDir: string;
  slices: SliceInfo[];
}
```

## Related

- [[export-slice]] - Export single slice
- [[validate-slice]] - Validate slice

