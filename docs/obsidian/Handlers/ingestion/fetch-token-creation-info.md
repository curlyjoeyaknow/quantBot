# fetch-token-creation-info Handler

## Overview

Fetches token creation info from Birdeye API for all Solana tokens we have alerts for.

## Location

`packages/cli/src/handlers/ingestion/fetch-token-creation-info.ts`

## Handler Function

`fetchTokenCreationInfoHandler`

## Command

```bash
quantbot ingestion fetch-token-creation-info [options]
```

## Examples

```bash
# Fetch token creation info for all Solana tokens
quantbot ingestion fetch-token-creation-info --duckdb data/alerts.duckdb

# Using environment variable
DUCKDB_PATH=data/alerts.duckdb quantbot ingestion fetch-token-creation-info

# JSON output
quantbot ingestion fetch-token-creation-info --duckdb data/alerts.duckdb --format json
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (or set DUCKDB_PATH env var)
- `--format <format>`: Output format (default: `table`)

## Returns

```typescript
{
  tokensProcessed: number;
  creationInfoFetched: number;
  errors: string[];
}
```

## Related

- [[ensure-ohlcv-coverage]] - OHLCV coverage
- [[OHLCV Fetch]] - OHLCV fetch workflow

