PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

-- User calls table: records when users call tokens
CREATE TABLE IF NOT EXISTS user_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_name TEXT NOT NULL,
  caller_id TEXT,
  call_datetime TIMESTAMP NOT NULL,
  call_ts_ms INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  bot_reply_id_1 INTEGER,  -- Rick message_id
  bot_reply_id_2 INTEGER,  -- Phanes message_id
  mint TEXT,
  ticker TEXT,
  mcap_usd REAL,
  price_usd REAL,
  first_caller INTEGER NOT NULL DEFAULT 0,  -- 1 if this user was first to call this token
  trigger_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, chat_id)
);

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
  supply REAL,  -- FDV / price
  creator TEXT,  -- to be fetched later
  created_date TIMESTAMP,
  first_call_date TIMESTAMP,
  first_caller_name TEXT,
  first_mcap REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bot observations: raw observations from each bot
CREATE TABLE IF NOT EXISTS bot_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT,
  ticker TEXT,
  bot_name TEXT NOT NULL,  -- 'rick' or 'phanes'
  message_id INTEGER NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  observed_at TIMESTAMP NOT NULL,
  card_json TEXT NOT NULL,  -- full parsed card as JSON
  mcap_usd REAL,
  price_usd REAL,
  liquidity_usd REAL,
  volume_usd REAL,
  ath_mcap_usd REAL,
  ath_age_days INTEGER,
  top_holders_pct_1 REAL,  -- top 5 holders %
  top_holders_pct_2 REAL,
  top_holders_pct_3 REAL,
  top_holders_pct_4 REAL,
  top_holders_pct_5 REAL,
  top_holders_sum_pct REAL,  -- sum of top 5
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bot_name, message_id)
);

-- Tokens data: frequently-updated token metrics
CREATE TABLE IF NOT EXISTS tokens_data (
  mint TEXT PRIMARY KEY,
  ticker TEXT,
  mcap REAL,  -- initial mcap from first call
  current_mcap REAL,
  last_update TIMESTAMP,
  price REAL,
  supply REAL,  -- computed as mcap / price
  ath_mcap REAL,
  ath_date TIMESTAMP,  -- calculated from message datetime - age
  liquidity REAL,
  liquidity_x REAL,  -- mcap / liquidity
  top_holders_pct_1 REAL,  -- top 5 holders %
  top_holders_pct_2 REAL,
  top_holders_pct_3 REAL,
  top_holders_pct_4 REAL,
  top_holders_pct_5 REAL,
  top_holders_sum_pct REAL,  -- sum of top 5
  active INTEGER DEFAULT 0,  -- has there been a call in last 14d
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quarantine: conflicting data between Rick and Phanes
CREATE TABLE IF NOT EXISTS token_quarantine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT,
  ticker TEXT,
  field_name TEXT NOT NULL,  -- e.g., 'mcap_usd', 'price_usd'
  rick_value TEXT,
  phanes_value TEXT,
  message_id_rick INTEGER,
  message_id_phanes INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_calls_mint ON user_calls(mint);
CREATE INDEX IF NOT EXISTS idx_user_calls_caller ON user_calls(caller_name);
CREATE INDEX IF NOT EXISTS idx_user_calls_datetime ON user_calls(call_datetime);
CREATE INDEX IF NOT EXISTS idx_tokens_data_active ON tokens_data(active);
CREATE INDEX IF NOT EXISTS idx_tokens_data_last_update ON tokens_data(last_update);

