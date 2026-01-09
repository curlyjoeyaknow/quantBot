# Candle Deduplication Guide

## Problem

Tokens may have duplicate candles in ClickHouse due to multiple ingestion runs. This causes issues when:
- Analyzing token performance (inflated candle counts)
- Running backtests (duplicate data points)
- Generating reports (inaccurate statistics)

## Solution

We've added ingestion metadata tracking to identify and remove duplicates, keeping only the most recent ingestion for each `(token_address, chain, timestamp, interval)` combination.

## Schema Changes

### New Columns in `ohlcv_candles`

```sql
ALTER TABLE quantbot.ohlcv_candles
ADD COLUMN ingested_at DateTime DEFAULT now(),
ADD COLUMN ingestion_run_id String DEFAULT '';
```

- **`ingested_at`**: Timestamp when the candle was inserted into ClickHouse
- **`ingestion_run_id`**: Optional identifier for tracking ingestion runs

### Migration

Run the migration script to add these columns to existing tables:

```bash
# Dry run (shows what would be done)
python tools/storage/migrate_add_ingestion_metadata.py --dry-run

# Apply migration
python tools/storage/migrate_add_ingestion_metadata.py

# Analyze duplicates only
python tools/storage/migrate_add_ingestion_metadata.py --analyze

# Create deduplication view
python tools/storage/migrate_add_ingestion_metadata.py --create-view
```

## CLI Commands

### 1. Analyze Duplicate Candles

Identify tokens with duplicate candles:

```bash
# Analyze all tokens
quantbot storage analyze-duplicates

# Show detailed ingestion timestamps
quantbot storage analyze-duplicates --show-details

# Filter by token
quantbot storage analyze-duplicates --token So11111111111111111111111111111111111111112

# Filter by chain and interval
quantbot storage analyze-duplicates --chain solana --interval 5m

# Limit results
quantbot storage analyze-duplicates --limit 50

# JSON output
quantbot storage analyze-duplicates --format json
```

**Output:**
- Total duplicate groups
- Total extra rows to remove
- List of duplicate candle groups with ingestion times
- Summary by token (tokens with most duplicates)

### 2. Deduplicate Candles

Remove duplicate candles, keeping only the most recent ingestion:

```bash
# Dry run (default - shows what would be deleted)
quantbot storage deduplicate

# Actually delete duplicates for a specific token
quantbot storage deduplicate --token So11111111111111111111111111111111111111112 --no-dry-run

# Deduplicate all candles for a chain
quantbot storage deduplicate --chain solana --no-dry-run

# Deduplicate specific interval
quantbot storage deduplicate --interval 5m --no-dry-run

# Deduplicate everything (use with caution!)
quantbot storage deduplicate --no-dry-run
```

**Safety:**
- Default is `--dry-run` (no changes made)
- Must explicitly use `--no-dry-run` to delete
- ClickHouse DELETE is asynchronous (may take time to complete)

### 3. Generate Ingestion Report

Generate comprehensive report showing tokens sorted by most recent ingestion aligned with alert times:

```bash
# Generate report for top 100 tokens
python tools/storage/generate_candle_ingestion_report.py \
  --duckdb data/alerts.duckdb \
  --output candle_ingestion_report.json \
  --limit 100

# CSV format
python tools/storage/generate_candle_ingestion_report.py \
  --duckdb data/alerts.duckdb \
  --output candle_ingestion_report.csv \
  --format csv \
  --limit 100

# Print to stdout
python tools/storage/generate_candle_ingestion_report.py \
  --duckdb data/alerts.duckdb \
  --limit 50
```

**Report includes:**
- Summary statistics (coverage rate, duplicate counts)
- Per-token analysis (candles, duplicates, ingestion times)
- Tokens sorted by most recent ingestion
- Alert time alignment
- Coverage analysis

## Deduplication View

A view is automatically created that shows only the most recent candles:

```sql
-- Query deduplicated candles
SELECT * FROM quantbot.ohlcv_candles_deduplicated
WHERE token_address = 'YOUR_TOKEN'
  AND timestamp >= '2024-01-01'
ORDER BY timestamp ASC;
```

The view uses `ROW_NUMBER()` with `PARTITION BY (token_address, chain, timestamp, interval)` and `ORDER BY ingested_at DESC` to keep only the most recent ingestion.

## Workflow

### Step 1: Run Migration

```bash
# Add ingestion metadata columns
python tools/storage/migrate_add_ingestion_metadata.py
```

### Step 2: Analyze Duplicates

```bash
# Identify duplicate candles
quantbot storage analyze-duplicates --show-details --limit 100
```

### Step 3: Generate Report

```bash
# Generate comprehensive report
python tools/storage/generate_candle_ingestion_report.py \
  --duckdb data/alerts.duckdb \
  --output candle_report.json \
  --limit 200
```

### Step 4: Review and Deduplicate

```bash
# Dry run first
quantbot storage deduplicate --chain solana

# If results look good, actually delete
quantbot storage deduplicate --chain solana --no-dry-run
```

### Step 5: Verify

```bash
# Check that duplicates are gone
quantbot storage analyze-duplicates
```

## Code Changes

### OhlcvRepository

Updated `upsertCandles` to accept optional ingestion metadata:

```typescript
await ohlcvRepo.upsertCandles(
  token,
  chain,
  interval,
  candles,
  {
    ingestionRunId: 'run-2024-01-09-001',
    ingestionTimestamp: DateTime.utc()
  }
);
```

### New Handlers

- **`analyzeDuplicateCandlesHandler`**: Analyze duplicates
- **`deduplicateCandlesHandler`**: Remove duplicates

Both handlers follow the CLI handler pattern:
- Pure functions (no side effects in handler)
- Return typed results
- No console output (logging only)
- Testable with mocks

## Testing

### Unit Tests

```typescript
// Test analyze handler
const result = await analyzeDuplicateCandlesHandler(
  { limit: 10, chain: 'solana' },
  mockContext
);

expect(result.success).toBe(true);
expect(result.totalDuplicateGroups).toBeGreaterThanOrEqual(0);
```

### Integration Tests

```bash
# Test migration (dry run)
python tools/storage/migrate_add_ingestion_metadata.py --dry-run

# Test analysis
quantbot storage analyze-duplicates --limit 10

# Test deduplication (dry run)
quantbot storage deduplicate --token TEST_TOKEN
```

## Performance Considerations

### Deduplication Query

The deduplication query uses:
- `ALTER TABLE DELETE` (async, may take time)
- Subqueries to identify duplicates
- Filtering by `ingested_at` to keep most recent

For large tables (millions of rows):
- Run deduplication in batches (by token or time range)
- Monitor ClickHouse system tables for progress
- Consider running during low-traffic periods

### Indexes

The existing `ORDER BY (token_address, chain, timestamp)` index is sufficient for deduplication queries.

## Troubleshooting

### Migration Fails

**Error**: Column already exists
**Solution**: Migration is idempotent - safe to re-run

**Error**: ClickHouse connection refused
**Solution**: Ensure ClickHouse is running and env vars are set:
```bash
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_PORT=9000
export CLICKHOUSE_DATABASE=quantbot
```

### Deduplication Not Working

**Issue**: Duplicates still exist after deduplication
**Cause**: ClickHouse DELETE is asynchronous

**Solution**: Wait for ClickHouse to complete the operation, then verify:
```sql
-- Check system mutations
SELECT * FROM system.mutations
WHERE table = 'ohlcv_candles'
ORDER BY create_time DESC;
```

### Report Generation Slow

**Issue**: Report takes too long to generate
**Solution**: Reduce `--limit` parameter or filter by specific tokens/chains

## Best Practices

1. **Always run dry-run first** before deduplicating
2. **Backup data** before running deduplication on production
3. **Monitor ingestion** to prevent future duplicates
4. **Use ingestion_run_id** to track ingestion batches
5. **Query deduplicated view** for analysis to avoid duplicate data

## Future Enhancements

- [ ] Automatic deduplication on ingestion
- [ ] Ingestion run tracking in DuckDB
- [ ] Real-time duplicate detection
- [ ] Scheduled deduplication jobs
- [ ] Deduplication metrics dashboard

## References

- [ClickHouse ALTER TABLE DELETE](https://clickhouse.com/docs/en/sql-reference/statements/alter/delete)
- [ClickHouse ROW_NUMBER](https://clickhouse.com/docs/en/sql-reference/window-functions/row_number)
- [Architecture: Ports & Adapters](.cursor/rules/10-architecture-ports-adapters.mdc)
- [Testing Contracts](.cursor/rules/40-testing-contracts.mdc)

