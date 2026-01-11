# coverage-dashboard Handler

## Overview

Interactive dashboard showing alert-centric coverage statistics with real-time updates.

## Location

`packages/cli/src/handlers/ohlcv/coverage-dashboard.ts`

## Handler Function

`coverageDashboardHandler`

## Command

```bash
quantbot ohlcv coverage-dashboard --duckdb <path> [options]
```

## Examples

```bash
# Start dashboard with default refresh (5 seconds)
quantbot ohlcv coverage-dashboard --duckdb data/alerts.duckdb

# Dashboard for specific date range
quantbot ohlcv coverage-dashboard --duckdb data/alerts.duckdb --from 2025-05-01 --to 2026-01-07

# Custom refresh interval (10 seconds)
quantbot ohlcv coverage-dashboard --duckdb data/alerts.duckdb --refresh-interval 10
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (required)
- `--from <date>`: Start date filter
- `--to <date>`: End date filter
- `--refresh-interval <seconds>`: Refresh interval in seconds (default: 5)

## Features

- **Real-time statistics**: Auto-refreshes coverage statistics
- **Per-interval coverage**: Shows coverage for 1m and 5m intervals
- **Monthly breakdown**: Coverage statistics by month
- **Colored progress bars**: Visual representation of coverage
- **Interactive**: Press Ctrl+C to exit

## Coverage Thresholds (Tier 1)

- **1m**: >= 150,000 seconds (~2500 candles)
- **5m**: >= 750,000 seconds (~2500 candles)

## Workflow

1. **Load alerts**: Fetch alerts from DuckDB using worklist service
2. **Build coverage cache**: Query ClickHouse for each alert's time window (expensive operation, done once)
3. **Render dashboard**: Display coverage statistics with colored bars
4. **Auto-refresh**: Refresh candle counts periodically (coverage cache is reused)

## Coverage Cache

- Built once at startup (expensive operation)
- Cached per token/interval (max candle count across all alerts for same token)
- Reused for all refresh cycles

## Display

- Overall statistics (total candles, alerts, unique tokens)
- Per-interval coverage bars with percentages
- Monthly breakdown for each interval
- Color coding:
  - Green: >= 90% coverage
  - Yellow: >= 70% coverage
  - Red: < 70% coverage

## Returns

```typescript
{
  totalCandles: number;
  totalAlerts: number;
  uniqueTokens: number;
  intervals: IntervalCoverage[];
  dateRange: { from: string; to: string };
  timestamp: string;
}
```

## Related

- [[coverage-map]] - Interval statistics
- [[analyze-detailed-coverage]] - Detailed analysis
- [[alert-coverage-map]] - Alert mapping
- [[OHLCV Coverage Analysis]] - Main coverage analysis workflow

