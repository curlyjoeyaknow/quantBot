# QuantBot TODO

> **Project roadmap and task tracking**

Last updated: 2025-01-23 (Backlog items completed: SQLite cleanup, API package, Observability)

---

## 🔥 Active Development

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

- [ ] **Web Dashboard** (`@quantbot/web`)
  - Next.js-based analytics UI
  - Simulation visualization
  - Caller performance dashboard

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
