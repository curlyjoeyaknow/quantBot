# Post-Migration Setup Guide

Now that your data is in PostgreSQL, follow these steps to complete the setup.

## Step 1: Build the Packages

First, let's build all the TypeScript packages with the updated path configurations:

```bash
# Install all dependencies (if not already done)
npm install

# Build all packages
npm run build

# Or build individual packages
npm run build --workspace=@quantbot/utils
npm run build --workspace=@quantbot/storage
npm run build --workspace=@quantbot/monitoring
npm run build --workspace=@quantbot/simulation
npm run build --workspace=@quantbot/services
npm run build --workspace=@quantbot/bot
```

## Step 2: Verify Database Connections

Test that your application can connect to PostgreSQL:

```bash
# Test PostgreSQL connection
docker-compose exec postgres psql -U quantbot -d quantbot -c "SELECT version();"

# Check your data
docker-compose exec postgres psql -U quantbot -d quantbot -c "
  SELECT 
    'alerts' as table_name, COUNT(*) as count FROM alerts
  UNION ALL
  SELECT 'tokens', COUNT(*) FROM tokens
  UNION ALL
  SELECT 'callers', COUNT(*) FROM callers
  UNION ALL
  SELECT 'dashboard_metrics', COUNT(*) FROM dashboard_metrics;
"
```

Expected output:
```
     table_name      | count 
---------------------+-------
 alerts              | 14280
 tokens              |  3840
 callers             |   333
 dashboard_metrics   |   463
```

## Step 3: Test the Application

### Option A: Run in Development Mode

```bash
# Start the bot
npm run dev

# Or if you have a start script
npm start
```

### Option B: Run Specific Packages

```bash
# Run the bot
npm run dev --workspace=@quantbot/bot

# Run the web dashboard (in a separate terminal)
npm run dev --workspace=@quantbot/web
```

## Step 4: Verify Key Features

Test these features to ensure everything works:

### ✅ Database Queries
```bash
# Create a test script
cat > test-db-connection.ts << 'EOF'
import { Pool } from 'pg';
import { config } from 'dotenv';

config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW(), version()');
    console.log('✅ PostgreSQL Connection Successful!');
    console.log('Server Time:', result.rows[0].now);
    console.log('PostgreSQL Version:', result.rows[0].version);
    
    const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM alerts) as alerts,
        (SELECT COUNT(*) FROM tokens) as tokens,
        (SELECT COUNT(*) FROM callers) as callers,
        (SELECT COUNT(*) FROM dashboard_metrics) as metrics
    `);
    
    console.log('\n📊 Data Summary:');
    console.log('  Alerts:', counts.rows[0].alerts);
    console.log('  Tokens:', counts.rows[0].tokens);
    console.log('  Callers:', counts.rows[0].callers);
    console.log('  Metrics:', counts.rows[0].metrics);
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection Failed:', error);
    process.exit(1);
  }
}

testConnection();
EOF

# Run the test
tsx test-db-connection.ts

# Clean up
rm test-db-connection.ts
```

### ✅ Check Bot Functionality
- Send a command to your Telegram bot
- Verify it responds
- Check that it can query the database

### ✅ Web Dashboard (if applicable)
- Open http://localhost:3000 (or your configured port)
- Verify data loads from PostgreSQL
- Check that charts and metrics display correctly

## Step 5: Monitor Database Performance

### Check Active Connections
```bash
docker-compose exec postgres psql -U quantbot -d quantbot -c "
  SELECT count(*) as active_connections 
  FROM pg_stat_activity 
  WHERE datname = 'quantbot';
"
```

### Check Table Sizes
```bash
docker-compose exec postgres psql -U quantbot -d quantbot -c "
  SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    pg_total_relation_size(schemaname||'.'||tablename) as bytes
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY bytes DESC;
"
```

### Monitor Query Performance
```bash
docker-compose exec postgres psql -U quantbot -d quantbot -c "
  SELECT 
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    max_exec_time
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC
  LIMIT 10;
"
```

## Step 6: Update Application Code (if needed)

If your code still references SQLite, update it:

### Before (SQLite):
```typescript
import { Database } from 'sqlite3';

const db = new Database('data/quantbot.db');
```

### After (PostgreSQL):
```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE,
});

// Or use the storage package
import { getPostgresPool } from '@quantbot/storage';
const pool = getPostgresPool();
```

## Step 7: Archive Old SQLite Files

Once you've verified everything works:

```bash
# Create archive directory
mkdir -p data/archive/sqlite

# Move old databases (they're already backed up)
mv data/*.db data/archive/sqlite/ 2>/dev/null || true
mv data/databases/*.db data/archive/sqlite/ 2>/dev/null || true

# Create a final archive
tar -czf data/archive/sqlite-databases-$(date +%Y%m%d).tar.gz data/archive/sqlite/

# Optional: Remove the uncompressed copies (keep the .tar.gz!)
# rm -rf data/archive/sqlite/

echo "✅ Old SQLite files archived"
```

**Important**: Keep your migration backup safe:
- `data/backups/pre-migration-20251206-000241.tar.gz`

## Step 8: Set Up Database Maintenance

### Daily Backup Script

Create a backup script:

```bash
cat > scripts/maintenance/backup-postgres.sh << 'EOF'
#!/bin/bash
# Daily PostgreSQL backup script

BACKUP_DIR="data/backups/postgres"
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/quantbot-$DATE.sql"

mkdir -p "$BACKUP_DIR"

# Backup using pg_dump
docker-compose exec -T postgres pg_dump -U quantbot -d quantbot > "$BACKUP_FILE"

# Compress
gzip "$BACKUP_FILE"

echo "✅ Backup created: $BACKUP_FILE.gz"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete

echo "✅ Old backups cleaned up"
EOF

chmod +x scripts/maintenance/backup-postgres.sh
```

### Run Backup
```bash
./scripts/maintenance/backup-postgres.sh
```

### Schedule Daily Backups (Optional)

Add to crontab:
```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 2 AM)
0 2 * * * cd /home/memez/quantBot && ./scripts/maintenance/backup-postgres.sh
```

## Step 9: Performance Tuning (Optional)

### Analyze Tables
```bash
docker-compose exec postgres psql -U quantbot -d quantbot -c "
  ANALYZE alerts;
  ANALYZE tokens;
  ANALYZE callers;
  ANALYZE dashboard_metrics;
"
```

### Create Useful Indexes (if not already created)
```bash
docker-compose exec postgres psql -U quantbot -d quantbot << 'EOF'
-- Add indexes for common queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_timestamp 
  ON alerts(alert_timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_token_caller 
  ON alerts(token_id, caller_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tokens_address 
  ON tokens(address);

-- Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
EOF
```

## Step 10: Monitor and Optimize

### Watch Logs
```bash
# PostgreSQL logs
docker-compose logs -f postgres

# ClickHouse logs
docker-compose logs -f clickhouse

# Application logs
npm run dev 2>&1 | tee logs/app.log
```

### Check for Slow Queries
```bash
docker-compose exec postgres psql -U quantbot -d quantbot -c "
  SELECT 
    query,
    calls,
    total_exec_time / 1000 as total_seconds,
    mean_exec_time / 1000 as avg_seconds,
    max_exec_time / 1000 as max_seconds
  FROM pg_stat_statements
  WHERE mean_exec_time > 100
  ORDER BY mean_exec_time DESC
  LIMIT 20;
"
```

## Troubleshooting

### Issue: Connection Refused

```bash
# Check if databases are running
docker-compose ps

# Restart if needed
docker-compose restart postgres clickhouse

# Check logs
docker-compose logs postgres
```

### Issue: Permission Denied

```bash
# Grant permissions
docker-compose exec postgres psql -U quantbot -d quantbot -c "
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO quantbot;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO quantbot;
"
```

### Issue: Out of Connections

```bash
# Check current connections
docker-compose exec postgres psql -U quantbot -d quantbot -c "
  SELECT count(*) FROM pg_stat_activity WHERE datname = 'quantbot';
"

# Increase max connections in .env
# POSTGRES_MAX_CONNECTIONS=20

# Restart PostgreSQL
docker-compose restart postgres
```

## Success Checklist

- [ ] All packages built successfully
- [ ] PostgreSQL connection works
- [ ] Application starts without errors
- [ ] Bot responds to commands
- [ ] Web dashboard loads (if applicable)
- [ ] Database queries are fast
- [ ] Old SQLite files archived
- [ ] Backups configured
- [ ] Monitoring set up

## Resources

- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **ClickHouse Docs**: https://clickhouse.com/docs/
- **Migration Report**: `MIGRATION_SUCCESS_REPORT.md`
- **Database Credentials**: Check your `.env` file

---

**You're all set!** 🚀

Your QuantBot is now running on PostgreSQL with:
- ✅ 18,917 rows of migrated data
- ✅ Production-grade database
- ✅ Automatic backups
- ✅ Performance monitoring

Enjoy the improved performance and scalability!

