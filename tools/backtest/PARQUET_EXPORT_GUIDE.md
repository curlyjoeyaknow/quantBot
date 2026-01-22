# Parquet Export Guide - Complete Audit Trail

## Overview

All backtest operations now export comprehensive parquet files for:
1. **Per-alert price action** - Price data for each token from alert time
2. **Per-caller results** - Aggregated results grouped by caller
3. **Per-trade details** - Individual trade results for strategy runs
4. **Baseline cache** - Reusable path metrics for optimization runs
5. **Per-token slices** - Raw OHLCV candle data (already exists)

## File Structure

```
results/
├── baseline_cache_YYYYMMDD_YYYYMMDD.parquet          # Baseline results (all alerts)
├── per_alert/
│   ├── alert_1_<mint>.parquet                        # Price action for alert 1
│   ├── alert_2_<mint>.parquet                        # Price action for alert 2
│   └── ...
├── per_caller/
│   ├── caller_<name>.parquet                         # Results for caller
│   └── ...
└── per_trade/
    ├── trade_1_<mint>.parquet                         # Trade details for alert 1
    ├── trade_2_<mint>.parquet                         # Trade details for alert 2
    └── ...

slices/
├── slice_YYYYMMDD_YYYYMMDD_<fingerprint>.parquet     # Per-token candle data
└── slice_YYYYMMDD_YYYYMMDD_<fingerprint>_part/      # Partitioned by token
    ├── token_address=<mint>/
    │   └── data.parquet
    └── ...
```

## Baseline Backtest Exports

### Command
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

### Exports

1. **Baseline Cache Parquet** (`--export-baseline-parquet`)
   - **Content**: All path metrics for all alerts
   - **Columns**: alert_id, mint, caller, entry_price, ath_mult, dd_initial, time_to_2x, etc.
   - **Use**: Reuse in optimization runs to skip recomputing path metrics
   - **Size**: ~28KB for 75 alerts

2. **Per-Alert Parquet** (`--export-per-alert-parquet`)
   - **Content**: Price action (OHLCV candles) for each alert from alert time
   - **Columns**: timestamp, open, high, low, close, volume
   - **File naming**: `alert_{alert_id}_{mint[:8]}.parquet`
   - **Use**: Audit individual alert price action, replay trades

3. **Per-Caller Parquet** (`--export-per-caller-parquet`)
   - **Content**: Aggregated results grouped by caller
   - **Columns**: Same as baseline cache, but filtered by caller
   - **File naming**: `caller_{sanitized_name}.parquet`
   - **Use**: Analyze caller performance, compare callers

## Strategy Backtest Exports

### Command
```bash
python3 tools/backtest/run_strategy.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --tp 2.0 \
  --sl 0.7 \
  --store-duckdb \
  --export-per-trade-parquet results/per_trade
```

### Exports

1. **Per-Trade Parquet** (`--export-per-trade-parquet`)
   - **Content**: Individual trade results with strategy execution
   - **Columns**: alert_id, mint, caller, entry_price, exit_price, tp_sl_exit_reason, tp_sl_ret, etc.
   - **File naming**: `trade_{alert_id}_{mint[:8]}.parquet`
   - **Use**: Audit individual trades, analyze strategy performance per trade

## CLI Integration

### Direct Script Execution

All scripts are CLI-callable:

```bash
# Baseline
python3 tools/backtest/run_baseline_all.py --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb

# Strategy
python3 tools/backtest/run_strategy.py --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb --tp 2.0 --sl 0.7

# Optimizer
python3 tools/backtest/run_random_search.py --from 2025-01-01 --to 2025-12-31 --duckdb data/alerts.duckdb --trials 100
```

### Unified CLI Wrapper

Use `cli_wrapper.py` for consistent interface:

```bash
# Baseline
python3 tools/backtest/cli_wrapper.py baseline \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --export-baseline-parquet results/baseline_cache.parquet \
  --export-per-alert-parquet results/per_alert \
  --export-per-caller-parquet results/per_caller

# Strategy
python3 tools/backtest/cli_wrapper.py strategy \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --tp 2.0 \
  --sl 0.7 \
  --export-per-trade-parquet results/per_trade

# Optimizer
python3 tools/backtest/cli_wrapper.py optimizer \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --trials 100
```

### From Python Code

```python
import subprocess
import sys

# Run baseline via CLI
result = subprocess.run([
    sys.executable,
    "tools/backtest/run_baseline_all.py",
    "--from", "2025-01-01",
    "--to", "2025-12-31",
    "--duckdb", "data/alerts.duckdb",
    "--export-baseline-parquet", "results/baseline_cache.parquet",
    "--export-per-alert-parquet", "results/per_alert",
    "--export-per-caller-parquet", "results/per_caller"
], check=True)

# Run strategy via CLI
result = subprocess.run([
    sys.executable,
    "tools/backtest/run_strategy.py",
    "--from", "2025-01-01",
    "--to", "2025-12-31",
    "--duckdb", "data/alerts.duckdb",
    "--tp", "2.0",
    "--sl", "0.7",
    "--export-per-trade-parquet", "results/per_trade"
], check=True)
```

## Benefits

### 1. Complete Audit Trail
- Every alert has its price action preserved
- Every trade has its details preserved
- Every caller has its aggregated results preserved

### 2. Speed Optimization
- Baseline cache: Skip recomputing path metrics (10-100x faster)
- Per-alert cache: Skip reloading candles for individual alerts
- Per-caller cache: Fast caller-specific analysis

### 3. Reproducibility
- All data preserved in parquet format
- Can replay any trade or alert
- Can verify any optimization result

### 4. CLI Integration
- No need to import/rewrite scripts
- Call scripts directly from optimization runs
- Consistent interface via `cli_wrapper.py`

## Example: Complete Workflow

### Step 1: Run Baseline with All Exports
```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --store-duckdb \
  --export-baseline-parquet results/baseline_cache_20250101_20251231.parquet \
  --export-per-alert-parquet results/per_alert \
  --export-per-caller-parquet results/per_caller
```

**Outputs**:
- `baseline_cache_20250101_20251231.parquet` - All path metrics
- `results/per_alert/alert_*.parquet` - Price action per alert
- `results/per_caller/caller_*.parquet` - Results per caller

### Step 2: Run Strategy with Trade Exports
```bash
python3 tools/backtest/run_strategy.py \
  --from 2025-01-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --tp 2.0 \
  --sl 0.7 \
  --store-duckdb \
  --export-per-trade-parquet results/per_trade
```

**Outputs**:
- `results/per_trade/trade_*.parquet` - Individual trade details

### Step 3: Use Cache in Optimization
```python
# Optimization run can now:
# 1. Load baseline cache (skip path metric computation)
# 2. Load per-alert candles (skip reloading from ClickHouse)
# 3. Call strategy scripts via CLI (no code duplication)
```

## File Sizes

**Example**: 1000 alerts, 48-hour horizon, 60s interval

- Baseline cache: ~400KB (all path metrics)
- Per-alert parquet: ~50KB per alert = ~50MB total
- Per-caller parquet: ~10KB per caller = ~100KB total (10 callers)
- Per-trade parquet: ~2KB per trade = ~2MB total
- Slice parquet: ~100MB (all candles)

**Total**: ~150MB for complete audit trail

## Next Steps

1. ✅ **Per-alert export**: Implemented
2. ✅ **Per-caller export**: Implemented
3. ✅ **Per-trade export**: Implemented
4. ✅ **CLI integration**: Implemented
5. 🔨 **Optimization runs use cache**: Needs implementation
6. 🔨 **Auto-detect cache**: Check for existing cache before computing

