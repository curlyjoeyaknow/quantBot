# Dashboard Quick Start 🚀

Get the interactive EV dashboard running in 2 minutes.

## Step 1: Install Dependencies

```bash
# Run the installation script
./tools/backtest/install_dashboard.sh
```

This will create a virtual environment and install Streamlit, Plotly, and other dependencies.

## Step 2: Launch Dashboard

```bash
# Using the virtual environment
.venv-dashboard/bin/streamlit run tools/backtest/dashboard.py
```

Or activate the venv first:

```bash
source .venv-dashboard/bin/activate
streamlit run tools/backtest/dashboard.py
```

The dashboard will automatically discover all available parquet files in your output directories!

## Step 3: Open Browser

The dashboard will automatically open in your browser at `http://localhost:8501`

If it doesn't open automatically, click the URL shown in the terminal.

## Step 4: Explore!

### Quick Tour

1. **Sidebar** (left): Select data and change filters
   - **Data Source**: Dropdown to select from available parquet files
   - Stop Mode: `trailing`, `static`, or `ladder`
   - Phase 1 Stop %: Stop for 1x→2x phase
   - Phase 2 Stop %: Stop for 2x+ phase
   - Caller: Filter by specific caller

2. **Top Metrics** (top): Key performance indicators
   - Total Trades
   - EV from Entry (%)
   - EV given 2x (%)
   - P(reach 2x)
   - P(3x | 2x)

3. **Cohort Breakdown**: Winners, Losers, Never 2x
   - Count, percentages, exit multiples

4. **Charts** (tabs):
   - Exit Multiples: Distribution by cohort
   - Peak vs Exit: Scatter plot showing giveback
   - Giveback: Winners only, with percentiles
   - Exit Reasons: Breakdown of why trades exited

5. **Top Trades Table**: Best performers

6. **Strategy Comparison**: Compare all strategies side-by-side

## Example Workflows

### Find Best Strategy for a Caller

1. Sidebar → Caller: Select "Whale 🐳 x"
2. Scroll down to "Strategy Comparison"
3. Check "Show strategy comparison"
4. Sort by "EV from Entry" (highest to lowest)
5. Note the best stop mode and percentages

### Analyze Giveback Patterns

1. Filter to `trailing` mode with 20%/20% stops
2. Go to "Giveback" tab
3. Review percentiles (P25, P50, P75, P90)
4. Check histogram for distribution shape

### Identify High-Performing Trades

1. Set "Number of trades to show" slider to 50
2. Review "Top Trades by Exit Multiple" table
3. Look for patterns in callers, milestones hit
4. Note exit reasons

## Troubleshooting

### Port Already in Use

```bash
.venv-dashboard/bin/streamlit run tools/backtest/dashboard.py --server.port 8502 -- output/2025_v2/phased_stop_results_*.parquet
```

### Can't Find Parquet Files

```bash
# List available files
ls -lh output/*/phased_stop_results_*.parquet

# Use specific directory
.venv-dashboard/bin/streamlit run tools/backtest/dashboard.py -- output/demo_ev/phased_stop_results_*.parquet
```

### Dashboard Won't Load

1. Check dependencies: `pip list | grep streamlit`
2. Verify parquet files exist
3. Try with absolute path to parquet files

## Tips

- **Performance**: Dashboard caches data, so filtering is instant
- **Reload Data**: Click "Rerun" (top right) after generating new parquet files
- **Multiple Datasets**: Change parquet pattern in sidebar to switch datasets
- **Export**: Use browser's print function to save charts as PDF

## Next Steps

- Read full documentation: `README_DASHBOARD.md`
- Generate more data: `phased_stop_simulator.py`
- Query from CLI: `query_ev_results.py`

---

**Need Help?** Check the terminal for Streamlit logs and error messages.

