# Dashboard Comparison Mode

## Overview

The dashboard now has **two modes**:

1. **Single Strategy Analysis** - Analyze one dataset in detail (original mode)
2. **Compare Entry Strategies** - Compare multiple entry strategies side-by-side (NEW!)

## Accessing Comparison Mode

```bash
cd /home/memez/backups/quantBot-abstraction-backtest-only
.venv-dashboard/bin/streamlit run tools/backtest/dashboard.py
```

Then select **"Compare Entry Strategies"** from the sidebar radio button.

## Features

### 📊 Side-by-Side Comparison

- **Select multiple datasets** from dropdown (e.g., immediate, -5% dip, -10% dip, -15% dip)
- **Filter by stop strategy** (static, trailing, ladder)
- **Filter by stop configuration** (e.g., 15%/50%)
- **View all metrics** in one table

### 📈 Visual Comparisons

1. **EV from Entry Chart**
   - Bar chart showing EV for each entry strategy
   - Best strategy highlighted in green
   - Others in blue

2. **Trade Count vs EV Scatter**
   - Shows trade-off between entry rate and EV
   - Identifies strategies that miss too many opportunities

3. **Winner Capture Rate**
   - Bar chart showing % of trades that hit ≥3x
   - Identifies strategies that miss winners

4. **Cohort Breakdown (Stacked Bar)**
   - Winners (≥3x) - Green
   - Losers (2x, no 3x) - Orange
   - Never 2x - Red
   - Shows distribution across entry strategies

### 💡 Key Insights

Automatically calculates:
- **Best entry strategy** by EV
- **Delta vs immediate entry** for each strategy
- **Trade count changes** (how many opportunities missed)
- **EV improvement** or degradation

## Example Workflow

### Step 1: Run Multiple Entry Strategies

```bash
# Immediate entry
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry 0 \
    --threads 12 \
    --output-dir output/immediate

# -10% dip
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry -10 \
    --threads 12 \
    --output-dir output/dip_10pct

# -20% dip
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry -20 \
    --threads 12 \
    --output-dir output/dip_20pct
```

### Step 2: Launch Dashboard

```bash
.venv-dashboard/bin/streamlit run tools/backtest/dashboard.py
```

### Step 3: Select Comparison Mode

1. In sidebar, click **"Compare Entry Strategies"**
2. Select datasets to compare (e.g., Immediate, -10% dip, -20% dip)
3. Select stop mode (e.g., trailing)
4. Select stop configuration (e.g., 15% / 50%)

### Step 4: Analyze Results

**Look for:**
- ✅ **Highest EV** - Which entry strategy maximizes returns?
- ✅ **Trade count** - How many opportunities are missed?
- ✅ **Winner capture** - Are we missing 3x+ winners?
- ✅ **Trade-off** - Is better entry worth fewer trades?

## Interpretation Guide

### Scenario 1: Delayed Entry Improves EV

```
Immediate (0%):   +44.3% EV, 1,500 trades
-10% dip:         +52.1% EV, 1,200 trades (-20%)
-20% dip:         +65.4% EV, 800 trades (-47%)
```

**Interpretation**:
- Delayed entry improves EV
- But misses opportunities (fewer trades)
- **-10% dip** might be optimal (good EV, reasonable trade count)
- **-20% dip** has best EV but misses too many trades

### Scenario 2: Delayed Entry Hurts EV

```
Immediate (0%):   +44.3% EV, 1,500 trades
-10% dip:         +38.2% EV, 1,200 trades (-20%)
-20% dip:         +25.1% EV, 800 trades (-47%)
```

**Interpretation**:
- Delayed entry reduces EV
- Winners pump without dipping
- **Immediate entry is optimal**
- Don't wait for dips

### Scenario 3: Small Dips Help, Large Dips Hurt

```
Immediate (0%):   +44.3% EV, 1,500 trades
-5% dip:          +48.7% EV, 1,400 trades (-7%)
-10% dip:         +52.1% EV, 1,200 trades (-20%)
-15% dip:         +49.3% EV, 900 trades (-40%)
-20% dip:         +38.5% EV, 600 trades (-60%)
```

**Interpretation**:
- Small dips (-5% to -10%) improve EV
- Large dips (-15%+) miss too many opportunities
- **-10% dip is optimal** (best EV, acceptable trade count)

## Metrics Explained

### EV from Entry
Expected value per trade from entry price.
- **Higher is better**
- Accounts for all trades (winners, losers, never 2x)

### EV given 2x
Expected value for trades that hit 2x.
- Shows quality of trades that survive to 2x
- Useful for understanding post-2x performance

### P(reach 2x)
Probability of hitting 2x from entry.
- **Higher is better**
- Shows how often trades survive to first milestone

### P(reach 3x)
Probability of hitting 3x from entry.
- **Higher is better**
- Shows winner rate

### Total Trades
Number of trades executed.
- **Lower for delayed entry** (missed opportunities)
- Trade-off: better entry vs fewer trades

### Winners (≥3x)
Count and percentage of trades that hit 3x.
- **Higher is better**
- Shows winner capture rate

## Best Practices

### 1. Compare Apples to Apples

Always compare the **same stop strategy** across entry strategies.

❌ **Bad**: Compare trailing 15%/50% immediate vs static 20%/20% -10% dip  
✅ **Good**: Compare trailing 15%/50% immediate vs trailing 15%/50% -10% dip

### 2. Consider Trade-Offs

Don't just optimize for EV. Consider:
- **Trade frequency** - How often can you enter?
- **Winner capture** - Are you missing 3x+ winners?
- **Opportunity cost** - Is waiting worth it?

### 3. Test Multiple Stop Strategies

The optimal entry strategy might vary by stop strategy:
- **Static stops**: Might benefit more from delayed entry
- **Trailing stops**: Might work better with immediate entry

### 4. Per-Caller Analysis

Different callers might have different optimal entry strategies:
- **High-quality callers**: Immediate entry (don't miss winners)
- **Volatile callers**: Delayed entry (wait for dip)

Use the single strategy mode to analyze per-caller.

## Advanced Usage

### Export Comparison Data

The comparison table can be copied to clipboard:
1. Click on table
2. Use browser's copy function
3. Paste into Excel/Google Sheets

### Custom Analysis

For more complex analysis, use DuckDB directly:

```sql
-- Compare all entry strategies for trailing 15%/50%
SELECT 
    CASE 
        WHEN filename LIKE '%immediate%' THEN 'Immediate'
        WHEN filename LIKE '%dip_-10%' THEN '-10% dip'
        WHEN filename LIKE '%dip_-20%' THEN '-20% dip'
        ELSE 'Other'
    END as entry_strategy,
    COUNT(*) as trades,
    (AVG(exit_mult) - 1.0) * 100 as ev_pct,
    SUM(CASE WHEN hit_3x THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as winner_pct
FROM read_parquet('output/*/phased_stop_results_*.parquet', filename=true)
WHERE stop_mode = 'trailing' 
  AND phase1_stop_pct = 0.15 
  AND phase2_stop_pct = 0.50
GROUP BY entry_strategy
ORDER BY ev_pct DESC;
```

## Troubleshooting

### "No parquet files found"

**Solution**: Ensure output directories exist and contain parquet files:
```bash
ls output/*/phased_stop_results_*.parquet
```

### "Please select at least 2 datasets"

**Solution**: Select 2 or more datasets from the multiselect dropdown.

### "No data found for selected strategy"

**Solution**: The selected stop strategy doesn't exist in all datasets. Try a different stop configuration.

### Datasets not appearing in dropdown

**Solution**: Check directory naming. Dashboard looks for:
- `output/immediate/` → "Immediate (0%)"
- `output/dip_-10pct/` → "-10% dip"
- `output/dip_-20pct/` → "-20% dip"

Rename directories if needed.

## Summary

The comparison mode makes it easy to:
- ✅ **Compare multiple entry strategies** side-by-side
- ✅ **Visualize trade-offs** (EV vs trade count)
- ✅ **Identify optimal strategy** automatically
- ✅ **Understand deltas** vs immediate entry
- ✅ **Export results** for reporting

This answers: **"Should we wait for a dip, and if so, how much?"** 🎯

