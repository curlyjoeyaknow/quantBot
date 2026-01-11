# Delayed Entry Analysis Plan

## Concept

Test if "waiting for a dip" after the alert improves results.

**Question**: Should we enter immediately at alert price, or wait for price to drop X% first?

## Entry Strategies to Test

| Strategy | Entry Price | Description |
|----------|-------------|-------------|
| **Immediate** | Alert price | Enter at alert (current baseline) |
| **-5% dip** | Alert × 0.95 | Wait for 5% drop |
| **-10% dip** | Alert × 0.90 | Wait for 10% drop |
| **-15% dip** | Alert × 0.85 | Wait for 15% drop |
| **-20% dip** | Alert × 0.80 | Wait for 20% drop |
| **-25% dip** | Alert × 0.75 | Wait for 25% drop |
| **-30% dip** | Alert × 0.70 | Wait for 30% drop |
| **-40% dip** | Alert × 0.60 | Wait for 40% drop |
| **-50% dip** | Alert × 0.50 | Wait for 50% drop |

## Key Metrics to Track

### 1. Dip Occurrence Rate

- **% of trades where dip occurred**
- If waiting for -20% dip, how often does price actually drop 20%?
- This determines "missed opportunity" rate

### 2. Time to Dip

- **Hours/minutes until target dip**
- Fast dips (minutes) vs slow dips (hours)
- Distribution: P50, P75, P90

### 3. Exit Multiple Comparison

**From Entry Price:**

- Exit multiple calculated from actual entry price
- Example: Enter at -10% dip, exit at 3x from entry = 2.7x from alert

**From Alert Price:**

- Exit multiple calculated from alert price
- Allows direct comparison with immediate entry

### 4. EV Comparison

**Realized EV:**

- Only includes trades where dip occurred
- Average exit multiple for successful entries

**Opportunity-Adjusted EV:**

- Includes missed trades (dip never occurred)
- Missed trades = 0x return
- Formula: `EV = (dip_rate × realized_EV) + ((1 - dip_rate) × 0)`

## Stop Calculation Options

### Option 1: Stops from Alert Price (Recommended)

**Logic**: Stops calculated from original alert price, regardless of entry price.

**Example**:

- Alert: $1.00
- Wait for -20% dip: Enter at $0.80
- Phase 1 stop (15%): $0.85 (15% below $1.00)
- Phase 2 stop (50%): $1.00 (50% below $2.00)

**Pros**:

- Consistent risk management
- Stops don't change based on entry timing
- Fair comparison across all entry strategies

**Cons**:

- Stop might be above entry price initially
- Could stop out immediately if entered near stop

### Option 2: Stops from Entry Price

**Logic**: Stops calculated from actual entry price.

**Example**:

- Alert: $1.00
- Wait for -20% dip: Enter at $0.80
- Phase 1 stop (15%): $0.68 (15% below $0.80)
- Phase 2 stop (50%): $0.80 (50% below $1.60)

**Pros**:

- Stops are always below entry
- More intuitive risk management

**Cons**:

- Different risk profiles for each entry strategy
- Not apples-to-apples comparison
- Deeper dips = lower absolute stops

## Expected Results

### Hypothesis 1: Small Dips Improve EV

**Prediction**: -5% to -15% dips will:

- Occur frequently (70-90% of time)
- Provide better entry price
- Higher EV than immediate entry

**Why**: Solana memecoins often have initial volatility/wicks after alert.

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

## Implementation Plan

### Phase 1: Framework (✅ Done)

- Created `delayed_entry_analysis.py`
- Defined data structures
- Outlined simulation logic

### Phase 2: Integration with Existing Data

**Option A**: Analyze existing simulator results

- Load phased_stop_results parquet
- For each trade, check if dips occurred
- Estimate what would have happened

**Option B**: Re-run simulator with delayed entry

- Modify `phased_stop_simulator.py`
- Add `--delayed-entry` parameter
- Run full simulation for each dip %

### Phase 3: Full Simulation

1. Load alerts from DuckDB
2. Load candles for each token
3. For each alert:
   - Simulate immediate entry (baseline)
   - Simulate each delayed entry (-5%, -10%, ..., -50%)
   - Track dip occurrence, time to dip, exit multiples
4. Aggregate results
5. Generate comparison report

### Phase 4: Analysis & Recommendations

**Compare**:

- Immediate vs delayed entry EV
- Dip occurrence rates
- Time to dip distributions
- Winner capture rates (≥3x)

**Determine**:

- Optimal dip percentage
- Which stop calculation method is better
- Per-caller optimization (do some callers need different dips?)

## Output Format

### Summary Table

| Entry Strategy | Dip Rate | Time to Dip (Median) | Realized EV | Opp-Adj EV | Winners (≥3x) |
|----------------|----------|----------------------|-------------|------------|---------------|
| Immediate (0%) | 100% | 0h | +44.3% | +44.3% | 4.7% |
| -5% dip | 85% | 0.2h | +52% | +44.2% | 5.1% |
| -10% dip | 70% | 0.5h | +65% | +45.5% | 5.5% |
| -15% dip | 55% | 1.0h | +80% | +44.0% | 6.0% |
| -20% dip | 40% | 2.0h | +95% | +38.0% | 6.5% |
| -25% dip | 30% | 3.0h | +110% | +33.0% | 7.0% |
| -30% dip | 20% | 5.0h | +130% | +26.0% | 7.5% |

### Per-Dip Analysis

For each dip percentage:

- **Dip occurrence**: X% of trades
- **Time to dip**: Median, P75, P90
- **Realized EV**: Average for trades that entered
- **Opportunity-adjusted EV**: Including missed trades
- **Winner rate**: % that hit ≥3x
- **Comparison**: vs immediate entry

### Visualization Ideas

1. **Dip Occurrence Curve**
   - X-axis: Dip %
   - Y-axis: % of trades where dip occurred
   - Shows trade-off between better entry and missed opportunities

2. **EV Comparison**
   - X-axis: Dip %
   - Y-axis: EV (realized vs opportunity-adjusted)
   - Shows optimal dip percentage

3. **Time to Dip Distribution**
   - Box plot for each dip %
   - Shows how long you'd wait

## Questions to Answer

1. **What's the optimal dip percentage?**
   - Maximize opportunity-adjusted EV
   - Balance between better entry and missed trades

2. **How often do dips occur?**
   - For each dip %, what % of alerts actually dip that much?
   - Determines feasibility of strategy

3. **How long do we wait?**
   - Time to dip distribution
   - Is it seconds, minutes, or hours?

4. **Do we miss winners?**
   - Winner capture rate for each dip %
   - Do winners pump without dipping?

5. **Which stop calculation is better?**
   - Stops from alert price vs entry price
   - Which gives better risk-adjusted returns?

6. **Does this vary by caller?**
   - Some callers might have more volatile entries
   - Per-caller optimization

## Next Steps

1. **Implement full simulation**
   - Integrate with phased_stop_simulator.py
   - Or create standalone delayed_entry_simulator.py

2. **Run on existing data**
   - Test on 2025_v2 dataset
   - Compare with baseline (static 15%/50%)

3. **Analyze results**
   - Generate summary tables
   - Create visualizations
   - Identify optimal dip %

4. **Test variations**
   - Different stop calculations
   - Per-caller optimization
   - Time limits (e.g., max 1h wait for dip)

5. **Update recommendations**
   - Add to strategy guide
   - Include in dashboard
   - Document best practices

## Expected Timeline

- **Framework**: ✅ Complete
- **Full simulation**: 2-4 hours implementation
- **Analysis**: 1-2 hours
- **Documentation**: 1 hour

**Total**: ~4-7 hours to complete

## Strategic Implications

**If small dips (-5% to -15%) improve EV**:

- Implement limit orders at -X% below alert
- Wait for dip before entering
- Better risk/reward ratio

**If large dips (-30%+) have lower opp-adj EV**:

- Don't wait too long
- Enter quickly or miss opportunities
- Immediate entry might be better

**If immediate entry is optimal**:

- Current strategy is correct
- Don't overthink entries
- Focus on exits instead

This analysis will definitively answer: **"Should we wait for a dip, and if so, how much?"** 🎯
