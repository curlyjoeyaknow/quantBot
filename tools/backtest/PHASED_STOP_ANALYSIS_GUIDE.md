# Phased Stop Results Analysis Guide

This guide explains how to interpret the phased stop simulation results and integrate them with the optimizer.

## Overview

The phased stop simulator tests different stop-loss strategies across two phases:

1. **Phase 1 (1x→2x)**: Entry to first profit target (2x)
2. **Phase 2 (2x+)**: After hitting 2x, trail until stopped out

It compares:

- Universal stops (same % for both phases)
- Phased stops (different % for each phase)
- Various stop modes: static, trailing, ladder

## Running the Analysis

```bash
# Analyze results and generate recommendations
python3 tools/backtest/analyze_phased_stop_results.py \
    output/immediate/phased_stop_results_7e0cb30d02f15805.parquet \
    --min-trades 20 \
    --export-optimizer-config

# Output files:
# - analysis_report_*.txt: Human-readable report
# - analysis_data_*.json: Machine-readable data
# - optimizer_config_*.json: Config for optimizer integration
```

## Interpreting the Results

### Key Metrics

1. **Avg Return %**: Average return per trade (percentage)
2. **Win Rate %**: Percentage of profitable trades
3. **Hit 2x/3x/5x Rate**: Percentage of trades that reached those multiples
4. **Median Exit Multiple**: Median exit multiple (1.0 = breakeven, 2.0 = 2x)
5. **Composite Score**: Weighted combination of metrics (higher = better)

### Performance Tiers

Based on the analysis, callers fall into different performance tiers:

#### Tier 1: High-Performance Callers (>100% avg return)

- **Monad Malik**: 8575.75% avg return, 40% win rate, 20% hit 3x
- **Marsel Ellada**: 894.13% avg return, 100% win rate, 100% hit 3x (small sample)
- **God Everything**: 320.25% avg return, 50% win rate, 50% hit 3x

**Strategy**: These callers benefit from **looser stops** to capture tail events. Consider:

- Phase 1 stops: 25-40%
- Phase 2 stops: 40-60%
- Trailing stops to lock in gains after 2x

#### Tier 2: Moderate Performance (20-100% avg return)

- **JK -Whale**: 264.68% avg return, 45.1% win rate, 4.9% hit 3x
- **Whale 🐳 x**: 148.77% avg return, 54.0% win rate, 4.4% hit 3x
- **Austic**: 78.60% avg return, 54.0% win rate, 5.4% hit 3x

**Strategy**: Balanced approach with moderate stops:

- Phase 1 stops: 15-25%
- Phase 2 stops: 25-40%
- Focus on win rate optimization

#### Tier 3: Lower Performance (<20% avg return)

- Most callers fall here
- Lower hit rates, more volatile

**Strategy**: Tighter risk management:

- Phase 1 stops: 10-20%
- Phase 2 stops: 15-30%
- Consider filtering these callers or tighter stops

## Recommended Strategy Configurations

The analysis script generates per-caller recommendations. Key patterns:

### Pattern 1: High Hit Rates, Low Capture

**Symptoms**: High 2x/3x hit rates but low 5x+ capture
**Solution**: Test ladder exits to capture more tail multiples

Example config:

```json
{
  "type": "ladder",
  "levels": [2.0, 3.0, 4.0, 5.0],
  "percentages": [25, 25, 25, 25]
}
```

### Pattern 2: Large Giveback from Peak

**Symptoms**: High average giveback percentage (e.g., >30%)
**Solution**: Tighter trailing stops or time-based exits

Example config:

```json
{
  "type": "trailing_stop",
  "trail_pct": 0.15,
  "activation_multiple": 2.0
}
```

### Pattern 3: High Win Rate, Low Returns

**Symptoms**: Win rate >55% but avg return <50%
**Solution**: Higher take-profit targets to capture more upside

Example config:

```json
{
  "type": "take_profit",
  "targets": [3.0, 4.0, 5.0],
  "percentages": [33, 33, 34]
}
```

### Pattern 4: Long Hold Times with Giveback

**Symptoms**: Avg hold time >120 minutes with >20% giveback
**Solution**: Time-based exits after hitting targets

Example config:

```json
{
  "type": "time_exit",
  "max_hold_after_target_minutes": 60,
  "target_multiple": 2.0
}
```

## Integration with Optimizer

The analysis script exports an optimizer configuration file that can be used to refine strategies further.

### Step 1: Review Exported Config

```bash
# View the exported config
cat output/immediate/optimizer_config_phased_stop_results_*.json | jq '.[0]'
```

The config includes:

- Base strategy (best found in phased stop simulation)
- Search space (parameter ranges to explore)
- Expected performance metrics

### Step 2: Convert to Optimizer Format

The current optimizer uses TP/SL multipliers, while phased stops use percentages. You have two options:

#### Option A: Manual Configuration

Create optimizer config files for top callers based on recommendations:

```yaml
# configs/optimizer/top_callers.yaml
name: top_callers_refinement
date_from: "2025-12-01"
date_to: "2025-12-24"
duckdb_path: "data/alerts.duckdb"
slice_path: "slices/per_token"

tp_sl:
  tp_mult:
    values: [2.0, 3.0, 4.0, 5.0]
  sl_mult:
    # Convert phase1_stop_pct to sl_mult (e.g., 0.25 = 25% stop = 0.75x sl_mult)
    values: [0.6, 0.7, 0.75, 0.8, 0.85]

caller_group: "top_20"  # Or specify caller_ids
```

#### Option B: Extend Optimizer for Phased Stops

The optimizer currently supports TP/SL. To use phased stops directly, you would need to:

1. Extend `OptimizerConfig` to support phased stop parameters
2. Update the query/simulation code to use phased stops
3. This is a larger change but would be more aligned with the phased stop simulator

### Step 3: Run Optimizer

```bash
# Run optimizer with the config
python3 tools/backtest/run_optimizer.py \
    --config configs/optimizer/top_callers.yaml

# Or use CLI args
python3 tools/backtest/run_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --tp-values 2.0,3.0,4.0,5.0 \
    --sl-values 0.6,0.7,0.75,0.8 \
    --caller-group top_20
```

### Step 4: Compare Results

Compare optimizer results with phased stop recommendations:

1. Check if optimizer finds better parameters
2. Validate that recommended strategies perform well
3. Identify any discrepancies (may indicate overfitting in phased stop analysis)

## Further Testing Ideas

Based on the analysis, here are recommended areas for further testing:

### 1. Ladder Exits

**When to test**: Callers with high 2x/3x hit rates but low 5x+ capture
**How to test**: Use `phased_stop_simulator.py` with ladder mode and different step sizes

```bash
# Test ladder exits for specific caller
python3 tools/backtest/phased_stop_simulator.py \
    --duckdb data/alerts.duckdb \
    --slice slices/per_token \
    --caller "JK -Whale" \
    --stop-mode ladder \
    --ladder-steps 0.25,0.5,1.0
```

### 2. Tighter Trailing Stops

**When to test**: Callers with high giveback from peak (>30%)
**How to test**: Test tighter trail percentages in Phase 2

### 3. Time-Based Exits

**When to test**: Callers with long hold times (>120 min) and giveback
**How to test**: Add time-based exit logic to simulator

### 4. Indicator-Based Exits

**When to test**: All callers (new capability)
**How to test**: Integrate RSI, volume divergence, or other indicators

### 5. Per-Caller Optimization

**When to test**: Top performers (Tier 1-2 callers)
**How to test**: Run optimizer separately for each caller with focused parameter ranges

```bash
# Optimize for specific caller
python3 tools/backtest/run_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --tp-values 2.0,3.0,4.0 \
    --sl-values 0.7,0.75,0.8 \
    --caller-ids "Monad Malik"
```

## Key Insights from Current Results

1. **Phased stops don't always outperform universal stops**
   - Some callers perform better with universal stops
   - Depends on caller's price action characteristics

2. **Trailing stops are effective for volatile callers**
   - High-performing callers often use trailing stops
   - Helps capture tail events while managing risk

3. **Ladder exits show promise but need more testing**
   - Limited data in current results
   - Worth exploring for high hit-rate callers

4. **Sample size matters**
   - Many callers have low confidence due to small sample sizes
   - Focus optimization on callers with >50 trades

5. **Tail capture is critical**
   - Top performers have strong 3x+ hit rates
   - Strategies that cut winners early underperform

## Next Steps

1. **Run optimizer for top callers** using the exported config as starting point
2. **Test ladder exits** for callers identified in recommendations
3. **Refine parameter ranges** based on optimizer results
4. **Validate recommendations** on out-of-sample data
5. **Implement per-caller strategies** in production system

## Files Generated

- `analysis_report_*.txt`: Human-readable analysis report
- `analysis_data_*.json`: Machine-readable analysis data (JSON)
- `optimizer_config_*.json`: Optimizer configuration suggestions

## Troubleshooting

**Q: Why are some recommendations marked as "LOW" confidence?**
A: Low sample size (<50 trades) or limited strategy testing. Focus on high-confidence recommendations first.

**Q: How do I convert phased stop percentages to optimizer TP/SL?**
A:

- Phase 1 stop 25% = SL multiplier 0.75x (entry * 0.75 = stop price)
- Phase 2 stop 40% = SL multiplier 0.60x (from 2x level)
- TP multipliers are straightforward: 2.0x, 3.0x, etc.

**Q: Can I use both phased stops and optimizer together?**
A: Currently the optimizer uses TP/SL multipliers. To use phased stops directly, you'd need to extend the optimizer (see Option B above).
