-- Postgres schema for QuantBot core entities

-- Tokens registry
CREATE TABLE IF NOT EXISTS tokens (
  id BIGSERIAL PRIMARY KEY,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  decimals INTEGER,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain, address)
);

-- Callers / creators (signal sources)
CREATE TABLE IF NOT EXISTS callers (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL, -- e.g. brook, lsy, manual
  handle TEXT NOT NULL,
  display_name TEXT,
  attributes_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, handle)
);

-- Alerts raised by callers or systems
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  token_id BIGINT NOT NULL REFERENCES tokens (id),
  caller_id BIGINT REFERENCES callers (id),
  strategy_id BIGINT NULL, -- optional, when alert is strategy-specific
  side TEXT NOT NULL, -- buy / sell
  confidence NUMERIC(6, 4),
  alert_price NUMERIC(38, 18),
  alert_timestamp TIMESTAMPTZ NOT NULL,
  raw_payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Normalized calls / signals derived from alerts
CREATE TABLE IF NOT EXISTS calls (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT REFERENCES alerts (id),
  token_id BIGINT NOT NULL REFERENCES tokens (id),
  caller_id BIGINT REFERENCES callers (id),
  strategy_id BIGINT NULL,
  side TEXT NOT NULL,
  signal_type TEXT NOT NULL, -- e.g. entry, exit, scale_in, scale_out
  signal_strength NUMERIC(6, 4),
  signal_timestamp TIMESTAMPTZ NOT NULL,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Strategy definitions (declarative config, JSON)
CREATE TABLE IF NOT EXISTS strategies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1',
  category TEXT,
  description TEXT,
  config_json JSONB NOT NULL, -- full strategy config, including ladders/indicators
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, version)
);

-- Simulation runs high-level metadata
CREATE TABLE IF NOT EXISTS simulation_runs (
  id BIGSERIAL PRIMARY KEY,
  strategy_id BIGINT REFERENCES strategies (id),
  token_id BIGINT REFERENCES tokens (id),
  caller_id BIGINT REFERENCES callers (id),
  run_type TEXT NOT NULL, -- backtest, optimization, what-if, live-eval, etc.
  engine_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  config_json JSONB NOT NULL,
  data_selection_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Simulation run summary metrics (OLTP view)
CREATE TABLE IF NOT EXISTS simulation_results_summary (
  simulation_run_id BIGINT PRIMARY KEY REFERENCES simulation_runs (id) ON DELETE CASCADE,
  final_pnl NUMERIC(38, 18) NOT NULL,
  max_drawdown NUMERIC(10, 6),
  volatility NUMERIC(10, 6),
  sharpe_ratio NUMERIC(10, 6),
  sortino_ratio NUMERIC(10, 6),
  win_rate NUMERIC(6, 4),
  trade_count INTEGER,
  avg_trade_return NUMERIC(10, 6),
  median_trade_return NUMERIC(10, 6),
  reentry_count INTEGER,
  ladder_entries_used INTEGER,
  ladder_exits_used INTEGER,
  average_holding_minutes NUMERIC(10, 2),
  max_holding_minutes NUMERIC(10, 2),
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optimization jobs (search over strategy parameters)
CREATE TABLE IF NOT EXISTS optimization_jobs (
  id BIGSERIAL PRIMARY KEY,
  strategy_template_id BIGINT REFERENCES strategies (id),
  name TEXT NOT NULL,
  search_space_json JSONB NOT NULL,
  objective TEXT NOT NULL, -- e.g. sharpe, calmar, custom-score
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Individual optimization trials
CREATE TABLE IF NOT EXISTS optimization_trials (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES optimization_jobs (id) ON DELETE CASCADE,
  trial_index INTEGER NOT NULL,
  trial_params_json JSONB NOT NULL,
  simulation_run_id BIGINT REFERENCES simulation_runs (id),
  metrics_json JSONB NOT NULL,
  score NUMERIC(10, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, trial_index)
);

-- Stored ML models
CREATE TABLE IF NOT EXISTS ml_models (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  model_type TEXT NOT NULL, -- classifier, regressor, ranking, etc.
  input_features_json JSONB NOT NULL,
  label_definition JSONB NOT NULL,
  storage_uri TEXT NOT NULL,
  metrics_json JSONB,
  status TEXT NOT NULL DEFAULT 'training', -- training, ready, deprecated, failed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_tokens_chain_address ON tokens (chain, address);
CREATE INDEX IF NOT EXISTS idx_alerts_token_time ON alerts (token_id, alert_timestamp);
CREATE INDEX IF NOT EXISTS idx_calls_token_time ON calls (token_id, signal_timestamp);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_strategy ON simulation_runs (strategy_id, created_at);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_status ON simulation_runs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_optimization_trials_job_score ON optimization_trials (job_id, score DESC);


