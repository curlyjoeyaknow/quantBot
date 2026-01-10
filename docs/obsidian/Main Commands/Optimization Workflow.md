# Optimization Workflow

## Overview

Policy optimization workflows for finding optimal trade management policies (stops + exits) that maximize captured return under explicit downside constraints, per caller.

## Commands

### 1. V1 Baseline Optimizer

Capital-aware optimization with finite capital and position constraints.

```bash
quantbot backtest v1-baseline [options]
```

**Examples**:
```bash
# Optimize for all callers
quantbot backtest v1-baseline --from 2025-05-01 --to 2026-01-07 --interval 1m

# Optimize for specific caller groups
quantbot backtest v1-baseline --from 2025-05-01 --to 2026-01-07 --interval 1m --caller-groups '["Brook","Alpha"]'

# Custom capital and constraints
quantbot backtest v1-baseline --from 2025-05-01 --to 2026-01-07 --interval 1m --initial-capital 50000 --max-allocation-pct 0.05

# Custom TP/SL parameters
quantbot backtest v1-baseline --from 2025-05-01 --to 2026-01-07 --interval 1m --tp-mults '[2.0,3.0,4.0]' --sl-mults '[0.90,0.95]'

# Filter collapsed callers
quantbot backtest v1-baseline --from 2025-05-01 --to 2026-01-07 --interval 1m --filter-collapsed
```

**Handler**: [[v1-baseline-optimizer]]

**Key Features**:
- Per-caller optimization
- Capital constraints (finite capital, position sizing)
- Grid search over policy parameters
- Constraint filtering (max drawdown, win rate, etc.)
- Objective ranking (captured return, Sharpe ratio, etc.)

**Parameters**:
- `--from <date>`: Start date (ISO 8601)
- `--to <date>`: End date (ISO 8601)
- `--interval <interval>`: Candle interval (1m, 5m, etc.)
- `--caller-groups <callers...>`: Filter by caller groups
- `--initial-capital <amount>`: Initial capital in USD
- `--taker-fee-bps <bps>`: Taker fee in basis points
- `--slippage-bps <bps>`: Slippage in basis points

**Workflow**:
1. Load calls from DuckDB
2. Filter by caller groups (if specified)
3. Plan backtest (strategy, calls, interval, date range)
4. Check coverage (eligible calls)
5. Materialize slice and load candles
6. Run optimization:
   - Grid search over policy parameters
   - Evaluate each policy on eligible calls
   - Filter by constraints
   - Rank by objective
7. Return optimal policy per caller

**Optimization Logic**:
- Uses `optimizeV1Baseline` or `optimizeV1BaselinePerCaller` from `@quantbot/backtest`
- Policy parameters: stop loss %, take profit %, trailing stop %, etc.
- Constraints: max drawdown, min win rate, min trades, etc.
- Objectives: captured return, Sharpe ratio, profit factor, etc.

### 2. Baseline Backtest

Runs baseline alert backtests computing per-alert metrics.

```bash
quantbot backtest baseline [options]
```

**Examples**:
```bash
# Run baseline with defaults
quantbot backtest baseline --duckdb data/alerts.duckdb --chain solana

# Custom date range and interval
quantbot backtest baseline --duckdb data/alerts.duckdb --chain solana --from 2025-05-01 --to 2026-01-07 --interval-seconds 60

# TUI mode (interactive)
quantbot backtest baseline --duckdb data/alerts.duckdb --chain solana --tui

# Custom output directory
quantbot backtest baseline --duckdb data/alerts.duckdb --chain solana --out-dir results/baseline-2025-05
```

**Handler**: [[baseline]]

**Metrics Computed**:
- ATH multiple after alert
- Max drawdown after alert
- Max drawdown before first 2x
- Time-to-2x
- Simple TP/SL exit policy returns

**Modes**:
- **TUI Mode**: Interactive terminal UI (`--tui`)
- **Batch Mode**: Non-interactive execution

**Implementation**: Spawns Python script `tools/backtest/alert_baseline_backtest.py`

## Optimization Architecture

### Policy Layer

Policies define exit conditions:
- **Fixed Stop Loss**: Exit at fixed % loss
- **Time Stop**: Exit after time duration
- **Trailing Stop**: Exit when price drops % from peak
- **Take Profit**: Exit at fixed % gain
- **Ladder Fill**: Partial exits at multiple levels
- **Indicator Trigger**: Exit based on technical indicators

### Optimization Layer

- **Grid Search**: Systematic parameter exploration
- **Constraint Filtering**: Remove policies that violate constraints
- **Objective Ranking**: Rank policies by objective function
- **Tie-Break Rules**: Resolve ties (e.g., prefer lower drawdown)

### Capital Simulation

- **Finite Capital**: Limited total capital
- **Position Sizing**: Fixed or dynamic position sizes
- **Capital Allocation**: How capital is allocated across calls
- **Realized Returns**: Actual returns after fees and slippage

## Related Handlers

- [[v1-baseline-optimizer]] - Main optimization handler
- [[baseline]] - Baseline metrics computation
- [[migrate-results]] - Results migration

## Related Packages

- `@quantbot/backtest` - Core backtest and optimization logic
  - `optimizeV1Baseline` - Single optimization run
  - `optimizeV1BaselinePerCaller` - Per-caller optimization
  - `runV1BaselineGroupedEvaluation` - Grouped evaluation
  - `planBacktest` - Backtest planning
  - `checkCoverage` - Coverage checking
  - `materialiseSlice` - Slice materialization
  - `loadCandlesFromSlice` - Candle loading

## Optimization Flow

```
1. Load Calls (DuckDB)
   ↓
2. Filter by Caller Groups
   ↓
3. Plan Backtest (strategy, calls, interval, dates)
   ↓
4. Check Coverage (eligible calls)
   ↓
5. Materialize Slice & Load Candles
   ↓
6. Grid Search Policy Parameters
   ↓
7. Evaluate Each Policy
   ↓
8. Filter by Constraints
   ↓
9. Rank by Objective
   ↓
10. Return Optimal Policy per Caller
```

## Notes

- Optimization is **caller-centric**: finds optimal policy per caller
- Uses **deterministic** evaluation (no randomness in domain logic)
- **Capital-aware**: respects finite capital and position constraints
- **Constraint-based**: filters policies that violate constraints
- **Objective-driven**: ranks policies by objective function

