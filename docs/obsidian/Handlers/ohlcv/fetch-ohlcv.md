# fetch-ohlcv Handler

## Overview

Direct OHLCV fetch handler. Fetches candles for a single mint directly from Birdeye API and stores in ClickHouse. Bypasses worklist generation - useful for quick single-mint fetches.

## Location

`packages/cli/src/handlers/ohlcv/fetch-ohlcv.ts`

## Handler Function

`fetchOhlcvHandler`

## Command

```bash
quantbot ohlcv fetch --mint <address> [options]
```

## Examples

```bash
# Fetch 5m candles for a token (defaults to today)
quantbot ohlcv fetch --mint So11111111111111111111111111111111111111112

# Fetch 1m candles with custom date range
quantbot ohlcv fetch --mint So11111111111111111111111111111111111111112 --interval 1m --from 2025-05-01 --to 2026-01-07

# Fetch 15s candles for Ethereum token
quantbot ohlcv fetch --mint 0x1234... --chain ethereum --interval 15s --from 2025-05-01T00:00:00Z

# Fetch with JSON output
quantbot ohlcv fetch --mint So11111111111111111111111111111111111111112 --format json

# Fetch hourly candles
quantbot ohlcv fetch --mint So11111111111111111111111111111111111111112 --interval 1H
```

## Parameters

- `--mint <address>` (required): Mint address
- `--chain <chain>` (optional): Chain name (`solana`, `ethereum`, `bsc`, `base`) - default: `solana`
- `--interval <interval>` (optional): Candle interval (`1s`, `15s`, `1m`, `5m`, `1H`) - default: `5m`
- `--from <date>` (optional): Start date (ISO 8601), defaults to start of today
- `--to <date>` (optional): End date (ISO 8601), defaults to now
- `--format <format>` (optional): Output format (`json`, `table`, `csv`) - default: `table`

## Behavior

### Default Fetch Window

- **Lookback**: -52 candles prior to specified `from` date
- **Forward**: 4 sets of 5000 candles (20,000 candles) after `from` date
- If `--to` is provided, uses that instead of default forward window

### Date Handling

- All dates are normalized to UTC
- If `from` is not provided, defaults to start of today (UTC)
- If `to` is not provided, calculates based on default forward window

## Workflow

1. **Parse dates**: Normalize to UTC, default to today if not provided
2. **Calculate fetch window**: 
   - From: specified `from` - 52 candles
   - To: specified `to` OR `from` + 20,000 candles
3. **Fetch candles**: Call Birdeye API
4. **Store candles**: Store in ClickHouse `ohlcv_candles` table
5. **Return statistics**: Fetch and store statistics

## API Notes

- Uses Birdeye API directly (not through worklist)
- Note: Birdeye API uses `1H` (not `1h`) for hourly intervals
- Stores in ClickHouse `ohlcv_candles` table

## Returns

```typescript
{
  mint: string;
  chain: string;
  interval: string;
  specifiedFrom: string;  // User-specified from date (UTC)
  actualFrom: string;      // Actual from date (includes -52 candles lookback, UTC)
  to: string;              // To date
  lookbackCandles: 52;
  forwardCandles?: number; // 20000 candles (4 × 5000) or undefined if --to provided
  candlesFetched: number;
  candlesStored: number;
  firstCandle: string | null;
  lastCandle: string | null;
}
```

## Related

- [[fetch-from-duckdb]] - Fetch from DuckDB
- [[ensure-ohlcv-coverage]] - Batch coverage ensuring
- [[OHLCV Fetch]] - Main OHLCV fetch workflow

