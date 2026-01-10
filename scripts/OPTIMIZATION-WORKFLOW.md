# Break-Even Bailout Optimization - Complete Workflow

## Important Note

The existing `backtest optimize` command uses `RiskPolicy` types which don't support break-even bailout. For BE bailout optimization, use **exit-stack mode** as shown below.

For general policy optimization (without BE bailout), see `scripts/OPTIMIZATION-EXISTING-COMMAND.md`.

## Quick Start

```bash
# 1. Set DuckDB path
export DUCKDB_PATH=data/alerts.duckdb

# 2. Generate configurations
pnpm exec tsx scripts/optimize-be-bailout.ts

# 3. Store strategies in DuckDB
pnpm exec tsx scripts/store-be-bailout-strategies.ts

# 4. Run all configurations (sequential)
./scripts/run-all-be-bailout-configs.sh 2024-01-01 2024-12-31 5m 1

# 5. Or run in parallel (5 jobs)
./scripts/run-all-be-bailout-configs.sh 2024-01-01 2024-12-31 5m 5
```

## Detailed Commands

### 1. Generate Exit Plan Configurations

Creates configurations exploring:

- **Fixed TP/SL bands**: 3 TP values × 3 SL values = 9 combinations
- **Per TP/SL pair**: All combinations of:
  - BE armed DD%: 10%, 15%, 20%, 25%, 30%
  - Max hold: 30min, 60min, 120min, 240min, 48h (full horizon), none
  - Ladder configs: 4 variants

**Total**: 9 TP/SL pairs × 5 BE DD% × 6 max hold × 4 ladder = **1,080 configurations**

To customize TP/SL bands, edit `TP_MULTIPLES` and `SL_BPS_VALUES` in the script.

```bash
pnpm exec tsx scripts/optimize-be-bailout.ts
```

Output: `optimize-be-bailout-configs.json`

### 2. Store Strategies in DuckDB

Stores all exit plans (default: 900) in `backtest_strategies` table:

```bash
pnpm exec tsx scripts/store-be-bailout-strategies.ts
```

Each strategy gets a `strategy_id` like:

- `be_bailout_tp_5p2x_sl_25pct_be_10pct_hold_30min_ladder_none`
- `be_bailout_tp_5p45x_sl_25pct_be_15pct_hold_60min_ladder_5.45x0.5`

### 3. Run Single Backtest

Test one configuration:

```bash
quantbot backtest run \
  --strategy exit-stack \
  --strategy-id be_bailout_tp_5p2x_sl_25pct_be_10pct_hold_30min_ladder_none \
  --interval 5m \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --taker-fee-bps 30 \
  --slippage-bps 10 \
  --position-usd 1000 \
  --run-id be_bailout_test_001
```

### 4. Run All Configurations

**Sequential (safer, slower):**

```bash
./scripts/run-all-be-bailout-configs.sh 2024-01-01 2024-12-31 5m 1
```

**Parallel (faster, uses more resources):**

```bash
./scripts/run-all-be-bailout-configs.sh 2024-01-01 2024-12-31 5m 5
```

### 5. Query Results

**List all runs:**

```bash
quantbot backtest list --format table
```

**View results for a run:**

```bash
quantbot backtest callers --run-id <run-id> --format table
```

**Query DuckDB directly:**

```bash
duckdb data/alerts.duckdb
```

```sql
-- Top 10 strategies by total PnL
SELECT 
  s.strategy_id,
  SUM(cr.pnl_usd) as total_pnl_usd,
  AVG(cr.return_bps) / 100.0 as avg_return_pct,
  COUNT(*) as trades,
  COUNT(CASE WHEN cr.return_bps < 0 THEN 1 END) * 100.0 / COUNT(*) as stop_out_rate_pct
FROM backtest_strategies s
JOIN backtest_runs r ON r.strategy_id = s.strategy_id
JOIN backtest_call_results cr ON cr.run_id = r.run_id
WHERE s.strategy_id LIKE 'be_bailout_%'
GROUP BY s.strategy_id
ORDER BY total_pnl_usd DESC
LIMIT 10;
```

## Parameter Reference

### Fixed TP/SL Bands (Explored)

The optimization workflow uses **fixed TP/SL bands** that are explored while optimizing other parameters:

- **TP multiples**: 5.2x, 5.45x, 5.7x (default band)
- **SL values**: 2000 bps (20%), 2500 bps (25%), 3000 bps (30%) (default band)

**Total TP/SL combinations**: 3 × 3 = 9

For each TP/SL pair, all other parameters are optimized.

### Optimized Parameters (Per TP/SL Pair)

- **be_armed_dd_pct**: 10%, 15%, 20%, 25%, 30% (5 values)
- **max_hold_ms**: 30min, 60min, 120min, 240min, 48h (full horizon), none (6 values)
- **Ladder configs**: 4 variants per TP
  - None (full exit at TP)
  - 50% at TP, 50% hold
  - 30% at TP, 70% hold
  - 25% at TP, 25% at 6x, 50% hold

**Total configurations**: 9 TP/SL pairs × 5 BE DD% × 6 max hold × 4 ladder = **1,080 configurations**

### Customizing TP/SL Bands

Edit `scripts/optimize-be-bailout.ts` to change the bands:

```typescript
// Fixed TP/SL bands (explore these combinations while optimizing other parameters)
const TP_MULTIPLES = [5.2, 5.45, 5.7]; // Customize TP band
const SL_BPS_VALUES = [2000, 2500, 3000]; // Customize SL band
```

## Strategy ID Format

```
be_bailout_tp_{tp_multiple}x_sl_{sl_pct}pct_be_{dd_pct}pct_hold_{time}_ladder_{config}
```

Examples:

- `be_bailout_tp_5p2x_sl_25pct_be_10pct_hold_30min_ladder_none`
- `be_bailout_tp_5p45x_sl_25pct_be_20pct_hold_60min_ladder_5.45x0.5`
- `be_bailout_tp_5p7x_sl_30pct_be_25pct_hold_none_ladder_5.7x0.3`

## Objective

**Maximize total PnL USD** (final capital) across all trades.

## Troubleshooting

### Strategy Not Found

```bash
# Verify strategies are stored
duckdb data/alerts.duckdb -c "SELECT strategy_id FROM backtest_strategies WHERE strategy_id LIKE 'be_bailout_%' LIMIT 5;"
```

### Check DUCKDB_PATH

```bash
echo $DUCKDB_PATH
# Should output: data/alerts.duckdb
```

### View Exit Plan

```sql
SELECT config_json
FROM backtest_strategies
WHERE strategy_id = 'be_bailout_be_10pct_hold_30min_ladder_none';
```

## Next Steps

1. Run all configurations (default: 900)
2. Query results to find top performers
3. Analyze which TP/SL bands perform best
4. Analyze which other parameters (BE DD%, max hold, ladder) work best per TP/SL band
5. Iterate on parameter space if needed (adjust TP/SL bands or other parameters)
