/**
 * Call Data Loader
 * ================
 * Load call performance data from Postgres.
 * Enrich with ATH from OHLCV cache.
 */
import type { CallPerformance } from './types';
/**
 * Load calls from Postgres alerts table
 * Joins with tokens and callers for full context
 */
export declare function loadCallsFromCallerDb(): Promise<CallPerformance[]>;
/**
 * Enrich calls with ATH from OHLCV cache
 */
export declare function enrichCallsWithSimResults(
  calls: CallPerformance[]
): Promise<CallPerformance[]>;
/**
 * Load and populate metrics engine from databases
 */
export declare function loadMetricsFromDatabases(): Promise<void>;
/**
 * Calculate ATH from OHLCV candles
 */
export declare function calculateAthFromCandles(
  entryPrice: number,
  entryTimestamp: number,
  candles: Array<{
    timestamp: number;
    high: number;
  }>
): {
  athPrice: number;
  athMultiple: number;
  timeToAthMinutes: number;
};
/**
 * Check data coverage for alerts
 */
export declare function checkDataCoverage(): Promise<{
  totalCached: number;
  has5mData: number;
  has1mData: number;
  has52PeriodLookback: number;
  missing52PeriodLookback: number;
  noCache: number;
}>;
/**
 * Process simulation result and record call performance
 */
export declare function recordSimulationResult(
  callId: number,
  tokenAddress: string,
  tokenSymbol: string | undefined,
  callerName: string,
  chain: string,
  alertTimestamp: Date,
  entryPrice: number,
  candles: Array<{
    timestamp: number;
    high: number;
  }>
): void;
//# sourceMappingURL=loader.d.ts.map
