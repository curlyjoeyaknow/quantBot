import express from 'express';
import { nanoid } from 'nanoid';
import type { DuckDb } from './db.js';
import { all, run } from './db.js';
import { validateExitPlanJson } from './exit-plan-schema.js';
import { spawnBacktest } from './runner.js';

/**
 * Convert BigInt values to regular numbers and handle DuckDB timestamp types.
 * DuckDB returns BigInt for some numeric types and special objects for timestamps.
 */
function sanitizeForJson<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === 'bigint') return Number(data) as T;
  
  // Handle Date objects
  if (data instanceof Date) {
    return data.toISOString() as T;
  }
  
  if (Array.isArray(data)) return data.map(sanitizeForJson) as T;
  
  if (typeof data === 'object') {
    // Check if it's a DuckDB timestamp (has specific internal properties)
    // DuckDB timestamps may come as { days: number } or similar internal format
    const obj = data as Record<string, unknown>;
    
    // If the object has a 'days' property but no other meaningful properties,
    // it's likely a DuckDB date - convert days since epoch to ISO string
    if (Object.keys(obj).length === 1 && typeof obj.days === 'number') {
      const date = new Date(obj.days * 24 * 60 * 60 * 1000);
      return date.toISOString() as T;
    }
    
    // If the object has 'micros' property (DuckDB timestamp), convert it
    if (Object.keys(obj).length === 1 && typeof obj.micros === 'number') {
      const date = new Date(obj.micros / 1000); // micros to millis
      return date.toISOString() as T;
    }
    
    // If it's an empty object, check if the key suggests it's a timestamp
    if (Object.keys(obj).length === 0) {
      // Return null for empty objects (will be handled in client)
      return null as T;
    }
    
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeForJson(value);
    }
    return result as T;
  }
  return data;
}

export function registerApi(app: express.Express, db: DuckDb) {
  // -----------------------------
  // Strategies
  // -----------------------------
  app.get('/api/strategies', async (_req, res) => {
    const rows = await all(db, `SELECT * FROM backtest_strategies ORDER BY created_at DESC`);
    res.json(rows);
  });

  app.post('/api/strategies', express.json(), async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const config_json = String(req.body?.config_json ?? '').trim();

    if (!name) return res.status(400).json({ error: 'name required' });
    if (!config_json) return res.status(400).json({ error: 'config_json required' });

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
  app.get('/api/runs', async (_req, res) => {
    const rows = await all(db, `SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT 50`);
    res.json(rows);
  });

  app.get('/api/runs/:runId', async (req, res) => {
    const runId = req.params.runId;
    const rows = await all(db, `SELECT * FROM backtest_runs WHERE run_id = ?`, [runId]);
    res.json(rows[0] ?? null);
  });

  app.post('/api/runs', express.json(), async (req, res) => {
    const strategy_id = String(req.body?.strategy_id ?? '').trim();
    const interval = String(req.body?.interval ?? '1m').trim();
    const from = String(req.body?.from ?? '').trim();
    const to = String(req.body?.to ?? '').trim();

    const taker_fee_bps = Number(req.body?.taker_fee_bps ?? 30);
    const slippage_bps = Number(req.body?.slippage_bps ?? 10);
    const position_usd = Number(req.body?.position_usd ?? 1000);
    const caller_filter = String(req.body?.caller_filter ?? '').trim();

    if (!strategy_id) return res.status(400).json({ error: 'strategy_id required' });
    if (!from || !to) return res.status(400).json({ error: 'from/to required' });

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
    }).catch(async (err: unknown) => {
      // Persist error
      await run(
        db,
        `UPDATE backtest_runs
        SET status='error', finished_at=NOW(), error_text=?
        WHERE run_id=?`,
        [err instanceof Error ? (err.stack ?? err.message) : String(err), run_id]
      );
    });

    res.json({ run_id });
  });

  // -----------------------------
  // Path-Only Runs (Truth Layer)
  // -----------------------------
  app.post('/api/runs/path-only', express.json(), async (req, res) => {
    const interval = String(req.body?.interval ?? '5m').trim();
    const from = String(req.body?.from ?? '').trim();
    const to = String(req.body?.to ?? '').trim();
    const caller_filter = String(req.body?.caller_filter ?? '').trim();
    const mint_filter = String(req.body?.mint_filter ?? '').trim();

    if (!from || !to) return res.status(400).json({ error: 'from/to required' });

    const run_id = nanoid(12);

    const params_json = JSON.stringify({
      run_mode: 'path-only',
      interval,
      from,
      to,
      caller_filter: caller_filter || undefined,
      mint_filter: mint_filter || undefined,
    });

    await run(
      db,
      `INSERT INTO backtest_runs(run_id, strategy_id, status, params_json, run_mode, interval, time_from, time_to, created_at)
      VALUES (?, NULL, 'queued', ?, 'path-only', ?, ?, ?, NOW())`,
      [run_id, params_json, interval, from, to]
    );

    // Spawn CLI backtest in path-only mode
    spawnBacktest(db, {
      run_id,
      strategy_id: undefined,
      interval,
      from,
      to,
      run_mode: 'path-only',
      caller_filter: caller_filter || undefined,
      mint_filter: mint_filter || undefined,
    }).catch(async (err: unknown) => {
      // Persist error
      await run(
        db,
        `UPDATE backtest_runs
        SET status='error', finished_at=NOW(), error_text=?
        WHERE run_id=?`,
        [err instanceof Error ? (err.stack ?? err.message) : String(err), run_id]
      );
    });

    res.json({ run_id });
  });

  // -----------------------------
  // Policy Runs
  // -----------------------------
  app.post('/api/runs/policy', express.json(), async (req, res) => {
    const pathOnlyRunId = String(req.body?.path_only_run_id ?? '').trim();
    const policy_json = String(req.body?.policy_json ?? '').trim();
    const caller_filter = String(req.body?.caller_filter ?? '').trim();

    if (!pathOnlyRunId) return res.status(400).json({ error: 'path_only_run_id required' });
    if (!policy_json) return res.status(400).json({ error: 'policy_json required' });

    // Validate policy JSON
    try {
      JSON.parse(policy_json);
    } catch {
      return res.status(400).json({ error: 'invalid policy_json' });
    }

    const run_id = nanoid(12);

    const params_json = JSON.stringify({
      run_mode: 'policy',
      path_only_run_id: pathOnlyRunId,
      policy_json,
      caller_filter: caller_filter || undefined,
    });

    await run(
      db,
      `INSERT INTO backtest_runs(run_id, strategy_id, status, params_json, run_mode, created_at)
      VALUES (?, NULL, 'queued', ?, 'policy', NOW())`,
      [run_id, params_json]
    );

    // Spawn CLI policy backtest
    spawnBacktest(db, {
      run_id,
      strategy_id: undefined,
      run_mode: 'policy',
      path_only_run_id: pathOnlyRunId,
      policy_json,
      caller_filter: caller_filter || undefined,
    }).catch(async (err) => {
      await run(
        db,
        `UPDATE backtest_runs
        SET status='error', finished_at=NOW(), error_text=?
        WHERE run_id=?`,
        [err instanceof Error ? (err.stack ?? err.message) : String(err), run_id]
      );
    });

    res.json({ run_id });
  });

  // -----------------------------
  // Optimize Runs
  // -----------------------------
  app.post('/api/runs/optimize', express.json(), async (req, res) => {
    const pathOnlyRunId = String(req.body?.path_only_run_id ?? '').trim();
    const caller = String(req.body?.caller ?? '').trim();
    const policy_type = String(req.body?.policy_type ?? 'fixed-stop').trim();
    const constraints_json = String(req.body?.constraints_json ?? '{}').trim();
    const grid_json = String(req.body?.grid_json ?? '').trim();

    if (!pathOnlyRunId) return res.status(400).json({ error: 'path_only_run_id required' });
    if (!caller) return res.status(400).json({ error: 'caller required' });

    // Validate constraints JSON
    try {
      JSON.parse(constraints_json);
    } catch {
      return res.status(400).json({ error: 'invalid constraints_json' });
    }

    const run_id = nanoid(12);

    const params_json = JSON.stringify({
      run_mode: 'optimize',
      path_only_run_id: pathOnlyRunId,
      caller,
      policy_type,
      constraints_json,
      grid_json: grid_json || undefined,
    });

    await run(
      db,
      `INSERT INTO backtest_runs(run_id, strategy_id, status, params_json, run_mode, created_at)
      VALUES (?, NULL, 'queued', ?, 'optimize', NOW())`,
      [run_id, params_json]
    );

    // Spawn CLI optimize
    spawnBacktest(db, {
      run_id,
      strategy_id: undefined,
      run_mode: 'optimize',
      path_only_run_id: pathOnlyRunId,
      caller,
      policy_type,
      constraints_json,
      grid_json: grid_json || undefined,
    }).catch(async (err) => {
      await run(
        db,
        `UPDATE backtest_runs
        SET status='error', finished_at=NOW(), error_text=?
        WHERE run_id=?`,
        [err instanceof Error ? (err.stack ?? err.message) : String(err), run_id]
      );
    });

    res.json({ run_id });
  });

  // -----------------------------
  // Truth Leaderboard (from path metrics)
  // -----------------------------
  app.get('/api/truth-leaderboard/:runId', async (req, res) => {
    const runId = req.params.runId;

    const sql = `
      SELECT
        caller_name,
        COUNT(*)::INT AS calls,
        
        -- 2x hit rate
        SUM(CASE WHEN hit_2x THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS rate_2x,
        SUM(CASE WHEN hit_3x THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS rate_3x,
        SUM(CASE WHEN hit_4x THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS rate_4x,
        
        -- Median time-to-multiples (ms -> minutes)
        quantile_cont((t_2x_ms - alert_ts_ms) / 60000.0, 0.5) FILTER (WHERE hit_2x) AS median_t2x_min,
        quantile_cont((t_3x_ms - alert_ts_ms) / 60000.0, 0.5) FILTER (WHERE hit_3x) AS median_t3x_min,
        quantile_cont((t_4x_ms - alert_ts_ms) / 60000.0, 0.5) FILTER (WHERE hit_4x) AS median_t4x_min,
        
        -- Drawdown (median, p95)
        quantile_cont(dd_bps, 0.5) AS median_dd_bps,
        quantile_cont(dd_bps, 0.95) AS p95_dd_bps,
        
        -- Drawdown to 2x (median, p95)
        quantile_cont(dd_to_2x_bps, 0.5) FILTER (WHERE hit_2x) AS median_dd_to_2x_bps,
        quantile_cont(dd_to_2x_bps, 0.95) FILTER (WHERE hit_2x) AS p95_dd_to_2x_bps,
        
        -- Activity
        quantile_cont(alert_to_activity_ms / 1000.0, 0.5) AS median_alert_to_activity_s,
        
        -- Peak multiple
        AVG(peak_multiple) AS avg_peak,
        quantile_cont(peak_multiple, 0.5) AS median_peak
      FROM backtest_call_path_metrics
      WHERE run_id = ?
      GROUP BY caller_name
      ORDER BY
        rate_2x DESC,
        median_t2x_min ASC NULLS LAST,
        median_dd_bps DESC NULLS LAST,
        calls DESC
    `;

    const rows = await all(db, sql, [runId]);
    res.json(rows);
  });

  // -----------------------------
  // Best Policies per Caller
  // -----------------------------
  app.get('/api/policies/:caller', async (req, res) => {
    const caller = req.params.caller;

    const sql = `
      SELECT *
      FROM backtest_policies
      WHERE caller_name = ?
      ORDER BY score DESC
      LIMIT 10
    `;

    const rows = await all(db, sql, [caller]);
    res.json(rows);
  });

  // -----------------------------
  // Leaderboard (PnL)
  // -----------------------------
  app.get('/api/leaderboard/:runId', async (req, res) => {
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
  // Dashboard Summary
  // -----------------------------
  app.get('/api/dashboard-summary', async (_req, res) => {
    try {
      // Get latest run info
      const latestRunSql = `
        SELECT
          run_id,
          run_name,
          created_at,
          date_from,
          date_to,
          alerts_total,
          alerts_ok
        FROM runs.runs_d
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const latestRun = await all(db, latestRunSql, []);

      if (!latestRun.length) {
        res.json({ error: 'No runs found' });
        return;
      }

      const runId = (latestRun[0] as { run_id: string }).run_id;

      // Get scored summary for latest run
      const scoredSummarySql = `
        SELECT
          COUNT(*)::INT AS total_callers,
          SUM(CASE WHEN score_v2 > 0 THEN 1 ELSE 0 END)::INT AS positive_scores,
          SUM(CASE WHEN discipline_bonus > 0 THEN 1 ELSE 0 END)::INT AS discipline_count,
          ROUND(AVG(score_v2), 3) AS avg_score,
          ROUND(MAX(score_v2), 3) AS max_score,
          ROUND(MIN(score_v2), 3) AS min_score,
          ROUND(AVG(hit2x_pct), 1) AS avg_hit2x_pct,
          ROUND(AVG(median_ath), 2) AS avg_median_ath,
          ROUND(AVG(risk_dd_pct), 1) AS avg_risk_dd_pct
        FROM baseline.caller_scored_v2
        WHERE run_id = ?
          AND n >= 10
      `;

      // Top 5 callers by score
      const top5Sql = `
        SELECT
          caller,
          n,
          ROUND(score_v2, 3) AS score_v2,
          ROUND(median_ath, 2) AS median_ath,
          ROUND(hit2x_pct, 1) AS hit2x_pct,
          ROUND(risk_dd_pct, 1) AS risk_dd_pct,
          discipline_bonus > 0 AS has_discipline
        FROM baseline.caller_scored_v2
        WHERE run_id = ?
          AND n >= 30
        ORDER BY score_v2 DESC
        LIMIT 5
      `;

      // Recent runs
      const recentRunsSql = `
        SELECT
          run_id,
          run_name,
          created_at,
          alerts_ok
        FROM runs.runs_d
        ORDER BY created_at DESC
        LIMIT 5
      `;

      // Score distribution
      const scoreDistSql = `
        SELECT
          CASE
            WHEN score_v2 < -10 THEN '<-10'
            WHEN score_v2 < -5 THEN '-10 to -5'
            WHEN score_v2 < -1 THEN '-5 to -1'
            WHEN score_v2 < 0 THEN '-1 to 0'
            WHEN score_v2 < 0.5 THEN '0 to 0.5'
            WHEN score_v2 < 1 THEN '0.5 to 1'
            ELSE '>1'
          END AS bucket,
          COUNT(*)::INT AS count
        FROM baseline.caller_scored_v2
        WHERE run_id = ?
          AND n >= 10
        GROUP BY 1
        ORDER BY 
          CASE bucket
            WHEN '<-10' THEN 1
            WHEN '-10 to -5' THEN 2
            WHEN '-5 to -1' THEN 3
            WHEN '-1 to 0' THEN 4
            WHEN '0 to 0.5' THEN 5
            WHEN '0.5 to 1' THEN 6
            ELSE 7
          END
      `;

      const [scoredSummary, top5, recentRuns, scoreDist] = await Promise.all([
        all(db, scoredSummarySql, [runId]),
        all(db, top5Sql, [runId]),
        all(db, recentRunsSql, []),
        all(db, scoreDistSql, [runId]),
      ]);

      res.json({
        latestRun: latestRun[0],
        summary: scoredSummary[0] || null,
        top5,
        recentRuns,
        scoreDistribution: scoreDist,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // -----------------------------
  // Run Comparison (A vs B)
  // -----------------------------
  app.get('/api/compare-runs/:runIdA/:runIdB', async (req, res) => {
    const runIdA = req.params.runIdA;
    const runIdB = req.params.runIdB;

    try {
      // Get both runs' scored data
      const scoredSql = `
        SELECT
          run_id,
          caller,
          n,
          ROUND(score_v2, 3) AS score_v2,
          ROUND(median_ath, 2) AS median_ath,
          ROUND(hit2x_pct, 1) AS hit2x_pct,
          ROUND(risk_dd_pct, 1) AS risk_dd_pct,
          ROUND(median_t2x_hrs * 60, 1) AS median_t2x_min,
          discipline_bonus > 0 AS has_discipline
        FROM baseline.caller_scored_v2
        WHERE run_id IN (?, ?)
          AND n >= 30
      `;

      const allCallers = await all(db, scoredSql, [runIdA, runIdB]);

      // Group by caller
      const byCallerA = new Map();
      const byCallerB = new Map();

      for (const r of allCallers as Array<{
        run_id: string;
        caller: string;
        [key: string]: unknown;
      }>) {
        if (r.run_id === runIdA) {
          byCallerA.set(r.caller, r);
        } else {
          byCallerB.set(r.caller, r);
        }
      }

      // Find common callers and compute diffs
      const comparison = [];
      const allCallerNames = new Set([...byCallerA.keys(), ...byCallerB.keys()]);

      for (const caller of allCallerNames) {
        const a = byCallerA.get(caller);
        const b = byCallerB.get(caller);

        if (a && b) {
          comparison.push({
            caller,
            n_a: a.n,
            n_b: b.n,
            score_a: a.score_v2,
            score_b: b.score_v2,
            score_diff: Number((b.score_v2 - a.score_v2).toFixed(3)),
            ath_a: a.median_ath,
            ath_b: b.median_ath,
            hit2x_a: a.hit2x_pct,
            hit2x_b: b.hit2x_pct,
            dd_a: a.risk_dd_pct,
            dd_b: b.risk_dd_pct,
            status: 'both',
          });
        } else if (a) {
          comparison.push({
            caller,
            n_a: a.n,
            n_b: null,
            score_a: a.score_v2,
            score_b: null,
            score_diff: null,
            ath_a: a.median_ath,
            ath_b: null,
            hit2x_a: a.hit2x_pct,
            hit2x_b: null,
            dd_a: a.risk_dd_pct,
            dd_b: null,
            status: 'only_a',
          });
        } else if (b) {
          comparison.push({
            caller,
            n_a: null,
            n_b: b.n,
            score_a: null,
            score_b: b.score_v2,
            score_diff: null,
            ath_a: null,
            ath_b: b.median_ath,
            hit2x_a: null,
            hit2x_b: b.hit2x_pct,
            dd_a: null,
            dd_b: b.risk_dd_pct,
            status: 'only_b',
          });
        }
      }

      // Sort by score diff (biggest improvements first)
      comparison.sort((x, y) => {
        if (x.score_diff == null && y.score_diff == null) return 0;
        if (x.score_diff == null) return 1;
        if (y.score_diff == null) return -1;
        return y.score_diff - x.score_diff;
      });

      // Summary stats
      const bothRuns = comparison.filter((c) => c.status === 'both');
      const improved = bothRuns.filter((c) => c.score_diff && c.score_diff > 0).length;
      const declined = bothRuns.filter((c) => c.score_diff && c.score_diff < 0).length;
      const unchanged = bothRuns.filter((c) => c.score_diff === 0).length;

      res.json({
        comparison,
        summary: {
          total_callers: comparison.length,
          in_both: bothRuns.length,
          only_in_a: comparison.filter((c) => c.status === 'only_a').length,
          only_in_b: comparison.filter((c) => c.status === 'only_b').length,
          improved,
          declined,
          unchanged,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // -----------------------------
  // Scored Leaderboard (baseline.caller_scored_v2)
  // Uses the new risk-adjusted scoring: fast 2x + controlled DD
  // -----------------------------
  app.get('/api/scored-leaderboard/:runId', async (req, res) => {
    const runId = req.params.runId;
    const minTrades = Number(req.query.min_trades ?? 10);

    // Query the scored view from baseline schema
    // This view computes: base_upside, tail_bonus, timing, risk_penalty, discipline_bonus
    const sql = `
      SELECT
        caller,
        n,
        
        -- Core metrics
        ROUND(median_ath, 2) AS median_ath,
        ROUND(p75_ath, 2) AS p75_ath,
        ROUND(p95_ath, 2) AS p95_ath,
        
        -- Hit rates
        ROUND(hit2x_pct, 1) AS hit2x_pct,
        ROUND(hit3x_pct, 1) AS hit3x_pct,
        ROUND(hit4x_pct, 1) AS hit4x_pct,
        
        -- Timing
        ROUND(median_t2x_hrs * 60, 1) AS median_t2x_min,
        ROUND(fast2x_signal, 3) AS fast2x_signal,
        
        -- Risk
        ROUND(risk_dd_pct, 1) AS risk_dd_pct,
        ROUND(risk_mag * 100, 1) AS risk_mag_pct,
        ROUND(risk_penalty, 2) AS risk_penalty,
        
        -- Score components
        ROUND(base_upside, 3) AS base_upside,
        ROUND(tail_bonus, 3) AS tail_bonus,
        ROUND(discipline_bonus, 2) AS discipline_bonus,
        ROUND(confidence, 3) AS confidence,
        
        -- Final score
        ROUND(score_v2, 3) AS score_v2
        
      FROM baseline.caller_scored_v2
      WHERE run_id = ?
        AND n >= ?
      ORDER BY score_v2 DESC
    `;

    try {
      const rows = await all(db, sql, [runId, minTrades]);
      res.json(rows);
    } catch (err) {
      // View may not exist yet - return helpful error
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('caller_scored_v2') || msg.includes('does not exist')) {
        res.status(404).json({
          error: 'Scored view not found. Run: ./scripts/create_caller_scored_v2.sh',
          details: msg,
        });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  // -----------------------------
  // Available baseline runs (for run selector)
  // -----------------------------
  app.get('/api/baseline-runs', async (_req, res) => {
    const sql = `
      SELECT
        run_id,
        run_name,
        created_at,
        date_from,
        date_to,
        alerts_total,
        alerts_ok
      FROM runs.runs_d
      ORDER BY created_at DESC
      LIMIT 50
    `;

    try {
      const rows = await all(db, sql, []);
      res.json(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // -----------------------------
  // ATH/DD/Time distributions for charts
  // -----------------------------
  app.get('/api/distributions/:runId', async (req, res) => {
    const runId = req.params.runId;

    try {
      // ATH distribution
      const athSql = `
        SELECT
          CASE
            WHEN ath_mult < 1 THEN '<1x'
            WHEN ath_mult < 1.5 THEN '1-1.5x'
            WHEN ath_mult < 2 THEN '1.5-2x'
            WHEN ath_mult < 3 THEN '2-3x'
            WHEN ath_mult < 4 THEN '3-4x'
            WHEN ath_mult < 5 THEN '4-5x'
            WHEN ath_mult < 10 THEN '5-10x'
            WHEN ath_mult < 20 THEN '10-20x'
            ELSE '>20x'
          END AS bucket,
          COUNT(*)::INT AS count
        FROM baseline.alert_results_f
        WHERE run_id = ? AND status = 'ok'
        GROUP BY 1
        ORDER BY 
          CASE bucket
            WHEN '<1x' THEN 1
            WHEN '1-1.5x' THEN 2
            WHEN '1.5-2x' THEN 3
            WHEN '2-3x' THEN 4
            WHEN '3-4x' THEN 5
            WHEN '4-5x' THEN 6
            WHEN '5-10x' THEN 7
            WHEN '10-20x' THEN 8
            ELSE 9
          END
      `;

      // DD distribution
      const ddSql = `
        SELECT
          CASE
            WHEN dd_overall > -0.1 THEN '0-10%'
            WHEN dd_overall > -0.2 THEN '10-20%'
            WHEN dd_overall > -0.3 THEN '20-30%'
            WHEN dd_overall > -0.4 THEN '30-40%'
            WHEN dd_overall > -0.5 THEN '40-50%'
            WHEN dd_overall > -0.6 THEN '50-60%'
            WHEN dd_overall > -0.7 THEN '60-70%'
            ELSE '>70%'
          END AS bucket,
          COUNT(*)::INT AS count
        FROM baseline.alert_results_f
        WHERE run_id = ? AND status = 'ok'
        GROUP BY 1
        ORDER BY 
          CASE bucket
            WHEN '0-10%' THEN 1
            WHEN '10-20%' THEN 2
            WHEN '20-30%' THEN 3
            WHEN '30-40%' THEN 4
            WHEN '40-50%' THEN 5
            WHEN '50-60%' THEN 6
            WHEN '60-70%' THEN 7
            ELSE 8
          END
      `;

      // Time to 2x distribution
      const timeSql = `
        SELECT
          CASE
            WHEN time_to_2x_s < 60 THEN '<1m'
            WHEN time_to_2x_s < 300 THEN '1-5m'
            WHEN time_to_2x_s < 600 THEN '5-10m'
            WHEN time_to_2x_s < 1800 THEN '10-30m'
            WHEN time_to_2x_s < 3600 THEN '30m-1h'
            WHEN time_to_2x_s < 7200 THEN '1-2h'
            WHEN time_to_2x_s < 14400 THEN '2-4h'
            ELSE '>4h'
          END AS bucket,
          COUNT(*)::INT AS count
        FROM baseline.alert_results_f
        WHERE run_id = ? AND status = 'ok' AND time_to_2x_s IS NOT NULL
        GROUP BY 1
        ORDER BY 
          CASE bucket
            WHEN '<1m' THEN 1
            WHEN '1-5m' THEN 2
            WHEN '5-10m' THEN 3
            WHEN '10-30m' THEN 4
            WHEN '30m-1h' THEN 5
            WHEN '1-2h' THEN 6
            WHEN '2-4h' THEN 7
            ELSE 8
          END
      `;

      // Score distribution
      const scoreSql = `
        SELECT
          CASE
            WHEN score_v2 < -10 THEN '<-10'
            WHEN score_v2 < -5 THEN '-10 to -5'
            WHEN score_v2 < -1 THEN '-5 to -1'
            WHEN score_v2 < 0 THEN '-1 to 0'
            WHEN score_v2 < 0.5 THEN '0 to 0.5'
            WHEN score_v2 < 1 THEN '0.5 to 1'
            ELSE '>1'
          END AS bucket,
          COUNT(*)::INT AS count
        FROM baseline.caller_scored_v2
        WHERE run_id = ?
        GROUP BY 1
        ORDER BY 
          CASE bucket
            WHEN '<-10' THEN 1
            WHEN '-10 to -5' THEN 2
            WHEN '-5 to -1' THEN 3
            WHEN '-1 to 0' THEN 4
            WHEN '0 to 0.5' THEN 5
            WHEN '0.5 to 1' THEN 6
            ELSE 7
          END
      `;

      const [athDist, ddDist, timeDist, scoreDist] = await Promise.all([
        all(db, athSql, [runId]),
        all(db, ddSql, [runId]),
        all(db, timeSql, [runId]),
        all(db, scoreSql, [runId]),
      ]);

      res.json({
        ath: athDist,
        drawdown: ddDist,
        time_to_2x: timeDist,
        score: scoreDist,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // -----------------------------
  // Caller Path Metrics (time-to-multiples, failures, drawdown, activity)
  // -----------------------------
  app.get('/api/caller-path/:runId', async (req, res) => {
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

  // -----------------------------
  // Caller Drill-down (individual alerts for a caller)
  // -----------------------------
  app.get('/api/caller-alerts/:runId/:caller', async (req, res) => {
    const runId = req.params.runId;
    const caller = decodeURIComponent(req.params.caller);

    try {
      // Get individual alert results for this caller
      const alertsSql = `
        SELECT
          alert_id,
          mint,
          epoch_ms(alert_ts_utc) AS alert_ts_ms,
          ROUND(ath_mult, 2) AS ath_mult,
          ROUND(COALESCE(dd_overall, 0) * 100, 1) AS dd_overall_pct,
          ROUND(COALESCE(dd_pre2x, 0) * 100, 1) AS dd_pre2x_pct,
          (time_to_2x_s IS NOT NULL AND time_to_2x_s > 0) AS hit_2x,
          (time_to_3x_s IS NOT NULL AND time_to_3x_s > 0) AS hit_3x,
          (time_to_4x_s IS NOT NULL AND time_to_4x_s > 0) AS hit_4x,
          ROUND(COALESCE(time_to_2x_s, 0) / 60.0, 1) AS time_to_2x_min,
          ROUND(COALESCE(time_to_3x_s, 0) / 60.0, 1) AS time_to_3x_min,
          ROUND(COALESCE(time_to_4x_s, 0) / 60.0, 1) AS time_to_4x_min
        FROM baseline.alert_results_f
        WHERE run_id = ?
          AND caller = ?
          AND status = 'ok'
        ORDER BY alert_ts_utc DESC
        LIMIT 500
      `;

      const alerts = await all(db, alertsSql, [runId, caller]);

      // Get ATH distribution for this caller
      const athDistSql = `
        SELECT
          CASE
            WHEN ath_mult < 1 THEN '<1x'
            WHEN ath_mult < 1.5 THEN '1-1.5x'
            WHEN ath_mult < 2 THEN '1.5-2x'
            WHEN ath_mult < 3 THEN '2-3x'
            WHEN ath_mult < 4 THEN '3-4x'
            WHEN ath_mult < 5 THEN '4-5x'
            WHEN ath_mult < 10 THEN '5-10x'
            WHEN ath_mult < 20 THEN '10-20x'
            ELSE '>20x'
          END AS bucket,
          COUNT(*)::INT AS count
        FROM baseline.alert_results_f
        WHERE run_id = ? AND caller = ? AND status = 'ok'
        GROUP BY 1
        ORDER BY 
          CASE bucket
            WHEN '<1x' THEN 1
            WHEN '1-1.5x' THEN 2
            WHEN '1.5-2x' THEN 3
            WHEN '2-3x' THEN 4
            WHEN '3-4x' THEN 5
            WHEN '4-5x' THEN 6
            WHEN '5-10x' THEN 7
            WHEN '10-20x' THEN 8
            ELSE 9
          END
      `;

      // Get DD distribution for this caller
      const ddDistSql = `
        SELECT
          CASE
            WHEN dd_overall > -0.1 THEN '0-10%'
            WHEN dd_overall > -0.2 THEN '10-20%'
            WHEN dd_overall > -0.3 THEN '20-30%'
            WHEN dd_overall > -0.4 THEN '30-40%'
            WHEN dd_overall > -0.5 THEN '40-50%'
            WHEN dd_overall > -0.6 THEN '50-60%'
            WHEN dd_overall > -0.7 THEN '60-70%'
            ELSE '>70%'
          END AS bucket,
          COUNT(*)::INT AS count
        FROM baseline.alert_results_f
        WHERE run_id = ? AND caller = ? AND status = 'ok'
        GROUP BY 1
        ORDER BY 
          CASE bucket
            WHEN '0-10%' THEN 1
            WHEN '10-20%' THEN 2
            WHEN '20-30%' THEN 3
            WHEN '30-40%' THEN 4
            WHEN '40-50%' THEN 5
            WHEN '50-60%' THEN 6
            WHEN '60-70%' THEN 7
            ELSE 8
          END
      `;

      // Get time to 2x distribution for this caller
      const timeDistSql = `
        SELECT
          CASE
            WHEN time_to_2x_s < 60 THEN '<1m'
            WHEN time_to_2x_s < 300 THEN '1-5m'
            WHEN time_to_2x_s < 600 THEN '5-10m'
            WHEN time_to_2x_s < 1800 THEN '10-30m'
            WHEN time_to_2x_s < 3600 THEN '30m-1h'
            WHEN time_to_2x_s < 7200 THEN '1-2h'
            WHEN time_to_2x_s < 14400 THEN '2-4h'
            ELSE '>4h'
          END AS bucket,
          COUNT(*)::INT AS count
        FROM baseline.alert_results_f
        WHERE run_id = ? AND caller = ? AND status = 'ok' AND time_to_2x_s IS NOT NULL
        GROUP BY 1
        ORDER BY 
          CASE bucket
            WHEN '<1m' THEN 1
            WHEN '1-5m' THEN 2
            WHEN '5-10m' THEN 3
            WHEN '10-30m' THEN 4
            WHEN '30m-1h' THEN 5
            WHEN '1-2h' THEN 6
            WHEN '2-4h' THEN 7
            ELSE 8
          END
      `;

      // Get caller's stats from scored view for comparison
      const scoredSql = `
        SELECT
          caller,
          n,
          ROUND(median_ath, 2) AS median_ath,
          ROUND(p75_ath, 2) AS p75_ath,
          ROUND(p95_ath, 2) AS p95_ath,
          ROUND(hit2x_pct, 1) AS hit2x_pct,
          ROUND(hit3x_pct, 1) AS hit3x_pct,
          ROUND(median_t2x_hrs * 60, 1) AS median_t2x_min,
          ROUND(risk_dd_pct, 1) AS risk_dd_pct,
          ROUND(score_v2, 3) AS score_v2,
          ROUND(discipline_bonus, 2) AS discipline_bonus
        FROM baseline.caller_scored_v2
        WHERE run_id = ? AND caller = ?
      `;

      // Get population stats for comparison
      const popStatsSql = `
        SELECT
          ROUND(AVG(median_ath), 2) AS pop_median_ath,
          ROUND(AVG(hit2x_pct), 1) AS pop_hit2x_pct,
          ROUND(AVG(median_t2x_hrs * 60), 1) AS pop_median_t2x_min,
          ROUND(AVG(risk_dd_pct), 1) AS pop_risk_dd_pct,
          ROUND(AVG(score_v2), 3) AS pop_avg_score
        FROM baseline.caller_scored_v2
        WHERE run_id = ? AND n >= 10
      `;

      const [athDist, ddDist, timeDist, callerStats, popStats] = await Promise.all([
        all(db, athDistSql, [runId, caller]),
        all(db, ddDistSql, [runId, caller]),
        all(db, timeDistSql, [runId, caller]),
        all(db, scoredSql, [runId, caller]),
        all(db, popStatsSql, [runId]),
      ]);

      res.json(sanitizeForJson({
        alerts,
        distributions: {
          ath: athDist,
          drawdown: ddDist,
          time_to_2x: timeDist,
        },
        callerStats: callerStats[0] || null,
        populationStats: popStats[0] || null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // -----------------------------
  // Trade Drill-down (individual trade with OHLCV data)
  // This endpoint serves data for LightweightCharts candlestick visualization
  // -----------------------------
  app.get('/api/drilldown/:runId/:caller', async (req, res) => {
    const runId = req.params.runId;
    const caller = decodeURIComponent(req.params.caller);
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    try {
      // Get individual alerts with OHLCV data paths
      // We need alert_id, mint, timestamps, and metrics
      const alertsSql = `
        SELECT
          alert_id,
          mint,
          caller,
          alert_ts,
          ROUND(ath_mult, 4) AS ath_mult,
          ROUND(dd_overall, 4) AS dd_overall,
          ROUND(dd_pre2x, 4) AS dd_pre2x,
          COALESCE(hit_2x, false) AS hit_2x,
          COALESCE(hit_3x, false) AS hit_3x,
          COALESCE(hit_4x, false) AS hit_4x,
          COALESCE(hit_5x, false) AS hit_5x,
          time_to_2x_s,
          time_to_3x_s,
          time_to_4x_s,
          time_to_5x_s,
          entry_price_usd,
          horizon_hours,
          status
        FROM baseline.alert_results_f
        WHERE run_id = ?
          AND caller = ?
          AND status = 'ok'
        ORDER BY alert_ts DESC
        LIMIT ?
      `;

      const alerts = await all(db, alertsSql, [runId, caller, limit]);

      // Get caller summary stats
      const statsSql = `
        SELECT
          caller,
          n,
          ROUND(score_v2, 3) AS score_v2,
          ROUND(median_ath, 2) AS median_ath,
          ROUND(p75_ath, 2) AS p75_ath,
          ROUND(hit2x_pct, 1) AS hit2x_pct,
          ROUND(hit3x_pct, 1) AS hit3x_pct,
          ROUND(hit5x_pct, 1) AS hit5x_pct,
          ROUND(median_t2x_hrs * 60, 1) AS median_t2x_min,
          ROUND(risk_dd_pct, 1) AS risk_dd_pct,
          ROUND(discipline_bonus, 2) AS discipline_bonus
        FROM baseline.caller_scored_v2
        WHERE run_id = ? AND caller = ?
      `;

      const stats = await all(db, statsSql, [runId, caller]);

      // Format alerts for the drilldown view
      const formattedAlerts = (
        alerts as Array<{
          alert_id: string;
          mint: string;
          caller: string;
          alert_ts: string;
          ath_mult: number;
          dd_overall: number;
          dd_pre2x: number | null;
          hit_2x: boolean;
          hit_3x: boolean;
          hit_4x: boolean;
          hit_5x: boolean;
          time_to_2x_s: number | null;
          time_to_3x_s: number | null;
          time_to_4x_s: number | null;
          time_to_5x_s: number | null;
          entry_price_usd: number | null;
          horizon_hours: number | null;
          status: string;
        }>
      ).map((a) => ({
        id: a.alert_id,
        mint: a.mint,
        alert_ts: a.alert_ts,
        alert_ts_unix: a.alert_ts ? Math.floor(new Date(a.alert_ts).getTime() / 1000) : null,
        ath_mult: a.ath_mult,
        dd_overall_pct: a.dd_overall ? Math.round(a.dd_overall * 1000) / 10 : null,
        dd_pre2x_pct: a.dd_pre2x ? Math.round(a.dd_pre2x * 1000) / 10 : null,
        hit_2x: a.hit_2x,
        hit_3x: a.hit_3x,
        hit_4x: a.hit_4x,
        hit_5x: a.hit_5x,
        time_to_2x_min: a.time_to_2x_s ? Math.round(a.time_to_2x_s / 6) / 10 : null,
        time_to_3x_min: a.time_to_3x_s ? Math.round(a.time_to_3x_s / 6) / 10 : null,
        time_to_4x_min: a.time_to_4x_s ? Math.round(a.time_to_4x_s / 6) / 10 : null,
        time_to_5x_min: a.time_to_5x_s ? Math.round(a.time_to_5x_s / 6) / 10 : null,
        entry_price: a.entry_price_usd,
        horizon_hours: a.horizon_hours || 48,
      }));

      res.json({
        caller,
        stats: stats[0] || null,
        alerts: formattedAlerts,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // -----------------------------
  // OHLCV data for a specific trade (mint + time range)
  // This fetches candle data from the slices for chart rendering
  // -----------------------------
  app.get('/api/ohlcv/:mint', async (req, res) => {
    const mint = req.params.mint;
    const from = Number(req.query.from) || 0;
    const to = Number(req.query.to) || Math.floor(Date.now() / 1000);
    const interval = String(req.query.interval || '5m');

    try {
      // Query OHLCV from storage
      // This assumes we have a candles table or can query from slices
      const sql = `
        SELECT
          timestamp_ms / 1000 AS time,
          open,
          high,
          low,
          close,
          volume
        FROM ohlcv_candles
        WHERE token_address = ?
          AND timestamp_ms >= ? * 1000
          AND timestamp_ms <= ? * 1000
          AND interval = ?
        ORDER BY timestamp_ms ASC
        LIMIT 2000
      `;

      const candles = await all(db, sql, [mint, from, to, interval]);

      // If no candles found, return empty with helpful message
      if (!candles || (candles as unknown[]).length === 0) {
        res.json({
          mint,
          interval,
          from,
          to,
          candles: [],
          message: 'No OHLCV data found for this token in the specified range',
        });
        return;
      }

      res.json({
        mint,
        interval,
        from,
        to,
        candles,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If table doesn't exist, return empty array gracefully
      if (msg.includes('does not exist') || msg.includes('no such table')) {
        res.json({
          mint,
          interval,
          from,
          to,
          candles: [],
          message: 'OHLCV table not found - run OHLCV ingestion first',
        });
        return;
      }
      res.status(500).json({ error: msg });
    }
  });
}
