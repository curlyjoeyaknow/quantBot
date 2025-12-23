# Early-Abort Optimization

## Current Status

**Partial implementation**: Early-abort exists in OHLCV ingestion but not in sweep runners.

### Implemented

**OHLCV Ingestion** (`packages/jobs/src/ohlcv-ingestion-engine.ts`):
- Early exit if 1m probe returns 0 candles (for recent alerts)
- Saves ~12 API calls per token when no data exists
- Only applies to recent alerts (< 3 months)

### Missing

**Sweep Runners**:
- No early-abort when strategy is clearly failing
- Sweeps continue even if strategy shows consistent losses
- No performance-based stopping criteria

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

## Implementation Plan

1. **Phase 1**: Add early-abort config to sweep runner spec
2. **Phase 2**: Implement early-abort logic in sweep runner
3. **Phase 3**: Add metrics tracking for abort decisions
4. **Phase 4**: Document abort criteria and thresholds

## Priority

**SEVERITY 3** - Performance optimization, not blocking. Can be added incrementally.

