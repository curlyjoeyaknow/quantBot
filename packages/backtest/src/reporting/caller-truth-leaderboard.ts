/**
 * Caller Truth Leaderboard (Phase 3 - MVP 1)
 *
 * Generate caller leaderboards from path metrics only (truth layer).
 * No policy data - pure signal quality assessment.
 *
 * Metrics:
 * - Hit rates: 2x/3x/4x probability
 * - Time to target: median time-to-2x/3x/4x
 * - Downside profile: median/p95 drawdown
 * - Activity: time to first meaningful move
 * - Failure rate: calls that never hit 2x
 */

import type { CallerTruthLeaderboardRow } from '../types.js';
import { aggregatePathMetricsByCaller, getRunSummary } from './path-metrics-query.js';

// DuckDB connection type (callback-based API)
type DuckDbConnection = {
  run(sql: string, params: unknown[], callback: (err: unknown) => void): void;
  all<T = unknown>(
    sql: string,
    params: unknown[],
    callback: (err: unknown, rows: T[]) => void
  ): void;
};

/**
 * Get caller truth leaderboard for a specific run
 *
 * @param db DuckDB connection
 * @param runId Backtest run ID
 * @param minCalls Minimum number of calls to include caller (default: 0)
 * @returns Array of CallerTruthLeaderboardRow sorted by 4x→3x→2x hit rates
 */
export async function getCallerTruthLeaderboard(
  db: DuckDbConnection,
  runId: string,
  minCalls: number = 0
): Promise<CallerTruthLeaderboardRow[]> {
  return aggregatePathMetricsByCaller(db, runId, minCalls);
}

/**
 * Get caller truth leaderboard across all runs
 *
 * @param db DuckDB connection
 * @param minCalls Minimum number of calls to include caller (default: 0)
 * @returns Array of CallerTruthLeaderboardRow aggregated across all runs
 */
export async function getCallerTruthLeaderboardAllRuns(
  db: DuckDbConnection,
  minCalls: number = 0
): Promise<CallerTruthLeaderboardRow[]> {
  return aggregatePathMetricsByCaller(db, null, minCalls);
}

/**
 * Get summary statistics for a truth run
 */
export async function getTruthRunSummary(
  db: DuckDbConnection,
  runId: string
): Promise<{
  totalCalls: number;
  uniqueCallers: number;
  hit2xCount: number;
  hit3xCount: number;
  hit4xCount: number;
  hit2xRate: number;
  hit3xRate: number;
  hit4xRate: number;
  avgPeakMultiple: number | null;
  medianDrawdownBps: number | null;
}> {
  const summary = await getRunSummary(db, runId);

  return {
    ...summary,
    hit2xRate: summary.totalCalls > 0 ? summary.hit2xCount / summary.totalCalls : 0,
    hit3xRate: summary.totalCalls > 0 ? summary.hit3xCount / summary.totalCalls : 0,
    hit4xRate: summary.totalCalls > 0 ? summary.hit4xCount / summary.totalCalls : 0,
  };
}

/**
 * Format leaderboard for display
 */
export function formatLeaderboardForDisplay(
  rows: CallerTruthLeaderboardRow[]
): Array<Record<string, string | number>> {
  return rows.map((row) => ({
    caller: row.caller_name,
    calls: row.calls,
    // Hit rates as percentages
    '2x_rate': (row.p_hit_2x * 100).toFixed(1) + '%',
    '3x_rate': (row.p_hit_3x * 100).toFixed(1) + '%',
    '4x_rate': (row.p_hit_4x * 100).toFixed(1) + '%',
    // Counts
    '2x_count': row.count_2x,
    '3x_count': row.count_3x,
    '4x_count': row.count_4x,
    failures: row.failures_2x,
    // Time metrics
    t2x_min: row.median_t2x_min?.toFixed(1) ?? '-',
    t3x_min: row.median_t3x_min?.toFixed(1) ?? '-',
    t4x_min: row.median_t4x_min?.toFixed(1) ?? '-',
    // Peak
    peak: row.median_peak_multiple?.toFixed(2) ?? '-',
    // Drawdown
    dd_bps: row.median_dd_bps?.toFixed(0) ?? '-',
    dd_p95: row.p95_dd_bps?.toFixed(0) ?? '-',
    // Slow rate
    slow: ((row.slow_activity_rate ?? 0) * 100).toFixed(0) + '%',
  }));
}
