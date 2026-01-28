# PRD: Contract-Based Backtesting Platform

## Introduction

This document defines the requirements for a Python-only backtesting platform focused exclusively on backtesting trading strategies against historical OHLCV data. The platform leverages existing data infrastructure (ClickHouse for OHLCV data and DuckDB for alerts) and provides a contract-based, layer-based architecture designed for research reproducibility.

### Context

The original QuantBot project evolved into a complex system with multiple concerns including data ingestion, real-time monitoring, and various analytics features. This PRD defines a simplified, focused platform that:

- **Eliminates** data ingestion complexity (assumes data already exists)
- **Focuses** exclusively on backtesting functionality
- **Provides** a contract-based architecture with clear input/output specifications
- **Ensures** byte-identical, auditable, and reproducible backtesting results
- **Uses** Python exclusively for a single runtime and unified contracts

### Problem Statement

Traders and researchers need a reliable, auditable backtesting platform that:

- Works with existing historical data (no data fetching)
- Produces deterministic, byte-identical results on re-runs
- Enables easy comparison of different backtest runs
- Provides full provenance and reproducibility
- Allows reproduction of historical results with zero guesswork

### Research Lab Philosophy

This platform is designed as a **research lab, not a bot**. Research labs require:

- **Provenance**: Complete traceability of inputs, outputs, and execution parameters
- **Determinism**: Byte-identical results from identical inputs (within fixed tolerance)
- **Repeatability**: Ability to reproduce any historical result exactly
- **Easy Comparison**: Simple diffing and comparison of runs based purely on specification changes

The platform lives or dies by its **contracts, not code**. Contracts define:

- Input formats (Parquet files with schemas and fingerprints)
- Output formats (Parquet files, JSON summaries, artifacts)
- RunSpec (everything needed to reproduce a run)

---

## Goals

### Primary Objectives

1. **Backtesting-Only Focus**: Build a platform that exclusively handles backtesting workflows, removing all data ingestion and real-time monitoring concerns

2. **Byte-Identical Results**: Ensure that running the same RunSpec twice produces byte-identical outputs (or within fixed tolerance), enabling auditable and dependable results

3. **Contract-Based Architecture**: Design clear contracts for inputs, outputs, and RunSpecs that enable reproducibility and easy comparison

4. **Layer-Based Design**: Organize platform into clear layers: Adapters → Materializer → Feature/Path Builder → Simulator → Metrics/Reports → CLI/TUI

5. **Python-Only Runtime**: Use Python exclusively for a single runtime, single set of contracts, and unified development experience

6. **Materialization**: Enable materialization of inputs to immutable Parquet files, allowing simulation reruns without database access

### Business Value

- **Reduced Complexity**: Single runtime (Python) reduces maintenance burden and development time
- **Auditability**: Byte-identical results enable regulatory compliance and result verification
- **Reproducibility**: Contract-based design ensures any historical result can be reproduced with zero guesswork
- **Reliability**: Deterministic execution ensures consistent results across runs
- **Research Focus**: Platform designed for research workflows, not production trading

### User Value

- **Fast Iteration**: Quick backtesting cycles with materialized inputs (no repeated database queries)
- **Easy Comparison**: Simple diffing of runs based purely on specification changes
- **Reproducibility**: Confidence that results can be reproduced and audited months later
- **Provenance**: Complete traceability of all inputs, outputs, and execution parameters

---

## User Stories

### US-1: Run a Basic Backtest

**As a** trader/researcher  
**I want to** run a backtest using a RunSpec against historical alerts  
**So that** I can evaluate strategy performance on past data

**Acceptance Criteria:**

- User can specify a RunSpec (date range, filters, policy configuration)
- User can select alerts from DuckDB using filters (caller, token, date range)
- System materializes inputs to immutable Parquet files (alerts.parquet, ohlcv.parquet) with fingerprints
- System executes the backtest and produces deterministic results
- Results are stored as Parquet files (trades.parquet, metrics.parquet) and summary.json
- Same RunSpec produces byte-identical outputs on re-run (within tolerance)
- RunSpec includes all parameters needed for reproduction

### US-2: Query Backtest Results

**As a** trader/researcher  
**I want to** query and analyze backtest results  
**So that** I can compare strategies and make informed decisions

**Acceptance Criteria:**

- Results are queryable via Parquet files or CLI commands
- Results include key metrics (total return, Sharpe ratio, max drawdown, win rate) in summary.json
- Results can be filtered by RunSpec ID, date range, caller, token
- Results can be exported to CSV/JSON for external analysis
- Results include metadata (RunSpec, execution time, data coverage, fingerprints)
- Results stored in Parquet format for efficient querying

### US-3: Reproduce Previous Backtest

**As a** researcher/auditor  
**I want to** reproduce a previous backtest run  
**So that** I can verify results and ensure auditability

**Acceptance Criteria:**

- Each backtest run has a unique RunSpec identifier
- RunSpec includes all parameters needed for reproduction (filters, policy config, data fingerprints)
- Re-running with same RunSpec produces byte-identical results (within tolerance)
- System validates input data fingerprints match RunSpec expectations
- Reproduction can be triggered via CLI using RunSpec ID
- Materialized inputs can be reused without database access

### US-4: Compare Backtest Runs

**As a** researcher  
**I want to** compare two backtest runs  
**So that** I can understand differences in strategy performance

**Acceptance Criteria:**

- System can diff two RunSpecs and identify all differences
- System can explain result differences purely from RunSpec changes
- Comparison output shows which specification changes caused which metric changes
- Comparison works even for runs from 30+ days ago
- Comparison can be performed via CLI or programmatic API

---

## Functional Requirements

### Adapters Layer (Read-Only)

#### FR-1: ClickHouseReader

- **Description**: Read-only adapter for OHLCV data from ClickHouse
- **Methods**:
  - `get_candles(token: str, from_time: datetime, to_time: datetime, interval: str) -> pd.DataFrame`
  - `get_candle_range(tokens: List[str], from_time: datetime, to_time: datetime, interval: str) -> Dict[str, pd.DataFrame]`
  - `check_data_coverage(tokens: List[str], from_time: datetime, to_time: datetime) -> CoverageReport`
- **Constraints**:
  - SELECT queries only (no INSERT, UPDATE, DELETE)
  - Connection pooling for efficiency
  - Query optimization and retries
  - Error handling with clear messages

#### FR-2: DuckDBReader

- **Description**: Optional read-only adapter for alerts from DuckDB (local cache/query)
- **Methods**:
  - `get_alerts(filters: AlertFilters) -> pd.DataFrame`
  - `query_alerts(query: str) -> pd.DataFrame` (for custom queries)
- **Constraints**:
  - Read-only access (SELECT only)
  - Optional component (can be skipped if alerts come from Parquet)
  - Local file-based queries for performance

### Materializer Layer

#### FR-3: Data Materialization

- **Description**: Pull data slices from adapters and write immutable Parquet inputs
- **Inputs**:
  - RunSpec (date range, filters, token list)
  - Data source adapters (ClickHouseReader, DuckDBReader)
- **Outputs**:
  - `alerts.parquet` (with schema + fingerprint)
  - `ohlcv.parquet` (with schema + fingerprint)
  - `artifacts.json` (metadata, fingerprints, schemas)
- **Process**:
  1. Load alerts from DuckDBReader (filtered by RunSpec)
  2. Extract token addresses from alerts
  3. Load OHLCV data from ClickHouseReader for tokens/time range
  4. Write alerts to `alerts.parquet` with schema validation
  5. Write OHLCV to `ohlcv.parquet` with schema validation
  6. Calculate fingerprints (SHA256) for both files
  7. Write `artifacts.json` with schemas, fingerprints, and metadata
- **Validation**:
  - Verify date range is valid
  - Verify data exists for all required tokens
  - Verify data coverage (no gaps beyond acceptable threshold)
  - Log data quality metrics (coverage %, gaps, outliers)
  - Ensure Parquet files are immutable (read-only after creation)

#### FR-4: Schema and Fingerprint Management

- **Description**: Manage Parquet schemas and data fingerprints for reproducibility
- **Schema Requirements**:
  - Explicit schema definition for alerts.parquet
  - Explicit schema definition for ohlcv.parquet
  - Schema versioning for backward compatibility
- **Fingerprint Requirements**:
  - SHA256 hash of Parquet file contents
  - Fingerprint stored in artifacts.json
  - Fingerprint validation on materialization and simulation
- **Validation**:
  - Verify schemas match expected format
  - Verify fingerprints match on re-materialization
  - Detect schema changes between runs

### Feature/Path Builder Layer

#### FR-5: Feature Engineering via FeaturePlugin System

- **Description**: Build indicators, path metrics, and transitions from materialized data using modular FeaturePlugin system
- **Plugin Type**: FeaturePlugin
- **Inputs**:
  - Materialized alerts.parquet
  - Materialized ohlcv.parquet
  - Feature pipeline configuration from RunSpec (ordered list of FeaturePlugin + params)
- **Outputs**:
  - `derived/features.parquet` (enhanced candles with computed feature columns)
  - `derived/paths.parquet` (path metrics: drawdown paths, volatility paths, etc.)
- **FeaturePlugin Interface**:
  - **Input**: Candles table (+ optional prior computed features)
  - **Output**: Candles table with new feature columns (no mutation of existing columns)
  - **Rules**:
    - Pure functions (no I/O, no globals)
    - No future rows access (enforced via Time Fence API)
    - Immutable: cannot modify existing columns
  - **Examples**: SMA/EMA, VWAP, rolling volume, drawdown-from-peak, volatility, session stats, RSI, MACD
- **Time Fence API**:
  - Plugins receive a context object that only exposes:
    - Current row (candle at time t)
    - Rolling windows ending at current index
    - Precomputed feature columns up to current index
  - Physically prevents lookahead/lookback violations
- **Validation**:
  - Ensure causal constraints (no future data access via Time Fence API)
  - Verify indicator calculations are correct
  - Verify no column mutations
  - Log feature computation time

### Signal Generation Layer

#### FR-6: Signal Generation via SignalPlugin System

- **Description**: Generate discrete trading signals from features using modular SignalPlugin system
- **Plugin Type**: SignalPlugin
- **Inputs**:
  - Feature-enhanced candles from Feature Builder
  - Current timestamp (via Time Fence API)
  - Signal pipeline configuration from RunSpec (ordered list of SignalPlugin + params)
- **Outputs**:
  - `derived/signals.parquet` (discrete signal events: ENTER, EXIT, SET_STOP, TRAIL_UPDATE, REENTER_ARM, etc.)
- **SignalPlugin Interface**:
  - **Input**: Candles+features at current timestamp, plus current timestamp context
  - **Output**: Discrete signals/events (ENTER, EXIT, SET_STOP, TRAIL_UPDATE, REENTER_ARM, etc.)
  - **Rules**:
    - Must be derivable from information available at that time
    - Pure functions (no I/O, no globals)
    - No future data access (enforced via Time Fence API)
  - **Examples**: "price crosses above VWAP", "RSI oversold → arm re-entry", "breakout above prior high"
- **Separation Principle**: Signal generation is separate from execution policy. Signals are "intents", not executed trades.

### Simulator Layer

#### FR-7: Deterministic Candle Replay Loop

- **Description**: Walk through candles chronologically and apply strategy pipeline deterministically
- **Process** (game engine style):

  ```
  For each candle t:
    1. Gather candle row (O/H/L/C/V)
    2. Compute/fetch features at t (precomputed from Feature Builder)
    3. Run signal plugins at t → signals
    4. Run execution policy with (state, candle, signals) → trade events
    5. Update position state
    6. Record events to events.parquet
  ```

- **Properties**:
  - Deterministic (seed-controlled randomness only)
  - Single-threaded by default
  - Explicit ordering (priority list for plugins)
  - No future data access (guard rails enforced)
- **State Management**:
  - Position state machine (no position, long, short, etc.)
  - Active stops and trailing stops
  - Re-entry arms
  - Capital allocation

#### FR-8: Execution Policy via ExecutionPolicyPlugin System

- **Description**: Execute position management logic based on signals and current state
- **Plugin Type**: ExecutionPolicyPlugin
- **Inputs**:
  - Current position state
  - Current candle (OHLC)
  - Active signals from Signal Layer
  - Execution policy configuration from RunSpec (ordered list with explicit priority)
- **Outputs**:
  - Trade events (fills, stop changes, partial exits, re-entry executions)
- **ExecutionPolicyPlugin Interface**:
  - **Input**: Current position state + candle + active signals
  - **Output**: Trade events (fills, stop changes, partial exits)
  - **Rules**:
    - Deterministic
    - Well-defined ordering if multiple signals occur (priority list)
    - Pure functions (no I/O, no globals)
  - **Examples**: Trailing stop policy, ladder exits, break-even rule, re-entry rule, position sizing
- **Key Architectural Choice**: Execution policy is separate from signal generation. This makes "indicator plugins" and "trailing stop plugins" composable without chaos.

#### FR-9: Fill Model via FillModelPlugin System

- **Description**: Determine fill prices and quantities for trade intents (optional in v1)
- **Plugin Type**: FillModelPlugin
- **Inputs**:
  - Order intent (from execution policy)
  - Current candle (OHLC)
- **Outputs**:
  - Fill events with execution price and quantity
- **FillModelPlugin Interface**:
  - **Input**: Order intent + candle (OHLC)
  - **Output**: Fill price/qty (deterministic)
  - **Rules**:
    - No randomness unless seeded
    - Deterministic
  - **Default Model** (v1):
    - Market orders execute at candle close price
    - No slippage
    - No partial fills
  - **Future Examples**: "next open fill", "worst-case within candle", "slippage model"

### Metrics and Reports Layer

#### FR-10: Event Ledger (Truth Source)

- **Description**: Maintain events.parquet as the immutable truth ledger for all simulation activity
- **Outputs**:
  - `results/events.parquet` (event-level truth log)
    - All events: fills, stop changes, position updates, signal fires
    - Timestamps, prices, quantities, event types
    - Complete audit trail
- **Principle**: Everything else can be recomputed from events.parquet. This is the source of truth.

#### FR-11: Trade Derivation

- **Description**: Derive trades.parquet from events.parquet
- **Inputs**:
  - `results/events.parquet` (source of truth)
- **Outputs**:
  - `results/trades.parquet` (derived from events)
    - Entry/exit pairs
    - Position tracking (size, entry price, exit price, timestamps)
    - Trade-by-trade P&L
- **Validation**: Verify trades can be recomputed from events

#### FR-12: Metrics Calculation via MetricPlugin System

- **Description**: Calculate performance metrics from events/trades using modular MetricPlugin system
- **Plugin Type**: MetricPlugin (optional)
- **Inputs**:
  - `results/events.parquet` (source of truth)
  - `results/trades.parquet` (derived)
  - Price history
- **Outputs**:
  - `results/metrics.parquet` (structured metrics table)
  - Metrics included in `summary.json`
- **Standard Metrics**:
  - Total return (absolute and percentage)
  - Number of trades (wins, losses)
  - Win rate
  - Average win/loss
  - Maximum drawdown
  - Sharpe ratio
  - Sortino ratio
  - Profit factor
  - Time-weighted returns
  - Return distributions
  - Path capture stats (2x → 3x transitions, etc.)
  - Conditional transitions
- **MetricPlugin Interface**:
  - **Input**: Trades/events + prices
  - **Output**: Metrics tables
  - **Examples**: "EV given 2x", "capture ratio", custom risk metrics
- **Validation**: Verify all calculations are mathematically correct

#### FR-13: Report Generation

- **Description**: Generate summary reports and artifacts manifest
- **Outputs**:
  - `summary.json` (key metrics, RunSpec reference, execution metadata, human-readable)
  - `artifacts.json` (manifest: index + audit trail for run)
    - Required fields per artifact:
      - name, path, type (input/derived/result)
      - schema_version, row_count
      - min_ts, max_ts
      - fingerprint, spec_hash, engine_version
- **Format**:
  - JSON for human-readable summary
  - Parquet for efficient querying and analysis
  - Consistent schema across all outputs
- **Validation**:
  - Ensure all outputs have fingerprints
  - Verify summary.json is valid JSON
  - Verify Parquet files have correct schemas
  - Verify artifacts.json is complete

### RunSpec Management

#### FR-14: RunSpec Definition as Pipeline Graph

- **Description**: Define RunSpec as a complete pipeline graph (everything needed to reproduce a run)
- **RunSpec Structure** (Pipeline Graph):

  ```json
  {
    "run_meta": {
      "run_id": "uuid",
      "created_at": "timestamp",
      "engine_version": "semver",
      "seed": 12345
    },
    "universe": {
      "chains": ["solana"],
      "mints": ["token1", "token2"],
      "callers": ["caller1"]
    },
    "time_range": {
      "start_ts": "timestamp",
      "end_ts": "timestamp"
    },
    "data": {
      "candle_interval": "5m",
      "lookback_windows": {}
    },
    "feature_pipeline": [
      {"plugin": "SMA", "params": {"window": 20}},
      {"plugin": "RSI", "params": {"window": 14}},
      {"plugin": "VWAP", "params": {}}
    ],
    "signal_pipeline": [
      {"plugin": "CrossAboveVWAP", "params": {}},
      {"plugin": "RSIOversold", "params": {"threshold": 30}}
    ],
    "execution_policy": [
      {"plugin": "TrailingStop", "params": {"trail_pct": 0.05}, "priority": 1},
      {"plugin": "LadderExits", "params": {"levels": [0.5, 1.0, 2.0]}, "priority": 2},
      {"plugin": "ReEntryRule", "params": {}, "priority": 3}
    ],
    "fill_model": {
      "plugin": "ClosePriceFill",
      "params": {}
    },
    "constraints": {
      "max_concurrent_trades": 5,
      "max_drawdown": 0.20,
      "capital_model": "fixed"
    },
    "artifact_plan": {
      "write_features": true,
      "write_signals": true,
      "write_events": true,
      "write_trades": true,
      "write_metrics": true
    }
  }
  ```

- **RunSpec Responsibilities**: Must fully determine:
  - Data selection (universe, time range)
  - Strategy behavior (feature pipeline, signal pipeline, execution policy)
  - Simulation rules (fill model, constraints)
  - Randomness (seed)
- **Storage**:
  - RunSpec stored as JSON/YAML file (`run_spec.json`)
  - RunSpec ID (unique identifier, e.g., UUID or content hash)
  - Spec hash stored in `spec_hash.txt` for validation
  - RunSpec versioning for changes
- **Validation**:
  - Validate with Pydantic before any work happens
  - Verify RunSpec is complete and valid
  - Verify all plugin references exist and are loadable
  - Verify RunSpec can be used to reproduce a run
  - Detect RunSpec changes between runs

#### FR-15: RunSpec Reproduction

- **Description**: Reproduce a backtest run from a stored RunSpec
- **Process**:
  1. Load RunSpec by ID
  2. Validate input fingerprints match materialized data
  3. Execute materialization (if needed) or use existing materialized inputs
  4. Execute simulation with RunSpec parameters
  5. Verify output fingerprints match expected (if available)
- **Validation**:
  - Verify byte-identical results (within tolerance)
  - Detect and report any differences
  - Log reproduction success/failure

### Plugin System Architecture

#### FR-16: Plugin Type System

- **Description**: Define explicit plugin types with strict interfaces
- **Plugin Categories**:
  1. **FeaturePlugin**: Add feature columns to candles
  2. **SignalPlugin**: Generate trading signals from features
  3. **ExecutionPolicyPlugin**: Execute position management based on signals
  4. **FillModelPlugin**: Determine fill prices/quantities (optional)
  5. **MetricPlugin**: Compute custom metrics (optional)
- **Plugin Rules**:
  - Plugins belong to a category with a strict interface
  - Plugins are pure (no I/O, no globals)
  - Plugins are versioned explicitly
  - Plugins live inside Python, close to the simulator
  - Plugins cannot skip layers (no reaching "up" the stack)
- **Plugin Discovery**:
  - Plugins discovered at runtime from configured paths
  - Plugin validation ensures interface compliance
  - Plugin dependencies validated before execution

#### FR-17: Time Fence API

- **Description**: Guardrail API that physically prevents plugins from accessing future data
- **Interface**:
  - Plugins receive a context object that only exposes:
    - Current row (candle at time t)
    - Rolling windows ending at current index
    - Precomputed feature columns up to current index
  - No access to:
    - Future rows
    - Future features
    - Raw dataframes (prevents cheating)
- **Purpose**: Correctness by construction - makes lookahead violations physically impossible
- **Implementation**: Context object wraps data access with time bounds checking

### Run Folder Contract

#### FR-18: Run Folder Structure (Hard Requirement)

- **Description**: Every run must produce a self-contained folder structure
- **Structure**:

  ```
  runs/
    <run_id>/
      run_spec.json          # Complete RunSpec
      spec_hash.txt          # Hash of RunSpec for validation
      artifacts.json         # Manifest: index + audit trail
      summary.json           # Human-readable summary
      
      inputs/
        alerts.parquet       # Materialized alerts
        ohlcv.parquet       # Materialized OHLCV
      
      derived/
        features.parquet     # Feature-enhanced candles
        paths.parquet        # Path metrics
        signals.parquet      # Signal events
      
      results/
        events.parquet        # Event ledger (truth source)
        trades.parquet        # Derived from events
        metrics.parquet       # Aggregated metrics
      
      logs/
        run.log              # Execution log
  ```

- **Principle**: If it's not in the run folder, it doesn't exist. Each run folder is a self-contained truth capsule.
- **Validation**: Verify folder structure matches contract before run completion

### Contract Validation

#### FR-19: Input Contract Validation

- **Description**: Validate inputs against contracts (schemas + fingerprints)
- **Validation Points**:
  - On materialization: verify schemas match expected format
  - On simulation start: verify input fingerprints match RunSpec
  - On re-materialization: verify fingerprints match previous materialization
- **Contracts**:
  - `alerts.parquet`: Schema definition + fingerprint
  - `ohlcv.parquet`: Schema definition + fingerprint
- **Failure Handling**:
  - Fail fast with clear error messages
  - Report schema mismatches
  - Report fingerprint mismatches

#### FR-20: Output Contract Validation

- **Description**: Validate outputs against contracts (schemas + fingerprints)
- **Output Contracts**:
  - `trades.parquet`: Schema definition + fingerprint
  - `metrics.parquet`: Schema definition + fingerprint
  - `summary.json`: JSON schema + fingerprint
  - `artifacts.json`: JSON schema + fingerprint
- **Validation**:
  - Verify all outputs have correct schemas
  - Calculate and store fingerprints for all outputs
  - Verify outputs are complete and valid

### Run Folder Contract

#### FR-20: Run Folder Structure (Hard Requirement)

- **Description**: Every run must produce a self-contained folder structure
- **Structure**:

  ```
  runs/
    <run_id>/
      run_spec.json          # Complete RunSpec
      spec_hash.txt          # Hash of RunSpec for validation
      artifacts.json         # Manifest: index + audit trail
      summary.json           # Human-readable summary
      
      inputs/
        alerts.parquet       # Materialized alerts
        ohlcv.parquet       # Materialized OHLCV
      
      derived/
        features.parquet     # Feature-enhanced candles
        paths.parquet        # Path metrics
        signals.parquet      # Signal events
      
      results/
        events.parquet        # Event ledger (truth source)
        trades.parquet        # Derived from events
        metrics.parquet       # Aggregated metrics
      
      logs/
        run.log              # Execution log
  ```

- **Principle**: If it's not in the run folder, it doesn't exist. Each run folder is a self-contained truth capsule.
- **Validation**: Verify folder structure matches contract before run completion

### CLI Interface (Typer)

#### FR-21: Backtest Command

- **Description**: Typer CLI command to run backtests
- **Usage**: `backtest run --from <date> --to <date> [options]`
- **Options**:
  - `--from/--to`: Date range (required)
  - `--caller`: Filter alerts by caller name
  - `--token`: Filter alerts by token mint
  - `--interval`: OHLCV candle interval (default: 5m)
  - `--policy-config`: Path to policy config JSON/YAML file
  - `--feature-config`: Path to feature config JSON/YAML file
  - `--output-dir`: Directory for result exports (default: ./runs/)
  - `--materialize-only`: Only materialize inputs, don't run simulation
  - `--use-materialized`: Use existing materialized inputs (skip materialization)
- **Output**:
  - RunSpec ID
  - Summary metrics (from summary.json)
  - Path to detailed results (Parquet files, JSON)
  - Fingerprints for all outputs

#### FR-22: Results Command

- **Description**: Typer CLI command to query and analyze results
- **Usage**: `backtest results <runspec-id> [options]`
- **Options**:
  - `--format`: Output format (table, json, csv)
  - `--metrics`: Comma-separated list of metrics to display
  - `--export`: Export path
- **Subcommands**:
  - `list`: List all backtest runs (show RunSpec IDs and summaries)
  - `compare <runspec-id-1> <runspec-id-2>`: Compare two runs (diff RunSpecs and results)
  - `export <runspec-id>`: Export results to file
  - `show <runspec-id>`: Show detailed results for a run
  - `reproduce <runspec-id>`: Reproduce a run from its RunSpec

#### FR-23: Materialize Command

- **Description**: Typer CLI command to materialize inputs without running simulation
- **Usage**: `backtest materialize --from <date> --to <date> [options]`
- **Options**:
  - `--from/--to`: Date range (required)
  - `--caller`: Filter alerts by caller name
  - `--token`: Filter alerts by token mint
  - `--interval`: OHLCV candle interval (default: 5m)
  - `--output-dir`: Directory for materialized inputs
- **Output**:
  - Materialized alerts.parquet and ohlcv.parquet
  - artifacts.json with fingerprints
  - Materialization ID for reference

### API Interface (Optional - FastAPI)

#### FR-24: REST API

- **Description**: Optional FastAPI RESTful API for backtesting operations
- **Framework**: FastAPI (Python)
- **Endpoints**:
  - `POST /api/backtest/run`: Create and execute backtest (returns RunSpec ID)
  - `GET /api/backtest/runs`: List all runs
  - `GET /api/backtest/runs/{runspec_id}`: Get run details
  - `GET /api/backtest/runs/{runspec_id}/results`: Get run results
  - `GET /api/backtest/runs/{runspec_id}/reproduce`: Reproduce a run
  - `POST /api/backtest/materialize`: Materialize inputs
  - `GET /api/backtest/runs/{runspec_id_1}/compare/{runspec_id_2}`: Compare two runs
- **Authentication**: Optional (can be added later)
- **Rate Limiting**: Optional (can be added later)
- **Status**: Future consideration (not required for initial version)

---

## Contracts and Gate Criteria

### Contract-Based Design

The platform is built on **contracts, not code**. Contracts define the interfaces between layers and ensure reproducibility. A backtesting system lives or dies by its contracts.

### Input Contracts

#### alerts.parquet

- **Format**: Apache Parquet file
- **Schema**: Explicit schema definition (stored in artifacts.json)
- **Fingerprint**: SHA256 hash of file contents
- **Contents**: Alert records with standardized fields (caller, token, timestamp, side, etc.)
- **Immutability**: File is read-only after materialization
- **Validation**: Schema validation on read, fingerprint validation on use

#### ohlcv.parquet

- **Format**: Apache Parquet file
- **Schema**: Explicit schema definition (stored in artifacts.json)
- **Fingerprint**: SHA256 hash of file contents
- **Contents**: OHLCV candle data organized by token and timestamp
- **Immutability**: File is read-only after materialization
- **Validation**: Schema validation on read, fingerprint validation on use

### RunSpec Contract

**RunSpec** contains everything needed to reproduce a backtest run:

- **Input Filters**: Date range, caller filters, token filters
- **Policy Configuration**: Trading policy parameters and logic
- **Feature Configuration**: Indicators and features to compute
- **Materialization Parameters**: Candle interval, lookback/lookforward windows
- **Expected Fingerprints**: Fingerprints of materialized inputs (for validation)
- **RunSpec ID**: Unique identifier (UUID or content hash)
- **Version**: RunSpec schema version

**Format**: JSON or YAML file
**Storage**: Stored with each run, can be retrieved by RunSpec ID
**Immutability**: RunSpec is immutable once created (new changes create new RunSpec)

### Output Contracts

#### trades.parquet

- **Format**: Apache Parquet file
- **Schema**: Explicit schema definition
- **Fingerprint**: SHA256 hash of file contents
- **Contents**: All trade events (entry, exit, fills) with timestamps
- **Validation**: Schema validation on write, fingerprint stored in artifacts.json

#### metrics.parquet

- **Format**: Apache Parquet file
- **Schema**: Explicit schema definition
- **Fingerprint**: SHA256 hash of file contents
- **Contents**: Aggregated performance metrics
- **Validation**: Schema validation on write, fingerprint stored in artifacts.json

#### summary.json

- **Format**: JSON file
- **Schema**: JSON schema definition
- **Fingerprint**: SHA256 hash of file contents
- **Contents**: Key metrics, RunSpec reference, execution metadata
- **Validation**: JSON schema validation, fingerprint stored in artifacts.json

#### artifacts.json

- **Format**: JSON file
- **Schema**: JSON schema definition
- **Fingerprint**: SHA256 hash of file contents
- **Contents**:
  - Input schemas and fingerprints
  - Output schemas and fingerprints
  - RunSpec reference
  - Materialization metadata
  - Execution metadata
- **Validation**: JSON schema validation, serves as manifest for all artifacts

### Gate Criteria

The platform must pass these gate criteria to be considered successful:

#### Gate 1: Byte-Identical Reproducibility

- **Criterion**: Can you run the same RunSpec twice and get byte-identical `summary.json` (or within a fixed tolerance)?
- **Test**: Run a backtest, save RunSpec, rerun with same RunSpec, compare summary.json fingerprints
- **Pass Condition**: Fingerprints match exactly (or within configured tolerance for floating-point differences)
- **Rationale**: Ensures deterministic execution and reproducibility

#### Gate 2: Materialized Input Reuse

- **Criterion**: Can you materialize inputs once and rerun simulation without touching ClickHouse?
- **Test**: Materialize inputs, run simulation, delete materialized inputs, rerun simulation (should fail or re-materialize)
- **Pass Condition**: Simulation can complete using only materialized Parquet files, no database access needed
- **Rationale**: Enables fast iteration and offline analysis

#### Gate 3: Spec-Based Diffing

- **Criterion**: Can you diff two runs and explain differences purely from spec changes?
- **Test**: Run two backtests with different RunSpecs, compare results, identify which spec changes caused which result differences
- **Pass Condition**: All result differences can be traced to RunSpec differences
- **Rationale**: Enables easy comparison and understanding of strategy variations

#### Gate 4: Historical Reproduction

- **Criterion**: Can you reproduce a historical result from 30 days ago with zero guesswork?
- **Test**: Retrieve a RunSpec from 30 days ago, reproduce the run, verify results match
- **Pass Condition**: Results match exactly (within tolerance) without any manual intervention or guessing
- **Rationale**: Ensures long-term reproducibility and auditability

### Contract Validation Points

1. **On Materialization**: Validate input schemas match expected format, calculate fingerprints
2. **On Simulation Start**: Validate input fingerprints match RunSpec expectations
3. **On Simulation End**: Validate output schemas, calculate output fingerprints
4. **On Reproduction**: Validate all fingerprints match original run
5. **On Comparison**: Validate RunSpec differences explain result differences

### Tolerance for Floating-Point Differences

For "byte-identical" comparisons involving floating-point calculations:

- **Default Tolerance**: 1e-9 (for normalized metrics)
- **Configurable**: Tolerance can be configured per metric type
- **Documentation**: Tolerance values stored in artifacts.json
- **Rationale**: Floating-point arithmetic may have minor differences due to order of operations, but should be negligible

---

## Non-Goals

### Explicitly Excluded

1. **Data Ingestion**: No fetching of OHLCV data from external APIs (Birdeye, etc.). Platform assumes data already exists in ClickHouse.

2. **Real-time Trading**: No live trading functionality. Platform is backtesting-only.

3. **Alert Ingestion**: No parsing of Telegram exports or other alert sources. Platform assumes alerts already exist in DuckDB.

4. **Real-time Monitoring**: No live monitoring, alerting, or dashboard features. Focus is on historical analysis.

5. **Data Quality Management**: No data cleaning, deduplication, or quality scoring. Platform assumes data is already clean.

6. **Multi-chain Support**: Initial version focuses on Solana only. Multi-chain support can be added later if needed.

7. **Web UI**: No web dashboard in initial version. CLI and optional TUI (Textual) are sufficient. Web UI can be added later.

8. **User Management**: No authentication, authorization, or multi-user features in initial version.

9. **Cloud Deployment**: No cloud-specific features or deployment automation. Platform runs locally or on user-managed infrastructure.

10. **Machine Learning Training**: No ML model training capabilities. ML can be integrated via custom policies if needed.

### Future Considerations

- Web-based UI dashboard (FastAPI + frontend)
- Multi-chain support
- Cloud deployment options
- User management and collaboration features
- Advanced visualization capabilities
- ML strategy optimization tools
- Textual TUI for interactive backtesting

---

## Design Considerations

### Architecture Principles

1. **Contract-Based Design**: The platform is built on contracts (schemas, fingerprints, RunSpecs), not code. Contracts ensure reproducibility and enable easy comparison.

2. **Determinism**: All operations must be deterministic. Same RunSpec always produces byte-identical outputs (within tolerance).

3. **Layer Separation**: Clear separation between layers (strict order, no layer may reach "up" the stack):
   - **CLI/Control**: Specification & Validation
   - **Adapters**: Read-only data access (ClickHouseReader, DuckDBReader)
   - **Materializer**: Immutable Parquet file creation with fingerprints
   - **Feature Builder**: FeaturePlugin execution (indicators, path metrics)
   - **Signal Generator**: SignalPlugin execution (trading signal generation)
   - **Simulator**: ExecutionPolicyPlugin + FillModelPlugin execution (deterministic candle replay)
   - **Metrics/Reports**: MetricPlugin execution and report generation
   - **Artifact Management**: Manifest and artifact organization

4. **Provenance**: Every run has complete provenance: RunSpec, input fingerprints, output fingerprints, execution metadata.

5. **Repeatability**: Any historical run can be reproduced exactly using its RunSpec and materialized inputs.

6. **Easy Comparison**: Run differences can be explained purely from RunSpec differences.

7. **Data Immutability**: Materialized inputs and outputs are immutable Parquet files. New runs create new files.

8. **Research Lab Focus**: Platform designed for research workflows (provenance, determinism, repeatability, comparison), not production trading.

### Layer Architecture

```text
platform/
├── cli/              # CLI/Control Layer
│   ├── commands.py   # Typer commands
│   └── tui.py        # Optional Textual TUI
├── adapters/         # Read-only data adapters
│   ├── clickhouse_reader.py
│   └── duckdb_reader.py
├── materializer/      # Data materialization
│   ├── materializer.py
│   └── schemas.py
├── features/         # Feature/Path builder (FeaturePlugins)
│   ├── plugins/      # FeaturePlugin implementations
│   └── executor.py   # Feature pipeline executor
├── signals/          # Signal generation (SignalPlugins)
│   ├── plugins/      # SignalPlugin implementations
│   └── executor.py   # Signal pipeline executor
├── simulator/        # Simulation engine
│   ├── replay.py     # Deterministic candle replay loop
│   ├── execution/    # ExecutionPolicyPlugins
│   │   └── plugins/  # ExecutionPolicyPlugin implementations
│   └── fills/        # FillModelPlugins
│       └── plugins/  # FillModelPlugin implementations
├── metrics/          # Metrics and reports (MetricPlugins)
│   ├── plugins/      # MetricPlugin implementations
│   ├── metrics.py    # Standard metrics
│   └── reports.py    # Report generation
├── artifacts/        # Artifact management
│   ├── manifest.py   # artifacts.json generation
│   └── validator.py  # Contract validation
└── contracts/        # Contract definitions
    ├── schemas.py    # Pydantic schemas
    ├── run_spec.py   # RunSpec schema
    └── validation.py # Contract validation
```

### Data Flow

```text
1. User initiates backtest with RunSpec (pipeline graph)
   ↓
2. Materializer: Load alerts from DuckDBReader (filtered by RunSpec)
   ↓
3. Materializer: Extract token addresses from alerts
   ↓
4. Materializer: Load OHLCV data from ClickHouseReader for tokens/time range
   ↓
5. Materializer: Write immutable Parquet files (alerts.parquet, ohlcv.parquet)
   ↓
6. Materializer: Generate fingerprints + artifacts.json
   ↓
7. Feature Builder: Run feature_pipeline (FeaturePlugins) → features.parquet, paths.parquet
   ↓
8. Signal Generator: Run signal_pipeline (SignalPlugins) → signals.parquet
   ↓
9. Simulator: Deterministic candle replay loop:
   - For each candle t:
     - Gather candle + features at t
     - Run signal plugins → signals
     - Run execution_policy (ExecutionPolicyPlugins) → trade events
     - Apply fill_model (FillModelPlugin) → fill events
     - Update position state
     - Record to events.parquet (truth source)
   ↓
10. Trade Derivation: Derive trades.parquet from events.parquet
   ↓
11. Metrics: Run MetricPlugins → metrics.parquet
   ↓
12. Reports: Generate summary.json, artifacts.json (manifest)
   ↓
13. Return RunSpec ID and summary
```

### Error Handling

- **Data Errors**: Missing OHLCV data should be logged but not fail the run (configurable threshold)
- **Contract Errors**: Schema or fingerprint mismatches should fail fast with clear error messages
- **Validation Errors**: Invalid RunSpec or inputs should fail fast with actionable error messages
- **Materialization Errors**: Materialization failures should be retried with exponential backoff
- **Simulation Errors**: Simulation errors should be logged with full context for debugging

### Performance Considerations

- **Parallelization**: Load OHLCV data for multiple tokens in parallel during materialization
- **Materialization Caching**: Materialized inputs can be reused across multiple simulation runs
- **Parquet Efficiency**: Use Parquet columnar format for efficient storage and querying
- **Memory Management**: Stream large datasets during materialization, use efficient DataFrame operations
- **Incremental Materialization**: Support incremental materialization for large date ranges

---

## Technical Considerations

### Technology Stack

- **Python 3.9+**: Sole runtime and language for entire platform
- **ClickHouse**: OHLCV time-series data storage (read-only access)
- **DuckDB**: Optional alerts storage (read-only access, local cache/query)
- **Parquet**: Immutable data storage format for inputs and outputs
- **Typer**: CLI framework
- **Textual**: Optional TUI framework (future)

### Dependencies

**Core Dependencies:**

- `clickhouse-connect`: ClickHouse Python client library
- `duckdb`: DuckDB Python bindings (for optional alert queries)
- `pandas`: Data manipulation and analysis
- `pyarrow`: Parquet file I/O and schema management
- `typer`: CLI framework with rich output
- `pydantic`: Schema validation and data modeling
- `rich`: Rich text and beautiful formatting for CLI

**Optional Dependencies:**

- `fastapi`: REST API (if API feature enabled, future)
- `textual`: TUI framework (future)
- `numpy`: Numerical computations (via pandas)
- `matplotlib`: Visualization (for reports)
- `plotly`: Interactive visualization (for reports)

### Performance Requirements

- **Materialization**: Should complete in < 2 minutes for 1000 alerts with 1 month of OHLCV data
- **Backtest Execution**: Should complete in < 5 minutes for 1000 alerts with 1 month of data (using materialized inputs)
- **Data Loading**: OHLCV data loading from ClickHouse should complete in < 30 seconds for 100 tokens
- **Parquet I/O**: Reading/writing Parquet files should be efficient (< 10 seconds for 100K rows)
- **Result Storage**: Results should be stored as Parquet in < 10 seconds for 1000 trades
- **Concurrent Runs**: Platform should support multiple concurrent backtest runs (configurable limit)

### Scalability Considerations

- **Horizontal Scaling**: Not required for initial version (single-node)
- **Vertical Scaling**: Should handle datasets up to 10M candles and 100K alerts
- **Storage Growth**: Parquet compression ensures efficient storage (< 100MB per 1000 trades)
- **Materialization Reuse**: Materialized inputs can be reused across multiple runs, reducing database load

### Security Considerations

- **Input Validation**: All user inputs must be validated using Pydantic schemas
- **SQL Injection**: Use parameterized queries for all database operations (ClickHouse, DuckDB)
- **File System Access**: Materialized Parquet files are read-only after creation
- **Secrets Management**: Database credentials should be managed securely (environment variables, config files)
- **Fingerprint Validation**: Input fingerprints prevent tampering with materialized data

### Testing Requirements

- **Unit Tests**: All core functions must have unit tests (>80% coverage, pytest)
- **Integration Tests**: Test full backtest workflow with test data (materialization → simulation → metrics)
- **Contract Tests**: Test schema validation and fingerprint calculation
- **Regression Tests**: Ensure byte-identical reproducibility with regression test suite
- **Performance Tests**: Benchmark materialization, simulation, and Parquet I/O times
- **Gate Criteria Tests**: Automated tests for all four gate criteria

### Deployment Considerations

- **Local Development**: Should run on developer machines with minimal setup (Python 3.9+, pip install)
- **Virtual Environments**: Use Python virtual environments for dependency isolation
- **Docker Support**: Optional Docker image for consistent environments
- **Configuration**: Environment-based configuration (dev, prod) via environment variables or config files
- **Logging**: Structured logging with configurable levels (Python logging module)
- **Package Management**: Use `pyproject.toml` and `poetry` or `pip` for dependency management

---

## Success Metrics

### Contract Compliance Metrics

1. **Byte-Identical Reproducibility**: 100% of re-runs with identical RunSpecs produce byte-identical summary.json (within tolerance)
2. **Materialized Input Reuse**: 100% of materialized inputs can be reused for simulation without database access
3. **Spec-Based Diffing**: 100% of run differences can be explained purely from RunSpec changes
4. **Historical Reproduction**: 100% of historical runs (30+ days old) can be reproduced with zero guesswork
5. **Contract Validation**: 100% of inputs/outputs pass schema and fingerprint validation

### Functional Metrics

1. **Determinism**: 100% of runs with identical RunSpecs produce identical outputs (within floating-point tolerance)
2. **Data Coverage**: System handles datasets with >95% data coverage without errors
3. **Result Accuracy**: All calculated metrics match manual calculations within acceptable tolerance
4. **Schema Compliance**: 100% of Parquet files have explicit schemas and valid fingerprints

### Performance Metrics

1. **Materialization Time**: Materialization completes in < 2 minutes for standard dataset (1000 alerts, 1 month)
2. **Execution Time**: Average backtest completes in < 5 minutes for standard dataset (using materialized inputs)
3. **Data Loading**: OHLCV data loading from ClickHouse completes in < 30 seconds for 100 tokens
4. **Parquet I/O**: Reading/writing Parquet files completes in < 10 seconds for 100K rows
5. **Memory Usage**: Peak memory usage < 2GB for standard dataset
6. **Storage Efficiency**: Results storage uses < 100MB per 1000 trades (Parquet compression)

### Usability Metrics

1. **Time to First Backtest**: New user can run first backtest in < 10 minutes
2. **Policy Development**: Developer can create and test a simple trading policy in < 1 hour
3. **Documentation Coverage**: 100% of public APIs have documentation
4. **Error Clarity**: All errors include actionable messages with RunSpec context
5. **Run Comparison**: User can compare two runs and understand differences in < 5 minutes

### Adoption Metrics

1. **Usage**: Platform used for at least 100 backtest runs per month
2. **Reproducibility**: At least 90% of runs can be successfully reproduced after 30 days
3. **Materialization Reuse**: At least 50% of simulation runs reuse existing materialized inputs

---

## Open Questions

1. **Parquet Schema Versioning**:
   - How should Parquet schemas be versioned for backward compatibility?
   - What happens when schema changes are needed?
   - Should schema migrations be supported?

2. **Fingerprint Algorithm**:
   - Should SHA256 be the standard, or are there better alternatives?
   - How to handle fingerprint calculation for very large files?
   - Should fingerprints include metadata (timestamps, etc.)?

3. **Tolerance Thresholds**:
   - What are appropriate tolerance thresholds for "byte-identical" floating-point comparisons?
   - Should tolerance be configurable per metric type?
   - How to document tolerance in artifacts.json?

4. **RunSpec Storage Format**:
   - Should RunSpecs be stored as JSON, YAML, or TOML?
   - Should RunSpecs be versioned separately from the platform?
   - How to handle RunSpec schema evolution?

5. **Materialization Strategy**:
   - Should materialization be incremental for large date ranges?
   - How to handle materialization failures and retries?
   - Should materialized inputs be compressed or partitioned?

6. **Policy Distribution**:
   - How should trading policies be distributed? (Python modules, git repos, local files)
   - Should there be a policy registry/marketplace?
   - How to version and manage policy dependencies?

7. **Concurrency**:
   - Should multiple backtests be able to run concurrently?
   - How to handle resource contention (database connections, memory, Parquet I/O)?
   - Should materialized inputs be shared across concurrent runs?

8. **Comparison and Diffing**:
   - What level of detail should be included in run comparisons?
   - Should the platform support diffing Parquet files directly?
   - How to visualize differences between runs?

---

## Appendix

### Glossary

- **Alert**: A trading signal from a caller (stored in DuckDB or materialized as alerts.parquet)
- **OHLCV**: Open, High, Low, Close, Volume candle data (stored in ClickHouse or materialized as ohlcv.parquet)
- **RunSpec**: Complete specification of a backtest run as a pipeline graph, including feature_pipeline, signal_pipeline, execution_policy, fill_model, and all parameters. Contains everything needed to reproduce a run.
- **Materializer**: Layer that pulls data slices from adapters and writes immutable Parquet inputs with fingerprints
- **Fingerprint**: SHA256 hash of a file's contents, used for validation and reproducibility
- **Contract**: Formal specification of input/output formats, including schemas and fingerprints
- **FeaturePlugin**: Plugin type that adds feature columns to candles (indicators, path metrics). Must be pure and time-safe.
- **SignalPlugin**: Plugin type that generates discrete trading signals from features (ENTER, EXIT, SET_STOP, etc.). Signals are "intents", not executed trades.
- **ExecutionPolicyPlugin**: Plugin type that executes position management based on signals and current state (trailing stops, ladder exits, re-entry rules). Separate from signal generation.
- **FillModelPlugin**: Plugin type that determines fill prices/quantities for trade intents (optional in v1)
- **MetricPlugin**: Plugin type that computes custom metrics from trades/events (optional)
- **Time Fence API**: Guardrail API that physically prevents plugins from accessing future data by exposing only current row and rolling windows
- **Event Ledger**: events.parquet is the immutable truth source. All other outputs (trades, metrics) can be recomputed from events.
- **Pipeline Graph**: RunSpec structure representing strategy as ordered pipelines: feature_pipeline → signal_pipeline → execution_policy → fill_model
- **Backtest Run**: A single execution of a backtest with a specific RunSpec, producing a self-contained run folder
- **Byte-Identical**: Results that match exactly (or within floating-point tolerance) when reproduced
- **Gate Criteria**: Four criteria that the platform must pass: byte-identical reproducibility, materialized input reuse, spec-based diffing, and historical reproduction

### References

- Original QuantBot project: `../quantBot-consolidation-work/`
- ClickHouse documentation: <https://clickhouse.com/docs>
- DuckDB documentation: <https://duckdb.org/docs/>

### Related Documents

- Architecture Design Document (to be created)
- Contract Specification Document (to be created)
- Policy Development Guide (to be created)
- API Documentation (to be created)
- Deployment Guide (to be created)
