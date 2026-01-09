# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

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
