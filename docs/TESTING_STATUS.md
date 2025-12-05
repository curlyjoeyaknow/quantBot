# Testing Status & Coordination Document

**Last Updated**: 2025-01-XX  
**Current Coverage**: ~17.69% (Target: 50%)  
**Test Files**: 39 passing  
**Total Tests**: 452 passing

## 🎯 Goal
Reach 50% code coverage by adding comprehensive tests for all critical modules.

---

## ✅ Tests Created (Working)

### Core Simulation Engine
- ✅ `tests/unit/simulation-engine-extended.test.ts` - Edge cases (empty candles, single candle, zero percent, high targets, trailing stops)
- ✅ `tests/unit/simulation-engine-class.test.ts` - SimulationEngine class (data provider, sinks, concurrency, error handling)
- ✅ `tests/unit/simulation-signals-integration.test.ts` - Entry/exit signals, re-entry scenarios, cost multipliers
- ✅ `tests/unit/simulation-ladders.test.ts` - Laddered entries/exits (sequential, parallel, with signals)
- ✅ `tests/unit/simulation-complex-scenarios.test.ts` - Complex entry/exit scenarios, re-entry, ladders, cost impact

### Strategy & Configuration
- ✅ `tests/unit/config-validation.test.ts` - Zod schema validation for all config types
- ✅ `tests/unit/strategy-builder-extended.test.ts` - Builder functions, validation edge cases
- ✅ `tests/unit/presets.test.ts` - Strategy presets (100% coverage)
- ✅ `tests/unit/target-resolver.test.ts` - Target resolution from mint/file configs

### Indicators & Signals
- ✅ `tests/unit/indicators.test.ts` - SMA, EMA, moving averages, cross detection, bullish/bearish signals
- ✅ `tests/unit/ichimoku-extended.test.ts` - Ichimoku calculations, signal detection, formatting
- ✅ `tests/unit/signals.test.ts` - Signal evaluation engine (79.22% coverage)

### Data Loaders
- ✅ `tests/unit/csv-loader.test.ts` - CSV loading, bot message filtering, chain detection
- ✅ `tests/unit/caller-loader.test.ts` - Caller alert loading, date ranges, limits
- ✅ `tests/unit/clickhouse-loader.test.ts` - ClickHouse queries, custom queries, candle loading
- ✅ `tests/unit/data-loader-factory.test.ts` - Loader factory, registration

### Services
- ✅ `tests/unit/session-service.test.ts` - Session CRUD operations, event emission
- ✅ `tests/unit/strategy-service.test.ts` - Strategy CRUD, default strategy management
- ✅ `tests/unit/simulation-service.test.ts` - Simulation execution, saving, repeating
- ✅ `tests/unit/results-service.test.ts` - Result aggregation, chart generation, strategy comparison
- ✅ `tests/unit/ohlcv-service.test.ts` - OHLCV fetching, ingestion, caching

### Utilities
- ✅ `tests/unit/error-handler.test.ts` - Error handling, retry logic, safe async
- ✅ `tests/unit/errors.test.ts` - Custom error classes
- ✅ `tests/unit/pumpfun.test.ts` - Pump.fun utilities
- ✅ `tests/unit/logging-config.test.ts` - Log level configuration

### Storage & Sinks
- ✅ `tests/unit/sinks.test.ts` - ClickHouse sink for simulation results (98.3% coverage)
- ✅ `tests/unit/postgres-client.test.ts` - Postgres client (basic tests)

### Optimization
- ✅ `tests/unit/optimization-grid.test.ts` - Parameter grid generation, focused grids
- ✅ `tests/unit/optimizer.test.ts` - Strategy optimizer, concurrent execution, invalid strategy handling

### Candles
- ✅ `tests/unit/candles-extended.test.ts` - Aggregation, interval calculations, edge cases

---

## ⚠️ Tests Excluded (Need Fixing)

These tests exist but are currently excluded in `vitest.config.ts` due to issues:

1. **Integration Tests** - `tests/integration/**/*.test.ts`
   - Issue: ClickHouse integration issues
   - Needs: Proper ClickHouse test setup/mocking

2. **ServiceContainer** - `tests/unit/ServiceContainer.test.ts`
   - Issue: Jest mock compatibility
   - Needs: Convert to Vitest mocks

3. **Helius Tests** - `tests/unit/helius-monitor.test.ts`, `tests/unit/helius.test.ts`
   - Issue: Jest mock issues
   - Needs: Vitest mock conversion

4. **Live Trade Tests** - `tests/unit/live-trade-database.test.ts`, `tests/unit/live-trade-strategies.test.ts`
   - Issue: Mock issues with sqlite3
   - Needs: Better sqlite3 mocking strategy

5. **Logger Tests** - `tests/unit/logger.test.ts`, `tests/unit/logger-nextjs.test.ts`, `tests/unit/logging-middleware.test.ts`
   - Issue: Console spy issues
   - Needs: Vitest-compatible logger mocking

6. **Command Handlers** - `tests/unit/BacktestCommandHandler.test.ts`, `tests/unit/StrategyCommandHandler.test.ts`
   - Issue: Some failures
   - Needs: Debug and fix specific test cases

7. **Database Tests** - `tests/unit/database.test.ts`
   - Issue: Mock issues
   - Needs: Better database mocking

8. **Candles Tests** - `tests/unit/candles.test.ts`, `tests/unit/candles_comprehensive.test.ts`
   - Issue: Mock issues with fs/axios
   - Needs: Updated mocks for Vitest

---

## 📋 Next Tests to Create (Priority Order)

### High Priority - Zero/Low Coverage Areas

#### 1. **OHLCV Engine** (0% coverage)
- **File**: `src/services/ohlcv-engine.ts`
- **Priority**: HIGH - Core data fetching service
- **Tests Needed**:
  - `initialize()` - ClickHouse initialization
  - `fetch()` - Multi-layer caching (ClickHouse → CSV → API)
  - `batchFetch()` - Batch operations
  - `getStats()` - Statistics calculation
  - Cache-only mode
  - Ingestion logic
- **Status**: 🔴 Not Started
- **Assigned To**: Available

#### 2. **Token Filter Service** (0% coverage)
- **File**: `src/services/token-filter-service.ts`
- **Priority**: HIGH - Token querying service
- **Tests Needed**:
  - `filterTokens()` - Complex filtering logic
  - `getTokensFromClickHouse()` - ClickHouse queries
  - `checkTokenHasCandleData()` - Data existence checks
  - `getTokenStats()` - Statistics aggregation
  - `checkTokenHasCaller()` - Caller filtering
- **Status**: 🔴 Not Started
- **Assigned To**: Available

#### 3. **OHLCV Aggregator** (0% coverage)
- **File**: `src/services/aggregation/ohlcv-aggregator.ts`
- **Priority**: MEDIUM - Data aggregation
- **Tests Needed**:
  - Aggregation logic
  - Interval conversion
  - Edge cases
- **Status**: 🔴 Not Started
- **Assigned To**: Available

#### 4. **Monitoring Services** (8.37% coverage)
- **Files**: `src/monitoring/*.ts`
- **Priority**: MEDIUM - Real-time monitoring
- **Tests Needed**:
  - `src/monitoring/ca-monitoring-service.ts` - CA tracking
  - `src/monitoring/live-trade-alerts.ts` - Alert generation
  - `src/monitoring/transaction-parser.ts` - Transaction parsing
  - `src/monitoring/alert-service.ts` - Alert management
- **Status**: 🔴 Not Started
- **Assigned To**: Available

#### 5. **Analysis Module** (0% coverage)
- **Files**: `src/analysis/*.ts`
- **Priority**: MEDIUM - Result analysis
- **Tests Needed**:
  - `result-analyzer.ts` - Main analyzer
  - `metrics/pnl-metrics.ts` - PnL calculations
  - `metrics/risk-metrics.ts` - Risk metrics
  - `metrics/trade-metrics.ts` - Trade statistics
- **Status**: 🔴 Not Started
- **Assigned To**: Available

#### 6. **Reporting Module** (0% coverage)
- **Files**: `src/reporting/*.ts`
- **Priority**: LOW - Report generation
- **Tests Needed**:
  - `report-generator.ts` - Report generation
  - `formats/csv-reporter.ts` - CSV export
  - `formats/json-reporter.ts` - JSON export
- **Status**: 🔴 Not Started
- **Assigned To**: Available

#### 7. **Repeat Simulation Helper** (0% coverage)
- **File**: `src/utils/RepeatSimulationHelper.ts`
- **Priority**: MEDIUM - User workflow helper
- **Tests Needed**:
  - `repeatSimulation()` - Session priming
  - Message formatting
- **Status**: 🔴 Not Started (excluded due to DateTime issues)
- **Assigned To**: Available

#### 8. **Chat Extraction Engine** (0% coverage)
- **File**: `src/services/chat-extraction-engine.ts`
- **Priority**: MEDIUM - CA extraction from messages
- **Tests Needed**:
  - Address extraction
  - Chain detection
  - Metadata parsing
- **Status**: 🔴 Not Started
- **Assigned To**: Available

#### 9. **Caller Tracking** (0% coverage)
- **File**: `src/services/caller-tracking.ts`
- **Priority**: MEDIUM - Caller management
- **Tests Needed**:
  - Caller registration
  - Call tracking
  - Statistics
- **Status**: 🔴 Not Started
- **Assigned To**: Available

#### 10. **Ichimoku Workflow Service** (0% coverage)
- **File**: `src/services/IchimokuWorkflowService.ts`
- **Priority**: MEDIUM - Workflow management
- **Tests Needed**:
  - Workflow steps
  - Token validation
  - Monitoring setup
- **Status**: 🔴 Not Started
- **Assigned To**: Available

### Medium Priority - Improve Existing Coverage

#### 11. **Simulation Engine** (55.91% coverage → Target: 70%+)
- **File**: `src/simulation/engine.ts`
- **Priority**: MEDIUM - Core engine
- **Tests Needed**:
  - More ladder execution scenarios
  - Complex re-entry chains
  - Edge cases with cost multipliers
  - Signal combinations (AND/OR logic)
- **Status**: 🟡 In Progress
- **Assigned To**: Available

#### 12. **Candles Module** (Need to check current coverage)
- **File**: `src/simulation/candles.ts`
- **Priority**: MEDIUM
- **Tests Needed**:
  - `fetchHybridCandles()` - More edge cases
  - Cache behavior
  - Error handling
- **Status**: 🟡 Partial
- **Assigned To**: Available

---

## 🔧 Areas for Other Agents

### Agent 1: OHLCV & Data Services
**Focus**: High-impact services with zero coverage
- ✅ `src/services/ohlcv-engine.ts` - OHLCV Engine
- ✅ `src/services/token-filter-service.ts` - Token Filter Service
- ✅ `src/services/aggregation/ohlcv-aggregator.ts` - Aggregator
- ✅ `src/services/ohlcv-ingestion.ts` - Ingestion logic
- ✅ `src/services/ohlcv-query.ts` - Query logic

**Estimated Impact**: +3-5% coverage

### Agent 2: Monitoring & Real-time Services
**Focus**: Monitoring and alert services
- ✅ `src/monitoring/ca-monitoring-service.ts`
- ✅ `src/monitoring/live-trade-alerts.ts`
- ✅ `src/monitoring/transaction-parser.ts`
- ✅ `src/monitoring/alert-service.ts`
- ✅ `src/monitoring/pumpfun-decoder.ts`

**Estimated Impact**: +2-3% coverage

### Agent 3: Analysis & Reporting
**Focus**: Analysis and reporting modules
- ✅ `src/analysis/result-analyzer.ts`
- ✅ `src/analysis/metrics/*.ts` - All metric calculators
- ✅ `src/reporting/report-generator.ts`
- ✅ `src/reporting/formats/*.ts` - All format exporters

**Estimated Impact**: +2-3% coverage

### Agent 4: Workflow & Helper Services
**Focus**: User workflow and helper services
- ✅ `src/services/IchimokuWorkflowService.ts`
- ✅ `src/services/chat-extraction-engine.ts`
- ✅ `src/services/caller-tracking.ts`
- ✅ `src/utils/RepeatSimulationHelper.ts` (fix DateTime issues)
- ✅ `src/services/TextWorkflowHandler.ts` (if feasible)

**Estimated Impact**: +2-3% coverage

### Agent 5: Fix Excluded Tests
**Focus**: Convert excluded tests to working Vitest tests
- ✅ Fix `tests/unit/ServiceContainer.test.ts`
- ✅ Fix `tests/unit/helius-monitor.test.ts`
- ✅ Fix `tests/unit/live-trade-database.test.ts`
- ✅ Fix `tests/unit/logger.test.ts`
- ✅ Fix `tests/unit/candles.test.ts`
- ✅ Fix `tests/integration/**/*.test.ts` (if possible)

**Estimated Impact**: +2-4% coverage

### Agent 6: Edge Cases & Deep Coverage
**Focus**: Improve coverage of already-tested modules
- ✅ More simulation engine edge cases
- ✅ More signal combination tests
- ✅ More ladder execution scenarios
- ✅ More cost multiplier scenarios
- ✅ More re-entry chain tests

**Estimated Impact**: +3-5% coverage

---

## 📊 Coverage by Module (Current)

| Module | Coverage | Status | Priority |
|--------|----------|--------|----------|
| `src/simulation` | 55.91% | 🟡 Good | Improve to 70%+ |
| `src/data/loaders` | 78.21% | 🟢 Excellent | Maintain |
| `src/storage` | 21.88% | 🟡 Needs Work | Medium |
| `src/services` | 12.75% | 🔴 Low | **HIGH** |
| `src/utils` | 16.9% | 🔴 Low | Medium |
| `src/monitoring` | 8.37% | 🔴 Very Low | **HIGH** |
| `src/analysis` | 0% | 🔴 None | Medium |
| `src/reporting` | 0% | 🔴 None | Low |
| `src/config` | 100% | 🟢 Complete | Maintain |

---

## 🎯 Quick Wins (High Impact, Low Effort)

1. **OHLCV Engine** - Core service, straightforward to test
2. **Token Filter Service** - Well-structured, easy to mock
3. **Analysis Metrics** - Pure functions, easy to test
4. **Repeat Simulation Helper** - Simple utility, just needs DateTime fix

---

## 📝 Testing Guidelines

### Test File Naming
- Use `*.test.ts` for test files
- Place in `tests/unit/` for unit tests
- Place in `tests/integration/` for integration tests

### Mock Strategy
- Use Vitest's `vi.mock()` for module mocking
- Use `vi.fn()` for function mocking
- Avoid Jest-specific APIs (use Vitest equivalents)

### Coverage Goals
- **Critical modules** (engine, services): 70%+
- **Utilities**: 60%+
- **Supporting modules**: 50%+

### Test Structure
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('module-name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('feature', () => {
    it('should do something', () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

---

## 🚫 Areas to Avoid (For Now)

1. **Integration tests** - Need proper infrastructure setup
2. **Bot command handlers** - Complex, need full bot context
3. **WebSocket tests** - Network-dependent, complex mocking
4. **Database tests** - Need better sqlite3 mocking strategy

---

## 📈 Progress Tracking

- **Week 1**: Migrated to Vitest, created foundation tests
- **Current**: 17.69% coverage, 39 test files, 452 tests
- **Target**: 50% coverage
- **Remaining**: ~32% coverage needed

---

## 🔄 Update This Document

When adding new tests:
1. Add to "Tests Created" section
2. Update coverage percentages
3. Mark assigned areas as "In Progress"
4. Update "Next Tests to Create" priorities
5. Note any blockers or issues

---

## 💡 Tips for Contributors

1. **Start with zero-coverage files** - Biggest impact
2. **Focus on pure functions first** - Easier to test
3. **Mock external dependencies** - Use `vi.mock()`
4. **Test edge cases** - Empty inputs, null values, boundaries
5. **Test error paths** - Error handling is often untested
6. **Use descriptive test names** - `should handle X when Y occurs`
7. **Keep tests isolated** - Each test should be independent
8. **Check coverage after each file** - `npm run test:coverage`

---

## 🐛 Known Issues

1. **sqlite3 mocking** - Needs better strategy for database tests
2. **DateTime in tests** - Some tests fail due to timezone issues
3. **ClickHouse integration** - Needs test database setup
4. **Logger mocking** - Console spy issues with Vitest
5. **Telegraf mocking** - Complex bot framework, needs careful mocking

---

## 📞 Coordination

- **Check this file before starting** - Avoid duplicate work
- **Update status when starting** - Mark as "In Progress"
- **Update when complete** - Move to "Tests Created"
- **Note blockers** - Add to "Known Issues" or excluded tests

---

**Last Coverage Run**: Run `npm run test:coverage` to get latest numbers

