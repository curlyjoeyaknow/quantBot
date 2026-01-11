# Early-Abort Optimization

## Current Status

**✅ FULLY IMPLEMENTED**: Early-abort exists in both OHLCV ingestion and sweep runners.

### Implemented

**OHLCV Ingestion** (`packages/jobs/src/ohlcv-ingestion-engine.ts`):
- Early exit if 1m probe returns 0 candles (for recent alerts)
- Saves ~12 API calls per token when no data exists
- Only applies to recent alerts (< 3 months)

**Sweep Runners** (`packages/workflows/src/research/experiment-runner.ts`):
- ✅ Early-abort when strategy is clearly failing
- ✅ Performance-based stopping criteria
- ✅ Configurable thresholds for win rate, average return, max drawdown, profitable runs
- ✅ Metrics tracking for abort decisions

## Proposed Implementation

### Sweep Runner Early-Abort

Add early-abort criteria to sweep runners:

```typescript
interface EarlyAbortConfig {
  /** Stop if win rate below threshold after N runs */
  minWinRate?: { threshold: number; afterRuns: number };
  /** Stop if average return below threshold after N runs */
  minAvgReturn?: { threshold: number; afterRuns: number };
  /** Stop if max drawdown exceeds threshold */
  maxDrawdown?: number;
  /** Stop if no profitable runs after N attempts */
  minProfitableRuns?: { count: number; afterRuns: number };
}
```

### Benefits

- Faster iteration on failing strategies
- Reduced compute costs
- Better resource utilization

## Implementation

**Location**: `packages/workflows/src/research/experiment-runner.ts`

**Features**:
- `EarlyAbortConfig` interface with configurable thresholds
- Integrated into `ParameterSweepRequest` and `BatchSimulationRequest`
- `checkEarlyAbort()` function evaluates metrics after each batch
- Aborts early if any criteria are met
- Returns abort reason and metrics in `BatchSimulationResult`

**Usage Example**:
```typescript
const sweep: ParameterSweepRequest = {
  baseRequest: { /* ... */ },
  parameters: [ /* ... */ ],
  earlyAbort: {
    minWinRate: { threshold: 0.3, afterRuns: 10 },
    minAvgReturn: { threshold: 0.95, afterRuns: 10 },
    maxDrawdown: { threshold: 0.2, afterRuns: 5 },
    minProfitableRuns: { count: 2, afterRuns: 10 },
  },
};
```

## Status

**✅ COMPLETE** - Early-abort optimization is fully implemented and ready for use.

