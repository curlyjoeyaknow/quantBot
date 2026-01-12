# Dashboard Quick Start 🚀

## 1. Start the Dashboard

```bash
cd /home/memez/backups/quantBot-abstraction-backtest-only
.venv-dashboard/bin/streamlit run tools/backtest/dashboard.py
```

**Opens at**: `http://localhost:8501`

## 2. Auto-Discovery (It Just Works™)

The dashboard **automatically finds** all your simulation results in:
- `output/immediate_entry/`
- `output/dip_-5pct/`
- `output/dip_-10pct/`
- `output/dip_-15pct/`
- `output/dip_-20pct/`
- etc.

**No configuration needed!** Just run your simulations and the dashboard will find them.

## 3. Two Modes

### Mode 1: Single Strategy Analysis

**Use when**: You want deep dive into ONE entry strategy

**Shows**:
- Overall EV metrics
- Per-caller performance
- Per-token analysis
- Exit reason breakdowns
- Time-to-peak distributions
- Cohort analysis (winners/losers)

**How to use**:
1. Click "Single Strategy Analysis" in sidebar
2. Select a directory from dropdown (e.g., "Immediate (0%)" or "-10% dip")
3. Pick stop mode (Static/Trailing/Ladder)
4. Pick stop configuration (e.g., "15% / 50%")
5. Explore the charts and tables!

### Mode 2: Compare Entry Strategies

**Use when**: You want to see which dip percentage is best

**Shows**:
- Side-by-side EV comparison
- Entry success rate comparison
- Caller-level comparison
- Stop strategy comparison across dips
- Visual overlays

**How to use**:
1. Click "Compare Entry Strategies" in sidebar
2. Select 2+ directories to compare (e.g., "Immediate (0%)", "-10% dip", "-20% dip")
3. Pick a stop mode and configuration
4. See which entry strategy wins!

## 4. What You'll See

### Single Strategy View

**Top metrics** (big numbers):
- EV from Entry: +44.3%
- Hit 2x Rate: 67.5%
- Mean Exit Multiple: 3.2x
- Median Exit Multiple: 1.8x

**Per-Caller Table**:
| Caller | Trades | EV% | Hit 2x | Exit Mean | Exit Median |
|--------|--------|-----|--------|-----------|-------------|
| ABC    | 150    | +52 | 72%    | 4.1x      | 2.0x        |
| DEF    | 120    | +38 | 65%    | 3.5x      | 1.7x        |

**Charts**:
- Exit multiple distribution (histogram)
- Time-to-peak (by cohort)
- Exit reasons (pie chart)
- Giveback analysis

### Comparison View

**Overview Table**:
| Dataset | EV% | Hit 2x | Mean Exit | Entry Success | Trades |
|---------|-----|--------|-----------|---------------|--------|
| 0%      | +44 | 68%    | 3.2x      | 100%          | 1,200  |
| -10%    | +51 | 71%    | 3.6x      | 85%           | 1,020  |
| -20%    | +48 | 69%    | 3.4x      | 72%           | 864    |

**Charts**:
- EV comparison (bar chart)
- Trade-off: Entry Success vs EV (scatter)
- Per-caller heatmap

## 5. Filtering

**Available filters** (in sidebar):
- Stop Mode: Static, Trailing, Ladder
- Stop Configuration: Only shows valid combos for your data
- Caller: Filter to specific callers
- Date Range: Filter by entry date

**Tip**: The stop configuration dropdown automatically shows only the combinations that exist in your selected data. If you don't see a config, it wasn't tested in that run.

## 6. Common Issues

### "No files found"
- Make sure you ran the simulator first
- Check that files are in `output/` directory
- Directory names must match pattern (e.g., `immediate_entry`, `dip_-10pct`)

### "0 trades after filters"
- Selected stop config doesn't exist in this data
- Try selecting a different stop config from dropdown
- Or re-run simulator with desired parameters

### "Dashboard won't start"
- Make sure venv is activated: `.venv-dashboard/bin/streamlit ...`
- Install missing deps: `.venv-dashboard/bin/pip install streamlit pandas pyarrow plotly`

## 7. Directory Naming (Auto)

After running simulations with automatic directory naming:

```bash
output/
├── immediate_entry/          ← "Immediate (0%)" in dropdown
├── dip_-5pct/               ← "-5% dip" in dropdown
├── dip_-10pct/              ← "-10% dip" in dropdown
├── dip_-15pct/              ← "-15% dip" in dropdown
└── dip_-20pct/              ← "-20% dip" in dropdown
```

Dashboard automatically labels them correctly! 🎯

## 8. Workflow

### Analysis Workflow

1. **Run immediate entry baseline**:
```bash
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry 0 \
    --threads 12 \
    --output-dir output
```

2. **View in dashboard** (Single Strategy mode):
   - Check which stop configs work best
   - Note the best EV%

3. **Test dip entries**:
```bash
for DIP in -5 -10 -15 -20; do
    python3 tools/backtest/phased_stop_simulator.py \
        --duckdb data/alerts.duckdb \
        --slice slices/per_token \
        --chain solana \
        --date-from 2025-05-01 \
        --date-to 2025-07-31 \
        --delayed-entry ${DIP} \
        --threads 12 \
        --output-dir output
done
```

4. **Compare in dashboard** (Comparison mode):
   - Select all datasets
   - Pick the best stop config from step 2
   - See which dip percentage wins!

### Decision Framework

**Question**: Should I wait for a dip?

**Dashboard tells you**:
- **If dip EV% >> immediate EV%**: Yes, wait for dip
- **If dip entry success < 70%**: Dip is too rare, stick with immediate
- **If dip trades << immediate trades**: Not enough data, need longer test period

**Example decision**:
```
Immediate:  +44% EV, 100% entry, 1,200 trades
-10% dip:   +51% EV,  85% entry, 1,020 trades  ← WINNER
-20% dip:   +48% EV,  72% entry,   864 trades  ← Too rare
```

**Conclusion**: Wait for -10% dip (7% better EV, 85% entry rate is acceptable)

## 9. Tips

✅ **Start with single strategy** to understand the data  
✅ **Use comparison mode** to make decisions  
✅ **Filter by caller** to see per-caller differences  
✅ **Check entry success rate** when comparing dips  
✅ **Look at trade counts** - need enough data for confidence  
✅ **Export tables** by clicking download button  

## 10. Next Steps

After finding your optimal strategy in the dashboard:

1. **Document it**: Note the winning config
2. **Test longer period**: Run with more historical data
3. **Per-caller optimization**: Some callers might prefer different configs
4. **Forward test**: Try on recent unseen data

---

**Got questions?** Check:
- `DELAYED_ENTRY_USAGE.md` - Full simulator guide
- `COMPARISON_QUICKSTART.md` - Comparison mode details
- `AUTO_DIRECTORY_NAMING.md` - Directory structure

