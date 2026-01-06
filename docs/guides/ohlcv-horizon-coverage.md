# OHLCV Horizon Coverage Matrix

## Overview

The OHLCV Horizon Coverage Matrix provides a comprehensive view of data availability for backtesting. It shows what percentage of alerts have sufficient OHLCV candle data at different horizon times (relative to alert time) across different months.

## Matrix Structure

- **Columns**: Monthly buckets from 2025-05-01 to 2026-01-05
- **Rows**: Horizon times:
  - `-4hrs`: 4 hours before alert
  - `0hrs`: At alert time
  - `+4hrs`, `+12hrs`, `+24hrs`, `+48hrs`, `+72hrs`, `+144hrs`, `+288hrs`: After alert
- **Values**: Coverage percentage (0-100%) for alerts that have data at that horizon

## Usage

### Generate Coverage Matrices

Generate matrices for both 1m and 5m candles:

```bash
# Generate and store in DuckDB
pnpm coverage:ohlcv:horizon

# Generate with visualization
pnpm coverage:ohlcv:horizon:visualize

# Or use the script directly
./scripts/generate-ohlcv-horizon-coverage.sh --duckdb data/tele.duckdb --visualize
```

### Query Stored Matrix

```bash
# Query 1m matrix
python3 tools/storage/query_horizon_coverage.py --duckdb data/tele.duckdb --interval 1m

# Query 5m matrix
python3 tools/storage/query_horizon_coverage.py --duckdb data/tele.duckdb --interval 5m

# Filter to specific month
python3 tools/storage/query_horizon_coverage.py --duckdb data/tele.duckdb --interval 1m --month 2025-05

# List available months
python3 tools/storage/query_horizon_coverage.py --duckdb data/tele.duckdb --interval 1m --list-months
```

### Direct SQL Queries

```sql
-- Get coverage for all months and horizons (1m)
SELECT * FROM ohlcv_horizon_coverage_1m 
ORDER BY month_key, horizon_hours;

-- Get coverage for specific month
SELECT * FROM ohlcv_horizon_coverage_1m 
WHERE month_key = '2025-05'
ORDER BY horizon_hours;

-- Find months with low coverage at specific horizon
SELECT month_key, coverage_percentage, total_alerts, alerts_with_coverage
FROM ohlcv_horizon_coverage_1m
WHERE horizon_hours = 24
  AND coverage_percentage < 80
ORDER BY month_key;

-- Compare 1m vs 5m coverage
SELECT 
  m1.month_key,
  m1.horizon_hours,
  m1.coverage_percentage as coverage_1m,
  m5.coverage_percentage as coverage_5m,
  m1.coverage_percentage - m5.coverage_percentage as diff
FROM ohlcv_horizon_coverage_1m m1
LEFT JOIN ohlcv_horizon_coverage_5m m5
  ON m1.month_key = m5.month_key 
  AND m1.horizon_hours = m5.horizon_hours
ORDER BY m1.month_key, m1.horizon_hours;
```

## Interpretation

### Coverage Percentages

- **90-100%**: Excellent coverage - most alerts have data
- **75-89%**: Good coverage - sufficient for most backtests
- **50-74%**: Moderate coverage - some gaps may exist
- **<50%**: Poor coverage - targeted fetching needed

### Horizon Times

- **Negative horizons** (-4hrs): Pre-alert data availability
- **0hrs**: Data at alert time (critical for entry)
- **Positive horizons**: Post-alert data for exit strategies

### Use Cases

1. **Backtest Planning**: Identify months/horizons with sufficient data
2. **Targeted Fetching**: Find gaps that need data fetching
3. **Strategy Design**: Understand what time windows are available
4. **Data Quality**: Monitor coverage trends over time

## Storage

The matrices are stored in DuckDB tables:
- `ohlcv_horizon_coverage_1m` - 1-minute candle coverage
- `ohlcv_horizon_coverage_5m` - 5-minute candle coverage

Each table contains:
- `month_key`: Month in YYYY-MM format
- `horizon_hours`: Horizon time in hours
- `coverage_percentage`: Percentage of alerts with data (0-100)
- `total_alerts`: Total number of alerts in that month
- `alerts_with_coverage`: Number of alerts with data at that horizon
- `interval`: Candle interval ('1m' or '5m')
- `generated_at`: Timestamp when matrix was generated

## Performance

The matrix generation can take time depending on:
- Number of alerts per month
- ClickHouse query performance
- Network latency

Progress is shown during generation. The script checks for data existence (not full coverage calculation) to keep queries fast.

## Examples

### Find months ready for backtesting

```sql
-- Months with >80% coverage at all key horizons
SELECT month_key, 
       MIN(coverage_percentage) as min_coverage
FROM ohlcv_horizon_coverage_1m
WHERE horizon_hours IN (-4, 0, 4, 12, 24, 48)
GROUP BY month_key
HAVING min_coverage >= 80
ORDER BY month_key;
```

### Identify data gaps

```sql
-- Horizons with <50% coverage
SELECT month_key, horizon_hours, coverage_percentage
FROM ohlcv_horizon_coverage_1m
WHERE coverage_percentage < 50
ORDER BY month_key, horizon_hours;
```

