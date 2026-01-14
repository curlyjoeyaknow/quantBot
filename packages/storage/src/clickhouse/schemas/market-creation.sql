-- Market Creation Table
-- Stores market creation data from Birdeye API for correlation analysis
-- with price/volume pumps

CREATE TABLE IF NOT EXISTS quantbot.market_creation (
    -- Token and market identifiers
    base_mint String,              -- Token address (the token we're tracking)
    quote_mint String,            -- Quote token (usually SOL, USDC, etc.)
    market_address String,        -- Market/pair address
    chain String DEFAULT 'solana',
    
    -- Market metadata
    name String,                  -- Market name (e.g., "Token-SOL")
    source String,                -- DEX source (e.g., "meteora_dlmm", "pump_amm", "raydium_cp")
    
    -- Market metrics (24h)
    liquidity Float64,
    unique_wallet_24h UInt32,
    trade_24h UInt32,
    trade_24h_change_percent Nullable(Float64),
    volume_24h_usd Float64,
    
    -- Amounts
    amount_base Float64,
    amount_quote Float64,
    
    -- Timestamps
    creation_time DateTime,       -- Market creation time (key for correlation analysis)
    last_trade_unix_time UInt64,
    last_trade_human_time DateTime,
    
    -- UI scaling flags
    is_scaled_ui_token_base UInt8 DEFAULT 0,
    multiplier_base Nullable(Float64),
    is_scaled_ui_token_quote UInt8 DEFAULT 0,
    multiplier_quote Nullable(Float64),
    
    -- Ingestion metadata
    ingested_at DateTime DEFAULT now(),
    ingestion_run_id String DEFAULT ''
)
ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(creation_time))
ORDER BY (base_mint, chain, creation_time, market_address)
SETTINGS index_granularity = 8192;

-- Index for querying by base_mint (token we're tracking)
ALTER TABLE quantbot.market_creation
ADD INDEX IF NOT EXISTS idx_base_mint base_mint TYPE bloom_filter GRANULARITY 1;

-- Index for querying by creation_time (for correlation analysis)
ALTER TABLE quantbot.market_creation
ADD INDEX IF NOT EXISTS idx_creation_time creation_time TYPE minmax GRANULARITY 1;

