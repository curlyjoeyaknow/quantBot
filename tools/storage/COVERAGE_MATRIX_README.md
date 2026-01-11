# OHLCV Coverage Matrix

The coverage matrix is a pre-computed table in DuckDB that maps OHLCV data coverage for each token-alert combination. This enables fast queries to determine which tokens have OHLCV data for which alerts, and vice versa, without querying ClickHouse on every request.

## Schema

The `ohlcv_coverage_matrix` table stores:
- Alert/call identifiers (chat_id, message_id, trigger_ts_ms, caller_name)
- Token identifiers (mint, chain)
- Coverage metrics (has_ohlcv_data, coverage_ratio, expected_candles, actual_candles, intervals_available)
- Time window information (pre_window_minutes, post_window_minutes, coverage_start_ts_ms, coverage_end_ts_ms)
- Metadata (last_checked_at, last_updated_at)

## Views

The schema includes several views for easy querying:

### `token_coverage_summary`
Summary of coverage per token:
```sql
SELECT * FROM token_coverage_summary WHERE mint = '...';
```

### `caller_coverage_summary`
Summary of coverage per caller:
```sql
SELECT * FROM caller_coverage_summary WHERE caller_name = 'Brook';
```

### `caller_monthly_coverage`
Monthly coverage breakdown by caller:
```sql
SELECT * FROM caller_monthly_coverage WHERE caller_name = 'Brook' ORDER BY month;
```

### `alerts_missing_coverage`
Alerts that are missing coverage or have low coverage (< 80%):
```sql
SELECT * FROM alerts_missing_coverage LIMIT 10;
```

## Populating the Matrix

### Initial Population

Populate the coverage matrix for all alerts:

```bash
python3 tools/storage/populate_coverage_matrix.py --duckdb data/tele.duckdb
```

### Filtered Population

Populate for a specific caller:

```bash
python3 tools/storage/populate_coverage_matrix.py --duckdb data/tele.duckdb --caller Brook
```

Populate for a date range:

```bash
python3 tools/storage/populate_coverage_matrix.py --duckdb data/tele.duckdb --start-month 2025-11 --end-month 2025-12
```

### Refresh All

Force refresh of all alerts (even recently checked ones):

```bash
python3 tools/storage/populate_coverage_matrix.py --duckdb data/tele.duckdb --refresh-all
```

### Options

- `--duckdb`: Path to DuckDB database (required)
- `--caller`: Filter by specific caller name
- `--start-month`: Start month in YYYY-MM format
- `--end-month`: End month in YYYY-MM format
- `--refresh-all`: Refresh all alerts, even recently checked ones
- `--pre-window`: Pre-window minutes (default: 260)
- `--post-window`: Post-window minutes (default: 1440)
- `--interval`: OHLCV interval to check (default: 5m)
- `--verbose`: Show verbose output

## Querying the Matrix

### Find all alerts for a token

```sql
SELECT 
  caller_name,
  trigger_ts_ms,
  has_ohlcv_data,
  coverage_ratio,
  actual_candles,
  expected_candles
FROM ohlcv_coverage_matrix
WHERE mint = '7pXs123456789012345678901234567890pump'
ORDER BY trigger_ts_ms DESC;
```

### Find all tokens for a caller

```sql
SELECT 
  mint,
  COUNT(*) as total_calls,
  COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) as calls_with_coverage,
  AVG(coverage_ratio) as avg_coverage
FROM ohlcv_coverage_matrix
WHERE caller_name = 'Brook'
GROUP BY mint
ORDER BY total_calls DESC;
```

### Find alerts missing coverage

```sql
SELECT 
  caller_name,
  mint,
  trigger_ts_ms,
  coverage_ratio,
  expected_candles,
  actual_candles
FROM ohlcv_coverage_matrix
WHERE has_ohlcv_data = FALSE OR coverage_ratio < 0.8
ORDER BY trigger_ts_ms DESC
LIMIT 20;
```

### Monthly coverage by caller

```sql
SELECT 
  caller_name,
  strftime(to_timestamp(trigger_ts_ms / 1000), '%Y-%m') as month,
  COUNT(*) as total_calls,
  COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) as calls_with_coverage,
  CAST(COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) AS DOUBLE) / COUNT(*) as coverage_ratio
FROM ohlcv_coverage_matrix
WHERE caller_name IS NOT NULL
GROUP BY caller_name, month
ORDER BY caller_name, month;
```

## Integration with Fetch Workflows

The coverage matrix can be used to:

1. **Identify gaps before fetching**: Query `alerts_missing_coverage` to find alerts that need OHLCV data
2. **Prioritize fetches**: Sort by `coverage_ratio` or `trigger_ts_ms` to prioritize important alerts
3. **Skip already-covered alerts**: Check `has_ohlcv_data = TRUE` before fetching

Example integration:

```python
# Find alerts that need OHLCV data
conn.execute("""
  SELECT mint, trigger_ts_ms, caller_name
  FROM alerts_missing_coverage
  WHERE caller_name = 'Brook'
  ORDER BY trigger_ts_ms DESC
  LIMIT 100
""")
```

## Maintenance

The coverage matrix is automatically updated when:
- New alerts are added to the database
- OHLCV data is fetched for new tokens
- The `populate_coverage_matrix.py` script is run

By default, the script only checks alerts that haven't been checked in the last 24 hours. Use `--refresh-all` to force a full refresh.

## Performance

The coverage matrix is indexed for fast queries:
- Primary key: (chat_id, message_id, mint, chain)
- Indexes on: mint, caller_name, trigger_ts_ms, has_ohlcv_data, coverage_ratio
- Composite indexes for common query patterns

Queries should be very fast (< 100ms) even on large datasets.



