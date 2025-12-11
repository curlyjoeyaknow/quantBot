# InfluxDB Setup Required for Performance Analytics

## Current Status

✅ **Endpoints Working**: All 5 performance analytics endpoints are operational  
✅ **Database Connection**: InfluxDB container is running  
⚠️ **Missing Data**: InfluxDB needs authentication and OHLCV data

## Why Performance Analytics Show Empty Results

The performance analytics calculate **real return multiples** from OHLCV (price candle) data stored in InfluxDB. Currently:

1. InfluxDB is running but not properly authenticated
2. Need to configure: `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET`
3. OHLCV data may not be ingested yet

## How to Fix

### Option 1: Use Existing InfluxDB Data (If Available)

If you have an existing InfluxDB setup with data:

1. **Find your InfluxDB token**:
   ```bash
   # Check existing InfluxDB setup
   docker exec quantbot_influxdb_temp influx auth list
   ```

2. **Update `.env` file**:
   ```env
   INFLUX_URL=http://localhost:8086
   INFLUX_TOKEN=your-actual-token-here
   INFLUX_ORG=quantbot
   INFLUX_BUCKET=ohlcv_data
   ```

3. **Restart the web dashboard**:
   ```bash
   cd packages/web
   # Restart Next.js dev server
   ```

### Option 2: Set Up Fresh InfluxDB

If you need to set up InfluxDB from scratch:

1. **Access InfluxDB UI**:
   - Open http://localhost:8086
   - Complete the initial setup wizard
   - Create organization: `quantbot`
   - Create bucket: `ohlcv_data`
   - Save the generated token

2. **Update `.env` with the token**

3. **Ingest OHLCV Data**:
   ```bash
   # Run your data ingestion service
   # This will populate InfluxDB with price candles
   ```

### Option 3: Use Sample/Test Data

For testing without real OHLCV data:

```typescript
// The endpoints will return empty arrays
// which is expected behavior when no OHLCV data exists
```

## What Works Right Now

Even without OHLCV data, you can use:

✅ **Core Analytics** (Analytics 📊 tab):
- Alert timeseries
- Top callers by volume
- Token distribution
- Hourly activity
- All work with PostgreSQL data only

✅ **Strategy Comparison** (if simulations exist):
- Strategy performance metrics
- Based on simulation results in PostgreSQL

❌ **Performance Metrics** (require OHLCV):
- Top callers by return multiple
- Highest multiple calls  
- Time to ATH
- Real win rates

## Architecture

```
Performance Analytics Flow:
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│ PostgreSQL  │────▶│  Get Alerts  │────▶│  InfluxDB      │
│ (Metadata)  │     │  with Prices │     │  (OHLCV Data)  │
└─────────────┘     └──────────────┘     └────────────────┘
                            │                      │
                            │                      │
                            ▼                      ▼
                    ┌────────────────────────────────┐
                    │   Performance Calculator       │
                    │   - Peak Price Detection       │
                    │   - Multiple Calculation       │
                    │   - Time to ATH               │
                    └────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────────────┐
                    │   Dashboard Display            │
                    │   - Top Returns                │
                    │   - Highest Multiples          │
                    │   - Strategy Comparison        │
                    └────────────────────────────────┘
```

## Files Updated

All performance analytics code is ready and waiting for OHLCV data:

- ✅ `lib/services/performance-analytics-service.ts` - Main service
- ✅ `lib/services/performance-calculator.ts` - InfluxDB integration
- ✅ `lib/db/influxdb-manager.ts` - Database client
- ✅ `app/api/analytics/performance/*` - 5 API endpoints
- ✅ `components/performance-analytics.tsx` - Frontend component

## Next Steps

1. **Set up InfluxDB authentication** (see Option 1 or 2 above)
2. **Ingest OHLCV data** from your price feeds
3. **Refresh the dashboard** - metrics will populate automatically

Once OHLCV data is available, the performance analytics will show:
- Real return multiples (e.g., "davinch avg: 3.45x, best: 127.8x")
- Time to peak for each call
- Win rates based on actual profitability
- Highest performing calls of all time

---

**Current Status**: Infrastructure ready, waiting for OHLCV data 🎯

