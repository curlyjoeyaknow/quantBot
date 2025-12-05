# 🚀 Start Here: Database Migration Guide

## What's This About?

Your QuantBot project currently uses SQLite databases. We've created a complete migration system to move your data to:
- **PostgreSQL** - for application data (faster, more scalable)
- **ClickHouse** - for time-series data (optimized analytics)

## Why Migrate?

✅ **Better Performance**: Faster queries, especially with large datasets
✅ **Scalability**: Handle millions of rows without slowdown
✅ **Reliability**: ACID transactions, better backup/restore
✅ **Features**: Advanced queries, JSON support, full-text search
✅ **Concurrent Access**: Multiple users/processes can access simultaneously

## Current Status

Your SQLite databases found:
```
data/caller_alerts.db
data/quantbot.db
data/simulations.db
data/strategy_results.db
data/dashboard_metrics.db
data/unified_calls.db
data/databases/*.db
```

All ready to migrate! ✨

## Quick Start (3 Steps)

### Step 1: Setup Environment

Make sure your `.env` has PostgreSQL settings:

```bash
# Add these to your .env file
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=your_password_here
POSTGRES_DATABASE=quantbot

# Optional: ClickHouse for time-series data
USE_CLICKHOUSE=true
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=18123
```

### Step 2: Start Databases

```bash
# Start PostgreSQL and ClickHouse with Docker
docker-compose up -d postgres clickhouse

# Verify they're running
docker-compose ps
```

### Step 3: Migrate!

```bash
# Backup your data (IMPORTANT!)
./scripts/migration/backup-sqlite-dbs.sh

# Run the migration
./scripts/migration/run-migration.sh

# Verify it worked
tsx scripts/migration/verify-migration.ts
```

**Done!** Your data is now in PostgreSQL and ClickHouse. 🎉

## What Gets Migrated?

```
SQLite Files                    →    New Databases
=================================    ================

caller_alerts.db                →    PostgreSQL:
  • caller_alerts table         →      • callers
  • caller_stats table          →      • tokens
                                       • alerts

quantbot.db                     →    PostgreSQL:
  • tokens                      →      • tokens
  • strategies                  →      • strategies
  • simulation_runs             →      • simulation_runs
                                →      • simulation_results_summary
  • simulation_events           →    ClickHouse:
                                →      • simulation_events

strategy_results.db             →    PostgreSQL:
  • strategy_results            →      • simulation_results_summary

dashboard_metrics.db            →    PostgreSQL:
  • dashboard_metrics           →      • dashboard_metrics

unified_calls.db                →    PostgreSQL:
  • unified_calls               →      • callers, tokens, alerts, calls
```

## Time Required

- **Small datasets** (< 10k alerts): ~5 minutes
- **Medium datasets** (10k-100k alerts): ~15 minutes
- **Large datasets** (> 100k alerts): ~30 minutes

Plus setup time: ~5 minutes

## Is It Safe?

**Yes!** The migration:
- ✅ Creates backups before starting
- ✅ Doesn't delete your SQLite files
- ✅ Can be run multiple times safely
- ✅ Has a rollback procedure
- ✅ Runs in transactions (all-or-nothing)

## Need More Help?

Choose your guide based on your preference:

### Quick & Simple
📄 **[QUICKSTART.md](scripts/migration/QUICKSTART.md)** - TL;DR version (5 min read)

### Step-by-Step
📄 **[Migration Guide](docs/migration/sqlite-to-postgres-clickhouse.md)** - Complete walkthrough (15 min read)

### Technical Details
📄 **[Migration Summary](docs/migration/MIGRATION_SUMMARY.md)** - Architecture & design (10 min read)

### Script Reference
📄 **[Scripts README](scripts/migration/README.md)** - Script documentation (5 min read)

## Common Questions

**Q: Will this delete my SQLite files?**
A: No! They remain untouched. Only copies data.

**Q: What if something goes wrong?**
A: Easy rollback from automatic backups. See [rollback section](scripts/migration/QUICKSTART.md#rollback-if-needed).

**Q: Can I test first?**
A: Yes! Run with `--dry-run` to see what would happen.

**Q: How do I know it worked?**
A: Run the verification script. It compares row counts.

**Q: Do I need to change my code?**
A: Minimal changes. App should auto-detect PostgreSQL.

## Ready to Start?

```bash
# 1. Check prerequisites
docker --version
psql --version  # or use Docker's psql

# 2. Set up environment
cp .env.example .env
nano .env  # Add PostgreSQL settings

# 3. Start databases
docker-compose up -d

# 4. Run migration
./scripts/migration/backup-sqlite-dbs.sh
./scripts/migration/run-migration.sh
```

## After Migration

1. ✅ Restart your application
2. ✅ Test all features (bot commands, simulations, etc.)
3. ✅ Archive old SQLite files (keep backups!)
4. ✅ Enjoy faster, more scalable database! 🚀

## Need Help?

1. Check the [troubleshooting guide](docs/migration/sqlite-to-postgres-clickhouse.md#troubleshooting)
2. Review migration logs
3. Verify environment variables
4. Make sure databases are running

## File Structure

```
scripts/migration/
├── backup-sqlite-dbs.sh              # Backup script
├── migrate-sqlite-to-postgres-clickhouse.ts  # Main migration
├── run-migration.sh                   # Migration runner
├── verify-migration.ts                # Verification
├── QUICKSTART.md                      # Quick guide
└── README.md                          # Scripts docs

docs/migration/
├── sqlite-to-postgres-clickhouse.md   # Complete guide
└── MIGRATION_SUMMARY.md               # Overview

START_HERE.md                          # This file
MIGRATION_COMPLETE.md                  # Completion summary
```

## What's Next?

👉 **Go to**: [QUICKSTART.md](scripts/migration/QUICKSTART.md) for the fastest path

👉 **Or**: [Migration Guide](docs/migration/sqlite-to-postgres-clickhouse.md) for detailed steps

👉 **Or**: Just run: `./scripts/migration/run-migration.sh` if you're feeling confident!

---

**Questions?** Check the docs above or review the troubleshooting sections.

**Ready?** Let's migrate! 🚀

