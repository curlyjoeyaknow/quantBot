# Database Migration Scripts

This directory contains scripts for migrating SQLite databases to PostgreSQL and ClickHouse.

## Overview

The QuantBot project is migrating from SQLite to a more scalable architecture:
- **PostgreSQL**: For OLTP data (tokens, alerts, strategies, simulation runs)
- **ClickHouse**: For time-series data (OHLCV candles, simulation events)

## Scripts

### 1. `backup-sqlite-dbs.sh`

Creates a backup of all SQLite database files before migration.

```bash
./scripts/migration/backup-sqlite-dbs.sh
```

**Output**:
- Creates `data/backups/pre-migration-YYYYMMDD-HHMMSS/` with all `.db` files
- Creates compressed archive `data/backups/pre-migration-YYYYMMDD-HHMMSS.tar.gz`

### 2. `migrate-sqlite-to-postgres-clickhouse.ts`

Main migration script that transfers data from SQLite to PostgreSQL and ClickHouse.

```bash
# Dry run (shows what would be migrated)
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --dry-run

# Migrate all databases
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts

# Migrate specific database
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --db caller_alerts
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --db quantbot
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --db strategy_results
```

**Features**:
- Handles duplicate data gracefully (uses `ON CONFLICT` clauses)
- Migrates in transactions for data integrity
- Batch processing for large datasets
- Detailed logging and error handling

### 3. `verify-migration.ts`

Verifies that data was migrated correctly by comparing row counts.

```bash
tsx scripts/migration/verify-migration.ts
```

**Checks**:
- Compares SQLite vs PostgreSQL row counts
- Verifies key foreign key relationships
- Reports any discrepancies

### 4. `run-migration.sh`

Convenient wrapper script that:
- Checks database connectivity
- Initializes PostgreSQL schema
- Runs backup (optional)
- Executes migration
- Provides helpful output and next steps

```bash
# Dry run
./scripts/migration/run-migration.sh --dry-run

# Full migration
./scripts/migration/run-migration.sh
```

## Quick Start

### Prerequisites

1. **Start databases**:
   ```bash
   docker-compose up -d postgres clickhouse
   ```

2. **Set environment variables** (in `.env`):
   ```bash
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_USER=quantbot
   POSTGRES_PASSWORD=your_password
   POSTGRES_DATABASE=quantbot
   
   USE_CLICKHOUSE=true
   CLICKHOUSE_HOST=localhost
   CLICKHOUSE_PORT=18123
   ```

### Migration Steps

1. **Backup** (IMPORTANT!):
   ```bash
   ./scripts/migration/backup-sqlite-dbs.sh
   ```

2. **Dry run** to verify:
   ```bash
   ./scripts/migration/run-migration.sh --dry-run
   ```

3. **Run migration**:
   ```bash
   ./scripts/migration/run-migration.sh
   ```

4. **Verify** migration:
   ```bash
   tsx scripts/migration/verify-migration.ts
   ```

5. **Test** your application with the new database backend

## Migration Details

### Database Mapping

| SQLite Database | PostgreSQL Tables | ClickHouse Tables |
|----------------|-------------------|-------------------|
| `caller_alerts.db` | `callers`, `tokens`, `alerts` | - |
| `quantbot.db` | `tokens`, `strategies`, `simulation_runs`, `simulation_results_summary` | `simulation_events` |
| `strategy_results.db` | `simulation_results_summary` (updates) | - |
| `dashboard_metrics.db` | `dashboard_metrics` (new table) | - |
| `unified_calls.db` | `callers`, `tokens`, `alerts`, `calls` | - |

### Data Transformations

- **IDs**: SQLite `INTEGER` → PostgreSQL `BIGSERIAL`
- **Timestamps**: SQLite `TEXT/INTEGER` → PostgreSQL `TIMESTAMPTZ`
- **JSON**: SQLite `TEXT` → PostgreSQL `JSONB`
- **Decimals**: SQLite `REAL` → PostgreSQL `NUMERIC(38, 18)`

### Handling Duplicates

The migration script uses `ON CONFLICT` clauses to handle duplicates:
- Tokens: Merged by `(chain, address)` - symbol/name updated if null
- Callers: Merged by `(source, handle)`
- Alerts: Skipped if duplicate (based on timestamp + token + caller)
- Strategies: Merged by `(name, version)` - config updated

This allows you to safely re-run the migration without creating duplicates.

## Rollback

If you need to rollback:

1. **Stop application**
2. **Restore SQLite backups**:
   ```bash
   tar -xzf data/backups/pre-migration-YYYYMMDD-HHMMSS.tar.gz
   cp pre-migration-YYYYMMDD-HHMMSS/*.db data/
   ```
3. **Clear PostgreSQL** (optional):
   ```bash
   psql -U quantbot -d quantbot -c "TRUNCATE TABLE calls, alerts, simulation_results_summary, simulation_runs, strategies, tokens, callers CASCADE;"
   ```
4. **Restart application** with SQLite

## Troubleshooting

### Connection Errors

**Symptom**: `ECONNREFUSED` or connection timeout

**Solutions**:
- Verify databases are running: `docker-compose ps`
- Check environment variables
- Test connection: `psql -U quantbot -d quantbot -c '\l'`

### Memory Issues

**Symptom**: `JavaScript heap out of memory`

**Solution**:
```bash
NODE_OPTIONS="--max-old-space-size=4096" tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts
```

### Missing Data

**Symptom**: Verification shows missing rows

**Solutions**:
- Check migration logs for errors
- Verify foreign key relationships exist
- Re-run migration (safe due to `ON CONFLICT` handling)

## Performance

- **Small databases** (< 10k rows): < 1 minute
- **Medium databases** (10k-100k rows): 1-5 minutes
- **Large databases** (> 100k rows): 5-30 minutes

Factors affecting performance:
- Number of foreign key lookups
- Network latency to databases
- Batch size (currently 1000 for ClickHouse)

## Post-Migration

After successful migration:

1. **Update application** to use PostgreSQL/ClickHouse clients
2. **Archive SQLite files**:
   ```bash
   mkdir -p data/archive/sqlite
   mv data/*.db data/archive/sqlite/
   tar -czf data/archive/sqlite-$(date +%Y%m%d).tar.gz data/archive/sqlite/
   ```
3. **Update environment variables** to use new databases
4. **Test thoroughly** before deploying to production

## Additional Resources

- [Migration Guide](../../docs/migration/sqlite-to-postgres-clickhouse.md) - Detailed documentation
- [Storage Architecture](../../docs/storage-architecture.md) - Database design
- [PostgreSQL Schema](./postgres/001_init.sql) - PostgreSQL table definitions

## Support

For issues or questions:
1. Check the migration logs
2. Review troubleshooting section
3. Verify environment variables
4. Ensure backups exist before retrying

