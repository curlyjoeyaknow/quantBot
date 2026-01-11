import type { DuckDb } from './db.js';
import { exec } from './db.js';

/**
 * Ensure UI schema exists
 *
 * Phase 6 - MVP 4: Extends schema to support truth layer and policy tables
 */
export async function ensureUiSchema(db: DuckDb) {
  // Use exec(): it can execute multiple DDL statements in one call (no params).
  await exec(
    db,
    `-- Strategies table
    CREATE TABLE IF NOT EXISTS backtest_strategies (
      strategy_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    );

    -- Runs table (extended for path-only mode)
    CREATE TABLE IF NOT EXISTS backtest_runs (
      run_id TEXT PRIMARY KEY,
      strategy_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      params_json TEXT NOT NULL,
      -- Run mode: path-only, exit-optimizer, exit-stack, policy
      run_mode TEXT DEFAULT 'exit-optimizer',
      -- Interval and date range
      interval TEXT,
      time_from TIMESTAMP,
      time_to TIMESTAMP,
      -- Timestamps
      created_at TIMESTAMP DEFAULT now(),
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      error_text TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_created ON backtest_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON backtest_runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_mode ON backtest_runs(run_mode);

    -- Policies table (Phase 5 - optimizer results)
    CREATE TABLE IF NOT EXISTS backtest_policies (
      policy_id TEXT PRIMARY KEY,
      caller_name TEXT,
      policy_json TEXT NOT NULL,
      score DOUBLE,
      constraints_json TEXT,
      created_at TIMESTAMP DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_policies_caller ON backtest_policies(caller_name);

    -- Path metrics table (Phase 2 - truth layer)
    CREATE TABLE IF NOT EXISTS backtest_call_path_metrics (
      run_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      mint TEXT NOT NULL,
      chain TEXT NOT NULL,
      interval TEXT NOT NULL,
      
      alert_ts_ms BIGINT NOT NULL,
      p0 DOUBLE NOT NULL,
      
      hit_2x BOOLEAN NOT NULL,
      t_2x_ms BIGINT,
      hit_3x BOOLEAN NOT NULL,
      t_3x_ms BIGINT,
      hit_4x BOOLEAN NOT NULL,
      t_4x_ms BIGINT,
      
      dd_bps DOUBLE,
      dd_to_2x_bps DOUBLE,
      alert_to_activity_ms BIGINT,
      peak_multiple DOUBLE,
      
      created_at TIMESTAMP DEFAULT now(),
      PRIMARY KEY (run_id, call_id)
    );

    CREATE INDEX IF NOT EXISTS idx_path_metrics_run ON backtest_call_path_metrics(run_id);
    CREATE INDEX IF NOT EXISTS idx_path_metrics_caller ON backtest_call_path_metrics(caller_name);

    -- Policy results table (Phase 4 - policy outcomes)
    CREATE TABLE IF NOT EXISTS backtest_policy_results (
      run_id TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      
      realized_return_bps DOUBLE NOT NULL,
      stop_out BOOLEAN NOT NULL,
      max_adverse_excursion_bps DOUBLE NOT NULL,
      time_exposed_ms BIGINT NOT NULL,
      tail_capture DOUBLE,
      
      entry_ts_ms BIGINT NOT NULL,
      exit_ts_ms BIGINT NOT NULL,
      entry_px DOUBLE NOT NULL,
      exit_px DOUBLE NOT NULL,
      exit_reason TEXT,
      
      created_at TIMESTAMP DEFAULT now(),
      PRIMARY KEY (run_id, policy_id, call_id)
    );

    CREATE INDEX IF NOT EXISTS idx_policy_results_run ON backtest_policy_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_policy_results_policy ON backtest_policy_results(policy_id);`
  );
}
