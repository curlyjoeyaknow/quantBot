# ensure-ohlcv-coverage Handler

## Overview

Ensures OHLCV coverage for tokens in the calls database. Validates addresses, resolves chains, and fetches missing candles.

## Location

`packages/cli/src/handlers/ingestion/ensure-ohlcv-coverage.ts`

## Handler Function

`ensureOhlcvCoverageHandler`

## Command

```bash
quantbot ingestion ensure-ohlcv-coverage [options]
```

## Examples

```bash
# Ensure coverage for recent tokens (default: last 90 days, limit 200)
quantbot ingestion ensure-ohlcv-coverage --duckdb data/alerts.duckdb

# Custom max age and limit
quantbot ingestion ensure-ohlcv-coverage --duckdb data/alerts.duckdb --max-age-days 180 --limit 500

# Using environment variable
DUCKDB_PATH=data/alerts.duckdb quantbot ingestion ensure-ohlcv-coverage

# JSON output
quantbot ingestion ensure-ohlcv-coverage --duckdb data/alerts.duckdb --format json
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (or set DUCKDB_PATH env var)
- `--max-age-days <days>`: Maximum age of tokens to process (default: 90)
- `--limit <count>`: Limit number of tokens to process (default: 200)
- `--format <format>`: Output format

## Workflow

1. **Query recent tokens**: Query all tokens < max-age-days old from DuckDB
2. **Limit tokens**: Process first N tokens (default: 200)
3. **Validate addresses**: Validate mint addresses and resolve chains (cheap metadata lookup first)
4. **Rate limiting**: 100ms between metadata calls
5. **Fetch candles**: For each validated token:
   - Check existing coverage in ClickHouse
   - Fetch missing candles from Birdeye API
   - Store in ClickHouse
6. **Rate limiting**: Respects API rate limits (configurable delays)

## Token Validation

- Validates mint addresses
- Resolves chains (Solana, Ethereum, BSC, Base)
- Filters out invalid tokens

## Candle Fetching

- Fetches candles for each token's alert time window
- Supports intervals: `15s`, `1m`, `5m`
- Stores in ClickHouse `ohlcv_candles` table

## Returns

```typescript
{
  tokensProcessed: number;
  tokensValidated: number;
  tokensInvalid: number;
  candlesFetched: number;
  errors: string[];
}
```

## Related

- [[fetch-ohlcv]] - Direct single-mint fetch
- [[OHLCV Coverage Analysis]] - Coverage analysis
- [[OHLCV Fetch]] - Main OHLCV fetch workflow

