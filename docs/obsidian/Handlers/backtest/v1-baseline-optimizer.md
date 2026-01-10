# V1 Baseline Optimizer Handler

## Overview

V1 Baseline Optimizer implements capital-aware optimization with finite capital, position constraints, and path-dependent capital management. This is the baseline optimization method (pre-B/E - before break-even exits).

**Key Features:**
- Finite capital simulation (C₀ = 10,000, configurable)
- Position constraints: max 4% allocation, max $200 risk, max 25 concurrent positions
- Position sizing: `min(size_risk, size_alloc, free_cash)`
- Trade lifecycle: TP at `tp_mult`, SL at `sl_mult`, Time exit at 48h
- Objective: **maximize final capital (C_final)**

## Location

`packages/cli/src/handlers/backtest/v1-baseline-optimizer.ts`

## Handler Function

`v1BaselineOptimizerHandler`

## Command

```bash
quantbot backtest v1-baseline [options]
```

## Basic Usage

```bash
# Run with defaults (both per-caller and grouped evaluation)
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m

# Per-caller optimization only
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --mode per-caller

# Grouped evaluation only
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --mode grouped
```

## Examples

### Custom Parameter Grid

```bash
# Custom TP/SL parameter grid
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --tp-mults "[1.5,2.0,2.5,3.0,4.0]" \
  --sl-mults "[0.85,0.88,0.90,0.95]"

# Using comma-separated values (alternative to JSON)
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --tp-mults "1.5,2.0,2.5,3.0" \
  --sl-mults "0.85,0.90,0.95"
```

### Capital Configuration

```bash
# Custom initial capital and constraints
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --initial-capital 50000 \
  --max-allocation-pct 0.05 \
  --max-risk-per-trade 500 \
  --max-concurrent-positions 50

# Conservative capital management
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --initial-capital 10000 \
  --max-allocation-pct 0.02 \
  --max-risk-per-trade 100 \
  --max-concurrent-positions 10
```

### Caller Filtering

```bash
# Optimize for specific callers
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --caller-groups '["caller1","caller2","caller3"]'

# Filter by minimum calls per caller
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --min-calls 20

# Disable filtering of collapsed/extreme callers
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --filter-collapsed false \
  --filter-extreme false
```

### Output Formats

```bash
# JSON output
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --format json

# CSV output
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --format csv
```

### Fee Configuration

```bash
# Custom fee structure
quantbot backtest v1-baseline \
  --from 2025-01-01 \
  --to 2025-01-31 \
  --interval 5m \
  --taker-fee-bps 50 \
  --slippage-bps 20
```

## Parameters

### Required

- `--interval <interval>`: Candle interval (`1m`, `5m`, `15m`, `1h`, etc.)
- `--from <date>`: Start date (ISO 8601 format, e.g., `2025-01-01`)
- `--to <date>`: End date (ISO 8601 format, e.g., `2025-01-31`)

### Parameter Grid (Optional)

- `--tp-mults <json>`: Take-profit multiples as JSON array or comma-separated (default: `[1.5, 2.0, 2.5, 3.0, 4.0, 5.0]`)
  - Example: `"[1.5,2.0,2.5,3.0]"` or `"1.5,2.0,2.5,3.0"`
- `--sl-mults <json>`: Stop-loss multiples as JSON array or comma-separated (default: `[0.85, 0.88, 0.90, 0.92, 0.95]`)
  - Example: `"[0.85,0.90,0.95]"` or `"0.85,0.90,0.95"`
  - Note: Values must be between 0 and 1 (e.g., 0.85 = -15% stop loss)
- `--max-hold-hrs <json>`: Max hold hours as JSON array or comma-separated (default: `[48]`)
  - Example: `"[48]"` or `"48"`

### Capital Configuration (Optional)

- `--initial-capital <number>`: Initial capital in USD (default: `10000`)
- `--max-allocation-pct <number>`: Max allocation per trade as fraction (default: `0.04` = 4%)
- `--max-risk-per-trade <number>`: Max risk per trade in USD (default: `200`)
- `--max-concurrent-positions <number>`: Max concurrent positions (default: `25`)
- `--min-executable-size <number>`: Minimum executable size in USD (default: `10`)

### Fees (Optional)

- `--taker-fee-bps <number>`: Taker fee in basis points (default: `30` = 0.30%)
- `--slippage-bps <number>`: Slippage in basis points (default: `10` = 0.10%)

### Evaluation Mode (Optional)

- `--mode <mode>`: Evaluation mode (default: `both`)
  - `per-caller`: Optimize each caller separately
  - `grouped`: Run grouped evaluation with selected callers
  - `both`: Run both per-caller and grouped evaluation

### Filtering (Optional)

- `--caller-groups <json>`: JSON array of caller names to optimize for
  - Example: `'["caller1","caller2"]'`
- `--min-calls <number>`: Minimum number of calls per caller (default: `0`)
  - Filters out callers with fewer than this many calls
- `--filter-collapsed`: Filter out callers that collapsed capital (default: `true`)
  - Set to `false` to include callers where final capital < initial capital
- `--filter-extreme`: Filter out callers requiring extreme parameters (default: `true`)
  - Set to `false` to include callers with SL < 0.88 or TP > 4.0

### Output (Optional)

- `--format <format>`: Output format (default: `table`)
  - `table`: Human-readable table
  - `json`: JSON output
  - `csv`: CSV output

## Modes

### Per-Caller Mode (`--mode per-caller`)

Runs optimization separately for each caller:
- Finds optimal `tp_mult` and `sl_mult` per caller
- Identifies callers that collapsed capital (C_final < C₀)
- Identifies callers requiring extreme parameters (SL < 0.88 or TP > 4.0)

**Output includes:**
- Best parameters per caller
- Final capital per caller
- Total return per caller
- Flags for collapsed/extreme callers

### Grouped Mode (`--mode grouped`)

1. Runs per-caller optimization
2. Filters out collapsed/extreme callers (if enabled)
3. Runs grouped simulation with selected callers
4. Uses average parameters from selected callers

**Output includes:**
- Per-caller results (pre-filtering)
- Selected callers (after filtering)
- Grouped simulation results (final capital, total return, trades executed)
- Grouped parameters used

### Both Mode (`--mode both`) - Default

Runs both per-caller and grouped evaluation, providing comprehensive results.

## Position Sizing Logic

Position size is calculated as:

```
size_risk = max_risk_per_trade / sl_frac
size_alloc = max_allocation_pct * free_cash
size = min(size_risk, size_alloc, free_cash)
```

Where:
- `sl_frac = 1 - sl_mult` (e.g., sl_mult=0.85 → sl_frac=0.15 = 15% loss)

Trade is skipped if:
- `size < min_executable_size`
- `size > free_cash` (insufficient capital)
- Max concurrent positions reached (25 by default)

## Trade Lifecycle

Each position exits on the **first** of:
1. **Take profit** at `tp_mult` (e.g., 2.0 = 2x entry price)
2. **Stop loss** at `sl_mult` (e.g., 0.85 = -15% from entry)
3. **Time exit** at 48h (max hold time)

PnL calculation:
```
pnl = size * (exit_mult - 1)
free_cash += size + pnl
```

## Returns

### Per-Caller Mode

```typescript
{
  mode: 'per-caller',
  results: [
    {
      caller: string;
      bestParams: { tp_mult: number; sl_mult: number; max_hold_hrs?: number } | null;
      bestFinalCapital: number;
      bestTotalReturn: string; // e.g., "15.50%"
      collapsedCapital: boolean;
      requiresExtremeParams: boolean;
    }
  ]
}
```

### Grouped Mode

```typescript
{
  mode: 'grouped',
  perCallerResults: [...], // Same as per-caller mode
  selectedCallers: string[];
  groupedResult: {
    finalCapital: number;
    totalReturn: string;
    tradesExecuted: number;
    tradesSkipped: number;
  } | null;
  groupedParams: { tp_mult: number; sl_mult: number; max_hold_hrs?: number } | null;
}
```

### Both Mode

```typescript
{
  mode: 'both',
  perCaller: [...], // Per-caller results
  grouped: {
    selectedCallers: string[];
    groupedResult: {...} | null;
    groupedParams: {...} | null;
  }
}
```

## What This Baseline Captures

✅ **Capital drawdown effects**: Finite capital means losing streaks reduce available capital  
✅ **Losing-streak shrinkage**: Path-dependent capital management  
✅ **Capital lock-up cost**: Tied capital unavailable for new trades  
✅ **True tail contribution**: Under realistic constraints (position limits, risk limits)

## What It Excludes (Intentionally)

❌ **Break-even exits**: V1 baseline doesn't include B/E protection  
❌ **Re-entries**: Single entry per alert  
❌ **Indicators**: No indicator-based exits  
❌ **Structure detection**: No pattern-based exits  
❌ **Momentum filters**: No momentum-based filters

## Related

- [[baseline]] - Baseline path metrics computation
- [[Optimization Workflow]] - Main optimization workflows
- [[Backtesting Workflows]] - Main backtesting workflows
