-- Migration: Add caller alert metrics to alerts table
-- Adds fields for initial market cap, initial price, time to ATH, and max ROI

ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS initial_mcap NUMERIC(38, 18),
ADD COLUMN IF NOT EXISTS initial_price NUMERIC(38, 18), -- price at alert time (for performance calculations)
ADD COLUMN IF NOT EXISTS time_to_ath INTEGER, -- seconds from alert to all-time high
ADD COLUMN IF NOT EXISTS max_roi NUMERIC(10, 6), -- maximum ROI percentage
ADD COLUMN IF NOT EXISTS ath_price NUMERIC(38, 18), -- all-time high price
ADD COLUMN IF NOT EXISTS ath_timestamp TIMESTAMPTZ, -- timestamp of all-time high
ADD COLUMN IF NOT EXISTS atl_price NUMERIC(38, 18), -- all-time low price (from alert until ATH)
ADD COLUMN IF NOT EXISTS atl_timestamp TIMESTAMPTZ; -- timestamp of all-time low

-- Index for querying by caller and metrics
CREATE INDEX IF NOT EXISTS idx_alerts_caller_metrics ON alerts (caller_id, alert_timestamp) WHERE initial_mcap IS NOT NULL;

COMMENT ON COLUMN alerts.initial_mcap IS 'Market cap at alert time';
COMMENT ON COLUMN alerts.initial_price IS 'Price at alert time (for performance calculations)';
COMMENT ON COLUMN alerts.time_to_ath IS 'Time in seconds from alert to all-time high';
COMMENT ON COLUMN alerts.max_roi IS 'Maximum ROI percentage achieved';
COMMENT ON COLUMN alerts.ath_price IS 'All-time high price after alert';
COMMENT ON COLUMN alerts.ath_timestamp IS 'Timestamp when all-time high was reached';
COMMENT ON COLUMN alerts.atl_price IS 'All-time low price (from alert until ATH)';
COMMENT ON COLUMN alerts.atl_timestamp IS 'Timestamp when all-time low was reached';

