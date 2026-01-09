# OHLCV Fetch

## Overview

Direct OHLCV data fetching from Birdeye API and storage in ClickHouse. Bypasses worklist generation - useful for quick single-mint fetches.

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
```

## Handler

- **Location**: `packages/cli/src/handlers/ohlcv/fetch-ohlcv.ts`
- **Handler Function**: `fetchOhlcvHandler`

## Parameters

- `mint` (required): Mint address
- `chain` (optional): Chain name (`solana`, `ethereum`, `bsc`, `base`) - default: `solana`
- `interval` (optional): Candle interval (`1s`, `15s`, `1m`, `5m`, `1H`) - default: `5m`
- `from` (optional): Start date (ISO 8601)
- `to` (optional): End date (ISO 8601)
- `format` (optional): Output format (`json`, `table`, `csv`) - default: `table`

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

1. Parse and validate dates (normalize to UTC)
2. Calculate actual fetch window (from - 52 candles, to + 20,000 candles or custom `to`)
3. Fetch candles from Birdeye API
4. Store candles in ClickHouse
5. Return fetch statistics

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

## Related Handlers

- [[fetch-ohlcv]] - Handler implementation
- [[ensure-ohlcv-coverage]] - Batch coverage ensuring
- [[fetch-from-duckdb]] - Fetch from DuckDB instead of API

## Notes

- Uses Birdeye API directly (not through worklist)
- Stores in ClickHouse `ohlcv_candles` table
- Note: Birdeye API uses `1H` (not `1h`) for hourly intervals

