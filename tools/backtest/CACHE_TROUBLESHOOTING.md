# Cache Troubleshooting Guide

This guide helps diagnose and resolve common cache-related issues in the backtest system.

## Common Issues

### Cache Not Found

**Symptoms:**
- Warning: "Baseline cache not found"
- Cache auto-detection returns None

**Solutions:**
1. Check cache directory exists: `ls -la results/`
2. Verify cache file naming matches pattern: `baseline_cache_YYYYMMDD_YYYYMMDD*.parquet`
3. Run baseline backtest with `--export-baseline-parquet` to create cache
4. Check date range matches: cache files are named by date range

**Example:**
```bash
# Create cache for date range
python3 run_baseline_all.py \
  --from 2025-01-01 --to 2025-01-02 \
  --export-baseline-parquet results/baseline_cache_20250101_20250102.parquet

# Use cache
python3 run_random_search.py \
  --from 2025-01-01 --to 2025-01-02 \
  --baseline-parquet results/baseline_cache_20250101_20250102.parquet
```

### Cache Validation Failed

**Symptoms:**
- Warning: "Baseline cache validation failed"
- Error message about date range or parameter mismatch

**Solutions:**
1. Check date range matches exactly (cache might have alerts slightly outside range)
2. Verify interval_seconds and horizon_hours match
3. Use `--force-recompute` to bypass validation (not recommended)
4. Recreate cache with correct parameters

**Example:**
```bash
# Check cache metadata
python3 -c "
from pathlib import Path
from lib.cache_utils import read_cache_metadata
metadata = read_cache_metadata(Path('results/baseline_cache_20250101_20250102.parquet'))
print(metadata)
"
```

### Stale Cache

**Symptoms:**
- Cache is older than max_age_days (default: 7 days)
- Auto-invalidation marks cache as stale

**Solutions:**
1. Recreate cache: run baseline backtest again
2. Adjust max_age_days in validation call
3. Check cache file modification time: `stat results/baseline_cache_*.parquet`

**Example:**
```bash
# Force cache recreation
python3 run_baseline_all.py \
  --from 2025-01-01 --to 2025-01-02 \
  --export-baseline-parquet results/baseline_cache_20250101_20250102.parquet \
  --force-recompute
```

### Per-Alert Cache Missing Files

**Symptoms:**
- Strategy run falls back to slice loading
- Warning: "Per-alert cache directory not found"

**Solutions:**
1. Verify cache directory exists: `ls -la results/per_alert/`
2. Check files match pattern: `alert_*.parquet`
3. Recreate per-alert cache with `--export-per-alert-parquet`

**Example:**
```bash
# Create per-alert cache
python3 run_baseline_all.py \
  --from 2025-01-01 --to 2025-01-02 \
  --export-per-alert-parquet results/per_alert

# Use cache in strategy run
python3 run_strategy.py \
  --from 2025-01-01 --to 2025-01-02 \
  --per-alert-cache-dir results/per_alert \
  --tp 2.0 --sl 0.5
```

### Cache Performance Issues

**Symptoms:**
- Cache load time is slow (>5s)
- No speedup observed

**Solutions:**
1. Check file size: large caches load slower
2. Verify pandas is installed: `pip install pandas pyarrow`
3. Use compression: ensure parquet files are compressed
4. Benchmark cache performance: `python3 benchmark_cache_performance.py`

**Example:**
```bash
# Benchmark cache performance
python3 benchmark_cache_performance.py \
  --from 2025-01-01 --to 2025-01-02 \
  --baseline-cache results/baseline_cache_20250101_20250102.parquet \
  --per-alert-cache results/per_alert \
  --verbose
```

### Cache Metadata Missing

**Symptoms:**
- No `.metadata.json` file alongside cache
- Version/timestamp info unavailable

**Solutions:**
1. Metadata is optional - cache still works without it
2. Recreate cache to generate metadata
3. Manually create metadata using `create_cache_metadata()` function

**Example:**
```python
from pathlib import Path
from datetime import datetime
from lib.cache_utils import create_cache_metadata, write_cache_metadata

cache_path = Path("results/baseline_cache_20250101_20250102.parquet")
metadata = create_cache_metadata(
    date_from=datetime(2025, 1, 1),
    date_to=datetime(2025, 1, 2),
    interval_seconds=60,
    horizon_hours=48,
    version="1.0"
)
write_cache_metadata(cache_path, metadata)
```

## Debugging Tips

### Enable Verbose Output

```bash
python3 run_random_search.py \
  --from 2025-01-01 --to 2025-01-02 \
  --baseline-parquet results/baseline_cache_20250101_20250102.parquet \
  --verbose
```

### Check Cache Contents

```bash
# Load and inspect cache
python3 -c "
import pandas as pd
df = pd.read_parquet('results/baseline_cache_20250101_20250102.parquet')
print(f'Rows: {len(df)}')
print(f'Columns: {list(df.columns)}')
print(df.head())
"
```

### Validate Cache Manually

```python
from pathlib import Path
from datetime import datetime
from lib.cache_utils import validate_baseline_cache

cache_path = Path("results/baseline_cache_20250101_20250102.parquet")
is_valid, error = validate_baseline_cache(
    cache_path,
    date_from=datetime(2025, 1, 1),
    date_to=datetime(2025, 1, 2),
    interval_seconds=60,
    horizon_hours=48,
)

print(f"Valid: {is_valid}")
if error:
    print(f"Error: {error}")
```

## Best Practices

1. **Always specify date range explicitly** when using cache
2. **Use consistent parameters** (interval_seconds, horizon_hours) across runs
3. **Monitor cache file sizes** - large caches (>100MB) may be slow to load
4. **Recreate cache periodically** - stale caches can cause issues
5. **Use cache metadata** - helps with debugging and validation

## Performance Expectations

- **Baseline cache load**: <1s for typical datasets (<10k alerts)
- **Per-alert cache load**: <5s for typical datasets
- **Speedup with baseline cache**: 10-100x (skips path metric computation)
- **Speedup with per-alert cache**: 5-10x (skips candle reloading)

## Getting Help

If issues persist:
1. Check logs for detailed error messages
2. Verify all dependencies are installed: `pip install pandas pyarrow`
3. Test with a small date range first
4. Review cache file permissions and disk space

