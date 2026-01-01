// DuckDB connection type (callback-based API)
type DuckDbConnection = {
  all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void;
};

type CallerPathRow = {
  caller_name: string;

  calls: number;

  count_2x: number;
  count_3x: number;
  count_4x: number;

  failures_2x: number; // did not hit 2x within window

  p_hit_2x: number;
  p_hit_3x: number;
  p_hit_4x: number;

  median_t2x_min: number | null;
  median_t3x_min: number | null;
  median_t4x_min: number | null;

  avg_dd_bps: number | null;
  avg_dd_to_2x_bps: number | null;

  median_alert_to_activity_s: number | null;

  avg_peak_multiple: number | null;
};

function all<T>(db: DuckDbConnection, sql: string, params: any[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    db.all(sql, params, (err: any, rows: T[]) => (err ? reject(err) : resolve(rows)));
  });
}

export async function getCallerPathReport(
  db: DuckDbConnection,
  runId: string
): Promise<CallerPathRow[]> {
  const sql = `
    WITH base AS (
      SELECT
        caller_name,

        hit_2x,
        hit_3x,
        hit_4x,

        t_2x_ms,
        t_3x_ms,
        t_4x_ms,
        t0_ms,

        dd_bps,
        dd_to_2x_bps,
        alert_to_activity_ms,
        peak_multiple
      FROM backtest_call_results
      WHERE run_id = $1
    ),
    enriched AS (
      SELECT
        caller_name,

        CAST(hit_2x AS INTEGER) AS i2,
        CAST(hit_3x AS INTEGER) AS i3,
        CAST(hit_4x AS INTEGER) AS i4,

        CASE WHEN hit_2x THEN (t_2x_ms - t0_ms) / 60000.0 ELSE NULL END AS t2_min,
        CASE WHEN hit_3x THEN (t_3x_ms - t0_ms) / 60000.0 ELSE NULL END AS t3_min,
        CASE WHEN hit_4x THEN (t_4x_ms - t0_ms) / 60000.0 ELSE NULL END AS t4_min,

        dd_bps,
        dd_to_2x_bps,
        CASE WHEN alert_to_activity_ms IS NOT NULL THEN alert_to_activity_ms / 1000.0 ELSE NULL END AS activity_s,
        peak_multiple
      FROM base
    )
    SELECT
      caller_name,
      COUNT(*)::INT AS calls,

      SUM(i2)::INT AS count_2x,
      SUM(i3)::INT AS count_3x,
      SUM(i4)::INT AS count_4x,

      SUM(CASE WHEN i2 = 0 THEN 1 ELSE 0 END)::INT AS failures_2x,

      AVG(i2) AS p_hit_2x,
      AVG(i3) AS p_hit_3x,
      AVG(i4) AS p_hit_4x,

      quantile_cont(t2_min, 0.5) AS median_t2x_min,
      quantile_cont(t3_min, 0.5) AS median_t3x_min,
      quantile_cont(t4_min, 0.5) AS median_t4x_min,

      AVG(dd_bps) AS avg_dd_bps,
      AVG(dd_to_2x_bps) AS avg_dd_to_2x_bps,

      quantile_cont(activity_s, 0.5) AS median_alert_to_activity_s,

      AVG(peak_multiple) AS avg_peak_multiple
    FROM enriched
    GROUP BY caller_name
    ORDER BY count_4x DESC, count_3x DESC, count_2x DESC, calls DESC
  `;

  return all<CallerPathRow>(db, sql, [runId]);
}
