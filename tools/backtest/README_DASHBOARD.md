# QuantBot EV Dashboard 📊

Interactive web-based dashboard for analyzing phased stop simulator results.

## Features

### 🎯 Real-Time Filtering
- **Stop Mode**: static, trailing, ladder
- **Phase 1 Stop %**: Filter by entry→2x stop percentage
- **Phase 2 Stop %**: Filter by 2x+ stop percentage
- **Caller**: Filter by specific caller or view all

### 📈 Key Metrics
- **EV from Entry**: Expected value from initial entry
- **EV given 2x**: Expected value conditional on reaching 2x
- **P(reach 2x)**: Probability of reaching 2x
- **P(3x | 2x)**: Conditional probability of 3x given 2x

### 🏆 Cohort Analysis
- **Winners (≥3x)**: Trades that reached 3x or higher
  - Exit multiple distributions (mean, median, percentiles)
  - Giveback from peak analysis
  - Exit reasons breakdown
  
- **Losers (2x, no 3x)**: Trades that hit 2x but stopped before 3x
  - Exit multiple distributions
  - Min multiple after 2x (P10)
  
- **Never 2x**: Trades stopped in Phase 1
  - Exit multiple distributions

### 📊 Interactive Charts
1. **Exit Multiple Distribution**: Histogram by cohort
2. **Peak vs Exit Scatter**: Visualize giveback patterns
3. **Giveback Distribution**: Winners only, with percentiles
4. **Exit Reasons**: Pie chart breakdown

### 🔄 Strategy Comparison
- Compare all strategies side-by-side
- Sort by EV from entry
- Bar chart visualization
- Filterable by caller

### 🏅 Top Trades Table
- Configurable number of trades (10-100)
- Sorted by exit multiple
- Shows all milestone hits (2x, 3x, 4x, 5x, 10x)
- Exit reason for each trade

## Installation

```bash
# Install dependencies
pip install -r tools/backtest/requirements-dashboard.txt

# Or install individually
pip install streamlit plotly pyarrow pandas
```

## Usage

### Basic Usage

```bash
# Launch dashboard (auto-discovers all parquet files)
streamlit run tools/backtest/dashboard.py
```

The dashboard will automatically scan your `output/` and `results/` directories for parquet files and present them in a dropdown selector.

### Select Data Source

Once the dashboard opens:
1. **Sidebar** → **Data Source** dropdown
2. Select from available directories (shows file count)
3. Or choose "Custom pattern..." to enter a specific path

No need to specify file paths on the command line!

## Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│  📊 QuantBot EV Dashboard                                   │
│  Phased Stop Strategy Analysis                              │
├─────────────────────────────────────────────────────────────┤
│  Sidebar:                                                    │
│  - 📁 Data Source (parquet pattern)                         │
│  - 🎛️ Filters (mode, stop %, caller)                       │
├─────────────────────────────────────────────────────────────┤
│  Top Metrics:                                                │
│  [Total] [EV Entry] [EV 2x] [P(2x)] [P(3x|2x)]             │
├─────────────────────────────────────────────────────────────┤
│  Cohort Breakdown:                                           │
│  [🏆 Winners] [📉 Losers] [❌ Never 2x]                     │
├─────────────────────────────────────────────────────────────┤
│  Distribution Analysis (Tabs):                               │
│  - Exit Multiples (histogram)                               │
│  - Peak vs Exit (scatter)                                   │
│  - Giveback (histogram + percentiles)                       │
│  - Exit Reasons (pie chart)                                 │
├─────────────────────────────────────────────────────────────┤
│  Top Trades Table (configurable size)                       │
├─────────────────────────────────────────────────────────────┤
│  Strategy Comparison (optional)                              │
│  - All strategies table                                     │
│  - EV comparison bar chart                                  │
└─────────────────────────────────────────────────────────────┘
```

## Tips

### Performance
- Dashboard caches loaded data for fast filtering
- Reload data: Use Streamlit's "Rerun" button (top right)
- Large datasets: Consider filtering by date range before loading

### Analysis Workflow
1. **Start broad**: View all callers, compare strategies
2. **Identify best strategy**: Sort by EV in comparison mode
3. **Drill down**: Filter to specific caller + strategy
4. **Analyze cohorts**: Check winner/loser distributions
5. **Inspect top trades**: Look for patterns in exit reasons

### Interpreting Charts

**Peak vs Exit Scatter**:
- Points on diagonal = no giveback (exit at peak)
- Points below diagonal = gave back profit
- Distance from diagonal = giveback magnitude

**Giveback Distribution**:
- Low giveback (0-10%) = tight trailing stop
- High giveback (30%+) = loose trailing stop or end-of-data exit

**Exit Reasons**:
- `stopped_phase1` = stopped before 2x
- `stopped_phase2` = stopped after 2x
- `end_of_data` = still in trade when data ended

## Troubleshooting

### "No data loaded"
- Check parquet file pattern is correct
- Verify files exist: `ls -l output/2025_v2/phased_stop_results_*.parquet`
- Try absolute path

### "Error loading data"
- Corrupted parquet file: Remove and regenerate
- Missing columns: Ensure files have EV metrics (exit_mult, peak_mult, etc.)

### Slow performance
- Too many files: Use more specific pattern
- Large dataset: Filter by date range in simulator before loading

### Port already in use
```bash
# Specify custom port
streamlit run tools/backtest/dashboard.py --server.port 8502 -- output/2025_v2/phased_stop_results_*.parquet
```

## Examples

### Compare all strategies for a specific caller

1. Launch dashboard
2. Sidebar → Caller: Select "Whale 🐳 x"
3. Scroll to "Strategy Comparison"
4. Check "Show strategy comparison"
5. Review table sorted by EV

### Find best stop % for winners

1. Filter to trailing mode
2. Try different Phase 2 stop %
3. Compare "Mean Giveback" in Winners cohort
4. Lower giveback = tighter stop

### Identify high-giveback trades

1. Go to "Peak vs Exit" tab
2. Look for points far below diagonal
3. Hover to see caller, mint, exit reason
4. Cross-reference with "Top Trades" table

## Related Tools

- **Simulator**: `phased_stop_simulator.py` - Generate parquet data
- **Query Helper**: `query_ev_results.py` - Command-line queries
- **Drawdown Analysis**: `post2x_drawdown_analysis.py` - Theoretical analysis

## Support

For issues or questions:
1. Check parquet files are valid: `python3 query_ev_results.py <file> --stats`
2. Verify dependencies: `pip list | grep -E "streamlit|plotly|pyarrow"`
3. Check Streamlit logs in terminal

---

**Built with**: Streamlit, Plotly, Pandas, PyArrow

