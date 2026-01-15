-- Catalogue Schema for Lab Artifacts
-- Tracks reusable slices, features, and simulation runs

-- Token sets: stable IDs from sorted token lists
CREATE TABLE IF NOT EXISTS token_sets (
  token_set_id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  tokens_sha TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Slices: dataset + time range + token set + schema
CREATE TABLE IF NOT EXISTS slices (
  slice_id TEXT PRIMARY KEY,
  dataset TEXT NOT NULL,
  chain TEXT NOT NULL,
  interval TEXT NOT NULL,
  start_iso TEXT NOT NULL,
  end_iso TEXT NOT NULL,
  token_set_id TEXT NOT NULL,
  schema_hash TEXT NOT NULL,
  slice_hash TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (token_set_id) REFERENCES token_sets(token_set_id)
);

CREATE INDEX IF NOT EXISTS idx_slices_lookup ON slices(dataset, chain, interval, start_iso, end_iso, token_set_id, schema_hash);

-- Feature sets: feature spec hashes with versioning
CREATE TABLE IF NOT EXISTS feature_sets (
  feature_set_id TEXT PRIMARY KEY,
  feature_spec_hash TEXT NOT NULL,
  feature_spec_json TEXT NOT NULL,
  feature_set_version TEXT NOT NULL DEFAULT '1.0.0',
  feature_spec_version TEXT NOT NULL DEFAULT '1.0.0',
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  computed_by TEXT, -- Git commit hash
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Features: slice + feature set combinations with versioning
CREATE TABLE IF NOT EXISTS features (
  features_id TEXT PRIMARY KEY,
  slice_id TEXT NOT NULL,
  feature_set_id TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  parquet_path TEXT NOT NULL,
  feature_set_version TEXT NOT NULL DEFAULT '1.0.0',
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  computed_by TEXT, -- Git commit hash
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (slice_id) REFERENCES slices(slice_id),
  FOREIGN KEY (feature_set_id) REFERENCES feature_sets(feature_set_id)
);

CREATE INDEX IF NOT EXISTS idx_features_lookup ON features(slice_id, feature_set_id);

-- Simulation runs: features + strategy + risk + window
CREATE TABLE IF NOT EXISTS sim_runs (
  sim_id TEXT PRIMARY KEY,
  features_id TEXT NOT NULL,
  strategy_hash TEXT NOT NULL,
  risk_hash TEXT NOT NULL,
  window_id TEXT,
  summary_path TEXT NOT NULL,
  artifact_dir TEXT NOT NULL,
  code_version TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (features_id) REFERENCES features(features_id)
);

CREATE INDEX IF NOT EXISTS idx_sim_runs_features ON sim_runs(features_id);
CREATE INDEX IF NOT EXISTS idx_sim_runs_strategy ON sim_runs(strategy_hash);
CREATE INDEX IF NOT EXISTS idx_sim_runs_risk ON sim_runs(risk_hash);


