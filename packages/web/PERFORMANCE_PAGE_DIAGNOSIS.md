# Performance Page Diagnosis

## Status: ❌ NON-FUNCTIONAL

## Root Cause

The performance analytics page cannot display data because **alert_price is NULL** for all alerts that:
1. Have matching OHLCV data in ClickHouse
2. Have valid 2025 timestamps
3. Are within the OHLCV data timeframe (Sep-Oct 2025)

## What's Working ✅

1. **ClickHouse Database**
   - 17,998 OHLCV candles successfully loaded
   - 40 unique tokens
   - Timeframe: September-October 2025
   - Table: `ohlcv_candles`

2. **Address Matching**
   - 4 tokens matched between PostgreSQL and ClickHouse:
     - DTV (CPLTbYbt → cpltbybtdmkzthbapqddmhjxnwesceb14gm6vuodpump)
     - MRBEAST (G1DXVVmq → g1dxvvmqjs8ei79qbk41dpgk2wtxsgqltx9of7o8bags)
     - AIRI (3hAQddKZ → 3haqddkzw5trfingesjgd2zyrlovre2ro5o8xkjcbags)
     - PEPE (AKCEbMKU → akcebmkufbb8wo7n4ryqrfezt7ojkkymed2tncclbonk)

3. **Timestamp Overlap**
   - 12 alerts from 2025 for matched tokens
   - Multiple alerts fall within OHLCV timeframe

4. **Infrastructure**
   - Performance calculator: Uses ClickHouse
   - Queries: Optimized with LIKE matching
   - API routes: All created and functional

## What's Broken ❌

### Critical Issue: Missing Entry Prices

| Alert ID | Symbol  | Timestamp          | alert_price | OHLCV Data   |
|----------|---------|--------------------|-----------  |--------------|
| 13208    | AIRI    | 2025-09-27 16:01   | **NULL**    | ✅ Sep 26-30 |
| 13209    | MRBEAST | 2025-09-28 03:41   | **NULL**    | ✅ Sep 27-29 |
| 13232    | PEPE    | 2025-09-29 09:52   | **NULL**    | ✅ Available |
| 13639    | DTV     | 2025-10-18 15:10   | **NULL**    | ✅ Oct 18-20 |
| 13641    | DTV     | 2025-10-18 16:10   | **NULL**    | ✅ Oct 18-20 |
| 13655    | DTV     | 2025-10-19 00:17   | **NULL**    | ✅ Oct 18-20 |
| 13683    | DTV     | 2025-10-19 14:29   | **NULL**    | ✅ Oct 18-20 |

**Performance metrics require:**
- Entry price (alert_price)
- OHLCV data
- Timestamp

Without `alert_price`, we cannot calculate:
- Return multiple (peak_price / entry_price)
- Time to ATH
- Win rate
- Profitable calls

### Secondary Issue: Timestamp Corruption

- **Total alerts:** 14,280
- **Valid timestamps (2025):** 3,174 (22%)  
- **Corrupted timestamps (1970):** 11,106 (78%)

The SQLite → PostgreSQL migration corrupted most alert timestamps.

## Solutions

### Option 1: Fix Alert Prices (Recommended)

Re-import or manually populate `alert_price` for these 12 specific alerts:

```sql
UPDATE alerts 
SET alert_price = [correct_value]
WHERE id IN (13208, 13209, 13232, 13639, 13641, 13655, 13683);
```

### Option 2: Fetch New OHLCV Data

Get OHLCV data from Birdeye for the 6,008 alerts that DO have prices:

1. Query alerts with non-null prices
2. Fetch OHLCV for those tokens
3. Store in ClickHouse
4. Performance page will work immediately

### Option 3: Use Current Data for Testing

Create synthetic `alert_price` values for the matched tokens:

```sql
-- Set reasonable entry prices for testing
UPDATE alerts SET alert_price = 0.000023 WHERE id = 13208; -- AIRI
UPDATE alerts SET alert_price = 0.000287 WHERE id = 13209; -- MRBEAST
UPDATE alerts SET alert_price = 0.00001 WHERE id = 13232;  -- PEPE
UPDATE alerts SET alert_price = 0.00496 WHERE id IN (13639, 13641, 13655, 13683); -- DTV
```

## Files Created

- `scripts/load-ohlcv-native.sh` - Native ClickHouse CSV loader (✅ WORKING)
- `packages/web/lib/services/performance-calculator.ts` - ClickHouse integration (✅ WORKING)
- `packages/web/lib/services/performance-analytics-service.ts` - Analytics logic (✅ WORKING)
- API routes under `/app/api/analytics/performance/` (✅ WORKING)
- `components/performance-analytics.tsx` - Frontend (✅ READY)

## Current State

```
PostgreSQL Alerts (14,280)
    ↓
    ├─ 3,174 with 2025 timestamps
    │   ↓
    │   ├─ 12 match OHLCV tokens
    │   │   ↓  
    │   │   └─ ❌ ALL have NULL alert_price
    │   │
    │   └─ 6,008 with valid prices
    │       ↓
    │       └─ ❌ NO OHLCV data
    │
    └─ 11,106 with 1970 timestamps
        ↓
        └─ ❌ Corrupted data

ClickHouse OHLCV (17,998 candles)
    ↓
    └─ 4 tokens match PostgreSQL
        ↓
        └─ ✅ But no usable alerts
```

## Recommendation

**Choose Option 2:** Fetch OHLCV data for your real alerts (the 6,008 with prices).

This gives you:
- Real trading data
- Actual performance metrics
- Immediate value

The "brook" OHLCV data is test/simulation data that doesn't align with your actual trading activity.

