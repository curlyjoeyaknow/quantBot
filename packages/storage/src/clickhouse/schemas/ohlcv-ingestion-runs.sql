-- OHLCV Ingestion Runs Table
-- Tracks every ingestion run with full audit metadata.

CREATE TABLE IF NOT EXISTS quantbot.ohlcv_ingestion_runs (
    run_id String,                    -- UUID
    started_at DateTime,
    completed_at Nullable(DateTime),
    status String,                    -- 'running' | 'completed' | 'failed' | 'rolled_back'
    
    -- Version tracking
    script_version String,            -- e.g., "1.2.3"
    git_commit_hash String,           -- e.g., "abc1234"
    git_branch String,                -- e.g., "main"
    git_dirty UInt8,                  -- 1 if uncommitted changes
    
    -- Input tracking
    cli_args String,                  -- JSON of CLI arguments
    env_info String,                  -- JSON of relevant env vars
    input_hash String,                -- SHA256 of input (worklist/params)
    
    -- Source tier for this run (used in quality score calculation)
    source_tier UInt8,                -- 0-5, see SourceTier enum
    
    -- Results
    candles_fetched UInt64,
    candles_inserted UInt64,
    candles_rejected UInt64,          -- Failed validation
    candles_deduplicated UInt64,
    tokens_processed UInt32,
    errors_count UInt32,
    error_message Nullable(String),
    
    -- Validation stats
    zero_volume_count UInt64,         -- Candles with volume=0
    
    -- Dedup tracking
    dedup_mode String,                -- 'inline' | 'post-batch' | 'none'
    dedup_completed_at Nullable(DateTime)
)
ENGINE = MergeTree()
ORDER BY (run_id, started_at)
SETTINGS index_granularity = 8192;

