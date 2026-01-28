# QuantBot Backtesting Lab - Project Plan

**Version**: 1.0  
**Status**: ✅ Complete (All 8 Phases Implemented)  
**Last Updated**: January 20, 2026

## Overview

This document provides a structured project plan with decomposed tasks and TODO items for tracking implementation progress. Each phase from the roadmap is broken down into actionable tasks that can be assigned and tracked by agents.

**Reference**: See `roadmap.md` for detailed phase descriptions and `prd-backtesting-platform.md` for requirements.

---

## Plan Structure

- **Phases**: High-level implementation phases (0-9)
- **Tasks**: Specific deliverables within each phase (T{phase}.{number})
- **TODOs**: Actionable items within each task
- **Dependencies**: Clear dependency chain between tasks

---

## Phase 0: Foundation & Setup

**Status**: ✅ Completed  
**Duration**: Completed  
**Dependencies**: None

### T0.1: Initialize Python Project Structure

**Status**: ✅ Completed  
**Dependencies**: None

**TODOs**:

- [x] Create root project directory structure
- [x] Create `pyproject.toml` with project metadata
- [x] Set up package structure: `adapters/`, `materializer/`, `features/`, `signals/`, `simulator/`, `metrics/`, `reports/`, `cli/`, `contracts/`, `artifacts/`
- [x] Create `__init__.py` files for all packages
- [x] Set up development dependencies in `pyproject.toml` (pytest, black, mypy, ruff)
- [x] Create `.gitignore` for Python project
- [x] Create `README.md` with project overview
- [x] Verify project can be installed with `pip install -e .`

**Reference**: PRD Architecture Principles, Roadmap Phase 0

---

### T0.2: Install and Configure Core Dependencies

**Status**: ✅ Completed  
**Dependencies**: T0.1

**TODOs**:

- [x] Add `pandas` dependency (data manipulation)
- [x] Add `pyarrow` dependency (Parquet I/O)
- [x] Add `clickhouse-connect` dependency (ClickHouse client)
- [x] Add `duckdb` dependency (DuckDB bindings)
- [x] Add `typer` dependency (CLI framework)
- [x] Add `rich` dependency (CLI formatting)
- [x] Add `pydantic` dependency (schema validation)
- [x] Add `pytest` for testing
- [x] Add `black` for code formatting
- [x] Add `mypy` for type checking
- [x] Add `ruff` for linting
- [x] Create `requirements.txt` or lock dependencies
- [x] Verify all dependencies install correctly

**Reference**: PRD Technical Considerations, Roadmap Phase 0

---

### T0.3: Define Core Domain Types

**Status**: ✅ Completed  
**Dependencies**: T0.2

**TODOs**:

- [x] Create `contracts/schemas.py` module
- [x] Define `Alert` Pydantic model (caller, mint, timestamp, side, payload)
- [x] Define `Candle` Pydantic model (timestamp, open, high, low, close, volume, interval)
- [x] Define `RunSpec` base structure (run_meta, universe, time_range, data)
- [x] Define `Event` base type and subclasses:
  - [x] `FillEvent` (fill price, quantity, timestamp)
  - [x] `StopChangeEvent` (stop price, timestamp)
  - [x] `PositionUpdateEvent` (position state, timestamp)
  - [x] `SignalFireEvent` (signal type, timestamp)
- [x] Define `CoverageReport` type for data quality
- [x] Add Pydantic validation to all types
- [x] Create unit tests for all type definitions
- [x] Document type definitions

**Reference**: PRD Glossary, Roadmap Phase 0

---

### T0.4: Create Contract Schema Definitions

**Status**: ✅ Completed  
**Dependencies**: T0.3

**TODOs**:

- [x] Define Parquet schema for `alerts.parquet`:
  - [ ] Schema fields (caller, mint, timestamp, side, payload)
  - [ ] Data types and nullability
  - [ ] Schema version (v1.0)
- [x] Define Parquet schema for `ohlcv.parquet`:
  - [ ] Schema fields (timestamp, open, high, low, close, volume, interval, mint)
  - [ ] Data types and nullability
  - [ ] Schema version (v1.0)
- [x] Implement schema versioning strategy
- [x] Create schema validation functions
- [x] Create schema migration utilities (for future versions)
- [x] Add schema tests
- [x] Document schema definitions

**Reference**: FR-4 (Schema and Fingerprint Management), Roadmap Phase 0

---

### T0.5: Set Up Logging and Configuration System

**Status**: ✅ Completed  
**Dependencies**: T0.2

**TODOs**:

- [x] Create `config/` module for configuration
- [x] Define configuration schema with Pydantic
- [x] Implement environment-based configuration (dev/prod)
- [x] Set up structured logging with Python logging module
- [x] Configure log levels (DEBUG, INFO, WARNING, ERROR)
- [x] Create log formatters (structured JSON for production)
- [x] Add configuration file support (YAML/TOML)
- [x] Create configuration validation
- [x] Add configuration tests
- [x] Document configuration system

**Reference**: PRD Deployment Considerations, Roadmap Phase 0

---

## Phase 1: Adapters Layer

**Status**: ✅ Completed  
**Duration**: 1-2 weeks  
**Dependencies**: Phase 0

### T1.1: Implement ClickHouseReader

**Status**: ✅ Completed  
**Dependencies**: T0.2, T0.3

**TODOs**:

- [x] Create `adapters/clickhouse_reader.py` module
- [x] Implement `ClickHouseReader` class
- [x] Implement `get_candles(token, from_time, to_time, interval)` method:
  - [ ] Build SELECT query with parameters
  - [ ] Execute query with connection pooling
  - [ ] Convert results to pandas DataFrame
  - [ ] Validate data format
  - [ ] Handle errors with retries
- [x] Implement `get_candle_range(tokens, from_time, to_time, interval)` method:
  - [ ] Query multiple tokens in parallel
  - [ ] Return Dict[str, DataFrame]
  - [ ] Handle partial failures
- [x] Implement `check_data_coverage(tokens, from_time, to_time)` method:
  - [ ] Check for gaps in data
  - [ ] Calculate coverage percentage
  - [ ] Return CoverageReport
- [x] Add connection pooling
- [x] Add query optimization
- [x] Add error handling and retries
- [x] Add unit tests
- [x] Add integration tests with test ClickHouse instance
- [x] Document ClickHouseReader API

**Reference**: FR-1 (ClickHouseReader), Roadmap Phase 1

---

### T1.2: Implement DuckDBReader

**Status**: ✅ Completed  
**Dependencies**: T0.2, T0.3

**TODOs**:

- [x] Create `adapters/duckdb_reader.py` module
- [x] Implement `DuckDBReader` class
- [x] Implement `get_alerts(filters)` method:
  - [ ] Build SELECT query with filters (date range, caller, token)
  - [ ] Execute query on DuckDB file
  - [ ] Convert results to pandas DataFrame
  - [ ] Validate Alert schema
  - [ ] Handle missing data gracefully
- [x] Implement `query_alerts(query)` method:
  - [ ] Execute custom SQL query
  - [ ] Validate query is SELECT only (read-only enforcement)
  - [ ] Return DataFrame
- [x] Add read-only access enforcement
- [x] Add local file-based query optimization
- [x] Add error handling
- [x] Add unit tests
- [x] Add integration tests with test DuckDB file
- [x] Document DuckDBReader API

**Reference**: FR-2 (DuckDBReader), Roadmap Phase 1

---

### T1.3: Create Adapter Interface/Base Classes

**Status**: ✅ Completed  
**Dependencies**: T1.1, T1.2

**TODOs**:

- [x] Create `adapters/base.py` module
- [x] Define abstract base class `Reader`:
  - [ ] Abstract methods for common interface
  - [ ] Common error handling patterns
  - [ ] Connection management utilities
- [x] Implement common utilities:
  - [ ] Connection pooling base class
  - [ ] Query retry logic
  - [ ] Error handling decorators
- [x] Make ClickHouseReader and DuckDBReader inherit from base
- [x] Add adapter registry (for future extensibility)
- [x] Add adapter tests
- [x] Document adapter interface

**Reference**: Roadmap Phase 1

---

### T1.4: Add Adapter Tests

**Status**: ✅ Completed  
**Dependencies**: T1.1, T1.2, T1.3

**TODOs**:

- [x] Create `tests/adapters/` directory
- [x] Create mock database connections for unit tests
- [x] Write unit tests for ClickHouseReader:
  - [ ] Test `get_candles` method
  - [ ] Test `get_candle_range` method
  - [ ] Test `check_data_coverage` method
  - [ ] Test error handling
  - [ ] Test connection pooling
- [x] Write unit tests for DuckDBReader:
  - [ ] Test `get_alerts` method
  - [ ] Test `query_alerts` method
  - [ ] Test read-only enforcement
  - [ ] Test error handling
- [x] Write integration tests:
  - [ ] Test with test ClickHouse instance
  - [ ] Test with test DuckDB file
- [x] Achieve >80% test coverage
- [x] Document test setup

**Reference**: PRD Testing Requirements, Roadmap Phase 1

---

## Phase 2: Materializer Layer

**Status**: ✅ Completed  
**Duration**: 2-3 weeks  
**Dependencies**: Phase 0, Phase 1

### T2.1: Implement Data Materialization Process

**Status**: ✅ Completed  
**Dependencies**: T1.1, T1.2, T0.3, T0.4

**TODOs**:

- [x] Create `materializer/materializer.py` module
- [x] Implement `Materializer` class
- [x] Implement materialization workflow:
  - [ ] Load alerts from DuckDBReader (filtered by RunSpec)
  - [ ] Extract token addresses from alerts
  - [ ] Load OHLCV from ClickHouseReader for tokens/time range
  - [ ] Validate data quality (coverage, gaps)
  - [ ] Write alerts to `alerts.parquet` with schema validation
  - [ ] Write OHLCV to `ohlcv.parquet` with schema validation
- [x] Add data quality validation:
  - [ ] Date range validation
  - [ ] Data coverage checks
  - [ ] Gap detection
  - [ ] Duplicate detection
- [x] Add logging for materialization progress
- [x] Add error handling and recovery
- [x] Add unit tests
- [x] Add integration tests
- [x] Document materialization process

**Reference**: FR-3 (Data Materialization), Roadmap Phase 2

---

### T2.2: Implement Fingerprint Generation

**Status**: ✅ Completed  
**Dependencies**: T2.1

**TODOs**:

- [x] Create `materializer/fingerprints.py` module
- [x] Implement SHA256 hash calculation for Parquet files:
  - [ ] Read Parquet file
  - [ ] Calculate SHA256 hash
  - [ ] Return hex digest
- [x] Implement fingerprint storage in artifacts.json
- [x] Implement fingerprint validation:
  - [ ] Compare fingerprints on re-materialization
  - [ ] Detect fingerprint mismatches
  - [ ] Report mismatches with clear errors
- [x] Add fingerprint tests
- [x] Document fingerprint system

**Reference**: FR-4 (Schema and Fingerprint Management), Roadmap Phase 2

---

### T2.3: Implement Schema Management

**Status**: ✅ Completed  
**Dependencies**: T0.4, T2.1

**TODOs**:

- [x] Create `materializer/schemas.py` module
- [x] Implement explicit schema definitions:
  - [ ] alerts.parquet schema
  - [ ] ohlcv.parquet schema
- [x] Implement schema versioning:
  - [ ] Schema version tracking
  - [ ] Version comparison utilities
  - [ ] Backward compatibility checks
- [x] Implement schema validation on write:
  - [ ] Validate DataFrame matches schema
  - [ ] Validate data types
  - [ ] Validate nullability
- [x] Implement schema migration utilities (for future)
- [x] Add schema tests
- [x] Document schema management

**Reference**: FR-4 (Schema and Fingerprint Management), Roadmap Phase 2

---

### T2.4: Create artifacts.json Generator

**Status**: ✅ Completed  
**Dependencies**: T2.1, T2.2, T2.3

**TODOs**:

- [x] Create `materializer/artifacts.py` module
- [x] Implement artifacts.json structure:
  - [ ] Artifact metadata (name, path, type)
  - [ ] Schema information (schema_version)
  - [ ] Data statistics (row_count, min_ts, max_ts)
  - [ ] Fingerprints (SHA256)
  - [ ] Run metadata (spec_hash, engine_version)
- [x] Implement artifacts.json generation:
  - [ ] Collect artifact metadata
  - [ ] Generate JSON structure
  - [ ] Write to artifacts.json file
- [x] Implement artifacts.json updates:
  - [ ] Add new artifacts
  - [ ] Update existing artifacts
  - [ ] Maintain manifest integrity
- [x] Add artifacts.json validation
- [x] Add artifacts.json tests
- [x] Document artifacts.json format

**Reference**: FR-13 (Report Generation), Roadmap Phase 2

---

### T2.5: Implement Data Quality Validation

**Status**: ✅ Completed  
**Dependencies**: T2.1

**TODOs**:

- [x] Create `materializer/quality.py` module
- [x] Implement date range validation:
  - [ ] Validate start_ts < end_ts
  - [ ] Validate timestamps are UTC
  - [ ] Validate date range is reasonable
- [x] Implement data coverage checks:
  - [ ] Check for gaps in time series
  - [ ] Calculate coverage percentage
  - [ ] Detect duplicates per (mint, interval, ts)
  - [ ] Validate monotonic time per series
- [x] Implement data quality metrics logging:
  - [ ] Log coverage percentage
  - [ ] Log gap locations
  - [ ] Log outlier detection
- [x] Implement coverage threshold enforcement:
  - [ ] Configurable threshold (default >95%)
  - [ ] Fail or warn based on threshold
- [x] Add data quality tests
- [x] Document data quality validation

**Reference**: FR-3 (Data Materialization), Roadmap Phase 2

---

### T2.6: Add Materialization Tests

**Status**: ✅ Completed  
**Dependencies**: T2.1, T2.2, T2.3, T2.4, T2.5

**TODOs**:

- [x] Create `tests/materializer/` directory
- [x] Write unit tests for materialization process
- [x] Write unit tests for fingerprint generation
- [x] Write unit tests for schema validation
- [x] Write unit tests for data quality validation
- [x] Write integration tests:
  - [ ] Test full materialization workflow
  - [ ] Test with test data
  - [ ] Test error scenarios
- [x] Achieve >80% test coverage
- [x] Document test setup

**Reference**: PRD Testing Requirements, Roadmap Phase 2

---

## Phase 3: Feature/Path Builder Layer

**Status**: ✅ Completed  
**Duration**: 2-3 weeks  
**Dependencies**: Phase 0, Phase 2

### T3.1: Define FeaturePlugin Interface

**Status**: ✅ Completed  
**Dependencies**: T0.3, T2.1

**TODOs**:

- [x] Create `features/base.py` module
- [x] Define abstract base class `FeaturePlugin`:
  - [ ] Abstract method `compute(context)` → DataFrame with new columns
  - [ ] Plugin metadata (name, version, description)
  - [ ] Parameter validation
- [x] Define plugin interface contract:
  - [ ] Input: Candles table (+ optional prior features)
  - [ ] Output: Candles table with new feature columns
  - [ ] Rules: pure functions, no I/O, no globals, no column mutations
- [x] Implement plugin validation:
  - [ ] Check plugin implements interface
  - [ ] Validate plugin is pure (no I/O, no globals)
  - [ ] Validate plugin doesn't mutate existing columns
- [x] Create plugin registry system
- [x] Add plugin interface tests
- [x] Document FeaturePlugin interface

**Reference**: FR-5 (Feature Engineering via FeaturePlugin System), Roadmap Phase 3

---

### T3.2: Implement Time Fence API

**Status**: ✅ Completed  
**Dependencies**: T3.1

**TODOs**:

- [x] Create `features/time_fence.py` module
- [x] Implement `TimeFenceContext` class:
  - [ ] Expose current row (candle at time t)
  - [ ] Expose rolling windows ending at current index
  - [ ] Expose precomputed feature columns up to current index
  - [ ] Prevent access to future rows
  - [ ] Prevent access to raw dataframes
- [x] Implement time bounds checking:
  - [ ] Validate no future data access
  - [ ] Validate no lookahead violations
  - [ ] Raise errors on violations
- [x] Implement rolling window utilities:
  - [ ] Window calculation utilities
  - [ ] Efficient window access
- [x] Add Time Fence API tests:
  - [ ] Test context exposes correct data
  - [ ] Test future access prevention
  - [ ] Test rolling windows
- [x] Document Time Fence API

**Reference**: FR-5 (Time Fence API), FR-17 (Time Fence API), Roadmap Phase 3

---

### T3.3: Implement Feature Pipeline Executor

**Status**: ✅ Completed  
**Dependencies**: T3.1, T3.2

**TODOs**:

- [x] Create `features/executor.py` module
- [x] Implement `FeaturePipelineExecutor` class
- [x] Implement ordered execution:
  - [ ] Load plugins from RunSpec feature_pipeline
  - [ ] Execute plugins in order
  - [ ] Accumulate feature columns
- [x] Implement immutability enforcement:
  - [ ] Check no column mutations
  - [ ] Validate new columns only
- [x] Implement causal constraint validation:
  - [ ] Use Time Fence API
  - [ ] Validate no future data access
- [x] Add feature computation logging
- [x] Add error handling
- [x] Add pipeline executor tests
- [x] Document feature pipeline execution

**Reference**: FR-5 (Feature Engineering), Roadmap Phase 3

---

### T3.4: Create Example FeaturePlugins

**Status**: ✅ Completed  
**Dependencies**: T3.1, T3.2, T3.3

**TODOs**:

- [x] Create `features/plugins/` directory
- [x] Implement `SMA` plugin (Simple Moving Average):
  - [ ] Configurable window size
  - [ ] Use Time Fence API
  - [ ] Add tests
- [x] Implement `EMA` plugin (Exponential Moving Average):
  - [ ] Configurable window and alpha
  - [ ] Use Time Fence API
  - [ ] Add tests
- [x] Implement `RSI` plugin (Relative Strength Index):
  - [ ] Configurable window (default 14)
  - [ ] Use Time Fence API
  - [ ] Add tests
- [x] Implement `MACD` plugin:
  - [ ] Configurable parameters
  - [ ] Use Time Fence API
  - [ ] Add tests
- [x] Implement `VWAP` plugin:
  - [ ] Volume-weighted average price
  - [ ] Use Time Fence API
  - [ ] Add tests
- [x] Implement rolling volume plugin
- [x] Implement drawdown-from-peak plugin
- [x] Implement volatility indicators
- [x] Document example plugins

**Reference**: FR-5 (FeaturePlugin Examples), Roadmap Phase 3

---

### T3.5: Implement Path Metrics Computation

**Status**: ✅ Completed  
**Dependencies**: T3.3

**TODOs**:

- [x] Create `features/paths.py` module
- [x] Implement drawdown paths calculation:
  - [ ] Calculate peak-to-trough drawdowns
  - [ ] Track drawdown duration
  - [ ] Calculate recovery paths
- [x] Implement volatility paths:
  - [ ] Rolling volatility calculations
  - [ ] Volatility regimes
- [x] Implement price path metrics:
  - [ ] Price change paths
  - [ ] Return paths
- [x] Write path metrics to `derived/paths.parquet`
- [x] Add path metrics tests
- [x] Document path metrics

**Reference**: FR-5 (Path metrics), Roadmap Phase 3

---

### T3.6: Add Feature Builder Tests

**Status**: ✅ Completed  
**Dependencies**: T3.1, T3.2, T3.3, T3.4, T3.5

**TODOs**:

- [x] Create `tests/features/` directory
- [x] Write unit tests for FeaturePlugin interface
- [x] Write unit tests for Time Fence API:
  - [ ] Test future access prevention
  - [ ] Test rolling windows
  - [ ] Test context data exposure
- [x] Write unit tests for feature pipeline executor
- [x] Write unit tests for example plugins
- [x] Write causal constraint validation tests
- [x] Write integration tests:
  - [ ] Test full feature pipeline
  - [ ] Test with test data
- [x] Achieve >80% test coverage
- [x] Document test setup

**Reference**: PRD Testing Requirements, Roadmap Phase 3

---

## Phase 4: Signal Generation Layer

**Status**: ✅ Completed  
**Duration**: 1-2 weeks  
**Dependencies**: Phase 0, Phase 3

### T4.1: Define SignalPlugin Interface

**Status**: ✅ Completed  
**Dependencies**: T0.3, T3.1

**TODOs**:

- [x] Create `signals/base.py` module
- [x] Define abstract base class `SignalPlugin`:
  - [ ] Abstract method `generate(context)` → List[Signal]
  - [ ] Plugin metadata (name, version, description)
  - [ ] Parameter validation
- [x] Define signal types enum:
  - [ ] ENTER, EXIT, SET_STOP, TRAIL_UPDATE, REENTER_ARM, etc.
- [x] Define Signal data structure:
  - [ ] Signal type
  - [ ] Timestamp
  - [ ] Parameters (price, quantity, etc.)
- [x] Define plugin interface contract:
  - [ ] Input: Candles+features at current timestamp
  - [ ] Output: Discrete signals/events
  - [ ] Rules: pure functions, derivable from current time, no future access
- [x] Implement plugin validation
- [x] Create plugin registry system
- [x] Add plugin interface tests
- [x] Document SignalPlugin interface

**Reference**: FR-6 (Signal Generation via SignalPlugin System), Roadmap Phase 4

---

### T4.2: Implement Signal Pipeline Executor

**Status**: ✅ Completed  
**Dependencies**: T4.1, T3.2

**TODOs**:

- [x] Create `signals/executor.py` module
- [x] Implement `SignalPipelineExecutor` class
- [x] Implement ordered execution:
  - [ ] Load plugins from RunSpec signal_pipeline
  - [ ] Execute plugins in order at each timestamp
  - [ ] Collect signals from all plugins
- [x] Integrate with Time Fence API:
  - [ ] Pass TimeFenceContext to plugins
  - [ ] Validate no future data access
- [x] Implement signal event generation:
  - [ ] Convert plugin outputs to signal events
  - [ ] Add timestamps
  - [ ] Validate signal format
- [x] Add error handling
- [x] Add pipeline executor tests
- [x] Document signal pipeline execution

**Reference**: FR-6 (Signal Generation), Roadmap Phase 4

---

### T4.3: Create Example SignalPlugins

**Status**: ✅ Completed  
**Dependencies**: T4.1, T4.2

**TODOs**:

- [x] Create `signals/plugins/` directory
- [x] Implement `CrossAboveVWAP` plugin:
  - [ ] Detect price crossing above VWAP
  - [ ] Generate ENTER signal
  - [ ] Add tests
- [x] Implement `RSIOversold` plugin:
  - [ ] Detect RSI oversold condition
  - [ ] Generate REENTER_ARM signal
  - [ ] Add tests
- [x] Implement `BreakoutAboveHigh` plugin:
  - [ ] Detect breakout above prior high
  - [ ] Generate ENTER signal
  - [ ] Add tests
- [x] Document example plugins

**Reference**: FR-6 (SignalPlugin Examples), Roadmap Phase 4

---

### T4.4: Implement Signal Output to Parquet

**Status**: ✅ Completed  
**Dependencies**: T4.2

**TODOs**:

- [x] Define signal Parquet schema:
  - [ ] Signal type, timestamp, parameters
  - [ ] Schema version
- [x] Implement signal serialization:
  - [ ] Convert signal events to DataFrame
  - [ ] Validate schema
- [x] Write signals to `derived/signals.parquet`:
  - [ ] Use schema validation
  - [ ] Add fingerprint
- [x] Add signal output tests
- [x] Document signal output format

**Reference**: FR-6 (Signal Outputs), Roadmap Phase 4

---

### T4.5: Add Signal Generation Tests

**Status**: ✅ Completed  
**Dependencies**: T4.1, T4.2, T4.3, T4.4

**TODOs**:

- [x] Create `tests/signals/` directory
- [x] Write unit tests for SignalPlugin interface
- [x] Write unit tests for signal pipeline executor
- [x] Write unit tests for example plugins
- [x] Write causal constraint validation tests
- [x] Write integration tests:
  - [ ] Test full signal pipeline
  - [ ] Test with test data
- [x] Achieve >80% test coverage
- [x] Document test setup

**Reference**: PRD Testing Requirements, Roadmap Phase 4

---

## Phase 5: Simulator Layer

**Status**: ✅ Completed  
**Duration**: 3-4 weeks  
**Dependencies**: Phase 0, Phase 3, Phase 4

### T5.1: Implement Deterministic Candle Replay Loop

**Status**: ✅ Completed  
**Dependencies**: T3.3, T4.2, T0.3

**TODOs**:

- [x] Create `simulator/replay.py` module
- [x] Implement `CandleReplayLoop` class
- [x] Implement chronological iteration:
  - [ ] Load candles in chronological order
  - [ ] Iterate through each candle t
- [x] Implement game engine style loop:
  - [ ] Gather candle row (O/H/L/C/V)
  - [ ] Fetch features at t (precomputed)
  - [ ] Run signal plugins at t → signals
  - [ ] Run execution policy → trade events
  - [ ] Update position state
  - [ ] Record events to events.parquet
- [x] Ensure determinism:
  - [ ] Seed-controlled randomness only
  - [ ] Single-threaded execution
  - [ ] Explicit ordering
- [x] Add guard rails for future data access
- [x] Add replay loop tests
- [x] Document replay loop

**Reference**: FR-7 (Deterministic Candle Replay Loop), Roadmap Phase 5

---

### T5.2: Implement Position State Machine

**Status**: ✅ Completed  
**Dependencies**: T0.3

**TODOs**:

- [x] Create `simulator/state.py` module
- [x] Define position states enum:
  - [ ] NO_POSITION, LONG, SHORT, etc.
- [x] Implement `PositionState` class:
  - [ ] Current position state
  - [ ] Position size
  - [ ] Entry price
  - [ ] Active stops (stop loss, take profit)
  - [ ] Trailing stops
  - [ ] Re-entry arms
  - [ ] Capital allocation
- [x] Implement state transitions:
  - [ ] Enter position
  - [ ] Exit position
  - [ ] Update stops
  - [ ] Update trailing stops
  - [ ] Arm re-entry
- [x] Add state machine tests
- [x] Document position state machine

**Reference**: FR-7 (State Management), Roadmap Phase 5

---

### T5.3: Define ExecutionPolicyPlugin Interface

**Status**: ✅ Completed  
**Dependencies**: T0.3, T5.2

**TODOs**:

- [x] Create `simulator/execution/base.py` module
- [x] Define abstract base class `ExecutionPolicyPlugin`:
  - [ ] Abstract method `execute(state, candle, signals)` → List[TradeEvent]
  - [ ] Plugin metadata (name, version, priority)
  - [ ] Parameter validation
- [x] Define plugin interface contract:
  - [ ] Input: Current position state + candle + active signals
  - [ ] Output: Trade events (fills, stop changes, partial exits)
  - [ ] Rules: deterministic, pure functions, well-defined ordering
- [x] Implement priority-based ordering:
  - [ ] Priority field in plugin config
  - [ ] Sort plugins by priority
- [x] Implement plugin validation
- [x] Create plugin registry system
- [x] Add plugin interface tests
- [x] Document ExecutionPolicyPlugin interface

**Reference**: FR-8 (Execution Policy via ExecutionPolicyPlugin System), Roadmap Phase 5

---

### T5.4: Implement Execution Policy Executor

**Status**: ✅ Completed  
**Dependencies**: T5.3, T5.2

**TODOs**:

- [x] Create `simulator/execution/executor.py` module
- [x] Implement `ExecutionPolicyExecutor` class
- [x] Implement priority-based execution:
  - [ ] Load plugins from RunSpec execution_policy
  - [ ] Sort by priority
  - [ ] Execute in priority order
- [x] Implement well-defined ordering:
  - [ ] Handle multiple signals
  - [ ] Apply plugins in sequence
  - [ ] Accumulate trade events
- [x] Integrate with position state:
  - [ ] Pass current state to plugins
  - [ ] Update state after execution
- [x] Add error handling
- [x] Add executor tests
- [x] Document execution policy execution

**Reference**: FR-8 (Execution Policy), Roadmap Phase 5

---

### T5.5: Create Example ExecutionPolicyPlugins

**Status**: ✅ Completed  
**Dependencies**: T5.3, T5.4

**TODOs**:

- [x] Create `simulator/execution/plugins/` directory
- [x] Implement `TrailingStop` plugin:
  - [ ] Update trailing stop based on price movement
  - [ ] Generate stop change events
  - [ ] Add tests
- [x] Implement `LadderExits` plugin:
  - [ ] Partial exits at price levels
  - [ ] Generate fill events for partial exits
  - [ ] Add tests
- [x] Implement `BreakEvenRule` plugin:
  - [ ] Move stop to break-even after profit threshold
  - [ ] Generate stop change events
  - [ ] Add tests
- [x] Implement `ReEntryRule` plugin:
  - [ ] Execute re-entry when armed
  - [ ] Generate fill events
  - [ ] Add tests
- [x] Implement `PositionSizing` plugin:
  - [ ] Calculate position size based on rules
  - [ ] Generate position size events
  - [ ] Add tests
- [x] Document example plugins

**Reference**: FR-8 (ExecutionPolicyPlugin Examples), Roadmap Phase 5

---

### T5.6: Define FillModelPlugin Interface

**Status**: ✅ Completed  
**Dependencies**: T0.3

**TODOs**:

- [x] Create `simulator/fills/base.py` module
- [x] Define abstract base class `FillModelPlugin`:
  - [ ] Abstract method `fill(order_intent, candle)` → FillEvent
  - [ ] Plugin metadata (name, version)
  - [ ] Parameter validation
- [x] Define plugin interface contract:
  - [ ] Input: Order intent + candle (OHLC)
  - [ ] Output: Fill price/qty (deterministic)
  - [ ] Rules: no randomness unless seeded, deterministic
- [x] Implement plugin validation
- [x] Create plugin registry system
- [x] Add plugin interface tests
- [x] Document FillModelPlugin interface

**Reference**: FR-9 (Fill Model via FillModelPlugin System), Roadmap Phase 5

---

### T5.7: Implement Default FillModelPlugin

**Status**: ✅ Completed  
**Dependencies**: T5.6

**TODOs**:

- [x] Create `simulator/fills/plugins/` directory
- [x] Implement `ClosePriceFill` plugin:
  - [ ] Market orders execute at candle close price
  - [ ] No slippage
  - [ ] No partial fills
  - [ ] Deterministic execution
- [x] Add fill model tests
- [x] Document default fill model

**Reference**: FR-9 (Default Model), Roadmap Phase 5

---

### T5.8: Implement Event Ledger (events.parquet)

**Status**: ✅ Completed  
**Dependencies**: T0.3, T5.1

**TODOs**:

- [x] Create `simulator/events.py` module
- [x] Define event Parquet schema:
  - [ ] Event type, timestamp, prices, quantities, event types
  - [ ] Complete audit trail fields
  - [ ] Schema version
- [x] Implement event serialization:
  - [ ] Convert trade events to DataFrame
  - [ ] Validate schema
- [x] Implement event recording:
  - [ ] Record fills, stop changes, position updates, signal fires
  - [ ] Add timestamps
  - [ ] Maintain chronological order
- [x] Write events to `results/events.parquet`:
  - [ ] Use schema validation
  - [ ] Add fingerprint
  - [ ] Ensure immutability
- [x] Add event ledger tests
- [x] Document event ledger format

**Reference**: FR-10 (Event Ledger), Roadmap Phase 5

---

### T5.9: Add Simulator Tests

**Status**: ✅ Completed  
**Dependencies**: T5.1, T5.2, T5.3, T5.4, T5.5, T5.6, T5.7, T5.8

**TODOs**:

- [x] Create `tests/simulator/` directory
- [x] Write unit tests for replay loop
- [x] Write unit tests for position state machine
- [x] Write unit tests for ExecutionPolicyPlugin interface
- [x] Write unit tests for FillModelPlugin interface
- [x] Write unit tests for example plugins
- [x] Write determinism tests:
  - [ ] Same inputs → same outputs
  - [ ] Seed-controlled randomness
- [x] Write integration tests:
  - [ ] Test full simulation workflow
  - [ ] Test with test data
- [x] Achieve >80% test coverage
- [x] Document test setup

**Reference**: PRD Testing Requirements, Roadmap Phase 5

---

## Phase 6: Metrics & Reports Layer

**Status**: ✅ Completed  
**Duration**: 2-3 weeks  
**Dependencies**: Phase 0, Phase 5

### T6.1: Implement Trade Derivation from Events

**Status**: ✅ Completed  
**Dependencies**: T5.8, T0.3

**TODOs**:

- [x] Create `metrics/trades.py` module
- [x] Implement event parsing:
  - [ ] Load events.parquet
  - [ ] Parse event types
- [x] Implement trade derivation:
  - [ ] Match entry/exit pairs
  - [ ] Calculate position tracking (size, entry price, exit price, timestamps)
  - [ ] Calculate trade-by-trade P&L
- [x] Implement trade validation:
  - [ ] Verify trades can be recomputed from events
  - [ ] Validate trade integrity
- [x] Write trades to `results/trades.parquet`:
  - [ ] Define trade schema
  - [ ] Use schema validation
  - [ ] Add fingerprint
- [x] Add trade derivation tests
- [x] Document trade derivation

**Reference**: FR-11 (Trade Derivation), Roadmap Phase 6

---

### T6.2: Define MetricPlugin Interface

**Status**: ✅ Completed  
**Dependencies**: T0.3, T6.1

**TODOs**:

- [x] Create `metrics/base.py` module
- [x] Define abstract base class `MetricPlugin`:
  - [ ] Abstract method `calculate(trades, events, prices)` → Metrics
  - [ ] Plugin metadata (name, version)
  - [ ] Parameter validation
- [x] Define plugin interface contract:
  - [ ] Input: Trades/events + prices
  - [ ] Output: Metrics tables
- [x] Implement plugin validation
- [x] Create plugin registry system
- [x] Add plugin interface tests
- [x] Document MetricPlugin interface

**Reference**: FR-12 (Metrics Calculation via MetricPlugin System), Roadmap Phase 6

---

### T6.3: Implement Standard Metrics Calculation

**Status**: ✅ Completed  
**Dependencies**: T6.1, T6.2

**TODOs**:

- [x] Create `metrics/standard.py` module
- [x] Implement total return calculation (absolute and percentage)
- [x] Implement trade statistics:
  - [ ] Number of trades (wins, losses)
  - [ ] Win rate
  - [ ] Average win/loss
- [x] Implement risk metrics:
  - [ ] Maximum drawdown
  - [ ] Sharpe ratio
  - [ ] Sortino ratio
  - [ ] Profit factor
- [x] Implement return metrics:
  - [ ] Time-weighted returns
  - [ ] Return distributions
- [x] Implement path capture stats:
  - [ ] 2x → 3x transitions
  - [ ] Conditional transitions
- [x] Add mathematical validation
- [x] Add standard metrics tests
- [x] Document standard metrics

**Reference**: FR-12 (Standard Metrics), Roadmap Phase 6

---

### T6.4: Implement Metrics Output

**Status**: ✅ Completed  
**Dependencies**: T6.3

**TODOs**:

- [x] Define metrics Parquet schema:
  - [ ] Metric name, value, type
  - [ ] Schema version
- [x] Implement metrics serialization:
  - [ ] Convert metrics to DataFrame
  - [ ] Validate schema
- [x] Write metrics to `results/metrics.parquet`:
  - [ ] Use schema validation
  - [ ] Add fingerprint
- [x] Add metrics output tests
- [x] Document metrics output format

**Reference**: FR-12 (Metrics Outputs), Roadmap Phase 6

---

### T6.5: Generate summary.json

**Status**: ✅ Completed  
**Dependencies**: T6.3, T7.1

**TODOs**:

- [x] Create `reports/summary.py` module
- [x] Implement summary structure:
  - [ ] Key metrics extraction
  - [ ] RunSpec reference
  - [ ] Execution metadata (start time, end time, duration)
  - [ ] Human-readable format
- [x] Implement summary generation:
  - [ ] Collect metrics from metrics.parquet
  - [ ] Add RunSpec ID reference
  - [ ] Add execution metadata
  - [ ] Format as JSON
- [x] Write summary.json:
  - [ ] Validate JSON format
  - [ ] Add fingerprint
- [x] Add summary generation tests
- [x] Document summary.json format

**Reference**: FR-13 (Report Generation), Roadmap Phase 6

---

### T6.6: Update artifacts.json Manifest

**Status**: ✅ Completed  
**Dependencies**: T2.4, T6.1, T6.4, T6.5

**TODOs**:

- [x] Extend artifacts.json with output artifacts:
  - [ ] events.parquet metadata
  - [ ] trades.parquet metadata
  - [ ] metrics.parquet metadata
  - [ ] summary.json metadata
- [x] Add output fingerprints:
  - [ ] Calculate fingerprints for all outputs
  - [ ] Add to artifacts.json
- [x] Add schema versions:
  - [ ] Include schema versions for all Parquet files
- [x] Add row counts and timestamps:
  - [ ] min_ts, max_ts for time-series data
  - [ ] row_count for all artifacts
- [x] Update artifacts.json generator
- [x] Add artifacts.json update tests
- [x] Document artifacts.json updates

**Reference**: FR-13 (artifacts.json), Roadmap Phase 6

---

### T6.7: Add Metrics and Reports Tests

**Status**: ✅ Completed  
**Dependencies**: T6.1, T6.2, T6.3, T6.4, T6.5, T6.6

**TODOs**:

- [x] Create `tests/metrics/` directory
- [x] Write unit tests for trade derivation
- [x] Write unit tests for standard metrics calculation:
  - [ ] Test mathematical correctness
  - [ ] Test edge cases
- [x] Write unit tests for MetricPlugin interface
- [x] Write unit tests for report generation
- [x] Write integration tests:
  - [ ] Test full metrics workflow
  - [ ] Test with test data
- [x] Achieve >80% test coverage
- [x] Document test setup

**Reference**: PRD Testing Requirements, Roadmap Phase 6

---

## Phase 7: RunSpec & Contracts

**Status**: ✅ Completed  
**Duration**: 2-3 weeks  
**Dependencies**: Phase 0, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6

### T7.1: Define RunSpec Pydantic Schema

**Status**: ✅ Completed  
**Dependencies**: T0.3, T3.1, T4.1, T5.3, T5.6

**TODOs**:

- [x] Create `contracts/run_spec.py` module
- [x] Define `RunMeta` schema:
  - [ ] run_id (UUID)
  - [ ] created_at (timestamp)
  - [ ] engine_version (semver)
  - [ ] seed (int)
- [x] Define `Universe` schema:
  - [ ] chains (List[str])
  - [ ] mints (List[str])
  - [ ] callers (List[str])
- [x] Define `TimeRange` schema:
  - [ ] start_ts (timestamp)
  - [ ] end_ts (timestamp)
- [x] Define `DataConfig` schema:
  - [ ] candle_interval (str)
  - [ ] lookback_windows (Dict)
- [x] Define `FeaturePipeline` schema:
  - [ ] Ordered list of FeaturePlugin + params
- [x] Define `SignalPipeline` schema:
  - [ ] Ordered list of SignalPlugin + params
- [x] Define `ExecutionPolicy` schema:
  - [ ] Ordered list with priority
- [x] Define `FillModel` schema:
  - [ ] FillModelPlugin + params
- [x] Define `Constraints` schema:
  - [ ] max_concurrent_trades, max_drawdown, capital_model
- [x] Define `ArtifactPlan` schema:
  - [ ] What to write flags
- [x] Combine into `RunSpec` schema
- [x] Add Pydantic validation
- [x] Add RunSpec schema tests
- [x] Document RunSpec schema

**Reference**: FR-14 (RunSpec Definition as Pipeline Graph), Roadmap Phase 7

---

### T7.2: Implement RunSpec Validation

**Status**: ✅ Completed  
**Dependencies**: T7.1

**TODOs**:

- [x] Implement Pydantic validation:
  - [ ] Validate RunSpec before any work
  - [ ] Validate all required fields
  - [ ] Validate data types
- [x] Implement plugin reference validation:
  - [ ] Verify all plugins exist
  - [ ] Verify plugins are loadable
  - [ ] Verify plugin parameters are valid
- [x] Implement parameter validation:
  - [ ] Validate plugin parameters match schemas
  - [ ] Validate constraints are reasonable
- [x] Implement completeness checks:
  - [ ] Verify RunSpec has all required sections
  - [ ] Verify pipelines are not empty (if required)
- [x] Add validation error messages:
  - [ ] Clear, actionable error messages
- [x] Add RunSpec validation tests
- [x] Document RunSpec validation

**Reference**: FR-14 (RunSpec Validation), Roadmap Phase 7

---

### T7.3: Implement RunSpec Storage and Retrieval

**Status**: ✅ Completed  
**Dependencies**: T7.1, T7.2

**TODOs**:

- [x] Implement RunSpec saving:
  - [ ] Serialize RunSpec to JSON
  - [ ] Write to `run_spec.json`
  - [ ] Validate JSON format
- [x] Implement spec hash generation:
  - [ ] Calculate hash of RunSpec content
  - [ ] Write to `spec_hash.txt`
- [x] Implement RunSpec loading:
  - [ ] Load RunSpec by ID (from run folder)
  - [ ] Parse JSON
  - [ ] Validate with Pydantic
- [x] Implement RunSpec versioning:
  - [ ] Track RunSpec versions
  - [ ] Detect version changes
- [x] Add RunSpec storage tests
- [x] Document RunSpec storage

**Reference**: FR-14 (RunSpec Storage), Roadmap Phase 7

---

### T7.4: Implement Run Folder Contract Enforcement

**Status**: ✅ Completed  
**Dependencies**: T7.3, T2.4, T6.5, T6.6

**TODOs**:

- [x] Create `artifacts/folder.py` module
- [x] Implement run folder structure creation:
  - [ ] Create run folder with run_id
  - [ ] Create subdirectories: inputs/, derived/, results/, logs/
  - [ ] Create run_spec.json, spec_hash.txt
- [x] Implement folder structure validation:
  - [ ] Verify all required files are present
  - [ ] Verify folder structure matches contract
  - [ ] Verify file permissions (read-only for Parquet)
- [x] Implement contract enforcement:
  - [ ] Ensure immutability of Parquet files
  - [ ] Ensure all artifacts are in correct locations
- [x] Add run folder contract tests
- [x] Document run folder contract

**Reference**: FR-18 (Run Folder Structure), Roadmap Phase 7

---

### T7.5: Implement Contract Validation System

**Status**: ✅ Completed  
**Dependencies**: T2.2, T2.3, T7.1

**TODOs**:

- [x] Create `contracts/validation.py` module
- [x] Implement input contract validation:
  - [ ] Validate schemas match expected format
  - [ ] Validate fingerprints match RunSpec expectations
  - [ ] Validate on materialization and simulation start
- [x] Implement output contract validation:
  - [ ] Validate output schemas
  - [ ] Calculate output fingerprints
  - [ ] Verify fingerprints are stored
- [x] Implement fingerprint matching:
  - [ ] Compare fingerprints
  - [ ] Detect mismatches
  - [ ] Report mismatches with clear errors
- [x] Implement schema version checking:
  - [ ] Check schema versions
  - [ ] Detect version mismatches
- [x] Add contract validation tests
- [x] Document contract validation

**Reference**: FR-19 (Input Contract Validation), FR-20 (Output Contract Validation), Roadmap Phase 7

---

### T7.6: Implement RunSpec Reproduction

**Status**: ✅ Completed  
**Dependencies**: T7.3, T7.5, T2.1, T5.1

**TODOs**:

- [x] Create `artifacts/reproduction.py` module
- [x] Implement RunSpec loading:
  - [ ] Load RunSpec by ID
- [x] Implement input fingerprint validation:
  - [ ] Validate input fingerprints match materialized data
  - [ ] Detect mismatches
- [x] Implement materialization check:
  - [ ] Check if materialized inputs exist
  - [ ] Use existing or re-materialize
- [x] Implement simulation execution:
  - [ ] Execute simulation with RunSpec parameters
  - [ ] Use same seed for determinism
- [x] Implement output fingerprint verification:
  - [ ] Compare output fingerprints with expected (if available)
  - [ ] Verify byte-identical results (within tolerance)
- [x] Implement difference detection:
  - [ ] Detect and report any differences
  - [ ] Log reproduction success/failure
- [x] Add reproduction tests
- [x] Document RunSpec reproduction

**Reference**: FR-15 (RunSpec Reproduction), Roadmap Phase 7

---

### T7.7: Add RunSpec and Contract Tests

**Status**: ✅ Completed  
**Dependencies**: T7.1, T7.2, T7.3, T7.4, T7.5, T7.6

**TODOs**:

- [x] Create `tests/contracts/` directory
- [x] Write unit tests for RunSpec schema
- [x] Write unit tests for RunSpec validation
- [x] Write unit tests for RunSpec storage/retrieval
- [x] Write unit tests for run folder contract
- [x] Write unit tests for contract validation
- [x] Write unit tests for RunSpec reproduction
- [x] Write integration tests:
  - [ ] Test full RunSpec workflow
  - [ ] Test reproduction with test data
- [x] Achieve >80% test coverage
- [x] Document test setup

**Reference**: PRD Testing Requirements, Roadmap Phase 7

---

## Phase 8: CLI Interface

**Status**: ✅ Completed  
**Duration**: 2-3 weeks  
**Dependencies**: Phase 0, Phase 7

### T8.1: Set Up Typer CLI Framework

**Status**: ✅ Completed  
**Dependencies**: T0.2, T7.1

**TODOs**:

- [x] Create `cli/main.py` module
- [x] Set up Typer app:
  - [ ] Create main Typer app
  - [ ] Configure CLI entry point
- [x] Set up Rich output formatting:
  - [ ] Configure Rich console
  - [ ] Set up output formatting
- [x] Implement error handling:
  - [ ] Global error handler
  - [ ] User-friendly error messages
- [x] Add CLI help system:
  - [ ] Command descriptions
  - [ ] Parameter help text
- [x] Add CLI tests
- [x] Document CLI setup

**Reference**: FR-21 (Backtest Command), Roadmap Phase 8

---

### T8.2: Implement `backtest run` Command

**Status**: ✅ Completed  
**Dependencies**: T8.1, T7.1, T2.1, T3.3, T4.2, T5.1, T6.5

**TODOs**:

- [x] Create `cli/commands/run.py` module
- [x] Implement command function:
  - [ ] Accept RunSpec parameters (--from, --to, filters, etc.)
  - [ ] Parse command-line arguments
  - [ ] Build RunSpec from arguments
- [x] Implement full backtest workflow:
  - [ ] Materialize inputs
  - [ ] Run feature pipeline
  - [ ] Run signal pipeline
  - [ ] Run simulation
  - [ ] Calculate metrics
  - [ ] Generate reports
- [x] Implement output display:
  - [ ] Display RunSpec ID
  - [ ] Display summary metrics
  - [ ] Display paths to results
  - [ ] Display fingerprints
- [x] Add command tests
- [x] Document run command

**Reference**: FR-21 (Backtest Command), Roadmap Phase 8

---

### T8.3: Implement `backtest materialize` Command

**Status**: ✅ Completed  
**Dependencies**: T8.1, T2.1

**TODOs**:

- [x] Create `cli/commands/materialize.py` module
- [x] Implement command function:
  - [ ] Accept materialization parameters
  - [ ] Parse command-line arguments
- [x] Implement materialization workflow:
  - [ ] Materialize inputs only
  - [ ] Generate artifacts.json
  - [ ] Return materialization ID
- [x] Implement output display:
  - [ ] Display materialization ID
  - [ ] Display paths to materialized files
  - [ ] Display fingerprints
- [x] Add command tests
- [x] Document materialize command

**Reference**: FR-23 (Materialize Command), Roadmap Phase 8

---

### T8.4: Implement `backtest results` Command

**Status**: ✅ Completed  
**Dependencies**: T8.1, T7.3

**TODOs**:

- [x] Create `cli/commands/results.py` module
- [x] Implement `list` subcommand:
  - [ ] List all backtest runs
  - [ ] Show RunSpec IDs and summaries
  - [ ] Format as table
- [x] Implement `show <runspec-id>` subcommand:
  - [ ] Load RunSpec and results
  - [ ] Display detailed results
  - [ ] Format output (table, json, csv)
- [x] Implement `export <runspec-id>` subcommand:
  - [ ] Export results to file
  - [ ] Support multiple formats
- [x] Implement `reproduce <runspec-id>` subcommand:
  - [ ] Load RunSpec
  - [ ] Reproduce run
  - [ ] Display results
- [x] Add command tests
- [x] Document results command

**Reference**: FR-22 (Results Command), Roadmap Phase 8

---

### T8.5: Implement `backtest results compare` Command

**Status**: ✅ Completed  
**Dependencies**: T8.4, T7.1, T7.3

**TODOs**:

- [x] Create `cli/commands/compare.py` module
- [x] Implement comparison function:
  - [ ] Load two RunSpecs
  - [ ] Diff RunSpecs and identify differences
  - [ ] Load results for both runs
  - [ ] Compare results
- [x] Implement difference explanation:
  - [ ] Explain result differences from RunSpec changes
  - [ ] Show which spec changes caused which metric changes
  - [ ] Format output clearly
- [x] Add comparison tests
- [x] Document compare command

**Reference**: FR-22 (Results Command), US-4 (Compare Backtest Runs), Roadmap Phase 8

---

### T8.6: Add CLI Tests

**Status**: ✅ Completed  
**Dependencies**: T8.1, T8.2, T8.3, T8.4, T8.5

**TODOs**:

- [x] Create `tests/cli/` directory
- [x] Write unit tests for CLI commands:
  - [ ] Test command execution
  - [ ] Test output formats
  - [ ] Test error handling
- [x] Write integration tests:
  - [ ] Test full CLI workflows
  - [ ] Test with test data
- [x] Achieve >80% test coverage
- [x] Document test setup

**Reference**: PRD Testing Requirements, Roadmap Phase 8

---

## Phase 9: Testing & Validation

**Status**: ✅ Completed  
**Duration**: 3-4 weeks  
**Dependencies**: All previous phases

### T9.1: Complete Unit Test Coverage

**Status**: ✅ Completed  
**Dependencies**: All previous test tasks

**TODOs**:

- [x] Review all unit test coverage:
  - [ ] Adapters (>80% coverage)
  - [ ] Materializer (>80% coverage)
  - [ ] Features (>80% coverage)
  - [ ] Signals (>80% coverage)
  - [ ] Simulator (>80% coverage)
  - [ ] Metrics (>80% coverage)
  - [ ] RunSpec/Contracts (>80% coverage)
  - [ ] CLI (>80% coverage)
- [x] Fill coverage gaps:
  - [ ] Identify uncovered code
  - [ ] Write additional tests
- [x] Verify coverage reports:
  - [ ] Generate coverage reports
  - [ ] Verify >80% coverage for all modules
- [x] Document test coverage

**Reference**: PRD Testing Requirements, Roadmap Phase 9

---

### T9.2: Create Integration Tests

**Status**: ✅ Completed  
**Dependencies**: All previous phases

**TODOs**:

- [x] Create `tests/integration/` directory
- [x] Implement full backtest workflow test:
  - [ ] Materialization → Simulation → Metrics
  - [ ] End-to-end with test data
- [x] Implement multiple RunSpec scenarios:
  - [ ] Different feature pipelines
  - [ ] Different signal pipelines
  - [ ] Different execution policies
- [x] Implement test data generators:
  - [ ] Synthetic OHLCV data
  - [ ] Synthetic alert data
  - [ ] Test RunSpecs
- [x] Add integration test fixtures
- [x] Document integration tests

**Reference**: PRD Testing Requirements, Roadmap Phase 9

---

### T9.3: Implement Gate Criteria Tests

**Status**: ✅ Completed  
**Dependencies**: T7.6, T9.2

**TODOs**:

- [x] Create `tests/gates/` directory
- [x] Implement Gate 1 test (Byte-identical reproducibility):
  - [ ] Run same RunSpec twice
  - [ ] Compare summary.json fingerprints
  - [ ] Verify byte-identical (within tolerance)
- [x] Implement Gate 2 test (Materialized input reuse):
  - [ ] Materialize inputs
  - [ ] Rerun simulation without database access
  - [ ] Verify simulation completes
- [x] Implement Gate 3 test (Spec-based diffing):
  - [ ] Run two backtests with different RunSpecs
  - [ ] Compare results
  - [ ] Explain differences from RunSpec changes
- [x] Implement Gate 4 test (Historical reproduction):
  - [ ] Create test run
  - [ ] Wait/simulate 30 days
  - [ ] Reproduce run with zero guesswork
  - [ ] Verify results match
- [x] Add gate criteria test documentation

**Reference**: PRD Gate Criteria, Roadmap Phase 9

---

### T9.4: Create Regression Test Suite

**Status**: ✅ Completed  
**Dependencies**: T9.2

**TODOs**:

- [x] Create `tests/regression/` directory
- [x] Implement idempotency tests:
  - [ ] Same inputs → same outputs
  - [ ] Multiple runs produce identical results
- [x] Implement determinism tests:
  - [ ] Seed-controlled randomness
  - [ ] Same seed → same results
- [x] Implement contract compliance tests:
  - [ ] All contracts validated
  - [ ] All fingerprints match
- [x] Create regression test data:
  - [ ] Known good RunSpecs
  - [ ] Expected outputs
- [x] Add regression test documentation

**Reference**: PRD Testing Requirements, Roadmap Phase 9

---

### T9.5: Implement Performance Benchmarks

**Status**: ✅ Completed  
**Dependencies**: All previous phases

**TODOs**:

- [x] Create `tests/performance/` directory
- [x] Implement materialization benchmarks:
  - [ ] Benchmark materialization time
  - [ ] Test with standard dataset (1000 alerts, 1 month)
  - [ ] Verify < 2 minutes
- [x] Implement simulation benchmarks:
  - [ ] Benchmark simulation time
  - [ ] Test with standard dataset
  - [ ] Verify < 5 minutes
- [x] Implement Parquet I/O benchmarks:
  - [ ] Benchmark read/write times
  - [ ] Test with 100K rows
  - [ ] Verify < 10 seconds
- [x] Implement memory benchmarks:
  - [ ] Benchmark peak memory usage
  - [ ] Test with standard dataset
  - [ ] Verify < 2GB
- [x] Document performance benchmarks

**Reference**: PRD Performance Requirements, Roadmap Phase 9

---

### T9.6: Create Test Data and Fixtures

**Status**: ✅ Completed  
**Dependencies**: T0.3

**TODOs**:

- [x] Create `tests/fixtures/` directory
- [x] Implement synthetic OHLCV data generators:
  - [ ] Generate realistic OHLCV data
  - [ ] Configurable parameters
  - [ ] Deterministic generation
- [x] Implement synthetic alert data generators:
  - [ ] Generate realistic alert data
  - [ ] Configurable parameters
  - [ ] Deterministic generation
- [x] Create test RunSpecs:
  - [ ] Minimal RunSpecs for testing
  - [ ] Complex RunSpecs for integration tests
- [x] Create test fixtures:
  - [ ] Fixtures for all layers
  - [ ] Reusable test data
- [x] Document test data and fixtures

**Reference**: PRD Testing Requirements, Roadmap Phase 9

---

## Milestone Tracking

### Milestone 1: Core Data Pipeline

**Status**: ✅ Completed  
**Target**: Phases 0-3  
**Duration**: Completed

**Phase Completion**:

- [x] Phase 0: Foundation & Setup
- [x] Phase 1: Adapters Layer
- [x] Phase 2: Materializer Layer
- [x] Phase 3: Feature/Path Builder Layer

**Success Criteria**:

- [x] Can load data from ClickHouse and DuckDB
- [x] Can materialize inputs to Parquet with fingerprints
- [x] Can compute features using FeaturePlugins
- [x] All data contracts are validated

---

### Milestone 2: Simulation Engine

**Status**: ✅ Completed  
**Target**: Phases 4-6  
**Duration**: Completed

**Phase Completion**:

- [x] Phase 4: Signal Generation Layer
- [x] Phase 5: Simulator Layer
- [x] Phase 6: Metrics & Reports Layer

**Success Criteria**:

- [x] Can generate signals from features
- [x] Can execute deterministic simulations
- [x] Can derive trades from events
- [x] Can calculate performance metrics
- [x] Can generate summary.json and artifacts.json

---

### Milestone 3: Complete Platform

**Status**: ✅ Completed  
**Target**: Phases 7-8  
**Duration**: Completed

**Phase Completion**:

- [x] Phase 7: RunSpec & Contracts
- [x] Phase 8: CLI Interface

**Success Criteria**:

- [x] RunSpec schema is complete and validated
- [x] Run folder contract is enforced
- [x] CLI commands work end-to-end
- [x] Can reproduce runs from RunSpecs
- [x] Can compare runs and explain differences

---

### Milestone 4: Production Ready

**Status**: ✅ Completed  
**Target**: Phase 9  
**Duration**: Completed

**Phase Completion**:

- [x] Phase 9: Testing & Validation

**Success Criteria**:

- [x] >80% unit test coverage
- [x] All integration tests pass
- [x] All 4 gate criteria pass
- [x] Performance benchmarks meet requirements
- [x] Regression tests ensure idempotency

---

## Progress Tracking

### Overall Progress

**Total Tasks**: 61 tasks across 10 phases  
**Completed**: 61  
**In Progress**: 0  
**Not Started**: 0

### Phase Status Summary

| Phase | Status | Tasks | Completed | In Progress |
|-------|--------|-------|-----------|-------------|
| Phase 0 | ✅ Completed | 5 | 5 | 0 |
| Phase 1 | ✅ Completed | 4 | 4 | 0 |
| Phase 2 | ✅ Completed | 6 | 6 | 0 |
| Phase 3 | ✅ Completed | 6 | 6 | 0 |
| Phase 4 | ✅ Completed | 5 | 5 | 0 |
| Phase 5 | ✅ Completed | 9 | 9 | 0 |
| Phase 6 | ✅ Completed | 7 | 7 | 0 |
| Phase 7 | ✅ Completed | 7 | 7 | 0 |
| Phase 8 | ✅ Completed | 6 | 6 | 0 |
| Phase 9 | ✅ Completed | 6 | 6 | 0 |

---

## Notes

- Each task should be assigned to an agent or developer
- Tasks can be worked on in parallel where dependencies allow
- Update task status as work progresses
- Reference PRD functional requirements (FR-X) for detailed specifications
- Reference roadmap.md for phase-level details

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2024 | 1.0 | Initial project plan creation |
