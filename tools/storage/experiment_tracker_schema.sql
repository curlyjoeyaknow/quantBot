-- Experiment Tracker Schema
-- 
-- Tracks experiments with artifact lineage.
-- Experiments declare frozen artifact sets, track execution status, and store output artifact IDs.
--
-- Design principles:
-- - Experiments are immutable once created (except status and outputs)
-- - Input artifacts stored as JSON arrays for flexible querying
-- - Output artifacts stored as separate columns for type safety
-- - Provenance tracked for reproducibility

-- Experiments table
CREATE TABLE IF NOT EXISTS experiments (
  -- Identity
  experiment_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  
  -- Input artifacts (JSON arrays of artifact IDs)
  input_alerts TEXT NOT NULL,      -- JSON array: ["alert-1", "alert-2"]
  input_ohlcv TEXT NOT NULL,       -- JSON array: ["ohlcv-1"]
  input_strategies TEXT,           -- JSON array: ["strategy-1"] (optional)
  
  -- Configuration (JSON object)
  config TEXT NOT NULL,            -- JSON: { strategy: {...}, dateRange: {...}, params: {...} }
  
  -- Provenance
  git_commit TEXT NOT NULL,
  git_dirty BOOLEAN NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Output artifacts (optional, populated after completion)
  output_trades TEXT,              -- Trades artifact ID
  output_metrics TEXT,             -- Metrics artifact ID
  output_curves TEXT,              -- Curves artifact ID
  output_diagnostics TEXT,         -- Diagnostics artifact ID
  
  -- Execution metadata
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  error TEXT
);

-- Index for status queries (common filter)
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);

-- Index for created_at queries (time-based filtering)
CREATE INDEX IF NOT EXISTS idx_experiments_created ON experiments(created_at);

-- Index for git_commit queries (provenance tracking)
CREATE INDEX IF NOT EXISTS idx_experiments_commit ON experiments(git_commit);

-- Index for experiment name searches
CREATE INDEX IF NOT EXISTS idx_experiments_name ON experiments(name);

-- Comments for documentation
COMMENT ON TABLE experiments IS 'Experiment tracking with artifact lineage';
COMMENT ON COLUMN experiments.experiment_id IS 'Unique experiment identifier';
COMMENT ON COLUMN experiments.name IS 'Human-readable experiment name';
COMMENT ON COLUMN experiments.description IS 'Optional experiment description';
COMMENT ON COLUMN experiments.status IS 'Experiment status: pending, running, completed, failed, cancelled';
COMMENT ON COLUMN experiments.input_alerts IS 'JSON array of alert artifact IDs';
COMMENT ON COLUMN experiments.input_ohlcv IS 'JSON array of OHLCV artifact IDs';
COMMENT ON COLUMN experiments.input_strategies IS 'JSON array of strategy artifact IDs (optional)';
COMMENT ON COLUMN experiments.config IS 'JSON configuration object';
COMMENT ON COLUMN experiments.git_commit IS 'Git commit hash for reproducibility';
COMMENT ON COLUMN experiments.git_dirty IS 'Whether git working directory was dirty';
COMMENT ON COLUMN experiments.engine_version IS 'Engine version for reproducibility';
COMMENT ON COLUMN experiments.created_at IS 'Experiment creation timestamp';
COMMENT ON COLUMN experiments.output_trades IS 'Trades artifact ID (populated after completion)';
COMMENT ON COLUMN experiments.output_metrics IS 'Metrics artifact ID (populated after completion)';
COMMENT ON COLUMN experiments.output_curves IS 'Curves artifact ID (populated after completion)';
COMMENT ON COLUMN experiments.output_diagnostics IS 'Diagnostics artifact ID (populated after completion)';
COMMENT ON COLUMN experiments.started_at IS 'Execution start timestamp';
COMMENT ON COLUMN experiments.completed_at IS 'Execution completion timestamp';
COMMENT ON COLUMN experiments.duration_ms IS 'Execution duration in milliseconds';
COMMENT ON COLUMN experiments.error IS 'Error message if failed';

