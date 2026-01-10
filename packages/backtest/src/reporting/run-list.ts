// DuckDB connection type (callback-based API)
type DuckDbConnection = {
  all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void;
};

function all<T>(db: DuckDbConnection, sql: string, params: any[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    db.all(sql, params, (err: any, rows: T[]) => (err ? reject(err) : resolve(rows)));
  });
}

export type RunSummaryRow = {
  run_id: string;
  total_trades: number;
  total_pnl_usd: number;
  total_pnl_pct: number; // sum of return_bps / 100
  avg_return_bps: number;
  win_rate: number; // percentage of trades with positive return_bps
  max_drawdown_bps: number;
  median_drawdown_bps: number;
  total_calls: number;
  unique_callers: number;
  created_at: string | null;
};

/**
 * Get run summary aggregates from a DuckDB file
 */
export async function getRunSummary(
  db: DuckDbConnection,
  runId: string
): Promise<RunSummaryRow | null> {
  const sql = `
    SELECT
      run_id,
      COUNT(*)::INT AS total_trades,
      SUM(pnl_usd) AS total_pnl_usd,
      SUM(return_bps) / 100.0 AS total_pnl_pct,
      AVG(return_bps) AS avg_return_bps,
      AVG(CASE WHEN return_bps > 0 THEN 1.0 ELSE 0.0 END) AS win_rate,
      MIN(COALESCE(dd_bps, return_bps)) AS max_drawdown_bps,
      quantile_cont(COALESCE(dd_bps, return_bps), 0.5) AS median_drawdown_bps,
      COUNT(DISTINCT call_id) AS total_calls,
      COUNT(DISTINCT caller_name) AS unique_callers,
      MIN(created_at) AS created_at
    FROM backtest_call_results
    WHERE run_id = $1
    GROUP BY run_id
  `;

  const rows = await all<RunSummaryRow>(db, sql, [runId]);
  return rows.length > 0 ? rows[0]! : null;
}
