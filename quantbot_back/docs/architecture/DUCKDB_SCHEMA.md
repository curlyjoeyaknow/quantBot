# DuckDB Schema Documentation

> Comprehensive documentation of all DuckDB database schemas used in QuantBot

Last updated: 2025-01-23

---

## Overview

QuantBot uses DuckDB for multiple storage purposes:

1. **Telegram Ingestion** - Normalized messages, caller links, and user calls
2. **Storage Package** - Callers, strategies, token data coverage, errors, artifacts
3. **Simulation Engine** - Strategy definitions, simulation runs, events, and OHLCV data

Each domain uses its own DuckDB database file or tables within a shared database.

---

## Table of Contents

1. [Telegram Ingestion Tables](#telegram-ingestion-tables)
2. [Storage Package Tables](#storage-package-tables)
3. [Simulation Engine Tables](#simulation-engine-tables)
4. [Schema Evolution](#schema-evolution)
5. [Indexes and Performance](#indexes-and-performance)
6. [Database Files](#database-files)

---

## Telegram Ingestion Tables

Location: `tools/telegram/duckdb_punch_pipeline.py`

### `tg_norm_d` - Normalized Telegram Messages

Stores normalized Telegram chat messages.

```sql
CREATE TABLE IF NOT EXISTS tg_norm_d (
  chat_id TEXT NOT NULL,
  chat_name TEXT,
  message_id BIGINT NOT NULL,
  ts_ms BIGINT,
  from_name TEXT,
  from_id TEXT,
  type TEXT,
  is_service BOOLEAN,
  reply_to_message_id BIGINT,
  text TEXT,
  links_json TEXT,
  norm_json TEXT,
  run_id TEXT NOT NULL DEFAULT 'legacy',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, run_id)
);
```

**Columns:**

- `chat_id` - Telegram chat ID
- `chat_name` - Chat name/username
- `message_id` - Message ID (unique within chat)
- `ts_ms` - Timestamp in milliseconds
- `from_name` - Sender display name
- `from_id` - Sender user ID
- `type` - Message type
- `is_service` - Whether message is a service message
- `reply_to_message_id` - ID of replied-to message
- `text` - Message text content
- `links_json` - Extracted links (JSON)
- `norm_json` - Normalized message data (JSON)
- `run_id` - Ingestion run ID (for idempotency)
- `inserted_at` - Insertion timestamp

**Indexes:**

- `idx_tg_norm_run_id` - On `run_id`
- `idx_tg_norm_chat_message` - On `(chat_id, message_id)`

### `caller_links_d` - Token Caller Links

Links trigger messages to bot response messages containing token information.

```sql
CREATE TABLE IF NOT EXISTS caller_links_d (
  trigger_chat_id TEXT NOT NULL,
  trigger_message_id BIGINT NOT NULL,
  trigger_ts_ms BIGINT,
  trigger_from_id TEXT,
  trigger_from_name TEXT,
  trigger_text TEXT,
  bot_message_id BIGINT NOT NULL,
  bot_ts_ms BIGINT,
  bot_from_name TEXT,
  bot_type TEXT,
  token_name TEXT,
  ticker TEXT,
  mint TEXT,
  mint_raw TEXT,
  mint_validation_status TEXT,
  mint_validation_reason TEXT,
  chain TEXT,
  platform TEXT,
  token_age_s BIGINT,
  token_created_ts_ms BIGINT,
  views BIGINT,
  price_usd DOUBLE,
  price_move_pct DOUBLE,
  mcap_usd DOUBLE,
  mcap_change_pct DOUBLE,
  vol_usd DOUBLE,
  liquidity_usd DOUBLE,
  zero_liquidity BOOLEAN DEFAULT FALSE,
  chg_1h_pct DOUBLE,
  buys_1h BIGINT,
  sells_1h BIGINT,
  ath_mcap_usd DOUBLE,
  ath_drawdown_pct DOUBLE,
  ath_age_s BIGINT,
  fresh_1d_pct DOUBLE,
  fresh_7d_pct DOUBLE,
  top10_pct DOUBLE,
  holders_total BIGINT,
  top5_holders_pct_json TEXT,
  dev_sold BOOLEAN,
  dex_paid BOOLEAN,
  card_json TEXT,
  validation_passed BOOLEAN,
  run_id TEXT NOT NULL DEFAULT 'legacy',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trigger_chat_id, trigger_message_id, bot_message_id, run_id)
);
```

**Key Columns:**

- `trigger_*` - Original trigger message info
- `bot_*` - Bot response message info
- `mint` - Token mint address
- `ticker` - Token ticker symbol
- `price_usd`, `mcap_usd`, `vol_usd` - Market metrics
- `run_id` - Ingestion run ID
- `inserted_at` - Insertion timestamp

**Indexes:**

- `idx_caller_links_run_id` - On `run_id`
- `idx_caller_links_mint` - On `mint`

### `user_calls_d` - User Token Calls

Deduplicated token calls from users.

```sql
CREATE TABLE IF NOT EXISTS user_calls_d (
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  call_ts_ms BIGINT,
  call_datetime TIMESTAMP,
  caller_name TEXT,
  caller_id TEXT,
  trigger_text TEXT,
  bot_reply_id_1 BIGINT,
  bot_reply_id_2 BIGINT,
  mint TEXT,
  ticker TEXT,
  mcap_usd DOUBLE,
  price_usd DOUBLE,
  first_caller BOOLEAN DEFAULT FALSE,
  token_resolution_method TEXT,
  run_id TEXT NOT NULL DEFAULT 'legacy',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, run_id)
);
```

**Key Columns:**

- `caller_name` - Name of the caller
- `mint` - Token mint address
- `first_caller` - Whether this was the first caller for this token
- `run_id` - Ingestion run ID
- `inserted_at` - Insertion timestamp

**Indexes:**

- `idx_user_calls_run_id` - On `run_id`
- `idx_user_calls_mint` - On `mint`

### `ingestion_runs` - Ingestion Run Tracking

Tracks ingestion runs for idempotency and error recovery.

```sql
CREATE TABLE IF NOT EXISTS ingestion_runs (
  run_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  input_file_path TEXT NOT NULL,
  input_file_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  rows_inserted_tg_norm INTEGER DEFAULT 0,
  rows_inserted_caller_links INTEGER DEFAULT 0,
  rows_inserted_user_calls INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Status Values:** `'running'`, `'completed'`, `'failed'`, `'partial'`

**Indexes:**

- `idx_ingestion_runs_chat_id` - On `chat_id`
- `idx_ingestion_runs_status` - On `status`
- `idx_ingestion_runs_input_hash` - On `input_file_hash`

---

## Storage Package Tables

Location: `packages/storage/src/duckdb/` and `tools/storage/`

### `callers` - Caller Information

Extracted and managed caller information from calls data.

```sql
CREATE TABLE IF NOT EXISTS callers (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT,
  attributes_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, handle)
);
```

**Columns:**

- `id` - Primary key
- `source` - Caller source (e.g., 'telegram')
- `handle` - Caller handle/username
- `display_name` - Display name
- `attributes_json` - Additional attributes (JSON)
- `created_at`, `updated_at` - Timestamps

**Indexes:**

- `idx_callers_source_handle` - On `(source, handle)`

**Repository:** `CallersRepository`

### `strategies` - Strategy Definitions

Strategy configuration storage.

```sql
CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1',
  category TEXT,
  description TEXT,
  config_json TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (name, version)
);
```

**Columns:**

- `id` - Primary key
- `name` - Strategy name
- `version` - Strategy version
- `category` - Strategy category
- `description` - Strategy description
- `config_json` - Strategy configuration (JSON)
- `is_active` - Whether strategy is active
- `created_at`, `updated_at` - Timestamps

**Indexes:**

- `idx_strategies_name_version` - On `(name, version)`
- `idx_strategies_is_active` - On `is_active`

**Repository:** `StrategiesRepository`

### `token_data` - OHLCV Coverage Tracking

Tracks which tokens have OHLCV data in ClickHouse.

```sql
CREATE TABLE IF NOT EXISTS token_data (
  mint TEXT NOT NULL,
  chain TEXT NOT NULL,
  interval TEXT NOT NULL,
  earliest_timestamp TIMESTAMP,
  latest_timestamp TIMESTAMP,
  candle_count INTEGER NOT NULL DEFAULT 0,
  coverage_percent DOUBLE NOT NULL DEFAULT 0,
  last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mint, chain, interval)
);
```

**Columns:**

- `mint` - Token mint address
- `chain` - Chain name (solana, bsc, etc.)
- `interval` - Candle interval (1m, 5m, 15m, 1h, etc.)
- `earliest_timestamp` - Earliest candle timestamp
- `latest_timestamp` - Latest candle timestamp
- `candle_count` - Total candle count
- `coverage_percent` - Coverage percentage (0-100)
- `last_updated` - Last update timestamp

**Indexes:**

- `idx_token_data_mint` - On `mint`
- `idx_token_data_chain` - On `chain`
- `idx_token_data_interval` - On `interval`

**Repository:** `TokenDataRepository`

### `error_events` - Error Logging

Error event logging and tracking.

```sql
CREATE TABLE IF NOT EXISTS error_events (
  id INTEGER PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  severity TEXT NOT NULL,
  service TEXT NOT NULL,
  error_name TEXT,
  error_message TEXT,
  stack_trace TEXT,
  metadata_json TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMP
);
```

**Columns:**

- `id` - Primary key
- `timestamp` - Error timestamp
- `severity` - Error severity (info, warning, error, critical)
- `service` - Service name
- `error_name` - Error class name
- `error_message` - Error message
- `stack_trace` - Stack trace
- `metadata_json` - Additional metadata (JSON)
- `resolved` - Whether error is resolved
- `resolved_at` - Resolution timestamp

**Indexes:**

- `idx_error_timestamp` - On `timestamp`
- `idx_error_severity` - On `severity`
- `idx_error_service` - On `service`
- `idx_error_resolved` - On `resolved`
- `idx_error_name` - On `error_name`

**Repository:** `ErrorRepository`

### `artifacts` - Versioned Artifacts

Stores versioned artifacts (strategies, sim runs, configs, etc.).

```sql
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  hash TEXT NOT NULL,
  content_json JSON NOT NULL,
  metadata_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version)
);
```

**Columns:**

- `id` - Artifact ID
- `version` - Artifact version
- `type` - Artifact type
- `hash` - Content hash
- `content_json` - Artifact content (JSON)
- `metadata_json` - Artifact metadata (JSON)
- `created_at` - Creation timestamp

**Indexes:**

- `idx_artifacts_id` - On `id`
- `idx_artifacts_type` - On `type`
- `idx_artifacts_hash` - On `hash`
- `idx_artifacts_created_at` - On `created_at`

### `artifact_tags` - Artifact Tags

Tags for artifacts.

```sql
CREATE TABLE IF NOT EXISTS artifact_tags (
  artifact_id TEXT NOT NULL,
  artifact_version TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (artifact_id, artifact_version, tag),
  FOREIGN KEY (artifact_id, artifact_version) 
    REFERENCES artifacts(id, version) ON DELETE CASCADE
);
```

**Indexes:**

- `idx_artifact_tags_tag` - On `tag`

---

## Simulation Engine Tables

Location: `tools/simulation/sql_functions.py`

### `simulation_strategies` - Strategy Definitions

Strategy definitions for simulation.

```sql
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
```

**Columns:**

- `strategy_id` - Strategy ID (primary key)
- `name` - Strategy name
- `entry_config` - Entry signal configuration (JSON)
- `exit_config` - Exit signal configuration (JSON)
- `reentry_config` - Re-entry configuration (JSON)
- `cost_config` - Cost/fee configuration (JSON)
- `created_at`, `updated_at` - Timestamps

### `simulation_runs` - Simulation Runs

One record per strategy + token + time window combination.

```sql
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
```

**Columns:**

- `run_id` - Run ID (primary key)
- `strategy_id` - Strategy ID (foreign key)
- `mint` - Token mint address
- `alert_timestamp` - Alert/call timestamp
- `start_time` - Simulation start time
- `end_time` - Simulation end time
- `initial_capital` - Starting capital
- `final_capital` - Ending capital
- `total_return_pct` - Total return percentage
- `max_drawdown_pct` - Maximum drawdown percentage
- `sharpe_ratio` - Sharpe ratio
- `win_rate` - Win rate (0-1)
- `total_trades` - Total number of trades
- `caller_name` - Caller name
- `created_at` - Creation timestamp

**Indexes:**

- `idx_simulation_runs_strategy` - On `strategy_id`
- `idx_simulation_runs_mint` - On `mint`
- `idx_simulation_runs_alert_timestamp` - On `alert_timestamp`
- `idx_simulation_runs_caller` - On `caller_name`

### `strategy_config` - Strategy Configurations

Run-specific strategy configurations for reproducibility.

```sql
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
```

**Purpose:** Stores exact configuration used for each run, allowing reproducibility even if strategy config changes later.

**Indexes:**

- `idx_strategy_config_strategy_id` - On `strategy_id`

### `run_strategies_used` - Run Strategy Links

Links runs to their exact strategy configuration.

```sql
CREATE TABLE IF NOT EXISTS run_strategies_used (
  run_id TEXT NOT NULL,
  strategy_config_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id),
  FOREIGN KEY (run_id) REFERENCES simulation_runs(run_id),
  FOREIGN KEY (strategy_config_id) REFERENCES strategy_config(strategy_config_id)
);
```

**Indexes:**

- `idx_run_strategies_used_config` - On `strategy_config_id`

### `simulation_events` - Simulation Events

Trades, entries, exits, and other simulation events.

```sql
CREATE TABLE IF NOT EXISTS simulation_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
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
```

**Event Types:** `'entry'`, `'exit'`, `'stop_loss'`, `'reentry'`

**Columns:**

- `event_id` - Event ID (primary key)
- `run_id` - Run ID (foreign key)
- `event_type` - Event type
- `timestamp` - Event timestamp
- `price` - Price at event
- `quantity` - Quantity traded
- `value_usd` - Value in USD
- `fee_usd` - Fee in USD
- `pnl_usd` - PnL for this event
- `cumulative_pnl_usd` - Cumulative PnL
- `position_size` - Position size after event
- `metadata` - Additional metadata (JSON)

**Indexes:**

- `idx_simulation_events_run` - On `run_id`

### `ohlcv_candles_d` - OHLCV Candles

OHLCV candle data (if stored in DuckDB).

```sql
CREATE TABLE IF NOT EXISTS ohlcv_candles_d (
  mint TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  open DOUBLE NOT NULL,
  high DOUBLE NOT NULL,
  low DOUBLE NOT NULL,
  close DOUBLE NOT NULL,
  volume DOUBLE NOT NULL,
  interval_seconds INTEGER NOT NULL,
  source TEXT,
  PRIMARY KEY (mint, timestamp, interval_seconds)
);
```

**Note:** Primary OHLCV data is typically stored in ClickHouse. This table may be used for caching or local analysis.

**Indexes:**

- `idx_ohlcv_mint_timestamp` - On `(mint, timestamp)`

---

## Schema Evolution

### Idempotency Support

The ingestion schema was enhanced to support idempotency:

1. **Added `run_id` columns** - All ingestion tables now include `run_id`
2. **Added PRIMARY KEY constraints** - Prevents duplicate rows
3. **Added `ingestion_runs` table** - Tracks ingestion runs
4. **Migration support** - Existing databases can be migrated using `ensure_idempotent_schema()`

### Migration Scripts

- `tools/telegram/migrate_schema_idempotent.py` - Migrates existing databases to idempotent schema
- `tools/telegram/duckdb_punch_pipeline.py` - `ensure_idempotent_schema()` function

---

## Indexes and Performance

### Index Strategy

Indexes are created for:

1. **Primary keys** - Automatic indexing
2. **Foreign keys** - Typically indexed
3. **Query patterns** - Frequently queried columns
4. **Composite indexes** - Multi-column queries

### Query Optimization

- Use appropriate indexes for common query patterns
- Consider partitioning for large tables (future enhancement)
- Monitor query performance and adjust indexes as needed

---

## Database Files

### Default Locations

- **Telegram ingestion**: `data/telegram/{chat_id}.duckdb`
- **Storage package**: 
  - Callers: `data/databases/callers.duckdb`
  - Strategies: `data/databases/strategies.duckdb`
  - Token data: `data/databases/token_data.duckdb`
  - Errors: `data/databases/errors.duckdb`
  - Artifacts: `data/databases/artifacts.duckdb`
- **Simulation**: `data/databases/simulation.duckdb` or `{duckdb_path}` parameter

### Environment Variables

- `DUCKDB_PATH` - Default DuckDB database path
- `CALLER_DB_PATH` - Callers database path
- `STRATEGY_DB_PATH` - Strategies database path
- `TOKEN_DATA_DB_PATH` - Token data database path

---

## Related Documentation

- [Migration Guide: PostgreSQL to DuckDB](./MIGRATION_POSTGRES_TO_DUCKDB.md)
- [PostgreSQL Deprecation Notice](./POSTGRES_DEPRECATION.md)
- [DuckDB Idempotency Schema Design](../packages/ingestion/docs/DUCKDB_IDEMPOTENCY_SCHEMA.md)

---

## Schema Files

- Telegram ingestion: `tools/telegram/duckdb_schema_idempotent.sql`
- Storage package: `tools/storage/duckdb_*.py`
- Simulation: `tools/simulation/sql_functions.py`

---

_This documentation is maintained alongside the codebase. Update as schemas evolve._

