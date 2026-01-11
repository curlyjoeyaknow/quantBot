# Phased Stop Simulator - Column Definitions

## Overview

The phased stop simulator tests whether you need different stop percentages for different phases of a trade:
- **Phase 1 (1x→2x)**: From entry to first profit target (2x)
- **Phase 2 (2x+)**: After hitting 2x, trail until stopped out

## Output Columns Explained

### Strategy Configuration Columns

#### `P1%` - Phase 1 Stop Percentage
- **What it is**: The trailing stop percentage used in Phase 1 (entry to 2x)
- **Example**: `10%` means a 10% trailing stop from entry price
- **How it works**: 
  - Entry at $1.00, P1% = 10%
  - Stop starts at $0.90 (10% below entry)
  - If price moves to $1.20, stop moves to $1.08 (10% below peak)
  - If price drops to $1.08, you're stopped out in Phase 1

#### `P2%` - Phase 2 Stop Percentage
- **What it is**: The trailing stop percentage used in Phase 2 (after hitting 2x)
- **Example**: `20%` means a 20% trailing stop after hitting 2x
- **How it works**:
  - Entry at $1.00, hit 2x at $2.00
  - Phase 2 begins, stop starts at $1.60 (20% below $2.00)
  - If price moves to $3.00, stop moves to $2.40 (20% below peak)
  - If price drops to $2.40, you're stopped out in Phase 2

#### `Mode` - Stop Calculation Mode
- **What it is**: How the stop price is calculated
- **Options**:
  - `static`: Stop anchored at milestone price (doesn't move with peaks)
    - Example: At 2x ($2.00), stop stays at $1.60 (20% below $2.00) even if price goes to $3.00
  - `trailing`: Stop moves up with every new peak
    - Example: Price goes $2.00 → $3.00, stop moves $1.60 → $2.40
  - `ladder0.5`: Stop moves at 0.5x intervals (2.0x, 2.5x, 3.0x, 3.5x...)
    - Example: Stop at $1.60 until price hits $2.50, then stop moves to $2.00

### Trade Count Columns

#### `N` - Total Number of Trades
- **What it is**: Total number of simulated trades for this caller with this strategy
- **Example**: `N = 15` means 15 alerts were traded with this strategy
- **Use**: Larger N = more statistical significance

#### `Hit2x` - Number That Reached 2x
- **What it is**: How many trades reached the 2x milestone (entered Phase 2)
- **Example**: `N = 15, Hit2x = 9` means 9 out of 15 trades (60%) reached 2x
- **Use**: Shows caller quality - higher Hit2x% = better caller

#### `Stop1` - Stopped Out in Phase 1
- **What it is**: Number of trades stopped out before reaching 2x
- **Example**: `Stop1 = 6` means 6 trades were stopped out in Phase 1 (1x→2x)
- **Use**: High Stop1 with tight P1% means many trades stopped before reaching 2x
- **Formula**: `Stop1 = N - Hit2x` (approximately, some may end without hitting stop)

#### `Stop2` - Stopped Out in Phase 2
- **What it is**: Number of trades stopped out after reaching 2x
- **Example**: `Stop2 = 3` means 3 trades hit 2x, then were stopped out in Phase 2
- **Use**: Shows how many winners were captured vs stopped out post-2x

### Performance Columns

#### `AvgRet%` - Average Return Percentage
- **What it is**: Mean return across all trades
- **Formula**: `Sum of all returns / N`
- **Example**: `AvgRet% = 25.3%` means average return is +25.3% per trade
- **Use**: **This is your Expected Value (EV) per trade** - the key metric to optimize!
- **Interpretation**:
  - Positive = profitable strategy on average
  - Negative = losing strategy on average
  - Higher = better

#### `MedRet%` - Median Return Percentage
- **What it is**: Middle return when all returns are sorted
- **Example**: `MedRet% = 15.0%` means half of trades returned more than 15%, half less
- **Use**: Less sensitive to outliers than AvgRet%
- **Comparison with AvgRet%**:
  - If `AvgRet% > MedRet%`: A few big winners are pulling up the average
  - If `AvgRet% < MedRet%`: A few big losers are pulling down the average

#### `WinRate%` - Win Rate Percentage
- **What it is**: Percentage of trades with positive return
- **Formula**: `(Number of trades with return > 0) / N × 100`
- **Example**: `WinRate% = 60.0%` means 60% of trades were profitable
- **Use**: Shows consistency
- **Note**: A strategy can have low WinRate% but high AvgRet% if winners are much bigger than losers

#### `EV/Trade%` - Expected Value Per Trade
- **What it is**: Same as `AvgRet%` (repeated for emphasis)
- **Why it's important**: **This is THE metric to optimize**
- **Example**: `EV/Trade% = 30.0%` means you expect to make 30% on average per trade
- **Use**: Compare strategies - pick the one with highest EV/Trade%

### Capture Rate Columns

#### `Cap2x%` - Capture Rate for 2x
- **What it is**: Percentage of trades that reached 2x before being stopped out
- **Formula**: `(Hit2x / N) × 100`
- **Example**: `Cap2x% = 60.0%` means 60% of trades reached 2x
- **Use**: Shows how many potential winners you captured
- **Trade-off**: Tighter P1% = lower Cap2x% but fewer big losses

#### `Cap3x%` - Capture Rate for 3x (of 2x runners)
- **What it is**: Of the trades that hit 2x, what % also hit 3x?
- **Formula**: `(Number that hit 3x / Hit2x) × 100`
- **Example**: `Cap3x% = 40.0%` with `Hit2x = 10` means 4 out of 10 (40%) of the 2x runners also hit 3x
- **Use**: Shows continuation rate - how often 2x becomes 3x
- **Trade-off**: Looser P2% = higher Cap3x% but more giveback risk

#### `Cap4x%` - Capture Rate for 4x (of 2x runners)
- **What it is**: Of the trades that hit 2x, what % also hit 4x?
- **Formula**: `(Number that hit 4x / Hit2x) × 100`
- **Example**: `Cap4x% = 20.0%` with `Hit2x = 10` means 2 out of 10 (20%) of the 2x runners also hit 4x
- **Use**: Shows how often you capture the big runners
- **Note**: This is calculated from ALL trades that hit 2x, not just those that hit 3x

## Example Row Interpretation

```
P1%  P2%  Mode       N  Hit2x  Stop1  Stop2  AvgRet%  MedRet%  WinRate%  EV/Trade%  Cap2x%  Cap3x%  Cap4x%
10%  20%  trailing  23      5     18      3    15.5%    10.0%     52.2%      15.5%   21.7%   60.0%   40.0%
```

**What this means**:

1. **Strategy**: 10% trailing stop pre-2x, 20% trailing stop post-2x
2. **Sample size**: 23 trades tested
3. **Phase 1 results**: 
   - 5 trades (21.7%) reached 2x
   - 18 trades (78.3%) stopped out before 2x
4. **Phase 2 results**:
   - Of the 5 that hit 2x, 3 were stopped out in Phase 2
   - 2 continued past the Phase 2 stop
5. **Performance**:
   - Average return: +15.5% per trade (**This is your EV!**)
   - Median return: +10.0% (half of trades made more than 10%)
   - Win rate: 52.2% (just over half of trades were profitable)
6. **Milestones**:
   - 21.7% of ALL trades reached 2x
   - 60.0% of the 2x runners (3 out of 5) also reached 3x
   - 40.0% of the 2x runners (2 out of 5) also reached 4x

## How to Use This Data

### 1. Find the Best Strategy Per Caller

Look for the row with the **highest EV/Trade%** for each caller.

**Example**:
```
Whale 🐳 x
─────────────────────────────────────────────────────────────
10%  10%  trailing   7      5    73.2%  ← BEST (highest EV)
10%  20%  trailing   7      5    65.5%
15%  25%  trailing   7      5    56.5%
```

**Conclusion**: For Whale, use 10% trailing stop for BOTH phases (universal stop wins!)

### 2. Compare Universal vs Phased Stops

- **Universal**: P1% = P2% (same stop for both phases)
- **Phased**: P1% ≠ P2% (different stops per phase)

**Example**:
```
Brook 💀🧲
─────────────────────────────────────────────────────────────
10%  20%  ladder    23      1    11.7%  ← Phased (best)
10%  10%  trailing  23      0     9.2%  ← Universal
20%  20%  trailing  23      0     3.3%  ← Universal
```

**Conclusion**: For Brook, phased stops (10% pre-2x, 20% post-2x) beat universal stops!

### 3. Understand Trade-offs

#### Tight P1% (e.g., 10%)
- **Pros**: Limits losses on losers, higher win rate
- **Cons**: Lower Cap2x% (miss some 2x runners)

#### Loose P1% (e.g., 30%)
- **Pros**: Higher Cap2x% (capture more 2x runners)
- **Cons**: Bigger losses on losers, lower win rate

#### Tight P2% (e.g., 10%)
- **Pros**: Lock in profits quickly, less giveback
- **Cons**: Lower Cap3x%/Cap4x% (miss big runners)

#### Loose P2% (e.g., 30%)
- **Pros**: Higher Cap3x%/Cap4x% (capture big runners)
- **Cons**: More giveback from peak

### 4. Look for Patterns

#### High EV with Low Cap2x%
```
AvgRet% = 30%, Cap2x% = 10%
```
**Interpretation**: Tight stops work well - the few 2x runners that get through are very profitable, and losses are small.

#### High EV with High Cap2x%
```
AvgRet% = 30%, Cap2x% = 60%
```
**Interpretation**: Loose stops work well - caller has high quality (many reach 2x), so letting them run is profitable.

#### Low EV despite High Cap2x%
```
AvgRet% = -5%, Cap2x% = 60%
```
**Interpretation**: Caller reaches 2x often but then nukes - need tighter Phase 2 stops or this caller isn't tradeable.

## Key Takeaways

1. **Optimize for EV/Trade%** - this is your expected profit per trade
2. **Universal vs Phased** - test both to see which works better per caller
3. **Cap2x% shows caller quality** - higher = better caller
4. **Cap3x%/Cap4x% show continuation** - how often 2x becomes 3x/4x
5. **WinRate% ≠ Profitability** - a 40% win rate can still be very profitable if winners are big
6. **Stop1 vs Stop2** - shows where most trades exit (Phase 1 or Phase 2)

## Common Questions

### Q: Why is AvgRet% different from MedRet%?
**A**: Outliers! If you have a few huge winners (e.g., 10x), they pull the average up. Median is more "typical" but average is what you actually earn over many trades.

### Q: Can EV/Trade% be negative?
**A**: Yes! Negative EV means the strategy loses money on average. Don't use it.

### Q: What's a "good" EV/Trade%?
**A**: 
- `> 20%`: Excellent
- `10-20%`: Good
- `0-10%`: Marginal
- `< 0%`: Don't trade

### Q: Should I always use the highest EV/Trade% strategy?
**A**: Yes, IF the sample size (N) is large enough (>20 trades). With small N, results may be due to luck.

### Q: Why do some strategies have Hit2x = 0?
**A**: The P1% stop is so tight that ALL trades get stopped out before reaching 2x. This usually means the stop is too tight for this caller.

### Q: What if P1% = P2% has the best EV?
**A**: Use a universal stop! No need for phased stops if the same percentage works for both phases.

