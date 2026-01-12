# Comparison Dashboard - Quick Start

## 🚀 3-Step Setup

### Step 1: Run Simulations

```bash
cd /home/memez/backups/quantBot-abstraction-backtest-only

# Immediate entry (baseline) → Creates output/immediate_entry/
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry 0 \
    --threads 12 \
    --output-dir output

# -10% dip → Creates output/dip_-10pct/
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry -10 \
    --threads 12 \
    --output-dir output

# -20% dip → Creates output/dip_-20pct/
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --chain solana \
    --date-from 2025-05-01 \
    --date-to 2025-07-31 \
    --delayed-entry -20 \
    --threads 12 \
    --output-dir output
```

### Step 2: Launch Dashboard

```bash
.venv-dashboard/bin/streamlit run tools/backtest/dashboard.py
```

### Step 3: Compare

1. **Select mode**: "Compare Entry Strategies" (sidebar radio button)
2. **Select datasets**: Check Immediate, -10% dip, -20% dip
3. **Select strategy**: trailing, 15% / 50%
4. **View results**: Best strategy highlighted in green

## 📊 What You'll See

### Main Comparison Table

| Entry Strategy | Total Trades | EV from Entry | Winners % |
|----------------|--------------|---------------|-----------|
| **-10% dip** (🟢) | 1,200 | **+52.1%** | 5.2% |
| Immediate (0%) | 1,500 | +44.3% | 4.7% |
| -20% dip | 800 | +38.5% | 6.1% |

### Charts

1. **EV Comparison** - Bar chart (best in green)
2. **Trade Count vs EV** - Scatter plot (shows trade-offs)
3. **Winner Capture** - Bar chart (% hitting ≥3x)
4. **Cohort Breakdown** - Stacked bar (winners/losers/never 2x)

### Key Insights

```
🎯 Best Entry Strategy: -10% dip with +52.1% EV from entry

Baseline (Immediate Entry): +44.3% EV, 1,500 trades

📈 -10% dip: +52.1% EV (+7.8% vs immediate), 1,200 trades ⬇️ (-20.0%)
📉 -20% dip: +38.5% EV (-5.8% vs immediate), 800 trades ⬇️ (-46.7%)
```

## 🎯 Decision Framework

### If EV improves AND trade count is acceptable
→ **Use delayed entry**

### If EV improves BUT trade count drops too much
→ **Balance needed** (test smaller dips)

### If EV decreases
→ **Use immediate entry** (winners pump without dipping)

## 💡 Pro Tips

1. **Test multiple stop strategies** - Optimal entry might vary
2. **Check winner capture** - Don't miss 3x+ winners
3. **Consider frequency** - Fewer trades = less action
4. **Per-caller analysis** - Use single mode for deep dive

## 📖 Full Documentation

- **Complete Guide**: `DASHBOARD_COMPARISON_MODE.md`
- **Usage Examples**: `DELAYED_ENTRY_USAGE.md`
- **Strategy Plan**: `DELAYED_ENTRY_PLAN.md`

---

**That's it!** Run simulations → Launch dashboard → Compare → Decide 🎯

