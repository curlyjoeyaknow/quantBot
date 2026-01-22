-- Schema Migrations Table
-- Description: Track schema version history for DuckDB and ClickHouse
-- Purpose: Enable versioned migrations with rollback capability
--
-- Addresses: Risk #1 from ARCHITECTURE_REVIEW_2026-01-21.md
--           Schema migration strategy is implicit

BEGIN TRANSACTION;

-- Schema migrations tracking table (for DuckDB)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT,
  database_type VARCHAR NOT NULL, -- 'duckdb' or 'clickhouse'
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_by VARCHAR DEFAULT 'system',
  checksum VARCHAR, -- SHA256 of migration SQL
  execution_time_ms INTEGER,
  status VARCHAR NOT NULL DEFAULT 'applied', -- 'applied', 'rolled_back', 'failed'
  rollback_sql TEXT -- SQL to undo this migration
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_schema_migrations_version 
  ON schema_migrations(version);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_database_type 
  ON schema_migrations(database_type);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_status 
  ON schema_migrations(status);

-- Current schema version view (latest applied migration per database)
CREATE OR REPLACE VIEW current_schema_version AS
SELECT 
  database_type,
  MAX(version) as current_version,
  COUNT(*) as total_migrations
FROM schema_migrations
WHERE status = 'applied'
GROUP BY database_type;

COMMIT;

-- Insert initial migration record
INSERT INTO schema_migrations (version, name, description, database_type, status)
VALUES (0, 'initial', 'Schema migrations tracking table', 'duckdb', 'applied')
ON CONFLICT (version) DO NOTHING;

