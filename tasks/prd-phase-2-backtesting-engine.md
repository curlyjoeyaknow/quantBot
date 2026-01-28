# PRD: Phase 2 - Core Backtesting Engine

## Overview

Phase 2 implements the core backtesting engine that executes trading strategies against historical data. This phase builds on the data access layer from Phase 1 to create a deterministic, idempotent backtesting system that processes alerts, loads OHLCV data, executes strategies, and calculates results.

## Goals

1. **Execute Strategies**: Run trading strategies against historical OHLCV data
2. **Calculate Metrics**: Compute performance metrics from executed trades
3. **Ensure Determinism**: Guarantee idempotent results for auditability
4. **Handle Causal Constraints**: Prevent future data access during simulation
5. **Store Results**: Persist backtest results in DuckDB

## Scope

### In Scope

- Backtest execution orchestration
- Strategy execution engine
- Trade simulation (entry/exit logic)
- Performance metrics calculation
- Result storage
- Causal candle iteration
- Run metadata management

### Out of Scope

- Strategy plugins (Phase 3)
- Python integration (Phase 5)
- CLI interface (Phase 4)
- Advanced optimization (Phase 5)

## User Stories

### US-2.1: Execute a Simple Backtest

**As a** developer  
**I want to** execute a backtest with a hardcoded strategy  
**So that** I can test the backtesting engine

**Acceptance Criteria:**

- Can specify alerts to backtest
- Can specify date range
- Can specify strategy parameters (entry/exit rules)
- Engine loads OHLCV data for alert tokens
- Engine executes strategy causally (no future data)
- Results are calculated and stored
- Same inputs produce identical outputs

### US-2.2: Calculate Performance Metrics

**As a** developer  
**I want to** calculate performance metrics from trades  
**So that** I can evaluate strategy performance

**Acceptance Criteria:**

- Calculates total return (absolute and percentage)
- Calculates win rate and number of trades
- Calculates maximum drawdown
- Calculates Sharpe ratio
- Calculates Sortino ratio
- Calculates profit factor
- All calculations are mathematically correct

### US-2.3: Store Backtest Results

**As a** developer  
**I want to** store backtest results in DuckDB  
**So that** I can query and analyze results later

**Acceptance Criteria:**

- Stores run metadata (ID, strategy, parameters, timestamps)
- Stores individual trade records
- Stores aggregated metrics
- Results are queryable via SQL
- Run ID is unique and persistent
- Results are immutable once written

## Functional Requirements

### FR-2.1: Backtest Run Orchestration

**Description**: Orchestrate the full backtest execution flow

**Flow:**

1. Validate inputs (alerts, date range, strategy)
2. Load alerts from DuckDB (using AlertPort)
3. Extract token addresses from alerts
4. Load OHLCV data from ClickHouse (using OhlcvPort)
5. Validate data coverage
6. Initialize strategy executor
7. Execute strategy for each alert
8. Calculate metrics
9. Store results
10. Return run summary

**Source**: Borrow from `@quantbot/backtest/src/runPathOnly.ts` and `@quantbot/backtest/src/runPolicyBacktest.ts`

**Key Function:**

```typescript
interface BacktestExecutor {
  execute(request: BacktestRequest): Promise<BacktestResult>;
}

interface BacktestRequest {
  alerts: Alert[];
  strategy: StrategyConfig;
  dateRange: DateRange;
  interval: string;
}

interface BacktestResult {
  runId: string;
  metrics: PerformanceMetrics;
  trades: Trade[];
  executionTime: number;
}
```

### FR-2.2: Strategy Execution Engine

**Description**: Execute trading strategy against historical candles

**Requirements:**

- Causal iteration (no future data access)
- Entry signal detection (based on alerts)
- Exit signal detection (based on strategy rules)
- Position tracking (entry price, exit price, size)
- Trade recording (entry/exit timestamps, P&L)

**Source**: Borrow from `@quantbot/simulation/src/backtest/runPathOnly.ts` and `@quantbot/simulation/src/backtest/runPolicyBacktest.ts`

**Key Components:**

```typescript
interface StrategyExecutor {
  execute(
    alert: Alert,
    candles: Candle[],
    strategy: StrategyConfig
  ): Promise<Trade[]>;
}

interface StrategyConfig {
  name: string;
  entryRules: EntryRule[];
  exitRules: ExitRule[];
  positionSize: PositionSizeConfig;
  fees: FeeConfig;
}

interface EntryRule {
  type: 'immediate' | 'delay' | 'price_threshold';
  // ... rule-specific params
}

interface ExitRule {
  type: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'time_based';
  // ... rule-specific params
}
```

### FR-2.3: Causal Candle Iterator

**Description**: Iterate through candles causally (no future data access)

**Requirements:**

- Iterates candles in chronological order
- Cannot access future candles
- Provides current candle and historical context
- Validates no future data access

**Source**: Borrow from `@quantbot/simulation/src/` - simulation engine patterns

**Implementation:**

```typescript
class CausalCandleIterator {
  constructor(private candles: Candle[]) {
    // Sort candles by timestamp
    // Validate no duplicates
  }
  
  *iterate(): Generator<CandleContext> {
    for (let i = 0; i < this.candles.length; i++) {
      const current = this.candles[i];
      const history = this.candles.slice(0, i);
      yield { current, history };
    }
  }
}

interface CandleContext {
  current: Candle;
  history: Candle[];
  // No future access allowed
}
```

### FR-2.4: Trade Simulation

**Description**: Simulate trades based on strategy rules

**Requirements:**

- Detect entry signals (from alerts + entry rules)
- Detect exit signals (from exit rules)
- Track position state (in/out, entry price, size)
- Calculate trade P&L
- Handle fees and slippage

**Source**: Borrow from `@quantbot/backtest/src/policies/policy-executor.ts`

**Key Types:**

```typescript
interface Trade {
  id: string;
  alertId: string;
  tokenAddress: string;
  entryTimestamp: DateTime;
  exitTimestamp: DateTime;
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  fees: number;
  exitReason: ExitReason;
}

enum ExitReason {
  STOP_LOSS = 'stop_loss',
  TAKE_PROFIT = 'take_profit',
  TRAILING_STOP = 'trailing_stop',
  TIME_BASED = 'time_based',
  MANUAL = 'manual'
}
```

### FR-2.5: Performance Metrics Calculation

**Description**: Calculate performance metrics from trades

**Metrics Required:**

- Total return (absolute and percentage)
- Number of trades (total, wins, losses)
- Win rate
- Average win/loss
- Maximum drawdown
- Sharpe ratio
- Sortino ratio
- Profit factor
- Time-weighted returns

**Source**: Borrow from `@quantbot/analytics/` - analytics calculations

**Key Function:**

```typescript
interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  numTrades: number;
  numWins: number;
  numLosses: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  timeWeightedReturn: number;
}

function calculateMetrics(trades: Trade[]): PerformanceMetrics {
  // Calculate all metrics
  // Validate calculations
  // Return metrics object
}
```

### FR-2.6: Result Storage

**Description**: Store backtest results in DuckDB

**Tables Required:**

- `backtest_runs`: Run metadata
- `backtest_trades`: Individual trades
- `backtest_metrics`: Aggregated metrics

**Source**: Borrow from `@quantbot/backtest/src/reporting/backtest-results-duckdb.ts`

**Schema:**

```sql
CREATE TABLE backtest_runs (
  run_id TEXT PRIMARY KEY,
  strategy_name TEXT,
  strategy_config JSON,
  date_from TIMESTAMP,
  date_to TIMESTAMP,
  num_alerts INTEGER,
  execution_time_ms INTEGER,
  created_at TIMESTAMP
);

CREATE TABLE backtest_trades (
  trade_id TEXT PRIMARY KEY,
  run_id TEXT,
  alert_id TEXT,
  token_address TEXT,
  entry_timestamp TIMESTAMP,
  exit_timestamp TIMESTAMP,
  entry_price REAL,
  exit_price REAL,
  size REAL,
  pnl REAL,
  pnl_percent REAL,
  fees REAL,
  exit_reason TEXT,
  FOREIGN KEY (run_id) REFERENCES backtest_runs(run_id)
);

CREATE TABLE backtest_metrics (
  run_id TEXT PRIMARY KEY,
  total_return REAL,
  total_return_percent REAL,
  num_trades INTEGER,
  num_wins INTEGER,
  num_losses INTEGER,
  win_rate REAL,
  average_win REAL,
  average_loss REAL,
  max_drawdown REAL,
  sharpe_ratio REAL,
  sortino_ratio REAL,
  profit_factor REAL,
  time_weighted_return REAL,
  FOREIGN KEY (run_id) REFERENCES backtest_runs(run_id)
);
```

### FR-2.7: Determinism Guarantees

**Description**: Ensure idempotent results

**Requirements:**

- No `Date.now()` or `Math.random()` in execution logic
- Use ClockPort for time (injectable)
- Use SeedManager for any randomness
- Validate inputs haven't changed (checksums)
- Same inputs → same outputs

**Source**: Borrow from `@quantbot/core/src/determinism.ts` and `@quantbot/core/src/seed-manager.ts`

**Implementation:**

```typescript
interface DeterministicContext {
  clock: ClockPort;
  seed: string;
  inputHash: string;
}

function ensureDeterminism(context: DeterministicContext): void {
  // Validate no non-deterministic operations
  // Use clock.now() instead of Date.now()
  // Use seeded random if needed
}
```

## Technical Specifications

### Dependencies

**Backtest Package:**

- `@backtesting-platform/core` - Core types and ports
- `@backtesting-platform/storage` - Data adapters
- `luxon` - Date/time
- `zod` - Validation

### Code to Borrow from QuantBot

#### Execution Orchestration

- `@quantbot/backtest/src/runPathOnly.ts` - Path-only execution
- `@quantbot/backtest/src/runPolicyBacktest.ts` - Policy execution
- `@quantbot/backtest/src/plan.ts` - Backtest planning

#### Simulation Engine

- `@quantbot/simulation/src/backtest/runPathOnly.ts` - Path metrics calculation
- `@quantbot/simulation/src/backtest/runPolicyBacktest.ts` - Policy execution
- `@quantbot/simulation/src/backtest/path-metrics.ts` - Path metrics

#### Strategy Execution

- `@quantbot/backtest/src/policies/policy-executor.ts` - Policy execution logic
- `@quantbot/backtest/src/policies/risk-policy.ts` - Policy types

#### Metrics Calculation

- `@quantbot/analytics/src/` - Analytics and metrics calculations

#### Result Storage

- `@quantbot/backtest/src/reporting/backtest-results-duckdb.ts` - DuckDB storage
- `@quantbot/backtest/src/types.ts` - Type definitions

#### Determinism

- `@quantbot/core/src/determinism.ts` - Determinism utilities
- `@quantbot/core/src/seed-manager.ts` - Seed management
- `@quantbot/core/src/ports/clockPort.ts` - Clock port

## Implementation Tasks

### Task 2.1: Create Backtest Executor

- Implement BacktestExecutor interface
- Orchestrate execution flow
- Handle errors and validation

### Task 2.2: Implement Strategy Executor

- Create StrategyExecutor
- Implement entry/exit rule evaluation
- Handle position tracking

### Task 2.3: Create Causal Iterator

- Implement CausalCandleIterator
- Validate no future data access
- Provide historical context

### Task 2.4: Implement Trade Simulation

- Create trade simulation logic
- Handle entry/exit signals
- Calculate P&L and fees

### Task 2.5: Implement Metrics Calculation

- Create metrics calculation functions
- Validate calculations
- Handle edge cases (no trades, etc.)

### Task 2.6: Implement Result Storage

- Create DuckDB schema
- Implement storage adapters
- Add result querying

### Task 2.7: Add Determinism

- Integrate ClockPort
- Add input validation/hashing
- Ensure idempotency

## Success Criteria

1. ✅ Can execute a backtest with hardcoded strategy
2. ✅ Results are deterministic (same inputs → same outputs)
3. ✅ No future data access during execution
4. ✅ All metrics are calculated correctly
5. ✅ Results are stored in DuckDB
6. ✅ Results are queryable via SQL
7. ✅ Error handling works correctly

## Dependencies

- Phase 1 complete (data access layer)
- DuckDB database with result tables
- ClickHouse database with OHLCV data

## Risks & Mitigations

**Risk**: Performance issues with large datasets  
**Mitigation**: Implement streaming, pagination, optimize queries

**Risk**: Non-deterministic results  
**Mitigation**: Strict determinism checks, use ClockPort, validate inputs

**Risk**: Incorrect metrics calculations  
**Mitigation**: Unit tests for all calculations, compare with known values

## Open Questions

1. Should we support multiple strategies in one run?
2. How should we handle partial data (missing candles)?
3. What level of trade detail should be stored?
4. Should we implement result caching?

## Next Phase

Phase 3 will implement the plugin system that allows strategies to be defined as plugins rather than hardcoded.
