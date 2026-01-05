-- =============================================================================
-- QuantBot DuckDB Full Schema
-- 
-- This is a consolidated, idempotent schema for the entire DuckDB database.
-- All tables use CREATE TABLE IF NOT EXISTS for safe re-runs.
--
-- Sources consolidated:
--   - tools/telegram/schema.sql (base telegram tables)
--   - tools/telegram/schema_calls.sql (calls and token tracking)
--   - tools/telegram/duckdb_schema_idempotent.sql (idempotency layer)
--   - packages/storage/migrations/006_create_backtest_tables.sql (backtest)
--   - packages/lab/src/catalog/schema.sql (lab catalog)
--   - tools/storage/coverage_matrix_schema.sql (OHLCV coverage)
--   - tools/storage/create_token_lifespan_table.sql (token lifespan)
--
-- Usage:
--   duckdb data/alerts.duckdb < tools/storage/duckdb_full_schema.sql
-- =============================================================================

-- =============================================================================
-- SECTION 1: Schema Version Tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);

-- Insert initial version if not exists
INSERT OR IGNORE INTO schema_version (version, description) 
VALUES (2, 'Consolidated schema from multiple sources');

-- =============================================================================
-- SECTION 2: Telegram Chat Tables
-- =============================================================================

-- Chat metadata
CREATE TABLE IF NOT EXISTS tg_chats (
  chat_id TEXT PRIMARY KEY,
  chat_name TEXT,
  chat_type TEXT,
  chat_index INTEGER
);

-- Normalized telegram messages (original version)
CREATE TABLE IF NOT EXISTS tg_norm (
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  ts_ms INTEGER,
  from_name TEXT,
  from_id TEXT,
  type TEXT,
  is_service INTEGER NOT NULL DEFAULT 0,
  text TEXT,
  links_json TEXT,
  norm_json TEXT NOT NULL,
  chat_name TEXT,
  PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_norm_ts ON tg_norm(ts_ms);
CREATE INDEX IF NOT EXISTS idx_tg_norm_from ON tg_norm(from_id);

-- Quarantine for parse errors
CREATE TABLE IF NOT EXISTS tg_quarantine (
  chat_id TEXT,
  chat_name TEXT,
  message_id INTEGER,
  ts_ms INTEGER,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tg_quarantine_code ON tg_quarantine(error_code);

-- =============================================================================
-- SECTION 3: Ingestion Tracking (Idempotency Layer)
-- =============================================================================

-- Ingestion runs tracking
CREATE TABLE IF NOT EXISTS ingestion_runs (
  run_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  input_file_path TEXT NOT NULL,
  input_file_hash TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'running', 'completed', 'failed', 'partial'
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  rows_inserted_tg_norm INTEGER DEFAULT 0,
  rows_inserted_caller_links INTEGER DEFAULT 0,
  rows_inserted_user_calls INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_chat_id ON ingestion_runs(chat_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_input_hash ON ingestion_runs(input_file_hash);

-- =============================================================================
-- SECTION 4: Normalized Telegram Messages (with run_id tracking)
-- =============================================================================

-- Enhanced tg_norm_d with run_id and PRIMARY KEY
CREATE TABLE IF NOT EXISTS tg_norm_d (
  chat_id TEXT NOT NULL,
  chat_name TEXT,
  message_id BIGINT NOT NULL,
  ts_ms BIGINT,
  from_name TEXT,
  from_id TEXT,
  type TEXT,
  is_service BOOLEAN,
  reply_to_message_id BIGINT,
  text TEXT,
  links_json TEXT,
  norm_json TEXT,
  run_id TEXT NOT NULL DEFAULT 'legacy',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_norm_run_id ON tg_norm_d(run_id);
CREATE INDEX IF NOT EXISTS idx_tg_norm_chat_message ON tg_norm_d(chat_id, message_id);

-- =============================================================================
-- SECTION 5: Caller Links (Bot message extraction)
-- =============================================================================

-- Enhanced caller_links_d with run_id and PRIMARY KEY
CREATE TABLE IF NOT EXISTS caller_links_d (
  trigger_chat_id TEXT NOT NULL,
  trigger_message_id BIGINT NOT NULL,
  trigger_ts_ms BIGINT,
  trigger_from_id TEXT,
  trigger_from_name TEXT,
  trigger_text TEXT,
  bot_message_id BIGINT NOT NULL,
  bot_ts_ms BIGINT,
  bot_from_name TEXT,
  bot_type TEXT,
  token_name TEXT,
  ticker TEXT,
  mint TEXT,
  mint_raw TEXT,
  mint_validation_status TEXT,
  mint_validation_reason TEXT,
  chain TEXT,
  platform TEXT,
  token_age_s BIGINT,
  token_created_ts_ms BIGINT,
  views BIGINT,
  price_usd DOUBLE,
  price_move_pct DOUBLE,
  mcap_usd DOUBLE,
  mcap_change_pct DOUBLE,
  vol_usd DOUBLE,
  liquidity_usd DOUBLE,
  zero_liquidity BOOLEAN DEFAULT FALSE,
  chg_1h_pct DOUBLE,
  buys_1h BIGINT,
  sells_1h BIGINT,
  ath_mcap_usd DOUBLE,
  ath_drawdown_pct DOUBLE,
  ath_age_s BIGINT,
  fresh_1d_pct DOUBLE,
  fresh_7d_pct DOUBLE,
  top10_pct DOUBLE,
  holders_total BIGINT,
  top5_holders_pct_json TEXT,
  dev_sold BOOLEAN,
  dex_paid BOOLEAN,
  card_json TEXT,
  validation_passed BOOLEAN,
  run_id TEXT NOT NULL DEFAULT 'legacy',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trigger_chat_id, trigger_message_id, bot_message_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_caller_links_run_id ON caller_links_d(run_id);
CREATE INDEX IF NOT EXISTS idx_caller_links_mint ON caller_links_d(mint);

-- =============================================================================
-- SECTION 6: User Calls (Call tracking)
-- =============================================================================

-- User calls (original version with autoincrement)
CREATE TABLE IF NOT EXISTS user_calls (
  id INTEGER PRIMARY KEY,
  caller_name TEXT NOT NULL,
  caller_id TEXT,
  call_datetime TIMESTAMP NOT NULL,
  call_ts_ms INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  bot_reply_id_1 INTEGER,
  bot_reply_id_2 INTEGER,
  mint TEXT,
  ticker TEXT,
  mcap_usd REAL,
  price_usd REAL,
  first_caller INTEGER NOT NULL DEFAULT 0,
  trigger_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_user_calls_mint ON user_calls(mint);
CREATE INDEX IF NOT EXISTS idx_user_calls_caller ON user_calls(caller_name);
CREATE INDEX IF NOT EXISTS idx_user_calls_datetime ON user_calls(call_datetime);

-- Enhanced user_calls_d with run_id
CREATE TABLE IF NOT EXISTS user_calls_d (
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  call_ts_ms BIGINT,
  call_datetime TIMESTAMP,
  caller_name TEXT,
  caller_id TEXT,
  trigger_text TEXT,
  bot_reply_id_1 BIGINT,
  bot_reply_id_2 BIGINT,
  mint TEXT,
  ticker TEXT,
  mcap_usd DOUBLE,
  price_usd DOUBLE,
  first_caller BOOLEAN DEFAULT FALSE,
  run_id TEXT NOT NULL DEFAULT 'legacy',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_user_calls_d_run_id ON user_calls_d(run_id);
CREATE INDEX IF NOT EXISTS idx_user_calls_d_mint ON user_calls_d(mint);

-- =============================================================================
-- SECTION 7: Token Tables
-- =============================================================================

-- Tokens metadata: static/rarely-changing token info
CREATE TABLE IF NOT EXISTS tokens_metadata (
  mint TEXT PRIMARY KEY,
  name TEXT,
  ticker TEXT,
  social_x TEXT,
  social_telegram TEXT,
  social_discord TEXT,
  social_website TEXT,
  social_tiktok TEXT,
  social_facebook TEXT,
  supply REAL,
  creator TEXT,
  created_date TIMESTAMP,
  first_call_date TIMESTAMP,
  first_caller_name TEXT,
  first_mcap REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tokens data: frequently-updated token metrics
CREATE TABLE IF NOT EXISTS tokens_data (
  mint TEXT PRIMARY KEY,
  ticker TEXT,
  mcap REAL,
  current_mcap REAL,
  last_update TIMESTAMP,
  price REAL,
  supply REAL,
  ath_mcap REAL,
  ath_date TIMESTAMP,
  liquidity REAL,
  liquidity_x REAL,
  top_holders_pct_1 REAL,
  top_holders_pct_2 REAL,
  top_holders_pct_3 REAL,
  top_holders_pct_4 REAL,
  top_holders_pct_5 REAL,
  top_holders_sum_pct REAL,
  active INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tokens_data_active ON tokens_data(active);
CREATE INDEX IF NOT EXISTS idx_tokens_data_last_update ON tokens_data(last_update);

-- Bot observations: raw observations from each bot
CREATE TABLE IF NOT EXISTS bot_observations (
  id INTEGER PRIMARY KEY,
  mint TEXT,
  ticker TEXT,
  bot_name TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  observed_at TIMESTAMP NOT NULL,
  card_json TEXT NOT NULL,
  mcap_usd REAL,
  price_usd REAL,
  liquidity_usd REAL,
  volume_usd REAL,
  ath_mcap_usd REAL,
  ath_age_days INTEGER,
  top_holders_pct_1 REAL,
  top_holders_pct_2 REAL,
  top_holders_pct_3 REAL,
  top_holders_pct_4 REAL,
  top_holders_pct_5 REAL,
  top_holders_sum_pct REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bot_name, message_id)
);

-- Quarantine: conflicting data between bots
CREATE TABLE IF NOT EXISTS token_quarantine (
  id INTEGER PRIMARY KEY,
  mint TEXT,
  ticker TEXT,
  field_name TEXT NOT NULL,
  rick_value TEXT,
  phanes_value TEXT,
  message_id_rick INTEGER,
  message_id_phanes INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token lifespan (Birdeye API cache)
CREATE TABLE IF NOT EXISTS token_lifespan (
  mint VARCHAR PRIMARY KEY,
  chain VARCHAR DEFAULT 'solana',
  name VARCHAR,
  symbol VARCHAR,
  creation_time TIMESTAMP,
  last_trade_time TIMESTAMP,
  last_trade_unix INTEGER,
  liquidity DOUBLE,
  price DOUBLE,
  is_active BOOLEAN,
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_token_lifespan_active ON token_lifespan(is_active);
CREATE INDEX IF NOT EXISTS idx_token_lifespan_fetched ON token_lifespan(fetched_at);

-- =============================================================================
-- SECTION 8: OHLCV Coverage Matrix
-- =============================================================================

CREATE TABLE IF NOT EXISTS ohlcv_coverage_matrix (
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  trigger_ts_ms BIGINT NOT NULL,
  caller_name TEXT,
  mint TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'solana',
  has_ohlcv_data BOOLEAN NOT NULL DEFAULT FALSE,
  coverage_ratio DOUBLE NOT NULL DEFAULT 0.0,
  expected_candles INTEGER,
  actual_candles INTEGER,
  intervals_available TEXT,
  pre_window_minutes INTEGER DEFAULT 260,
  post_window_minutes INTEGER DEFAULT 1440,
  coverage_start_ts_ms BIGINT,
  coverage_end_ts_ms BIGINT,
  last_checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, mint, chain)
);

CREATE INDEX IF NOT EXISTS idx_coverage_matrix_mint ON ohlcv_coverage_matrix(mint);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_caller ON ohlcv_coverage_matrix(caller_name);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_trigger_ts ON ohlcv_coverage_matrix(trigger_ts_ms);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_has_data ON ohlcv_coverage_matrix(has_ohlcv_data);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_coverage_ratio ON ohlcv_coverage_matrix(coverage_ratio);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_last_checked ON ohlcv_coverage_matrix(last_checked_at);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_caller_mint ON ohlcv_coverage_matrix(caller_name, mint);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_mint_has_data ON ohlcv_coverage_matrix(mint, has_ohlcv_data);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_caller_has_data ON ohlcv_coverage_matrix(caller_name, has_ohlcv_data);

-- Coverage views
CREATE OR REPLACE VIEW token_coverage_summary AS
SELECT 
  mint,
  chain,
  COUNT(*) as total_alerts,
  COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) as alerts_with_coverage,
  COUNT(*) FILTER (WHERE has_ohlcv_data = FALSE) as alerts_without_coverage,
  AVG(coverage_ratio) as avg_coverage_ratio,
  MIN(coverage_ratio) as min_coverage_ratio,
  MAX(coverage_ratio) as max_coverage_ratio,
  MIN(trigger_ts_ms) as first_alert_ts_ms,
  MAX(trigger_ts_ms) as last_alert_ts_ms
FROM ohlcv_coverage_matrix
GROUP BY mint, chain;

CREATE OR REPLACE VIEW caller_coverage_summary AS
SELECT 
  caller_name,
  COUNT(*) as total_calls,
  COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) as calls_with_coverage,
  COUNT(*) FILTER (WHERE has_ohlcv_data = FALSE) as calls_without_coverage,
  AVG(coverage_ratio) as avg_coverage_ratio,
  MIN(coverage_ratio) as min_coverage_ratio,
  MAX(coverage_ratio) as max_coverage_ratio,
  MIN(trigger_ts_ms) as first_call_ts_ms,
  MAX(trigger_ts_ms) as last_call_ts_ms
FROM ohlcv_coverage_matrix
WHERE caller_name IS NOT NULL
GROUP BY caller_name;

CREATE OR REPLACE VIEW caller_monthly_coverage AS
SELECT 
  caller_name,
  strftime(to_timestamp(trigger_ts_ms / 1000), '%Y-%m') as month,
  COUNT(*) as total_calls,
  COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) as calls_with_coverage,
  COUNT(*) FILTER (WHERE has_ohlcv_data = FALSE) as calls_without_coverage,
  CAST(COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) AS DOUBLE) / COUNT(*) as coverage_ratio,
  AVG(coverage_ratio) as avg_coverage_ratio
FROM ohlcv_coverage_matrix
WHERE caller_name IS NOT NULL
GROUP BY caller_name, month
ORDER BY caller_name, month;

CREATE OR REPLACE VIEW alerts_missing_coverage AS
SELECT 
  chat_id,
  message_id,
  trigger_ts_ms,
  caller_name,
  mint,
  chain,
  coverage_ratio,
  expected_candles,
  actual_candles,
  last_checked_at
FROM ohlcv_coverage_matrix
WHERE has_ohlcv_data = FALSE OR coverage_ratio < 0.8
ORDER BY trigger_ts_ms DESC;

-- =============================================================================
-- SECTION 9: Backtest Tables
-- =============================================================================

-- Backtest call results (legacy/combined table - used by caller-leaderboard, caller-path-report, run-list)
CREATE TABLE IF NOT EXISTS backtest_call_results (
  run_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  caller_name TEXT NOT NULL,
  mint TEXT NOT NULL,
  interval TEXT NOT NULL,

  entry_ts_ms BIGINT NOT NULL,
  exit_ts_ms BIGINT NOT NULL,
  entry_px DOUBLE NOT NULL,
  exit_px DOUBLE NOT NULL,

  return_bps DOUBLE NOT NULL,
  pnl_usd DOUBLE NOT NULL,

  hold_ms BIGINT NOT NULL,
  max_favorable_bps DOUBLE,
  max_adverse_bps DOUBLE,
  exit_reason TEXT,

  -- Path metrics columns (for backwards compatibility)
  t0_ms BIGINT,
  p0 DOUBLE,
  hit_2x BOOLEAN,
  t_2x_ms BIGINT,
  hit_3x BOOLEAN,
  t_3x_ms BIGINT,
  hit_4x BOOLEAN,
  t_4x_ms BIGINT,
  dd_bps DOUBLE,
  dd_to_2x_bps DOUBLE,
  alert_to_activity_ms BIGINT,
  peak_multiple DOUBLE,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_btr_run ON backtest_call_results(run_id);
CREATE INDEX IF NOT EXISTS idx_btr_caller ON backtest_call_results(caller_name);
CREATE INDEX IF NOT EXISTS idx_btr_mint ON backtest_call_results(mint);

-- Backtest runs
CREATE TABLE IF NOT EXISTS backtest_runs (
  run_id TEXT PRIMARY KEY,
  strategy_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  params_json TEXT,
  run_mode TEXT DEFAULT 'exit-optimizer',  -- path-only, exit-optimizer, exit-stack, policy
  interval TEXT,
  time_from TIMESTAMP,
  time_to TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_status ON backtest_runs(status);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy ON backtest_runs(strategy_id);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_mode ON backtest_runs(run_mode);

-- Backtest call path metrics (truth layer)
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_path_metrics_run ON backtest_call_path_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_path_metrics_caller ON backtest_call_path_metrics(caller_name);
CREATE INDEX IF NOT EXISTS idx_path_metrics_mint ON backtest_call_path_metrics(mint);

-- Backtest policies
CREATE TABLE IF NOT EXISTS backtest_policies (
  policy_id TEXT PRIMARY KEY,
  caller_name TEXT,
  policy_json TEXT NOT NULL,
  score DOUBLE,
  constraints_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_policies_caller ON backtest_policies(caller_name);

-- Backtest policy results (policy layer)
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, policy_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_results_run ON backtest_policy_results(run_id);
CREATE INDEX IF NOT EXISTS idx_policy_results_policy ON backtest_policy_results(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_results_run_policy ON backtest_policy_results(run_id, policy_id);

-- Backtest strategies
CREATE TABLE IF NOT EXISTS backtest_strategies (
  strategy_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_strategies_name ON backtest_strategies(name);

-- =============================================================================
-- SECTION 10: Lab Catalog Tables
-- =============================================================================

-- Token sets: stable IDs from sorted token lists
CREATE TABLE IF NOT EXISTS token_sets (
  token_set_id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  tokens_sha TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Slices: dataset + time range + token set + schema
CREATE TABLE IF NOT EXISTS slices (
  slice_id TEXT PRIMARY KEY,
  dataset TEXT NOT NULL,
  chain TEXT NOT NULL,
  interval TEXT NOT NULL,
  start_iso TEXT NOT NULL,
  end_iso TEXT NOT NULL,
  token_set_id TEXT NOT NULL,
  schema_hash TEXT NOT NULL,
  slice_hash TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (token_set_id) REFERENCES token_sets(token_set_id)
);

CREATE INDEX IF NOT EXISTS idx_slices_lookup ON slices(dataset, chain, interval, start_iso, end_iso, token_set_id, schema_hash);

-- Feature sets: feature spec hashes
CREATE TABLE IF NOT EXISTS feature_sets (
  feature_set_id TEXT PRIMARY KEY,
  feature_spec_hash TEXT NOT NULL,
  feature_spec_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Features: slice + feature set combinations
CREATE TABLE IF NOT EXISTS features (
  features_id TEXT PRIMARY KEY,
  slice_id TEXT NOT NULL,
  feature_set_id TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  parquet_path TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (slice_id) REFERENCES slices(slice_id),
  FOREIGN KEY (feature_set_id) REFERENCES feature_sets(feature_set_id)
);

CREATE INDEX IF NOT EXISTS idx_features_lookup ON features(slice_id, feature_set_id);

-- Simulation runs: features + strategy + risk + window
CREATE TABLE IF NOT EXISTS sim_runs (
  sim_id TEXT PRIMARY KEY,
  features_id TEXT NOT NULL,
  strategy_hash TEXT NOT NULL,
  risk_hash TEXT NOT NULL,
  window_id TEXT,
  summary_path TEXT NOT NULL,
  artifact_dir TEXT NOT NULL,
  code_version TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (features_id) REFERENCES features(features_id)
);

CREATE INDEX IF NOT EXISTS idx_sim_runs_features ON sim_runs(features_id);
CREATE INDEX IF NOT EXISTS idx_sim_runs_strategy ON sim_runs(strategy_hash);
CREATE INDEX IF NOT EXISTS idx_sim_runs_risk ON sim_runs(risk_hash);

-- =============================================================================
-- SECTION 11: Simulation Tables (tools/simulation)
-- =============================================================================

-- Strategy definitions for simulation
CREATE TABLE IF NOT EXISTS simulation_strategies (
  strategy_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entry_config JSON,
  exit_config JSON,
  reentry_config JSON,
  cost_config JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Simulation runs (one per strategy + token + time window)
CREATE TABLE IF NOT EXISTS simulation_runs (
  run_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  mint TEXT NOT NULL,
  alert_timestamp TIMESTAMP NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  initial_capital DOUBLE NOT NULL,
  final_capital DOUBLE,
  total_return_pct DOUBLE,
  max_drawdown_pct DOUBLE,
  sharpe_ratio DOUBLE,
  win_rate DOUBLE,
  total_trades INTEGER,
  caller_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_strategy ON simulation_runs(strategy_id);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_mint ON simulation_runs(mint);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_alert_timestamp ON simulation_runs(alert_timestamp);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_caller ON simulation_runs(caller_name);

-- Strategy configurations (run-specific parameters)
CREATE TABLE IF NOT EXISTS strategy_config (
  strategy_config_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  entry_config JSON NOT NULL,
  exit_config JSON NOT NULL,
  reentry_config JSON,
  cost_config JSON,
  stop_loss_config JSON,
  entry_signal_config JSON,
  exit_signal_config JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_strategy_config_strategy_id ON strategy_config(strategy_id);

-- Run strategies used (links runs to their exact strategy configuration)
CREATE TABLE IF NOT EXISTS run_strategies_used (
  run_id TEXT NOT NULL,
  strategy_config_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id)
);

CREATE INDEX IF NOT EXISTS idx_run_strategies_used_config ON run_strategies_used(strategy_config_id);

-- Simulation events (trades, entries, exits)
CREATE TABLE IF NOT EXISTS simulation_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  price DOUBLE NOT NULL,
  quantity DOUBLE NOT NULL,
  value_usd DOUBLE NOT NULL,
  fee_usd DOUBLE NOT NULL,
  pnl_usd DOUBLE,
  cumulative_pnl_usd DOUBLE,
  position_size DOUBLE,
  metadata JSON
);

CREATE INDEX IF NOT EXISTS idx_simulation_events_run ON simulation_events(run_id);

-- OHLCV candles for simulation
CREATE TABLE IF NOT EXISTS ohlcv_candles_d (
  mint TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  volume DOUBLE NOT NULL,
  interval_seconds INTEGER NOT NULL,
  source TEXT,
  PRIMARY KEY (mint, timestamp, interval_seconds)
);

CREATE INDEX IF NOT EXISTS idx_ohlcv_mint_timestamp ON ohlcv_candles_d(mint, timestamp);

-- OHLCV metadata
CREATE TABLE IF NOT EXISTS ohlcv_metadata_d (
  mint VARCHAR NOT NULL,
  alert_timestamp TIMESTAMP NOT NULL,
  interval_seconds INTEGER NOT NULL,
  time_range_start TIMESTAMP NOT NULL,
  time_range_end TIMESTAMP NOT NULL,
  candle_count INTEGER NOT NULL,
  last_updated TIMESTAMP NOT NULL,
  PRIMARY KEY (mint, alert_timestamp, interval_seconds)
);

-- OHLCV exclusions (tokens to skip)
CREATE TABLE IF NOT EXISTS ohlcv_exclusions_d (
  token_address VARCHAR NOT NULL,
  chain VARCHAR NOT NULL,
  interval VARCHAR NOT NULL,
  excluded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason VARCHAR NOT NULL,
  PRIMARY KEY (token_address, chain, interval)
);

CREATE INDEX IF NOT EXISTS idx_ohlcv_exclusions_token_address ON ohlcv_exclusions_d(token_address);
CREATE INDEX IF NOT EXISTS idx_ohlcv_exclusions_chain ON ohlcv_exclusions_d(chain);
CREATE INDEX IF NOT EXISTS idx_ohlcv_exclusions_interval ON ohlcv_exclusions_d(interval);

-- =============================================================================
-- SECTION 12: Run Status (Lab/Simulation Tracking)
-- =============================================================================

-- Run status table (used by lab, simulation runners)
CREATE TABLE IF NOT EXISTS run_status (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  strategy_id TEXT,
  strategy_version TEXT,
  config_json TEXT,
  summary_json TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_run_status_status ON run_status(status);
CREATE INDEX IF NOT EXISTS idx_run_status_strategy ON run_status(strategy_id);
CREATE INDEX IF NOT EXISTS idx_run_status_created_at ON run_status(created_at);

-- =============================================================================
-- SECTION 13: Baseline Schema (tools/backtest - pure path metrics)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS baseline;

-- Baseline runs
CREATE TABLE IF NOT EXISTS baseline.runs_d (
  run_id TEXT PRIMARY KEY,
  created_at TIMESTAMP,
  run_name TEXT,
  date_from DATE,
  date_to DATE,
  interval_seconds INTEGER,
  horizon_hours INTEGER,
  chain TEXT,
  alerts_total INTEGER,
  alerts_ok INTEGER,
  config_json TEXT,
  summary_json TEXT,
  slice_path TEXT,
  partitioned BOOLEAN
);

-- Baseline alert results (per-alert metrics)
CREATE TABLE IF NOT EXISTS baseline.alert_results_f (
  run_id TEXT,
  alert_id BIGINT,
  mint TEXT,
  caller TEXT,
  alert_ts_utc TIMESTAMP,
  entry_ts_utc TIMESTAMP,
  status TEXT,
  candles BIGINT,
  entry_price DOUBLE,
  ath_mult DOUBLE,
  time_to_ath_s BIGINT,
  time_to_2x_s BIGINT,
  time_to_3x_s BIGINT,
  time_to_4x_s BIGINT,
  time_to_5x_s BIGINT,
  time_to_10x_s BIGINT,
  dd_initial DOUBLE,
  dd_overall DOUBLE,
  dd_pre2x DOUBLE,
  dd_after_2x DOUBLE,
  dd_after_3x DOUBLE,
  dd_after_4x DOUBLE,
  dd_after_5x DOUBLE,
  dd_after_10x DOUBLE,
  dd_after_ath DOUBLE,
  peak_pnl_pct DOUBLE,
  ret_end_pct DOUBLE,
  PRIMARY KEY(run_id, alert_id)
);

-- Baseline caller stats (per-caller aggregations)
CREATE TABLE IF NOT EXISTS baseline.caller_stats_f (
  run_id TEXT,
  caller TEXT,
  n INTEGER,
  median_ath DOUBLE,
  p25_ath DOUBLE,
  p75_ath DOUBLE,
  p95_ath DOUBLE,
  hit2x_pct DOUBLE,
  hit3x_pct DOUBLE,
  hit4x_pct DOUBLE,
  hit5x_pct DOUBLE,
  hit10x_pct DOUBLE,
  median_t2x_hrs DOUBLE,
  median_dd_initial_pct DOUBLE,
  median_dd_overall_pct DOUBLE,
  median_dd_pre2x_pct DOUBLE,
  median_dd_pre2x_or_horizon_pct DOUBLE,
  median_dd_after_2x_pct DOUBLE,
  median_dd_after_3x_pct DOUBLE,
  median_dd_after_ath_pct DOUBLE,
  worst_dd_pct DOUBLE,
  median_peak_pnl_pct DOUBLE,
  median_ret_end_pct DOUBLE
);

-- Baseline trades (one row per trade)
CREATE TABLE IF NOT EXISTS baseline.trades_d (
  trade_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  caller TEXT NOT NULL,
  token_address TEXT NOT NULL,
  entry_mode TEXT DEFAULT 'immediate',
  alert_timestamp_ms BIGINT NOT NULL,
  entry_timestamp_ms BIGINT NOT NULL,
  exit_timestamp_ms BIGINT,
  entry_price DOUBLE NOT NULL,
  stop_price DOUBLE,
  exit_price DOUBLE,
  peak_mult DOUBLE,
  trough_mult DOUBLE,
  final_mult DOUBLE,
  dd_initial DOUBLE,
  dd_max DOUBLE,
  dd_pre2x DOUBLE,
  dd_pre2x_or_horizon DOUBLE,
  time_to_peak_ms BIGINT,
  time_to_2x_ms BIGINT,
  time_to_3x_ms BIGINT,
  exit_reason TEXT,
  gross_return DOUBLE,
  net_return DOUBLE,
  stop_pct DOUBLE,
  position_pct DOUBLE,
  planned_risk_pct DOUBLE,
  realized_loss_pct DOUBLE,
  portfolio_pnl_pct DOUBLE,
  r_multiple DOUBLE,
  hit_2x BOOLEAN,
  hit_3x BOOLEAN,
  hit_4x BOOLEAN,
  is_win BOOLEAN
);

CREATE INDEX IF NOT EXISTS trades_caller_idx ON baseline.trades_d(caller);
CREATE INDEX IF NOT EXISTS trades_run_idx ON baseline.trades_d(run_id);

-- Baseline views
CREATE OR REPLACE VIEW baseline.caller_leaderboard_v AS
SELECT
  run_id,
  caller,
  n,
  median_ath,
  p75_ath,
  p95_ath,
  hit2x_pct,
  hit3x_pct,
  hit4x_pct,
  hit5x_pct,
  median_t2x_hrs,
  median_dd_initial_pct,
  median_dd_overall_pct,
  median_dd_pre2x_pct,
  median_dd_pre2x_or_horizon_pct,
  median_dd_after_2x_pct,
  median_dd_after_ath_pct,
  median_peak_pnl_pct,
  median_ret_end_pct
FROM baseline.caller_stats_f
ORDER BY run_id, median_ath DESC;

CREATE OR REPLACE VIEW baseline.run_summary_v AS
SELECT
  run_id, created_at, run_name, chain, date_from, date_to, interval_seconds, horizon_hours,
  alerts_total, alerts_ok,
  json_extract_string(summary_json, '$.median_ath_mult') AS median_ath_mult,
  json_extract_string(summary_json, '$.pct_hit_2x') AS pct_hit_2x,
  json_extract_string(summary_json, '$.median_dd_overall') AS median_dd_overall,
  json_extract_string(summary_json, '$.median_peak_pnl_pct') AS median_peak_pnl_pct
FROM baseline.runs_d
ORDER BY created_at DESC;

-- =============================================================================
-- SECTION 14: BT Schema (tools/backtest - TP/SL strategy results)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS bt;

-- BT runs
CREATE TABLE IF NOT EXISTS bt.runs_d (
  run_id TEXT PRIMARY KEY,
  created_at TIMESTAMP,
  run_name VARCHAR,
  strategy_name VARCHAR,
  strategy_version VARCHAR,
  candle_interval_s INTEGER,
  window_from_ts_ms BIGINT,
  window_to_ts_ms BIGINT,
  entry_rule VARCHAR,
  exit_rule VARCHAR,
  config_json TEXT,
  notes VARCHAR
);

-- BT alert scenarios
CREATE TABLE IF NOT EXISTS bt.alert_scenarios_d (
  scenario_id TEXT PRIMARY KEY,
  created_at TIMESTAMP,
  run_id TEXT,
  alert_id BIGINT,
  mint VARCHAR,
  alert_ts_ms BIGINT,
  entry_ts_ms BIGINT,
  end_ts_ms BIGINT,
  interval_seconds INTEGER,
  eval_window_s INTEGER,
  caller_name VARCHAR,
  scenario_json TEXT
);

-- BT alert outcomes
CREATE TABLE IF NOT EXISTS bt.alert_outcomes_f (
  scenario_id TEXT PRIMARY KEY,
  computed_at TIMESTAMP,
  entry_price_usd DOUBLE,
  entry_ts_ms BIGINT,
  ath_multiple DOUBLE,
  time_to_2x_s INTEGER,
  time_to_3x_s INTEGER,
  time_to_4x_s INTEGER,
  max_drawdown_pct DOUBLE,
  hit_2x BOOLEAN,
  candles_seen INTEGER,
  tp_sl_exit_reason VARCHAR,
  tp_sl_ret DOUBLE,
  details_json TEXT
);

-- BT metrics
CREATE TABLE IF NOT EXISTS bt.metrics_f (
  run_id TEXT,
  metric_name VARCHAR,
  metric_value DOUBLE,
  computed_at TIMESTAMP
);

-- =============================================================================
-- SCHEMA COMPLETE
-- =============================================================================

