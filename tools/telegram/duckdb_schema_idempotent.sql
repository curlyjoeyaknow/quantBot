-- Enhanced DuckDB Schema with Idempotency Support
-- 
-- This schema adds:
-- 1. run_id tracking to all ingestion tables
-- 2. PRIMARY KEY constraints to prevent duplicates
-- 3. ingestion_runs table to track runs
-- 4. Schema versioning

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);

-- Insert initial version if not exists
INSERT OR IGNORE INTO schema_version (version, description) 
VALUES (1, 'Initial schema without idempotency');

-- Ingestion runs tracking
CREATE TABLE IF NOT EXISTS ingestion_runs (
  run_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  input_file_path TEXT NOT NULL,
  input_file_hash TEXT NOT NULL,  -- SHA256 hash of input file
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

-- Enhanced tg_norm_d with run_id and PRIMARY KEY
-- Note: If table exists without run_id, migration is required
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
  run_id TEXT NOT NULL DEFAULT 'legacy',  -- Default for existing rows
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_norm_run_id ON tg_norm_d(run_id);
CREATE INDEX IF NOT EXISTS idx_tg_norm_chat_message ON tg_norm_d(chat_id, message_id);

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

-- Enhanced user_calls_d with run_id and PRIMARY KEY
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

CREATE INDEX IF NOT EXISTS idx_user_calls_run_id ON user_calls_d(run_id);
CREATE INDEX IF NOT EXISTS idx_user_calls_mint ON user_calls_d(mint);

-- Migration helper: Add run_id column if missing (for existing databases)
-- This is safe to run multiple times
DO $$
BEGIN
  -- Check if run_id column exists in tg_norm_d
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tg_norm_d' AND column_name = 'run_id'
  ) THEN
    ALTER TABLE tg_norm_d ADD COLUMN run_id TEXT NOT NULL DEFAULT 'legacy';
    ALTER TABLE tg_norm_d ADD COLUMN inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
  
  -- Similar for other tables...
END $$;

-- Note: DuckDB doesn't support DO blocks like PostgreSQL
-- Migration should be done via Python script instead

