-- Migration: Add ATL (All-Time Low) fields to alerts table
-- Created: 2024-01-01
-- Description: Adds atl_price and atl_timestamp columns to track all-time low from alert until ATH

ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS atl_price NUMERIC(38, 18),
ADD COLUMN IF NOT EXISTS atl_timestamp TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_alerts_atl_timestamp ON alerts(atl_timestamp);

-- Rollback script (for reference, not executed automatically)
-- DROP INDEX IF EXISTS idx_alerts_atl_timestamp;
-- ALTER TABLE alerts DROP COLUMN IF EXISTS atl_timestamp;
-- ALTER TABLE alerts DROP COLUMN IF EXISTS atl_price;

