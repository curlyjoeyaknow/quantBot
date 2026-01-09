# Break-Even Bailout Optimization - Commands Guide

Complete workflow for running the break-even bailout optimization.

## Prerequisites

Set the DuckDB path environment variable:
```bash
export DUCKDB_PATH=data/alerts.duckdb
```

## Step 1: Generate Exit Plan Configurations

Generate all 100 parameter combinations:

```bash
pnpm exec tsx scripts/optimize-be-bailout.ts
```

This creates `optimize-be-bailout-configs.json` with 100 exit plan configurations.

## Step 2: Store Strategies in DuckDB

Store all exit plans in DuckDB for use with exit-stack mode:

```bash
pnpm exec tsx scripts/store-be-bailout-strategies.ts
```

This stores each configuration with a `strategy_id` like:
- `be_bailout_be_10pct_hold_30min_ladder_none`
- `be_bailout_be_15pct_hold_60min_ladder_5.45x0.5`
- etc.

## Step 3: Run Backtests

### Single Strategy Test

Test a single configuration:

```bash
quantbot backtest run \
  --strategy exit-stack \
  --strategy-id be_bailout_be_10pct_hold_30min_ladder_none \
  --interval 5m \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --taker-fee-bps 30 \
  --slippage-bps 10 \
  --position-usd 1000 \
  --run-id be_bailout_test_001
```

### Batch Run All Configurations

Create a script to run all 100 configurations:

```bash
#!/bin/bash
# scripts/run-all-be-bailout-configs.sh

FROM_DATE="2024-01-01"
TO_DATE="2024-12-31"
INTERVAL="5m"
TAKER_FEE_BPS=30
SLIPPAGE_BPS=10
POSITION_USD=1000

# Read config IDs from JSON
CONFIG_IDS=$(jq -r '.configs[].configId' optimize-be-bailout-configs.json)

for CONFIG_ID in $CONFIG_IDS; do
  STRATEGY_ID="be_bailout_${CONFIG_ID}"
  RUN_ID="be_bailout_${CONFIG_ID}_$(date +%Y%m%d_%H%M%S)"
  
  echo "Running: $STRATEGY_ID"
  
  quantbot backtest run \
    --strategy exit-stack \
    --strategy-id "$STRATEGY_ID" \
    --interval "$INTERVAL" \
    --from "$FROM_DATE" \
    --to "$TO_DATE" \
    --taker-fee-bps "$TAKER_FEE_BPS" \
    --slippage-bps "$SLIPPAGE_BPS" \
    --position-usd "$POSITION_USD" \
    --run-id "$RUN_ID"
  
  echo "Completed: $RUN_ID"
  echo "---"
done
```

Make it executable and run:
```bash
chmod +x scripts/run-all-be-bailout-configs.sh
./scripts/run-all-be-bailout-configs.sh
```

### Parallel Execution (Optional)

For faster execution, run multiple strategies in parallel:

```bash
# Run 10 strategies in parallel
cat optimize-be-bailout-configs.json | \
  jq -r '.configs[].configId' | \
  xargs -P 10 -I {} bash -c '
    STRATEGY_ID="be_bailout_{}"
    RUN_ID="be_bailout_{}_$(date +%s)"
    quantbot backtest run \
      --strategy exit-stack \
      --strategy-id "$STRATEGY_ID" \
      --interval 5m \
      --from 2024-01-01 \
      --to 2024-12-31 \
      --run-id "$RUN_ID"
  '
```

## Step 4: Query Results

### List All Runs

```bash
quantbot backtest list --format table
```

### View Results for a Specific Run

```bash
quantbot backtest callers --run-id be_bailout_be_10pct_hold_30min_ladder_none_20240101_120000 --format table
```

### Aggregate Results Across All Configurations

Query DuckDB directly to compare all configurations:

```sql
-- Connect to DuckDB
duckdb data/alerts.duckdb

-- Aggregate results by strategy_id
SELECT 
  s.strategy_id,
  s.name,
  COUNT(DISTINCT r.run_id) as num_runs,
  COUNT(DISTINCT cr.call_id) as total_trades,
  AVG(cr.return_bps) / 100.0 as avg_return_pct,
  SUM(cr.pnl_usd) as total_pnl_usd,
  COUNT(CASE WHEN cr.return_bps < 0 THEN 1 END) * 100.0 / COUNT(*) as stop_out_rate_pct,
  AVG(cr.hold_ms) / 1000.0 / 60.0 as avg_hold_minutes
FROM backtest_strategies s
LEFT JOIN backtest_runs r ON r.strategy_id = s.strategy_id
LEFT JOIN backtest_call_results cr ON cr.run_id = r.run_id
WHERE s.strategy_id LIKE 'be_bailout_%'
GROUP BY s.strategy_id, s.name
ORDER BY total_pnl_usd DESC;
```

### Find Best Configuration

```sql
-- Best by total PnL
SELECT 
  s.strategy_id,
  SUM(cr.pnl_usd) as total_pnl_usd,
  AVG(cr.return_bps) / 100.0 as avg_return_pct,
  COUNT(*) as trades
FROM backtest_strategies s
JOIN backtest_runs r ON r.strategy_id = s.strategy_id
JOIN backtest_call_results cr ON cr.run_id = r.run_id
WHERE s.strategy_id LIKE 'be_bailout_%'
GROUP BY s.strategy_id
ORDER BY total_pnl_usd DESC
LIMIT 10;
```

### Analyze Break-Even Bailout Impact

```sql
-- Compare BE bailout exit reasons
SELECT 
  s.strategy_id,
  cr.exit_reason,
  COUNT(*) as count,
  AVG(cr.return_bps) / 100.0 as avg_return_pct,
  SUM(cr.pnl_usd) as total_pnl_usd
FROM backtest_strategies s
JOIN backtest_runs r ON r.strategy_id = s.strategy_id
JOIN backtest_call_results cr ON cr.run_id = r.run_id
WHERE s.strategy_id LIKE 'be_bailout_%'
  AND cr.exit_reason IS NOT NULL
GROUP BY s.strategy_id, cr.exit_reason
ORDER BY s.strategy_id, count DESC;
```

## Step 5: Export Results for Analysis

Export results to CSV for further analysis:

```sql
-- Export all BE bailout results
COPY (
  SELECT 
    s.strategy_id,
    s.name,
    cr.run_id,
    cr.call_id,
    cr.caller_name,
    cr.return_bps / 100.0 as return_pct,
    cr.pnl_usd,
    cr.hold_ms / 1000.0 / 60.0 as hold_minutes,
    cr.exit_reason,
    cr.peak_multiple,
    cr.dd_bps / 100.0 as drawdown_pct
  FROM backtest_strategies s
  JOIN backtest_runs r ON r.strategy_id = s.strategy_id
  JOIN backtest_call_results cr ON cr.run_id = r.run_id
  WHERE s.strategy_id LIKE 'be_bailout_%'
) TO 'be_bailout_results.csv' (HEADER, DELIMITER ',');
```

## Quick Reference

### Strategy ID Format

Strategy IDs follow the pattern:
```
be_bailout_be_{dd_pct}pct_hold_{time}_ladder_{config}
```

Examples:
- `be_bailout_be_10pct_hold_30min_ladder_none` - 10% DD threshold, 30min max hold, no ladder
- `be_bailout_be_20pct_hold_60min_ladder_5.45x0.5` - 20% DD threshold, 60min max hold, 50% at 5.45x
- `be_bailout_be_25pct_hold_none_ladder_5.45x0.3` - 25% DD threshold, no time limit, 30% at 5.45x

### Parameter Mapping

- **BE armed DD%**: 10%, 15%, 20%, 25%, 30%
- **Max hold**: 30min, 60min, 120min, 240min, none
- **Ladder**: none, 50% at TP, 30% at TP, 25% at TP + 25% at 6x
- **Fixed TP**: 5.45x
- **Fixed SL**: 2500 bps (25%)

### Objective

Maximize **total PnL USD** (final capital) across all trades.

## Troubleshooting

### Strategy Not Found

If you get "Strategy not found", ensure:
1. You've run `store-be-bailout-strategies.ts`
2. The `strategy_id` matches exactly (case-sensitive)
3. `DUCKDB_PATH` points to the correct database

### Check Stored Strategies

```sql
-- List all BE bailout strategies
SELECT strategy_id, name, created_at
FROM backtest_strategies
WHERE strategy_id LIKE 'be_bailout_%'
ORDER BY created_at DESC;
```

### Verify Exit Plan Format

```sql
-- View a specific exit plan
SELECT config_json
FROM backtest_strategies
WHERE strategy_id = 'be_bailout_be_10pct_hold_30min_ladder_none';
```

