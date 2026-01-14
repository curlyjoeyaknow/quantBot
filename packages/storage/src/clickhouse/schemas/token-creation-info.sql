-- Token Creation Info Table
-- Stores token creation information from Birdeye API
-- Only available for Solana tokens

CREATE TABLE IF NOT EXISTS quantbot.token_creation_info (
    -- Token identifier
    token_address String,
    chain String DEFAULT 'solana',
    
    -- Creation transaction details
    tx_hash String,               -- Transaction hash that created the token
    slot UInt64,                  -- Solana slot number
    
    -- Token metadata
    decimals UInt8,
    owner String,                 -- Token owner address
    creator Nullable(String),     -- Token creator address (if available)
    
    -- Creation timestamps
    block_unix_time UInt64,       -- Unix timestamp (seconds)
    block_human_time DateTime,    -- Human-readable timestamp
    
    -- Ingestion metadata
    ingested_at DateTime DEFAULT now(),
    ingestion_run_id String DEFAULT ''
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (chain, toYYYYMM(block_human_time))
ORDER BY (token_address, chain)
SETTINGS index_granularity = 8192;

-- Index for querying by token_address
ALTER TABLE quantbot.token_creation_info
ADD INDEX IF NOT EXISTS idx_token_address token_address TYPE bloom_filter GRANULARITY 1;

-- Index for querying by creation time (for correlation analysis)
ALTER TABLE quantbot.token_creation_info
ADD INDEX IF NOT EXISTS idx_block_human_time block_human_time TYPE minmax GRANULARITY 1;

