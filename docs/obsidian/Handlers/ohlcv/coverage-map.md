# coverage-map Handler

## Overview

Shows precise coverage statistics for all intervals with colored output.

## Location

`packages/cli/src/handlers/ohlcv/coverage-map.ts`

## Handler Function

`coverageMapHandler`

## Command

```bash
quantbot ohlcv coverage-map [options]
```

## Examples

```bash
# Show all-time coverage statistics
quantbot ohlcv coverage-map

# Show coverage for specific date range
quantbot ohlcv coverage-map --from 2025-05-01 --to 2026-01-07

# Get JSON output
quantbot ohlcv coverage-map --format json
```

## Parameters

- `--from <date>`: Filter from date (ISO 8601: YYYY-MM-DD)
- `--to <date>`: Filter to date (ISO 8601: YYYY-MM-DD)
- `--format <format>`: Output format (`json`, `table`) - default: `table`

## Output

### Overall Statistics

- Total candles
- Total tokens
- Date range (earliest → latest)

### Per-Interval Breakdown

Intervals supported:
- `1s` (1 second)
- `15s` (15 seconds)
- `1m` (1 minute)
- `5m` (5 minutes)
- `15m` (15 minutes)
- `1h` (1 hour)
- `4h` (4 hours)
- `1d` (1 day)

For each interval:
- Interval label
- Total candles
- Unique tokens
- Earliest timestamp
- Latest timestamp

### Data Quality Issues

- Invalid intervals (interval_seconds=0)
- Other data quality warnings

## Table Format

When `--format table`:
- Colored output with ANSI codes
- Formatted table with aligned columns
- Warning indicators for invalid intervals

## Returns

```typescript
{
  overall: {
    totalCandles: number;
    totalTokens: number;
    earliest: string;
    latest: string;
  };
  byInterval: Array<{
    interval: string;
    intervalSeconds: number;
    candles: number;
    tokens: number;
    earliest: string;
    latest: string;
  }>;
  dataQualityIssues: string[];
}
```

## Related

- [[analyze-detailed-coverage]] - Detailed analysis
- [[coverage-dashboard]] - Interactive dashboard
- [[alert-coverage-map]] - Alert mapping
- [[OHLCV Coverage Analysis]] - Main coverage analysis workflow

