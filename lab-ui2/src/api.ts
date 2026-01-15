import express from 'express';
import { nanoid } from 'nanoid';
import type { DuckDb } from './db.js';
import { all, run } from './db.js';
import { validateExitPlanJson } from './exit-plan-schema.js';
import { spawnBacktest } from './runner.js';

export function registerApi(app: express.Express, db: DuckDb) {
  // -----------------------------
  // Strategies
  // -----------------------------
  app.get('/api/strategies', async (_req, res) => {
    const rows = await all(db, `SELECT * FROM backtest_strategies ORDER BY created_at DESC`);
    res.json(rows);
  });

  app.get('/api/strategies/:strategyId', async (req, res) => {
    const strategyId = req.params.strategyId;
    const rows = await all(db, `SELECT * FROM backtest_strategies WHERE strategy_id = ?`, [strategyId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    res.json(rows[0]);
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

  app.put('/api/strategies/:strategyId', express.json(), async (req, res) => {
    const strategyId = req.params.strategyId;
    const name = String(req.body?.name ?? '').trim();
    const config_json = String(req.body?.config_json ?? '').trim();

    if (!name) return res.status(400).json({ error: 'name required' });
    if (!config_json) return res.status(400).json({ error: 'config_json required' });

    const parsed = validateExitPlanJson(config_json);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    await run(
      db,
      `UPDATE backtest_strategies SET name = ?, config_json = ? WHERE strategy_id = ?`,
      [name, config_json, strategyId]
    );

    res.json({ success: true });
  });

  app.delete('/api/strategies/:strategyId', async (req, res) => {
    const strategyId = req.params.strategyId;
    await run(db, `DELETE FROM backtest_strategies WHERE strategy_id = ?`, [strategyId]);
    res.json({ success: true });
  });

  // -----------------------------
  // Runs
  // -----------------------------
  app.get('/api/runs', async (req, res) => {
    const mode = req.query.mode as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    
    let sql = 'SELECT * FROM backtest_runs';
    const params: any[] = [];
    
    if (mode) {
      sql += ' WHERE run_mode = ?';
      params.push(mode);
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    const rows = await all(db, sql, params);
    res.json(rows);
  });

  app.get('/api/runs/:runId', async (req, res) => {
    const runId = req.params.runId;
    const rows = await all(db, `SELECT * FROM backtest_runs WHERE run_id = ?`, [runId]);
    res.json(rows[0] ?? null);
  });

  app.post('/api/runs/:runId/cancel', async (req, res) => {
    const runId = req.params.runId;
    await run(
      db,
      `UPDATE backtest_runs SET status = 'cancelled', finished_at = NOW() WHERE run_id = ? AND status IN ('queued', 'running')`,
      [runId]
    );
    res.json({ success: true });
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
    const search_algo = String(req.body?.search_algo ?? 'grid').trim();
    const constraints_json = String(req.body?.constraints_json ?? '{}').trim();
    const grid_json = String(req.body?.grid_json ?? '').trim();

    if (!pathOnlyRunId) return res.status(400).json({ error: 'path_only_run_id required' });

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
      caller: caller || undefined,
      policy_type,
      search_algo,
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
      caller: caller || undefined,
      policy_type,
      search_algo,
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
  // Optimization Results
  // -----------------------------
  app.get('/api/optimize-results/:runId', async (req, res) => {
    const runId = req.params.runId;
    
    // For now, return mock data
    // In production, this would query the optimization results table
    res.json({
      results: [],
      quality_stats: {
        total: 0,
        passed: 0,
        failed: 0,
        pass_rate: 0,
        failure_reasons: {}
      }
    });
  });

  // -----------------------------
  // Equity Curve
  // -----------------------------
  app.get('/api/equity-curve/:runId', async (req, res) => {
    const runId = req.params.runId;
    const initialCapital = parseFloat(req.query.initial_capital as string) || 10000;
    const positionSizingMode = (req.query.position_sizing_mode as string) || 'fixed';
    const positionSizeValue = parseFloat(req.query.position_size_value as string) || 1000;
    
    // Query trade events from database
    // For now, return mock data structure
    res.json({
      equity_curve: [
        {
          timestamp_ms: Date.now() - 86400000,
          capital: initialCapital,
          pnl: 0,
          pnl_percent: 0,
          drawdown: 0,
          drawdown_percent: 0,
          position_count: 0,
        }
      ],
      metrics: {
        initial_capital: initialCapital,
        final_capital: initialCapital,
        total_pnl: 0,
        total_pnl_percent: 0,
        max_drawdown: 0,
        max_drawdown_percent: 0,
        sharpe_ratio: 0,
        total_trades: 0,
        wins: 0,
        losses: 0,
        win_rate: 0,
      },
      drawdown_periods: [],
    });
  });

  // -----------------------------
  // Trade Log
  // -----------------------------
  app.get('/api/trades/:runId', async (req, res) => {
    const runId = req.params.runId;
    
    // Query trades from database
    // For now, return empty array
    res.json([]);
  });

  // -----------------------------
  // Telemetry
  // -----------------------------
  app.get('/api/telemetry/slippage-drift/:runId', async (req, res) => {
    const runId = req.params.runId;
    
    // Query slippage telemetry
    // For now, return mock data
    res.json({
      run_id: runId,
      avg_expected_bps: 10.0,
      avg_actual_bps: 12.5,
      avg_delta_bps: 2.5,
      event_count: 0,
    });
  });

  app.get('/api/telemetry/latency-drift/:runId', async (req, res) => {
    const runId = req.params.runId;
    
    // Query latency telemetry
    // For now, return mock data
    res.json({
      run_id: runId,
      avg_expected_ms: 100.0,
      avg_actual_ms: 150.0,
      avg_delta_ms: 50.0,
      event_count: 0,
    });
  });

  app.get('/api/telemetry/calibration/:runId', async (req, res) => {
    const runId = req.params.runId;
    
    // Query calibration recommendations
    // For now, return empty recommendations
    res.json({
      run_id: runId,
      timestamp: Date.now(),
      recommendations: [],
    });
  });

  // -----------------------------
  // Governance
  // -----------------------------
  app.get('/api/governance/kill-switches', async (_req, res) => {
    // For now, return mock kill switch config
    res.json({
      global: {
        type: 'global',
        state: {
          enabled: false,
        },
      },
      strategies: [],
      dailyLossLimit: {
        type: 'daily_loss_limit',
        maxDailyLossUsd: 1000,
        currentDailyLossUsd: 0,
        resetAt: Date.now() + 86400000,
        state: {
          enabled: false,
        },
      },
      drawdownLimit: {
        type: 'drawdown',
        maxDrawdownPercent: 20,
        currentDrawdownPercent: 0,
        peakCapital: 10000,
        currentCapital: 10000,
        state: {
          enabled: false,
        },
      },
    });
  });

  app.post('/api/governance/kill-switches/global', express.json(), async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    const reason = String(req.body?.reason ?? '');

    // In production, update kill switch state in database
    res.json({ success: true, enabled });
  });

  app.post('/api/strategies/:strategyId/approve', express.json(), async (req, res) => {
    const strategyId = req.params.strategyId;
    const approvedBy = String(req.body?.approved_by ?? 'system');

    await run(
      db,
      `UPDATE backtest_strategies SET status = 'approved', approved_at = NOW(), approved_by = ? WHERE strategy_id = ?`,
      [approvedBy, strategyId]
    );

    res.json({ success: true });
  });

  app.post('/api/strategies/:strategyId/go-live', async (req, res) => {
    const strategyId = req.params.strategyId;

    await run(
      db,
      `UPDATE backtest_strategies SET status = 'live' WHERE strategy_id = ?`,
      [strategyId]
    );

    res.json({ success: true });
  });

  app.post('/api/strategies/:strategyId/deprecate', async (req, res) => {
    const strategyId = req.params.strategyId;

    await run(
      db,
      `UPDATE backtest_strategies SET status = 'deprecated' WHERE strategy_id = ?`,
      [strategyId]
    );

    res.json({ success: true });
  });

  // -----------------------------
  // Run Notes
  // -----------------------------
  app.get('/api/runs/:runId/notes', async (req, res) => {
    const runId = req.params.runId;
    const rows = await all(db, `SELECT * FROM backtest_run_notes WHERE run_id = ? ORDER BY created_at DESC`, [runId]);
    res.json(rows);
  });

  app.post('/api/runs/:runId/notes', express.json(), async (req, res) => {
    const runId = req.params.runId;
    const noteText = String(req.body?.note_text ?? '').trim();
    const tags = String(req.body?.tags ?? '').trim();

    if (!noteText) return res.status(400).json({ error: 'note_text required' });

    const noteId = nanoid(12);

    await run(
      db,
      `INSERT INTO backtest_run_notes(note_id, run_id, note_text, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [noteId, runId, noteText, tags || null]
    );

    res.json({ note_id: noteId });
  });

  app.delete('/api/runs/:runId/notes/:noteId', async (req, res) => {
    const noteId = req.params.noteId;
    await run(db, `DELETE FROM backtest_run_notes WHERE note_id = ?`, [noteId]);
    res.json({ success: true });
  });

  // -----------------------------
  // Learning Journal
  // -----------------------------
  app.get('/api/journal', async (_req, res) => {
    const rows = await all(db, `SELECT * FROM backtest_journal_entries ORDER BY created_at DESC`);
    res.json(rows);
  });

  app.post('/api/journal', express.json(), async (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    const content = String(req.body?.content ?? '').trim();
    const tags = String(req.body?.tags ?? '').trim();
    const linkedRuns = String(req.body?.linked_runs ?? '').trim();

    if (!title) return res.status(400).json({ error: 'title required' });
    if (!content) return res.status(400).json({ error: 'content required' });

    const entryId = nanoid(12);

    await run(
      db,
      `INSERT INTO backtest_journal_entries(entry_id, title, content, tags, linked_runs, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [entryId, title, content, tags || null, linkedRuns || null]
    );

    res.json({ entry_id: entryId });
  });

  app.delete('/api/journal/:entryId', async (req, res) => {
    const entryId = req.params.entryId;
    await run(db, `DELETE FROM backtest_journal_entries WHERE entry_id = ?`, [entryId]);
    res.json({ success: true });
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
    const sortBy = (req.query.sort_by as string) || 'objective_score';

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
        SUM(dd_neg_bps) AS total_drawdown_bps,
        -- Objective score (simplified)
        (AVG(net_return_pct) * AVG(win) - ABS(quantile_cont(dd_bps, 0.5)) / 10000.0) AS objective_score
      FROM enriched
      GROUP BY caller_name
      ORDER BY
        ${sortBy === 'objective_score' ? 'objective_score' : sortBy} DESC,
        calls DESC
    `;

    const rows = await all(db, sql, [runId]);
    res.json(rows);
  });

  // -----------------------------
  // Caller-Strategy Matrix
  // -----------------------------
  app.get('/api/caller-strategy-matrix/:runId', async (req, res) => {
    const runId = req.params.runId;

    // For now, return mock data
    // In production, this would query strategy performance per caller
    res.json([]);
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
}
