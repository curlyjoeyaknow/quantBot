# SQLite to PostgreSQL/ClickHouse Migration Summary

This document provides a high-level overview of the database migration process for the QuantBot project.

## Migration Status

### ✅ Completed Components

1. **Migration Script** (`scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts`)
   - Comprehensive data migration from SQLite to PostgreSQL and ClickHouse
   - Handles all major tables and relationships
   - Supports dry-run mode
   - Batch processing for large datasets
   - Graceful error handling and logging

2. **Backup Script** (`scripts/migration/backup-sqlite-dbs.sh`)
   - Creates timestamped backups of all SQLite databases
   - Generates compressed archives for easy storage

3. **Verification Script** (`scripts/migration/verify-migration.ts`)
   - Compares row counts between SQLite and target databases
   - Validates data integrity after migration
   - Provides detailed comparison reports

4. **Migration Runner** (`scripts/migration/run-migration.sh`)
   - Convenient wrapper with pre-flight checks
   - Validates database connectivity
   - Initializes schemas
   - Provides helpful next steps

5. **Documentation**
   - Comprehensive migration guide
   - Troubleshooting section
   - Rollback procedures
   - Post-migration checklist

## Migration Architecture

### Data Flow

```
SQLite Databases                PostgreSQL Tables              ClickHouse Tables
================                =================              =================

caller_alerts.db    ──────────> tokens                         
                    ──────────> callers
                    ──────────> alerts

quantbot.db         ──────────> tokens
                    ──────────> strategies
                    ──────────> simulation_runs
                    ──────────> simulation_results_summary
                    ──────────────────────────────────────────> simulation_events

strategy_results.db ──────────> simulation_results_summary
                                 (updates existing runs)

dashboard_metrics.db ─────────> dashboard_metrics
                                 (new table created)

unified_calls.db    ──────────> callers
                    ──────────> tokens
                    ──────────> alerts
                    ──────────> calls
```

### Database Tables Migrated

#### PostgreSQL (OLTP Data)

| Table | Source | Rows | Description |
|-------|--------|------|-------------|
| `tokens` | Multiple | All | Token registry with chain and address |
| `callers` | caller_alerts, unified_calls | All | Signal sources (Brook, LSY, etc.) |
| `alerts` | caller_alerts, unified_calls | All | Raw alerts from callers |
| `calls` | unified_calls | All | Normalized trading signals |
| `strategies` | quantbot | All | Strategy definitions with configs |
| `simulation_runs` | quantbot | All | Simulation metadata and runs |
| `simulation_results_summary` | quantbot, strategy_results | All | Aggregated simulation metrics |
| `dashboard_metrics` | dashboard_metrics | All | Pre-computed dashboard statistics |

#### ClickHouse (Time-Series Data)

| Table | Source | Rows | Description |
|-------|--------|------|-------------|
| `simulation_events` | quantbot | All | Detailed simulation event timeline |
| `ohlcv_candles` | (Future) | - | OHLCV price data |
| `tick_events` | (Future) | - | Real-time tick data |

## Key Features

### 1. Data Integrity

- **Transactions**: All migrations run in database transactions
- **Foreign Keys**: Relationships are preserved and re-established
- **Deduplication**: `ON CONFLICT` clauses prevent duplicates
- **Validation**: Verification script ensures data completeness

### 2. Safety

- **Backup First**: Automated backup before migration
- **Dry Run**: Test mode to preview changes
- **Rollback**: Clear procedures to restore SQLite
- **No Data Loss**: Original SQLite files remain untouched

### 3. Performance

- **Batch Processing**: Large datasets processed in batches
- **Connection Pooling**: Efficient database connections
- **Parallel Operations**: Where possible, operations run concurrently
- **Optimized Queries**: Indexed lookups for foreign keys

### 4. Flexibility

- **Selective Migration**: Migrate specific databases only
- **Rerunnable**: Safe to run multiple times
- **Incremental**: Can migrate new data without affecting existing
- **Configurable**: Environment variables control behavior

## Migration Timeline

### Estimated Time to Complete

- **Backup**: < 1 minute
- **Schema Init**: < 1 minute
- **Data Migration**: 
  - Small dataset (< 10k alerts): 1-5 minutes
  - Medium dataset (10k-100k alerts): 5-15 minutes
  - Large dataset (> 100k alerts): 15-60 minutes
- **Verification**: 1-2 minutes

**Total**: 5-60 minutes depending on data size

## Data Transformations

### Type Conversions

| SQLite Type | PostgreSQL Type | Notes |
|-------------|-----------------|-------|
| `INTEGER` | `BIGSERIAL` | Auto-incrementing IDs |
| `REAL` | `NUMERIC(38, 18)` | High-precision decimals for prices |
| `TEXT` | `TEXT` | String data |
| `TEXT` (JSON) | `JSONB` | Indexed JSON for efficient queries |
| `DATETIME` | `TIMESTAMPTZ` | Timezone-aware timestamps |
| `BOOLEAN` | `BOOLEAN` | Native boolean type |

### Schema Enhancements

**PostgreSQL Improvements**:
- Foreign key constraints for referential integrity
- JSONB for flexible metadata storage
- Proper timestamp types with timezone support
- Optimized indexes for common queries
- Normalized data structure (tokens, callers as separate entities)

**ClickHouse Optimizations**:
- Columnar storage for fast analytical queries
- Partitioning by chain and month for efficient pruning
- Optimized for time-series aggregations
- Compression for reduced storage

## Post-Migration Benefits

### 1. Scalability

- **Concurrent Access**: Multiple users can query simultaneously
- **Large Datasets**: Handle millions of rows efficiently
- **Horizontal Scaling**: Can add read replicas

### 2. Performance

- **Faster Queries**: PostgreSQL query optimizer
- **Analytical Speed**: ClickHouse for time-series analysis
- **Better Indexing**: Optimized for common query patterns

### 3. Features

- **JSONB Queries**: Rich querying of metadata
- **Aggregations**: Window functions, CTEs, and complex analytics
- **Full-Text Search**: Built-in search capabilities
- **Backup/Restore**: Enterprise-grade backup tools

### 4. Reliability

- **ACID Transactions**: Data consistency guarantees
- **Replication**: High availability options
- **Point-in-Time Recovery**: Can restore to any moment
- **Monitoring**: Better observability and metrics

## Testing Checklist

After migration, verify:

- [ ] Row counts match (run verification script)
- [ ] Application starts successfully
- [ ] Bot commands work correctly
- [ ] Web dashboard loads data
- [ ] Simulations can be run
- [ ] Historical data is accessible
- [ ] No foreign key constraint errors
- [ ] Timestamps are correct (check timezone)
- [ ] JSON metadata is queryable
- [ ] Performance is acceptable

## Common Issues and Solutions

### Issue: Foreign Key Constraint Violations

**Cause**: Referenced records don't exist (e.g., token_id not found)

**Solution**: 
- Migration script creates referenced records first
- If issue persists, check migration order
- May indicate data corruption in SQLite

### Issue: Duplicate Key Errors

**Cause**: Attempting to insert existing records

**Solution**:
- Expected on re-runs
- `ON CONFLICT` clauses handle this gracefully
- Safe to ignore

### Issue: Timestamp Conversion Errors

**Cause**: Invalid timestamp formats in SQLite

**Solution**:
- Migration handles both Unix timestamps and ISO strings
- Check SQLite data for corrupted dates
- May need to clean data before migration

### Issue: Out of Memory

**Cause**: Large datasets processed at once

**Solution**:
- Increase Node.js heap size: `NODE_OPTIONS="--max-old-space-size=4096"`
- Migration uses batching to mitigate this
- Process specific databases individually

## Maintenance

### Regular Backups

After migration, establish backup routines:

```bash
# PostgreSQL backup
pg_dump -U quantbot -d quantbot -F c -f backup-$(date +%Y%m%d).dump

# ClickHouse backup (export to file)
clickhouse-client --query "SELECT * FROM quantbot.simulation_events FORMAT Native" > simulation_events.native
```

### Monitoring

Monitor database health:

```sql
-- PostgreSQL table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ClickHouse table sizes
SELECT 
  table,
  formatReadableSize(sum(bytes)) as size,
  count() as parts
FROM system.parts
WHERE database = 'quantbot' AND active
GROUP BY table;
```

## Next Steps

1. **Run Migration**:
   ```bash
   ./scripts/migration/backup-sqlite-dbs.sh
   ./scripts/migration/run-migration.sh
   tsx scripts/migration/verify-migration.ts
   ```

2. **Update Application Code**:
   - Use `@quantbot/storage` package for database access
   - Update queries to use PostgreSQL syntax
   - Test all database operations

3. **Archive SQLite Files**:
   ```bash
   mkdir -p data/archive/sqlite
   mv data/*.db data/archive/sqlite/
   ```

4. **Monitor Performance**:
   - Watch query execution times
   - Monitor connection pool usage
   - Set up database monitoring tools

5. **Document Custom Queries**:
   - Update any custom SQL queries for PostgreSQL
   - Test all application features
   - Update API documentation if needed

## Support and Resources

- **Migration Scripts**: `/scripts/migration/`
- **Documentation**: `/docs/migration/`
- **PostgreSQL Schema**: `/scripts/migration/postgres/001_init.sql`
- **Storage Package**: `/packages/storage/`

For issues or questions, refer to:
- [Full Migration Guide](./sqlite-to-postgres-clickhouse.md)
- [Migration Scripts README](../../scripts/migration/README.md)
- [Storage Architecture](../storage-architecture.md)

## Conclusion

The migration infrastructure is production-ready with:
- ✅ Comprehensive migration scripts
- ✅ Automated backups
- ✅ Verification tools
- ✅ Detailed documentation
- ✅ Error handling and rollback procedures
- ✅ Support for incremental and selective migration

You can now safely migrate your SQLite databases to PostgreSQL and ClickHouse with confidence.
