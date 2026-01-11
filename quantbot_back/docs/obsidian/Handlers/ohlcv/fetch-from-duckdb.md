# fetch-from-duckdb Handler

## Overview

Fetches OHLCV data from DuckDB instead of external API.

## Location

`packages/cli/src/handlers/ohlcv/fetch-from-duckdb.ts`

## Handler Function

`fetchFromDuckdbHandler`

## Command

```bash
quantbot ohlcv fetch-from-duckdb [options]
```

## Examples

```bash
# Fetch from DuckDB
quantbot ohlcv fetch-from-duckdb --duckdb data/alerts.duckdb --mint So11111111111111111111111111111111111111112

# With date range and interval
quantbot ohlcv fetch-from-duckdb --duckdb data/alerts.duckdb --mint So11111111111111111111111111111111111111112 --interval 5m --from 2025-05-01 --to 2026-01-07
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (required)
- `--mint <address>`: Mint address (required)
- `--interval <interval>`: Candle interval
- `--from <date>`: Start date
- `--to <date>`: End date
- `--format <format>`: Output format

## Returns

```typescript
{
  mint: string;
  candles: Candle[];
  count: number;
}
```

## Related

- [[fetch-ohlcv]] - Fetch from API
- [[OHLCV Fetch]] - Main OHLCV fetch workflow

