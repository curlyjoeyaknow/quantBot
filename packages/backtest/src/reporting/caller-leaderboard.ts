// DuckDB connection type (callback-based API)
type DuckDbConnection = {
  all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void;
};

function all<T>(db: DuckDbConnection, sql: string, params: any[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    db.all(sql, params, (err: any, rows: T[]) => (err ? reject(err) : resolve(rows)));
  });
}

export type CallerLeaderboardRow = {
  caller_name: string;

  calls: number;

  // PnL %
  agg_pnl_pct_sum: number; // SUM of per-trade net % returns
  avg_pnl_pct: number; // AVG of per-trade net % returns
  median_pnl_pct: number; // median per-trade net % return

  // Strike rate
  strike_rate: number; // win rate: return_bps > 0
  wins: number;
  losses: number;

  // Drawdown (bps, negative = drawdown)
  median_drawdown_bps: number | null; // closer to 0 is better
  avg_drawdown_bps: number | null;

  // Total drawdown (portfolio pain proxy)
  total_drawdown_bps: number | null; // sum of -dd_bps (only when negative)
  total_abs_drawdown_bps: number | null;

  // Multiples (optional context)
  count_2x: number | null;
  count_3x: number | null;
  count_4x: number | null;
};

/**
 * Leaderboard ordering:
 * 1) agg_pnl_pct_sum DESC (most aggregate net %)
 * 2) strike_rate DESC
 * 3) median_drawdown_bps DESC (less negative is better)
 * 4) total_drawdown_bps ASC (less total pain is better)
 *
 * @param db - DuckDB connection
 * @param runId - Run ID to filter by. If null, aggregates across all runs in this DB
 * @param minCalls - Minimum number of calls required to appear in leaderboard (default: 0, no filter)
 */
export async function getCallerLeaderboard(
  db: DuckDbConnection,
  runId: string | null = null,
  minCalls: number = 0
): Promise<CallerLeaderboardRow[]> {
  const sql = runId
    ? `
      WITH base AS (
        SELECT
          caller_name,
          return_bps,
          dd_bps,
          hit_2x,
          hit_3x,
          hit_4x
        FROM backtest_call_results
        WHERE run_id = $1
      ),
      enriched AS (
        SELECT
          caller_name,
          (return_bps / 100.0) AS net_return_pct,
          CASE WHEN return_bps > 0 THEN 1 ELSE 0 END AS win,
          CASE WHEN return_bps <= 0 THEN 1 ELSE 0 END AS loss,

          dd_bps,

          CASE WHEN dd_bps < 0 THEN -dd_bps ELSE 0 END AS dd_neg_bps,
          CASE WHEN dd_bps IS NOT NULL THEN ABS(dd_bps) ELSE NULL END AS dd_abs_bps,

          CASE WHEN hit_2x THEN 1 ELSE 0 END AS i2,
          CASE WHEN hit_3x THEN 1 ELSE 0 END AS i3,
          CASE WHEN hit_4x THEN 1 ELSE 0 END AS i4
        FROM base
      )
      SELECT
        caller_name,
        COUNT(*)::INT AS calls,

        -- Aggregate PnL % across all trades (sum of net % returns)
        SUM(net_return_pct) AS agg_pnl_pct_sum,
        AVG(net_return_pct) AS avg_pnl_pct,
        quantile_cont(net_return_pct, 0.5) AS median_pnl_pct,

        AVG(win) AS strike_rate,
        SUM(win)::INT AS wins,
        SUM(loss)::INT AS losses,

        quantile_cont(dd_bps, 0.5) AS median_drawdown_bps,
        AVG(dd_bps) AS avg_drawdown_bps,

        SUM(dd_neg_bps) AS total_drawdown_bps,
        AVG(dd_abs_bps) AS total_abs_drawdown_bps,

        SUM(i2)::INT AS count_2x,
        SUM(i3)::INT AS count_3x,
        SUM(i4)::INT AS count_4x
      FROM enriched
      GROUP BY caller_name
      HAVING COUNT(*) >= $2
      ORDER BY
        agg_pnl_pct_sum DESC,
        strike_rate DESC,
        median_drawdown_bps DESC NULLS LAST,
        total_drawdown_bps ASC NULLS LAST,
        calls DESC
    `
    : `
      WITH base AS (
        SELECT
          caller_name,
          return_bps,
          dd_bps,
          hit_2x,
          hit_3x,
          hit_4x
        FROM backtest_call_results
      ),
      enriched AS (
        SELECT
          caller_name,
          (return_bps / 100.0) AS net_return_pct,
          CASE WHEN return_bps > 0 THEN 1 ELSE 0 END AS win,
          CASE WHEN return_bps <= 0 THEN 1 ELSE 0 END AS loss,

          dd_bps,

          CASE WHEN dd_bps < 0 THEN -dd_bps ELSE 0 END AS dd_neg_bps,
          CASE WHEN dd_bps IS NOT NULL THEN ABS(dd_bps) ELSE NULL END AS dd_abs_bps,

          CASE WHEN hit_2x THEN 1 ELSE 0 END AS i2,
          CASE WHEN hit_3x THEN 1 ELSE 0 END AS i3,
          CASE WHEN hit_4x THEN 1 ELSE 0 END AS i4
        FROM base
      )
      SELECT
        caller_name,
        COUNT(*)::INT AS calls,

        -- Aggregate PnL % across all trades (sum of net % returns)
        SUM(net_return_pct) AS agg_pnl_pct_sum,
        AVG(net_return_pct) AS avg_pnl_pct,
        quantile_cont(net_return_pct, 0.5) AS median_pnl_pct,

        AVG(win) AS strike_rate,
        SUM(win)::INT AS wins,
        SUM(loss)::INT AS losses,

        quantile_cont(dd_bps, 0.5) AS median_drawdown_bps,
        AVG(dd_bps) AS avg_drawdown_bps,

        SUM(dd_neg_bps) AS total_drawdown_bps,
        AVG(dd_abs_bps) AS total_abs_drawdown_bps,

        SUM(i2)::INT AS count_2x,
        SUM(i3)::INT AS count_3x,
        SUM(i4)::INT AS count_4x
      FROM enriched
      GROUP BY caller_name
      HAVING COUNT(*) >= $2
      ORDER BY
        agg_pnl_pct_sum DESC,
        strike_rate DESC,
        median_drawdown_bps DESC NULLS LAST,
        total_drawdown_bps ASC NULLS LAST,
        calls DESC
    `;

  const params = runId ? [runId, minCalls] : [minCalls];
  return all<CallerLeaderboardRow>(db, sql, params);
}
