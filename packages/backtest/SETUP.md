# Backtest Setup Guide

## Prerequisites

Before running backtests, you need:

1. **DuckDB database** with `canon.alerts_std` view (canonical alert contract)
2. **ClickHouse** (optional, for candle data - can use fixtures)
3. **Database migrations** applied

## Quick Setup

### 1. Ingest Telegram Data (Required)

The backtest requires alerts data from Telegram. Ingest data first:

```bash
# Ingest Telegram export JSON
quantbot ingestion telegram --file <telegram-export.json>

# This creates the canon.alerts_std view in data/tele.duckdb
# Note: user_calls_d has been replaced with canon.alerts_std (the canonical alert contract)
```

### 2. Apply Database Migrations

```bash
# Apply backtest schema migrations
quantbot storage migrate-duckdb --duckdb data/tele.duckdb --all

# Or just the backtest tables
quantbot storage migrate-duckdb --duckdb data/tele.duckdb --migration 006_create_backtest_tables.sql
```

### 3. Verify Setup

```bash
# Check if calls exist
quantbot calls list --from 2024-01-01 --to 2024-01-02

# Check if tables exist (using DuckDB CLI or Python)
python3 tools/storage/duckdb_direct_sql.py --query "SHOW TABLES"
```

## Common Issues

### Error: "View 'canon.alerts_std' not found"

**Solution:** Ensure the canonical schema is set up. Ingest Telegram data first:

```bash
quantbot ingestion telegram --file <telegram-export.json>
```

**Note:** `user_calls_d` has been replaced with `canon.alerts_std` (the canonical alert contract). This view provides:
- One row per alert
- Stable columns forever
- Caller resolution when possible
- Mint resolution when possible
- Human + bot + raw fallback unified

### Error: "No calls found in the specified date range"

**Possible causes:**
1. Date range doesn't match ingested data
2. No calls in that time period
3. Database path is incorrect

**Solutions:**
1. Check date range: `quantbot calls list --from <date> --to <date>`
2. Ingest more data for the desired date range
3. Verify database path: `data/tele.duckdb` (default)

### Error: "ClickHouse connection failed"

**Solution:** ClickHouse is optional for backtests. The error is a warning and won't block execution if you have:
- Pre-materialized slices, OR
- Candle data in DuckDB

## Database Schema

### Required Views/Tables

1. **`canon.alerts_std`** - Canonical alert contract (replaces user_calls_d)
   - Created by: Ingestion pipeline (canonical schema setup)
   - Location: View in `canon` schema
   - **This is the functional successor to user_calls_d**
   - Guarantees: One row per alert, stable columns forever, caller resolution when possible

2. **`backtest_runs`** - Run metadata
   - Created by: Migration `006_create_backtest_tables.sql`

3. **`backtest_call_path_metrics`** - Truth layer
   - Created by: Migration `006_create_backtest_tables.sql`

4. **`backtest_policy_results`** - Policy outcomes
   - Created by: Migration `006_create_backtest_tables.sql`

5. **`backtest_policies`** - Optimized policies
   - Created by: Migration `006_create_backtest_tables.sql`

## Testing Without Real Data

For testing/development, you can:

1. **Create minimal test data in canonical schema:**
   ```sql
   -- In DuckDB - ensure canonical schema exists
   CREATE SCHEMA IF NOT EXISTS canon;
   
   -- Create minimal alerts_std view (simplified for testing)
   -- Note: In production, this view is created by the ingestion pipeline
   CREATE OR REPLACE VIEW canon.alerts_std AS
   SELECT 
     '1:1' AS alert_id,
     1 AS alert_chat_id,
     1 AS alert_message_id,
     1704067200000 AS alert_ts_ms,
     'human' AS alert_kind,
     'test-mint-123' AS mint,
     'solana' AS chain,
     'alert_text' AS mint_source,
     'TestCaller' AS caller_raw_name,
     NULL AS caller_id,
     'TestCaller' AS caller_name_norm,
     NULL AS caller_base,
     'Test alert' AS alert_text,
     'legacy' AS run_id,
     CURRENT_TIMESTAMP AS ingested_at;
   ```

2. **Use synthetic candles** (if you have candle data in ClickHouse/DuckDB)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DUCKDB_PATH` | Path to DuckDB database | `data/tele.duckdb` |
| `CLICKHOUSE_URL` | ClickHouse connection URL | `http://localhost:8123` |

## Next Steps

Once setup is complete:

1. **Run path-only backtest:**
   ```bash
   quantbot backtest run --strategy path-only --interval 5m --from 2024-01-01 --to 2024-01-31
   ```

2. **View truth leaderboard:**
   ```bash
   quantbot backtest truth-leaderboard --run-id <run-id>
   ```

3. **Run policy backtest:**
   ```bash
   quantbot backtest policy --run-id <new-run-id> --path-only-run-id <path-only-run-id> --policy-json '{"type":"fixed-stop","stopPct":0.2}'
   ```

4. **Optimize policies:**
   ```bash
   quantbot backtest optimize --path-only-run-id <run-id> --caller "TestCaller" --constraints-json '{"maxStopOutRate":0.25}'
   ```

