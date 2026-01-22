-- Migration: Create Error Events Table
-- Created: 2024-01-01
-- Description: Tracks and aggregates application errors for observability

CREATE TABLE IF NOT EXISTS error_events (
  id INTEGER PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  error_name VARCHAR(255) NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  severity VARCHAR(20) NOT NULL,
  context_json VARCHAR,
  service VARCHAR(100),
  resolved BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_error_timestamp ON error_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_error_severity ON error_events(severity);
CREATE INDEX IF NOT EXISTS idx_error_service ON error_events(service);
CREATE INDEX IF NOT EXISTS idx_error_resolved ON error_events(resolved);

-- Rollback script (for reference, not executed automatically)
-- DROP INDEX IF EXISTS idx_error_resolved;
-- DROP INDEX IF EXISTS idx_error_service;
-- DROP INDEX IF EXISTS idx_error_severity;
-- DROP INDEX IF EXISTS idx_error_timestamp;
-- DROP TABLE IF EXISTS error_events;

