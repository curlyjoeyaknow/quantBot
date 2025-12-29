-- Adds a canonical numeric interval while keeping the existing string label.
-- MATERIALIZED means it is computed from `interval` and stored for each row,
-- without requiring you to update existing ingestion code immediately.
--
-- Note: ClickHouse doesn't support IF NOT EXISTS for ADD COLUMN.
-- If the column already exists, this will fail gracefully with an error.
-- You can safely ignore "Column already exists" errors.

ALTER TABLE quantbot.ohlcv_candles
ADD COLUMN interval_seconds UInt32 MATERIALIZED if(
  `interval` = '1s', 1,
  if(`interval` = '1m', 60,
    if(`interval` = '5m', 300, 0)
  )
);

