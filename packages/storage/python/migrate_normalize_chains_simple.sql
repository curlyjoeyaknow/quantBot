-- Chain Name Normalization Migration for ClickHouse 18.16
-- Simple approach: Create new table and insert with UNION ALL

-- Step 1: Create new table with normalized data and better ORDER BY
CREATE TABLE IF NOT EXISTS quantbot.ohlcv_candles_normalized (
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
ORDER BY (token_address, chain, interval, timestamp)
SETTINGS index_granularity = 8192

-- Step 2: Insert already-normalized chains (no transformation needed)
INSERT INTO quantbot.ohlcv_candles_normalized
SELECT * FROM quantbot.ohlcv_candles
WHERE chain IN ('solana', 'ethereum', 'bsc', 'base', 'evm');

-- Step 3: Insert SOL → solana
INSERT INTO quantbot.ohlcv_candles_normalized
SELECT token_address, 'solana', timestamp, interval, open, high, low, close, volume
FROM quantbot.ohlcv_candles
WHERE chain = 'SOL';

-- Step 4: Insert Solana → solana
INSERT INTO quantbot.ohlcv_candles_normalized
SELECT token_address, 'solana', timestamp, interval, open, high, low, close, volume
FROM quantbot.ohlcv_candles
WHERE chain = 'Solana';

-- Step 5: Insert ETH → ethereum
INSERT INTO quantbot.ohlcv_candles_normalized
SELECT token_address, 'ethereum', timestamp, interval, open, high, low, close, volume
FROM quantbot.ohlcv_candles
WHERE chain = 'ETH';

-- Step 6: Insert Ethereum → ethereum
INSERT INTO quantbot.ohlcv_candles_normalized
SELECT token_address, 'ethereum', timestamp, interval, open, high, low, close, volume
FROM quantbot.ohlcv_candles
WHERE chain = 'Ethereum';

-- Step 7: Insert BNB → bsc
INSERT INTO quantbot.ohlcv_candles_normalized
SELECT token_address, 'bsc', timestamp, interval, open, high, low, close, volume
FROM quantbot.ohlcv_candles
WHERE chain = 'BNB';

-- Step 8: Insert Bsc → bsc
INSERT INTO quantbot.ohlcv_candles_normalized
SELECT token_address, 'bsc', timestamp, interval, open, high, low, close, volume
FROM quantbot.ohlcv_candles
WHERE chain = 'Bsc';

