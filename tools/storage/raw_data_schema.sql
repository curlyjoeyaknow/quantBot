-- Raw Data Schema (Append-Only)
-- Stores immutable raw data inputs (Telegram exports, API responses, etc.)

CREATE TABLE IF NOT EXISTS raw_data (
    id TEXT NOT NULL PRIMARY KEY,
    source_type TEXT NOT NULL,  -- 'telegram_export', 'api_response', 'file_upload', 'stream_event'
    source_id TEXT NOT NULL,     -- e.g., chat_id, API endpoint, file path
    hash TEXT NOT NULL,          -- SHA256 hash of content (for deduplication)
    content TEXT NOT NULL,       -- Raw content (JSON or text)
    run_id TEXT NOT NULL,        -- Ingestion run ID
    ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata_json JSON           -- Source-specific metadata
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_raw_data_source_type ON raw_data(source_type);
CREATE INDEX IF NOT EXISTS idx_raw_data_source_id ON raw_data(source_id);
CREATE INDEX IF NOT EXISTS idx_raw_data_hash ON raw_data(hash);
CREATE INDEX IF NOT EXISTS idx_raw_data_run_id ON raw_data(run_id);
CREATE INDEX IF NOT EXISTS idx_raw_data_ingested_at ON raw_data(ingested_at);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_raw_data_source_time ON raw_data(source_type, source_id, ingested_at);

