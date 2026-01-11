# Stop Modes Explained

## Understanding Exit Reasons and Stop Behavior

### Exit Reasons

1. **`stopped_phase1`**: Trade hit the Phase 1 stop (before reaching 2x)
2. **`stopped_phase2`**: Trade hit the Phase 2 stop (after reaching 2x)
3. **`end_of_data`**: Trade reached the end of the observation window (48 hours) without hitting a stop

### The `end_of_data` Scenario

**What it means**: The token is still trading 48 hours after entry and has NOT hit the stop.

**Exit behavior**: Exit at the **last close price** (current market price at 48 hours).

**Why this matters for static stops**:

#### Example: Static 10% / 30%

- Entry: $1.00
- Phase 2 stop: $1.40 (30% below $2.00)
- Token peaks at $1,235 (1235x)
- At 48 hours: Trading at $430 (430x)
- Stop at $1.40 was **never hit**
- Exit reason: `end_of_data`
- Exit price: **$430** ✅ (correct!)

**This is NOT a bug!** The stop was never triggered because price never dropped to $1.40.

### Why Mean ≠ Median for Static Stops

**Static 10% / 30% example**:
- **32 trades**: Hit stop at 1.4x → stopped_phase2
- **6 trades**: Still trading at 48h → end_of_data (ranging from 0.9x to 430x)
- **Median**: 1.40x (most trades hit the stop)
- **Mean**: 24x (skewed by the 430x outlier)

This is **expected behavior**, not a bug!

## Stop Mode Comparison

### STATIC Stop

**Behavior**:
- Phase 1: Stop at `entry * (1 - phase1_stop_pct)`, never moves
- Phase 2: Stop at `2x * (1 - phase2_stop_pct)`, never moves

**Exit scenarios**:
1. `stopped_phase1`: Price dropped to Phase 1 stop
2. `stopped_phase2`: Price dropped to Phase 2 stop (e.g., 1.4x for 30% stop)
3. `end_of_data`: Price never hit stop, exit at current price (can be >>2x!)

**Characteristics**:
- ✅ Maximum protection (guaranteed minimum exit if stop hits)
- ✅ Never gets stopped out by volatility
- ⚠️ Can miss massive gains if price stays above stop
- ⚠️ `end_of_data` exits can be anywhere from 0x to 1000x+

**Best for**: Conservative traders who want guaranteed minimum returns after hitting 2x.

---

### TRAILING Stop

**Behavior**:
- Phase 1: Stop trails every new peak by `phase1_stop_pct`
- Phase 2: Stop trails every new peak by `phase2_stop_pct`

**Exit scenarios**:
1. `stopped_phase1`: Price dropped `phase1_stop_pct` from Phase 1 peak
2. `stopped_phase2`: Price dropped `phase2_stop_pct` from Phase 2 peak
3. `end_of_data`: Price never retraced enough to hit stop

**Characteristics**:
- ✅ Captures maximum upside
- ✅ Locks in gains continuously
- ❌ More sensitive to volatility (can get stopped on wicks)
- ⚠️ `end_of_data` exits are close to peak (within `phase2_stop_pct`)

**Best for**: Aggressive traders who want to maximize capture on big runners.

---

### LADDER Stop

**Behavior**:
- Stop moves up in discrete steps (e.g., every 0.5x multiple)
- Phase 1: Anchors at 1.0x, 1.5x, 2.0x
- Phase 2: Anchors at 2.0x, 2.5x, 3.0x, 3.5x, etc.

**Exit scenarios**:
1. `stopped_phase1`: Price dropped `phase1_stop_pct` from Phase 1 anchor
2. `stopped_phase2`: Price dropped `phase2_stop_pct` from Phase 2 anchor
3. `end_of_data`: Price never retraced enough to hit stop

**Characteristics**:
- ✅ Balance between static and trailing
- ✅ Less sensitive to short-term volatility
- ✅ Captures most of the move
- ⚠️ Slightly less upside than trailing

**Best for**: Balanced traders who want to reduce whipsaw while capturing most of the move.

---

## Interpreting Dashboard Metrics

### When Mean >> Median

**Example**: Mean 24x, Median 1.4x

**What this tells you**:
- Most trades hit the stop (median = stop price)
- A few trades never hit stop and exited at `end_of_data` with high multiples
- These outliers skew the mean upward

**Is this good or bad?**
- **Good**: You captured some massive winners (430x!)
- **Bad**: Your stop was too tight for those winners (they never came back to 1.4x)
- **Insight**: Consider a looser stop or trailing stop to capture more upside

### When Mean ≈ Median

**Example**: Mean 3.2x, Median 3.1x

**What this tells you**:
- Most trades behave similarly
- Few outliers
- Stop is working consistently

### Cohort Analysis

**Winners (≥3x)**:
- `stopped_phase2`: Hit stop after reaching 3x
- `end_of_data`: Still trading at 48h (may be way above stop)

**Losers (2x, no 3x)**:
- `stopped_phase2`: Hit stop between 2x and 3x
- `end_of_data`: Still trading between 2x and 3x at 48h

**Never 2x**:
- `stopped_phase1`: Hit stop before 2x
- `end_of_data`: Still trading below 2x at 48h

---

## Recommendations

### If you see high `end_of_data` exits:

**For static stops**:
- Consider using trailing or ladder stops instead
- Or increase the observation window beyond 48h
- Or accept that you'll miss some upside for guaranteed minimums

**For trailing stops**:
- This is rare (stop usually catches up)
- If it happens, price is still climbing at 48h
- Consider extending observation window

**For ladder stops**:
- Similar to trailing
- Adjust `ladder_steps` to move stop more frequently

### Optimizing Stop Percentages

1. **Look at giveback distribution** (winners only)
   - P50 giveback = typical profit given back before stop
   - If P50 > 40%, stop might be too loose

2. **Compare `stopped_phase2` vs `end_of_data` exits**
   - If most exits are `end_of_data`, stop is too tight
   - If most exits are `stopped_phase2`, stop is working as intended

3. **Check EV from entry**
   - Higher EV = better overall performance
   - Compare across different stop modes and percentages

---

## Summary

| Metric | Static | Trailing | Ladder |
|--------|--------|----------|--------|
| **Protection** | Maximum | Medium | High |
| **Upside Capture** | Low | Maximum | High |
| **Volatility Sensitivity** | Low | High | Medium |
| **`end_of_data` Frequency** | High | Low | Low |
| **Mean vs Median** | Often divergent | Usually similar | Usually similar |
| **Best Use Case** | Conservative | Aggressive | Balanced |

**Key Insight**: `end_of_data` exits are a **feature, not a bug**. They represent trades that never hit your stop within the observation window. For static stops, this can mean massive gains OR small losses. For trailing/ladder stops, this usually means you're still in a winning trade when data ends.

