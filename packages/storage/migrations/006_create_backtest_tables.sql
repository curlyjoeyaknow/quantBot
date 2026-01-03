-- Backtest Schema Migration: Split Truth from Policy
-- 
-- Guardrail 1: Split Truth from Policy
-- - backtest_call_path_metrics: truth rows, 1 per eligible call, always
-- - backtest_policy_results: policy outcome rows, only when trades execute
--
-- This migration is idempotent (can run multiple times safely)

-- =============================================================================
-- Table 1: backtest_runs (extend existing from lab-ui if needed)
-- =============================================================================
CREATE TABLE IF NOT EXISTS backtest_runs (
  run_id TEXT PRIMARY KEY,
  strategy_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, done, error
  params_json TEXT,                         -- stores filter JSON for MVP (Guardrail 5)
  interval TEXT,
  time_from TIMESTAMP,
  time_to TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_status ON backtest_runs(status);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy ON backtest_runs(strategy_id);

-- =============================================================================
-- Table 2: backtest_call_path_metrics (NEW - truth rows, 1 per eligible call)
-- This is the TRUTH LAYER - always written, regardless of trades
-- =============================================================================
CREATE TABLE IF NOT EXISTS backtest_call_path_metrics (
  run_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  caller_name TEXT NOT NULL,
  mint TEXT NOT NULL,
  chain TEXT NOT NULL,
  interval TEXT NOT NULL,
  
  -- Anchor
  alert_ts_ms BIGINT NOT NULL,              -- t0_ms: alert timestamp in milliseconds
  p0 DOUBLE NOT NULL,                       -- anchor price (close of first candle at/after alert)
  
  -- Multiples (using candle.high to detect "touch")
  hit_2x BOOLEAN NOT NULL,
  t_2x_ms BIGINT,                           -- timestamp when 2x first touched (null if never)
  hit_3x BOOLEAN NOT NULL,
  t_3x_ms BIGINT,
  hit_4x BOOLEAN NOT NULL,
  t_4x_ms BIGINT,
  
  -- Drawdown (bps, negative = bad)
  dd_bps DOUBLE,                            -- min(low) from alert onward vs p0
  dd_to_2x_bps DOUBLE,                      -- min(low) from alert to first 2x hit
  
  -- Activity
  alert_to_activity_ms BIGINT,              -- time to first ±10% move from p0
  
  -- Summary
  peak_multiple DOUBLE,                     -- peak high / p0
  
  created_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (run_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_path_metrics_run ON backtest_call_path_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_path_metrics_caller ON backtest_call_path_metrics(caller_name);
CREATE INDEX IF NOT EXISTS idx_path_metrics_mint ON backtest_call_path_metrics(mint);

-- =============================================================================
-- Table 3: backtest_policies (policy definitions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS backtest_policies (
  policy_id TEXT PRIMARY KEY,
  caller_name TEXT,                         -- null = applies to all callers
  policy_json TEXT NOT NULL,                -- RiskPolicy JSON
  score DOUBLE,                             -- optimization score (if from optimizer)
  constraints_json TEXT,                    -- constraints used during optimization
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policies_caller ON backtest_policies(caller_name);

-- =============================================================================
-- Table 4: backtest_policy_results (NEW - policy outcome rows)
-- This is the POLICY LAYER - only written when policy is executed
-- =============================================================================
CREATE TABLE IF NOT EXISTS backtest_policy_results (
  run_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  
  -- Policy execution outcomes
  realized_return_bps DOUBLE NOT NULL,
  stop_out BOOLEAN NOT NULL,
  max_adverse_excursion_bps DOUBLE NOT NULL,
  time_exposed_ms BIGINT NOT NULL,
  tail_capture DOUBLE,                      -- realized / peak_multiple (if peak exists)
  
  -- Entry/exit details
  entry_ts_ms BIGINT NOT NULL,
  exit_ts_ms BIGINT NOT NULL,
  entry_px DOUBLE NOT NULL,
  exit_px DOUBLE NOT NULL,
  exit_reason TEXT,
  
  created_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (run_id, policy_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_results_run ON backtest_policy_results(run_id);
CREATE INDEX IF NOT EXISTS idx_policy_results_policy ON backtest_policy_results(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_results_run_policy ON backtest_policy_results(run_id, policy_id);

-- =============================================================================
-- Table 5: backtest_strategies (from lab-ui, ensure exists)
-- =============================================================================
CREATE TABLE IF NOT EXISTS backtest_strategies (
  strategy_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategies_name ON backtest_strategies(name);

