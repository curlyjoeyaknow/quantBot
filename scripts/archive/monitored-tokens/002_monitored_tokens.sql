-- Monitored tokens / watchlist table
-- Stores tokens that are actively being monitored for live trade alerts

CREATE TABLE IF NOT EXISTS monitored_tokens (
  id BIGSERIAL PRIMARY KEY,
  token_id BIGINT REFERENCES tokens (id),
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'solana',
  token_symbol TEXT,
  caller_id BIGINT REFERENCES callers (id),
  caller_name TEXT NOT NULL, -- denormalized for quick access
  alert_id BIGINT REFERENCES alerts (id), -- optional, if from a specific alert
  alert_timestamp TIMESTAMPTZ NOT NULL,
  alert_price NUMERIC(38, 18) NOT NULL,
  entry_config_json JSONB, -- entry configuration (initialEntry, trailingEntry, etc.)
  status TEXT NOT NULL DEFAULT 'active', -- active, paused, completed, removed
  historical_candles_count INTEGER DEFAULT 0, -- number of historical candles loaded
  last_price NUMERIC(38, 18),
  last_update_time TIMESTAMPTZ,
  entry_signal_sent BOOLEAN DEFAULT FALSE,
  entry_price NUMERIC(38, 18),
  entry_time TIMESTAMPTZ,
  entry_type TEXT, -- initial, trailing, ichimoku
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (token_address, chain, caller_name, alert_timestamp)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_monitored_tokens_token_address ON monitored_tokens (token_address, chain);
CREATE INDEX IF NOT EXISTS idx_monitored_tokens_caller ON monitored_tokens (caller_name, status);
CREATE INDEX IF NOT EXISTS idx_monitored_tokens_status ON monitored_tokens (status, created_at);
CREATE INDEX IF NOT EXISTS idx_monitored_tokens_alert_time ON monitored_tokens (alert_timestamp DESC);





