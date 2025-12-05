# SQLite to PostgreSQL and ClickHouse Migration Guide

This guide explains how to migrate existing SQLite database files to PostgreSQL and ClickHouse.

## Overview

The migration process moves data from SQLite databases to:
- **PostgreSQL**: OLTP data (tokens, callers, alerts, strategies, simulation runs)
- **ClickHouse**: Time-series data (simulation events, OHLCV candles)

## Prerequisites

1. **PostgreSQL** must be running and accessible
2. **ClickHouse** must be running and accessible (if migrating time-series data)
3. Environment variables must be configured (see `.env.example`)

### Required Environment Variables

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=your_password
POSTGRES_DATABASE=quantbot
POSTGRES_MAX_CONNECTIONS=10

# ClickHouse (optional, for time-series data)
USE_CLICKHOUSE=true
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=18123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=quantbot
```

## Migration Process

### Step 1: Backup Existing SQLite Databases

**IMPORTANT**: Always backup your data before migration!

```bash
# Run the backup script
chmod +x scripts/migration/backup-sqlite-dbs.sh
./scripts/migration/backup-sqlite-dbs.sh
```

This creates:
- A backup directory with all `.db` files
- A compressed archive in `data/backups/`

### Step 2: Initialize PostgreSQL Schema

Ensure PostgreSQL tables are created:

```bash
# Run the PostgreSQL init script
psql -U quantbot -d quantbot -f scripts/migration/postgres/001_init.sql
```

### Step 3: Initialize ClickHouse (Optional)

If you're migrating time-series data:

```bash
# ClickHouse tables are auto-created by the storage package
# But you can verify with:
tsx -e "import { initClickHouse } from '@quantbot/storage'; await initClickHouse();"
```

### Step 4: Dry Run Migration

Test the migration without actually moving data:

```bash
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --dry-run
```

This shows:
- Which databases will be migrated
- How many rows will be migrated
- Any potential errors

### Step 5: Run Migration

Once you've verified the dry run looks correct:

```bash
# Migrate all databases
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts

# Or migrate specific databases only
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --db caller_alerts
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --db quantbot
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --db strategy_results
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --db dashboard_metrics
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --db unified_calls
```

## Database Migration Mapping

### caller_alerts.db → PostgreSQL

| SQLite Table | PostgreSQL Table | Notes |
|--------------|------------------|-------|
| `caller_alerts` | `callers` | Unique callers extracted |
| `caller_alerts` | `tokens` | Unique tokens extracted |
| `caller_alerts` | `alerts` | Alert records |

### quantbot.db → PostgreSQL

| SQLite Table | PostgreSQL Table | Notes |
|--------------|------------------|-------|
| `tokens` | `tokens` | Token registry |
| `strategies` | `strategies` | Strategy definitions |
| `simulation_runs` | `simulation_runs` | Simulation metadata |
| `simulation_runs` | `simulation_results_summary` | Results summary |
| `simulation_events` | ClickHouse `simulation_events` | Time-series events |

### strategy_results.db → PostgreSQL

| SQLite Table | PostgreSQL Table | Notes |
|--------------|------------------|-------|
| `strategy_results` | `simulation_results_summary` | Updates existing runs |

### dashboard_metrics.db → PostgreSQL

| SQLite Table | PostgreSQL Table | Notes |
|--------------|------------------|-------|
| `dashboard_metrics` | `dashboard_metrics` | Creates new table |

### unified_calls.db → PostgreSQL

| SQLite Table | PostgreSQL Table | Notes |
|--------------|------------------|-------|
| `unified_calls` | `callers`, `tokens`, `alerts`, `calls` | Normalized data |

## Data Transformation

### IDs and References

- **SQLite `INTEGER` IDs** → **PostgreSQL `BIGSERIAL` IDs**
- Old IDs are preserved in `metadata_json` fields
- Foreign key relationships are re-established during migration

### Timestamps

- **SQLite `TEXT/INTEGER` timestamps** → **PostgreSQL `TIMESTAMPTZ`**
- Unix timestamps are converted to proper timestamps
- Timezone: UTC is assumed for all historical data

### JSON Fields

- **SQLite `TEXT` (JSON strings)** → **PostgreSQL `JSONB`**
- Enables efficient querying and indexing of JSON data

### Numeric Precision

- **SQLite `REAL`** → **PostgreSQL `NUMERIC(38, 18)`** for prices
- Prevents floating-point precision errors in financial calculations

## Verification

After migration, verify the data:

```bash
# Check PostgreSQL row counts
psql -U quantbot -d quantbot -c "
  SELECT 'tokens' as table_name, COUNT(*) FROM tokens
  UNION ALL
  SELECT 'callers', COUNT(*) FROM callers
  UNION ALL
  SELECT 'alerts', COUNT(*) FROM alerts
  UNION ALL
  SELECT 'strategies', COUNT(*) FROM strategies
  UNION ALL
  SELECT 'simulation_runs', COUNT(*) FROM simulation_runs
  UNION ALL
  SELECT 'simulation_results_summary', COUNT(*) FROM simulation_results_summary;
"

# Check ClickHouse row counts (if applicable)
clickhouse-client --query "
  SELECT 'simulation_events' as table_name, COUNT(*) FROM quantbot.simulation_events
  UNION ALL
  SELECT 'ohlcv_candles', COUNT(*) FROM quantbot.ohlcv_candles;
"
```

## Troubleshooting

### Connection Errors

**Error**: `ECONNREFUSED` or `Connection refused`

**Solution**: 
- Verify PostgreSQL/ClickHouse is running
- Check environment variables
- Verify host/port settings

### Duplicate Key Errors

**Error**: `duplicate key value violates unique constraint`

**Solution**:
- This is expected on re-runs
- Migration uses `ON CONFLICT` clauses to handle duplicates
- Safe to ignore these warnings

### Missing Foreign Keys

**Error**: `foreign key constraint failed`

**Solution**:
- Ensure all referenced tables exist
- Run migrations in order (tokens/callers before alerts/runs)
- The script handles this automatically

### Memory Issues

**Error**: `JavaScript heap out of memory`

**Solution**:
```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts
```

## Rollback

If you need to rollback:

1. **Restore from backup**:
   ```bash
   # Find your backup
   ls -la data/backups/
   
   # Extract and restore
   tar -xzf data/backups/pre-migration-YYYYMMDD-HHMMSS.tar.gz
   cp pre-migration-YYYYMMDD-HHMMSS/*.db data/
   ```

2. **Clear PostgreSQL** (if needed):
   ```bash
   psql -U quantbot -d quantbot -c "
     TRUNCATE TABLE calls, alerts, simulation_results_summary, simulation_runs, strategies, tokens, callers CASCADE;
   "
   ```

3. **Clear ClickHouse** (if needed):
   ```bash
   clickhouse-client --query "TRUNCATE TABLE quantbot.simulation_events;"
   ```

## Post-Migration

After successful migration:

1. **Update application code** to use PostgreSQL/ClickHouse clients
2. **Remove or archive** old SQLite files (keep backups!)
3. **Update environment variables** to disable SQLite
4. **Test application** thoroughly with new database backend

### Archive SQLite Files

```bash
# Create archive directory
mkdir -p data/archive/sqlite

# Move old databases
mv data/*.db data/archive/sqlite/
mv data/databases/*.db data/archive/sqlite/

# Create archive
tar -czf data/archive/sqlite-databases-$(date +%Y%m%d).tar.gz data/archive/sqlite/
```

## Performance Notes

- **Large databases**: Migration may take several minutes for databases with millions of rows
- **Batch processing**: Simulation events are migrated in batches of 1000 to avoid memory issues
- **Indexes**: PostgreSQL indexes are created during schema init, not during migration
- **Transactions**: Each database migration runs in a transaction for atomicity

## Support

If you encounter issues:

1. Check the migration logs
2. Verify environment variables
3. Ensure database services are running
4. Review the troubleshooting section above
5. Check backup integrity before retrying

## Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [ClickHouse Documentation](https://clickhouse.com/docs/)
- [QuantBot Storage Architecture](../storage-architecture.md)

