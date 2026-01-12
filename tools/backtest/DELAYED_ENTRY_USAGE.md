# Delayed Entry - Usage Guide

## Overview

The `phased_stop_simulator.py` now supports **delayed entry** strategies, allowing you to test what happens if you wait for a dip after the alert before entering.

## New Parameters

### `--delayed-entry <percent>`

Wait for price to drop X% below alert before entering.

- **`0`** (default): Immediate entry at alert price
- **`-5`**: Wait for 5% dip
- **`-10`**: Wait for 10% dip
- **`-15`**: Wait for 15% dip
- **`-20`**: Wait for 20% dip
- **`-25`**: Wait for 25% dip
- **`-30`**: Wait for 30% dip
- **`-40`**: Wait for 40% dip
- **`-50`**: Wait for 50% dip

### `--entry-max-wait <hours>`

Maximum hours to wait for the dip (optional).

- If not specified: Wait until end of observation window (48 hours)
- If specified: Cancel entry if dip doesn't occur within X hours

### `--stop-from <alert|entry>`

Calculate stops from alert price or actual entry price.

- **`alert`** (default, recommended): Stops calculated from original alert price
  - Consistent risk management
  - Fair comparison across entry strategies
  - Stops don't change based on entry timing

- **`entry`**: Stops calculated from actual entry price
  - Stops always below entry
  - More intuitive risk management
  - Different risk profiles for each entry strategy

## Usage Examples

**Note**: The simulator automatically tests **all stop strategies** (static, trailing, phased combinations). You don't specify individual strategies - it tests them all and outputs results for each.

**Note**: The simulator automatically creates subdirectories based on `--delayed-entry`:
- `--delayed-entry 0` → `output/immediate_entry/`
- `--delayed-entry -10` → `output/dip_-10pct/`
- `--delayed-entry -20` → `output/dip_-20pct/`

### Example 1: Immediate Entry (Baseline)

Tests all stop strategies with immediate entry:

```bash
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry 0 \
    --stop-from alert \
    --threads 12 \
    --output-dir output
# Creates: output/immediate_entry/
```

### Example 2: Wait for -10% Dip

Tests all stop strategies with -10% delayed entry:

```bash
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry -10 \
    --stop-from alert \
    --threads 12 \
    --output-dir output
# Creates: output/dip_-10pct/
```

### Example 3: Wait for -20% Dip (Max 1 Hour)

Tests all stop strategies with -20% delayed entry, max 1 hour wait:

```bash
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry -20 \
    --entry-max-wait 1.0 \
    --stop-from alert \
    --threads 12 \
    --output-dir output
# Creates: output/dip_-20pct/
```

### Example 4: Stops from Entry Price

Tests all stop strategies with -15% delayed entry, stops from entry price:

```bash
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry -15 \
    --stop-from entry \
    --threads 12 \
    --output-dir output
# Creates: output/dip_-15pct/
```

**Strategies Tested Automatically:**
- Static: 10%, 15%, 20%, 25%, 30%, 35%, 40%, 50%, 60%
- Trailing: 10%, 15%, 20%, 25%, 30%, 35%, 40%, 50%, 60%
- Phased combinations (e.g., 15% phase1, 50% phase2)

## Batch Testing Multiple Dip Percentages

Create a script to test all dip percentages:

```bash
#!/bin/bash

for DIP in 0 -5 -10 -15 -20 -25 -30 -40 -50; do
    echo "Testing ${DIP}% dip..."
    python3 tools/backtest/phased_stop_simulator.py \
        --duckdb data/alerts.duckdb \
        --slice slices/per_token \
        --chain solana \
        --date-from 2025-05-01 \
        --date-to 2025-07-31 \
        --delayed-entry ${DIP} \
        --stop-from alert \
        --threads 12 \
        --output-dir output \
        --csv-output results/dip_${DIP}pct.csv
done

# Note: Each run tests ALL stop strategies automatically
# Directories are auto-created: output/immediate_entry/, output/dip_-10pct/, etc.
```

## Analyzing Results

### Key Metrics to Compare

1. **Total Trades**: How many trades entered?
   - Lower for larger dips (missed opportunities)

2. **EV from Entry**: Expected value per trade
   - Higher for delayed entry if dips improve entry price

3. **EV given 2x**: Expected value for trades that hit 2x
   - Shows quality of trades that entered

4. **P(reach 2x)**: Probability of hitting 2x
   - May be higher for delayed entry (better entry price)

5. **Winners (≥3x)**: Count and percentage
   - Lower for larger dips (missed winners that pumped without dipping)

### Dashboard Analysis

Load results into the dashboard:

```bash
cd /home/memez/backups/quantBot-abstraction-backtest-only
.venv-dashboard/bin/streamlit run tools/backtest/dashboard.py
```

Then compare:
- Immediate entry (0%) vs delayed entry (-10%, -20%, etc.)
- Alert-based stops vs entry-based stops
- Different stop modes (static, trailing, ladder)

### DuckDB Analysis

Query parquet files directly:

```sql
-- Compare immediate vs -10% dip for trailing 15%/50% strategy
SELECT 
    'Immediate' as entry_strategy,
    COUNT(*) as total_trades,
    AVG(exit_mult) as avg_exit_mult,
    (AVG(exit_mult) - 1.0) * 100 as ev_pct,
    SUM(CASE WHEN hit_3x THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as winners_pct
FROM 'output/immediate_entry/phased_stop_results_*.parquet'
WHERE stop_mode = 'trailing' 
  AND phase1_stop_pct = 0.15 
  AND phase2_stop_pct = 0.50

UNION ALL

SELECT 
    '-10% dip' as entry_strategy,
    COUNT(*) as total_trades,
    AVG(exit_mult) as avg_exit_mult,
    (AVG(exit_mult) - 1.0) * 100 as ev_pct,
    SUM(CASE WHEN hit_3x THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as winners_pct
FROM 'output/dip_10pct/phased_stop_results_*.parquet'
WHERE stop_mode = 'trailing' 
  AND phase1_stop_pct = 0.15 
  AND phase2_stop_pct = 0.50;

-- Or compare across ALL strategies
SELECT 
    'Immediate' as entry_strategy,
    stop_mode,
    phase1_stop_pct,
    phase2_stop_pct,
    COUNT(*) as total_trades,
    (AVG(exit_mult) - 1.0) * 100 as ev_pct
FROM 'output/immediate_entry/phased_stop_results_*.parquet'
GROUP BY stop_mode, phase1_stop_pct, phase2_stop_pct
ORDER BY ev_pct DESC
LIMIT 10;
```

## Expected Results

### Hypothesis 1: Small Dips Improve EV

**Prediction**: -5% to -15% dips will:
- Occur frequently (70-90% of time)
- Provide better entry price
- Higher EV than immediate entry

**Why**: Solana memecoins often have initial volatility after alert.

### Hypothesis 2: Large Dips Miss Opportunities

**Prediction**: -30% to -50% dips will:
- Occur rarely (10-30% of time)
- Miss most winners (they pump without dipping)
- Lower opportunity-adjusted EV

**Why**: Winners pump fast, don't give deep entry opportunities.

### Hypothesis 3: Optimal Dip is -10% to -20%

**Prediction**: Sweet spot where:
- Dip occurs often enough (50-70%)
- Entry price is significantly better
- Doesn't miss too many winners

## Stop Calculation: Alert vs Entry

### Alert-Based Stops (Recommended)

**Example**:
- Alert: $1.00
- Wait for -20% dip: Enter at $0.80
- Phase 1 stop (15%): $0.85 (15% below $1.00)
- Phase 2 stop (50%): $1.00 (50% below $2.00)

**Pros**:
- Consistent risk management
- Fair comparison across all entry strategies
- Stops don't change based on entry timing

**Cons**:
- Stop might be above entry price initially
- Could stop out immediately if entered near stop

### Entry-Based Stops

**Example**:
- Alert: $1.00
- Wait for -20% dip: Enter at $0.80
- Phase 1 stop (15%): $0.68 (15% below $0.80)
- Phase 2 stop (50%): $0.80 (50% below $1.60)

**Pros**:
- Stops always below entry
- More intuitive risk management

**Cons**:
- Different risk profiles for each entry strategy
- Not apples-to-apples comparison
- Deeper dips = lower absolute stops

## Integration with Existing Features

### Caching

Delayed entry works with `--use-cache`:

```bash
# First run: immediate entry
python3 tools/backtest/phased_stop_simulator.py ... --delayed-entry 0

# Second run: -10% dip (reuses cached data where possible)
python3 tools/backtest/phased_stop_simulator.py ... --delayed-entry -10 --use-cache
```

### Resume

If interrupted, resume with `--resume`:

```bash
python3 tools/backtest/phased_stop_simulator.py ... --delayed-entry -15 --resume
```

### CSV Export

Export summary to CSV:

```bash
python3 tools/backtest/phased_stop_simulator.py ... --delayed-entry -10 --csv-output results/dip_10pct.csv
```

## Next Steps

1. **Run baseline** (immediate entry, 0%)
2. **Test small dips** (-5%, -10%, -15%)
3. **Test medium dips** (-20%, -25%, -30%)
4. **Test large dips** (-40%, -50%)
5. **Compare results** in dashboard
6. **Find optimal dip %** per caller
7. **Test with different stop modes** (static, trailing, ladder)
8. **Test alert vs entry stops**

## Questions Answered

✅ **Should we wait for a dip?**
- Compare EV: immediate vs delayed entry

✅ **If so, how much?**
- Find optimal dip % that maximizes opportunity-adjusted EV

✅ **How often do dips occur?**
- Track entry rate for each dip %

✅ **Do we miss winners?**
- Compare winner capture rate across dip %

✅ **Which stop calculation is better?**
- Compare alert-based vs entry-based stops

✅ **Does this vary by caller?**
- Per-caller optimization in results

This feature definitively answers: **"Should we wait for a dip, and if so, how much?"** 🎯

