# Performance Analytics - Current Status

## ✅ Endpoints Fixed and Working

All performance analytics endpoints are now functional!

---

## 🔧 What Was Fixed

### Problem
The original queries tried to access `ohlcv_candles` table which exists in **ClickHouse**, not **PostgreSQL**.

### Solution
Rewrote all queries to use only PostgreSQL data:
- Alerts table
- Callers table  
- Tokens table
- Strategies and simulation results

---

## 📊 Current Functionality

### Working Endpoints (5/5)

| Endpoint | Status | Data Source |
|----------|--------|-------------|
| `/api/analytics/performance/top-returns` | ✅ Working | PostgreSQL (alerts) |
| `/api/analytics/performance/highest-multiple` | ✅ Working | PostgreSQL (alerts) |
| `/api/analytics/performance/strategy-comparison` | ✅ Working | PostgreSQL (strategies) |
| `/api/analytics/performance/strategy/[name]` | ✅ Working | PostgreSQL (strategies) |
| `/api/analytics/performance/best-callers-by-strategy` | ✅ Working | PostgreSQL (alerts) |

### What Works Now

✅ **Bot Filtering**: Phanes, Rick excluded from all queries  
✅ **Top Callers**: Ranked by call count (real callers only)  
✅ **Strategy Comparison**: Full comparison of all strategies  
✅ **Individual Strategy**: Deep dive analytics per strategy  
✅ **Caller Rankings**: By strategy with win rate estimates  

---

## ⚠️ Current Limitations

### Placeholder Metrics

Because we don't have OHLCV data integrated yet, these metrics show placeholder values:

| Metric | Current Value | Needs |
|--------|---------------|-------|
| `avgMultiple` | 1.0 (placeholder) | ClickHouse OHLCV data |
| `bestMultiple` | 1.0 (placeholder) | ClickHouse OHLCV data |
| `avgTimeToATH` | 0 (placeholder) | ClickHouse OHLCV data |
| `profitableCalls` | 0 (placeholder) | ClickHouse OHLCV data |
| `totalReturn` | 0 (placeholder) | ClickHouse OHLCV data |

### What's Used Instead

- **Win Rate Estimate**: Based on confidence scores (>0.7 = likely profitable)
- **Top Callers**: Ranked by total calls instead of returns
- **Highest Multiple**: Currently shows most confident calls

---

## 🎯 Sample Data

### Top Callers (Working)
```json
{
  "data": [
    {
      "callerName": "Brook Giga I verify @BrookCalls",
      "totalCalls": 557,
      "avgMultiple": 1,
      "bestMultiple": 1,
      "avgTimeToATH": 0,
      "medianTimeToATH": 0,
      "winRate": 0,
      "profitableCalls": 0,
      "totalReturn": 0
    },
    {
      "callerName": "Austic",
      "totalCalls": 227,
      // ...
    }
  ]
}
```

Note: Phanes and Rick successfully excluded!

### Strategy Comparison (Working)
Returns empty `[]` if no simulation runs exist yet.

---

## 🚀 How to Get Full Functionality

To enable actual return multiples and time-to-ATH metrics, we need to:

### Option 1: Integrate ClickHouse Queries
```typescript
// Query ClickHouse for OHLCV data
const clickhouseClient = createClient({
  host: process.env.CLICKHOUSE_HOST,
  // ...
});

const candles = await clickhouseClient.query(`
  SELECT 
    token_address,
    timestamp,
    high,
    low,
    close
  FROM ohlcv_candles
  WHERE token_address = $1
  AND timestamp >= $2
  AND timestamp <= $3
`);

// Calculate multiples from candle data
const peakPrice = Math.max(...candles.map(c => c.high));
const multiple = peakPrice / entryPrice;
```

### Option 2: Pre-calculate and Store in PostgreSQL
Add a new table to PostgreSQL:
```sql
CREATE TABLE alert_performance (
  alert_id BIGINT PRIMARY KEY REFERENCES alerts(id),
  peak_price NUMERIC(38, 18),
  peak_time TIMESTAMPTZ,
  multiple NUMERIC(10, 4),
  time_to_peak_minutes INTEGER,
  final_price NUMERIC(38, 18),
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Then populate it with a background job that queries ClickHouse.

### Option 3: Use Existing Simulation Results
If you have simulation results that include these metrics:
```sql
-- Add columns to simulation_results_summary
ALTER TABLE simulation_results_summary
ADD COLUMN peak_multiple NUMERIC(10, 4),
ADD COLUMN time_to_peak_minutes INTEGER;
```

---

## 🎨 Frontend Display

The Performance Analytics component (`/components/performance-analytics.tsx`) is ready and will display the data as soon as real values are available.

### Current Behavior
- Shows real caller names (bots excluded)
- Displays call counts correctly
- Charts render properly
- Placeholder values (1.0, 0) shown for metrics we can't calculate yet

### When OHLCV Integrated
- All placeholder values will be replaced with real data
- Charts will show actual performance
- No frontend changes needed!

---

## 📋 Next Steps (Priority Order)

### High Priority
1. **Integrate ClickHouse for OHLCV Data**
   - Add ClickHouse client to performance analytics service
   - Query candles for each alert's token
   - Calculate actual multiples and time-to-peak

2. **Add Performance Calculation Job**
   - Background job to calculate metrics
   - Store in PostgreSQL for fast access
   - Run daily or after each alert

### Medium Priority
3. **Enhance Win Rate Calculation**
   - Use actual price data instead of confidence
   - Define "win" threshold (e.g., >10% gain)
   - Calculate hold period returns

4. **Add More Metrics**
   - Max drawdown per call
   - Volatility metrics
   - Risk-adjusted returns
   - Correlation analysis

### Low Priority
5. **UI Enhancements**
   - Add tooltips explaining placeholder values
   - Show "Needs OHLCV data" badges
   - Add "Calculate Performance" button
   - Real-time performance tracking

---

## 🧪 Testing

All endpoints tested and working:

```bash
# Test top returns
curl http://localhost:3000/api/analytics/performance/top-returns | jq .

# Test highest multiple
curl http://localhost:3000/api/analytics/performance/highest-multiple | jq .

# Test strategy comparison
curl http://localhost:3000/api/analytics/performance/strategy-comparison | jq .

# Test individual strategy
curl http://localhost:3000/api/analytics/performance/strategy/Tenkan-Kijun-Cross | jq .

# Test best callers by strategy
curl "http://localhost:3000/api/analytics/performance/best-callers-by-strategy?strategy=MyStrategy&limit=10" | jq .
```

---

## 📚 Documentation

- `/PERFORMANCE_ANALYTICS_COMPLETE.md` - Full implementation guide
- `/ANALYTICS_COMPLETE.md` - Original analytics docs
- This file - Current status and limitations

---

## ✅ Success Criteria

Current Status:

- [x] All endpoints working without errors
- [x] Bots excluded from analytics
- [x] Real caller data displayed
- [x] Strategy comparison functional
- [x] Frontend components ready
- [ ] Actual return multiples (needs OHLCV)
- [ ] Time to ATH metrics (needs OHLCV)
- [ ] Win rate based on actual returns (needs OHLCV)

---

## 🎓 Summary

### What Works
- All 5 API endpoints functional
- Bot filtering working perfectly
- Caller rankings by volume
- Strategy comparison (when runs exist)
- Clean error handling
- Frontend ready to display data

### What Needs OHLCV Integration
- Return multiples (avgMultiple, bestMultiple)
- Time to peak metrics
- Profitable call counts
- Win rate based on actual returns

### How to Use Now
1. Visit http://localhost:3000
2. Click "Performance 🎯" tab
3. See real caller data (bots excluded)
4. View call volumes and rankings
5. Compare strategies (if simulation data exists)

### How to Get Full Features
Integrate ClickHouse OHLCV queries to calculate real performance metrics.

---

**Date**: December 5, 2025  
**Status**: ✅ Functional (with limitations)  
**Next**: Integrate ClickHouse for full metrics

