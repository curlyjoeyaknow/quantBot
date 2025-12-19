# Fetching OHLCV Data from Birdeye

This guide explains how to fetch OHLCV (Open/High/Low/Close/Volume) candle data from Birdeye API using QuantBot workflows.

## Overview

QuantBot provides two main approaches for fetching OHLCV data:

1. **Workflow-based ingestion** (Recommended) - Uses the `ingestOhlcv` workflow
2. **Direct backfill** - For single token backfilling

## Method 1: Workflow-Based Ingestion (Recommended)

The workflow-based approach is the modern, recommended way to fetch OHLCV data. It:

- Generates a worklist from DuckDB (offline planning)
- Fetches candles from Birdeye API (online boundary)
- Stores candles in ClickHouse (storage)
- Updates DuckDB metadata (tracking)

### Basic Usage

```bash
# Fetch OHLCV for all calls in DuckDB with default settings
quantbot ingestion ohlcv --duckdb data/tele.duckdb

# Fetch OHLCV for a specific date range
quantbot ingestion ohlcv --duckdb data/tele.duckdb \
  --from 2024-01-01 \
  --to 2024-01-31

# Customize time windows and interval
quantbot ingestion ohlcv --duckdb data/tele.duckdb \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --pre-window 260 \
  --post-window 1440 \
  --interval 5m
```

### Parameters

- `--duckdb <path>` - Path to DuckDB database (required, or set `DUCKDB_PATH` env var)
- `--from <date>` - Start date (ISO 8601, optional)
- `--to <date>` - End date (ISO 8601, optional)
- `--pre-window <minutes>` - Minutes before alert to fetch (default: 260)
- `--post-window <minutes>` - Minutes after alert to fetch (default: 1440)
- `--interval <interval>` - Candle interval: `1m`, `5m`, `15m`, or `1h` (default: `1m`)
  - Note: `15m` maps to `5m` in workflow, `1h` maps to `1H`

### How It Works

1. **Worklist Generation**: Queries DuckDB for calls that need OHLCV data
2. **Birdeye Fetching**: Uses `OhlcvBirdeyeFetch` service to fetch candles from Birdeye API
3. **Storage**: Stores candles in ClickHouse for fast querying
4. **Metadata Update**: Updates DuckDB with coverage information

### Example Output

```json
{
  "worklistGenerated": 150,
  "workItemsProcessed": 150,
  "workItemsSucceeded": 148,
  "workItemsFailed": 2,
  "workItemsSkipped": 0,
  "totalCandlesFetched": 45000,
  "totalCandlesStored": 45000,
  "errors": [
    {
      "mint": "So111...",
      "chain": "solana",
      "error": "Token not found"
    }
  ],
  "startedAtISO": "2024-01-15T10:00:00.000Z",
  "completedAtISO": "2024-01-15T10:05:30.000Z",
  "durationMs": 330000
}
```

## Method 2: Direct Backfill

For backfilling a single token's OHLCV data:

```bash
# Backfill OHLCV for a specific token
quantbot ohlcv backfill \
  --mint So11111111111111111111111111111111111111112 \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --interval 5m \
  --chain solana
```

### Parameters

- `--mint <address>` - Token mint address (required)
- `--from <date>` - Start date (ISO 8601, required)
- `--to <date>` - End date (ISO 8601, required)
- `--interval <interval>` - Candle interval: `1m`, `5m`, `15m`, `1h`, `4h`, `1d` (default: `5m`)
- `--chain <chain>` - Blockchain: `solana`, `ethereum`, `bsc`, `base` (default: `solana`)

## Querying OHLCV Data

After fetching, query the stored data:

```bash
# Query OHLCV candles
quantbot ohlcv query \
  --mint So11111111111111111111111111111111111111112 \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --interval 5m \
  --chain solana
```

## Environment Variables

Set these environment variables for Birdeye API access:

```bash
export BIRDEYE_API_KEY="your-api-key-here"
export DUCKDB_PATH="data/tele.duckdb"  # Optional, can use --duckdb flag
```

## Supported Intervals

- **Workflow ingestion**: `15s`, `1m`, `5m`, `1H`
- **Direct backfill**: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`
- **Query**: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`

## Error Handling

The workflow uses `errorMode: 'collect'` by default, which means:

- Errors for individual tokens are collected and reported
- The workflow continues processing other tokens
- Failed tokens are listed in the `errors` array in the result

To fail fast on first error, you would need to modify the handler (not currently exposed via CLI).

## Best Practices

1. **Use workflow ingestion** for batch processing multiple tokens
2. **Use direct backfill** for single token operations or testing
3. **Set appropriate time windows** based on your strategy needs
4. **Monitor API credits** - Birdeye API has rate limits and credit costs
5. **Check coverage** after ingestion to verify data completeness

## Troubleshooting

### "Token not found" errors

- Verify the mint address is correct
- Check if the token exists on the specified chain
- Some tokens may not have OHLCV data available

### Rate limiting

- The workflow includes rate limiting (default: 100ms between requests)
- Adjust `rateLimitMs` in the handler if needed
- Monitor your Birdeye API credits

### Missing data

- Use `quantbot ohlcv coverage` to check data coverage
- Verify date ranges are correct
- Check ClickHouse storage is accessible
