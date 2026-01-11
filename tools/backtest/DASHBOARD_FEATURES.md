# Dashboard Features Guide

## 🎯 Auto-Discovery File Selector

The dashboard automatically scans your workspace for parquet files and presents them in an easy-to-use dropdown.

### How It Works

1. **Launch Dashboard** (no arguments needed):
   ```bash
   .venv-dashboard/bin/streamlit run tools/backtest/dashboard.py
   ```

2. **Sidebar Shows Available Data**:
   ```
   📁 Data Source
   ┌─────────────────────────────────────────┐
   │ Select data source:                     │
   │ ▼ output/2025_v2 (1 file)              │
   ├─────────────────────────────────────────┤
   │   output/2025_v2 (1 file)              │
   │   output/demo_ev (1 file)              │
   │   output/outer_new (1 file)            │
   │   Custom pattern...                     │
   └─────────────────────────────────────────┘
   
   Pattern: `output/2025_v2/phased_stop_results_*.parquet`
   ```

3. **Select Different Dataset**: Just choose from dropdown - instant switch!

4. **Custom Pattern**: Select "Custom pattern..." to enter a specific path

### Supported Directories

The dashboard automatically searches:
- `output/*/phased_stop_results_*.parquet`
- `output/*/*/phased_stop_results_*.parquet`
- `results/*/phased_stop_results_*.parquet`

### Benefits

✅ **No manual path entry** - just select from dropdown
✅ **See file counts** - know how many files in each directory
✅ **Quick switching** - compare different runs instantly
✅ **Fallback to custom** - still supports manual patterns if needed

## 📊 Interactive Filtering

Once data is loaded, filter in real-time:

### Stop Strategy Filters
```
🎛️ Filters
┌─────────────────────────────────────────┐
│ Stop Mode:        ▼ trailing           │
│ Phase 1 Stop %:   ▼ 20%                │
│ Phase 2 Stop %:   ▼ 20%                │
│ Caller:           ▼ All                 │
└─────────────────────────────────────────┘

📊 1,540 trades after filters
```

### What Each Filter Does

- **Stop Mode**: 
  - `static` - Stop anchored at milestone (2x, 3x, etc.)
  - `trailing` - Stop moves with every new peak
  - `ladder` - Stop moves in discrete steps (e.g., 2.0x, 2.5x, 3.0x)

- **Phase 1 Stop %**: Stop percentage for 1x→2x phase
  - Lower % = tighter stop, fewer false starts
  - Higher % = more tolerance, capture more runners

- **Phase 2 Stop %**: Stop percentage for 2x+ phase
  - Lower % = lock in gains quickly
  - Higher % = let winners run longer

- **Caller**: Filter to specific caller or view all

## 📈 Chart Types

### 1. Exit Multiple Distribution
**Shows**: How exit multiples are distributed across cohorts

**Use Case**: Understand typical outcomes for winners vs losers

**Insights**:
- Winners: Look for mean/median exit multiple
- Losers: See where they typically exit (1.5x? 1.8x?)
- Never 2x: Understand Phase 1 stop effectiveness

### 2. Peak vs Exit Scatter
**Shows**: Relationship between peak achieved and exit price

**Use Case**: Visualize giveback patterns

**Insights**:
- Points on diagonal = no giveback (exited at peak)
- Points below diagonal = gave back profit
- Cluster analysis: Do winners give back more or less?

### 3. Giveback Distribution
**Shows**: Percentage given back from peak (winners only)

**Use Case**: Optimize trailing stop tightness

**Insights**:
- P50 giveback: Typical profit given back
- P90 giveback: Worst-case scenarios
- Histogram shape: Bimodal? Skewed?

### 4. Exit Reasons
**Shows**: Why trades exited (pie chart)

**Use Case**: Understand stop effectiveness

**Insights**:
- `stopped_phase1`: Stopped before 2x (Phase 1 stop)
- `stopped_phase2`: Stopped after 2x (Phase 2 stop)
- `end_of_data`: Still in trade when data ended

## 🔄 Strategy Comparison Mode

Compare all 46 strategies side-by-side:

```
☑️ Show strategy comparison

┌───────────────┬──────────┬──────────┬──────┬──────────┬────────────┐
│ Stop Mode     │ Phase1   │ Phase2   │ EV   │ P(2x)    │ Winners    │
├───────────────┼──────────┼──────────┼──────┼──────────┼────────────┤
│ trailing      │ 20%      │ 30%      │ 45%  │ 65%      │ 234        │
│ ladder        │ 15%      │ 25%      │ 42%  │ 68%      │ 256        │
│ static        │ 25%      │ 35%      │ 38%  │ 62%      │ 198        │
└───────────────┴──────────┴──────────┴──────┴──────────┴────────────┘

[Bar Chart: EV by Strategy]
```

**Sorted by**: EV from Entry (highest to lowest)

**Use Case**: Find optimal stop parameters for your risk tolerance

## 🏆 Top Trades Table

Configurable table showing best performers:

```
Number of trades to show: [────●────────] 20

┌──────────────┬─────────┬───────┬───────┬───────┬─────────┬──────────┐
│ Caller       │ Mint    │ Entry │ Peak  │ Exit  │ Giveback│ Exit     │
├──────────────┼─────────┼───────┼───────┼───────┼─────────┼──────────┤
│ Whale 🐳 x   │ Hr9C... │ 1.00x │ 12.4x │ 9.9x  │ 20.2%   │ stopped  │
│ Gidion       │ 8xKP... │ 1.00x │ 8.7x  │ 7.0x  │ 19.5%   │ stopped  │
└──────────────┴─────────┴───────┴───────┴───────┴─────────┴──────────┘
```

**Features**:
- Slider: 10-100 trades
- Sorted by exit multiple (highest first)
- Shows all milestones hit (2x, 3x, 4x, 5x, 10x)
- Hover for full mint address

## 💡 Pro Tips

### Finding Optimal Strategy

1. **Start with Strategy Comparison**:
   - Enable comparison mode
   - Sort by "EV from Entry"
   - Note top 3-5 strategies

2. **Analyze Top Strategy**:
   - Filter to that specific strategy
   - Check cohort breakdown
   - Review giveback distribution

3. **Validate Across Callers**:
   - Filter to specific caller
   - Repeat comparison
   - Look for consistency

### Understanding Giveback

**Low Giveback (0-10%)**:
- Tight trailing stop
- Locks in gains quickly
- May miss extended runs

**Medium Giveback (10-25%)**:
- Balanced approach
- Captures most of move
- Some profit given back

**High Giveback (25%+)**:
- Loose trailing stop
- Lets winners run
- Risk of larger drawdowns

### Interpreting Exit Reasons

**Mostly `stopped_phase1`**:
- Phase 1 stop too tight
- Consider increasing Phase 1 %
- Or check if caller is low quality

**Mostly `stopped_phase2`**:
- Phase 2 stop working as intended
- Check giveback distribution
- Optimize Phase 2 % if needed

**Mostly `end_of_data`**:
- Trades still active
- Need more recent data
- Or extend date range

## 🎨 Customization Ideas

### Add Your Own Charts

The dashboard code is modular. Easy to add:
- Heatmaps (Phase1 % vs Phase2 % vs EV)
- Time series (EV over time)
- Caller comparison (side-by-side)
- Risk metrics (Sharpe, Sortino)

### Export Data

From any view:
1. Browser → Print → Save as PDF
2. Or screenshot specific charts
3. Or query parquet directly for raw data

### Share Results

1. Run dashboard on server
2. Share Network URL (e.g., `http://192.168.0.108:8501`)
3. Team can view same data simultaneously

---

**Questions?** Check `README_DASHBOARD.md` for full documentation.

