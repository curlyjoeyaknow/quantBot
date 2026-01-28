-- Artifact Manifest (SQLite) v1
-- "Receipt book" for immutable Parquet artifacts.
-- DuckDB is disposable. Parquet is truth. SQLite is the ledger.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version      INTEGER PRIMARY KEY,
  applied_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id    TEXT PRIMARY KEY,                     -- uuid
  artifact_type  TEXT NOT NULL,                        -- alerts | ohlcv_slice | run_metrics | ...
  schema_version INTEGER NOT NULL,                     -- producer schema version
  logical_key    TEXT NOT NULL,                        -- "what this represents" (token/res/date/run_id...)
  status         TEXT NOT NULL DEFAULT 'active',       -- active | superseded | tombstoned

  path_parquet   TEXT NOT NULL,                        -- absolute or repo-relative path
  path_sidecar   TEXT NOT NULL,

  file_hash      TEXT NOT NULL UNIQUE,                 -- sha256:<hex> of parquet bytes
  content_hash   TEXT NOT NULL,                        -- sha256:<hex> of canonicalized content

  row_count      INTEGER NOT NULL,
  min_ts         TEXT,                                 -- ISO8601 UTC if applicable
  max_ts         TEXT,                                 -- ISO8601 UTC if applicable

  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  CHECK(status IN ('active','superseded','tombstoned'))
);

CREATE INDEX IF NOT EXISTS idx_artifacts_type_key
  ON artifacts(artifact_type, logical_key);

CREATE INDEX IF NOT EXISTS idx_artifacts_content_hash
  ON artifacts(content_hash);

CREATE TABLE IF NOT EXISTS artifact_lineage (
  artifact_id       TEXT NOT NULL,
  input_artifact_id TEXT NOT NULL,
  PRIMARY KEY (artifact_id, input_artifact_id),
  FOREIGN KEY (artifact_id)       REFERENCES artifacts(artifact_id)       ON DELETE CASCADE,
  FOREIGN KEY (input_artifact_id) REFERENCES artifacts(artifact_id)       ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artifact_tags (
  artifact_id  TEXT NOT NULL,
  k            TEXT NOT NULL,
  v            TEXT NOT NULL,
  PRIMARY KEY (artifact_id, k, v),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(artifact_id) ON DELETE CASCADE
);

-- Optional: supersession mapping (helps queries)
CREATE TABLE IF NOT EXISTS artifact_supersedes (
  artifact_id          TEXT NOT NULL PRIMARY KEY,
  supersedes_artifact_id TEXT NOT NULL,
  FOREIGN KEY (artifact_id)            REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_artifact_id) REFERENCES artifacts(artifact_id) ON DELETE RESTRICT
);

-- Semantic-dedupe helpers
CREATE INDEX IF NOT EXISTS idx_artifacts_type_key_content
  ON artifacts(artifact_type, logical_key, content_hash);
