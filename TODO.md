# QuantBot TODO

> **Project roadmap and task tracking**

Last updated: 2025-01-24 (Recent: Slice Export & Analyze workflow implementation, aggregateCandles implementation, API package fixes)

---

## 🔥 Active Development

### Wiring Improvements & Verification

- [x] **Phase 1: Verify Wiring Improvements** ✅
  - [x] Test `StrategiesRepository` through `CommandContext` in list-strategies command
  - [x] Run type checking to ensure no TypeScript errors from wiring changes
  - [x] Verify all handlers can access services through context
  - [x] Test that workflows use `WorkflowContext` (no direct instantiation)
  - [x] Document any issues found during verification
  - [x] Created verification test: `command-context-wiring.test.ts` (5 tests passing)
  - [x] Created verification status document: `wiring-verification-status.md`

- [x] **Phase 2: Complete Stub Port Migration** ✅
  - [x] Review `ExecutionStubAdapter` implementation and requirements
  - [x] Document migration path for replacing stub with real execution adapter
  - [x] Plan real execution client integration (Jito, RPC) when ready
  - [x] Update `createProductionPorts.ts` with migration notes
  - [x] Keep stub for safety (dry-run by default) until real adapter is ready
  - [x] Created migration guide: `docs/architecture/execution-port-migration.md`

- [x] **Phase 3: Add Wiring Pattern Tests** ✅
  - [x] Create tests that verify handlers use `CommandContext` services
  - [x] Create tests that verify workflows use `WorkflowContext` (no direct instantiation)
  - [x] Add integration tests for wiring paths
  - [x] Add tests for context factory functions
  - [x] Verify composition root patterns in tests
  - [x] Document acceptable direct instantiation in composition roots
  - [x] Created handler-wiring-patterns.test.ts
  - [x] Created wiring-patterns.test.ts (workflow context)
  - [x] Created wiring-integration.test.ts (integration tests)

- [x] **Phase 4: Architectural Improvements** ✅
  - [x] Review remaining direct instantiations in non-composition-root files
  - [x] Ensure all handlers follow wiring patterns
  - [x] Document any exceptions to wiring patterns
  - [x] Created wiring-exceptions.md with comprehensive documentation
  - [x] All direct instantiations are documented as acceptable in composition roots
  - [ ] Add ESLint rules to enforce wiring patterns (future enhancement)

- [ ] **Phase 5: Documentation Updates**
  - [ ] Update CHANGELOG.md with wiring improvements
  - [ ] Add wiring examples to architecture docs
  - [ ] Create wiring migration guide for future changes
  - [ ] Update README with wiring pattern references

### Slice Export & Analyze Workflow

- [x] **Phase 0: Foundation**
  - [x] SliceValidator port interface (`packages/workflows/src/slices/ports.ts`)
  - [x] Handler purity ESLint rules (forbid fs/duckdb/clickhouse imports in workflows)
  - [x] Manifest version gate in analyzer (fail loud on unknown versions)
  - [x] SliceValidator adapter implementation (AJV schema validation + file checks)

- [x] **Phase 1: Core Implementation**
  - [x] Pure workflow handler (`exportAndAnalyzeSlice`)
  - [x] ClickHouse → Parquet exporter adapter (`candles_1m` dataset)
  - [x] DuckDB → Analysis adapter (SQL queries)
  - [x] Integration tests with real ClickHouse data
  - [x] Input validation (time range, max 90 days, token format)

- [x] **Phase 2: CLI Integration**
  - [x] CLI command definition (`quantbot slices export`)
  - [x] CLI handler implementation
  - [x] Command registration
  - [x] CLI validation command (`quantbot slices validate`)

- [ ] **Phase 3: Error Handling & Robustness**
  - [ ] Comprehensive error handling (ClickHouse retries, timeouts, empty results)
  - [ ] End-to-end test for full export+analyze pipeline
  - [ ] Empty result set handling improvements

- [ ] **Phase 4: Dataset Expansion**
  - [ ] Dataset mapping registry for multiple datasets
  - [ ] `candles_5m` dataset support
  - [ ] Conditional `indicators_1m` support (if canonical in ClickHouse)

- [ ] **Phase 5: Analysis Enhancements**
  - [ ] Analysis result storage (Parquet/CSV output)
  - [ ] Named analysis plans registry

- [ ] **Phase 6: Performance & Scaling**
  - [ ] Date-based partitioning (one Parquet file per day)
  - [ ] Chunking within day if single day is too big (token buckets or time sub-windows)
  - [ ] Compression support (snappy, zstd, gzip) - after file splitting proven

- [ ] **Phase 7: Developer Experience**
  - [ ] Slice comparison tool CLI command
  - [ ] Comprehensive documentation (README, guides, architecture)

### Architecture Enforcement

- [x] Resolve circular dependencies (api-clients ↔ observability, ohlcv ↔ ingestion)
- [x] Create comprehensive ARCHITECTURE.md
- [x] Complete workflow migration for all CLI commands (all handlers use defineCommand pattern)
- [x] Add ESLint boundaries for CLI wrapper pattern (execute/normalizeOptions imports)
- [x] Lock in defineCommand wrapper pattern with golden tests
- [x] Implement pre-commit hooks for workflow contract compliance (already implemented in .husky/pre-commit)

### CLI Handler Migration

- [x] Standardize command wrapper pattern (defineCommand) with ESLint enforcement
- [x] Add golden tests for defineCommand coercion (lags-ms, intervals arrays)
- [x] Verify sweep path end-to-end (all output files created correctly)
- [x] Migrate remaining handlers to pure function pattern
- [x] Add handler tests for all commands (152 handler tests, all passing)
- [x] Implement litmus tests (REPL-friendly handlers) - All handlers verified REPL-friendly
- [x] Verify all handlers follow pure function pattern (no CLI dependencies)
- [x] Document stub handlers for future implementation
- [x] Migrate `calls export` to use defineCommand (already migrated, uses camelCase schema)

### DuckDB Migration

- [x] Core DuckDB storage implementation
- [x] Python engine integration
- [x] Complete migration of remaining SQLite data (SQLite removed, strategies already in DuckDB)
- [x] Add DuckDB stress tests
- [x] Document DuckDB schema

---

## 📋 Backlog

### High Priority

- [x] **API Package**: Create `@quantbot/api` with Fastify endpoints
  - Health checks
  - OHLCV endpoints
  - Simulation run management
  - OpenAPI documentation

- [x] **Improved Testing** (Complete - gaps filled and automated)
  - [x] Property tests for financial calculations (simulation: fees, RSI, moving averages, position PnL, execution costs; CLI: mint addresses, date parsing; ingestion: address validation, idempotency)
  - [x] Fuzzing tests for parsers (argument parser, telegram parser, Birdeye client, PnL calculations, config loader, overlay parser)
  - [x] Stress tests for critical paths (OHLCV ingestion, simulation candle sequences, storage idempotency)
  - [x] Golden tests with fixtures (workflows, simulation, OHLCV, analytics, storage, jobs)
  - [x] Property tests coverage gaps (all financial calculations now have property tests - some may reveal edge cases to fix)
  - [x] Fuzzing coverage gaps (all parsers now fuzzed)
  - [x] Stress test automation (CI integration with weekly scheduled runs + manual dispatch via `.github/workflows/stress-tests.yml`)

- [x] **Observability**
  - Metrics collection (Prometheus format) ✅
  - Distributed tracing ✅
  - Alerting for critical failures ✅

### Medium Priority

- [x] **Web Dashboard** (`@quantbot/web`) - **IMPLEMENTED** ✅
  - [x] Next.js-based analytics UI (all pages and components)
  - [x] Simulation visualization (runs, results, events)
  - [x] Caller performance dashboard
  - [x] API routes (analytics, simulations, health check)
  - [x] Health check endpoint (`/api/health`)
  - [x] Basic tests (API routes)
  - [ ] Component tests (requires Next.js test setup)
  - [ ] Production deployment
  - [ ] Monitoring integration

- [ ] **Real-Time Monitoring** (`@quantbot/monitoring`)
  - WebSocket-based price updates
  - Alert system for targets/stops
  - Ichimoku cloud analysis

- [ ] **Strategy Optimization**
  - ML-based strategy finder
  - Parameter sweep automation
  - Backtest result comparison

### Low Priority

- [ ] **Live Trading** (`@quantbot/trading`)
  - Strategy-based execution
  - Risk controls
  - Position management

- [ ] **Telegram Bot** (`@quantbot/bot`)
  - Interactive commands
  - Real-time notifications
  - Simulation from chat

---

## ✅ Completed

### 2025-01-24

- [x] **Slice Export & Analyze Workflow - Phase 0-2 Complete**
  - [x] Implemented pure workflow handler `exportAndAnalyzeSlice` with clean architecture
  - [x] Created ClickHouse → Parquet exporter adapter for `candles_1m` dataset
  - [x] Created DuckDB analyzer adapter with SQL query support
  - [x] Added SliceValidator port and adapter (AJV schema validation + file checks)
  - [x] Implemented handler purity ESLint rules (forbid fs/duckdb/clickhouse imports)
  - [x] Added manifest version gate in analyzer
  - [x] Created integration tests with real ClickHouse data
  - [x] Added input validation (time range, max 90 days, token format)
  - [x] Implemented CLI commands: `quantbot slices export` and `quantbot slices validate`
  - [x] All core functionality working, committed to `feature/slice-export-analyze` branch
  - [ ] Next: Error handling, E2E tests, dataset registry, multi-file partitioning

- [x] **Fixed API package build errors**
  - Added missing `@quantbot/observability` dependency
  - Fixed Fastify type issues with server.start() method
  - All TypeScript errors resolved, build passes
- [x] **Implemented aggregateCandles function**
  - Created `aggregateCandles` in `packages/simulation/src/types/candle.ts`
  - Supports aggregation to higher timeframes (1H, 4H, 1D, etc.)
  - Properly sorts candles and groups into time buckets
  - Calculates correct OHLCV values (open from first, close from last, high/low from max/min, volume summed)
  - Exported from package index
- [x] **Enabled and verified aggregateCandles tests**
  - Removed `describe.skip` from `candles-extended.test.ts`
  - All 7 tests passing
  - Tests cover: 1H, 4H, 1D aggregation, empty arrays, sorting, multiple buckets, high/low calculations
- [x] **Fixed DataSnapshotService context type issues**
  - Updated to use `createQueryCallsDuckdbContext()` for proper context with services
  - Resolved TypeScript errors about missing `services` property

### 2025-01-23

- [x] **Completed CLI migration testing**
  - Added comprehensive tests for artifact handlers (15 new tests)
  - Verified all handlers follow pure function pattern (152 handler tests total)
  - Added isolation/litmus tests for REPL-friendly verification
  - Documented stub handlers for future implementation
  - All handlers verified compliant with architecture pattern
- [x] **Completed workflow implementations**
  - Implemented `calls.list()` using DuckDB query
  - Implemented `simulationRuns.create()` using DuckDBStorageService
  - Implemented `simulationResults.insertMany()` using ClickHouse service
  - Created `queryCallsDuckdb` workflow and context factory
  - Re-implemented `CallDataLoader.loadCalls()` using workflow

### 2025-12-23

- [x] **Fixed critical OHLCV ingestion bugs**
  - StatePort serialization bug (objects now correctly serialized to JSON strings)
  - DuckDB path propagation bug (correct path now passed to context creator)
  - Chain normalization bug (BNB now correctly maps to bsc, not solana)
  - EVM chain detection in surgical fetch (now detects EVM addresses correctly)
- [x] **Created comprehensive regression tests**
  - StatePort adapter regression tests (4 tests, all passing)
  - OHLCV ingestion handler regression tests (2 tests)
  - Chain normalization regression tests (8 Python tests, all passing)
  - All tests include CRITICAL markers and documentation
- [x] **Locked in CLI wrapper pattern to prevent normalization drift**
  - Added ESLint rules to ban direct imports of execute()/normalizeOptions outside core
  - Created golden tests for defineCommand coercion (lags-ms, intervals arrays)
  - Verified sweep path creates all required output files correctly
  - Documented pattern in `packages/cli/docs/WRAPPER_PATTERN_LOCKED.md`
  - Pattern now prevents "normalizeOptions v7" regression
- [x] Updated CHANGELOG.md with bug fixes and regression tests
- [x] Updated README.md with regression testing requirements

### 2025-12-20

- [x] Created comprehensive ARCHITECTURE.md documentation
- [x] Created TODO.md for task tracking
- [x] Updated README.md with current architecture

### 2025-01-19

- [x] Resolved circular dependency: @quantbot/api-clients ↔ @quantbot/observability
- [x] Resolved circular dependency: @quantbot/ohlcv ↔ @quantbot/ingestion
- [x] Documented architectural issues in ARCHITECTURAL_ISSUES.md

### Previous

- [x] Monorepo structure with pnpm workspaces
- [x] Core package with types and interfaces
- [x] Utils package with EventBus, logger, PythonEngine
- [x] Storage package with DuckDB integration
- [x] API clients for Birdeye and Helius
- [x] OHLCV package with hybrid candle fetching
- [x] Simulation engine (pure compute, no I/O)
- [x] Ingestion for Telegram export parsing
- [x] CLI with Commander.js
- [x] Workflows package for orchestration
- [x] Build ordering rules and verification

---

## 🏗️ Architecture Improvements

### Immediate

1. **Workflow Enforcement**
   - All multi-step flows must go through workflows
   - CLI handlers are thin adapters only
   - WorkflowContext provides all dependencies

2. **Handler Pattern**
   - Pure functions that return data
   - No console.log, no process.exit
   - Testable in isolation

3. **Python Integration**
   - Services wrap PythonEngine
   - Zod validation for all outputs
   - No direct subprocess calls in handlers

### Future

1. **Event Sourcing**
   - All state changes as events
   - Replay capability
   - Audit trail

2. **Plugin System**
   - Custom strategy plugins
   - Data source plugins
   - Output format plugins

---

## 📊 Quality Gates

### Per PR

- [ ] Unit tests for all new functions
- [ ] Property tests for math/financial calculations
- [ ] Handler tests for CLI commands
- [ ] Documentation updates
- [ ] CHANGELOG entry
- [ ] No forbidden imports
- [ ] Build passes

### Per Release

- [ ] All tests pass
- [ ] Coverage doesn't decrease
- [ ] Stress tests pass
- [ ] Documentation reviewed
- [ ] Breaking changes documented

---

## 🔧 Technical Debt

### Known Issues

- [ ] Inconsistent error handling across packages
- [ ] Some tests share prod math helpers (should be independent)
- [ ] Some integration tests failing (OhlcvIngestionService.integration.test.ts, duckdb-idempotency.test.ts) - pre-existing test setup issues, not related to recent bug fixes

### Cleanup

- [x] Remove deprecated SQLite code after full DuckDB migration
- [ ] Consolidate duplicate type definitions
- [ ] Standardize logging format across packages
- [ ] Clean up unused dependencies

---

## 📚 Documentation

### Needs Creation

- [x] ARCHITECTURE.md - System architecture
- [x] TODO.md - Task tracking
- [x] WRAPPER_PATTERN_LOCKED.md - CLI wrapper pattern documentation
- [x] CONTRIBUTING.md - Contribution guidelines
- [ ] API.md - API documentation
- [ ] DEPLOYMENT.md - Deployment guide

### Needs Update

- [x] README.md - Reflect current architecture
- [ ] Package READMEs - Consistent format
- [ ] Workflow documentation - All workflows documented

---

## 📈 Metrics & Goals

### Test Coverage

- Current: ~70%
- Target: 80%+ for all packages

### Build Time

- Current: ~30s
- Target: <20s with caching

### Package Health

- Zero circular dependencies ✅
- All packages build independently ✅
- TypeScript strict mode ✅

---

_This TODO is synchronized with the codebase. Update as tasks are completed._
