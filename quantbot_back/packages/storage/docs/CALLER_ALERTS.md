# Caller Alerts with Performance Metrics

## Overview

The Storage Engine now supports storing and tracking caller alerts with comprehensive performance metrics:
- **Initial Market Cap** - Market cap at alert time
- **Initial Price** - Price at alert time (for performance calculations)
- **Time to ATH** - Seconds from alert to all-time high
- **Max ROI** - Maximum ROI percentage achieved
- **ATH Price** - All-time high price after alert
- **ATH Timestamp** - When all-time high was reached
- **ATL Price** - All-time low price (from alert until ATH)
- **ATL Timestamp** - When all-time low was reached

## Database Schema

The `alerts` table has been extended with the following columns:

```sql
initial_mcap NUMERIC(38, 18)      -- Market cap at alert time
initial_price NUMERIC(38, 18)     -- Price at alert time (for performance calculations)
time_to_ath INTEGER              -- Seconds from alert to all-time high
max_roi NUMERIC(10, 6)           -- Maximum ROI percentage
ath_price NUMERIC(38, 18)        -- All-time high price
ath_timestamp TIMESTAMPTZ        -- Timestamp of all-time high
atl_price NUMERIC(38, 18)        -- All-time low price (from alert until ATH)
atl_timestamp TIMESTAMPTZ        -- Timestamp of all-time low
```

## Usage

### Storing a Caller Alert

```typescript
import { getStorageEngine } from '@quantbot/storage';
import { DateTime } from 'luxon';

const engine = getStorageEngine();

// Store alert with initial mcap and price
const alertId = await engine.storeCallerAlert(
  '7pXs...pump', // Full mint address
  'solana',
  callerId, // Caller ID from callers table
  DateTime.now(), // Alert timestamp
  {
    alertPrice: 0.001,
    initialMcap: 100000, // Market cap at alert time
    initialPrice: 0.001, // Price at alert time (for calculations)
    confidence: 0.8,
    chatId: '123456',
    messageId: '789',
    messageText: 'New call!',
  }
);
```

### Updating Performance Metrics

After calculating performance metrics, update the alert:

```typescript
// Calculate metrics from candles/price data
const timeToATH = 3600; // 1 hour in seconds
const maxROI = 150.5; // 150.5% ROI
const athPrice = 0.0025; // All-time high price
const athTimestamp = DateTime.now().plus({ hours: 1 });
const atlPrice = 0.0008; // All-time low price (from alert until ATH)
const atlTimestamp = DateTime.now().plus({ minutes: 15 });

// Update alert with calculated metrics
await engine.updateCallerAlertMetrics(alertId, {
  timeToATH,
  maxROI,
  athPrice,
  athTimestamp,
  atlPrice,
  atlTimestamp,
});
```

### Retrieving Caller Alerts with Metrics

```typescript
// Get all alerts for a caller
const alerts = await engine.getCallerAlerts(callerId, {
  from: DateTime.now().minus({ days: 30 }),
  to: DateTime.now(),
  limit: 100,
});

// Each alert includes:
alerts.forEach(alert => {
  console.log('Alert:', alert.id);
  console.log('Initial MCAP:', alert.initialMcap);
  console.log('Initial Price:', alert.initialPrice);
  console.log('Time to ATH:', alert.timeToATH, 'seconds');
  console.log('Max ROI:', alert.maxROI, '%');
  console.log('ATH Price:', alert.athPrice);
  console.log('ATH Timestamp:', alert.athTimestamp?.toISO());
  console.log('ATL Price:', alert.atlPrice);
  console.log('ATL Timestamp:', alert.atlTimestamp?.toISO());
});
```

## Performance Calculations

With `initialPrice` and `initialMcap` stored, you can easily calculate:

### ROI Calculation
```typescript
const roi = ((athPrice - initialPrice) / initialPrice) * 100;
// Or use stored maxROI
```

### MCAP Multiple
```typescript
const mcapMultiple = athMcap / initialMcap;
// Or calculate: mcapMultiple = (athPrice / initialPrice) * (supply stays constant)
```

### Price Multiple
```typescript
const priceMultiple = athPrice / initialPrice;
```

### ATL Multiple (Drawdown)
```typescript
const atlMultiple = atlPrice / initialPrice; // Ratio of ATL to entry (0.5 = dropped to 50%)
const maxDrawdown = (1 - atlMultiple) * 100; // Maximum drawdown percentage
```

### Time-Based Metrics
```typescript
const hoursToATH = timeToATH / 3600;
const daysToATH = timeToATH / 86400;
```

## Workflow Example

```typescript
// 1. Store alert when caller makes a call
const alertId = await engine.storeCallerAlert(
  tokenAddress,
  chain,
  callerId,
  alertTime,
  {
    initialMcap: 100000,
    initialPrice: 0.001,
    alertPrice: 0.001,
  }
);

// 2. Monitor price and calculate metrics
// ... (monitoring logic) ...

// 3. When ATH is reached, update metrics (ATL is calculated from entry until ATH)
await engine.updateCallerAlertMetrics(alertId, {
  timeToATH: secondsFromAlertToATH,
  maxROI: calculatedROI,
  athPrice: allTimeHighPrice,
  athTimestamp: athTime,
  atlPrice: allTimeLowPrice, // Lowest price from entry until ATH
  atlTimestamp: atlTime,
});

// 4. Query alerts for analysis
const recentAlerts = await engine.getCallerAlerts(callerId, {
  from: DateTime.now().minus({ days: 7 }),
  limit: 50,
});

// 5. Calculate caller performance
const avgROI = recentAlerts
  .filter(a => a.maxROI !== undefined)
  .reduce((sum, a) => sum + (a.maxROI || 0), 0) / recentAlerts.length;

const avgTimeToATH = recentAlerts
  .filter(a => a.timeToATH !== undefined)
  .reduce((sum, a) => sum + (a.timeToATH || 0), 0) / recentAlerts.length;
```

## Migration

Run the migration to add the new columns:

```bash
psql $POSTGRES_URL -f scripts/migration/postgres/002_add_alert_metrics.sql
```

The migration is idempotent and safe to run multiple times.

## Benefits

1. **Performance Tracking**: Track how well callers perform over time
2. **Easy Calculations**: Initial price and mcap stored for quick ROI/multiple calculations
3. **Historical Analysis**: Query alerts by time range and analyze trends
4. **Caller Comparison**: Compare different callers' performance metrics
5. **Real-time Updates**: Update metrics as price data becomes available

## Notes

- **Initial Price**: Stored separately from `alertPrice` for clarity, but defaults to `alertPrice` if not provided
- **Mint Address Preservation**: Full addresses preserved with exact case
- **Caching**: Alert queries are cached for performance
- **Indexing**: Indexed on `caller_id` and `alert_timestamp` for fast queries

