# Wide Stop Analysis: 15% / 50%

## Comparison: Static vs Trailing

### Static 15% / 50%

**Exit Multiple by Time Window:**

| Window | Trades | Mean Exit | Median Exit | EV% |
|--------|--------|-----------|-------------|-----|
| 2h | 1363 | 0.86x | 0.85x | **-13.7%** |
| 4h | 1401 | 0.86x | 0.85x | -13.6% |
| 6h | 1426 | 0.86x | 0.85x | -13.6% |
| 12h | 1448 | 0.86x | 0.85x | -13.6% |
| 24h | 1475 | 0.87x | 0.85x | -12.5% |
| 48h | 1485 | 0.88x | 0.85x | **-12.5%** |

**Cohort Breakdown:**

| Cohort | N | Median Time | ≤2h | ≤6h | ≤12h |
|--------|---|-------------|-----|-----|------|
| ≥10x | 10 | 8.9h | 40% | 40% | 60% |
| 5x-10x | 18 | 1.2h | 78% | 89% | 89% |
| 4x-5x | 16 | 0.7h | 62% | 75% | 88% |
| 3x-4x | 28 | 1.1h | 71% | 86% | 86% |
| 2x-3x | 87 | 0.2h | 83% | 89% | 89% |
| <2x | 1381 | 0h | 90% | 94% | 95% |

**Key Stats:**
- **96% stopped** at 1.0x (50% below 2x)
- **4% end_of_data** with **1470% EV**
- **Overall EV: -12.5%** (at 48h)

---

### Trailing 15% / 50%

**Exit Multiple by Time Window:**

| Window | Trades | Mean Exit | Median Exit | EV% |
|--------|--------|-----------|-------------|-----|
| 2h | 1435 | 1.04x | 0.94x | **+3.9%** ✅ |
| 4h | 1463 | 1.04x | 0.94x | +3.7% |
| 6h | 1474 | 1.04x | 0.94x | +3.7% |
| 12h | 1495 | 1.04x | 0.94x | +3.7% |
| 24h | 1510 | 1.04x | 0.94x | +3.7% |
| 48h | 1516 | 1.04x | 0.94x | **+3.7%** ✅ |

**Cohort Breakdown:**

| Cohort | N | Median Time | ≤2h | ≤6h | ≤12h |
|--------|---|-------------|-----|-----|------|
| ≥10x | 4 | 0h | 100% | 100% | 100% |
| 5x-10x | 6 | 0h | 100% | 100% | 100% |
| 4x-5x | 2 | 0h | 100% | 100% | 100% |
| 2x-3x | 30 | 0h | 100% | 100% | 100% |
| <2x | 1498 | 0h | 93% | 96% | 97% |

**Key Stats:**
- **98% stopped** (trailing stop catches up fast)
- **2% end_of_data** with **-0.3% EV** (no benefit!)
- **Overall EV: +3.7%** ✅ (positive!)

---

## Critical Insights

### 1. Trailing Stops Are MUCH Better

**Static 15%/50%:**
- EV: **-12.5%** ❌
- Most trades hit stop at 1.0x (50% below 2x)
- Median exit: 0.85x

**Trailing 15%/50%:**
- EV: **+3.7%** ✅ (16.2% better!)
- Stop trails with price
- Median exit: 0.94x

**Why?** Trailing stops lock in gains as price rises, while static stops stay at 1.0x.

### 2. Time Windows Don't Matter Much for Trailing

**Static:** EV improves from -13.7% (2h) to -12.5% (48h) as more "end_of_data" trades are captured.

**Trailing:** EV stays flat at ~3.7% across all time windows. Why?
- Trailing stop catches up to price quickly
- 98% of trades hit stop within 48h
- Very few "end_of_data" trades (2% vs 4% for static)
- Those that reach end_of_data have -0.3% EV (no benefit!)

### 3. Winners Exit Fast with Trailing Stops

**Static 15%/50%:**
- 10x+ cohort: Median 8.9h, only 60% exit by 12h
- These are the "end_of_data" moonshots

**Trailing 15%/50%:**
- ALL winners (≥3x) exit within 2h!
- 100% exit by 2h, 6h, 12h
- Trailing stop catches them on the way down

### 4. The "End of Data" Paradox

**Static stops:**
- 4% reach end_of_data
- These have +1470% EV
- BUT: Overall EV is still -12.5%
- **Conclusion:** The 96% that hit stop drag down overall performance

**Trailing stops:**
- 2% reach end_of_data
- These have -0.3% EV (no benefit!)
- Overall EV is +3.7%
- **Conclusion:** Trailing stop is doing its job - locking in gains

---

## Strategic Implications

### 1. Use Trailing Stops, Not Static

**Evidence:**
- Trailing 15%/50%: **+3.7% EV** ✅
- Static 15%/50%: **-12.5% EV** ❌
- **16.2% difference!**

**Why trailing wins:**
- Locks in gains as price rises
- Protects against round-trips
- Median exit 0.94x vs 0.85x

### 2. Time Windows Don't Add Much Value (for Trailing)

**Observation:** EV is ~3.7% at 2h, 6h, 12h, 24h, 48h.

**Implication:** 
- Can exit at 2h with same EV as 48h
- Faster capital turnover
- More opportunities per day

**Recommendation:**
- Use **2-6h time window** with trailing stops
- Get same EV with 8x faster turnover
- Compound gains more frequently

### 3. The 10x+ Cohort Needs Special Treatment

**Static stops:**
- 10x+ trades take 8.9h median
- Only 60% exit by 12h
- These are the moonshots worth waiting for

**Trailing stops:**
- 10x+ trades exit immediately (0h median)
- Trailing stop catches them on first retrace
- Missing potential upside?

**Hybrid approach:**
- Use **wider trailing stop for 10x+ targets** (e.g., 60-70%)
- Or use **profit target at 10x** (exit early, don't wait for stop)
- Or use **time-based exit at 12-24h** (let it run)

### 4. Optimal Strategy (Based on This Data)

**For most trades (aim for 2-5x):**
- **Trailing 15%/50%** stop
- **2-6h time window**
- **EV: +3.7%**
- **Fast turnover**

**For moonshot hunting (aim for 10x+):**
- **Trailing 15%/70%** stop (wider phase 2)
- **12-24h time window**
- **10x profit target** (exit early)
- **Let winners run**

---

## Comparison Table

| Strategy | Stop Type | Phase1 | Phase2 | Time Window | Mean Exit | Median Exit | EV% | Best For |
|----------|-----------|--------|--------|-------------|-----------|-------------|-----|----------|
| **Conservative** | Trailing | 15% | 50% | 2-6h | 1.04x | 0.94x | **+3.7%** ✅ | Consistent gains |
| **Balanced** | Trailing | 15% | 60% | 6-12h | TBD | TBD | TBD | Balance |
| **Aggressive** | Trailing | 15% | 70% | 12-24h | TBD | TBD | TBD | Moonshot hunting |
| **Static (avoid)** | Static | 15% | 50% | 48h | 0.88x | 0.85x | **-12.5%** ❌ | Don't use |

---

## Next Steps

### 1. Test More Trailing Stop Configurations

**Phase 2 variations:**
- 15%/40% (tighter)
- 15%/60% (wider)
- 15%/70% (moonshot mode)

**Expected results:**
- Tighter stops: Higher win rate, lower EV per win
- Wider stops: Lower win rate, higher EV per win
- Find optimal balance

### 2. Test Time Windows with Trailing Stops

**Hypothesis:** Shorter time windows (2-6h) have same EV but faster turnover.

**Test:**
- Force exit at 2h, 4h, 6h, 12h
- Compare EV and capital efficiency
- Find optimal time/EV trade-off

### 3. Test Hybrid Strategies

**Strategy 1: Time + Trailing Stop**
- Primary: 6h time limit
- Secondary: 50% trailing stop
- Exit on whichever first

**Strategy 2: Profit Target + Trailing Stop**
- Primary: 10x profit target
- Secondary: 50% trailing stop
- Exit on whichever first

**Strategy 3: Phased Stops**
- Phase 1 (entry→2x): 15% trailing, 12h limit
- Phase 2 (2x→exit): 60% trailing, 24h limit
- Tighter in phase 1, wider in phase 2

### 4. Per-Caller Optimization

**Question:** Do different callers need different strategies?

**Test:**
- Run analysis per caller
- Find optimal stop % and time window
- Create caller-specific recommendations

---

## Conclusion

**Key Finding:** Trailing stops with 15%/50% have **+3.7% EV** vs **-12.5% EV** for static stops.

**Recommendation:**
1. **Always use trailing stops** (not static)
2. **15%/50% is a good baseline** (positive EV)
3. **2-6h time window** (same EV, faster turnover)
4. **Test wider stops** (60-70%) for moonshot hunting

**Next action:** Run full simulation with trailing stops at different percentages (40%, 50%, 60%, 70%) and time windows (2h, 6h, 12h, 24h) to find optimal configuration.

The data is clear: **Trailing stops + short time windows = winning strategy**. 🚀

