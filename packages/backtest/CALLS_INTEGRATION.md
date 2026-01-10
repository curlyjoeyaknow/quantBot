# CALLS Integration - Complete ✅

## What Changed

The backtester has been **refactored to work with CALLS** instead of arbitrary tokens. This aligns with the actual use case:

- **Entry points come from calls** (not first candle)
- **Optimize exit timing** (trade management and sell timing)
- **Backtest existing calls** (not random tokens)

## Architecture Changes

### Before (Token-based)

- Loaded arbitrary tokens from ClickHouse
- Entry point = first candle
- Tested strategy on random tokens

### After (Call-based)

- Loads **calls from DuckDB** using `queryCallsDuckdb`
- Entry point = **call timestamp** (with optional delay)
- Tests exit strategies on **existing calls**

## Updated Components

### 1. Types (`types.ts`)

- `CallRecord` - Call structure from DuckDB
- `BacktestRequest` - Now takes `calls[]` instead of `universe[]`
- `BacktestPlan` - `perCallWindow[]` instead of `perTokenWindow[]`
- `CoverageResult` - `eligible[]` includes `callId`
- `Trade` - Includes `callId` and `caller`

### 2. Planner (`plan.ts`)

- Derives windows from **call timestamps**
- Entry point = call timestamp + entry delay
- Window = warmup before entry + maxHold after entry

### 3. Coverage (`coverage.ts`)

- Checks coverage **per call** (not per token)
- Validates candles exist for call's time window

### 4. Slice (`slice.ts`)

- Materializes candles **grouped by call_id**
- Parquet includes `call_id` column

### 5. Engine (`engine/index.ts`)

- `backtestCall()` - Takes call record, finds entry candle from call timestamp
- Entry point = call timestamp + delay (not first candle)
- Returns trades with `callId` and `caller`

### 6. Orchestrator (`runBacktest.ts`)

- Loads candles **by call_id** from slice
- Executes backtest **per call**
- Maps call records to results

### 7. CLI (`commands/backtest.ts`)

- Loads calls from DuckDB using `queryCallsDuckdb`
- Uses `--filter` as caller name (optional)
- Converts `CallRecord[]` to backtest request

## Usage

```bash
quantbot backtest run \
  --strategy exit-optimizer \
  --filter TY/ACC \
  --interval 1m \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-31T23:59:59Z \
  --taker-fee-bps 30 \
  --slippage-bps 10 \
  --position-usd 1000
```

This will:

1. Load calls from DuckDB in the date range (optionally filtered by caller)
2. Plan windows for each call (entry = call timestamp)
3. Check coverage for each call
4. Materialize candles for eligible calls
5. Backtest exit strategies on each call
6. Report results per call

## Key Benefits

✅ **Entry points from calls** - Realistic backtesting
✅ **Optimize exit timing** - Test different sell strategies
✅ **Per-call results** - See which calls performed best
✅ **Caller analysis** - Filter by caller to compare strategies

## Next Steps

- [ ] Add chain detection from call data (currently assumes solana)
- [ ] Support multiple exit strategies per call (grid search)
- [ ] Add caller-level aggregation in reports
- [ ] Integrate with `evaluateCallOverlays` from workflows (optional optimization)
