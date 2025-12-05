## Storage Architecture Overview

This document describes the upgraded storage architecture for QuantBot, including
Postgres (OLTP) and ClickHouse (OLAP) schemas that support advanced backtesting,
optimization, and ML workflows.

### Goals

- Store canonical entities (tokens, callers, alerts, strategies, simulation runs)
  in a relational database with strong consistency.
- Store high-volume time-series (candles, simulation events, aggregates) in
  ClickHouse for low-latency analytical queries.
- Make simulation and optimization results easy to query for dashboards and
  machine learning pipelines.

---

## Postgres Schema (OLTP)

Postgres focuses on **entities and relationships**:

- `tokens` – registry of traded tokens across chains.
- `callers` – signal/alert sources (Brook, LSY, custom creators).
- `alerts` – raw alerts emitted by callers or systems.
- `calls` – normalized trading signals derived from alerts.
- `strategies` – declarative strategy configurations (including ladders,
  re-entry rules, indicator logic).
- `simulation_runs` – metadata for each backtest / optimization run.
- `simulation_results_summary` – aggregated metrics per run.
- `optimization_jobs` / `optimization_trials` – configuration and results for
  hyperparameter searches.
- `ml_models` – registered ML models and their metadata.

The canonical DDL lives in:

- `scripts/migration/postgres/001_init.sql`

Key design notes:

- JSONB is used for flexible, versioned configs (`config_json`,
  `data_selection_json`, `trial_params_json`, `metrics_json`).
- Foreign keys ensure referential integrity between strategies, runs, trials,
  tokens, and callers.
- Indexes support common query patterns:
  - Look up runs by strategy and time.
  - Filter alerts/calls by token and timestamp.
  - Rank optimization trials by score per job.

---

## ClickHouse Schema (OLAP)

ClickHouse focuses on **time-series and high-volume events**:

### `ohlcv_candles`

Already used for fast OHLCV queries.

- Columns: `token_address`, `chain`, `timestamp`, `interval`, `open`, `high`,
  `low`, `close`, `volume`.
- Engine: `MergeTree` partitioned by `(chain, toYYYYMM(timestamp))`.

### `simulation_events`

Fine-grained simulation trace data, one row per event:

- `simulation_run_id` – FK to Postgres `simulation_runs.id` (stored as `UInt64`).
- `token_address`, `chain`.
- `event_time` – event timestamp.
- `seq` – event sequence number within the run.
- `event_type` – entry, exit, re-entry, ladder-leg, stop-move, etc.
- `price`, `size`, `remaining_position`, `pnl_so_far`.
- `indicators_json` – snapshot of indicator values at the event.
- `position_state_json` – serialized position state.
- `metadata_json` – additional context for debugging/analysis.

This table powers:

- Per-trade and per-event charts.
- Feature generation for ML (indicator snapshots, state, outcomes).

### `simulation_aggregates`

Pre-aggregated metrics per simulation run:

- `simulation_run_id`, `token_address`, `chain`.
- `final_pnl`, `max_drawdown`, `volatility`, `sharpe_ratio`, `sortino_ratio`.
- `win_rate`, `trade_count`, `reentry_count`.
- `ladder_entries_used`, `ladder_exits_used`.
- `created_at`.

Primarily used for:

- Dashboards and optimization visualizations.
- Fast filtering and ranking of runs.

---

## Responsibilities and Data Flow

1. **Ingestion / Market Data**
   - Candles are stored in ClickHouse (`ohlcv_candles`).
   - Token metadata and canonical token IDs are stored in Postgres (`tokens`).

2. **Alerts & Calls**
   - Raw alerts from callers (Brook, LSY, etc.) are stored in Postgres
     (`alerts`, `calls`).
   - These link tokens and callers via foreign keys.

3. **Strategies**
   - Declarative strategy configs (including ladders, re-entry, indicator
     conditions, and composite signals) are stored as JSONB in `strategies`.

4. **Simulations**
   - A new run is recorded in `simulation_runs` with full config and data
     selection.
   - During execution, detailed events are written to ClickHouse
     (`simulation_events`).
   - At completion, summary metrics are written to both:
     - Postgres (`simulation_results_summary`) for transactional queries.
     - ClickHouse (`simulation_aggregates`) for analytical workloads.

5. **Optimization**
   - Optimization jobs and their trials are stored in Postgres
     (`optimization_jobs`, `optimization_trials`).
   - Each trial links to a `simulation_run_id`, tying metrics and config back
     to the underlying simulation and its ClickHouse traces.

6. **ML Pipelines**
   - Feature generation reads from ClickHouse (`simulation_events`,
     `simulation_aggregates`) and Postgres (tokens, callers, strategies,
     simulation_runs).
   - Trained models are registered in `ml_models` with metadata and storage
     URIs.

---

## Implementation Pointers

- **Postgres client:** `src/storage/postgres-client.ts`
  - Provides pooled connections, a `queryPostgres` helper, and a
    `withPostgresTransaction` helper.

- **ClickHouse client:** `src/storage/clickhouse-client.ts`
  - `initClickHouse` now ensures `ohlcv_candles`, `simulation_events`, and
    `simulation_aggregates` tables exist.

- **Migrations:**
  - Postgres: `scripts/migration/postgres/001_init.sql`
  - ClickHouse: initialized at runtime via `initClickHouse`.

These schemas are intentionally designed to align with:

- Simulation configuration in `src/simulation/config.ts`.
- Simulation engine in `src/simulation/engine.ts`.
- Existing ClickHouse data loader in `src/data/loaders/clickhouse-loader.ts`.


