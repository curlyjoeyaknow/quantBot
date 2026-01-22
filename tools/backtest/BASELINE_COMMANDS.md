# Baseline Backtest Commands

## Quick Start

### Basic Run (with all exports)
```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --store-duckdb \
  --export-baseline-parquet results/baseline_cache_20250501_20250502.parquet \
  --export-per-alert-parquet results/per_alert \
  --export-per-caller-parquet results/per_caller
```

### With Filters
```bash
# Filter by caller
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --caller "caller_name" \
  --store-duckdb \
  --export-baseline-parquet results/baseline_cache_filtered.parquet

# Filter by market cap
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --mcap-min 10000 \
  --mcap-max 100000 \
  --store-duckdb \
  --export-baseline-parquet results/baseline_cache_mcap.parquet
```

### Using Existing Slice (Faster)
```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --slice slices/slice_20250501_20250502_*.parquet \
  --store-duckdb \
  --export-baseline-parquet results/baseline_cache.parquet
```

## Key Metrics Exported

### Per-Alert Metrics
- `dd_pre2x` - Maximum drawdown before hitting 2x (only for tokens that hit 2x)
- `time_underwater_pre2x_s` - Seconds spent underwater (below entry) before hitting 2x
- `candles_underwater_pre2x` - Number of candles spent underwater before hitting 2x
- `dd_initial` - Maximum drawdown before recovery
- `dd_overall` - Maximum drawdown over entire horizon
- `ath_mult` - All-time high multiplier
- `time_to_2x_s`, `time_to_3x_s`, etc. - Time to reach each multiplier

### Per-Caller Aggregated Metrics
- `median_dd_pre2x_pct` - Median drawdown before 2x (%)
- `median_time_underwater_pre2x_hrs` - Median time underwater before 2x (hours)
- `hit2x_pct` - Percentage of alerts that hit 2x
- `median_ath` - Median all-time high multiplier

## Verify Exported Metrics

```bash
python3 -c "
import pandas as pd
df = pd.read_parquet('results/baseline_cache_20250501_20250502.parquet')
print(f'✅ Metrics: {len(df)} rows')
print(f'   dd_pre2x: {\"dd_pre2x\" in df.columns}')
print(f'   time_underwater_pre2x_s: {\"time_underwater_pre2x_s\" in df.columns}')
print(f'   candles_underwater_pre2x: {\"candles_underwater_pre2x\" in df.columns}')
if 'time_underwater_pre2x_s' in df.columns:
    hit_2x = df['time_underwater_pre2x_s'].notna()
    print(f'   Tokens that hit 2x: {hit_2x.sum()}/{len(df)}')
    if hit_2x.sum() > 0:
        print(f'   Median time underwater before 2x: {df.loc[hit_2x, \"time_underwater_pre2x_s\"].median() / 3600:.2f} hours')
"
```

## Use Baseline Cache in Optimization

```bash
python3 tools/backtest/run_random_search.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --trials 100 \
  --slice slices/slice_20250501_20250502_*.parquet \
  --baseline-parquet results/baseline_cache_20250501_20250502.parquet
```

## Query Metrics from DuckDB

```sql
-- Per-caller summary with new metrics
SELECT 
  caller,
  COUNT(*) as n,
  AVG(dd_pre2x) * 100 as avg_dd_pre2x_pct,
  AVG(time_underwater_pre2x_s / 3600.0) as avg_time_underwater_pre2x_hrs,
  COUNT(time_underwater_pre2x_s) as n_hit_2x
FROM baseline.alert_results_f
WHERE run_id = 'your_run_id'
GROUP BY caller
ORDER BY avg_dd_pre2x_pct ASC;
```


