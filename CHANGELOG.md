# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added - Parquet Lake v1 Slice Exporter

- **Parquet Lake v1 Implementation**: Complete implementation of Parquet Lake v1 spec for deterministic, scalable data exports
  - **Python Core Functions** (`tools/backtest/lib/slice_exporter.py`):
    - `compute_mint_bucket()` - SHA-1 bucket partitioning (00..ff) to prevent directory explosion
    - `floor_to_interval()` - Timestamp flooring to interval boundaries
    - `compute_window_slice()` - Window slice calculation around alerts
    - `parse_window_spec()` - Window spec parser (e.g., "pre52_post4948")
    - `interval_to_seconds()` - Interval string converter
  - **ClickHouse Query + Parquet Write**:
    - `_build_lake_query()` - ClickHouse query builder for OHLCV data
    - `_write_partitioned_parquet()` - Bucket-partitioned Parquet writer with deterministic naming
    - Supports compression (zstd, snappy, none)
    - Deterministic file naming (part-0000, part-0001, ...)
  - **Coverage Tracking + Manifest Sealing**:
    - `compute_coverage()` - Per-alert coverage metrics (available_pre, available_post, available_total)
    - `_write_coverage_parquet()` - Coverage metrics export
    - `write_manifest_json()` - Atomic manifest write (temp file + rename)
    - `export_lake_run_slices()` - Main entry point for run-scoped exports
  - **TypeScript Service** (`packages/infra/src/storage/services/lake-exporter-service.ts`):
    - `LakeExporterService` - Thin wrapper around PythonEngine
    - Zod schemas for config and result validation
    - Error handling and logging
  - **CLI Integration**:
    - `quantbot lake export-run-slices` command
    - Handler: `exportRunSlicesLakeHandler`
    - Auto-generates run_id if not provided
    - Reads ClickHouse config from environment variables
  - **Python Entry Point** (`tools/lake/export_lake_run_slices.py`):
    - Reads config from stdin (JSON)
    - Calls `export_lake_run_slices()` function
    - Returns result as JSON
  - **Testing**: Comprehensive test suite
    - 26 Python unit tests (bucket, window, coverage, manifest)
    - 3 TypeScript service tests
    - 3 CLI handler tests
    - All tests passing

- **Slice Export & Analyze Workflow - Phase 4: Dataset Expansion** ✅ Complete
  - **Dataset Registry** (`packages/storage/src/adapters/dataset-registry.ts`):
    - Centralized registry for all supported datasets in slice export system
    - Supports both candle datasets (OHLCV) and indicator datasets
    - Conditional dataset support (checks ClickHouse table existence)
    - `DatasetRegistry` class with `get()`, `getAll()`, `getByType()`, `isAvailable()`, `getAvailable()` methods
  - **Dataset Support**:
    - `candles_5m` dataset registered with correct metadata (interval: '5m', tableName: 'ohlcv_candles')
    - `indicators_1m` conditional dataset registered (checks for `indicator_values` table existence)
    - All datasets: `candles_1s`, `candles_15s`, `candles_1m`, `candles_5m`, `indicators_1m`
  - **Adapter Integration**:
    - `ClickHouseSliceExporterAdapterImpl` uses `datasetRegistry.get()` for dataset lookup
    - Conditional dataset checking via `datasetRegistry.isAvailable()` before querying
    - Error messages list available datasets when unsupported dataset requested
  - **Testing**: Comprehensive test coverage
    - 15 unit tests for dataset registry (registration, lookup, conditional availability)
    - 6 property tests for registry invariants (determinism, consistency, availability checks)
    - All tests passing

### Added - Event Log + Derived Index Architecture

- **Event Log Infrastructure**: Implemented append-only event log pattern to eliminate DuckDB locking conflicts
  - `tools/ledger/event_writer.py` - Atomic append event writer with day partitioning
  - `tools/ledger/schema_registry.py` - Event schema validation and versioning
  - `tools/ledger/emit_event.py` - CLI script for event emission
  - Event types: `run.created`, `run.started`, `run.completed`, `phase.started`, `phase.completed`, `trial.recorded`, `baseline.completed`, `artifact.created`

- **TypeScript Event Emission**: Event emitter integrated into backtest handlers
  - `packages/backtest/src/events/event-emitter.ts` - TypeScript event emitter using PythonEngine pattern
  - Integrated event emission into `runPathOnly` (run lifecycle + phase events)
  - Integrated event emission into `runPolicyBacktest` (trials + phase events)

- **DuckDB Indexer**: Rebuildable index from event log
  - `tools/ledger/indexer.py` - Rebuilds DuckDB tables from event log
  - `tools/ledger/rebuild_index.py` - CLI for on-demand indexing
  - `tools/ledger/index_daemon.py` - Periodic sync daemon (30s interval)
  - Materialized views: `latest_runs`, `run_phase_summary`

- **Dual Mode Migration**: Legacy compatibility adapter
  - `packages/backtest/src/adapters/legacy-duckdb-adapter.ts` - Dual mode adapter for legacy DuckDB + event log union queries
  - Migration cutover date: 2026-01-23

- **Artifact Management**: Structured artifact directory management
  - `packages/backtest/src/artifacts/index.ts` - Run directory creation and artifact writing

- **Testing**: Unit and integration tests
  - `tools/ledger/tests/test_event_writer.py` - Event writer tests
  - `tools/ledger/tests/test_indexer.py` - Indexer tests
  - `packages/backtest/src/events/event-emitter.test.ts` - Event emitter tests
  - `packages/backtest/src/events/__tests__/event-log.integration.test.ts` - Integration tests

- **Documentation**: Migration guide and architecture documentation
  - `docs/architecture/EVENT_LOG_MIGRATION.md` - Complete migration guide
  - `docs/architecture/EVENT_LOG_IMPLEMENTATION_SUMMARY.md` - Implementation summary

### Changed

- `packages/backtest/src/runPathOnly.ts` - Added event emission for run lifecycle and phases
- `packages/backtest/src/runPolicyBacktest.ts` - Added event emission for run lifecycle, phases, and trials

### Benefits

- **No locking conflicts**: Events are append-only JSONL (concurrent-safe)
- **Rebuildable**: DuckDB corruption? Rebuild from log
- **Auditable**: Full event history for debugging
- **Scalable**: Parquet artifacts for heavy data
- **Simple**: One writer (indexer), many readers
- **Deterministic**: Replay events → same index

## [Unreleased]

### Added

- **Web Lab UI - Complete Implementation** - Full-featured web interface for backtesting, optimization, and strategy management
  - **Strategy Management UI** (Phase VIII Task 8.1):
    - Strategy list with filtering by type (ladder, trailing, indicator)
    - Search functionality across strategy names and IDs
    - Strategy editor with live JSON validation and preview
    - Strategy comparison view (side-by-side diff of up to 3 strategies)
    - Strategy CRUD operations (create, read, update, delete)
    - Visual badges for strategy types
  - **Optimization UI** (Phase VIII Task 8.2):
    - Grid search and random search configuration interface
    - Parameter grid builder (TP/SL multiples, time stops, trail activation)
    - Constraint configuration (min win rate, max drawdown, min avg R, min trades)
    - Active optimization runs tracker with real-time progress
    - Optimization results table (sortable by objective score, avg R, win rate, profit factor)
    - Export results to CSV/JSON
    - Parameter heatmap visualization (coming soon)
  - **Equity Curve & Capital-Aware Simulation** (Phase VIII Task 8.3):
    - Python equity curve computation (`tools/backtest/lib/equity_curve.py`)
    - Capital-aware backtesting with position sizing (fixed USD or % of equity)
    - Interactive equity curve chart (Chart.js with zoom/pan)
    - Drawdown chart with period highlighting
    - Portfolio metrics dashboard (final capital, total PnL, max DD, Sharpe, win rate)
    - Trade log table with entry/exit details
    - Drawdown periods table with recovery tracking
  - **Profitable Strategy Finder** (Phase VIII Task 8.4):
    - Enhanced leaderboard with objective score sorting
    - Caller-strategy performance matrix (cross-tabulation view)
    - Python robustness scorer (`tools/backtest/lib/robustness_scorer.py`)
    - Walk-forward validation metrics
    - Degradation analysis (in-sample vs out-of-sample)
    - Consistency scoring across time periods
  - **Navigation**: Unified navigation bar across all views (Strategies, Runs, Leaderboard, Truth, Policies, Optimize, Governance, Journal)
  - **Styling**: Dark theme with consistent color scheme, metric cards, badges, and responsive layouts

- **Python/TypeScript Separation Rules** - Mandatory architectural pattern for data science work
  - **Rule document**: `.cursor/rules/50-python-typescript-separation.mdc`
  - **Python responsibilities**: Optimization algorithms, trade simulation, metrics calculation, equity curves, visualization, data export, quality scoring
  - **TypeScript responsibilities**: CLI parsing, HTTP routing, subprocess orchestration, Zod validation, database schema, UI rendering, WebSocket updates
  - **Boundary contract**: TypeScript calls Python via `PythonEngine`, Python outputs JSON to stdout, TypeScript validates with Zod
  - **Forbidden patterns**: No data science in TypeScript, no HTTP servers in Python, no logic duplication
  - **Testing requirements**: Python unit tests (pytest), TypeScript handler tests (mock PythonEngine), integration tests
  - **Code review checklist**: Enforce separation in all new code

- **Live Telemetry Collection** (Phase VII Task 7.3) - Execution monitoring and model calibration
  - **Telemetry schemas** (`packages/core/src/telemetry/schemas.ts`):
    - `SlippageEvent`: Expected vs actual slippage tracking
    - `LatencyEvent`: Expected vs actual execution latency
    - `FailureEvent`: Unexpected execution failures
    - `TelemetrySummary`: Aggregated metrics over time windows
    - `CalibrationRecommendation`: Model adjustment suggestions
  - **Python telemetry collector** (`tools/execution/telemetry_collector.py`):
    - Compute telemetry summary from events
    - Generate calibration recommendations (slippage, latency, failure probability)
    - Confidence-based adjustment thresholds
  - **API endpoints**:
    - `/api/telemetry/slippage-drift/:runId`
    - `/api/telemetry/latency-drift/:runId`
    - `/api/telemetry/calibration/:runId`
  - **Purpose**: Feed live execution data back to calibrate execution models (slippage, latency, failure rates)

- **Strategy Governance** (Phase IX) - Approval workflow and kill switches
  - **Kill switches** (`packages/core/src/governance/kill-switches.ts`):
    - Global kill switch (pause all strategies)
    - Per-strategy kill switches
    - Daily loss limit (auto-pause when exceeded)
    - Drawdown limit (auto-pause when breached)
    - `KillSwitchManager` class for centralized control
  - **Strategy approval workflow**:
    - Strategy states: draft → approved → live → deprecated
    - Approval checklist (min trades, min win rate, max drawdown, positive expectancy, profit factor, walk-forward validation)
    - Approval tracking (approved_by, approved_at)
  - **Governance UI** (`/governance`):
    - Kill switch dashboard with status indicators
    - Strategy approval table with state management
    - Approval checklist viewer
    - One-click approve/go-live/deprecate actions
  - **Database schema**: Extended `backtest_strategies` table with `status`, `approval_checklist_json`, `approved_at`, `approved_by`
  - **API endpoints**:
    - `/api/governance/kill-switches` (GET)
    - `/api/governance/kill-switches/global` (POST)
    - `/api/strategies/:strategyId/approve` (POST)
    - `/api/strategies/:strategyId/go-live` (POST)
    - `/api/strategies/:strategyId/deprecate` (POST)

- **Knowledge Retention** (Phase X) - Run notes and learning journal
  - **Run notes**:
    - Attach notes to specific backtest runs
    - Tag notes for categorization
    - API endpoints: `/api/runs/:runId/notes` (GET/POST/DELETE)
  - **Learning journal** (`/journal`):
    - Markdown-style journal entries
    - Link entries to multiple runs
    - Tag-based organization
    - Full-text search across entries
    - Filter by tags
    - Edit/delete entries
  - **Database schema**:
    - `backtest_run_notes` table (note_id, run_id, note_text, tags, created_at, updated_at)
    - `backtest_journal_entries` table (entry_id, title, content, tags, linked_runs, created_at, updated_at)
  - **API endpoints**:
    - `/api/journal` (GET/POST)
    - `/api/journal/:entryId` (DELETE)
  - **Purpose**: Capture learnings, track what worked/failed, build institutional knowledge

- **OHLCV Run Tracking Integration** - Integrated audit trail system into ingestion workflows
  - **Automatic run tracking**: Every `ingestForCalls()` now creates a run manifest with full audit trail
  - **Run manifest generation**: Captures git commit, script version, CLI args, environment vars, input hash
  - **Lifecycle tracking**: Runs are tracked from start to completion/failure with detailed statistics
  - **Error resilience**: Run tracking failures don't stop ingestion (graceful degradation)
  - **Statistics tracking**: Tracks candles fetched/inserted/rejected, tokens processed, error counts
  - **Components**:
    - `OhlcvIngestionEngine.startRun()`: Start tracked run with manifest
    - `OhlcvIngestionEngine.completeRun()`: Complete run with final stats
    - `OhlcvIngestionEngine.failRun()`: Mark run as failed with error details
    - `OhlcvIngestionService.createRunManifest()`: Generate manifest from ingestion params
  - **Purpose**: Enable full reproducibility, debugging, and rollback of ingestion runs
  - **Documentation**: `docs/implementation/ohlcv-run-tracking-integration.md`

- **OHLCV Deduplication and Audit Trail Module** - Complete system for quality-based deduplication and run tracking
  - **Quality-based deduplication**: Data-derived quality scoring (volume-weighted, 0-125 points) ensures candles with volume ALWAYS beat zero-volume candles
  - **Per-interval tables**: Separate tables for 1m and 5m candles (`ohlcv_candles_1m`, `ohlcv_candles_5m`) prevent interval-mixing bugs
  - **ReplacingMergeTree**: Uses `quality_score` and `ingested_at` as deduplication keys; highest quality wins
  - **Validation before insertion**: Corruption checks (ALWAYS enforced) and quality checks (configurable: STRICT/LENIENT)
  - **Full audit trail**: Every run tracked with version, git hash, CLI args, results (run_id enables rollback)
  - **CLI commands**: `dedup-sweep`, `runs-list`, `runs-rollback`, `runs-details`, `validate-duplicates`
  - **Migration script**: Python script to migrate existing data with deduplication (`tools/migration/migrate_ohlcv_to_interval_tables.py`)
  - **Tests**: Comprehensive unit tests for quality scoring and validation (32 tests covering edge cases)
  - **Schema migrations**: SQL migrations for new tables (`ohlcv_ingestion_runs`, per-interval candle tables)
  - **Components**:
    - `SourceTier` enum (0-5): Source tier as tie-breaker only (not primary quality indicator)
    - `computeQualityScore()`: Volume (100) + range (10) + OHLC consistency (10) + source tier (0-5)
    - `validateCandle()`: Corruption checks (INVALID_RANGE, OPEN/CLOSE_OUTSIDE_RANGE, NEGATIVE_VALUES) + quality checks (ZERO_VOLUME, ZERO_PRICE, FUTURE_TIMESTAMP)
    - `IngestionRunRepository`: Run lifecycle tracking (start, complete, fail, rollback)
    - `OhlcvDedupService`: Inline, post-batch, and sweep deduplication modes
    - `OhlcvRepository.upsertCandles()`: Now validates, scores, and routes to correct interval table
    - `OhlcvRepository.getCandles()`: Uses `GROUP BY` + `argMax()` for guaranteed query-time deduplication
  - **Purpose**: Eliminate duplicate candles, ensure data quality, provide full audit trail for faulty run identification and rollback

### Fixed

- **OHLCV Pipeline Schema and Deduplication** - Fixed schema mismatch and duplicate data issues
  - **Schema fix**: Updated `clickhouse-client.ts` to create tables with `interval_seconds UInt32` instead of `interval String`
  - **Deduplication in reads**: Updated `OhlcvRepository.getCandles()` to use `GROUP BY` with `any()` aggregation to deduplicate on read
  - **Historical data cleanup**: Ran deduplication script on existing data, removing 379,891 duplicate rows (0.3%)
  - **Validation**: Updated `verify_storage_write_read.py` to use deduplication queries
  - **Impact**: Write 13 candles → Read 13 candles (previously would return 38+ due to duplicates)
  - **Root cause**: MergeTree engine allows multiple rows with same key; queries didn't deduplicate
  - **Verified**: Validation script now passes with exact count matching (fetched=written=read)

- **Date Range Query Bug in V1 Baseline Optimizer** - Queries for older date ranges now work correctly
  - Fixed issue where `query_calls` operation fetched 1000 most recent calls and then filtered by date
  - Date filtering now happens in SQL BEFORE the LIMIT clause
  - Added `from_ts_ms` and `to_ts_ms` parameters to Python `query_calls` operation
  - Updated `DuckDBStorageService.queryCalls()` to pass date range parameters
  - Updated `queryCallsDuckdb` workflow to convert ISO dates to milliseconds
  - **Impact**: Queries like `--from 2025-05-01 --to 2025-08-01` now correctly find calls in that range instead of returning "No calls found"
  - **Root cause**: Python query was `ORDER BY alert_ts_ms DESC LIMIT 1000` without date filtering, returning newest 1000 calls (e.g., 2025-11 to 2026-01), then TypeScript filtered by date, missing older calls entirely
  - **Verified**: Database has 3,152 calls in 2025-05-01 to 2025-08-01 range, system now correctly finds 21 eligible calls after coverage checks

### Added

- **Dashboard Comparison Mode** - Compare multiple entry strategies side-by-side
  - **New mode**: "Compare Entry Strategies" in dashboard sidebar
  - **Multi-dataset selection**: Select 2+ datasets to compare (immediate, -5%, -10%, etc.)
  - **Visual comparisons**: EV chart, trade count vs EV scatter, winner capture rate, cohort breakdown
  - **Key insights**: Automatic calculation of deltas vs immediate entry
  - **Best strategy highlighting**: Green highlight for optimal strategy
  - **Trade-off analysis**: Shows EV improvement vs missed opportunities
  - **`DASHBOARD_COMPARISON_MODE.md`**: Complete guide with examples and interpretation
  - **Purpose**: Answer "Should we wait for a dip, and if so, how much?" in one interface

- **Delayed Entry Support in Phased Stop Simulator** - Test waiting for dips after alert
  - **`--delayed-entry`**: Wait for X% dip before entering (e.g., `-10` for -10%, `0` for immediate)
  - **`--entry-max-wait`**: Maximum hours to wait for delayed entry (optional)
  - **`--stop-from`**: Calculate stops from `alert` price or actual `entry` price
  - **New function**: `simulate_phased_trade_with_reference()` - supports reference price for stop calculations
  - **Integrated**: Delayed entry works with all existing features (caching, resume, parquet output, EV metrics)
  - **Tests**: Should we wait for a dip? If so, how much? Compare immediate vs delayed entry strategies

- **Modular Trade Simulation Library** - Reusable components for future tools
  - **`lib/entry_strategies.py`**: Modular entry strategies (immediate, delayed dip, time-delayed, limit order)
  - **`lib/stop_strategies.py`**: Modular stop strategies (static, trailing, with phased configuration)
  - **`lib/trade_simulator.py`**: Combines entry + stop strategies for complete trade simulation
  - **`DELAYED_ENTRY_PLAN.md`**: Comprehensive plan and expected results
  - **`MODULAR_LIBRARY_USAGE.md`**: Complete usage guide with examples
  - **`test_modular_library.py`**: Verification tests (all passing ✅)
  - **Architecture**: Clean separation between entry logic, stop logic, and simulation orchestration
  - **Purpose**: Reusable components for analysis scripts, quick tests, and future simulators

- **Time-Based Exit Analysis** - Game-changing discovery: trailing stops + time windows
  - **`time_based_analysis.py`**: Analyze time-to-peak and optimal hold times with granular cohorts
  - **`time_exit_simulator.py`**: Framework for pure time-based exit strategies
  - **`TIME_BASED_EXITS_ANALYSIS.md`**: Comprehensive analysis and recommendations
  - **`WIDE_STOP_ANALYSIS.md`**: Comparison of static vs trailing stops with wide parameters
  - **Key finding 1**: Time-based exits (48h) have **2275% EV** vs **-6.4% EV** for stop-based exits (static 10%/30%)
  - **Key finding 2**: Trailing 15%/50% has **+3.7% EV** vs **-12.5% EV** for static 15%/50% (16.2% difference!)
  - **Insight**: 84% of winners exit within 12 hours, time windows don't matter much for trailing stops
  - **Recommendation**: Use trailing stops (not static) with 2-6h time windows for fast turnover
  - Granular cohort analysis: ≥10x, 5x-10x, 4x-5x, 3x-4x, 2x-3x, <2x
  - Granular time windows: 2h, 4h, 6h, 9h, 12h, 18h, 24h, 36h, 48h
  - Per-caller hold time optimization

- **Stop Modes Documentation** (`tools/backtest/STOP_MODES_EXPLAINED.md`) - Comprehensive guide
  - Explains `end_of_data` exit behavior (48-hour observation window)
  - Why mean ≠ median for static stops (outliers from `end_of_data` exits)
  - Detailed comparison of static, trailing, and ladder stop modes
  - How to interpret dashboard metrics and optimize stop percentages
  - **Key insight**: `end_of_data` exits at current price are correct behavior, not a bug

- **Interactive EV Dashboard** (`tools/backtest/dashboard.py`) - Web-based visualization for phased stop results
  - Built with Streamlit and Plotly for interactive data exploration
  - **Auto-discovery**: Dropdown selector automatically finds all parquet files in output directories
  - **Smart combo selector**: Single dropdown showing only valid Phase1/Phase2 combinations that exist in data
  - **Dark theme**: Optimized for readability with proper contrast
  - Real-time filtering by stop mode, stop configuration, and caller
  - Cohort breakdown: Winners (≥3x), Losers (2x no 3x), Never 2x
  - Key metrics: EV from entry, EV given 2x, P(reach 2x), P(3x | 2x)
  - Interactive charts: exit multiple distributions, peak vs exit scatter, giveback analysis, exit reasons
  - Top trades table with configurable size
  - Strategy comparison mode to evaluate all strategies side-by-side
  - Wildcard pattern support for loading multiple parquet files
  - Usage: `streamlit run tools/backtest/dashboard.py` (no args needed!)
  - Dependencies: `pip install -r tools/backtest/requirements-dashboard.txt`

- **Slice Exporter Quality Validation** - Detect and report gaps during parquet export
  - New `slice_quality.py` module with `QualityMetrics` and gap detection functions
  - Analyzes coverage, gaps, duplicates, OHLC distortions, zero volume
  - Per-token and aggregate quality scoring (0-100 scale)
  - Gap-filling function for small gaps with forward-fill

- **Slice Validation Tool** (`tools/backtest/validate_slices.py`) - Standalone quality checker
  - Validates all parquet slices in a directory
  - Generates severity breakdown: critical, warning, minor, ok
  - Optional ClickHouse comparison mode
  - Outputs worklist of tokens needing re-ingestion
  - Usage: `python validate_slices.py --dir slices/per_token --output-worklist worklist.json`

- **Per-Token Slice Export Quality Reports** - Automatic quality tracking
  - Every export now generates `quality_report.json` with per-token metrics
  - Console summary shows: tokens with gaps, low coverage, high zero volume
  - Quality warnings during verbose export

### Fixed

- **Race Condition in Parallel Slice Exporter** - Data loss prevention
  - Fixed bare `except:` clause that caught `queue.Empty` incorrectly
  - Now uses specific `QueueEmpty` exception handling
  - Added timeout for producer thread join with warning
  - Added final queue drain to ensure all data is written

- **Improved Deduplication in Slice Export** - Better candle selection
  - Changed from `any()` to `argMax(volume)` aggregation
  - Prefers candle with highest volume when duplicates exist
  - Reduces quality issues from duplicate candle entries

- **Consolidated Slice Exporters** - Single source of truth
  - Unified 3 duplicate exporters into `lib/slice_exporter.py`
  - `run_baseline_all.py` now uses consolidated exporter with quality validation
  - `alert_baseline_backtest.py` now uses consolidated exporter with deduplication
  - All exports now use `argMax(volume)` deduplication and quality validation

### Added (Tests)

- **Slice Quality Unit Tests** (`test_slice_quality_unit.py`) - 33 tests
  - Gap detection: continuous, single gap, multiple gaps, large gaps, tolerance
  - Duplicate detection: single, multiple, counting accuracy
  - Coverage calculation: full, half, low coverage thresholds
  - OHLC distortion detection: h<l, o>h, negative values
  - Zero volume detection and percentage calculation
  - Quality score calculation and threshold validation
  - Gap filling with forward fill behavior

- **Slice Quality Golden Tests** (`test_slice_quality_golden.py`) - 13 tests
  - Perfect 24h data: verifies 100% coverage, 0 gaps, high quality score
  - Gappy data: verifies gap detection accuracy for various patterns
  - Duplicated data: verifies duplicate counting and quality impact
  - Distorted data: verifies OHLC constraint violation detection
  - Zero volume data: verifies zero volume percentage tracking
  - Realistic degraded data: simulates 86% gap / 43% low coverage issue
  - Precision tests for exact formula verification

- **Slice Exporter Regression Tests** (`test_slice_exporter_regression.py`) - 14 tests
  - Data integrity: all candles written, large datasets, multi-token
  - Quality preservation: no gaps/duplicates introduced, quality score preserved
  - Edge cases: empty input, single candle, timestamp precision, large gaps
  - Deduplication: duplicates removed, multi-token preserved
  - Race condition guards: queue draining, exception handling

- **Cohort-Based EV Metrics** - Proper Expected Value calculations with exit multiple distributions
  - **The missing brick**: Added `entry_mult`, `peak_mult`, `exit_mult`, `giveback_from_peak_pct` to every trade
  - **Cohort A (Base Rates)**: P(reach 2x), P(3x | 2x), P(2x but not 3x)
  - **Cohort B1 (Winners ≥3x)**: Exit multiple distributions (mean, p50, p75), giveback from peak
  - **Cohort B2 (Losers 2x but not 3x)**: Exit multiple distributions, min multiple after 2x (how ugly it gets)
  - **Cohort B3 (Never 2x)**: Exit multiple distributions for stopped-out trades
  - **Proper EV**: `EV% = E[(exit_mult - 1) × 100]` for all trades and conditional on hitting 2x
  - **EV Formula**: `E[exit_mult | 2x] = P(3x|2x)·μ_winners + (1-P(3x|2x))·μ_losers`
  - **Why it matters**:
    - Before: Only capture rates → can't compute true EV
    - After: Exact exit distributions → can compute EV for any stop strategy
    - Enables: Tail-capture curves, optimal ladder tightening, risk/variance knobs
  - **CSV Export**: All cohort metrics included (24 new columns)
  - **Parquet**: Full audit trail with backward compatibility

- **CSV Export for Phased Stop Simulator** - Export summary results to CSV
  - New `--csv-output` option exports console summary table to CSV file
  - One row per (caller, strategy) combination
  - All performance metrics included: returns, win rate, capture rates, ATH
  - Easy integration with spreadsheets, pandas, R
  - Usage: `python3 phased_stop_simulator.py ... --csv-output results/run.csv`

- **Intelligent Caching for Phased Stop Simulator** - Reuses results across overlapping date ranges
  - **Primary benefit**: Avoid recomputing overlapping date ranges when extending backtests
  - **How it works**:
    - Tracks cached results in `cache_metadata.json` with date ranges
    - Detects overlapping date ranges and loads cached trades
    - Only computes missing date ranges
    - Combines cached + new results seamlessly
  - **Example**: Run 2025-05-01 to 2025-07-01, then extend to 2025-08-01
    - Second run only computes 2025-07-01 to 2025-08-01
    - Loads 2025-05-01 to 2025-07-01 from cache
    - Total speedup: ~66% less computation
  - **Parameter handling**:
    - Cache key based on chain + date range (NOT min_calls)
    - Lowering min_calls identifies newly included callers
    - Future: Can recompute for specific callers if needed
  - **New CLI option**: `--use-cache` (default: off)
  - **Cache structure**:
    - `cache_metadata.json`: Tracks all cached runs
    - One parquet file per run with run_id
    - Each entry stores: filename, chain, date_from, date_to, min_calls, created_at
  - **Benefits**:
    - Speed: Avoid redundant computation
    - Flexibility: Easily extend date ranges
    - Efficiency: Only compute what's needed
    - Incremental: Build up historical results over time
  - Usage:

    ```bash
    # Initial run
    python3 phased_stop_simulator.py ... --use-cache --output-dir output/my_backtest

    # Extend date range (only computes new dates)
    python3 phased_stop_simulator.py ... --use-cache --date-to 2025-08-01
    ```

- **Parquet Output & Resume for Phased Stop Simulator** - Full audit trail and crash recovery
  - Every trade saved to parquet with run_id
  - Incremental saves (every 10 alerts) prevent data loss
  - Resume functionality skips already processed (mint, strategy) combinations
  - New CLI options: `--output-dir`, `--resume`
  - Parquet schema includes: caller, mint, strategy params, milestones, performance metrics

- **Parquet vs ClickHouse OHLCV Quality Comparison Tool** - Compares data quality between parquet slice files and ClickHouse
  - Script: `tools/storage/compare_parquet_clickhouse_quality.py`
  - **Primary question answered**: Is bad ClickHouse data mostly OUTSIDE the 48-hour event horizon window?
  - For each alert with a matching parquet file:
    - Loads candles from parquet (per-token slices)
    - Loads candles from ClickHouse for the same time range
    - Analyzes quality metrics: duplicates, gaps, distortions, zero volume
    - Compares quality INSIDE vs OUTSIDE the 48-hour horizon (alert → alert + 48h)
  - **Key metrics**:
    - Quality score (0-100) per source
    - Coverage (candle count) per source
    - % of ClickHouse issues inside vs outside horizon
    - Which source has better data for backtesting
  - Features:
    - Auto-matches parquet files to alerts by mint prefix and timestamp
    - Graceful fallback to parquet-only mode when ClickHouse unavailable
    - Supports 1m and 5m intervals
    - JSON report output with detailed per-token comparisons
    - Console visualization with color-coded results
  - Usage:
    ```bash
    python tools/storage/compare_parquet_clickhouse_quality.py \
        --duckdb data/alerts.duckdb \
        --parquet-dir slices/per_token \
        --limit 100 \
        --visualize
    ```

- **Phased Stop Strategy Simulator** - Comprehensive simulator testing universal vs phased stop strategies
  - Script: `tools/backtest/phased_stop_simulator.py`
  - Tests whether different stop percentages are needed for different phases:
    - **Phase 1 (1x→2x)**: Entry to first profit target (2x)
    - **Phase 2 (2x+)**: After hitting 2x, trail until stopped out
  - **Universal stops**: Same % for both phases (e.g., 20%/20%)
  - **Phased stops**: Different % per phase (e.g., 10%/20% - tighter pre-2x, looser post-2x)
  - Supports all stop modes: static, trailing, ladder (with configurable steps)
  - Real P&L simulation with actual trade outcomes per caller
  - Key metrics:
    - **EV/Trade%**: Expected value per trade (primary optimization target)
    - **Cap2x%/Cap3x%/Cap4x%**: Milestone capture rates
    - **Stop1/Stop2**: Count of stops in each phase
    - **WinRate%**: % of trades with positive return
  - Answers: "Do I need tighter stops pre-2x and looser post-2x, or does one size fit all?"
  - Example findings:
    - Brook 💀l: 10% trailing (universal) = 73.2% avg return ✅
    - Brook 💀🧲: 10%/20% ladder (phased) = 11.7% avg return ✅
  - Multithreaded processing with configurable date ranges and minimum call thresholds

- **1x→2x Drawdown Analysis** - Extended drawdown analysis to include pre-2x phase
  - Added to `tools/backtest/post2x_drawdown_analysis.py`
  - New DD_1x→2x table showing drawdown from entry to 2x
  - Distribution stats (p50, p75, p90) for entry-to-2x phase
  - Keep@X% capture rates for 1x→2x window
  - Supports all stop modes (static, trailing, ladder)
  - Shows which callers require tight vs loose stops pre-2x
  - Hit2x% column added to all tables (% of alerts that reached 2x)

- **Post-2x Drawdown Analysis with +EV Metrics** - Python script for analyzing trailing stop effectiveness
  - Script: `tools/backtest/post2x_drawdown_analysis.py`
  - Computes drawdown distributions for tokens reaching 2x, 3x, 4x, 5x milestones
  - **Winner analysis**: Drawdown from 2x→3x, 2x→4x, 2x→5x for tokens that reach next milestone
    - Distribution stats (p50, p75, p90) per caller
    - Keep@X% rates: % of winners captured with X% stop (5%, 10%, 15%, 20%, 25%, 30%, 40%)
  - **Non-winner analysis**: Drawdown for tokens that DON'T reach next milestone (saved from nuke)
    - 2x-but-not-3x: How often would a stop save you from full round-trip?
    - 3x-but-not-4x: Post-3x nuke protection
    - 4x-but-not-5x: Post-4x nuke protection
  - **+EV decision framework**: Compare Keep@X% (winners captured) vs Save@X% (losers saved)
    - If Keep@X% is high (>80%) AND Save@X% is high (>70%), the stop is +EV
    - Example: Keep@20% = 85% and Save@20% = 80% → highly +EV (capture 85% of winners, save 80% of losers)
  - **Two stop modes** (`--stop-mode`):
    - `static` (default): Stop anchored at 2x/3x/4x price (measures max drawdown tolerance)
    - `trailing`: Stop moves up with peak price (realistic trailing stop simulation)
  - Multithreaded processing with progress bar (configurable threads)
  - Resource limits and timeouts to prevent hanging on large datasets
  - Drawdown sign convention: Always positive magnitude (0-100%)
  - Per-caller aggregation with configurable date ranges and minimum call thresholds

- **Python V1 Baseline Optimizer with TypeScript Orchestration** - Complete Python implementation with TypeScript integration
  - Core simulator: `tools/backtest/lib/v1_baseline_simulator.py` (564 lines ported from TypeScript)
    - Capital-aware simulation with finite capital and position constraints
    - Position sizing: `min(size_risk, size_alloc, free_cash)`
    - Trade lifecycle: TP/SL/Time exits with fee calculation
    - Concurrent position limits (max 25)
    - Path-dependent capital management
  - Grid search optimizer: `tools/backtest/lib/v1_baseline_optimizer.py`
    - Per-caller optimization with collapsed/extreme parameter detection
    - Grouped evaluation with filtering
    - Default grids: TP=[1.5,2.0,2.5,3.0,4.0,5.0], SL=[0.85,0.88,0.9,0.92,0.95]
    - **Threading support enabled** (configurable via `V1_OPTIMIZER_THREADS` env var)
    - Parallel grid search using `ThreadPoolExecutor`
  - CLI script: `tools/backtest/run_v1_baseline_optimizer.py`
    - Follows pattern from existing `run_optimizer.py`
    - Supports per-caller, grouped, and both modes
    - Configurable parameter grids and capital constraints
  - **TypeScript Orchestration Layer** (Phase 2 complete):
    - `V1BaselinePythonService` wraps PythonEngine calls
    - Zod schemas for Python input/output validation
    - Updated `v1-baseline-optimizer` handler to use Python service
    - Added `v1BaselinePythonService` to `CommandContext`
    - Stdin wrapper for TypeScript → Python integration
    - Integration tests (4 tests, all passing)
  - Comprehensive test suite (31 tests total, all passing):
    - Unit tests: `test_v1_baseline_simulator.py` (13 tests)
    - Optimizer tests: `test_v1_baseline_optimizer.py` (8 tests)
    - Golden tests: `test_v1_baseline_golden.py` (6 deterministic scenarios)
    - Integration tests: `v1-baseline-python-service.integration.test.ts` (4 tests)
  - Adheres to architectural policy: **Python bears the brunt of data science workload, TypeScript orchestrates**

- **Candle Deduplication System** - Track and remove duplicate candles in ClickHouse
  - Added `ingested_at` and `ingestion_run_id` columns to `ohlcv_candles` table
  - Migration script: `tools/storage/migrate_add_ingestion_metadata.py`
  - CLI commands: `quantbot storage analyze-duplicates`, `quantbot storage deduplicate`
  - Report generator: `tools/storage/generate_candle_ingestion_report.py`
  - Deduplication view: `ohlcv_candles_deduplicated` (keeps most recent ingestion)
  - Updated `OhlcvRepository.upsertCandles()` to accept optional ingestion metadata
  - Handlers: `analyzeDuplicateCandlesHandler`, `deduplicateCandlesHandler`
  - Documentation: `docs/guides/candle-deduplication.md`
  - Location: `packages/storage/src/`, `packages/cli/src/handlers/storage/`, `tools/storage/`
  - Enables sorting tokens by most recent candle ingestion aligned with alert times
  - Identifies and removes duplicate candles while preserving data integrity

- **Candle Quality Analysis System** - Comprehensive data quality analysis and re-ingestion worklist
  - Detects multiple quality issues: duplicates, gaps, price distortions, volume anomalies
  - Quality scoring system (0-100) with priority levels (critical/high/medium/low)
  - Python analyzer: `tools/storage/analyze_candle_quality.py`
    - Analyzes duplicates (identical vs different values)
    - Detects data gaps (missing candles in time series)
    - Identifies price distortions (OHLC inconsistencies, extreme jumps, zero/negative values)
    - Calculates quality scores and priorities
    - Fixed CSV export to handle NULL callers (filters out None values)
    - Fixed DuckDB query to use `list()` with `FILTER` clause for NULL-safe aggregation
  - CLI command: `quantbot storage analyze-quality`
  - Re-ingestion automation: `tools/storage/process_reingest_worklist.sh`
    - Processes worklist by priority
    - Deduplicates and re-ingests automatically
    - Dry-run mode for safety
  - Handler: `analyzeCandleQualityHandler`
  - Generates JSON and CSV worklists for batch processing
  - Documentation: `docs/guides/candle-quality-analysis.md`
  - Location: `packages/cli/src/handlers/storage/`, `tools/storage/`
  - Enables identification of tokens with erroneous data similar to chart anomalies
  - Prioritized re-ingestion workflow for data quality improvement
  - **Verified working**: Analyzed 1000 tokens, generated 735-item worklist (73.5% need re-ingestion)

- **Structured Artifacts System** - Research-lab architecture for backtest runs
  - Multiple Parquets per run by artifact type (alerts, paths, trades, summary, frontier, errors)
  - JSON manifests (`run.json`) with metadata, provenance, and artifact inventory
  - Month-based partitioning (`runs/YYYY-MM/run_id=<uuid>/`)
  - Completion markers (`_SUCCESS`) to prevent incomplete runs from polluting catalog
  - DuckDB catalog for cross-run queries (`backtest_runs_catalog`, `backtest_artifacts_catalog`)
  - Daemon pattern for gradual catalog registration (non-blocking)
  - Git provenance capture (commit, branch, dirty flag)
  - Integrated into `runPathOnly` and `runPolicyBacktest` flows
  - CLI commands: `catalog-sync`, `catalog-query`
  - Location: `packages/backtest/src/artifacts/`, `packages/cli/src/handlers/backtest/catalog-*.ts`
  - Documentation: `docs/architecture/structured-artifacts.md`, `docs/guides/structured-artifacts-quickstart.md`
  - ~2600 lines of code + documentation across 9 new files, 3 modified files

- **Wiring Improvements & Verification** - Comprehensive wiring pattern implementation and verification
  - Verified `StrategiesRepository` through `CommandContext` in list-strategies command
  - Created verification tests: `command-context-wiring.test.ts` (5 tests passing)
  - Created verification status document: `wiring-verification-status.md`
  - Created wiring pattern tests: `handler-wiring-patterns.test.ts`, `wiring-patterns.test.ts`, `wiring-integration.test.ts`
  - Documented wiring exceptions: `wiring-exceptions.md` with comprehensive documentation
  - All direct instantiations are documented as acceptable in composition roots
  - Location: `packages/cli/tests/unit/core/`, `docs/architecture/wiring-*.md`
  - Ensures handlers use `CommandContext` services and workflows use `WorkflowContext` (no direct instantiation)

- **Gate 2: Causal Candle Accessor Implementation** - Enforces causality in simulation candle access
  - `CausalCandleAccessor` interface and `CausalCandleWrapper` class for causal candle filtering
  - `StorageCausalCandleAccessor` implementation wrapping `StorageEngine` with causal filtering
  - `simulateStrategyWithCausalAccessor()` function for time-based simulation loop
  - `updateIndicatorsIncremental()` for incremental indicator calculations
  - Integration into `WorkflowContext` via `ohlcv.causalAccessor`
  - Comprehensive tests: `causal-accessor.test.ts`, `causal-vs-upfront.test.ts`, updated `future-scramble.test.ts`
  - Location: `packages/simulation/src/types/causal-accessor.ts`, `packages/workflows/src/context/causal-candle-accessor.ts`
  - Ensures at simulation time `t`, it is impossible to fetch candles with `close_time > t`

### Changed

- Deprecated `@quantbot/utils/types.ts` - types should now be imported directly from `@quantbot/core`
- Migrated test files to use independent math helpers instead of importing production constants (fee-rounding.test.ts, fees.property.test.ts)
- Migrated console logging to logger in executionStubAdapter (workflows package)
- Simulation workflow now uses `CausalCandleAccessor` for incremental candle fetching instead of upfront fetching
- `WorkflowContext.ohlcv.getCandles()` marked as optional legacy method (use `causalAccessor` instead)

### Fixed

- **MEDIUM**: Test independence: Tests no longer import DEFAULT_COST_CONFIG from production code
- **MEDIUM**: Integration test status documented (duckdb-idempotency.test.ts now passing, OhlcvIngestionService.integration.test.ts documented with known issue)

### Added

- Added depcheck tool for dependency auditing
- Added ESLint rule to discourage console usage in workflow code (warn level)
- Added documentation for test independence requirements
- Completed Phase 1 cleanup: dependency management, type consolidation
- Completed Phase 2 cleanup: test independence, logging standardization
- Phase 3 (error handling standardization) in progress

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Storage Foundations - Snapshot System Implementation** - Complete snapshot and deterministic read system
  - DuckDB snapshot storage backend (`tools/data-observatory/snapshot_storage.py`)
  - Complete `DuckDBSnapshotStorage` implementation with full CRUD operations
  - `DeterministicDataReader` API for snapshot-based reads with filtering support
  - Connection management utilities to prevent WAL files
  - Comprehensive unit tests (15 tests) for deterministic reader
  - Documentation: `SNAPSHOT_USAGE.md`, `STORAGE_FOUNDATIONS.md`
  - Location: `packages/data-observatory/src/snapshots/`, `packages/storage/src/duckdb/connection-utils.ts`

- **Phase 3: Research OS End-to-End Implementation** - Wired ResearchSimulationAdapter to actually run simulations
  - Loads data snapshots using DataSnapshotService
  - Converts StrategyRef, ExecutionModel, CostModel to simulation engine formats
  - Runs simulations using `simulateStrategy()` for each call in snapshot
  - Converts simulation events to TradeEvent[] format
  - Calculates PnL series and metrics
  - Returns complete RunArtifact with all required data
  - This completes Phase 3: Research OS is now functional end-to-end
  - Location: `packages/workflows/src/research/simulation-adapter.ts`

- **Phase 3: Research OS Leaderboard** - Ranking and comparison of simulation runs
  - New command: `quantbot research leaderboard`
  - Ranking criteria: return, winRate, profitFactor, sharpeRatio, maxDrawdown, totalTrades, avgReturnPerTrade
  - Filtering: by strategy name, snapshot ID, minimum return, minimum win rate
  - Sort order: ascending or descending
  - Limit results with `--limit` option
  - Exports leaderboard functions from `@quantbot/workflows/research`
  - Location: `packages/workflows/src/research/leaderboard.ts`, `packages/cli/src/handlers/research/leaderboard.ts`

- **DuckDB Stress Tests** - Comprehensive stress tests for DuckDB storage operations
  - Added `duckdb-extreme.stress.test.ts` with real implementations
  - Tests massive concurrent operations (1000+ concurrent writes)
  - Tests large data volumes (10,000+ strategies/runs)
  - Tests resource exhaustion scenarios (memory pressure, disk space, corruption)
  - Tests all DuckDB operations comprehensively (store_strategy, store_run, query_calls, OHLCV metadata, exclusions, reports)
  - Tests performance degradation under load
  - Tests idempotency under stress
  - Tests error recovery scenarios
  - Location: `packages/storage/tests/stress/storage-discipline/duckdb-extreme.stress.test.ts`

### Fixed

- **Repo Hygiene - Cleanup of Test Artifacts and Temp Files** - Removed temporary test files and updated .gitignore
  - Removed root-level test artifacts: `run-ohlcv-*.mjs`, `run-ohlcv-*.sh`, `calls-test*.json`, `test.json`
  - Removed WAL files from filesystem: `data/test_state_*.duckdb.wal`, `golden_path_test_*.duckdb`
  - Updated `.gitignore` to prevent future commits of test database files and temp scripts
  - Updated documentation to reflect completed DuckDB storage implementation
  - Updated integration tests to reflect storage completion (removed placeholder comments)
  - Location: Root directory, `.gitignore`, `packages/data-observatory/docs/`

- **CRITICAL: Repo Hygiene - Build Artifacts in Source** - Removed all build artifacts from src/ directories
  - Removed all `.js.map` and `.d.ts.map` files from `packages/*/src/`
  - Removed stray `.d.ts` files from src/ (should only be in dist/)
  - Updated `.gitignore` to prevent future commits of build artifacts
  - Added CI check script `check:no-build-artifacts` to fail builds if artifacts appear in src/
  - Location: `.gitignore`, `scripts/ci/check-no-build-artifacts.ts`

- **CRITICAL: Repo Hygiene - Runtime State Files** - Removed all runtime state files from repo
  - Removed DuckDB WAL files from repo root (`integration_test_*.duckdb.wal`)
  - Removed `logs/` directory (6.9MB of versioned logs)
  - Removed junk files like `--dbPath` and test database files from root
  - Updated `.gitignore` to exclude all runtime state files
  - Location: `.gitignore`, root directory cleanup

- **CRITICAL: CLI Double Validation Bug** - Fixed duplicate validation in command execution
  - `defineCommand()` was validating with schema, then `execute()` was validating again
  - Created `executeValidated()` for pre-validated args to avoid double validation
  - `defineCommand()` now calls `executeValidated()` after its own validation
  - This eliminates the bug where two different validation paths could diverge
  - Location: `packages/cli/src/core/execute.ts`, `packages/cli/src/core/defineCommand.ts`

- **CRITICAL: Nondeterministic Run IDs** - Fixed nondeterministic run ID generation
  - Removed `new Date().toISOString()` fallback in `extractRunIdComponents()`
  - Run IDs now require explicit `alertTimestamp` - no automatic fallback
  - Commands that should generate run IDs but are missing `alertTimestamp` now log a warning
  - This ensures run IDs are reproducible from manifest inputs (required for research lab)
  - Location: `packages/cli/src/core/execute.ts` (line 150-151)

### Added

- **Phase 2: Re-run from Manifest Command** - First-class command to replay simulations from manifest files
  - New command: `quantbot research replay-manifest --manifest <path>`
  - Loads manifest file, extracts run ID, and replays simulation
  - Validates manifest structure using `CanonicalRunManifestSchema`
  - Makes RunManifest the spine of the research lab (Phase 2 requirement)
  - Location: `packages/cli/src/handlers/research/replay-manifest.ts`, `packages/cli/src/commands/research.ts`

### Fixed

- **Technical Debt: Error Handling Standardization** - Continued fixing inconsistent error handling
  - Replaced generic `Error` with `ConfigurationError` in `getStorageStats`, `queryCallsDuckdb`, `getOhlcvStats` workflows, and `ResultsWriter`
  - Replaced generic `Error` with `ValidationError` in `OhlcvRepository` for chain/interval validation
  - Replaced generic `Error` with `NotFoundError` in `ArtifactDuckDBAdapter` for missing artifacts
  - Replaced generic `Error` with `AppError` for not-yet-implemented operations
  - Fixed 15+ files total, including:
    - `birdeye-client.ts` - Address validation (2 instances)
    - `config-loader.ts` - Config format validation (2 instances)
    - `coerce.ts` - Value coercion validation (13 instances - all fixed)
  - Approximately 100 more instances remain (see `docs/TECHNICAL_DEBT_STATUS.md` for details)

- **Technical Debt: Logging Standardization** - Started standardizing logging
  - Replaced `console.warn` with `logger.warn()` in `DataSnapshotService.ts`
  - User-facing progress output in verbose mode remains as `console.error` (intentional)

- **Technical Debt: Type Consolidation** - Verified types are properly consolidated
  - All core types are in `@quantbot/core`, `packages/utils/src/types.ts` only re-exports for backward compatibility

- **Technical Debt: Test Independence** - Verified tests follow independence rules
  - Fee calculation tests are unit tests (correctly import production code to test it)
  - Golden fixture tests use independent constants and helpers
  - No issues found - tests are properly isolated

- **CRITICAL: StatePort serialization bug** - Fixed metadata update failures in OHLCV ingestion
  - StatePort adapter now correctly serializes JavaScript objects to JSON strings before passing to Python
  - Python scripts now receive properly formatted JSON strings instead of raw objects
  - Fixes Pydantic validation errors: "Input should be a valid string [type=string_type, input_value={...}, input_type=dict]"
  - Location: `packages/workflows/src/adapters/stateDuckdbAdapter.ts`

- **CRITICAL: DuckDB path propagation bug** - Fixed incorrect DuckDB path usage in OHLCV ingestion
  - OHLCV ingestion handler now correctly passes `duckdbPath` to `createOhlcvIngestionContext()`
  - StatePort adapter now uses the correct DuckDB path specified in workflow spec instead of default path
  - Fixes "Cannot open file" errors when using custom DuckDB paths (e.g., `data/calls.duckdb`)
  - Location: `packages/cli/src/commands/ingestion/ingest-ohlcv.ts`, `packages/workflows/src/context/createOhlcvIngestionContext.ts`

- **CRITICAL: Chain normalization bug** - Fixed BNB chain misidentification in OHLCV worklist generation
  - `normalize_chain()` function now correctly maps 'BNB' to 'bsc' (not defaulting to 'solana')
  - SQL queries in `ohlcv_worklist.py` now normalize 'BNB' to 'bsc' before grouping tokens
  - Fixes EVM tokens on BSC being misidentified as Solana tokens, causing "No candles returned" errors
  - Location: `tools/ingestion/ohlcv_worklist.py`

- **CRITICAL: EVM chain detection in surgical fetch** - Fixed hardcoded 'solana' chain in surgical OHLCV fetch
  - `surgicalOhlcvFetch` workflow now detects EVM addresses and passes 'ethereum' as chain hint
  - `OhlcvIngestionEngine` uses `fetchMultiChainMetadata` to determine precise EVM chain (ethereum/base/bsc)
  - Fixes EVM tokens being incorrectly queried as Solana tokens
  - Location: `packages/workflows/src/ohlcv/surgicalOhlcvFetch.ts`

### Added

- **Data Observatory Package** (`@quantbot/data-observatory`) - New package for canonical data models, snapshots, and quality checks
  - Canonical data model with unified event schemas (calls, trades, OHLCV, metadata, signals)
  - Snapshot system with content hashing for reproducibility (DataSnapshotRef format)
  - Data quality tools: coverage calculation, gap detection, anomaly detection
  - Integration tests for snapshot creation, event collection, and coverage calculation
  - Factory functions for easy setup
  - Documentation: README, integration tests guide, merge readiness checklist
  - Location: `packages/data-observatory/`
  - Interface contract ready for Branch A (simulation engine) integration

- **Regression Tests for Critical Bugs** - Created comprehensive regression tests to prevent bug recurrence
  - StatePort serialization tests: Verify objects are serialized/deserialized correctly (`packages/workflows/tests/unit/adapters/stateDuckdbAdapter.regression.test.ts`)
  - DuckDB path propagation tests: Verify correct path is passed to context creator (`packages/cli/tests/unit/handlers/ingestion/ingest-ohlcv.regression.test.ts`)
  - Chain normalization tests: Verify BNB→bsc mapping in Python function and SQL queries (`tools/ingestion/tests/test_chain_normalization_regression.py`, `tools/ingestion/tests/test_worklist_sql_normalization_regression.py`)
  - All tests include CRITICAL markers and documentation explaining what bugs they prevent
  - Tests follow debugging and regression test rules from `.cursor/rules/debugging-regression-test.mdc`

- **Comprehensive ARCHITECTURE.md**: Created detailed system architecture documentation in `docs/ARCHITECTURE.md`
  - Package dependency graph with visual diagram
  - Build order documentation (mandatory sequence)
  - Layer responsibilities (Foundation → Infrastructure → Service → Orchestration → Application)
  - Key architectural patterns (Workflow, Handler, Python/DuckDB integration)
  - Database architecture (DuckDB + ClickHouse)
  - Testing strategy and crypto backend rules
  - Critical rules summary (mint addresses, dependency injection, error handling)

- **Project TODO.md**: Created project roadmap and task tracking in `TODO.md`
  - Active development tasks
  - Backlog with priority levels
  - Architecture improvements roadmap
  - Quality gates and technical debt tracking

- **DuckDB Error Database**: Implemented persistent error tracking with DuckDB for better error diagnosis and analysis
  - `ErrorRepository` in `@quantbot/storage` for DuckDB-based error storage
  - Python script `tools/storage/duckdb_errors.py` for error operations
  - Updated `error-tracking.ts` to use persistent storage instead of in-memory (max 1000 errors)
  - Error tracking now supports querying by severity, service, time range, and error name
  - Errors persist across restarts and can be analyzed historically
  - Default database path: `data/databases/errors.db` (configurable via `ERROR_DB_PATH` env var)
  - Features: error statistics, recent errors, mark as resolved, pattern analysis by error name

- **Offline-Only Architecture**: Refactored `@quantbot/ohlcv` and `@quantbot/ingestion` to be fully offline-only
  - `@quantbot/ohlcv`: Now only queries ClickHouse and stores candles (no API calls)
  - `@quantbot/ingestion`: Now only generates worklists and manages metadata (no API calls)
  - `@quantbot/jobs`: New package for online orchestration (API calls, rate limiting, metrics)
  - Dependency boundary tests enforce offline-only constraints
  - See `docs/OHLCV_OFFLINE_REFACTORING_PLAN.md` for detailed architecture

- **Dependency Boundary Enforcement**: Added tripwire tests to prevent architectural violations
  - `@quantbot/ohlcv` must not depend on `@quantbot/api-clients`, `axios`, or `dotenv`
  - `@quantbot/ingestion` must not depend on `@quantbot/api-clients`, `axios`, or `dotenv`
  - Tests fail if forbidden dependencies are added

### Changed

- **README.md Overhaul**: Updated README to reflect current architecture and workflow model
  - Added three-layer architecture description (Pure Compute, Orchestration, Adapters)
  - Updated package structure with visual layer diagram
  - Added build order table with mandatory sequence
  - Updated database section (DuckDB as primary, ClickHouse for time-series)
  - Added workflow pattern documentation with code examples
  - Updated contributing guidelines with architectural rules
  - Removed outdated PostgreSQL references
  - Updated documentation links (ARCHITECTURE.md, TODO.md)

- **Surgical OHLCV Fetch Timeout**: Increased default coverage analysis timeout from 2 minutes to 5 minutes
  - Configurable via `OHLCV_COVERAGE_TIMEOUT_MS` environment variable
  - Prevents premature timeouts during large coverage analysis operations

- **OHLCV Architecture**: Moved API-calling logic from `@quantbot/ohlcv` to `@quantbot/jobs`
  - `OhlcvIngestionEngine` moved from `@quantbot/ohlcv` to `@quantbot/jobs`
  - `OhlcvFetchJob` refactored to use `fetchBirdeyeCandles` from `@quantbot/api-clients`
  - `storeCandles` remains in `@quantbot/ohlcv` for offline storage operations
- **Surgical OHLCV Fetch Improvements**: Enhanced surgical OHLCV fetch with progress tracking and better timeout handling
  - Increased coverage analysis timeout from 2 minutes to 5 minutes (configurable via `OHLCV_COVERAGE_TIMEOUT_MS`)
  - Added `--verbose` flag for detailed progress output and progress bars
  - Heartbeat messages every 10 seconds during coverage analysis to prevent appearance of hanging
  - Real-time progress bars for task execution showing current/total progress
  - Detailed logging for each task and interval being fetched

- **OHLCV Coverage Analysis Timeout Improvements**: Fixed timeout issues in `ohlcv analyze-coverage` command
  - Increased default timeout from 2 minutes to 5 minutes for both overall and caller-based coverage analysis
  - Timeout configurable via `OHLCV_COVERAGE_TIMEOUT_MS` environment variable
  - Prevents premature timeouts during large coverage analysis operations

- **OHLCV Coverage Analysis Performance Improvements**: Added parallel processing to coverage analysis scripts
  - Parallelized caller-month combination processing using ThreadPoolExecutor (8 workers by default)
  - Thread-safe caching with locks to prevent race conditions
  - Each thread uses its own ClickHouse client connection (fixes "Simultaneous queries on single connection" errors)
  - Configurable worker count via `OHLCV_COVERAGE_WORKERS` environment variable (default: 8)
  - Significant speedup for large coverage analyses (e.g., multiple callers × multiple months)
  - I/O-bound ClickHouse queries now execute in parallel instead of sequentially

- **OHLCV Coverage Analysis Process Cleanup**: Added automatic cleanup of hanging processes
  - Script automatically kills any hanging instances of itself before running (prevents multiple concurrent runs)
  - Uses SIGTERM for graceful shutdown, falls back to SIGKILL if needed
  - Disable with `--no-kill-hanging` flag if needed
  - Works on Linux/macOS systems with `ps` or `pgrep` commands

- **Birdeye OHLCV Fetch Parallel Processing**: Added parallel workers with per-worker rate limiting
  - `OhlcvFetchJob` now handles both fetch AND store in parallel (replaces fetch-only approach)
  - New `parallelWorkers` option (default: 1, sequential mode for backward compatibility)
  - New `rateLimitMsPerWorker` option (default: 330ms)
  - With 16 workers and 330ms delay: ~48.5 RPS (under 50 RPS limit)
  - Each worker processes items with independent rate limiting
  - Improved throughput for large worklists while respecting Birdeye API rate limits
  - Maintains backward compatibility - sequential mode still works with existing code
  - Configurable via `BIRDEYE_PARALLEL_WORKERS` and `BIRDEYE_RATE_LIMIT_MS_PER_WORKER` environment variables

- **OHLCV Ingestion Workflow Refactor**: Switched from fetch-only to fetch+store approach
  - Workflow now uses `OhlcvFetchJob` which handles both fetch AND store in parallel
  - Removed redundant sequential storage loop (was bottleneck)
  - Workflow now only handles DuckDB metadata updates after parallel fetch+store completes
  - Significantly faster ingestion for large worklists
  - `OhlcvBirdeyeFetch` (fetch-only) still available but no longer used by default workflows

- **Ingestion Architecture**: Removed all API client calls from `@quantbot/ingestion`
  - Removed ATH/ATL calculation (moved to simulation layer)
  - Removed contract validation and chain detection via API
  - `generateOhlcvWorklist` now generates worklists from DuckDB only (offline)
  - Telegram ingestion services no longer validate contracts via API

- **Build Order**: Updated build order to include `@quantbot/jobs`
  - `@quantbot/jobs` built after `@quantbot/ohlcv` and `@quantbot/api-clients`
  - `@quantbot/ingestion` built after `@quantbot/jobs`

### Removed

- **Dependencies**: Removed forbidden dependencies from offline packages
  - Removed `@quantbot/api-clients` from `@quantbot/ohlcv/package.json`
  - Removed `@quantbot/api-clients` from `@quantbot/ingestion/package.json`
  - Removed `axios` and `dotenv` from `@quantbot/ohlcv/package.json`
  - Removed `process.env` usage from `@quantbot/ohlcv` package files

- **API-Calling Functions**: Deprecated or removed API-calling functions
  - `fetchHybridCandles` in `candles.ts` (not exported, deprecated)
  - `fetchHistoricalCandlesForMonitoring` refactored to use offline storage only
  - ATH/ATL calculation removed from `OhlcvIngestionService`

### Fixed

- **Type Safety**: Fixed type errors in refactored code
  - Added `Chain` type import to `ohlcv-engine.ts`
  - Fixed interval type constraints to match API client interfaces
  - Updated test mocks to use `vi.hoisted()` for proper initialization

### Deprecated

- **PostgreSQL repositories and client** - All PostgreSQL functionality is deprecated in favor of:
  - DuckDB for event logging and data storage
  - Prometheus for live counters and alerting
  - See `docs/POSTGRES_DEPRECATION.md` for migration guide

## [Unreleased]

### Added

- **TypeScript Project References**: Added project references to all packages for incremental builds
  - All packages now use `composite: true` with explicit dependency references
  - Enables faster incremental builds and compile-time dependency checking
  - Better IDE support with proper type resolution
  - See [BUILD_SYSTEM.md](docs/BUILD_SYSTEM.md) for detailed documentation
- **Build System Documentation**: Created comprehensive build system documentation
  - `docs/BUILD_SYSTEM.md` - Complete guide to the build system, project references, and troubleshooting
  - Updated `docs/BUILD_STATUS.md` with current status and improvements

### Fixed

- **Circular Dependencies Resolved**: Fixed two circular dependencies that violated build ordering rules
  - Resolved `@quantbot/api-clients ↔ @quantbot/observability` circular dependency
    - Removed unused `@quantbot/api-clients` dependency from `observability/package.json`
    - Verified `observability` source code does not import from `api-clients`
  - Resolved `@quantbot/ingestion ↔ @quantbot/ohlcv` circular dependency
    - Moved `@quantbot/ingestion` from `dependencies` to `devDependencies` in `ohlcv/package.json`
    - Removed `@quantbot/ingestion` path mapping from `ohlcv/tsconfig.json`
    - Verified `ohlcv` only imports from `ingestion` in test files
  - Production-level circular dependencies eliminated, ensuring correct build order
  - All affected packages tested and verified working correctly
  - Updated `docs/ARCHITECTURAL_ISSUES.md` with resolution details

### Changed

- **Type Safety Improvements**: Fixed 42 linting warnings (203 → 161 remaining)
  - Replaced `Record<string, any>` with `Record<string, unknown>` in error classes
  - Fixed `any` types in error handlers (`error-handler.ts`, `errors.ts`)
  - Fixed `any` types in storage repositories (`TokensRepository.ts`)
  - Improved type safety in critical paths (error handling, API clients, storage)
- **Build Scripts**: All packages now use `tsc --build` for incremental compilation
  - Build scripts already configured correctly
  - Incremental builds enabled via TypeScript project references
  - Build caching configured in CI/CD workflow

### Added

- **CI/CD Workflows**: Added GitHub Actions workflows for automated builds and testing
  - `.github/workflows/build.yml` - Builds packages in order, runs type checking and linting
  - `.github/workflows/test.yml` - Runs test suites (unit, integration, property tests) with coverage
  - Caching for node_modules and build artifacts to speed up CI runs
  - Build order verification before building packages
- **Build Order Verification Script**: Added `scripts/verify-build-order.ts` to validate package build order
  - Checks that dependencies are built before dependents
  - Detects circular dependencies between packages
  - Validates build order matches expected sequence
  - Can be run locally or in CI
- **Architectural Issues Documentation**: Documented circular dependencies and build order violations for future resolution
  - Created `docs/ARCHITECTURAL_ISSUES.md` tracking two circular dependencies:
    - `@quantbot/api-clients ↔ @quantbot/observability` (api-clients uses observability, observability declares unused dependency)
    - `@quantbot/ingestion ↔ @quantbot/ohlcv` (ohlcv only imports ingestion in tests, should be devDependency)
  - Issues documented but not blocking current development
  - Resolution strategies and plan included for future work
- **Incremental Build Script**: Added `build:incremental` script to root `package.json`
  - Uses TypeScript's `tsc --build` for faster incremental compilation
  - Leverages TypeScript project references for dependency-aware builds
  - Faster rebuilds when only specific packages change
- **TypeScript Project References**: Added TypeScript project references for incremental builds and better dependency management
  - Added `composite: true` to root `tsconfig.json`
  - Added project references to all package `tsconfig.json` files following dependency order
  - Updated build scripts to use `tsc --build` for incremental compilation
  - Enables faster incremental builds and better IDE support

### Fixed

- **Linting Warnings**: Fixed 35 linting warnings (212 → 177 remaining)
  - Removed unused imports (DateTime, z, logger, etc.)
  - Fixed unused variables by prefixing with `_` or removing
  - Fixed `any` types in CLI handlers (ingest-ohlcv, run-simulation-duckdb)
  - Fixed `prefer-const` warnings
  - Fixed useless regex escapes in comprehensiveAddressExtraction.ts
  - Fixed type errors in simulation package (duckdb-storage-service.ts)

### Changed

- **Build Scripts**: Updated all package build scripts to use `tsc --build` instead of `tsc` or `tsc && tsc --emitDeclarationOnly`
  - Enables incremental compilation and dependency checking
  - Faster rebuilds when dependencies haven't changed
  - Better error messages for circular dependencies

### Fixed

- **Circular Dependency Resolved**: Moved shared functions to break circular dependency between `@quantbot/ohlcv` and `@quantbot/ingestion`
  - Moved `isEvmAddress` and `isSolanaAddress` to `@quantbot/utils`
  - Moved `fetchMultiChainMetadata` and `MultiChainMetadataCache` to `@quantbot/api-clients`
  - Updated all imports across codebase
  - Removed circular dependency reference from ohlcv tsconfig
  - TypeScript project references now work correctly

- **Module System Consistency**: Standardized all packages to CommonJS with proper TypeScript configuration
  - Updated `tsconfig.base.json` to use `"module": "commonjs"` and `"moduleResolution": "node"`
  - Verified all packages have consistent module system configuration (CommonJS for most, ESM for CLI/workflows/data)
  - Fixed test files to use CommonJS-compatible patterns where needed
  - Removed `.js` extensions from relative imports in CommonJS packages (standard CommonJS practice)
  - ESM packages (CLI, workflows, data) remain ESM as intended with proper `.js` extensions

### Added

- **DuckDB Ingestion Idempotency Foundation** (packages/ingestion)
  - Comprehensive idempotency test matrix covering: same input twice, partial runs, concurrent writes, schema mismatches
  - Enhanced DuckDB schema with `run_id` tracking, PRIMARY KEY constraints, and `ingestion_runs` table
  - Schema migration script (`tools/telegram/migrate_schema_idempotent.py`) for upgrading existing databases
  - Test suite documenting current state and target behavior (packages/ingestion/tests/duckdb-idempotency.test.ts)
  - Schema design documentation with implementation strategy (packages/ingestion/docs/DUCKDB_IDEMPOTENCY_SCHEMA.md)
  - Idempotency README with test matrix and migration path (packages/ingestion/tests/DUCKDB_IDEMPOTENCY_README.md)
- **Python Bridge Foundation Hardening** (packages/utils)
  - Comprehensive failure mode tests for PythonEngine subprocess execution (26 tests)
  - Handler integration tests verifying error propagation (17 tests)
  - Artifact verification tests ensuring file existence before claiming success (12 tests)
  - Test fixtures for Python tool misbehavior: non-JSON output, wrong schema, timeouts, huge output, non-determinism, missing artifacts
  - `PythonEngine.runScriptWithArtifacts()` method with optional artifact verification
  - Enhanced error context with Zod validation details, truncated stderr/stdout
- Comprehensive stress testing suite across all packages
- Input violence tests for address extraction and validation (packages/ingestion)
- Contract brutality tests for Python bridge failure modes (packages/utils)
- Storage discipline tests for DuckDB and ClickHouse idempotency (packages/storage)
- Pipeline invariants tests for run manifest completeness (packages/ingestion)
- Simulation stress tests for pathological candle sequences (packages/simulation)
- Chaos engineering tests for subprocess failures and resource exhaustion (packages/utils)
- Stress test fixtures: malicious addresses, malformed JSON, nasty candle sequences
- `vitest.stress.config.ts` - Dedicated configuration for stress tests
- `test:stress` npm script to run all stress tests
- Stress test documentation in `packages/*/tests/stress/README.md`

### Security

- **HIGH**: DuckDB ingestion schema enhanced with PRIMARY KEY constraints and run_id tracking - prevents duplicate data and enables idempotent ingestion (packages/ingestion)
- **HIGH**: Python bridge now validates tool output against schemas before returning - prevents silent data corruption (packages/utils)
- **HIGH**: Python bridge enforces artifact file existence verification - prevents "half-truth" runs where tools claim success but files are missing (packages/utils)
- **CRITICAL**: Fixed SQL injection vulnerability in ClickHouse queries - now uses parameterized queries with `{param:Type}` syntax
- **CRITICAL**: Mitigated InfluxDB query injection risk with input validation and string escaping (Flux limitation - best possible mitigation)

### Changed

- **CRITICAL**: Improved EventBus type safety - `EventHandler<T>` now defaults to `unknown` instead of `any`, uses `ApplicationEvent` for better type inference
- **CRITICAL**: Fixed database function type safety - `saveStrategy` and `saveCADrop` now use `Strategy[]` and `StopLossConfig` instead of `any`
- **CRITICAL**: Fixed all database function return type JSDoc comments to match actual return types
- Standardized error handling across codebase - replaced generic `Error` with `AppError` subclasses (`ValidationError`, `NotFoundError`, `ConfigurationError`, `ApiError`, `DatabaseError`, `TimeoutError`, `ServiceUnavailableError`) for better error clarity and debugging (packages/cli, packages/utils, packages/storage, packages/api-clients, packages/workflows, packages/ingestion, packages/ohlcv, packages/simulation, packages/core)
- Removed deprecated CSV cache system - all OHLCV data now uses ClickHouse via StorageEngine (packages/simulation, packages/ohlcv)

### Fixed

- **HIGH**: PythonEngine now includes Zod validation errors in error context for better debugging (packages/utils)
- **MEDIUM**: PythonEngine truncates large stderr/stdout in errors to prevent memory issues (packages/utils)
- **MEDIUM**: Fixed async syntax error in python-bridge integration test (packages/utils)
- **CRITICAL**: Fixed EventBus memory leak - event history now optional, periodic cleanup implemented, `clearHistory()` method added
- **CRITICAL**: Fixed EventBus HandlerMap memory leak - `removeAllListeners()` now clears handlerMap, periodic cleanup for orphaned handlers
- **CRITICAL**: Fixed RateLimitingMiddleware memory leak - added `cleanupExpiredWindows()` with periodic cleanup every 100 events
- **CRITICAL**: Fixed MetricsMiddleware memory leak - added max size limit (1000), TTL support (1 hour), automatic cleanup
- **CRITICAL**: Fixed WebSocket event listener memory leaks - added `cleanupWebSocket()` method to all WebSocket implementations (helius-monitor, helius-recorder, tenkan-kijun-alert-service, live-trade-alert-service)
- **CRITICAL**: Fixed CAMonitoringService EventEmitter memory leak - added `shutdown()` method to remove all listeners and clear active CAs

### Changed

- Refactored `BirdeyeClient` and `HeliusRestClient` to extend `BaseApiClient` - eliminated code duplication
- EventBus history is now optional via constructor parameter `enableHistory`
- EventBus now supports periodic cleanup via `cleanupIntervalMs` constructor option

### Added

- `@quantbot/api` package - Fastify-based REST API backend
- OpenAPI/Swagger documentation for API endpoints (`/api/docs`)
- StorageEngine pattern - Unified interface for all storage operations
- Comprehensive API routes for OHLCV, tokens, calls, simulations, and ingestion
- CHANGELOG.md - Version history tracking
- Security tests for ClickHouse parameterized queries (`OhlcvRepository.security.test.ts`)
- Memory leak prevention tests for EventBus, WebSocket cleanup, and CAMonitoringService
- `.cursor/rules/changelog-enforcement.mdc` - Enforces CHANGELOG updates
- `.cursor/rules/todo-tracking.mdc` - Enforces TODO completion tracking
- `.cursor/rules/documentation-organization.mdc` - Enforces documentation structure

### Changed

- Refactored OHLCV package to use StorageEngine instead of direct database calls
- Consolidated all storage operations into `@quantbot/storage` package
- Moved EventBus from `@quantbot/events` to `@quantbot/utils/events`
- Updated all packages to use direct imports instead of re-export packages

### Removed

- `@quantbot/data` package - Consolidated into `@quantbot/storage` and `@quantbot/api-clients`
- `@quantbot/events` package - Moved EventBus to `@quantbot/utils/events`
- `@quantbot/services` package - Services now in specialized packages

## [1.0.3] - 2025-12-11

### Added

- Package consolidation and refactoring
- StorageEngine pattern implementation
- Backend REST API with Fastify
- Updated documentation (README, ARCHITECTURE, TODO)

### Changed

- Major package restructuring for better separation of concerns
- All OHLCV operations now use StorageEngine
- Improved dependency management

### Fixed

- Import paths updated across 40+ files
- Test mocks updated to use StorageEngine
- Package.json dependencies cleaned up

## [1.0.2] - Previous Release

### Added

- Initial package structure
- OHLCV data management
- Simulation engine
- Monitoring services

## [1.0.1] - Previous Release

### Added

- Basic bot functionality
- Telegram integration
- Birdeye API integration

## [1.0.0] - Initial Release

### Added

- Initial project setup
- Core trading simulation functionality
- Database integration (PostgreSQL, ClickHouse)
- Basic monitoring capabilities

---

## Types of Changes

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes
