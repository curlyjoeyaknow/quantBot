-- Error Events Tracking
-- Tracks and aggregates application errors for observability

CREATE TABLE IF NOT EXISTS error_events (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  error_name VARCHAR(255) NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  severity VARCHAR(20) NOT NULL,
  context_json JSONB,
  service VARCHAR(100),
  resolved BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_error_timestamp ON error_events(timestamp);
CREATE INDEX idx_error_severity ON error_events(severity);
CREATE INDEX idx_error_service ON error_events(service);
CREATE INDEX idx_error_resolved ON error_events(resolved);

