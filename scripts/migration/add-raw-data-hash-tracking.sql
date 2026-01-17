-- Migration: Add raw data hash tracking for idempotency
-- Creates raw_data_hashes table to track ingested raw data files

CREATE TABLE IF NOT EXISTS raw_data_hashes (
  hash TEXT PRIMARY KEY,
  source_type TEXT NOT NULL, -- 'telegram', 'ohlcv', 'api', etc.
  source_path TEXT, -- Path to source file or API endpoint
  ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_id TEXT, -- Link to ingestion run if applicable
  metadata_json TEXT -- Additional metadata (JSON)
);

CREATE INDEX IF NOT EXISTS idx_raw_data_hashes_source_type ON raw_data_hashes(source_type);
CREATE INDEX IF NOT EXISTS idx_raw_data_hashes_ingested_at ON raw_data_hashes(ingested_at);
CREATE INDEX IF NOT EXISTS idx_raw_data_hashes_run_id ON raw_data_hashes(run_id);

-- Add hash column to ingestion_runs if it doesn't exist
-- (This is already tracked as input_file_hash, but we'll ensure consistency)
-- Note: ingestion_runs.input_file_hash already exists, so this is just for reference

