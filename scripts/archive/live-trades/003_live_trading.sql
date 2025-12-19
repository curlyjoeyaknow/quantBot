-- Live Trading System Schema
-- Migration: 003_live_trading.sql

-- User trading configuration
CREATE TABLE IF NOT EXISTS user_trading_config (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  max_position_size NUMERIC(38, 18) NOT NULL DEFAULT 1.0, -- Maximum SOL per position
  max_total_exposure NUMERIC(38, 18) NOT NULL DEFAULT 10.0, -- Maximum total SOL across all positions
  slippage_tolerance NUMERIC(6, 4) NOT NULL DEFAULT 0.01, -- Percentage (0.01 = 1%)
  daily_loss_limit NUMERIC(38, 18) NOT NULL DEFAULT 5.0, -- Maximum daily loss in SOL
  alert_rules_json JSONB NOT NULL DEFAULT '{}',
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_trading_config_user_id ON user_trading_config(user_id);

-- Wallets (encrypted private key storage)
CREATE TABLE IF NOT EXISTS wallets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL, -- AES-256-GCM encrypted
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, public_key)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_public_key ON wallets(public_key);
CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets(user_id, is_active) WHERE is_active = TRUE;

-- Positions (open position tracking)
CREATE TABLE IF NOT EXISTS positions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  wallet_id BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  token_mint TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'solana',
  entry_price NUMERIC(38, 18) NOT NULL,
  entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  position_size NUMERIC(38, 18) NOT NULL, -- Amount in SOL
  remaining_size NUMERIC(38, 18) NOT NULL, -- Remaining position size in SOL
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'partial')),
  strategy_id BIGINT REFERENCES strategies(id) ON DELETE SET NULL,
  alert_id BIGINT, -- Reference to alert that triggered this position
  stop_loss_price NUMERIC(38, 18),
  take_profit_targets_json JSONB, -- Array of TakeProfitTarget
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_wallet_id ON positions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_positions_token_mint ON positions(token_mint, chain);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(user_id, status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_positions_created_at ON positions(created_at);

-- Position events (entry, exit, partial close, stop-loss, take-profit)
CREATE TABLE IF NOT EXISTS position_events (
  id BIGSERIAL PRIMARY KEY,
  position_id BIGINT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('entry', 'exit', 'partial_close', 'stop_loss', 'take_profit')),
  price NUMERIC(38, 18) NOT NULL,
  size NUMERIC(38, 18) NOT NULL, -- Amount in SOL
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  transaction_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_position_events_position_id ON position_events(position_id);
CREATE INDEX IF NOT EXISTS idx_position_events_timestamp ON position_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_position_events_transaction_signature ON position_events(transaction_signature);

-- Trades (trade execution log)
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  position_id BIGINT REFERENCES positions(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  token_mint TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'solana',
  price NUMERIC(38, 18) NOT NULL,
  size NUMERIC(38, 18) NOT NULL, -- Amount in SOL (for buy) or token amount (for sell)
  slippage NUMERIC(6, 4), -- Actual slippage percentage
  transaction_signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  error_message TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_position_id ON trades(position_id);
CREATE INDEX IF NOT EXISTS idx_trades_token_mint ON trades(token_mint, chain);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_transaction_signature ON trades(transaction_signature);

-- Add foreign key constraints (only if users table exists)
-- Note: If users table doesn't exist, these constraints will be skipped
-- You can create a users table or adjust these references as needed

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE positions ADD CONSTRAINT fk_positions_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE trades ADD CONSTRAINT fk_trades_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE user_trading_config ADD CONSTRAINT fk_user_trading_config_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE wallets ADD CONSTRAINT fk_wallets_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

