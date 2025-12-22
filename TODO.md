# QuantBot TODO

> **Project roadmap and task tracking**

Last updated: 2025-12-20

---

## 🔥 Active Development

### Architecture Enforcement

- [x] Resolve circular dependencies (api-clients ↔ observability, ohlcv ↔ ingestion)
- [x] Create comprehensive ARCHITECTURE.md
- [ ] Complete workflow migration for all CLI commands
- [ ] Add ESLint boundaries for forbidden imports
- [ ] Implement pre-commit hooks for workflow contract compliance

### CLI Handler Migration

- [ ] Migrate remaining handlers to pure function pattern
- [ ] Add handler tests for all commands
- [ ] Implement litmus tests (REPL-friendly handlers)
- [ ] Document Python/DuckDB integration pattern

### DuckDB Migration

- [x] Core DuckDB storage implementation
- [x] Python engine integration
- [ ] Complete migration of remaining SQLite data
- [ ] Add DuckDB stress tests
- [ ] Document DuckDB schema

---

## 📋 Backlog

### High Priority

- [ ] **API Package**: Create `@quantbot/api` with Fastify endpoints
  - Health checks
  - OHLCV endpoints
  - Simulation run management
  - OpenAPI documentation

- [ ] **Improved Testing**
  - Property tests for all financial calculations
  - Fuzzing tests for parsers
  - Stress tests for critical paths
  - Golden tests with fixtures

- [ ] **Observability**
  - Metrics collection (Prometheus format)
  - Distributed tracing
  - Alerting for critical failures

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

- [ ] Some CLI handlers still have business logic (migrate to workflows)
- [ ] Inconsistent error handling across packages
- [ ] Missing property tests for financial calculations
- [ ] Some tests share prod math helpers (should be independent)

### Cleanup

- [ ] Remove deprecated SQLite code after full DuckDB migration
- [ ] Consolidate duplicate type definitions
- [ ] Standardize logging format across packages
- [ ] Clean up unused dependencies

---

## 📚 Documentation

### Needs Creation

- [x] ARCHITECTURE.md - System architecture
- [x] TODO.md - Task tracking
- [ ] CONTRIBUTING.md - Contribution guidelines
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
