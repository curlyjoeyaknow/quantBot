# @quantbot/analytics

Historical analytics and performance metrics for QuantBot trading calls.

## Overview

This package provides **historical analysis** of trading calls:
- Call performance metrics
- Caller statistics (win rates, ATH multiples, ATL multiples)
- ATH/ATL distributions
- Dashboard summaries

**Note:** 
- For live token monitoring, see `@quantbot/monitoring`.
- ATH/ATL metrics are pre-calculated during OHLCV ingestion and stored in the alerts table. The analytics engine reads these values directly (no recalculation needed unless `enrichWithAth: true` is used as a fallback).

## Core Components

### Analytics Engine

Main entry point for analytics:

```typescript
import { getAnalyticsEngine } from '@quantbot/analytics';

const engine = getAnalyticsEngine();
await engine.initialize();

// Analyze all calls
// enrichWithAth: false (default) - reads ATH/ATL from alerts table (pre-calculated during ingestion)
// enrichWithAth: true - fallback: recalculates ATH/ATL from candles if missing
const result = await engine.analyzeCalls({
  from: new Date('2024-01-01'),
  to: new Date('2024-12-31'),
  enrichWithAth: false, // Use pre-calculated values from alerts table
});

console.log(`Total calls: ${result.metadata.totalCalls}`);
console.log(`Top caller: ${result.callerMetrics[0]?.callerName}`);
```

### Usage Examples

#### Get Caller Metrics

```typescript
const metrics = await engine.getCallerMetrics('Brook', {
  from: new Date('2024-01-01'),
});

console.log(`Win rate: ${metrics?.winRate * 100}%`);
console.log(`Avg multiple: ${metrics?.avgMultiple}x`);
```

#### Get ATH Distribution

```typescript
const distribution = await engine.getAthDistribution({
  callerNames: ['Brook'],
});

distribution.forEach(bucket => {
  console.log(`${bucket.bucket}: ${bucket.count} calls (${bucket.percentage.toFixed(1)}%)`);
});
```

#### Get Dashboard Summary

```typescript
const dashboard = await engine.getDashboard({
  from: new Date('2024-01-01'),
});

console.log(`Total calls: ${dashboard.system.totalCalls}`);
console.log(`Top callers: ${dashboard.topCallers.length}`);
```

## Package Structure

```
packages/analytics/
├── engine/
│   └── AnalyticsEngine.ts      ← Core orchestration
├── loaders/
│   └── CallDataLoader.ts       ← Loads calls from database
├── aggregators/
│   └── MetricsAggregator.ts    ← Calculates metrics
└── types.ts                     ← Type definitions
```

## Related Packages

- **@quantbot/monitoring** - Live token monitoring
- **@quantbot/observability** - System health monitoring

