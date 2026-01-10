-- OHLCV Coverage Matrix Schema
-- 
-- This table stores pre-computed coverage information for each token-alert combination.
-- It enables fast queries to determine which tokens have OHLCV data for which alerts,
-- and vice versa, without querying ClickHouse on every request.
--
-- The table is populated by tools/storage/populate_coverage_matrix.py

CREATE TABLE IF NOT EXISTS ohlcv_coverage_matrix (
  -- Alert/Call identifiers
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  trigger_ts_ms BIGINT NOT NULL,
  caller_name TEXT,
  
  -- Token identifiers
  mint TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'solana',
  
  -- Coverage metrics
  has_ohlcv_data BOOLEAN NOT NULL DEFAULT FALSE,
  coverage_ratio DOUBLE NOT NULL DEFAULT 0.0,  -- 0.0 to 1.0
  expected_candles INTEGER,  -- Expected number of candles for the time window
  actual_candles INTEGER,   -- Actual number of candles found
  intervals_available TEXT,  -- Comma-separated list of intervals that have data (e.g., '1m,5m,15m')
  
  -- Time window for coverage check
  pre_window_minutes INTEGER DEFAULT 260,  -- Minutes before alert
  post_window_minutes INTEGER DEFAULT 1440, -- Minutes after alert
  coverage_start_ts_ms BIGINT,  -- Start of coverage window
  coverage_end_ts_ms BIGINT,    -- End of coverage window
  
  -- Metadata
  last_checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (chat_id, message_id, mint, chain)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_mint ON ohlcv_coverage_matrix(mint);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_caller ON ohlcv_coverage_matrix(caller_name);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_trigger_ts ON ohlcv_coverage_matrix(trigger_ts_ms);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_has_data ON ohlcv_coverage_matrix(has_ohlcv_data);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_coverage_ratio ON ohlcv_coverage_matrix(coverage_ratio);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_last_checked ON ohlcv_coverage_matrix(last_checked_at);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_caller_mint ON ohlcv_coverage_matrix(caller_name, mint);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_mint_has_data ON ohlcv_coverage_matrix(mint, has_ohlcv_data);
CREATE INDEX IF NOT EXISTS idx_coverage_matrix_caller_has_data ON ohlcv_coverage_matrix(caller_name, has_ohlcv_data);

-- View for easy querying: token coverage summary
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

-- View for easy querying: caller coverage summary
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

-- View for easy querying: monthly coverage by caller
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

-- View for easy querying: alerts missing coverage
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

