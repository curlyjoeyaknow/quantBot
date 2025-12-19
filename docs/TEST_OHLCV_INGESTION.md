# Testing OHLCV Ingestion Workflow

## Quick Test Command

To test the OHLCV ingestion workflow for a date range, use the existing test script:

```bash
# Using the test script
DUCKDB_PATH=./data/tele.duckdb tsx scripts/test-ohlcv-ingestion.ts ./data/tele.duckdb 2025-07-15 2025-07-16
```

Or with pnpm:

```bash
pnpm exec tsx scripts/test-ohlcv-ingestion.ts ./data/tele.duckdb 2025-07-15 2025-07-16
```

## Date Range Format

The script accepts dates in ISO 8601 format:
- `YYYY-MM-DD` (e.g., `2025-07-15`)
- `YYYY-MM-DDTHH:mm:ssZ` (e.g., `2025-07-15T00:00:00Z`)

## Parameters

1. **DuckDB path** (first argument or `DUCKDB_PATH` env var)
2. **From date** (second argument, default: `2025-12-01`)
3. **To date** (third argument, default: `2025-12-16`)

## Example

```bash
# Test for July 15-16, 2025
DUCKDB_PATH=./data/tele.duckdb tsx scripts/test-ohlcv-ingestion.ts ./data/tele.duckdb 2025-07-15 2025-07-16
```

## Expected Output

The workflow will:
1. Generate worklist from DuckDB (calls in the date range)
2. Fetch candles from Birdeye API for each token
3. Store candles in ClickHouse
4. Update DuckDB metadata
5. Return structured results with:
   - Worklist generated count
   - Work items processed/succeeded/failed/skipped
   - Total candles fetched and stored
   - Any errors encountered

## Troubleshooting

### tsx Dependency Issues

If you encounter `ERR_PACKAGE_PATH_NOT_EXPORTED` errors with tsx:

1. Try using `pnpm exec tsx` instead of direct `tsx`
2. Or use `node --import tsx` (Node.js 20.6+)
3. Or rebuild dependencies: `pnpm install --force`

### Missing DuckDB File

Ensure the DuckDB file exists at the specified path. Common locations:
- `./data/tele.duckdb`
- `./tele.duckdb`
- `./data/result.duckdb`

### API Rate Limits

The workflow uses rate limiting (default: 100ms between requests). If you hit rate limits:
- Increase `rateLimitMs` in the workflow spec
- Reduce the date range
- Check Birdeye API quota

## Workflow Contract Compliance

This workflow follows the workflow contract:
- ✅ Validates spec with Zod
- ✅ Uses WorkflowContext for all dependencies
- ✅ Returns JSON-serializable results
- ✅ Explicit error policy (collect vs failFast)
- ✅ Default parameter pattern for ctx

