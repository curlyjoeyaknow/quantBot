-- Migration: Add first_caller flag to alerts table
-- Created: 2025-12-16
-- Description: Tracks whether this alert is the first call for a token (first_caller=true)
--              or a duplicate call from a different caller (first_caller=false)

ALTER TABLE alerts
ADD COLUMN IF NOT EXISTS first_caller BOOLEAN DEFAULT TRUE;

-- Update existing alerts to mark first caller
-- This assumes the first alert chronologically is the first caller
UPDATE alerts a1
SET first_caller = (
  SELECT a1.alert_timestamp <= MIN(a2.alert_timestamp)
  FROM alerts a2
  WHERE a2.token_id = a1.token_id
)
WHERE first_caller IS NULL;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_alerts_first_caller ON alerts (token_id, first_caller, alert_timestamp);

-- Rollback script (for reference, not executed automatically)
-- DROP INDEX IF EXISTS idx_alerts_first_caller;
-- ALTER TABLE alerts DROP COLUMN IF EXISTS first_caller;

