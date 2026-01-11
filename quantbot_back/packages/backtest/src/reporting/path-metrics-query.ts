/**
 * Path Metrics Query Service
 *
 * Query interface for path metrics (Truth Layer).
 * Provides aggregations for caller comparability.
 */

import type { PathMetricsRow, CallerTruthLeaderboardRow } from '../types.js';

// DuckDB connection type (callback-based API)
type DuckDbConnection = {
  run(sql: string, params: unknown[], callback: (err: unknown) => void): void;
  all<T = unknown>(
    sql: string,
    params: unknown[],
    callback: (err: unknown, rows: T[]) => void
  ): void;
};

function all<T>(db: DuckDbConnection, sql: string, params: unknown[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    db.all(sql, params, (err: unknown, rows: T[]) => (err ? reject(err) : resolve(rows)));
  });
}

/**
 * Get path metrics for a specific run
 */
export async function getPathMetricsByRun(
  db: DuckDbConnection,
  runId: string
): Promise<PathMetricsRow[]> {
  return all<PathMetricsRow>(
    db,
    `SELECT * FROM backtest_call_path_metrics WHERE run_id = $1 ORDER BY caller_name, call_id`,
    [runId]
  );
}

/**
 * Get path metrics for a specific caller in a run
 */
export async function getPathMetricsByCaller(
  db: DuckDbConnection,
  runId: string,
  callerName: string
): Promise<PathMetricsRow[]> {
  return all<PathMetricsRow>(
    db,
    `SELECT * FROM backtest_call_path_metrics 
     WHERE run_id = $1 AND caller_name = $2 
     ORDER BY call_id`,
    [runId, callerName]
  );
}

/**
 * Get path metrics for a specific call
 */
export async function getPathMetricsByCall(
  db: DuckDbConnection,
  runId: string,
  callId: string
): Promise<PathMetricsRow | null> {
  const rows = await all<PathMetricsRow>(
    db,
    `SELECT * FROM backtest_call_path_metrics 
     WHERE run_id = $1 AND call_id = $2`,
    [runId, callId]
  );

  return rows.length > 0 ? rows[0] : null;
}

/**
 * Aggregate path metrics by caller
 * Returns truth-only caller leaderboard (no policy data)
 *
 * This implements MVP 1 (Caller Worth Leaderboard) using only truth layer data.
 */
export async function aggregatePathMetricsByCaller(
  db: DuckDbConnection,
  runId: string | null = null,
  minCalls: number = 0
): Promise<CallerTruthLeaderboardRow[]> {
  const whereClause = runId ? 'WHERE run_id = $1' : '';
  const params = runId ? [runId, minCalls] : [minCalls];
  const minCallsParam = runId ? '$2' : '$1';

  const sql = `
    WITH base AS (
      SELECT
        caller_name,
        
        -- Hit rates (boolean to int)
        CASE WHEN hit_2x THEN 1 ELSE 0 END AS i2x,
        CASE WHEN hit_3x THEN 1 ELSE 0 END AS i3x,
        CASE WHEN hit_4x THEN 1 ELSE 0 END AS i4x,
        CASE WHEN NOT hit_2x THEN 1 ELSE 0 END AS fail_2x,
        
        -- Time metrics (ms)
        t_2x_ms,
        t_3x_ms,
        t_4x_ms,
        alert_to_activity_ms,
        alert_ts_ms,
        
        -- Peak and drawdown
        peak_multiple,
        dd_bps,
        dd_to_2x_bps,
        
        -- Slow activity (> 5 minutes = 300000 ms)
        CASE WHEN alert_to_activity_ms > 300000 OR alert_to_activity_ms IS NULL THEN 1 ELSE 0 END AS slow_activity
      FROM backtest_call_path_metrics
      ${whereClause}
    ),
    time_to_hit AS (
      SELECT
        caller_name,
        -- Convert time-to-Nx from alert_ts_ms to minutes
        (t_2x_ms - alert_ts_ms) / 60000.0 AS t2x_min,
        (t_3x_ms - alert_ts_ms) / 60000.0 AS t3x_min,
        (t_4x_ms - alert_ts_ms) / 60000.0 AS t4x_min,
        alert_to_activity_ms / 1000.0 AS activity_s
      FROM base
      WHERE t_2x_ms IS NOT NULL OR t_3x_ms IS NOT NULL OR t_4x_ms IS NOT NULL
    )
    SELECT
      caller_name,
      COUNT(*)::INT AS calls,
      
      -- Hit rates
      AVG(i2x) AS p_hit_2x,
      AVG(i3x) AS p_hit_3x,
      AVG(i4x) AS p_hit_4x,
      SUM(i2x)::INT AS count_2x,
      SUM(i3x)::INT AS count_3x,
      SUM(i4x)::INT AS count_4x,
      SUM(fail_2x)::INT AS failures_2x,
      
      -- Time metrics (from time_to_hit subquery via correlated scalar)
      (SELECT quantile_cont(t2x_min, 0.5) FROM time_to_hit t WHERE t.caller_name = base.caller_name AND t2x_min IS NOT NULL) AS median_t2x_min,
      (SELECT quantile_cont(t3x_min, 0.5) FROM time_to_hit t WHERE t.caller_name = base.caller_name AND t3x_min IS NOT NULL) AS median_t3x_min,
      (SELECT quantile_cont(t4x_min, 0.5) FROM time_to_hit t WHERE t.caller_name = base.caller_name AND t4x_min IS NOT NULL) AS median_t4x_min,
      (SELECT quantile_cont(activity_s, 0.5) FROM time_to_hit t WHERE t.caller_name = base.caller_name AND activity_s IS NOT NULL) AS median_alert_to_activity_s,
      
      -- Peak metrics
      quantile_cont(peak_multiple, 0.5) AS median_peak_multiple,
      AVG(peak_multiple) AS avg_peak_multiple,
      
      -- Drawdown metrics (bps, closer to 0 is better)
      quantile_cont(dd_bps, 0.5) AS median_dd_bps,
      quantile_cont(dd_bps, 0.95) AS p95_dd_bps,
      quantile_cont(dd_to_2x_bps, 0.5) AS median_dd_to_2x_bps,
      quantile_cont(dd_to_2x_bps, 0.95) AS p95_dd_to_2x_bps,
      
      -- Slow/no activity rate
      AVG(slow_activity) AS slow_activity_rate
      
    FROM base
    GROUP BY caller_name
    HAVING COUNT(*) >= ${minCallsParam}
    ORDER BY
      p_hit_4x DESC,
      p_hit_3x DESC,
      p_hit_2x DESC,
      median_peak_multiple DESC NULLS LAST,
      median_dd_bps DESC NULLS LAST,
      calls DESC
  `;

  return all<CallerTruthLeaderboardRow>(db, sql, params);
}

/**
 * Get summary statistics for a run
 */
export async function getRunSummary(
  db: DuckDbConnection,
  runId: string
): Promise<{
  totalCalls: number;
  uniqueCallers: number;
  hit2xCount: number;
  hit3xCount: number;
  hit4xCount: number;
  avgPeakMultiple: number | null;
  medianDrawdownBps: number | null;
}> {
  const rows = await all<{
    total_calls: number;
    unique_callers: number;
    hit_2x_count: number;
    hit_3x_count: number;
    hit_4x_count: number;
    avg_peak_multiple: number | null;
    median_dd_bps: number | null;
  }>(
    db,
    `
    SELECT
      COUNT(*)::INT AS total_calls,
      COUNT(DISTINCT caller_name)::INT AS unique_callers,
      SUM(CASE WHEN hit_2x THEN 1 ELSE 0 END)::INT AS hit_2x_count,
      SUM(CASE WHEN hit_3x THEN 1 ELSE 0 END)::INT AS hit_3x_count,
      SUM(CASE WHEN hit_4x THEN 1 ELSE 0 END)::INT AS hit_4x_count,
      AVG(peak_multiple) AS avg_peak_multiple,
      quantile_cont(dd_bps, 0.5) AS median_dd_bps
    FROM backtest_call_path_metrics
    WHERE run_id = $1
    `,
    [runId]
  );

  if (rows.length === 0) {
    return {
      totalCalls: 0,
      uniqueCallers: 0,
      hit2xCount: 0,
      hit3xCount: 0,
      hit4xCount: 0,
      avgPeakMultiple: null,
      medianDrawdownBps: null,
    };
  }

  const row = rows[0];
  return {
    totalCalls: row.total_calls,
    uniqueCallers: row.unique_callers,
    hit2xCount: row.hit_2x_count,
    hit3xCount: row.hit_3x_count,
    hit4xCount: row.hit_4x_count,
    avgPeakMultiple: row.avg_peak_multiple,
    medianDrawdownBps: row.median_dd_bps,
  };
}
