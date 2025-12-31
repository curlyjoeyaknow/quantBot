-- Migration: Create simulator tables (filters, runs, run_trades, run_replay_index)
-- Created: 2026-01-01
-- Description: Tables for simulator architecture - filters, runs, trades, and replay index
--              These tables support the new simulator architecture with run orchestration

-- Filters table: Token filter presets (FilterV1)
CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  json TEXT NOT NULL, -- FilterV1 JSON
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Runs table: Simulation run metadata
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  status TEXT NOT NULL, -- pending|running|complete|complete_partial_universe|failed_preflight|failed
  summary_json TEXT, -- Run summary JSON
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP
);

-- Run Trades table: Individual trades from simulation runs
CREATE TABLE IF NOT EXISTS run_trades (
  run_id TEXT NOT NULL,
  token TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  entry_ts TIMESTAMP NOT NULL,
  exit_ts TIMESTAMP NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  pnl_pct REAL NOT NULL,
  exit_reason TEXT NOT NULL,
  PRIMARY KEY (run_id, trade_id)
);

-- Replay Index table: Index of replay frames for UI playback
CREATE TABLE IF NOT EXISTS run_replay_index (
  run_id TEXT NOT NULL,
  token TEXT NOT NULL,
  path TEXT NOT NULL,
  frame_count INTEGER NOT NULL,
  PRIMARY KEY (run_id, token)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_runs_strategy_id ON runs (strategy_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_trades_run_id ON run_trades (run_id);
CREATE INDEX IF NOT EXISTS idx_run_trades_token ON run_trades (token);
CREATE INDEX IF NOT EXISTS idx_run_trades_entry_ts ON run_trades (entry_ts);
CREATE INDEX IF NOT EXISTS idx_run_replay_index_run_id ON run_replay_index (run_id);
CREATE INDEX IF NOT EXISTS idx_run_replay_index_token ON run_replay_index (token);

-- Rollback script (for reference, not executed automatically)
-- DROP INDEX IF EXISTS idx_run_replay_index_token;
-- DROP INDEX IF EXISTS idx_run_replay_index_run_id;
-- DROP INDEX IF EXISTS idx_run_trades_entry_ts;
-- DROP INDEX IF EXISTS idx_run_trades_token;
-- DROP INDEX IF EXISTS idx_run_trades_run_id;
-- DROP INDEX IF EXISTS idx_runs_created_at;
-- DROP INDEX IF EXISTS idx_runs_status;
-- DROP INDEX IF EXISTS idx_runs_strategy_id;
-- DROP TABLE IF EXISTS run_replay_index;
-- DROP TABLE IF EXISTS run_trades;
-- DROP TABLE IF EXISTS runs;
-- DROP TABLE IF EXISTS filters;

