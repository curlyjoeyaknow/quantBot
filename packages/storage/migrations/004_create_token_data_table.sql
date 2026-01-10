-- Migration: Create token_data table for dynamic token metrics
-- Created: 2025-12-16
-- Description: Stores dynamic token data (price, mcap, volume, etc.) that changes over time
--              Separate from tokens table which stores fixed metadata

CREATE TABLE IF NOT EXISTS token_data (
  id BIGSERIAL PRIMARY KEY,
  token_id BIGINT NOT NULL REFERENCES tokens (id) ON DELETE CASCADE,
  price NUMERIC(38, 18),
  market_cap NUMERIC(38, 18), -- FDV/Market Cap
  liquidity NUMERIC(38, 18),
  liquidity_multiplier NUMERIC(10, 2), -- MC/Liq ratio (x5, x10, etc.)
  volume NUMERIC(38, 18),
  volume_1h NUMERIC(38, 18),
  buyers_1h INTEGER,
  sellers_1h INTEGER,
  price_change_1h NUMERIC(10, 6), -- Percentage
  top_holders_percent NUMERIC(10, 6), -- Sum of all top holder percentages
  total_holders INTEGER,
  supply NUMERIC(38, 18), -- Calculated: mcap / price (if SOL, use $130)
  ath_mcap NUMERIC(38, 18), -- All-time high market cap
  token_age TEXT, -- e.g., "2y", "3d", "1h"
  avg_holder_age TEXT,
  fresh_wallets_1d NUMERIC(10, 6), -- Percentage
  fresh_wallets_7d NUMERIC(10, 6), -- Percentage
  exchange TEXT,
  platform TEXT,
  twitter_link TEXT,
  telegram_link TEXT,
  website_link TEXT,
  recorded_at TIMESTAMPTZ NOT NULL, -- When this data snapshot was recorded
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (token_id, recorded_at)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_token_data_token_id ON token_data (token_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_data_recorded_at ON token_data (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_data_mcap ON token_data (market_cap DESC NULLS LAST);

-- Rollback script (for reference, not executed automatically)
-- DROP INDEX IF EXISTS idx_token_data_mcap;
-- DROP INDEX IF EXISTS idx_token_data_recorded_at;
-- DROP INDEX IF EXISTS idx_token_data_token_id;
-- DROP TABLE IF EXISTS token_data;

