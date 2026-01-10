# Backtest Bus Integration

## Overview

All backtest commands now export their results to Parquet and submit them to the artifact bus.

## What Gets Submitted

### Path-Only Backtest (`runPathOnly`)
- **Table**: `backtest_call_path_metrics`
- **Kind**: `path-only_backtest_call_path_metrics`
- **Producer**: `backtest`
- **Contains**: Path metrics for all eligible calls (hit_2x, hit_3x, drawdown, etc.)

### Full Backtest (`runBacktest`)
- **Tables**: All tables in `results.duckdb`
- **Kind**: `full_<table_name>`
- **Producer**: `backtest`
- **Contains**: Trade results, path metrics, etc.

### Policy Backtest (`runPolicyBacktest`)
- **Tables**: Policy results tables
- **Kind**: `policy_<table_name>`
- **Producer**: `backtest`
- **Contains**: Policy execution results, realized returns, stop-outs, etc.

## How It Works

1. Backtest runs and creates `results.duckdb` in `artifacts/backtest/{runId}/`
2. After persistence, `exportBacktestResultsToBus()` is called
3. Function:
   - Opens `results.duckdb` (read-only)
   - Lists all tables
   - Exports each table to Parquet
   - Submits each Parquet file to the bus
4. Bus daemon processes and catalogs the artifacts

## Example

After running:
```bash
quantbot backtest run --strategy path-only --interval 1m --from 2024-01-01 --to 2024-01-02
```

You'll see in the daemon logs:
```
[bus_daemon] processed 2026-01-08T05-12-33Z__backtest__path-only_backtest_call_path_metrics + exports refreshed
```

And in the catalog:
```sql
SELECT * FROM catalog.artifacts_f 
WHERE producer = 'backtest' 
ORDER BY ingested_at DESC;
```

## Benefits

1. **Centralized Catalog**: All backtest results tracked in one place
2. **Golden Exports**: Results available in `data/exports/` (if configured)
3. **No Lock Contention**: Only daemon writes to main DuckDB
4. **Queryable**: Can query catalog to find latest results per backtest type

## Error Handling

Bus submission is **non-blocking**:
- If bus submission fails, backtest still completes successfully
- Results are still written to `artifacts/backtest/{runId}/`
- Warnings are logged but don't fail the backtest

This ensures backward compatibility during migration.

## Files Modified

- `packages/backtest/src/bus-integration.ts` - New: Export helper
- `packages/backtest/src/runPathOnly.ts` - Added bus export
- `packages/backtest/src/runBacktest.ts` - Added bus export
- `packages/backtest/src/runPolicyBacktest.ts` - Added bus export

