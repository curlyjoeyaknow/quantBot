# Period-Based ATH/ATL Metrics & Re-Entry Analysis

## Overview

The analytics package now supports period-based ATH/ATL analysis with post-ATH drawdown tracking. This enables sophisticated re-entry strategy analysis for tokens that:

1. Reach profit targets (ATH)
2. Experience drawdowns after ATH
3. Provide re-entry opportunities on retracement

## Use Cases

### Re-Entry Strategy Analysis

Analyze tokens that:

- Hit profit targets (e.g., 2x, 5x, 10x)
- Draw down after ATH (e.g., 30%, 50%, 70%)
- Recover from drawdowns (re-entry opportunities)

### Multi-Period Analysis

Compare performance across different time periods:

- 7-day period
- 14-day period
- 30-day period

## Usage

### Basic Period Analysis

```typescript
import {
  calculatePeriodAthAtlFromCandles,
  enrichCallsWithPeriodMetrics,
  analyzeReEntryOpportunities,
} from '@quantbot/analytics';
import { getStorageEngine } from '@quantbot/storage';

// Calculate period metrics for a single call
const storageEngine = getStorageEngine();
const candles = await storageEngine.getCandles(
  tokenAddress,
  'solana',
  alertTime,
  alertTime.plus({ days: 7 }),
  { interval: '5m' }
);

const periodResult = calculatePeriodAthAtlFromCandles(
  entryPrice,
  entryTimestamp,
  candles,
  undefined, // periodEndTimestamp (optional)
  20, // minDrawdownPercent (default: 20%)
  10  // minRecoveryPercent (default: 10%)
);

console.log('Period ATH:', periodResult.periodAthPrice);
console.log('Period ATL:', periodResult.periodAtlPrice);
console.log('Post-ATH Drawdown:', periodResult.postAthDrawdownPercent, '%');
console.log('Re-entry Opportunities:', periodResult.reEntryOpportunities?.length);
```

### Enrich Calls with Period Metrics

```typescript
import { enrichCallsWithPeriodMetrics } from '@quantbot/analytics';
import { CallDataLoader } from '@quantbot/analytics';

const loader = new CallDataLoader();
const calls = await loader.loadCalls({
  from: new Date('2024-01-01'),
  to: new Date('2024-01-31'),
});

// Enrich with 7-day period metrics
const enrichedCalls = await enrichCallsWithPeriodMetrics(calls, {
  periodDays: 7,
  minDrawdownPercent: 20,
  minRecoveryPercent: 10,
});

// Access period metrics
for (const call of enrichedCalls) {
  if (call.periodMetrics) {
    console.log(`Call ${call.callId}:`);
    console.log(`  Period ATH: ${call.periodMetrics.periodAthMultiple}x`);
    console.log(`  Post-ATH Drawdown: ${call.periodMetrics.postAthDrawdownPercent}%`);
    console.log(`  Re-entry Opportunities: ${call.periodMetrics.reEntryOpportunities?.length || 0}`);
  }
}
```

### Analyze Re-Entry Opportunities

```typescript
import { analyzeReEntryOpportunities } from '@quantbot/analytics';

const analysis = analyzeReEntryOpportunities(enrichedCalls);

console.log('Re-Entry Analysis:');
console.log(`  Total Calls: ${analysis.totalCalls}`);
console.log(`  Calls with Re-Entries: ${analysis.callsWithReEntries}`);
console.log(`  Total Opportunities: ${analysis.totalReEntryOpportunities}`);
console.log(`  Avg Drawdown: ${analysis.avgDrawdownPercent.toFixed(1)}%`);
console.log(`  Avg Recovery: ${analysis.avgRecoveryMultiple.toFixed(2)}x`);
console.log(`  Successful Re-Entries: ${analysis.successfulReEntries}`);
console.log(`  Failed Re-Entries: ${analysis.failedReEntries}`);
```

## Metrics Explained

### Period ATH/ATL

- **Period ATH**: Highest price reached within the analysis period
- **Period ATL**: Lowest price before period ATH (entry drawdown)
- **Time to Period ATH**: Minutes from entry to period ATH

### Post-ATH Drawdown

- **Post-ATH Drawdown Price**: Lowest price after period ATH
- **Post-ATH Drawdown Percent**: Percentage drop from ATH (e.g., 50% = dropped 50% from peak)
- **Post-ATH Drawdown Multiple**: Ratio of drawdown price to ATH (e.g., 0.5 = 50% of ATH)

### Re-Entry Opportunities

Each opportunity includes:

- **Timestamp**: When the drawdown occurred (re-entry point)
- **Price**: Price at re-entry point
- **Drawdown from ATH**: Percentage drawdown from ATH
- **Recovery Multiple**: If price recovered, the multiple from re-entry price
- **Recovery Timestamp**: When recovery occurred (if applicable)

## Strategy Examples

### Example 1: Take Profit + Re-Entry

```typescript
// Find calls that:
// 1. Hit 5x (take profit target)
// 2. Drew down 30%+ from ATH
// 3. Recovered 20%+ from drawdown (successful re-entry)

const strategyCalls = enrichedCalls.filter(call => {
  if (!call.periodMetrics) return false;
  
  const { periodAthMultiple, postAthDrawdownPercent, reEntryOpportunities } = call.periodMetrics;
  
  return (
    periodAthMultiple >= 5.0 && // Hit 5x
    (postAthDrawdownPercent || 0) >= 30 && // Drew down 30%+
    reEntryOpportunities?.some(opp => 
      opp.recoveryMultiple && opp.recoveryMultiple >= 1.2 // Recovered 20%+
    )
  );
});

console.log(`Found ${strategyCalls.length} calls matching strategy`);
```

### Example 2: Multiple Re-Entry Opportunities

```typescript
// Find calls with multiple re-entry opportunities
const multiReEntryCalls = enrichedCalls.filter(call => {
  return (call.periodMetrics?.reEntryOpportunities?.length || 0) >= 2;
});

console.log(`Found ${multiReEntryCalls.length} calls with 2+ re-entry opportunities`);
```

### Example 3: Drawdown Analysis

```typescript
// Analyze average drawdowns by ATH multiple
const drawdownByMultiple = new Map<string, number[]>();

for (const call of enrichedCalls) {
  if (!call.periodMetrics?.postAthDrawdownPercent) continue;
  
  const bucket = call.periodMetrics.periodAthMultiple >= 10 ? '10x+' :
                 call.periodMetrics.periodAthMultiple >= 5 ? '5-10x' :
                 call.periodMetrics.periodAthMultiple >= 2 ? '2-5x' : '1-2x';
  
  if (!drawdownByMultiple.has(bucket)) {
    drawdownByMultiple.set(bucket, []);
  }
  drawdownByMultiple.get(bucket)!.push(call.periodMetrics.postAthDrawdownPercent);
}

// Calculate averages
for (const [bucket, drawdowns] of drawdownByMultiple.entries()) {
  const avg = drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length;
  console.log(`${bucket}: Avg drawdown ${avg.toFixed(1)}%`);
}
```

## Configuration Options

### EnrichPeriodMetricsOptions

- **periodDays** (default: 7): Analysis period in days
- **minDrawdownPercent** (default: 20): Minimum drawdown to consider for re-entry
- **minRecoveryPercent** (default: 10): Minimum recovery to mark as successful re-entry
- **useCache** (default: true): Use cache for candle fetching

## Performance Considerations

- Period metrics are calculated on-demand (not stored in database)
- Use caching for better performance when analyzing multiple calls
- Consider batch processing for large datasets
- 5m candles are preferred for accuracy, 1m candles used as fallback

## Related Functions

- `calculatePeriodAthAtl`: Core calculation function
- `calculatePeriodAthAtlFromCandles`: Wrapper for Candle objects
- `enrichCallWithPeriodMetrics`: Enrich single call
- `enrichCallsWithPeriodMetrics`: Enrich multiple calls
- `analyzeReEntryOpportunities`: Aggregate analysis
