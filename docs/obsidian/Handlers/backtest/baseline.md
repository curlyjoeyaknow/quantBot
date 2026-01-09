# baseline Handler

## Overview

Runs baseline alert backtests computing per-alert metrics. Pure handler - no console.log, no process.exit, no try/catch.

## Location

`packages/cli/src/handlers/backtest/baseline.ts`

## Handler Function

`baselineHandler` (via `runTuiMode` or `runBatchMode`)

## Metrics Computed

- **ATH multiple after alert**: Highest price multiple after alert
- **Max drawdown after alert**: Maximum drawdown after alert
- **Max drawdown before first 2x**: Drawdown before reaching 2x
- **Time-to-2x**: Time to reach 2x multiple
- **Simple TP/SL exit policy returns**: Returns with simple take profit/stop loss

## Command

```bash
quantbot backtest baseline [options]
```

## Examples

```bash
# Run baseline with defaults
quantbot backtest baseline --duckdb data/alerts.duckdb --chain solana

# Custom date range and interval
quantbot backtest baseline --duckdb data/alerts.duckdb --chain solana --from 2025-05-01 --to 2026-01-07 --interval-seconds 60

# TUI mode (interactive)
quantbot backtest baseline --duckdb data/alerts.duckdb --chain solana --tui

# Custom output directory and threads
quantbot backtest baseline --duckdb data/alerts.duckdb --chain solana --out-dir results/baseline-2025-05 --threads 32

# Custom horizon
quantbot backtest baseline --duckdb data/alerts.duckdb --chain solana --horizon-hours 72
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (required)
- `--chain <chain>`: Chain name (required)
- `--from <date>`: Start date (ISO 8601)
- `--to <date>`: End date (ISO 8601)
- `--interval-seconds <seconds>`: Candle interval in seconds (required)
- `--horizon-hours <hours>`: Time horizon in hours (required)
- `--threads <count>`: Number of threads (required)
- `--out-dir <dir>`: Output directory (required)
- `--tui`: Enable TUI mode (interactive terminal UI)
- `--format <format>`: Output format

## Modes

### TUI Mode (`--tui`)

Interactive terminal UI with real-time progress.

### Batch Mode

Non-interactive execution with JSON output.

## Implementation

Spawns Python script `tools/backtest/alert_baseline_backtest.py` with CLI arguments.

## Returns

```typescript
{
  success: boolean;
  message: string;
}
```

## Related

- [[v1-baseline-optimizer]] - Policy optimization
- [[migrate-results]] - Results migration
- [[Backtesting Workflows]] - Main backtesting workflows

