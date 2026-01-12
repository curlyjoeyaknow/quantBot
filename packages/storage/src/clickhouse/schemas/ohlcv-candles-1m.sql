-- OHLCV Candles 1-minute Table
-- Stores 1-minute candles with quality-based deduplication.

CREATE TABLE IF NOT EXISTS quantbot.ohlcv_candles_1m (
    -- Core OHLCV data
    token_address String,
    chain String,
    timestamp DateTime,
    interval_seconds UInt32 DEFAULT 60,  -- Always 60 for this table, for batch exports
    open Float64,
    high Float64,
    low Float64,
    close Float64,
    volume Float64,
    
    -- Deduplication control
    -- quality_score is COMPUTED from data: volume(100) + valid_range(10) + consistent_ohlc(10) + source_tier(0-5)
    -- A candle with volume will ALWAYS have score >= 100, beating any zero-volume candle
    quality_score UInt16 DEFAULT 0,       -- Computed at insertion, higher = better data
    ingested_at DateTime DEFAULT now(),   -- Tie-breaker: newest wins
    
    -- Audit trail
    source_tier UInt8 DEFAULT 1,          -- Original source tier (for debugging)
    ingestion_run_id String DEFAULT '',
    script_version String DEFAULT ''
)
ENGINE = ReplacingMergeTree(quality_score, ingested_at)
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, timestamp)
SETTINGS index_granularity = 8192;

-- Index for run-based rollback queries
ALTER TABLE quantbot.ohlcv_candles_1m
ADD INDEX IF NOT EXISTS idx_run_id ingestion_run_id TYPE bloom_filter GRANULARITY 1;

