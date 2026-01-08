# Backtest Setup Guide

## Prerequisites

Before running backtests, you need:

1. **DuckDB database** with `user_calls_d` table (Telegram ingestion data)
2. **ClickHouse** (optional, for candle data - can use fixtures)
3. **Database migrations** applied

## Quick Setup

### 1. Ingest Telegram Data (Required)

The backtest requires calls data from Telegram. Ingest data first:

```bash
# Ingest Telegram export JSON
quantbot ingestion telegram --file <telegram-export.json>

# This creates the user_calls_d table in data/tele.duckdb
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

### Error: "Table 'user_calls_d' not found"

**Solution:** Ingest Telegram data first:

```bash
quantbot ingestion telegram --file <telegram-export.json>
```

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

### Required Tables

1. **`user_calls_d`** - Telegram calls (created by ingestion)
   - Created by: `quantbot ingestion telegram`
   - Location: `tools/telegram/duckdb_punch_pipeline.py`

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

1. **Create minimal test data:**
   ```sql
   -- In DuckDB
   CREATE TABLE IF NOT EXISTS user_calls_d (
     chat_id TEXT,
     message_id BIGINT,
     call_ts_ms BIGINT,
     call_datetime TIMESTAMP,
     caller_name TEXT,
     mint TEXT,
     run_id TEXT DEFAULT 'legacy'
   );
   
   INSERT INTO user_calls_d VALUES
     ('test-chat', 1, 1704067200000, '2024-01-01 00:00:00', 'TestCaller', 'test-mint-123', 'legacy');
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

