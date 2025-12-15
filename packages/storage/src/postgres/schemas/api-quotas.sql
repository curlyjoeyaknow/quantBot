-- API Quota Usage Tracking
-- Tracks API usage and quotas for external services (Birdeye, Helius, etc.)

CREATE TABLE IF NOT EXISTS api_quota_usage (
  id SERIAL PRIMARY KEY,
  service VARCHAR(50) NOT NULL,
  credits_used INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata_json JSONB,
  UNIQUE(service, DATE_TRUNC('day', timestamp))
);

CREATE INDEX idx_api_quota_service_date ON api_quota_usage(service, timestamp);
CREATE INDEX idx_api_quota_timestamp ON api_quota_usage(timestamp);

