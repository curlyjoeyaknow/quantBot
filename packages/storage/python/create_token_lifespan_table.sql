-- Token Lifespan Table
-- Stores creation and last_trade times from Birdeye API for coverage analysis
-- This caches the data to avoid repeated API calls

CREATE TABLE IF NOT EXISTS token_lifespan (
    mint VARCHAR PRIMARY KEY,        -- Token address
    chain VARCHAR DEFAULT 'solana',  -- Chain (solana, ethereum, base, etc.)
    name VARCHAR,                    -- Token name
    symbol VARCHAR,                  -- Token symbol
    creation_time TIMESTAMP,         -- When token was created (from Birdeye)
    last_trade_time TIMESTAMP,       -- Last trade time (from Birdeye)
    last_trade_unix INTEGER,         -- Last trade unix timestamp (seconds)
    liquidity DOUBLE,                -- Current liquidity
    price DOUBLE,                    -- Current price
    is_active BOOLEAN,               -- True if last trade within 24 hours
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- When we fetched this data
    
    -- Derived fields for coverage analysis
    lifespan_seconds INTEGER GENERATED ALWAYS AS (
        CASE WHEN last_trade_time IS NOT NULL AND creation_time IS NOT NULL
             THEN CAST(EXTRACT(EPOCH FROM last_trade_time - creation_time) AS INTEGER)
             ELSE NULL
        END
    ) STORED
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_token_lifespan_active ON token_lifespan(is_active);
CREATE INDEX IF NOT EXISTS idx_token_lifespan_fetched ON token_lifespan(fetched_at);
