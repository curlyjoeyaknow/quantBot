-- RunSet Registry Schema
--
-- This is the "research registry" database.
-- It's small, powerful, and contains only metadata (not data).
--
-- Core principle: Reference sets, not individual artifacts.
--
-- Tables:
-- - registry.datasets: Immutable dataset metadata
-- - registry.artifacts: Immutable artifact references
-- - registry.runs: Immutable run metadata
-- - registry.runsets: RunSet specifications
-- - registry.runset_membership: RunSet → Run mapping (the magic join table)
-- - registry.resolutions: RunSet resolution history

-- Create schema
CREATE SCHEMA IF NOT EXISTS registry;

-- ============================================================================
-- Datasets (Immutable)
-- ============================================================================

CREATE TABLE IF NOT EXISTS registry.datasets (
    dataset_id VARCHAR PRIMARY KEY,
    kind VARCHAR NOT NULL,  -- 'ohlcv', 'alerts', 'candles'
    schema_version VARCHAR NOT NULL,
    provenance_json JSON NOT NULL,  -- { source, extractedAt, gitCommit }
    coverage_json JSON NOT NULL,  -- { dateRange, chains, venues, completeness }
    created_at TIMESTAMP NOT NULL,
    metadata_json JSON  -- Flexible metadata
);

CREATE INDEX IF NOT EXISTS idx_datasets_kind ON registry.datasets(kind);
CREATE INDEX IF NOT EXISTS idx_datasets_created_at ON registry.datasets(created_at DESC);

-- ============================================================================
-- Artifacts (Immutable)
-- ============================================================================

CREATE TABLE IF NOT EXISTS registry.artifacts (
    artifact_id VARCHAR PRIMARY KEY,
    kind VARCHAR NOT NULL,  -- 'trades', 'metrics', 'curves', 'ohlcv_slice', 'alerts'
    uri VARCHAR NOT NULL,  -- Parquet file path, DuckDB table, etc.
    content_hash VARCHAR NOT NULL,  -- SHA256 for verification
    dataset_id VARCHAR,  -- Foreign key to datasets (if part of a dataset)
    run_id VARCHAR,  -- Foreign key to runs (if part of a run)
    created_at TIMESTAMP NOT NULL,
    metadata_json JSON,  -- Flexible metadata
    FOREIGN KEY (dataset_id) REFERENCES registry.datasets(dataset_id),
    FOREIGN KEY (run_id) REFERENCES registry.runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON registry.artifacts(kind);
CREATE INDEX IF NOT EXISTS idx_artifacts_dataset_id ON registry.artifacts(dataset_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON registry.artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON registry.artifacts(created_at DESC);

-- ============================================================================
-- Runs (Immutable)
-- ============================================================================

CREATE TABLE IF NOT EXISTS registry.runs (
    run_id VARCHAR PRIMARY KEY,
    dataset_ids JSON NOT NULL,  -- Array of dataset_ids used as input
    strategy_hash VARCHAR NOT NULL,  -- SHA256 of StrategySpec
    engine_version VARCHAR NOT NULL,
    status VARCHAR NOT NULL,  -- 'pending', 'running', 'completed', 'failed'
    created_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    metadata_json JSON  -- Flexible metadata (strategy params, machine info, etc.)
);

CREATE INDEX IF NOT EXISTS idx_runs_strategy_hash ON registry.runs(strategy_hash);
CREATE INDEX IF NOT EXISTS idx_runs_engine_version ON registry.runs(engine_version);
CREATE INDEX IF NOT EXISTS idx_runs_status ON registry.runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON registry.runs(created_at DESC);

-- ============================================================================
-- RunSets (Selection Specifications)
-- ============================================================================

CREATE TABLE IF NOT EXISTS registry.runsets (
    runset_id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    description VARCHAR,
    spec_json JSON NOT NULL,  -- Full RunSetSpec
    spec_version VARCHAR NOT NULL DEFAULT '1.0.0',
    frozen BOOLEAN NOT NULL DEFAULT FALSE,  -- If true, resolution is pinned
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    metadata_json JSON  -- Flexible metadata
);

CREATE INDEX IF NOT EXISTS idx_runsets_frozen ON registry.runsets(frozen);
CREATE INDEX IF NOT EXISTS idx_runsets_created_at ON registry.runsets(created_at DESC);

-- ============================================================================
-- RunSet Membership (The Magic Join Table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS registry.runset_membership (
    runset_id VARCHAR NOT NULL,
    run_id VARCHAR NOT NULL,
    added_at TIMESTAMP NOT NULL,
    PRIMARY KEY (runset_id, run_id),
    FOREIGN KEY (runset_id) REFERENCES registry.runsets(runset_id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES registry.runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_runset_membership_runset_id ON registry.runset_membership(runset_id);
CREATE INDEX IF NOT EXISTS idx_runset_membership_run_id ON registry.runset_membership(run_id);

-- ============================================================================
-- Resolutions (Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS registry.resolutions (
    resolution_id VARCHAR PRIMARY KEY,
    runset_id VARCHAR NOT NULL,
    resolver_version VARCHAR NOT NULL,
    resolved_at TIMESTAMP NOT NULL,
    resolved_list_hash VARCHAR NOT NULL,  -- SHA256 of sorted run_id list
    resolved_json JSON NOT NULL,  -- Full RunSetResolution
    frozen BOOLEAN NOT NULL DEFAULT FALSE,  -- If true, this is a pinned resolution
    FOREIGN KEY (runset_id) REFERENCES registry.runsets(runset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resolutions_runset_id ON registry.resolutions(runset_id);
CREATE INDEX IF NOT EXISTS idx_resolutions_resolved_at ON registry.resolutions(resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_resolutions_frozen ON registry.resolutions(frozen);

-- ============================================================================
-- RunSet Tags (For Flexible Querying)
-- ============================================================================

CREATE TABLE IF NOT EXISTS registry.runset_tags (
    runset_id VARCHAR NOT NULL,
    tag VARCHAR NOT NULL,
    PRIMARY KEY (runset_id, tag),
    FOREIGN KEY (runset_id) REFERENCES registry.runsets(runset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runset_tags_tag ON registry.runset_tags(tag);

-- ============================================================================
-- Views (Convenience Queries)
-- ============================================================================

-- View: RunSets with latest resolution
CREATE OR REPLACE VIEW registry.runsets_with_resolution AS
SELECT
    rs.runset_id,
    rs.name,
    rs.description,
    rs.spec_json,
    rs.frozen,
    rs.created_at,
    rs.updated_at,
    r.resolution_id,
    r.resolver_version,
    r.resolved_at,
    r.resolved_list_hash,
    r.resolved_json,
    (SELECT COUNT(*) FROM registry.runset_membership WHERE runset_id = rs.runset_id) as run_count
FROM registry.runsets rs
LEFT JOIN LATERAL (
    SELECT *
    FROM registry.resolutions
    WHERE runset_id = rs.runset_id
    ORDER BY resolved_at DESC
    LIMIT 1
) r ON TRUE;

-- View: Runs with artifact counts
CREATE OR REPLACE VIEW registry.runs_with_artifacts AS
SELECT
    r.run_id,
    r.dataset_ids,
    r.strategy_hash,
    r.engine_version,
    r.status,
    r.created_at,
    r.completed_at,
    (SELECT COUNT(*) FROM registry.artifacts WHERE run_id = r.run_id) as artifact_count,
    (SELECT COUNT(*) FROM registry.runset_membership WHERE run_id = r.run_id) as runset_count
FROM registry.runs r;

-- View: Dataset coverage summary
CREATE OR REPLACE VIEW registry.dataset_coverage AS
SELECT
    d.dataset_id,
    d.kind,
    d.schema_version,
    d.created_at,
    json_extract(d.coverage_json, '$.dateRange.from') as coverage_from,
    json_extract(d.coverage_json, '$.dateRange.to') as coverage_to,
    json_extract(d.coverage_json, '$.completeness') as completeness,
    (SELECT COUNT(*) FROM registry.artifacts WHERE dataset_id = d.dataset_id) as artifact_count
FROM registry.datasets d;

-- ============================================================================
-- Convenience Functions
-- ============================================================================

-- Function: Get runs for a RunSet
CREATE OR REPLACE FUNCTION registry.get_runset_runs(runset_id_param VARCHAR)
RETURNS TABLE (
    run_id VARCHAR,
    strategy_hash VARCHAR,
    engine_version VARCHAR,
    status VARCHAR,
    created_at TIMESTAMP
) AS $$
    SELECT
        r.run_id,
        r.strategy_hash,
        r.engine_version,
        r.status,
        r.created_at
    FROM registry.runs r
    INNER JOIN registry.runset_membership m ON r.run_id = m.run_id
    WHERE m.runset_id = runset_id_param
    ORDER BY r.created_at DESC;
$$;

-- Function: Get artifacts for a RunSet
CREATE OR REPLACE FUNCTION registry.get_runset_artifacts(runset_id_param VARCHAR)
RETURNS TABLE (
    artifact_id VARCHAR,
    kind VARCHAR,
    uri VARCHAR,
    content_hash VARCHAR,
    run_id VARCHAR
) AS $$
    SELECT
        a.artifact_id,
        a.kind,
        a.uri,
        a.content_hash,
        a.run_id
    FROM registry.artifacts a
    INNER JOIN registry.runset_membership m ON a.run_id = m.run_id
    WHERE m.runset_id = runset_id_param
    ORDER BY a.kind, a.created_at DESC;
$$;

-- ============================================================================
-- Comments (Documentation)
-- ============================================================================

COMMENT ON SCHEMA registry IS 'RunSet registry - metadata only, no data';

COMMENT ON TABLE registry.datasets IS 'Immutable dataset metadata. If you fix OHLCV, that is a new dataset_id.';
COMMENT ON TABLE registry.artifacts IS 'Immutable artifact references (Parquet files, DuckDB tables, etc.)';
COMMENT ON TABLE registry.runs IS 'Immutable run metadata (one execution of a strategy on a dataset)';
COMMENT ON TABLE registry.runsets IS 'RunSet specifications (logical selections, not data)';
COMMENT ON TABLE registry.runset_membership IS 'RunSet → Run mapping (the magic join table)';
COMMENT ON TABLE registry.resolutions IS 'RunSet resolution history (audit trail)';

COMMENT ON COLUMN registry.runsets.frozen IS 'If true, resolution is pinned for reproducibility';
COMMENT ON COLUMN registry.resolutions.frozen IS 'If true, this is a pinned resolution (reproducible mode)';

