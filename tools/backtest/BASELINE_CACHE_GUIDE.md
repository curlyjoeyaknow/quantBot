# Baseline Cache for Optimization Runs

## Overview

The baseline backtest computes **pure path metrics** (ath_mult, dd_initial, time_to_2x, etc.) which are expensive to recompute. These can be cached and reused by optimization runs to dramatically speed up execution.

## What Gets Cached

### 1. Slice Parquet Files (Candle Data)
**Location**: `slices/slice_YYYYMMDD_YYYYMMDD_<fingerprint>.parquet`

**What it contains**: Raw OHLCV candle data for all tokens in the date range

**Reuse**: Already cached! Use `--reuse-slice` flag

**Example**:
```bash
# First run - exports slice
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --store-duckdb

# Second run - reuses slice (much faster)
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --reuse-slice \
  --store-duckdb
```

### 2. Baseline Results Parquet (Path Metrics) ⭐ NEW
**Location**: `results/baseline_cache_YYYYMMDD_YYYYMMDD.parquet`

**What it contains**: Pre-computed path metrics for all alerts:
- `ath_mult` - All-time high multiple
- `dd_initial`, `dd_overall` - Drawdown metrics
- `time_to_2x_s`, `time_to_3x_s`, etc. - Time to milestones
- `entry_price`, `candles` - Entry details
- All other path metrics

**Reuse**: Export with `--export-baseline-parquet`, then use in optimization runs

**Example**:
```bash
# Step 1: Run baseline and export to parquet
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-05-02 \
  --duckdb data/alerts.duckdb \
  --store-duckdb \
  --export-baseline-parquet results/baseline_cache_20250501_20250502.parquet

# Step 2: Use cached baseline in optimization runs
# (This would need to be implemented in run_random_search.py or run_optimizer.py)
```

## Benefits

### Speed Improvement

**Without cache**:
- Load alerts: ~1s
- Query ClickHouse coverage: ~5-10s
- Export slice: ~50-100s (depends on data size)
- Compute path metrics: ~10-30s
- **Total: ~66-141s**

**With cache**:
- Load alerts: ~1s
- Load cached baseline parquet: ~0.1s
- **Total: ~1.1s** ⚡ **60-140x faster!**

### Use Cases

1. **Optimization Runs**: Test hundreds of strategy parameters without recomputing path metrics
2. **Multiple Strategy Tests**: Run different TP/SL combinations on same baseline
3. **Walk-Forward Analysis**: Reuse baseline for each fold
4. **Parameter Grid Search**: Test all combinations without recomputing

## Current Implementation

### ✅ What's Working

1. **Slice caching**: Already implemented (`--reuse-slice`)
2. **Baseline parquet export**: ✅ Just added (`--export-baseline-parquet`)
3. **Baseline storage in DuckDB**: ✅ Already working (`--store-duckdb`)

### 🔨 What Needs Implementation

**Optimization runs need to accept baseline parquet**:

```python
# In run_random_search.py or run_optimizer.py
ap.add_argument("--baseline-parquet", default=None,
                help="Path to cached baseline parquet file (skips path metric computation)")

# Then in the code:
if args.baseline_parquet:
    # Load cached baseline results
    baseline_df = pd.read_parquet(args.baseline_parquet)
    # Use baseline_df instead of computing path metrics
    # This saves ~10-30s per optimization run
```

## File Structure

```
results/
├── baseline_cache_20250501_20250502.parquet  # Cached path metrics
├── baseline_alerts.csv                       # CSV export (for reference)
└── baseline_callers.csv                      # CSV export (for reference)

slices/
├── slice_20250501_20250502_<fingerprint>.parquet  # Cached candle data
└── slice_20250501_20250502_<fingerprint>_part/   # Partitioned version
```

## Workflow

### Step 1: Run Baseline Once
```bash
python3 tools/backtest/run_baseline_all.py \
  --from 2025-05-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --store-duckdb \
  --export-baseline-parquet results/baseline_cache_20250501_20251231.parquet
```

**Output**:
- `baseline_cache_20250501_20251231.parquet` (~1-5 MB, depending on alert count)
- Stored in DuckDB (`baseline.alert_results_f`)

### Step 2: Use Cache in Optimization Runs

**Current**: Optimization runs recompute path metrics (slow)

**Future** (needs implementation):
```bash
python3 tools/backtest/run_random_search.py \
  --from 2025-05-01 \
  --to 2025-12-31 \
  --duckdb data/alerts.duckdb \
  --baseline-parquet results/baseline_cache_20250501_20251231.parquet \
  --trials 100 \
  --top-n 30
```

This would:
1. Load cached baseline parquet (~0.1s)
2. Skip path metric computation (~10-30s saved)
3. Only simulate strategies on top of cached metrics

## Performance Impact

### Example: 1000 alerts, 100 optimization trials

**Without cache**:
- Baseline: 100s (one time)
- Each optimization trial: 10s (path metrics)
- Total: 100 + (100 × 10) = **1100s** (~18 minutes)

**With cache**:
- Baseline: 100s (one time, exports parquet)
- Each optimization trial: 0.1s (load parquet)
- Total: 100 + (100 × 0.1) = **110s** (~2 minutes)

**Speedup: 10x faster!** 🚀

## Next Steps

1. ✅ **Baseline parquet export**: Implemented
2. 🔨 **Optimization runs accept baseline parquet**: Needs implementation
3. 🔨 **Auto-detect baseline cache**: Check for existing cache before computing
4. 🔨 **Cache validation**: Verify cache matches date range/parameters

## Current Status

**What works now**:
- ✅ Baseline exports parquet file
- ✅ Slice files are cached and reusable
- ✅ Baseline results stored in DuckDB

**What needs work**:
- 🔨 Optimization runs need to accept `--baseline-parquet` argument
- 🔨 Load cached baseline instead of recomputing path metrics
- 🔨 Validate cache matches current parameters

