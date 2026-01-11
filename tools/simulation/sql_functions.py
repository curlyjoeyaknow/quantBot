"""
SQL functions and schema setup for simulation engine.
"""

import duckdb
from typing import Optional

SIMULATION_SCHEMA_SQL = """
-- Strategy definitions
CREATE TABLE IF NOT EXISTS simulation_strategies (
  strategy_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entry_config JSON,
  exit_config JSON,
  reentry_config JSON,
  cost_config JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Simulation runs (one per strategy + token + time window)
CREATE TABLE IF NOT EXISTS simulation_runs (
  run_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  mint TEXT NOT NULL,
  alert_timestamp TIMESTAMP NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  initial_capital DOUBLE NOT NULL,
  final_capital DOUBLE,
  total_return_pct DOUBLE,
  max_drawdown_pct DOUBLE,
  sharpe_ratio DOUBLE,
  win_rate DOUBLE,
  total_trades INTEGER,
  caller_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (strategy_id) REFERENCES simulation_strategies(strategy_id)
);

-- Strategy configurations (replica of strategies table with run-specific parameters)
-- Each unique config gets its own ID, allowing reuse across runs
CREATE TABLE IF NOT EXISTS strategy_config (
  strategy_config_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  entry_config JSON NOT NULL,
  exit_config JSON NOT NULL,
  reentry_config JSON,
  cost_config JSON,
  stop_loss_config JSON,
  entry_signal_config JSON,
  exit_signal_config JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (strategy_id) REFERENCES simulation_strategies(strategy_id)
);

-- Run strategies used (links runs to their exact strategy configuration)
-- This allows reproducibility even if strategy config changes later
CREATE TABLE IF NOT EXISTS run_strategies_used (
  run_id TEXT NOT NULL,
  strategy_config_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id),
  FOREIGN KEY (run_id) REFERENCES simulation_runs(run_id),
  FOREIGN KEY (strategy_config_id) REFERENCES strategy_config(strategy_config_id)
);

-- Simulation events (trades, entries, exits)
CREATE TABLE IF NOT EXISTS simulation_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'entry'|'exit'|'stop_loss'|'reentry'
  timestamp TIMESTAMP NOT NULL,
  price DOUBLE NOT NULL,
  quantity DOUBLE NOT NULL,
  value_usd DOUBLE NOT NULL,
  fee_usd DOUBLE NOT NULL,
  pnl_usd DOUBLE,
  cumulative_pnl_usd DOUBLE,
  position_size DOUBLE,
  metadata JSON,
  FOREIGN KEY (run_id) REFERENCES simulation_runs(run_id)
);

-- OHLCV candles table (if not exists, create view from existing data)
CREATE TABLE IF NOT EXISTS ohlcv_candles_d (
  mint TEXT NOT NULL,
  timestamp INTEGER NOT NULL,  -- Unix timestamp in seconds
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  volume DOUBLE NOT NULL,
  interval_seconds INTEGER NOT NULL,
  source TEXT,  -- 'birdeye'|'clickhouse'|'cache'
  PRIMARY KEY (mint, timestamp, interval_seconds)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_simulation_runs_strategy ON simulation_runs(strategy_id);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_mint ON simulation_runs(mint);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_alert_timestamp ON simulation_runs(alert_timestamp);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_caller ON simulation_runs(caller_name);
CREATE INDEX IF NOT EXISTS idx_simulation_events_run ON simulation_events(run_id);
CREATE INDEX IF NOT EXISTS idx_ohlcv_mint_timestamp ON ohlcv_candles_d(mint, timestamp);
CREATE INDEX IF NOT EXISTS idx_strategy_config_strategy_id ON strategy_config(strategy_id);
CREATE INDEX IF NOT EXISTS idx_run_strategies_used_config ON run_strategies_used(strategy_config_id);
"""

def setup_simulation_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Set up simulation tables and indexes in DuckDB."""
    con.execute(SIMULATION_SCHEMA_SQL)
    con.commit()

def create_strategy(
    con: duckdb.DuckDBPyConnection,
    strategy_id: str,
    name: str,
    entry_config: dict,
    exit_config: dict,
    reentry_config: Optional[dict] = None,
    cost_config: Optional[dict] = None
) -> None:
    """Create a new strategy in the database."""
    import json
    
    con.execute("""
        INSERT OR REPLACE INTO simulation_strategies
        (strategy_id, name, entry_config, exit_config, reentry_config, cost_config)
        VALUES (?, ?, ?, ?, ?, ?)
    """, [
        strategy_id,
        name,
        json.dumps(entry_config),
        json.dumps(exit_config),
        json.dumps(reentry_config) if reentry_config else None,
        json.dumps(cost_config) if cost_config else None
    ])
    con.commit()

