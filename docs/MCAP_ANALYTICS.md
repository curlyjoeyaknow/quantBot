# Market Cap (MCAP) Based Analytics

## Overview

This document explains the MCAP-based analytics approach used in QuantBot. Using market cap instead of raw price provides more meaningful performance comparisons across tokens with different supplies.

## Why MCAP Instead of Price?

### The Problem with Price-Only Metrics

Consider two tokens:
- **Token A**: Price $0.001, Supply 1B tokens, MCAP $1M
- **Token B**: Price $100, Supply 10K tokens, MCAP $1M

If both double in price:
- **Token A**: $0.002 (100% gain) → MCAP $2M
- **Token B**: $200 (100% gain) → MCAP $2M

Both achieved the same **market cap multiple** (2x), but comparing raw prices ($0.002 vs $200) is meaningless.

### The Solution: MCAP-Based Multiples

By tracking market cap:
1. **Fair Comparison**: Compare tokens based on total value, not arbitrary price
2. **Real Performance**: 10x MCAP means 10x more capital in the token
3. **Meaningful Rankings**: Highest MCAP gains show real market impact

## Key Formulas

### 1. Calculate Current/Peak MCAP from Entry MCAP

```typescript
// Formula: peak_mcap = entry_mcap * (peak_price / entry_price)
const priceMultiple = peakPrice / entryPrice;
const peakMcap = entryMcap * priceMultiple;
```

**Why this works:**
- MCAP = price × supply
- Supply is constant (for most tokens)
- Therefore: current_mcap / entry_mcap = current_price / entry_price

### 2. Calculate MCAP Multiple

```typescript
// Formula: multiple = peak_mcap / entry_mcap
const multiple = peakMcap / entryMcap;

// Equivalent to:
const multiple = peakPrice / entryPrice;
```

**Note:** The MCAP multiple is mathematically equivalent to the price multiple, but the context is more meaningful.

### 3. Infer Entry MCAP from Current Data

If you only have:
- Current MCAP
- Current price
- Entry price

You can calculate entry MCAP:

```typescript
// Formula: entry_mcap = current_mcap * (entry_price / current_price)
const entryMcap = currentMcap * (entryPrice / currentPrice);
```

**Use case:** When historical MCAP data isn't stored, but you have current MCAP from API.

## Implementation

### 1. Performance Calculator

```typescript
// packages/web/lib/services/performance-calculator.ts

interface PerformanceMetrics {
  multiple: number;      // MCAP multiple (peakMcap / entryMcap)
  peakPrice: number;     // Peak price reached
  peakMcap: number;      // Calculated peak market cap
  entryMcap: number;     // Market cap at time of call
  timeToATHMinutes: number;
  peakTimestamp: Date;
}

// Calculate with MCAP
const metrics = await performanceCalculator.calculateAlertPerformance(
  tokenAddress,
  chain,
  alertTimestamp,
  entryPrice,
  entryMcap  // ← Pass entry MCAP
);
```

### 2. Analytics Scripts

```typescript
// scripts/analysis/score-and-analyze-unified-calls.ts

const returns = calculateReturns(
  callPrice,
  candles,
  callUnix,
  entryMcap  // ← Optional MCAP parameter
);

// Returns include MCAP values if entryMcap was provided:
{
  maxReturn7d: 5.2,      // Price multiple (still valid)
  maxReturn30d: 12.5,
  maxMcap7d: 520000,     // $520K peak MCAP in 7d
  maxMcap30d: 1250000,   // $1.25M peak MCAP in 30d
  // ... more fields
}
```

### 3. MCAP Calculator Utilities

```typescript
// packages/web/lib/services/mcap-calculator.ts

import { calculateMcapFromPriceChange, formatMcap } from './mcap-calculator';

// Example: Token at $0.001 with $100K MCAP, peaks at $0.010
const entryMcap = 100_000;
const peakMcap = calculateMcapFromPriceChange(100_000, 0.001, 0.010);
// Result: $1,000,000 (10x MCAP)

console.log(formatMcap(peakMcap));
// Output: "$1.00M"
```

## Data Flow

### 1. At Alert Time (Entry)

```typescript
// When a call comes in:
1. Extract token address from message
2. Fetch current price (entry price)
3. Fetch current MCAP from Birdeye API  ← Store this!
4. Save to database:
   - token_address (FULL, case-preserved)
   - entry_price
   - entry_mcap  ← Critical for analytics
   - alert_timestamp
```

### 2. During Analysis

```typescript
// When calculating performance:
1. Fetch OHLCV candles from ClickHouse
2. Find peak price in time window
3. Calculate peak MCAP:
   peakMcap = entryMcap * (peakPrice / entryPrice)
4. Calculate multiple:
   multiple = peakMcap / entryMcap
```

### 3. Display Results

```typescript
// Show both price and MCAP:
{
  "caller": "exy",
  "token": "GuhgaLx...",
  "entryMcap": "$50K",
  "peakMcap": "$5M",
  "multiple": "100x",
  "entryPrice": "$0.0001",
  "peakPrice": "$0.0100"
}
```

## Database Schema Updates

### Required: Store Entry MCAP

```sql
-- Add MCAP column to caller_alerts
ALTER TABLE caller_alerts 
ADD COLUMN entry_mcap REAL;  -- Market cap at alert time

-- Add index for analytics queries
CREATE INDEX idx_entry_mcap ON caller_alerts(entry_mcap);
```

### Optional: Store Token Metadata

```sql
-- Separate metadata table for caching
CREATE TABLE token_metadata (
  token_address TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  current_mcap REAL,
  current_price REAL,
  supply REAL,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Fetching Entry MCAP

### Option 1: Birdeye API (Recommended)

```typescript
// At time of alert, fetch MCAP from Birdeye
const metadata = await fetch(
  `https://public-api.birdeye.so/defi/v3/token/meta-data/single?address=${mintAddress}`,
  { headers: { 'X-API-KEY': BIRDEYE_API_KEY } }
);

const { mc: marketCap } = await metadata.json();

// Store this MCAP as entry_mcap
await db.run(
  'INSERT INTO caller_alerts (..., entry_mcap) VALUES (..., ?)',
  [marketCap]
);
```

### Option 2: Infer from Current Data

If entry MCAP wasn't stored:

```typescript
// Later, when analyzing:
const currentMetadata = await fetchCurrentMcap(tokenAddress);
const entryMcap = inferEntryMcap(
  currentMetadata.mcap,
  currentMetadata.price,
  entryPrice
);
```

### Option 3: Calculate from Price and Supply

```typescript
// If you have supply from token metadata:
const entryMcap = entryPrice * totalSupply;
```

## Analytics Examples

### Example 1: Find Best Calls by MCAP Multiple

```sql
-- Query highest MCAP multiples (requires calculation)
SELECT 
  caller_name,
  token_address,
  entry_mcap,
  entry_price,
  -- Calculate peak MCAP (would be done in application)
  (peak_price / entry_price) * entry_mcap as peak_mcap,
  (peak_price / entry_price) as mcap_multiple
FROM caller_alerts
WHERE entry_mcap IS NOT NULL
ORDER BY mcap_multiple DESC
LIMIT 10;
```

### Example 2: Compare Callers by Average MCAP Growth

```typescript
// TypeScript example
const callerStats = await db.query(`
  SELECT 
    caller_name,
    AVG(entry_mcap) as avg_entry_mcap,
    COUNT(*) as total_calls
  FROM caller_alerts
  WHERE entry_mcap IS NOT NULL
  GROUP BY caller_name
`);

// Calculate average peak MCAP for each caller
for (const caller of callerStats) {
  const alerts = await getCallerAlerts(caller.caller_name);
  
  let totalMcapMultiple = 0;
  for (const alert of alerts) {
    const peakMcap = await calculatePeakMcap(alert);
    const multiple = peakMcap / alert.entry_mcap;
    totalMcapMultiple += multiple;
  }
  
  caller.avgMcapMultiple = totalMcapMultiple / alerts.length;
}
```

## Display Format Examples

### Compact Format
```
Entry: $50K → Peak: $5M (100x)
```

### Detailed Format
```json
{
  "entry": {
    "mcap": "$50,000",
    "price": "$0.0001",
    "timestamp": "2025-12-05T18:00:00Z"
  },
  "peak": {
    "mcap": "$5,000,000",
    "price": "$0.0100",
    "timestamp": "2025-12-06T02:30:00Z",
    "timeToATH": "510 minutes"
  },
  "multiple": "100x"
}
```

### Comparison Table
```
Caller  | Entry MCAP | Peak MCAP | Multiple | Win Rate
--------|------------|-----------|----------|----------
exy     | $45K       | $4.5M     | 100x     | 75%
Brook   | $120K      | $3.6M     | 30x      | 60%
Austic  | $80K       | $2.4M     | 30x      | 55%
```

## Benefits of MCAP-Based Analytics

1. **Fair Comparison**
   - Compare across tokens regardless of price or supply
   - $100K → $10M is 100x for any token

2. **Real Market Impact**
   - MCAP represents actual capital in the token
   - Higher MCAP = more significant market presence

3. **Better Insights**
   - Identify tokens that achieved real market growth
   - Not just price pumps on low supply tokens

4. **Caller Rankings**
   - Rank callers by their ability to spot high MCAP growth
   - More meaningful than raw price multiples

5. **Strategy Optimization**
   - Optimize for MCAP targets, not price targets
   - Example: "Exit at $1M MCAP" works across all tokens

## Migration Plan

### Phase 1: Add MCAP Storage (Current)
- ✅ Update database schema
- ✅ Fetch entry MCAP from Birdeye on new alerts
- ✅ Update performance calculator to accept entryMcap

### Phase 2: Backfill Historical Data
- Infer entry MCAP for existing calls
- Use current MCAP and price ratio
- Update all historical records

### Phase 3: Update Dashboards
- Show MCAP alongside price
- Rank by MCAP multiples
- Add MCAP filters and sorting

### Phase 4: Optimize Strategies
- Update exit strategies to use MCAP targets
- Add MCAP-based alerts
- Track MCAP velocity (MCAP growth rate)

## Testing

### Unit Tests
```typescript
describe('MCAP Calculations', () => {
  it('should calculate peak MCAP correctly', () => {
    const entryMcap = 100_000;
    const entryPrice = 0.001;
    const peakPrice = 0.010;
    
    const peakMcap = calculateMcapFromPriceChange(entryMcap, entryPrice, peakPrice);
    expect(peakMcap).toBe(1_000_000);
  });
  
  it('should infer entry MCAP from current data', () => {
    const currentMcap = 1_000_000;
    const currentPrice = 0.010;
    const entryPrice = 0.001;
    
    const entryMcap = inferEntryMcap(currentMcap, currentPrice, entryPrice);
    expect(entryMcap).toBe(100_000);
  });
});
```

## References

- **Performance Calculator**: `packages/web/lib/services/performance-calculator.ts`
- **MCAP Utilities**: `packages/web/lib/services/mcap-calculator.ts`
- **Analytics Scripts**: `scripts/analysis/score-and-analyze-unified-calls.ts`
- **Database Schema**: `packages/storage/src/caller-database.ts`

---

**Remember: Always fetch and store entry MCAP at the time of the call for accurate analytics!**

