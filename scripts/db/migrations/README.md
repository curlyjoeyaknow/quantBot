# ClickHouse Migrations

This directory contains ClickHouse database migration scripts.

## Running Migrations

### Manual Execution

```bash
clickhouse-client --multiquery < scripts/db/migrations/20251228_add_interval_seconds.sql
```

### With Environment Variables

```bash
clickhouse-client \
  --host "${QB_CH_HOST:-localhost}" \
  --port "${QB_CH_PORT:-9000}" \
  --user "${QB_CH_USER:-default}" \
  --database "${QB_CH_DB:-quantbot}" \
  --multiquery < scripts/db/migrations/20251228_add_interval_seconds.sql
```

## Migration: Add interval_seconds Column

**File**: `20251228_add_interval_seconds.sql`

**Purpose**: Adds a MATERIALIZED `interval_seconds` column to `ohlcv_candles` table.

**Benefits**:
- No backfill required (MATERIALIZED computes on-the-fly)
- Enables efficient numeric filtering (`WHERE interval_seconds = 60`)
- Maintains backward compatibility (string `interval` column still works)

**After Migration**:
- Query code can use `WHERE interval_seconds = 300` instead of `WHERE interval = '5m'`
- The `ohlcv-coverage-store-and-print.sh` script will automatically detect and use the new column

**Verification**:

```sql
-- Check column exists
DESCRIBE TABLE quantbot.ohlcv_candles;

-- Test query
SELECT token_address, timestamp, interval, interval_seconds
FROM quantbot.ohlcv_candles
WHERE interval_seconds = 60
LIMIT 10;

-- Check for any intervals that didn't map (should be 0)
SELECT interval, count()
FROM quantbot.ohlcv_candles
WHERE interval_seconds = 0
GROUP BY interval;
```

