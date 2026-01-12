# Phased Stop Results Analysis Summary

**Analysis Date**: Generated from `phased_stop_results_7e0cb30d02f15805.parquet`  
**Total Trades**: 111,688  
**Unique Callers**: 61  
**Callers Analyzed** (>=20 trades): 61

## Key Findings

### Top Performing Callers

1. **Monad Malik** (230 trades)
   - Avg Return: 2,813.11% (aggregate), 8575.75% (best strategy)
   - Strategy: Static stops (25% / 25%)
   - Characteristics: High volatility, strong tail events
   - **Recommendation**: Looser stops (30-40% Phase 1) to capture more tail

2. **JK -Whale** (6,624 trades) ⭐ **HIGH CONFIDENCE**
   - Avg Return: 110.75% (aggregate), 264.68% (best strategy)
   - Strategy: Trailing stops (10% / 10%)
   - Win Rate: 45.1%
   - Hit 3x Rate: 4.9%
   - **Recommendation**: Current strategy is good. Test ladder exits to capture more tail.

3. **Whale 🐳 x** (5,198 trades) ⭐ **HIGH CONFIDENCE**
   - Avg Return: 55.49% (aggregate), 148.77% (best strategy)
   - Strategy: Trailing stops (10% / 10%)
   - Win Rate: 54.0%
   - Hit 3x Rate: 4.4%
   - **Recommendation**: Current strategy performs well. Consider testing slightly tighter Phase 2 stops (8-9%).

4. **Austic** (12,006 trades) ⭐ **HIGH CONFIDENCE**
   - Avg Return: 27.29% (aggregate), 78.60% (best strategy)
   - Strategy: Trailing stops (10% / 10%)
   - Win Rate: 54.0%
   - Hit 3x Rate: 5.4%
   - **Recommendation**: Well-optimized. Large sample size validates strategy.

5. **Brook Giga I verify @BrookCalls** (18,906 trades) ⭐ **LARGEST SAMPLE**
   - Avg Return: 22.71% (aggregate), 44.80% (best strategy)
   - Strategy: Trailing stops (10% / 10%)
   - Win Rate: 45.3%
   - Hit 3x Rate: 3.9%
   - **Recommendation**: Most trades in dataset. Current strategy is solid base.

### Strategic Insights

1. **Trailing stops dominate top performers**
   - 8 of top 10 use trailing stops
   - Better for capturing tail events while managing risk

2. **10% stops are common for top callers**
   - Many high-performing callers use 10% Phase 1 and Phase 2 stops
   - Suggests these callers benefit from tighter risk management

3. **Sample size matters**
   - Monad Malik has extreme returns but low confidence (small sample, high variance)
   - Focus on callers with >100 trades for reliable recommendations

4. **Hit rates vs. capture rates**
   - Many callers have decent 2x hit rates but low 5x+ capture
   - Opportunity: Test ladder exits for high hit-rate callers

## Recommended Next Steps

### Immediate Actions

1. **Run Optimizer for Top Callers**
   ```bash
   # Focus on high-confidence, high-performance callers
   python3 tools/backtest/run_optimizer.py \
       --from 2025-12-01 --to 2025-12-24 \
       --tp-values 2.0,3.0,4.0,5.0 \
       --sl-values 0.85,0.9,0.95 \
       --caller-ids "JK -Whale" "Whale 🐳 x" "Austic"
   ```

2. **Test Ladder Exits for High Hit-Rate Callers**
   - JK -Whale: High volume, decent hit rates
   - Whale 🐳 x: Good win rate, could capture more tail
   - Brook: Strong 3x hit rate (20%), test ladder exits

3. **Validate Recommendations on Out-of-Sample Data**
   - Split data chronologically
   - Test recommended strategies on future period

### Further Testing Ideas

1. **Indicator-Based Exits**
   - Test RSI overbought signals
   - Volume divergence detection
   - Moving average crossovers

2. **Time-Based Exits**
   - For callers with long hold times and giveback
   - Exit after X minutes after hitting 2x

3. **Per-Caller Optimization**
   - Run optimizer separately for each top caller
   - Use recommended phased stop params as starting point

4. **Combination Strategies**
   - Test ladder + trailing stop combinations
   - Time limits + trailing stops
   - Indicator triggers + fixed stops

## Integration with Optimizer

The optimizer config file has been generated: `optimizer_config_phased_stop_results_*.json`

**Current Limitation**: The optimizer uses TP/SL multipliers, while phased stops use percentages. Two options:

1. **Manual Conversion** (Recommended for now):
   - Phase 1 stop 10% = SL multiplier 0.90x
   - Phase 2 stop 10% = SL multiplier 0.90x (from 2x level)
   - Use optimizer to refine TP targets (2x, 3x, 4x, 5x)

2. **Extend Optimizer** (Future work):
   - Add phased stop support to optimizer
   - More direct integration with phased stop simulator

## Files Generated

- `analysis_report_*.txt`: Detailed per-caller analysis
- `analysis_data_*.json`: Machine-readable data
- `optimizer_config_*.json`: Optimizer configuration suggestions
- `PHASED_STOP_ANALYSIS_GUIDE.md`: Comprehensive guide

## Confidence Levels

- **HIGH**: >100 trades, >5 strategies tested, consistent results
- **MEDIUM**: 50-100 trades, multiple strategies tested
- **LOW**: <50 trades or limited strategy coverage

**Focus on HIGH confidence recommendations first.**

## Questions to Explore

1. Why do some callers perform better with universal stops vs. phased stops?
2. What causes the extreme variance in Monad Malik's returns?
3. Can we predict which exit strategy works best based on caller characteristics?
4. How do different stop percentages affect tail capture rates?
5. Are there optimal combinations of stop modes for different market conditions?

