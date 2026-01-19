# Running Backtests - Command Reference

## 🎯 Quick Start

### Run Baseline Backtest (Truth Layer)

```bash
# Simple baseline backtest
python3 tools/backtest/run_baseline_all.py \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --duckdb data/alerts.duckdb \
  --store-duckdb \
  --run-name "baseline_2024"

# With custom interval and horizon
python3 tools/backtest/run_baseline_all.py \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --interval-seconds 300 \
  --horizon-hours 48 \
  --duckdb data/alerts.duckdb \
  --store-duckdb
```

### Run Strategy Backtest

```bash
python3 tools/backtest/run_strategy.py \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --duckdb data/alerts.duckdb \
  --strategy-config configs/strategy.json
```

### Run Optimizer (Grid Search)

```bash
python3 tools/backtest/run_optimizer.py \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --duckdb data/alerts.duckdb \
  --caller "caller_name" \
  --constraints configs/constraints.json
```

## 📋 Common Options

### Baseline Backtest Options

```bash
--from DATE_FROM          # Start date (YYYY-MM-DD) - REQUIRED
--to DATE_TO              # End date (YYYY-MM-DD) - REQUIRED
--duckdb PATH             # DuckDB file path (default: data/alerts.duckdb)
--chain CHAIN             # Chain (solana, ethereum, etc.)
--interval-seconds SEC    # Candle interval: 60 or 300 (default: 300 = 5m)
--horizon-hours HOURS     # Observation window (default: 48)
--slice-dir DIR           # Directory for slice files (default: slices/per_token)
--store-duckdb            # Store results to DuckDB baseline schema
--run-name NAME           # Custom run name (default: auto-generated)
--threads N               # Number of threads (default: CPU count)
--min-trades N            # Minimum trades per caller to include
--top N                   # Show top N callers in leaderboard
```

### ClickHouse Options (if using ClickHouse)

```bash
--ch-host HOST            # ClickHouse host
--ch-port PORT            # ClickHouse port
--ch-database DB          # ClickHouse database
--ch-table TABLE          # ClickHouse table name
--ch-user USER            # ClickHouse user
--ch-password PASSWORD    # ClickHouse password
--ch-batch SIZE           # Batch size for ClickHouse queries
```

## 🔧 Examples

### Example 1: Full Year Baseline

```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --duckdb data/alerts.duckdb \
  --interval-seconds 300 \
  --horizon-hours 48 \
  --store-duckdb \
  --run-name "baseline_2024_full_year" \
  --threads 8
```

### Example 2: Quick Test (1 Month)

```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --duckdb data/alerts.duckdb \
  --store-duckdb \
  --run-name "test_jan_2024"
```

### Example 3: Reuse Existing Slices

```bash
# First run - exports slices
python3 tools/backtest/run_baseline_all.py \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --duckdb data/alerts.duckdb \
  --slice-dir slices/per_token

# Second run - reuse slices (faster)
python3 tools/backtest/run_baseline_all.py \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --duckdb data/alerts.duckdb \
  --reuse-slice \
  --store-duckdb
```

## 📊 Viewing Results

After running a backtest, view results:

```bash
# Start report server
python3 tools/backtest/report_server.py --duckdb data/alerts.duckdb

# Open browser
# http://localhost:8080/
```

## 🎛️ TypeScript CLI (if available)

If the TypeScript CLI is built:

```bash
# Build CLI first
pnpm build

# Run baseline
pnpm cli backtest baseline \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --interval 5m

# Run optimizer
pnpm cli backtest optimize \
  --caller "caller_name" \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --interval 5m
```

## 📝 Output

### Console Output

- Progress bars for slice export
- Caller leaderboard table
- Summary statistics

### DuckDB Storage (if `--store-duckdb`)

Results stored in:
- `baseline.runs_d` - Run metadata
- `baseline.alert_results_f` - Per-alert results
- `baseline.caller_stats_f` - Aggregated caller stats

### Files

- Slice files: `slices/per_token/{mint}.parquet`
- CSV exports: `results/` directory (if specified)

## 🚀 Performance Tips

1. **Use `--reuse-slice`** if slices already exist
2. **Increase `--threads`** for faster processing
3. **Use `--ch-batch`** to optimize ClickHouse queries
4. **Partition slices** with `--partition` for large datasets

## 🔍 Troubleshooting

### Out of Memory

```bash
# Reduce batch size
--ch-batch 100

# Use fewer threads
--threads 4
```

### ClickHouse Connection Issues

```bash
# Check environment variables
echo $CH_HOST $CH_PORT $CH_DATABASE

# Or pass explicitly
--ch-host localhost --ch-port 9000 --ch-database default
```

### DuckDB Lock Errors

```bash
# Close other connections
# Or use read-only mode where possible
```

