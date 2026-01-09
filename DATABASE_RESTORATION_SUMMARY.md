# Database Restoration Summary

**Date:** 2026-01-09  
**Database:** `data/alerts.duckdb`  
**Status:** ✅ COMPLETE

## What Was Restored

### Schemas (7 total)
- `main` (default schema)
- `baseline` - Backtest baseline results
- `bt` - Backtest metrics and runs
- `canon` - Canonical alert data
- `core` - Core alert data
- `optimizer` - Optimization results
- `raw` - Raw Telegram messages

### Tables (54 total)
- `main`: 35 tables (backtest, OHLCV, tokens, slices, etc.)
- `baseline`: 4 tables (alert_results_f, caller_stats_f, runs_d, trades_d)
- `bt`: 4 tables (alert_outcomes_f, alert_scenarios_d, metrics_f, runs_d)
- `canon`: 1 table (callers_d)
- `core`: 1 table (alerts_d)
- `optimizer`: 8 tables (trials, islands, champions, etc.)
- `raw`: 1 table (messages_f)

### Views (70 total)
- `main`: 32 views (coverage, caller summaries, etc.)
- `baseline`: 4 views (leaderboards, summaries)
- `canon`: 28 views (alerts_std, alerts_canon, alert resolution, etc.)
- `optimizer`: 6 views (best trials, validation, walk-forward)

### Key Data Counts
- `canon.alerts_std`: 7,317 alerts
- `main.caller_links_d`: 6,227 caller links
- `raw.messages_f`: 25,933 raw messages
- `core.alerts_d`: 6,227 core alerts
- `main.backtest_strategies`: 11 strategies

## Restoration Process

1. **Schema Export Analysis**
   - Read schema definitions from `data/exports/schema_*.csv`
   - Identified 54 tables and 42 views (excluding system views)

2. **Dependency Resolution**
   - Analyzed view dependencies using regex pattern matching
   - Performed topological sort to determine creation order
   - Resolved circular dependencies

3. **SQL Script Generation**
   - Created `restore_database_complete.sql` with:
     - Schema creation statements
     - Table creation with proper column types
     - View creation in dependency order

4. **Execution**
   - Ran restoration script: `duckdb data/alerts.duckdb < restore_database_complete.sql`
   - All schemas, tables, and views created successfully
   - Existing data preserved (backup database was already in place)

## Files Generated

- `restore_database_complete.sql` - Complete restoration script (can be reused)

## Verification

All key components verified:
- ✅ All schemas exist
- ✅ All tables created with correct structure
- ✅ All views created in dependency order
- ✅ `canon.alerts_std` view returns 7,317 rows
- ✅ All base tables have data

## ClickHouse Port Configuration Fix

Fixed ClickHouse port configuration to use `CLICKHOUSE_HTTP_PORT` (18123) instead of defaulting to 8123:

- Updated `packages/utils/src/config/index.ts`
- Updated `packages/infra/src/utils/config/index.ts`

Both files now prefer `CLICKHOUSE_HTTP_PORT` over `CLICKHOUSE_PORT` for HTTP connections.

**Note:** The CLI package has a build error that needs to be fixed separately. The database restoration is complete and functional.

## Next Steps

The database is now ready for use. You can:
1. Query views directly: `SELECT * FROM canon.alerts_std LIMIT 10`
2. Run optimization: `quantbot backtest optimize ...` (after CLI rebuild)
3. Run backtest commands: `quantbot backtest v1-baseline ...` (after CLI rebuild)

## Notes

- The restoration script (`restore_database_complete.sql`) can be reused if needed
- All views were created from `data/exports/schema_views.csv`
- System views (information_schema, pg_catalog) were excluded
- TEMP views were excluded from restoration
- CLI needs to be rebuilt to pick up ClickHouse port configuration changes

