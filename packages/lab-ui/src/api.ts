import express from "express";
import { nanoid } from "nanoid";
import type { DuckDb } from "./db";
import { all, run } from "./db";
import { validateExitPlanJson } from "./exit-plan-schema";
import { spawnBacktest } from "./runner";

export function registerApi(app: express.Express, db: DuckDb) {
  // -----------------------------
  // Strategies
  // -----------------------------
  app.get("/api/strategies", async (_req, res) => {
    const rows = await all(db, `SELECT * FROM backtest_strategies ORDER BY created_at DESC`);
    res.json(rows);
  });

  app.post("/api/strategies", express.json(), async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const config_json = String(req.body?.config_json ?? "").trim();

    if (!name) return res.status(400).json({ error: "name required" });
    if (!config_json) return res.status(400).json({ error: "config_json required" });

    const parsed = validateExitPlanJson(config_json);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const strategy_id = nanoid(12);

    await run(
      db,
      `INSERT INTO backtest_strategies(strategy_id, name, config_json, created_at)
      VALUES (?, ?, ?, NOW())`,
      [strategy_id, name, config_json]
    );

    res.json({ strategy_id });
  });

  // -----------------------------
  // Runs
  // -----------------------------
  app.get("/api/runs", async (_req, res) => {
    const rows = await all(
      db,
      `SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT 50`
    );
    res.json(rows);
  });

  app.get("/api/runs/:runId", async (req, res) => {
    const runId = req.params.runId;
    const rows = await all(db, `SELECT * FROM backtest_runs WHERE run_id = ?`, [runId]);
    res.json(rows[0] ?? null);
  });

  app.post("/api/runs", express.json(), async (req, res) => {
    const strategy_id = String(req.body?.strategy_id ?? "").trim();
    const interval = String(req.body?.interval ?? "1m").trim();
    const from = String(req.body?.from ?? "").trim();
    const to = String(req.body?.to ?? "").trim();

    const taker_fee_bps = Number(req.body?.taker_fee_bps ?? 30);
    const slippage_bps = Number(req.body?.slippage_bps ?? 10);
    const position_usd = Number(req.body?.position_usd ?? 1000);
    const caller_filter = String(req.body?.caller_filter ?? "").trim();

    if (!strategy_id) return res.status(400).json({ error: "strategy_id required" });
    if (!from || !to) return res.status(400).json({ error: "from/to required" });

    const run_id = nanoid(12);

    const params_json = JSON.stringify({
      strategy_id,
      interval,
      from,
      to,
      taker_fee_bps,
      slippage_bps,
      position_usd,
      caller_filter,
    });

    await run(
      db,
      `INSERT INTO backtest_runs(run_id, strategy_id, status, params_json, created_at)
      VALUES (?, ?, 'queued', ?, NOW())`,
      [run_id, strategy_id, params_json]
    );

    // Spawn CLI backtest
    spawnBacktest(db, {
      run_id,
      strategy_id,
      interval,
      from,
      to,
      taker_fee_bps,
      slippage_bps,
      position_usd,
      caller_filter: caller_filter || undefined,
    }).catch(async (err) => {
      // Persist error
      await run(
        db,
        `UPDATE backtest_runs
        SET status='error', finished_at=NOW(), error_text=?
        WHERE run_id=?`,
        [String(err?.stack ?? err), run_id]
      );
    });

    res.json({ run_id });
  });

  // -----------------------------
  // Leaderboard (PnL)
  // -----------------------------
  app.get("/api/leaderboard/:runId", async (req, res) => {
    const runId = req.params.runId;

    const sql = `
      WITH base AS (
        SELECT
          caller_name,
          return_bps,
          dd_bps
        FROM backtest_call_results
        WHERE run_id = ?
      ),
      enriched AS (
        SELECT
          caller_name,
          (return_bps / 100.0) AS net_return_pct,
          CASE WHEN return_bps > 0 THEN 1 ELSE 0 END AS win,
          CASE WHEN return_bps <= 0 THEN 1 ELSE 0 END AS loss,

          dd_bps,
          CASE WHEN dd_bps < 0 THEN -dd_bps ELSE 0 END AS dd_neg_bps
        FROM base
      )
      SELECT
        caller_name,
        COUNT(*)::INT AS calls,
        SUM(net_return_pct) AS agg_pnl_pct_sum,
        AVG(net_return_pct) AS avg_pnl_pct,
        quantile_cont(net_return_pct, 0.5) AS median_pnl_pct,
        AVG(win) AS strike_rate,
        quantile_cont(dd_bps, 0.5) AS median_drawdown_bps,
        SUM(dd_neg_bps) AS total_drawdown_bps
      FROM enriched
      GROUP BY caller_name
      ORDER BY
        agg_pnl_pct_sum DESC,
        strike_rate DESC,
        median_drawdown_bps DESC NULLS LAST,
        total_drawdown_bps ASC NULLS LAST,
        calls DESC
    `;

    const rows = await all(db, sql, [runId]);
    res.json(rows);
  });

  // -----------------------------
  // Caller Path Metrics (time-to-multiples, failures, drawdown, activity)
  // -----------------------------
  app.get("/api/caller-path/:runId", async (req, res) => {
    const runId = req.params.runId;

    const sql = `
      WITH base AS (
        SELECT
          caller_name,
          return_bps,
          dd_bps,
          dd_to_2x_bps,
          hit_2x,
          hit_3x,
          hit_4x,
          t0_ms,
          t_2x_ms,
          t_3x_ms,
          t_4x_ms,
          alert_to_activity_ms,
          peak_multiple
        FROM backtest_call_results
        WHERE run_id = ?
      ),
      enriched AS (
        SELECT
          caller_name,
          (return_bps / 100.0) AS net_return_pct,
          dd_bps,
          dd_to_2x_bps,

          CASE WHEN hit_2x THEN 1 ELSE 0 END AS i2,
          CASE WHEN hit_3x THEN 1 ELSE 0 END AS i3,
          CASE WHEN hit_4x THEN 1 ELSE 0 END AS i4,

          CASE WHEN hit_2x THEN (t_2x_ms - t0_ms) / 60000.0 ELSE NULL END AS t2x_min,
          CASE WHEN hit_3x THEN (t_3x_ms - t0_ms) / 60000.0 ELSE NULL END AS t3x_min,
          CASE WHEN hit_4x THEN (t_4x_ms - t0_ms) / 60000.0 ELSE NULL END AS t4x_min,

          (alert_to_activity_ms / 1000.0) AS alert_to_activity_s,
          peak_multiple
        FROM base
      )
      SELECT
        caller_name,
        COUNT(*)::INT AS calls,

        AVG(net_return_pct) AS avg_pnl_pct,
        quantile_cont(net_return_pct, 0.5) AS median_pnl_pct,

        SUM(i2)::INT AS count_2x,
        SUM(i3)::INT AS count_3x,
        SUM(i4)::INT AS count_4x,

        (COUNT(*) - SUM(i2))::INT AS fail_2x,

        quantile_cont(t2x_min, 0.5) AS median_t2x_min,
        quantile_cont(t3x_min, 0.5) AS median_t3x_min,
        quantile_cont(t4x_min, 0.5) AS median_t4x_min,

        AVG(dd_bps) AS avg_drawdown_bps,
        AVG(dd_to_2x_bps) AS avg_drawdown_to_2x_bps,

        quantile_cont(alert_to_activity_s, 0.5) AS median_alert_to_activity_s,
        AVG(peak_multiple) AS avg_peak_multiple
      FROM enriched
      GROUP BY caller_name
      ORDER BY
        avg_pnl_pct DESC,
        count_2x DESC,
        median_t2x_min ASC NULLS LAST,
        calls DESC
    `;

    const rows = await all(db, sql, [runId]);
    res.json(rows);
  });
}
