# Backtesting Workflows

## Overview

Backtesting execution workflows for running strategies on historical data.

## Commands

### 1. Run Backtest

Run backtest on strategy (golden path).

```bash
quantbot backtest run [options]
```

**Examples**:
```bash
# Path-only (truth layer)
quantbot backtest run --strategy path-only --interval 1m --from 2025-05-01 --to 2026-01-07

# Exit optimizer mode
quantbot backtest run --strategy exit-optimizer --interval 5m --from 2025-05-01 --to 2026-01-07 --taker-fee-bps 30

# Exit stack mode (requires strategy-id)
quantbot backtest run --strategy exit-stack --strategy-id strategy_123 --interval 1m --from 2025-05-01 --to 2026-01-07

# With custom fees and position size
quantbot backtest run --strategy path-only --interval 1m --from 2025-05-01 --to 2026-01-07 --taker-fee-bps 25 --slippage-bps 15 --position-usd 2000

# Include replay frames
quantbot backtest run --strategy path-only --interval 1m --from 2025-05-01 --to 2026-01-07 --include-replay
```

**Handler**: Uses `runBacktest` from `@quantbot/backtest`

**Strategy Modes**:
- `path-only`: Truth layer (compute path metrics after alert)
- `exit-optimizer`: Exit policy optimization
- `exit-stack`: Exit stack mode (requires `--strategy-id`)

**Parameters**:
- `--run-id <id>`: Run ID (provided by Lab UI, optional)
- `--strategy-id <id>`: Strategy ID from DuckDB (required for exit-stack mode)
- `--strategy <mode>`: Strategy mode (required)
- `--filter <id>`: Filter ID
- `--interval <interval>`: Candle interval (1m, 5m, etc.) (required)
- `--from <date>`: Start date (ISO 8601) (required)
- `--to <date>`: End date (ISO 8601) (required)
- `--taker-fee-bps <number>`: Taker fee in basis points (default: 30)
- `--slippage-bps <number>`: Slippage in basis points (default: 10)
- `--execution-model <venue>`: Execution model (pumpfun, pumpswap, raydium, minimal, simple) (default: simple)
- `--position-usd <number>`: Position size in USD (default: 1000)
- `--include-replay`: Include replay frames
- `--activity-move-pct <number>`: Activity move threshold (default: 0.1 = 10%)

### 2. Baseline Backtest

Runs baseline alert backtests computing per-alert metrics.

```bash
quantbot backtest baseline [options]
```

**Handler**: [[baseline]]

**Metrics**:
- ATH multiple after alert
- Max drawdown after alert
- Max drawdown before first 2x
- Time-to-2x
- Simple TP/SL exit policy returns

### 3. V1 Baseline Optimizer

Capital-aware optimization with finite capital and position constraints.

```bash
quantbot backtest optimize-v1-baseline [options]
```

**Handler**: [[v1-baseline-optimizer]]

See [[Optimization Workflow]] for details.

### 4. Policy Backtest

Run backtest with specific policy configuration.

```bash
quantbot backtest policy [options]
```

**Examples**:
```bash
# Run policy with default settings
quantbot backtest policy --interval 1m --from 2025-05-01 --to 2026-01-07

# Filter by caller
quantbot backtest policy --interval 1m --from 2025-05-01 --to 2026-01-07 --filter Brook

# Custom policy ID
quantbot backtest policy --interval 1m --from 2025-05-01 --to 2026-01-07 --policy-id my_policy_001
```

**Handler**: Uses policy execution logic from `@quantbot/backtest`

### 5. List Backtests

List backtest runs.

```bash
quantbot backtest list [options]
```

**Examples**:
```bash
# List all backtest runs
quantbot backtest list

# JSON output
quantbot backtest list --format json
```

### 6. Leaderboard

Show backtest leaderboard.

```bash
quantbot backtest leaderboard [options]
```

**Examples**:
```bash
# Show leaderboard
quantbot backtest leaderboard

# Minimum calls filter
quantbot backtest leaderboard --min-calls 50

# JSON output
quantbot backtest leaderboard --format json
```

### 7. Truth Leaderboard

Show truth metrics leaderboard.

```bash
quantbot backtest truth-leaderboard [options]
```

**Examples**:
```bash
# Show truth leaderboard
quantbot backtest truth-leaderboard

# Minimum calls filter
quantbot backtest truth-leaderboard --min-calls 10
```

### 8. Migrate Results

Migrate backtest results.

```bash
quantbot backtest migrate-results [options]
```

**Examples**:
```bash
# Migrate results
quantbot backtest migrate-results --from data/old_results.duckdb --to data/new_results.duckdb
```

**Handler**: [[migrate-results]]

## Backtest Architecture

### Truth Layer

Computes path metrics after alert:
- **Peak Multiple**: Highest price multiple after alert
- **Max Drawdown**: Maximum drawdown after alert
- **Drawdown to 2x**: Max drawdown before first 2x
- **Time to 2x/3x/4x**: Time to reach multiples
- **Alert → Activity**: Time from alert to first activity

**Handler**: Truth computation logic in `@quantbot/backtest` domain

### Policy Layer

Simulates stops/exits on candle stream:
- **Fixed Stop**: Exit at fixed % loss
- **Time Stop**: Exit after time duration
- **Trailing Stop**: Exit when price drops % from peak
- **Take Profit**: Exit at fixed % gain
- **Ladder Fill**: Partial exits at multiple levels
- **Indicator Trigger**: Exit based on technical indicators

**Handler**: Policy execution logic in `@quantbot/backtest` domain

### Optimization Layer

Searches policies per caller under constraints:
- **Grid Search**: Systematic parameter exploration
- **Constraint Filtering**: Remove policies that violate constraints
- **Objective Ranking**: Rank policies by objective function
- **Tie-Break Rules**: Resolve ties

**Handler**: Optimization logic in `@quantbot/backtest` domain

## Workflow Flow

```
1. Plan Backtest
   - Strategy configuration
   - Calls selection
   - Interval and date range
   ↓
2. Check Coverage
   - Verify candle availability
   - Filter eligible calls
   ↓
3. Materialize Slice
   - Create slice for eligible calls
   - Load candles from slice
   ↓
4. Execute Strategy
   - Truth layer: Compute path metrics
   - Policy layer: Simulate exits
   - Optimization layer: Search policies
   ↓
5. Store Results
   - Persist metrics
   - Store policy results
   - Update leaderboards
```

## Related Handlers

- [[baseline]] - Baseline metrics computation
- [[v1-baseline-optimizer]] - Policy optimization
- [[migrate-results]] - Results migration

## Related Packages

- `@quantbot/backtest` - Core backtest logic
  - `runBacktest` - Main backtest execution
  - `planBacktest` - Backtest planning
  - `checkCoverage` - Coverage checking
  - `materialiseSlice` - Slice materialization
  - `loadCandlesFromSlice` - Candle loading
  - `optimizeV1Baseline` - Optimization

## Data Flow

```
DuckDB (calls)
   ↓
Plan Backtest
   ↓
Check Coverage (ClickHouse/DuckDB)
   ↓
Materialize Slice (Parquet)
   ↓
Load Candles
   ↓
Execute Strategy
   ↓
Store Results (DuckDB)
```

## Notes

- Backtesting is **caller-centric**: evaluates per caller
- Uses **deterministic** execution (no randomness in domain logic)
- **Replayable**: Same inputs produce same outputs
- **Pure handlers**: No side effects in handlers (I/O in adapters)
- **Time units**: Domain uses milliseconds for timestamps/durations

