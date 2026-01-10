-- Database restoration script
-- Generated from data/exports schema definitions
-- Run: duckdb data/alerts.duckdb < restore_database_complete.sql

-- Step 1: Create all schemas
CREATE SCHEMA IF NOT EXISTS baseline;
CREATE SCHEMA IF NOT EXISTS bt;
CREATE SCHEMA IF NOT EXISTS canon;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS optimizer;
CREATE SCHEMA IF NOT EXISTS raw;

-- Step 2: Create all tables (54 tables)

CREATE TABLE IF NOT EXISTS baseline.alert_results_f (
  run_id VARCHAR NOT NULL,
  alert_id BIGINT NOT NULL,
  mint VARCHAR,
  caller VARCHAR,
  alert_ts_utc TIMESTAMP,
  entry_ts_utc TIMESTAMP,
  status VARCHAR,
  candles BIGINT,
  entry_price DOUBLE,
  ath_mult DOUBLE,
  time_to_ath_s BIGINT,
  time_to_recovery_s BIGINT,
  time_to_2x_s BIGINT,
  time_to_3x_s BIGINT,
  time_to_4x_s BIGINT,
  time_to_5x_s BIGINT,
  time_to_10x_s BIGINT,
  time_to_dd_pre2x_s BIGINT,
  time_to_dd_after_2x_s BIGINT,
  time_to_dd_after_3x_s BIGINT,
  dd_initial DOUBLE,
  dd_overall DOUBLE,
  dd_pre2x DOUBLE,
  dd_pre2x_or_horizon DOUBLE,
  dd_after_2x DOUBLE,
  dd_after_3x DOUBLE,
  dd_after_4x DOUBLE,
  dd_after_5x DOUBLE,
  dd_after_10x DOUBLE,
  dd_after_ath DOUBLE,
  peak_pnl_pct DOUBLE,
  ret_end_pct DOUBLE
);

CREATE TABLE IF NOT EXISTS baseline.caller_stats_f (
  run_id VARCHAR,
  caller VARCHAR,
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

CREATE TABLE IF NOT EXISTS baseline.runs_d (
  run_id VARCHAR NOT NULL,
  created_at TIMESTAMP,
  run_name VARCHAR,
  date_from DATE,
  date_to DATE,
  interval_seconds INTEGER,
  horizon_hours INTEGER,
  chain VARCHAR,
  alerts_total INTEGER,
  alerts_ok INTEGER,
  config_json VARCHAR,
  summary_json VARCHAR,
  slice_dir VARCHAR
);

CREATE TABLE IF NOT EXISTS baseline.trades_d (
  trade_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  alert_id VARCHAR NOT NULL,
  caller VARCHAR NOT NULL,
  token_address VARCHAR NOT NULL,
  entry_mode VARCHAR,
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
  exit_reason VARCHAR,
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

CREATE TABLE IF NOT EXISTS bt.alert_outcomes_f (
  scenario_id VARCHAR NOT NULL,
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
  details_json VARCHAR
);

CREATE TABLE IF NOT EXISTS bt.alert_scenarios_d (
  scenario_id VARCHAR NOT NULL,
  created_at TIMESTAMP,
  run_id VARCHAR,
  alert_id BIGINT,
  mint VARCHAR,
  alert_ts_ms BIGINT,
  entry_ts_ms BIGINT,
  end_ts_ms BIGINT,
  interval_seconds INTEGER,
  eval_window_s INTEGER,
  caller_name VARCHAR,
  scenario_json VARCHAR
);

CREATE TABLE IF NOT EXISTS bt.metrics_f (
  run_id VARCHAR,
  metric_name VARCHAR,
  metric_value DOUBLE,
  computed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bt.runs_d (
  run_id VARCHAR NOT NULL,
  created_at TIMESTAMP,
  run_name VARCHAR,
  strategy_name VARCHAR,
  strategy_version VARCHAR,
  candle_interval_s INTEGER,
  window_from_ts_ms BIGINT,
  window_to_ts_ms BIGINT,
  entry_rule VARCHAR,
  exit_rule VARCHAR,
  config_json VARCHAR,
  notes VARCHAR
);

CREATE TABLE IF NOT EXISTS canon.callers_d (
  caller_id VARCHAR NOT NULL,
  caller_raw_name VARCHAR NOT NULL,
  caller_base VARCHAR NOT NULL,
  caller_name VARCHAR NOT NULL,
  first_seen_ts_ms BIGINT,
  last_seen_ts_ms BIGINT,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS core.alerts_d (
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  alert_ts_ms BIGINT,
  from_name VARCHAR,
  text VARCHAR,
  parse_run_id VARCHAR,
  ingested_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.backtest_call_path_metrics (
  run_id VARCHAR NOT NULL,
  call_id VARCHAR NOT NULL,
  caller_name VARCHAR NOT NULL,
  mint VARCHAR NOT NULL,
  chain VARCHAR NOT NULL,
  interval VARCHAR NOT NULL,
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
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.backtest_call_results (
  run_id VARCHAR NOT NULL,
  call_id VARCHAR NOT NULL,
  caller_name VARCHAR NOT NULL,
  mint VARCHAR NOT NULL,
  interval VARCHAR NOT NULL,
  entry_ts_ms BIGINT NOT NULL,
  exit_ts_ms BIGINT NOT NULL,
  entry_px DOUBLE NOT NULL,
  exit_px DOUBLE NOT NULL,
  return_bps DOUBLE NOT NULL,
  pnl_usd DOUBLE NOT NULL,
  hold_ms BIGINT NOT NULL,
  max_favorable_bps DOUBLE,
  max_adverse_bps DOUBLE,
  exit_reason VARCHAR,
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
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.backtest_policies (
  policy_id VARCHAR NOT NULL,
  caller_name VARCHAR,
  policy_json VARCHAR NOT NULL,
  score DOUBLE,
  constraints_json VARCHAR,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.backtest_policy_results (
  run_id VARCHAR NOT NULL,
  policy_id VARCHAR NOT NULL,
  call_id VARCHAR NOT NULL,
  realized_return_bps DOUBLE NOT NULL,
  stop_out BOOLEAN NOT NULL,
  max_adverse_excursion_bps DOUBLE NOT NULL,
  time_exposed_ms BIGINT NOT NULL,
  tail_capture DOUBLE,
  entry_ts_ms BIGINT NOT NULL,
  exit_ts_ms BIGINT NOT NULL,
  entry_px DOUBLE NOT NULL,
  exit_px DOUBLE NOT NULL,
  exit_reason VARCHAR,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.backtest_runs (
  run_id VARCHAR NOT NULL,
  strategy_id VARCHAR,
  status VARCHAR NOT NULL,
  params_json VARCHAR,
  run_mode VARCHAR,
  interval VARCHAR,
  time_from TIMESTAMP,
  time_to TIMESTAMP,
  created_at TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  error_text VARCHAR
);

CREATE TABLE IF NOT EXISTS main.backtest_strategies (
  strategy_id VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  config_json VARCHAR NOT NULL,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.bot_observations (
  id INTEGER NOT NULL,
  mint VARCHAR,
  ticker VARCHAR,
  bot_name VARCHAR NOT NULL,
  message_id INTEGER NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  observed_at TIMESTAMP NOT NULL,
  card_json VARCHAR NOT NULL,
  mcap_usd FLOAT,
  price_usd FLOAT,
  liquidity_usd FLOAT,
  volume_usd FLOAT,
  ath_mcap_usd FLOAT,
  ath_age_days INTEGER,
  top_holders_pct_1 FLOAT,
  top_holders_pct_2 FLOAT,
  top_holders_pct_3 FLOAT,
  top_holders_pct_4 FLOAT,
  top_holders_pct_5 FLOAT,
  top_holders_sum_pct FLOAT,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.caller_links_d (
  trigger_chat_id VARCHAR NOT NULL,
  trigger_message_id BIGINT NOT NULL,
  trigger_ts_ms BIGINT,
  trigger_from_id VARCHAR,
  trigger_from_name VARCHAR,
  trigger_text VARCHAR,
  bot_message_id BIGINT NOT NULL,
  bot_ts_ms BIGINT,
  bot_from_name VARCHAR,
  bot_type VARCHAR,
  token_name VARCHAR,
  ticker VARCHAR,
  mint VARCHAR,
  mint_raw VARCHAR,
  mint_validation_status VARCHAR,
  mint_validation_reason VARCHAR,
  chain VARCHAR,
  platform VARCHAR,
  token_age_s BIGINT,
  token_created_ts_ms BIGINT,
  views BIGINT,
  price_usd DOUBLE,
  price_move_pct DOUBLE,
  mcap_usd DOUBLE,
  mcap_change_pct DOUBLE,
  vol_usd DOUBLE,
  liquidity_usd DOUBLE,
  zero_liquidity BOOLEAN,
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
  top5_holders_pct_json VARCHAR,
  dev_sold BOOLEAN,
  dex_paid BOOLEAN,
  card_json VARCHAR,
  validation_passed BOOLEAN,
  run_id VARCHAR NOT NULL,
  inserted_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.feature_sets (
  feature_set_id VARCHAR NOT NULL,
  feature_spec_hash VARCHAR NOT NULL,
  feature_spec_json VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.features (
  features_id VARCHAR NOT NULL,
  slice_id VARCHAR NOT NULL,
  feature_set_id VARCHAR NOT NULL,
  manifest_path VARCHAR NOT NULL,
  parquet_path VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.ingestion_runs (
  run_id VARCHAR NOT NULL,
  chat_id VARCHAR NOT NULL,
  input_file_path VARCHAR NOT NULL,
  input_file_hash VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  rows_inserted_tg_norm INTEGER,
  rows_inserted_caller_links INTEGER,
  rows_inserted_user_calls INTEGER,
  error_message VARCHAR,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.ohlcv_candles_d (
  mint VARCHAR NOT NULL,
  timestamp INTEGER NOT NULL,
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  volume DOUBLE NOT NULL,
  interval_seconds INTEGER NOT NULL,
  source VARCHAR
);

CREATE TABLE IF NOT EXISTS main.ohlcv_coverage_matrix (
  chat_id VARCHAR NOT NULL,
  message_id BIGINT NOT NULL,
  trigger_ts_ms BIGINT NOT NULL,
  caller_name VARCHAR,
  mint VARCHAR NOT NULL,
  chain VARCHAR NOT NULL,
  has_ohlcv_data BOOLEAN NOT NULL,
  coverage_ratio DOUBLE NOT NULL,
  expected_candles INTEGER,
  actual_candles INTEGER,
  intervals_available VARCHAR,
  pre_window_minutes INTEGER,
  post_window_minutes INTEGER,
  coverage_start_ts_ms BIGINT,
  coverage_end_ts_ms BIGINT,
  last_checked_at TIMESTAMP NOT NULL,
  last_updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.ohlcv_exclusions_d (
  token_address VARCHAR NOT NULL,
  chain VARCHAR NOT NULL,
  interval VARCHAR NOT NULL,
  excluded_at TIMESTAMP NOT NULL,
  reason VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS main.ohlcv_metadata_d (
  mint VARCHAR NOT NULL,
  alert_timestamp TIMESTAMP NOT NULL,
  interval_seconds INTEGER NOT NULL,
  time_range_start TIMESTAMP NOT NULL,
  time_range_end TIMESTAMP NOT NULL,
  candle_count INTEGER NOT NULL,
  last_updated TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.run_status (
  run_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  strategy_id VARCHAR,
  strategy_version VARCHAR,
  config_json VARCHAR,
  summary_json VARCHAR,
  error VARCHAR,
  created_at TIMESTAMP NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.run_strategies_used (
  run_id VARCHAR NOT NULL,
  strategy_config_id VARCHAR NOT NULL,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.schema_version (
  version INTEGER NOT NULL,
  applied_at TIMESTAMP NOT NULL,
  description VARCHAR
);

CREATE TABLE IF NOT EXISTS main.sim_runs (
  sim_id VARCHAR NOT NULL,
  features_id VARCHAR NOT NULL,
  strategy_hash VARCHAR NOT NULL,
  risk_hash VARCHAR NOT NULL,
  window_id VARCHAR,
  summary_path VARCHAR NOT NULL,
  artifact_dir VARCHAR NOT NULL,
  code_version VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.simulation_events (
  event_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  event_type VARCHAR NOT NULL,
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

CREATE TABLE IF NOT EXISTS main.simulation_runs (
  run_id VARCHAR NOT NULL,
  strategy_id VARCHAR NOT NULL,
  mint VARCHAR NOT NULL,
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
  caller_name VARCHAR,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.simulation_strategies (
  strategy_id VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  entry_config JSON,
  exit_config JSON,
  reentry_config JSON,
  cost_config JSON,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.slices (
  slice_id VARCHAR NOT NULL,
  dataset VARCHAR NOT NULL,
  chain VARCHAR NOT NULL,
  interval VARCHAR NOT NULL,
  start_iso VARCHAR NOT NULL,
  end_iso VARCHAR NOT NULL,
  token_set_id VARCHAR NOT NULL,
  schema_hash VARCHAR NOT NULL,
  slice_hash VARCHAR NOT NULL,
  manifest_path VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.strategy_config (
  strategy_config_id VARCHAR NOT NULL,
  strategy_id VARCHAR NOT NULL,
  strategy_name VARCHAR NOT NULL,
  entry_config JSON NOT NULL,
  exit_config JSON NOT NULL,
  reentry_config JSON,
  cost_config JSON,
  stop_loss_config JSON,
  entry_signal_config JSON,
  exit_signal_config JSON,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.tg_chats (
  chat_id VARCHAR NOT NULL,
  chat_name VARCHAR,
  chat_type VARCHAR,
  chat_index INTEGER
);

CREATE TABLE IF NOT EXISTS main.tg_norm (
  chat_id VARCHAR NOT NULL,
  message_id INTEGER NOT NULL,
  ts_ms INTEGER,
  from_name VARCHAR,
  from_id VARCHAR,
  type VARCHAR,
  is_service INTEGER NOT NULL,
  text VARCHAR,
  links_json VARCHAR,
  norm_json VARCHAR NOT NULL,
  chat_name VARCHAR
);

CREATE TABLE IF NOT EXISTS main.tg_norm_d (
  chat_id VARCHAR NOT NULL,
  chat_name VARCHAR,
  message_id BIGINT NOT NULL,
  ts_ms BIGINT,
  from_name VARCHAR,
  from_id VARCHAR,
  type VARCHAR,
  is_service BOOLEAN,
  reply_to_message_id BIGINT,
  text VARCHAR,
  links_json VARCHAR,
  norm_json VARCHAR,
  run_id VARCHAR NOT NULL,
  inserted_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.tg_quarantine (
  chat_id VARCHAR,
  chat_name VARCHAR,
  message_id INTEGER,
  ts_ms INTEGER,
  error_code VARCHAR NOT NULL,
  error_message VARCHAR NOT NULL,
  raw_json VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS main.token_lifespan (
  mint VARCHAR NOT NULL,
  chain VARCHAR,
  name VARCHAR,
  symbol VARCHAR,
  creation_time TIMESTAMP,
  last_trade_time TIMESTAMP,
  last_trade_unix INTEGER,
  liquidity DOUBLE,
  price DOUBLE,
  is_active BOOLEAN,
  fetched_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.token_quarantine (
  id INTEGER NOT NULL,
  mint VARCHAR,
  ticker VARCHAR,
  field_name VARCHAR NOT NULL,
  rick_value VARCHAR,
  phanes_value VARCHAR,
  message_id_rick INTEGER,
  message_id_phanes INTEGER,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.token_sets (
  token_set_id VARCHAR NOT NULL,
  source_path VARCHAR NOT NULL,
  token_count INTEGER NOT NULL,
  tokens_sha VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS main.tokens_data (
  mint VARCHAR NOT NULL,
  ticker VARCHAR,
  mcap FLOAT,
  current_mcap FLOAT,
  last_update TIMESTAMP,
  price FLOAT,
  supply FLOAT,
  ath_mcap FLOAT,
  ath_date TIMESTAMP,
  liquidity FLOAT,
  liquidity_x FLOAT,
  top_holders_pct_1 FLOAT,
  top_holders_pct_2 FLOAT,
  top_holders_pct_3 FLOAT,
  top_holders_pct_4 FLOAT,
  top_holders_pct_5 FLOAT,
  top_holders_sum_pct FLOAT,
  active INTEGER,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.tokens_metadata (
  mint VARCHAR NOT NULL,
  name VARCHAR,
  ticker VARCHAR,
  social_x VARCHAR,
  social_telegram VARCHAR,
  social_discord VARCHAR,
  social_website VARCHAR,
  social_tiktok VARCHAR,
  social_facebook VARCHAR,
  supply FLOAT,
  creator VARCHAR,
  created_date TIMESTAMP,
  first_call_date TIMESTAMP,
  first_caller_name VARCHAR,
  first_mcap FLOAT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.user_calls (
  id INTEGER NOT NULL,
  caller_name VARCHAR NOT NULL,
  caller_id VARCHAR,
  call_datetime TIMESTAMP NOT NULL,
  call_ts_ms INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  chat_id VARCHAR NOT NULL,
  bot_reply_id_1 INTEGER,
  bot_reply_id_2 INTEGER,
  mint VARCHAR,
  ticker VARCHAR,
  mcap_usd FLOAT,
  price_usd FLOAT,
  first_caller INTEGER NOT NULL,
  trigger_text VARCHAR,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS main.user_calls_d (
  chat_id VARCHAR NOT NULL,
  message_id BIGINT NOT NULL,
  call_ts_ms BIGINT,
  call_datetime TIMESTAMP,
  caller_name VARCHAR,
  caller_id VARCHAR,
  trigger_text VARCHAR,
  bot_reply_id_1 BIGINT,
  bot_reply_id_2 BIGINT,
  mint VARCHAR,
  ticker VARCHAR,
  mcap_usd DOUBLE,
  price_usd DOUBLE,
  first_caller BOOLEAN,
  run_id VARCHAR NOT NULL,
  inserted_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS optimizer.champion_validation_f (
  validation_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  phase_id VARCHAR NOT NULL,
  champion_id VARCHAR NOT NULL,
  island_id VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL,
  n_lanes INTEGER,
  lane_scores_json VARCHAR,
  robust_score DOUBLE,
  median_score DOUBLE,
  p25_score DOUBLE,
  mean_score DOUBLE,
  worst_lane VARCHAR,
  worst_lane_score DOUBLE,
  lanes_passing INTEGER,
  validation_rank INTEGER,
  score_delta DOUBLE
);

CREATE TABLE IF NOT EXISTS optimizer.island_champions_f (
  champion_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  phase_id VARCHAR NOT NULL,
  island_id VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL,
  tp_mult DOUBLE,
  sl_mult DOUBLE,
  params_json VARCHAR,
  discovery_score DOUBLE,
  median_test_r DOUBLE,
  passes_gates BOOLEAN,
  island_size INTEGER,
  island_centroid_json VARCHAR,
  validation_status VARCHAR
);

CREATE TABLE IF NOT EXISTS optimizer.islands_f (
  island_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  phase_id VARCHAR NOT NULL,
  cluster_num INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL,
  centroid_tp_mult DOUBLE,
  centroid_sl_mult DOUBLE,
  centroid_json VARCHAR,
  spread_tp_mult DOUBLE,
  spread_sl_mult DOUBLE,
  n_members INTEGER,
  mean_robust_score DOUBLE,
  median_robust_score DOUBLE,
  best_robust_score DOUBLE,
  mean_median_test_r DOUBLE,
  mean_ratio DOUBLE,
  pct_pass_gates DOUBLE,
  members_json VARCHAR
);

CREATE TABLE IF NOT EXISTS optimizer.pipeline_phases_f (
  phase_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  phase_name VARCHAR NOT NULL,
  phase_order INTEGER NOT NULL,
  status VARCHAR NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  input_phase_id VARCHAR,
  input_summary_json VARCHAR,
  output_summary_json VARCHAR,
  config_json VARCHAR,
  error_message VARCHAR,
  retry_count INTEGER,
  notes VARCHAR
);

CREATE TABLE IF NOT EXISTS optimizer.runs_d (
  run_id VARCHAR NOT NULL,
  run_type VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL,
  name VARCHAR,
  date_from DATE,
  date_to DATE,
  alerts_total INTEGER,
  alerts_ok INTEGER,
  config_json VARCHAR,
  timing_json VARCHAR,
  summary_json VARCHAR,
  notes VARCHAR
);

CREATE TABLE IF NOT EXISTS optimizer.stress_lane_results_f (
  result_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  phase_id VARCHAR NOT NULL,
  champion_id VARCHAR NOT NULL,
  lane_name VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL,
  fee_bps DOUBLE,
  slippage_bps DOUBLE,
  latency_candles INTEGER,
  stop_gap_prob DOUBLE,
  stop_gap_mult DOUBLE,
  lane_config_json VARCHAR,
  test_r DOUBLE,
  ratio DOUBLE,
  passes_gates BOOLEAN,
  duration_ms INTEGER,
  summary_json VARCHAR
);

CREATE TABLE IF NOT EXISTS optimizer.trials_f (
  trial_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL,
  strategy_name VARCHAR,
  tp_mult DOUBLE,
  sl_mult DOUBLE,
  intrabar_order VARCHAR,
  params_json VARCHAR,
  date_from DATE,
  date_to DATE,
  entry_mode VARCHAR,
  horizon_hours INTEGER,
  alerts_total INTEGER,
  alerts_ok INTEGER,
  total_r DOUBLE,
  avg_r DOUBLE,
  avg_r_win DOUBLE,
  avg_r_loss DOUBLE,
  r_profit_factor DOUBLE,
  win_rate DOUBLE,
  profit_factor DOUBLE,
  expectancy_pct DOUBLE,
  total_return_pct DOUBLE,
  risk_adj_total_return_pct DOUBLE,
  hit2x_pct DOUBLE,
  hit3x_pct DOUBLE,
  hit4x_pct DOUBLE,
  median_ath_mult DOUBLE,
  p75_ath_mult DOUBLE,
  p95_ath_mult DOUBLE,
  median_time_to_2x_min DOUBLE,
  median_time_to_3x_min DOUBLE,
  median_dd_pre2x DOUBLE,
  p95_dd_pre2x DOUBLE,
  median_dd_overall DOUBLE,
  objective_score DOUBLE,
  duration_ms INTEGER,
  summary_json VARCHAR
);

CREATE TABLE IF NOT EXISTS optimizer.walk_forward_f (
  fold_id VARCHAR NOT NULL,
  run_id VARCHAR NOT NULL,
  fold_num INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL,
  train_from DATE,
  train_to DATE,
  train_alerts INTEGER,
  test_from DATE,
  test_to DATE,
  test_alerts INTEGER,
  best_tp_mult DOUBLE,
  best_sl_mult DOUBLE,
  best_params_json VARCHAR,
  train_win_rate DOUBLE,
  train_avg_r DOUBLE,
  train_total_r DOUBLE,
  test_win_rate DOUBLE,
  test_avg_r DOUBLE,
  test_total_r DOUBLE,
  delta_avg_r DOUBLE,
  delta_total_r DOUBLE,
  notes VARCHAR
);

CREATE TABLE IF NOT EXISTS raw.messages_f (
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  ts_ms BIGINT,
  from_name VARCHAR,
  text VARCHAR,
  reply_to_message_id BIGINT,
  raw_json VARCHAR,
  parse_run_id VARCHAR,
  ingested_at TIMESTAMP
);

-- Step 3: Create all views (42 views in dependency order)

CREATE OR REPLACE VIEW baseline.caller_leaderboard_v AS SELECT run_id, caller, n, median_ath, p75_ath, p95_ath, hit2x_pct, hit3x_pct, hit4x_pct, hit5x_pct, median_t2x_hrs, median_dd_initial_pct, median_dd_overall_pct, median_dd_pre2x_pct, median_dd_pre2x_or_horizon_pct, median_dd_after_2x_pct, median_dd_after_ath_pct, median_peak_pnl_pct, median_ret_end_pct FROM baseline.caller_stats_f ORDER BY run_id, median_ath DESC;

CREATE OR REPLACE VIEW baseline.caller_leaderboard_v2 AS WITH caller_ath_stats AS (SELECT run_id, caller, quantile_cont(ath_mult, 0.95) AS p95_ath_computed FROM baseline.alert_results_f WHERE ((status = 'ok') AND (caller IS NOT NULL) AND (caller != '')) GROUP BY run_id, caller)SELECT s.run_id, s.caller, s.n, s.median_ath, s.p75_ath, COALESCE(a.p95_ath_computed, (s.p75_ath * 1.3)) AS p95_ath, s.hit2x_pct, s.hit3x_pct, s.hit4x_pct, s.hit5x_pct, s.median_t2x_hrs, s.median_dd_pre2x_pct, s.median_dd_pre2x_or_horizon_pct, s.median_dd_initial_pct, s.median_dd_overall_pct, s.median_dd_after_2x_pct, s.median_dd_after_3x_pct, s.median_dd_after_ath_pct, s.worst_dd_pct, s.median_peak_pnl_pct, s.median_ret_end_pct FROM baseline.caller_stats_f AS s LEFT JOIN caller_ath_stats AS a ON (((s.run_id = a.run_id) AND (s.caller = a.caller))) ORDER BY s.run_id, s.median_ath DESC;

CREATE OR REPLACE VIEW baseline.caller_scored_v2 AS WITH caller_ath_stats AS (SELECT run_id, caller, quantile_cont(ath_mult, 0.75) AS p75_ath_computed, quantile_cont(ath_mult, 0.95) AS p95_ath_computed FROM baseline.alert_results_f WHERE ((status = 'ok') AND (caller IS NOT NULL) AND (caller != '')) GROUP BY run_id, caller), src AS (SELECT s.run_id, s.caller, s.n, s.median_ath, COALESCE(a.p75_ath_computed, s.p75_ath, (s.median_ath * 1.3)) AS p75_ath, COALESCE(a.p95_ath_computed, (s.p75_ath * 1.3), (s.median_ath * 1.8)) AS p95_ath, s.hit2x_pct, s.hit3x_pct, s.hit4x_pct, s.hit5x_pct, s.median_t2x_hrs, COALESCE(s.median_dd_pre2x_or_horizon_pct, s.median_dd_pre2x_pct, s.median_dd_overall_pct) AS risk_dd_pct, s.median_dd_pre2x_pct, s.median_dd_pre2x_or_horizon_pct FROM baseline.caller_stats_f AS s LEFT JOIN caller_ath_stats AS a ON (((s.run_id = a.run_id) AND (s.caller = a.caller)))), feat AS (SELECT *, greatest(0.0, (-(COALESCE(risk_dd_pct, 0.0)) / 100.0)) AS risk_mag, CASE  WHEN ((median_t2x_hrs IS NULL)) THEN (NULL) ELSE (median_t2x_hrs * 60.0) END AS median_t2x_min, (greatest((COALESCE(median_ath, 1.0) - 1.0), 0.0) * (COALESCE(hit2x_pct, 0.0) / 100.0)) AS base_upside, ((0.15 * greatest((COALESCE(p75_ath, median_ath) - COALESCE(median_ath, 1.0)), 0.0)) + (0.10 * greatest((COALESCE(p95_ath, p75_ath) - COALESCE(p75_ath, median_ath)), 0.0))) AS tail_bonus, CASE  WHEN ((median_t2x_hrs IS NULL)) THEN (0.0) ELSE exp((-((median_t2x_hrs * 60.0)) / 60.0)) END AS fast2x_signal, sqrt(((n * 1.0) / (n + 50.0))) AS confidence FROM src), pen AS (SELECT *, CASE  WHEN ((risk_mag <= 0.50)) THEN (0.0) ELSE (exp((8.0 * (risk_mag - 0.50))) - 1.0) END AS risk_penalty, CASE  WHEN (((COALESCE(hit2x_pct, 0.0) >= 40.0) AND (risk_mag <= 0.55))) THEN (0.60) ELSE 0.0 END AS discipline_bonus FROM feat), score AS (SELECT *, (1.0 + (0.80 * fast2x_signal)) AS timing_mult, (confidence * ((((base_upside + tail_bonus) * (1.0 + (0.80 * fast2x_signal))) + discipline_bonus) - (1.00 * risk_penalty))) AS score_v2 FROM pen)SELECT run_id, caller, n, median_ath, p75_ath, p95_ath, hit2x_pct, hit3x_pct, hit4x_pct, hit5x_pct, median_t2x_hrs, median_t2x_min, median_dd_pre2x_pct, median_dd_pre2x_or_horizon_pct, risk_dd_pct, risk_mag, base_upside, tail_bonus, fast2x_signal, discipline_bonus, risk_penalty, confidence, score_v2 FROM score;

CREATE OR REPLACE VIEW baseline.run_summary_v AS SELECT run_id, created_at, run_name, "chain", date_from, date_to, interval_seconds, horizon_hours, alerts_total, alerts_ok, json_extract_string(summary_json, '$.median_ath_mult') AS median_ath_mult, json_extract_string(summary_json, '$.pct_hit_2x') AS pct_hit_2x, json_extract_string(summary_json, '$.median_dd_overall') AS median_dd_overall, json_extract_string(summary_json, '$.median_peak_pnl_pct') AS median_peak_pnl_pct FROM baseline.runs_d ORDER BY created_at DESC;

CREATE OR REPLACE VIEW canon.alerts AS SELECT CAST(chat_id AS BIGINT) AS alert_chat_id, CAST(message_id AS BIGINT) AS alert_message_id, ((CAST(chat_id AS BIGINT) || ':') || CAST(message_id AS BIGINT)) AS alert_id, CAST(alert_ts_ms AS BIGINT) AS alert_ts_ms, "nullif"(main."trim"(from_name), '') AS caller_name, "text" AS alert_text, parse_run_id AS run_id, ingested_at FROM core.alerts_d;

CREATE OR REPLACE VIEW canon.messages AS SELECT CAST(chat_id AS BIGINT) AS chat_id, CAST(message_id AS BIGINT) AS message_id, CAST(ts_ms AS BIGINT) AS ts_ms, from_name AS from_name, "text" AS "text", CAST(reply_to_message_id AS BIGINT) AS reply_to_message_id, parse_run_id AS run_id, ingested_at AS ingested_at, raw_json AS raw_json FROM raw.messages_f;

CREATE OR REPLACE VIEW alerts_missing_coverage AS SELECT chat_id, message_id, trigger_ts_ms, caller_name, mint, "chain", coverage_ratio, expected_candles, actual_candles, last_checked_at FROM ohlcv_coverage_matrix WHERE ((has_ohlcv_data = CAST('f' AS BOOLEAN)) OR (coverage_ratio < 0.8)) ORDER BY trigger_ts_ms DESC;

CREATE OR REPLACE VIEW caller_coverage_summary AS SELECT caller_name, count_star() AS total_calls, count_star() FILTER (WHERE (has_ohlcv_data = CAST('t' AS BOOLEAN))) AS calls_with_coverage, count_star() FILTER (WHERE (has_ohlcv_data = CAST('f' AS BOOLEAN))) AS calls_without_coverage, avg(coverage_ratio) AS avg_coverage_ratio, min(coverage_ratio) AS min_coverage_ratio, max(coverage_ratio) AS max_coverage_ratio, min(trigger_ts_ms) AS first_call_ts_ms, max(trigger_ts_ms) AS last_call_ts_ms FROM ohlcv_coverage_matrix WHERE (caller_name IS NOT NULL) GROUP BY caller_name;

CREATE OR REPLACE VIEW caller_monthly_coverage AS SELECT caller_name, strftime(to_timestamp((trigger_ts_ms / 1000)), '%Y-%m') AS "month", count_star() AS total_calls, count_star() FILTER (WHERE (has_ohlcv_data = CAST('t' AS BOOLEAN))) AS calls_with_coverage, count_star() FILTER (WHERE (has_ohlcv_data = CAST('f' AS BOOLEAN))) AS calls_without_coverage, (CAST(count_star() FILTER (WHERE (has_ohlcv_data = CAST('t' AS BOOLEAN))) AS DOUBLE) / count_star()) AS coverage_ratio, avg(coverage_ratio) AS avg_coverage_ratio FROM ohlcv_coverage_matrix WHERE (caller_name IS NOT NULL) GROUP BY caller_name, "month" ORDER BY caller_name, "month";

CREATE OR REPLACE VIEW token_coverage_summary AS SELECT mint, "chain", count_star() AS total_alerts, count_star() FILTER (WHERE (has_ohlcv_data = CAST('t' AS BOOLEAN))) AS alerts_with_coverage, count_star() FILTER (WHERE (has_ohlcv_data = CAST('f' AS BOOLEAN))) AS alerts_without_coverage, avg(coverage_ratio) AS avg_coverage_ratio, min(coverage_ratio) AS min_coverage_ratio, max(coverage_ratio) AS max_coverage_ratio, min(trigger_ts_ms) AS first_alert_ts_ms, max(trigger_ts_ms) AS last_alert_ts_ms FROM ohlcv_coverage_matrix GROUP BY mint, "chain";

CREATE OR REPLACE VIEW optimizer.best_trials_v AS SELECT t.run_id, t.trial_id, t.strategy_name, t.tp_mult, t.sl_mult, t.total_r, t.avg_r, t.win_rate, t.hit2x_pct, t.median_ath_mult, t.median_dd_pre2x, t.median_time_to_2x_min, t.objective_score, t.risk_adj_total_return_pct, t.duration_ms, row_number() OVER (PARTITION BY t.run_id ORDER BY t.objective_score DESC NULLS LAST) AS rank_by_objective, row_number() OVER (PARTITION BY t.run_id ORDER BY t.total_r DESC) AS rank_by_total_r FROM optimizer.trials_f AS t ORDER BY t.run_id, t.objective_score DESC NULLS LAST;

CREATE OR REPLACE VIEW optimizer.overfit_check_v AS SELECT r.run_id, r.run_type, r."name", count(DISTINCT t.trial_id) AS n_trials, avg(t.objective_score) AS avg_objective, max(t.objective_score) AS best_objective, avg(t.hit2x_pct) AS avg_hit2x, avg(t.median_dd_pre2x) AS avg_dd_pre2x, avg(t.median_time_to_2x_min) AS avg_time_to_2x, r.created_at FROM optimizer.runs_d AS r LEFT JOIN optimizer.trials_f AS t ON ((t.run_id = r.run_id)) GROUP BY r.run_id, r.run_type, r."name", r.created_at ORDER BY r.created_at DESC;

CREATE OR REPLACE VIEW optimizer.pipeline_status_v AS SELECT r.run_id, r.run_type, r."name", r.created_at, p.phase_name, p.phase_order, p.status AS phase_status, p.started_at, p.completed_at, p.duration_ms, p.error_message FROM optimizer.runs_d AS r LEFT JOIN optimizer.pipeline_phases_f AS p ON ((p.run_id = r.run_id)) ORDER BY r.created_at DESC, p.phase_order;

CREATE OR REPLACE VIEW optimizer.recent_runs_v AS SELECT run_id, run_type, created_at, "name", date_from, date_to, alerts_total, (SELECT count_star() FROM optimizer.trials_f AS t WHERE (t.run_id = r.run_id)) AS n_trials, (SELECT count_star() FROM optimizer.walk_forward_f AS w WHERE (w.run_id = r.run_id)) AS n_folds, CAST(json_extract_string(timing_json, '$.total_ms') AS INTEGER) AS total_ms FROM optimizer.runs_d AS r ORDER BY created_at DESC LIMIT 100;

CREATE OR REPLACE VIEW optimizer.validation_summary_v AS SELECT v.run_id, v.champion_id, c.island_id, c.tp_mult, c.sl_mult, c.discovery_score, v.robust_score AS validation_score, v.score_delta, v.worst_lane, v.worst_lane_score, v.lanes_passing, v.n_lanes, v.validation_rank, CASE  WHEN ((v.validation_rank = 1)) THEN ('WINNER') ELSE '' END AS status FROM optimizer.champion_validation_f AS v INNER JOIN optimizer.island_champions_f AS c ON ((c.champion_id = v.champion_id)) ORDER BY v.run_id, v.validation_rank;

CREATE OR REPLACE VIEW optimizer.walk_forward_summary_v AS SELECT run_id, count_star() AS n_folds, avg(train_total_r) AS avg_train_r, avg(test_total_r) AS avg_test_r, median(test_total_r) AS median_test_r, avg(delta_total_r) AS avg_delta_r, sum(CASE  WHEN ((test_total_r > 0)) THEN (1) ELSE 0 END) AS folds_profitable, sum(CASE  WHEN ((delta_total_r > 0)) THEN (1) ELSE 0 END) AS folds_improved, min(test_total_r) AS worst_fold_r FROM optimizer.walk_forward_f GROUP BY run_id;

CREATE OR REPLACE VIEW canon.alerts_clean AS SELECT a.*, "nullif"(main."trim"(a.caller_name), '') AS caller_raw_name_clean, c.caller_id, c.caller_name AS caller_name_norm, c.caller_base FROM canon.alerts AS a LEFT JOIN canon.callers_d AS c ON ((c.caller_raw_name = "nullif"(main."trim"(a.caller_name), '')));

CREATE OR REPLACE VIEW canon.bot_cards AS SELECT chat_id, message_id, ts_ms, from_name AS bot_name, "text" AS bot_text, reply_to_message_id, run_id, ingested_at FROM canon.messages WHERE (lower(from_name) ~~ '%phanes%');

CREATE OR REPLACE VIEW canon.alert_bot_links AS SELECT chat_id AS alert_chat_id, reply_to_message_id AS alert_message_id, message_id AS bot_message_id, ts_ms AS bot_ts_ms, bot_name, run_id, ingested_at FROM canon.bot_cards WHERE (reply_to_message_id IS NOT NULL);

CREATE OR REPLACE VIEW canon.alert_bot_links_1 AS SELECT * FROM (SELECT b.*, row_number() OVER (PARTITION BY b.alert_chat_id, b.alert_message_id ORDER BY b.bot_ts_ms ASC, b.ingested_at DESC) AS rn FROM canon.alert_bot_links AS b) WHERE (rn = 1);

CREATE OR REPLACE VIEW canon.alert_mints AS WITH from_alert_text AS ((SELECT a.alert_chat_id, a.alert_message_id, a.alert_ts_ms, a.caller_name, a.run_id, a.ingested_at, 'alert_text' AS "source", lower(x) AS mint, 'evm' AS "chain" FROM canon.alerts AS a , unnest(regexp_extract_all(a.alert_text, '(0x[0-9a-fA-F]{40})', 1)) AS t(x)) UNION ALL (SELECT a.alert_chat_id, a.alert_message_id, a.alert_ts_ms, a.caller_name, a.run_id, a.ingested_at, 'alert_text' AS "source", x AS mint, 'solana' AS "chain" FROM canon.alerts AS a , unnest(regexp_extract_all(a.alert_text, '([1-9A-HJ-NP-Za-km-z]{32,44})', 1)) AS t(x))), from_bot_cards AS ((SELECT l.alert_chat_id, l.alert_message_id, l.bot_ts_ms AS alert_ts_ms, a.caller_name, l.run_id, l.ingested_at, 'bot_card' AS "source", lower(x) AS mint, 'evm' AS "chain" FROM canon.alert_bot_links AS l INNER JOIN canon.bot_cards AS b ON (((b.chat_id = l.alert_chat_id) AND (b.message_id = l.bot_message_id))) LEFT JOIN canon.alerts AS a ON (((a.alert_chat_id = l.alert_chat_id) AND (a.alert_message_id = l.alert_message_id))) , unnest(regexp_extract_all(b.bot_text, '(0x[0-9a-fA-F]{40})', 1)) AS t(x)) UNION ALL (SELECT l.alert_chat_id, l.alert_message_id, l.bot_ts_ms AS alert_ts_ms, a.caller_name, l.run_id, l.ingested_at, 'bot_card' AS "source", x AS mint, 'solana' AS "chain" FROM canon.alert_bot_links AS l INNER JOIN canon.bot_cards AS b ON (((b.chat_id = l.alert_chat_id) AND (b.message_id = l.bot_message_id))) LEFT JOIN canon.alerts AS a ON (((a.alert_chat_id = l.alert_chat_id) AND (a.alert_message_id = l.alert_message_id))) , unnest(regexp_extract_all(b.bot_text, '([1-9A-HJ-NP-Za-km-z]{32,44})', 1)) AS t(x)))SELECT DISTINCT alert_chat_id, alert_message_id, alert_ts_ms, caller_name, "chain", mint, "source", run_id, ingested_at FROM ((SELECT * FROM from_alert_text) UNION ALL (SELECT * FROM from_bot_cards)) WHERE ((mint IS NOT NULL) AND (mint != ''));

CREATE OR REPLACE VIEW canon.alerts_promoted_from_raw AS SELECT CAST(m.chat_id AS BIGINT) AS alert_chat_id, CAST(m.message_id AS BIGINT) AS alert_message_id, CAST(m.ts_ms AS BIGINT) AS alert_ts_ms, m.from_name AS caller_name, m."text" AS alert_text, b.run_id, b.ingested_at FROM canon.alert_bot_links AS b INNER JOIN raw.messages_f AS m ON (((m.chat_id = b.alert_chat_id) AND (m.message_id = b.alert_message_id))) LEFT JOIN canon.alerts_clean AS a ON (((a.alert_chat_id = b.alert_chat_id) AND (a.alert_message_id = b.alert_message_id))) WHERE (a.alert_chat_id IS NULL);

CREATE OR REPLACE VIEW canon.alerts_resolved AS WITH links AS (SELECT a.alert_chat_id, a.alert_message_id, a.alert_id, a.alert_ts_ms, l.bot_message_id, l.bot_ts_ms, l.bot_name, l.run_id, l.ingested_at, row_number() OVER (PARTITION BY a.alert_id ORDER BY CASE  WHEN ((l.bot_ts_ms >= a.alert_ts_ms)) THEN (0) ELSE 1 END, abs((l.bot_ts_ms - a.alert_ts_ms)), l.bot_ts_ms) AS rn FROM canon.alerts_clean AS a LEFT JOIN canon.alert_bot_links AS l ON (((l.alert_chat_id = a.alert_chat_id) AND (l.alert_message_id = a.alert_message_id))))SELECT * EXCLUDE (rn) FROM links WHERE (rn = 1);

CREATE OR REPLACE VIEW canon.alerts_universe AS WITH human AS (SELECT a.alert_chat_id, a.alert_message_id, a.alert_ts_ms, a.run_id, a.ingested_at, a.caller_name, a.caller_id, a.caller_name_norm, a.caller_base, a.alert_text, 'human' AS alert_kind FROM canon.alerts_clean AS a), bot_only AS (SELECT b.alert_chat_id, b.alert_message_id, b.bot_ts_ms AS alert_ts_ms, b.run_id, b.ingested_at, CAST(NULL AS VARCHAR) AS caller_name, CAST(NULL AS VARCHAR) AS caller_id, CAST(NULL AS VARCHAR) AS caller_name_norm, CAST(NULL AS VARCHAR) AS caller_base, CAST(NULL AS VARCHAR) AS alert_text, 'bot_only' AS alert_kind FROM canon.alert_bot_links AS b LEFT JOIN canon.alerts_clean AS a ON (((a.alert_chat_id = b.alert_chat_id) AND (a.alert_message_id = b.alert_message_id))) WHERE (a.alert_chat_id IS NULL))(SELECT * FROM human) UNION ALL (SELECT * FROM bot_only);

CREATE OR REPLACE VIEW canon.alert_mint_best AS WITH m AS (SELECT alert_chat_id, alert_message_id, alert_ts_ms, caller_name, "chain", mint, "source", run_id, ingested_at, CASE  WHEN (("chain" = 'evm')) THEN (regexp_matches(mint, '^0x[0-9a-fA-F]{40}$')) WHEN (("chain" = 'solana')) THEN (regexp_matches(mint, '^[1-9A-HJ-NP-Za-km-z]{32,44}$')) ELSE CAST('f' AS BOOLEAN) END AS chain_valid FROM canon.alert_mints), votes AS (SELECT alert_chat_id, alert_message_id, "chain", mint, count(DISTINCT "source") AS source_count FROM m GROUP BY 1, 2, 3, 4), scored AS (SELECT m.*, v.source_count, (((CASE  WHEN ((m."source" = 'bot_card')) THEN (100) ELSE 0 END + CASE  WHEN ((v.source_count >= 2)) THEN (50) ELSE 0 END) + CASE  WHEN (m.chain_valid) THEN (25) ELSE -100 END) + CASE  WHEN ((m.ingested_at IS NOT NULL)) THEN (1) ELSE 0 END) AS score FROM m INNER JOIN votes AS v USING (alert_chat_id, alert_message_id, "chain", mint))SELECT * FROM scored QUALIFY (row_number() OVER (PARTITION BY alert_chat_id, alert_message_id ORDER BY score DESC, "source" DESC, ingested_at DESC, "chain" ASC, mint ASC) = 1);

CREATE OR REPLACE VIEW canon.alert_mint_counts AS SELECT alert_chat_id, alert_message_id, count_star() AS mint_candidates_n FROM canon.alert_mints GROUP BY 1, 2;

CREATE OR REPLACE VIEW canon.alert_mint_resolved AS WITH candidates AS (SELECT alert_chat_id, alert_message_id, ((CAST(alert_chat_id AS VARCHAR) || ':') || CAST(alert_message_id AS VARCHAR)) AS alert_id, mint, "chain", "source", run_id, ingested_at, CASE  WHEN (("source" = 'bot_card')) THEN (0) WHEN (("source" = 'alert_text')) THEN (1) ELSE 9 END AS pref_rank FROM canon.alert_mints WHERE ((mint IS NOT NULL) AND (main."trim"(mint) != ''))), ranked AS (SELECT *, row_number() OVER (PARTITION BY alert_chat_id, alert_message_id ORDER BY pref_rank, "source", mint) AS rn FROM candidates)SELECT alert_chat_id, alert_message_id, alert_id, mint, "chain", "source" AS mint_source, run_id, ingested_at FROM ranked WHERE (rn = 1);

CREATE OR REPLACE VIEW canon.alert_mints_1 AS SELECT alert_chat_id, alert_message_id, mint, "chain", "source", run_id, ingested_at FROM (SELECT m.*, row_number() OVER (PARTITION BY m.alert_chat_id, m.alert_message_id ORDER BY CASE  WHEN ((m."source" = 'bot_card')) THEN (1) WHEN ((m."source" = 'alert_text')) THEN (2) ELSE 9 END, m.ingested_at DESC, m.mint ASC) AS rn FROM canon.alert_mints AS m) WHERE (rn = 1);

CREATE OR REPLACE VIEW canon.alert_resolved AS WITH mint_ranked AS (SELECT alert_chat_id, alert_message_id, mint, "chain", "source", run_id, ingested_at, row_number() OVER (PARTITION BY alert_chat_id, alert_message_id ORDER BY CASE  WHEN (("source" = 'alert_text')) THEN (1) WHEN (("source" = 'bot_card')) THEN (2) ELSE 9 END, ingested_at DESC) AS rn FROM canon.alert_mints)SELECT ((CAST(a.alert_chat_id AS VARCHAR) || ':') || CAST(a.alert_message_id AS VARCHAR)) AS alert_id, a.alert_chat_id, a.alert_message_id, a.alert_ts_ms, a.caller_name, m."chain", m.mint, l.bot_message_id, l.bot_ts_ms, l.bot_name, a.run_id, a.ingested_at, a.alert_text FROM canon.alerts AS a LEFT JOIN mint_ranked AS m ON (((m.alert_chat_id = a.alert_chat_id) AND (m.alert_message_id = a.alert_message_id) AND (m.rn = 1))) LEFT JOIN canon.alert_bot_links AS l ON (((l.alert_chat_id = a.alert_chat_id) AND (l.alert_message_id = a.alert_message_id)));

CREATE OR REPLACE VIEW canon.alerts_enriched AS SELECT a.alert_chat_id, a.alert_message_id, a.alert_ts_ms, a.caller_name, m."chain", m.mint, l.bot_message_id, l.bot_name, a.alert_text FROM canon.alerts AS a LEFT JOIN canon.alert_mints AS m ON (((m.alert_chat_id = a.alert_chat_id) AND (m.alert_message_id = a.alert_message_id))) LEFT JOIN canon.alert_bot_links AS l ON (((l.alert_chat_id = a.alert_chat_id) AND (l.alert_message_id = a.alert_message_id)));

CREATE OR REPLACE VIEW canon.alerts_canon AS SELECT ((CAST(u.alert_chat_id AS VARCHAR) || ':') || CAST(u.alert_message_id AS VARCHAR)) AS alert_id, u.alert_chat_id, u.alert_message_id, u.alert_ts_ms, u.alert_kind, mb."chain", mb.mint, mb."source" AS mint_source, u.caller_name, u.caller_id, u.caller_name_norm, u.caller_base, u.run_id, u.ingested_at, u.alert_text FROM canon.alerts_universe AS u LEFT JOIN canon.alert_mint_best AS mb ON (((mb.alert_chat_id = u.alert_chat_id) AND (mb.alert_message_id = u.alert_message_id)));

CREATE OR REPLACE VIEW canon.alerts_final AS SELECT a.alert_chat_id, a.alert_message_id, a.alert_id, a.alert_ts_ms, a.caller_name, a.caller_id, a.caller_name_norm, b."chain", b.mint, b."source" AS mint_source, bl.bot_message_id, bl.bot_ts_ms, bl.bot_name, a.run_id, a.ingested_at FROM canon.alerts_clean AS a LEFT JOIN canon.alert_mint_best AS b ON (((b.alert_chat_id = a.alert_chat_id) AND (b.alert_message_id = a.alert_message_id))) LEFT JOIN canon.alert_bot_links AS bl ON (((bl.alert_chat_id = a.alert_chat_id) AND (bl.alert_message_id = a.alert_message_id)));

CREATE OR REPLACE VIEW canon.alert_resolved_light AS SELECT alert_id, alert_ts_ms, caller_name, "chain", mint, bot_ts_ms, bot_name, CASE  WHEN (EXISTS(SELECT 1 FROM canon.alert_mints AS m WHERE ((m.alert_chat_id = r.alert_chat_id) AND (m.alert_message_id = r.alert_message_id) AND (m."source" = 'alert_text') AND (m.mint = r.mint)))) THEN (CAST('t' AS BOOLEAN)) ELSE CAST('f' AS BOOLEAN) END AS mint_seen_in_alert_text, CASE  WHEN (EXISTS(SELECT 1 FROM canon.alert_mints AS m WHERE ((m.alert_chat_id = r.alert_chat_id) AND (m.alert_message_id = r.alert_message_id) AND (m."source" = 'bot_card') AND (m.mint = r.mint)))) THEN (CAST('t' AS BOOLEAN)) ELSE CAST('f' AS BOOLEAN) END AS mint_seen_in_bot_card FROM canon.alert_resolved AS r;

CREATE OR REPLACE VIEW canon.alerts_v AS SELECT alert_id, alert_ts_ms, caller_name, "chain", mint, bot_ts_ms, bot_name, run_id FROM canon.alert_resolved WHERE ((mint IS NOT NULL) AND (mint != ''));

CREATE OR REPLACE VIEW canon.alerts_canon_filled AS SELECT c.alert_id, c.alert_chat_id, c.alert_message_id, COALESCE(c.alert_ts_ms, m.ts_ms) AS alert_ts_ms, c.alert_kind, c."chain", c.mint, c.mint_source, COALESCE("nullif"(main."trim"(c.caller_name), ''), "nullif"(main."trim"(m.from_name), '')) AS caller_raw_name, COALESCE(c.caller_id, cd.caller_id) AS caller_id, COALESCE(c.caller_name_norm, cd.caller_name) AS caller_name_norm, COALESCE(c.caller_base, cd.caller_base) AS caller_base, c.run_id, c.ingested_at, COALESCE("nullif"(main."trim"(c.alert_text), ''), "nullif"(main."trim"(m."text"), '')) AS alert_text FROM canon.alerts_canon AS c LEFT JOIN raw.messages_f AS m ON (((m.chat_id = c.alert_chat_id) AND (m.message_id = c.alert_message_id))) LEFT JOIN canon.callers_d AS cd ON ((cd.caller_raw_name = COALESCE("nullif"(main."trim"(c.caller_name), ''), "nullif"(main."trim"(m.from_name), ''))));

CREATE OR REPLACE VIEW canon.alerts_std AS WITH a AS (SELECT c.alert_id, c.alert_chat_id, c.alert_message_id, c.alert_ts_ms, c.alert_kind, c.mint, c."chain", c.mint_source, "nullif"(main."trim"(c.caller_name), '') AS canon_caller_raw_name, "nullif"(main."trim"(m.from_name), '') AS raw_caller_raw_name, "nullif"(main."trim"(m."text"), '') AS raw_alert_text, m.ts_ms AS raw_ts_ms, c.run_id, c.ingested_at, "nullif"(main."trim"(c.alert_text), '') AS canon_alert_text FROM canon.alerts_canon AS c LEFT JOIN raw.messages_f AS m ON (((m.chat_id = c.alert_chat_id) AND (m.message_id = c.alert_message_id)))), picked AS (SELECT alert_id, alert_chat_id, alert_message_id, COALESCE(alert_ts_ms, raw_ts_ms) AS alert_ts_ms, alert_kind, mint, "chain", mint_source, COALESCE(canon_caller_raw_name, raw_caller_raw_name) AS caller_raw_name, COALESCE(canon_alert_text, raw_alert_text) AS alert_text, run_id, ingested_at FROM a)SELECT p.*, cd.caller_id, cd.caller_name AS caller_name_norm, cd.caller_base FROM picked AS p LEFT JOIN canon.callers_d AS cd ON ((cd.caller_raw_name = p.caller_raw_name));

CREATE OR REPLACE VIEW canon.alerts_final_pretty AS SELECT *, to_timestamp((alert_ts_ms / 1000.0)) AS alert_ts_utc FROM canon.alerts_final;

CREATE OR REPLACE VIEW canon.alerts_health AS SELECT count_star() AS alerts_total, count_star() FILTER (WHERE ((mint IS NOT NULL) AND (mint != ''))) AS alerts_with_mint, count_star() FILTER (WHERE (caller_id IS NOT NULL)) AS alerts_with_caller_id, count_star() FILTER (WHERE (caller_id IS NULL)) AS alerts_missing_caller_id FROM canon.alerts_final;

CREATE OR REPLACE VIEW canon.alerts_analysis AS SELECT alert_id, alert_chat_id, alert_message_id, alert_ts_ms, "chain", mint, mint_source, caller_id, caller_name_norm, caller_base, alert_kind, alert_text, run_id, ingested_at FROM canon.alerts_std WHERE ((caller_id IS NOT NULL) AND (mint IS NOT NULL) AND (mint != ''));

CREATE OR REPLACE VIEW canon.alerts_health_origin AS WITH base AS (SELECT a.alert_id, a.alert_kind, a.caller_id, a.caller_raw_name, (m.message_id IS NOT NULL) AS has_raw, "nullif"(main."trim"(m.from_name), '') AS raw_from_name FROM canon.alerts_std AS a LEFT JOIN raw.messages_f AS m ON (((m.chat_id = a.alert_chat_id) AND (m.message_id = a.alert_message_id))))SELECT *, CASE  WHEN ((caller_id IS NOT NULL)) THEN ('mapped') WHEN ((has_raw = CAST('f' AS BOOLEAN))) THEN ('unknown_missing_raw') WHEN ((raw_from_name IS NULL)) THEN ('unknown_blank_sender') ELSE 'unknown_other' END AS origin_kind FROM base;

CREATE OR REPLACE VIEW canon.alerts_ready AS SELECT * FROM canon.alerts_std WHERE (caller_id IS NOT NULL);

CREATE OR REPLACE VIEW canon.alerts_unknown AS SELECT * FROM canon.alerts_std WHERE (caller_id IS NULL);
