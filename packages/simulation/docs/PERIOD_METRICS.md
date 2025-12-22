# Period Metrics Integration

## Overview

The simulation package now integrates period-based ATH/ATL analysis from `@quantbot/analytics` to enable re-entry strategy analysis. This allows you to analyze tokens that:

1. Hit profit targets (ATH)
2. Experience drawdowns after ATH
3. Provide re-entry opportunities on retracement

## Configuration

Period metrics are configured in your simulation scenario:

```typescript
import { parseSimulationConfig } from '@quantbot/simulation';

const config = parseSimulationConfig({
  scenarios: [
    {
      name: 're-entry-strategy',
      data: {
        kind: 'caller',
        caller: 'brook',
        limit: 50,
      },
      strategy: [
        { target: 2.0, percent: 0.5 },
        { target: 5.0, percent: 0.3 },
        { target: 10.0, percent: 0.2 },
      ],
      // Enable period metrics
      periodMetrics: {
        enabled: true,
        periodDays: 7,              // Analyze 7-day period
        minDrawdownPercent: 20,     // Track 20%+ drawdowns
        minRecoveryPercent: 10,    // Track 10%+ recoveries
      },
    },
  ],
});
```

## Usage

### Basic Usage

Period metrics are automatically calculated when enabled in your scenario:

```typescript
import { createOrchestrator } from '@quantbot/simulation';

const orchestrator = createOrchestrator();

const summary = await orchestrator.runScenario({
  scenario: {
    name: 'test',
    strategy: [{ target: 2.0, percent: 1.0 }],
    periodMetrics: {
      enabled: true,
      periodDays: 7,
    },
  },
  targets: [
    {
      mint: 'TokenMintAddress...',
      chain: 'solana',
      startTime: DateTime.now().minus({ days: 7 }),
      endTime: DateTime.now(),
    },
  ],
});

// Access period metrics from results
for (const context of summary.results) {
  const result = context.result;
  if ('periodMetrics' in result && result.periodMetrics) {
    console.log('Period ATH:', result.periodMetrics.periodAthMultiple, 'x');
    console.log('Post-ATH Drawdown:', result.periodMetrics.postAthDrawdownPercent, '%');
    console.log('Re-entry Opportunities:', result.periodMetrics.reEntryOpportunities?.length || 0);
  }
}
```

### Programmatic Usage

You can also calculate period metrics manually:

```typescript
import {
  calculatePeriodMetricsForSimulation,
  enrichSimulationResultWithPeriodMetrics,
} from '@quantbot/simulation';

// Calculate from candles and entry price
const periodMetrics = calculatePeriodMetricsForSimulation(
  candles,
  entryPrice,
  entryTimestamp,
  {
    enabled: true,
    periodDays: 7,
    minDrawdownPercent: 20,
    minRecoveryPercent: 10,
  }
);

// Or enrich an existing simulation result
const enrichedResult = enrichSimulationResultWithPeriodMetrics(
  simulationResult,
  candles,
  {
    enabled: true,
    periodDays: 7,
  }
);
```

## Configuration Options

### PeriodMetricsConfig

- **enabled** (default: `false`): Enable period metrics calculation
- **periodDays** (default: `7`): Analysis period in days (1-90)
- **minDrawdownPercent** (default: `20`): Minimum drawdown percentage to track (0-100)
- **minRecoveryPercent** (default: `10`): Minimum recovery percentage to mark as successful re-entry (0-100)

## Metrics Available

When period metrics are enabled, `ExtendedSimulationResult` includes:

### Period ATH/ATL

- `periodAthPrice`: Highest price in the period
- `periodAthTimestamp`: When ATH was reached
- `periodAthMultiple`: ATH multiple from entry
- `timeToPeriodAthMinutes`: Time to reach ATH
- `periodAtlPrice`: Lowest price before ATH
- `periodAtlTimestamp`: When ATL was reached
- `periodAtlMultiple`: ATL multiple from entry

### Post-ATH Drawdown

- `postAthDrawdownPrice`: Lowest price after ATH
- `postAthDrawdownTimestamp`: When drawdown occurred
- `postAthDrawdownPercent`: Percentage drop from ATH
- `postAthDrawdownMultiple`: Ratio of drawdown price to ATH

### Re-Entry Opportunities

- `reEntryOpportunities`: Array of detected re-entry points
  - `timestamp`: When drawdown occurred
  - `price`: Re-entry price
  - `drawdownFromAth`: Percentage drawdown from ATH
  - `recoveryMultiple`: Recovery multiple (if recovered)
  - `recoveryTimestamp`: When recovery occurred (if applicable)

## Example: Re-Entry Strategy Analysis

```typescript
import { createOrchestrator } from '@quantbot/simulation';
import { DateTime } from 'luxon';

const orchestrator = createOrchestrator();

const summary = await orchestrator.runScenario({
  scenario: {
    name: 're-entry-analysis',
    strategy: [
      { target: 2.0, percent: 0.5 },  // Take 50% at 2x
      { target: 5.0, percent: 0.3 }, // Take 30% at 5x
      { target: 10.0, percent: 0.2 }, // Take 20% at 10x
    ],
    periodMetrics: {
      enabled: true,
      periodDays: 14,              // 14-day analysis period
      minDrawdownPercent: 30,     // Track 30%+ drawdowns
      minRecoveryPercent: 15,     // Track 15%+ recoveries
    },
  },
  targets: [
    // Your simulation targets
  ],
});

// Analyze re-entry opportunities
let totalReEntries = 0;
let successfulReEntries = 0;

for (const context of summary.results) {
  const result = context.result;
  if ('periodMetrics' in result && result.periodMetrics?.reEntryOpportunities) {
    const opportunities = result.periodMetrics.reEntryOpportunities;
    totalReEntries += opportunities.length;
    
    const successful = opportunities.filter(opp => 
      opp.recoveryMultiple && opp.recoveryMultiple >= 1.15
    ).length;
    successfulReEntries += successful;
  }
}

console.log(`Total re-entry opportunities: ${totalReEntries}`);
console.log(`Successful re-entries: ${successfulReEntries}`);
console.log(`Success rate: ${(successfulReEntries / totalReEntries * 100).toFixed(1)}%`);
```

## Integration with Simulation Config

Period metrics can be configured at the scenario level or in global defaults:

```json
{
  "version": "1",
  "global": {
    "defaults": {
      "periodMetrics": {
        "enabled": true,
        "periodDays": 7,
        "minDrawdownPercent": 20,
        "minRecoveryPercent": 10
      }
    }
  },
  "scenarios": [
    {
      "name": "my-scenario",
      "strategy": [...],
      "periodMetrics": {
        "enabled": true,
        "periodDays": 14
      }
    }
  ]
}
```

## Performance Considerations

- Period metrics are calculated after simulation completes
- Calculation is fast (O(n) where n = number of candles)
- Results are cached along with simulation results
- Enable only when needed to avoid unnecessary computation

## Related Documentation

- [Period Metrics Guide](../../analytics/docs/PERIOD_METRICS.md) - Detailed analytics documentation
- [Simulation Engine Guide](../guides/simulation-engine.md) - Core simulation documentation

