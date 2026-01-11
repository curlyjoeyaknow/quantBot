-- Chain Name Normalization Migration for ClickHouse
-- 
-- This script normalizes inconsistent chain names in ohlcv_candles table.
-- Since 'chain' is part of PARTITION BY, we can't use ALTER UPDATE.
-- Instead, we create a new table with normalized data and swap.
--
-- Normalizations:
--   SOL, Solana, SOLANA → solana
--   ETH, Ethereum, ETHEREUM → ethereum  
--   BSC, Bsc, BNB → bsc
--   BASE, Base → base
--   EVM, Evm → evm
--
-- Estimated time: 2-5 minutes for 50M rows
-- Disk space: Temporarily doubles (creates new table before dropping old)

-- Step 1: Create new table with normalized data
CREATE TABLE quantbot.ohlcv_candles_normalized (
    token_address String,
    chain String,
    timestamp DateTime,
    interval String,
    open Float64,
    high Float64,
    low Float64,
    close Float64,
    volume Float64
)
ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, interval, timestamp)  -- Added interval to ORDER BY for better performance
SETTINGS index_granularity = 8192;

-- Step 2: Insert normalized data
INSERT INTO quantbot.ohlcv_candles_normalized
SELECT 
    token_address,
    CASE chain
        -- Solana variants
        WHEN 'SOL' THEN 'solana'
        WHEN 'Solana' THEN 'solana'
        WHEN 'SOLANA' THEN 'solana'
        WHEN 'sol' THEN 'solana'
        
        -- Ethereum variants
        WHEN 'ETH' THEN 'ethereum'
        WHEN 'Ethereum' THEN 'ethereum'
        WHEN 'ETHEREUM' THEN 'ethereum'
        WHEN 'eth' THEN 'ethereum'
        
        -- BSC variants
        WHEN 'BSC' THEN 'bsc'
        WHEN 'Bsc' THEN 'bsc'
        WHEN 'BNB' THEN 'bsc'
        WHEN 'bnb' THEN 'bsc'
        
        -- Base variants
        WHEN 'BASE' THEN 'base'
        WHEN 'Base' THEN 'base'
        
        -- EVM variants
        WHEN 'EVM' THEN 'evm'
        WHEN 'Evm' THEN 'evm'
        
        -- Already normalized
        ELSE chain
    END as chain,
    timestamp,
    interval,
    open,
    high,
    low,
    close,
    volume
FROM quantbot.ohlcv_candles;

-- Step 3: Verify counts
SELECT 'Before normalization:' as status, chain, count() as cnt
FROM quantbot.ohlcv_candles
GROUP BY chain
ORDER BY cnt DESC;

SELECT 'After normalization:' as status, chain, count() as cnt
FROM quantbot.ohlcv_candles_normalized
GROUP BY chain
ORDER BY cnt DESC;

-- Step 4: Swap tables (MANUAL - uncomment when ready)
-- RENAME TABLE quantbot.ohlcv_candles TO quantbot.ohlcv_candles_old;
-- RENAME TABLE quantbot.ohlcv_candles_normalized TO quantbot.ohlcv_candles;

-- Step 5: Drop old table after verification (MANUAL - uncomment when ready)
-- DROP TABLE quantbot.ohlcv_candles_old;

-- Note: After swapping, update your application to use normalized chain names:
--   - Always use lowercase: 'solana', 'ethereum', 'bsc', 'base', 'evm'
--   - Update ingestion code to normalize chain names before inserting

