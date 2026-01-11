# SQLite Migration Quick Start

## TL;DR - Just Migrate My Data!

```bash
# 1. Make sure Docker databases are running
docker-compose up -d postgres clickhouse

# 2. Backup your SQLite databases (IMPORTANT!)
./scripts/migration/backup-sqlite-dbs.sh

# 3. Run the migration
./scripts/migration/run-migration.sh

# 4. Verify it worked
tsx scripts/migration/verify-migration.ts

# Done! 🎉
```

## What This Does

Migrates your SQLite databases to:
- **PostgreSQL**: For app data (tokens, alerts, strategies, etc.)
- **ClickHouse**: For time-series data (simulation events, candles)

## Before You Start

### Check Your Environment

Make sure your `.env` file has:

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=your_password_here
POSTGRES_DATABASE=quantbot

# ClickHouse (optional)
USE_CLICKHOUSE=true
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=18123
```

### Start Databases

```bash
# Start with Docker Compose
docker-compose up -d postgres clickhouse

# Or if using separate services
docker run -d -p 5432:5432 --name postgres \
  -e POSTGRES_USER=quantbot \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=quantbot \
  postgres:15

docker run -d -p 18123:8123 --name clickhouse \
  clickhouse/clickhouse-server:latest
```

## Migration Steps (Detailed)

### Step 1: Backup (Required!)

```bash
./scripts/migration/backup-sqlite-dbs.sh
```

This creates:
- `data/backups/pre-migration-YYYYMMDD-HHMMSS/` - Your backup
- `data/backups/pre-migration-YYYYMMDD-HHMMSS.tar.gz` - Compressed archive

**Keep these backups!** You'll need them if something goes wrong.

### Step 2: Test Run (Recommended)

```bash
./scripts/migration/run-migration.sh --dry-run
```

This shows you what will happen without actually changing anything.

Look for:
- ✓ Green checks = Good
- ✗ Red errors = Fix before proceeding
- Number of rows that will be migrated

### Step 3: Run Migration

```bash
./scripts/migration/run-migration.sh
```

This will:
1. Check database connections
2. Initialize PostgreSQL tables
3. Migrate your data
4. Show a summary

**Time**: Usually 5-30 minutes depending on data size.

### Step 4: Verify

```bash
tsx scripts/migration/verify-migration.ts
```

You should see:
```
┌────────────────┬────────────┬────────────┬────────────┬──────────┐
│ Source         │ Table      │ SQLite     │ Target     │ Status   │
├────────────────┼────────────┼────────────┼────────────┼──────────┤
│ caller_alerts  │ alerts     │    12345   │    12345   │ ✓ PASS   │
│ quantbot       │ tokens     │      456   │      456   │ ✓ PASS   │
...
```

All rows should show `✓ PASS`.

## Troubleshooting

### "Connection refused"

**Problem**: Can't connect to PostgreSQL or ClickHouse

**Fix**:
```bash
# Check if databases are running
docker-compose ps

# Restart if needed
docker-compose restart postgres clickhouse

# Test connection
psql -U quantbot -d quantbot -c '\l'
```

### "Command not found: tsx"

**Problem**: TypeScript executor not installed

**Fix**:
```bash
# Install dependencies
npm install
# or
pnpm install
```

### "Out of memory"

**Problem**: Large database causing memory issues

**Fix**:
```bash
# Increase Node.js memory
NODE_OPTIONS="--max-old-space-size=4096" ./scripts/migration/run-migration.sh
```

### "Some verifications failed"

**Problem**: Row counts don't match

**Fix**: This is often okay! The migration merges data from multiple SQLite files, so target counts may be higher. Check that:
- No `✗ FAIL` entries with SQLite > Target
- Data looks correct when you query it

## After Migration

### Update Your App

The app should automatically use PostgreSQL now. Just restart it:

```bash
# If running with Docker
docker-compose restart bot web

# If running locally
npm run dev
```

### Archive Old SQLite Files

Once you've verified everything works:

```bash
# Create archive directory
mkdir -p data/archive/sqlite

# Move old databases
mv data/*.db data/archive/sqlite/
mv data/databases/*.db data/archive/sqlite/

# Create compressed archive
tar -czf data/archive/sqlite-$(date +%Y%m%d).tar.gz data/archive/sqlite/

# Keep the tar.gz, can delete the directory
rm -rf data/archive/sqlite/
```

**Don't delete your backups from step 1!**

## Rollback (If Needed)

If something goes wrong:

```bash
# 1. Stop your app
docker-compose down

# 2. Restore SQLite databases
cd data/backups
tar -xzf pre-migration-YYYYMMDD-HHMMSS.tar.gz
cp -r pre-migration-YYYYMMDD-HHMMSS/*.db ../

# 3. Clear PostgreSQL (optional)
psql -U quantbot -d quantbot -c "TRUNCATE TABLE calls, alerts, simulation_results_summary, simulation_runs, strategies, tokens, callers CASCADE;"

# 4. Restart app with SQLite
cd ../..
docker-compose up -d
```

## FAQ

**Q: Will this delete my SQLite databases?**
A: No! They remain untouched. The migration only reads from them.

**Q: Can I run this multiple times?**
A: Yes! The migration handles duplicates gracefully using `ON CONFLICT` clauses.

**Q: What if I have new data after migration?**
A: You can run the migration again. It will only add new records.

**Q: How long does it take?**
A: Typically 5-30 minutes depending on data size:
- < 10k alerts: ~5 minutes
- 10k-100k alerts: ~15 minutes
- > 100k alerts: ~30 minutes

**Q: What if the migration fails halfway?**
A: It runs in transactions, so either all data migrates or none. No partial state.

**Q: Can I migrate just one database?**
A: Yes! Use `--db` flag:
```bash
tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts --db caller_alerts
```

**Q: Do I need ClickHouse?**
A: Not required. Set `USE_CLICKHOUSE=false` to skip ClickHouse migration.

## Need More Help?

Check these resources:
- [Full Migration Guide](../../docs/migration/sqlite-to-postgres-clickhouse.md)
- [Migration Scripts README](./README.md)
- [Troubleshooting](../../docs/migration/sqlite-to-postgres-clickhouse.md#troubleshooting)

## What Gets Migrated?

```
Your SQLite Files          →    New Database
================                =============

caller_alerts.db           →    PostgreSQL
  ├─ caller_alerts         →      ├─ tokens
  └─ caller_stats          →      ├─ callers
                                  └─ alerts

quantbot.db                →    PostgreSQL + ClickHouse
  ├─ tokens                →      ├─ tokens
  ├─ strategies            →      ├─ strategies
  ├─ simulation_runs       →      ├─ simulation_runs
  ├─ simulation_events     →      ├─ simulation_results_summary
  └─ ...                   →      └─ simulation_events (ClickHouse)

strategy_results.db        →    PostgreSQL
  └─ strategy_results      →      └─ simulation_results_summary

dashboard_metrics.db       →    PostgreSQL
  └─ dashboard_metrics     →      └─ dashboard_metrics

unified_calls.db           →    PostgreSQL
  └─ unified_calls         →      ├─ callers
                                  ├─ tokens
                                  ├─ alerts
                                  └─ calls
```

## Success!

If you see:
```
✓ PostgreSQL is accessible
✓ PostgreSQL schema initialized
✓ Migrated XXXX alerts
✓ Migrated XXXX tokens
✓ Migrated XXXX simulation runs

Migration completed successfully!
```

You're done! Your data is now in PostgreSQL and ClickHouse. 🎉

Your app will automatically use the new databases - just restart it and test your features.

