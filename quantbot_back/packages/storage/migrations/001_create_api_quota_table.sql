-- Migration: Create API Quota Usage Table
-- Created: 2024-01-01
-- Description: Tracks API usage and quotas for external services (Birdeye, Helius, etc.)

CREATE TABLE IF NOT EXISTS api_quota_usage (
  id SERIAL PRIMARY KEY,
  service VARCHAR(50) NOT NULL,
  credits_used INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata_json JSONB,
  UNIQUE(service, DATE_TRUNC('day', timestamp))
);

CREATE INDEX IF NOT EXISTS idx_api_quota_service_date ON api_quota_usage(service, timestamp);
CREATE INDEX IF NOT EXISTS idx_api_quota_timestamp ON api_quota_usage(timestamp);

-- Rollback script (for reference, not executed automatically)
-- DROP INDEX IF EXISTS idx_api_quota_timestamp;
-- DROP INDEX IF EXISTS idx_api_quota_service_date;
-- DROP TABLE IF EXISTS api_quota_usage;

