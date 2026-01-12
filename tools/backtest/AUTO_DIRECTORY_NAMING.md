# Automatic Directory Naming

## Problem Solved

❌ **Before**: Had to manually specify full output paths  
❌ **Error-prone**: Forgot to change directory names  
❌ **Lost details**: Couldn't remember which run was which  

✅ **Now**: Directories auto-created based on `--delayed-entry`  
✅ **Consistent**: Same naming convention every time  
✅ **Clear**: Directory name tells you exactly what it contains  

## How It Works

The simulator automatically appends a subdirectory to `--output-dir` based on your `--delayed-entry` value:

| Command | Creates Directory |
|---------|-------------------|
| `--delayed-entry 0` | `output/immediate_entry/` |
| `--delayed-entry -5` | `output/dip_-5pct/` |
| `--delayed-entry -10` | `output/dip_-10pct/` |
| `--delayed-entry -15` | `output/dip_-15pct/` |
| `--delayed-entry -20` | `output/dip_-20pct/` |
| `--delayed-entry -25` | `output/dip_-25pct/` |
| `--delayed-entry -30` | `output/dip_-30pct/` |
| `--delayed-entry -40` | `output/dip_-40pct/` |
| `--delayed-entry -50` | `output/dip_-50pct/` |

## Usage

### Before (Manual)

```bash
# Had to specify full path manually
python3 tools/backtest/phased_stop_simulator.py \
    --delayed-entry -10 \
    --output-dir output/dip_10pct  # ❌ Manual, error-prone
```

### After (Automatic)

```bash
# Just specify base directory
python3 tools/backtest/phased_stop_simulator.py \
    --delayed-entry -10 \
    --output-dir output  # ✅ Auto-creates output/dip_-10pct/
```

## Batch Testing

Now super simple:

```bash
#!/bin/bash

# Test all dip percentages with ONE command template
for DIP in 0 -5 -10 -15 -20 -25 -30 -40 -50; do
    python3 tools/backtest/phased_stop_simulator.py \
        --duckdb data/alerts.duckdb \
        --slice slices/per_token \
        --chain solana \
        --date-from 2025-05-01 \
        --date-to 2025-07-31 \
        --delayed-entry ${DIP} \
        --threads 12 \
        --output-dir output  # Same for all!
done

# Results:
# output/immediate_entry/
# output/dip_-5pct/
# output/dip_-10pct/
# output/dip_-15pct/
# output/dip_-20pct/
# output/dip_-25pct/
# output/dip_-30pct/
# output/dip_-40pct/
# output/dip_-50pct/
```

## Dashboard Integration

The dashboard automatically discovers and labels these directories:

**Dropdown shows:**
- `Immediate (0%)`
- `-5% dip`
- `-10% dip`
- `-15% dip`
- `-20% dip`
- etc.

No configuration needed!

## Directory Structure

```
output/
├── immediate_entry/
│   └── phased_stop_results_abc123.parquet
├── dip_-5pct/
│   └── phased_stop_results_def456.parquet
├── dip_-10pct/
│   └── phased_stop_results_ghi789.parquet
├── dip_-15pct/
│   └── phased_stop_results_jkl012.parquet
└── dip_-20pct/
    └── phased_stop_results_mno345.parquet
```

## Benefits

✅ **No more forgetting** to change directory names  
✅ **Clear organization** - one directory per entry strategy  
✅ **Dashboard auto-discovery** - works seamlessly  
✅ **Consistent naming** - same convention every time  
✅ **Easy comparison** - all results in one place  
✅ **Batch-friendly** - same command for all dips  

## Custom Base Directory

You can still customize the base directory:

```bash
# Use custom base directory
python3 tools/backtest/phased_stop_simulator.py \
    --delayed-entry -10 \
    --output-dir results/2025_q2  # Creates results/2025_q2/dip_-10pct/
```

## Caching Still Works

The automatic naming doesn't affect caching:

```bash
# First run
python3 tools/backtest/phased_stop_simulator.py \
    --delayed-entry -10 \
    --output-dir output

# Later run with cache (same directory)
python3 tools/backtest/phased_stop_simulator.py \
    --delayed-entry -10 \
    --output-dir output \
    --use-cache  # ✅ Finds cached data in output/dip_-10pct/
```

## Summary

**One simple rule**: Just use `--output-dir output` for everything.

The simulator handles the rest! 🎯

