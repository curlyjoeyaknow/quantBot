# Web Dashboard - PostgreSQL Migration Guide

## ✅ What Was Updated

The web dashboard has been migrated from SQLite to PostgreSQL!

### New Files Created

1. **`lib/db/postgres-manager.ts`** - PostgreSQL connection manager
2. **`lib/services/caller-service.ts`** - Caller data service using PostgreSQL
3. **`lib/services/dashboard-service-postgres.ts`** - Dashboard metrics from PostgreSQL
4. **`.env.local`** - Environment configuration for web dashboard

### Database Connection

The dashboard now connects to PostgreSQL instead of SQLite files.

**Before** (SQLite):
```typescript
import { dbManager } from '@/lib/db-manager';
const db = await dbManager.getDatabase();
```

**After** (PostgreSQL):
```typescript
import { postgresManager } from '@/lib/db/postgres-manager';
const result = await postgresManager.query('SELECT * FROM alerts');
```

## 🚀 Running the Web Dashboard

### 1. Start the Dashboard

```bash
cd packages/web
npm run dev
```

### 2. Access the Dashboard

Open http://localhost:3000

### 3. Available Routes

The dashboard provides these views:

- `/` - Main dashboard with overview metrics
- `/caller-history` - All caller alerts with filtering
- `/recent-alerts` - Recent alerts from past week
- `/simulations` - Simulation results
- `/optimizations` - Strategy optimization results

## 🔧 API Routes (Updated for PostgreSQL)

### Dashboard Metrics
```typescript
// GET /api/dashboard
import { dashboardServicePostgres } from '@/lib/services/dashboard-service-postgres';

export async function GET() {
  const metrics = await dashboardServicePostgres.getMetrics();
  return Response.json(metrics);
}
```

### Caller History
```typescript
// GET /api/caller-history?limit=50&offset=0
import { callerService } from '@/lib/services/caller-service';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');
  
  const data = await callerService.getCallerHistory({ limit, offset });
  return Response.json(data);
}
```

### Recent Alerts
```typescript
// GET /api/recent-alerts
import { callerService } from '@/lib/services/caller-service';

export async function GET() {
  const alerts = await callerService.getRecentAlerts(100);
  return Response.json(alerts);
}
```

## 📊 Data Available

### From PostgreSQL

✅ **Alerts** - All 14,280 caller alerts
✅ **Tokens** - All 3,840 unique tokens
✅ **Callers** - All 333 unique callers  
✅ **Dashboard Metrics** - 463 pre-computed metrics
✅ **Strategies** - Strategy definitions

### Example Queries

**Get all alerts with caller and token info:**
```sql
SELECT 
  a.id,
  t.symbol as token_symbol,
  t.address as token_address,
  c.handle as caller_handle,
  a.alert_timestamp,
  a.alert_price
FROM alerts a
LEFT JOIN tokens t ON t.id = a.token_id
LEFT JOIN callers c ON c.id = a.caller_id
ORDER BY a.alert_timestamp DESC
LIMIT 100;
```

**Get caller statistics:**
```sql
SELECT 
  c.handle,
  COUNT(*) as total_alerts,
  COUNT(DISTINCT a.token_id) as unique_tokens
FROM alerts a
LEFT JOIN callers c ON c.id = a.caller_id
GROUP BY c.handle
ORDER BY total_alerts DESC;
```

## 🔄 Updating Existing API Routes

If you have custom API routes still using SQLite, update them:

### Before (SQLite):
```typescript
import { dbManager } from '@/lib/db-manager';

export async function GET() {
  const db = await dbManager.getDatabase();
  const all = promisify(db.all.bind(db));
  const rows = await all('SELECT * FROM caller_alerts LIMIT 100');
  return Response.json(rows);
}
```

### After (PostgreSQL):
```typescript
import { postgresManager } from '@/lib/db/postgres-manager';

export async function GET() {
  const result = await postgresManager.query(`
    SELECT 
      a.id,
      t.address,
      t.symbol,
      c.handle as caller_name,
      a.alert_timestamp
    FROM alerts a
    LEFT JOIN tokens t ON t.id = a.token_id
    LEFT JOIN callers c ON c.id = a.caller_id
    ORDER BY a.alert_timestamp DESC
    LIMIT 100
  `);
  
  return Response.json(result.rows);
}
```

## 🎯 Key Changes in Schema

### SQLite → PostgreSQL Mapping

| SQLite | PostgreSQL | Notes |
|--------|-----------|-------|
| `caller_alerts` | `alerts` + `tokens` + `callers` | Normalized structure |
| `caller_name` | Join with `callers.handle` | Foreign key relationship |
| `token_address` | Join with `tokens.address` | Foreign key relationship |
| `alert_timestamp` | `alerts.alert_timestamp` | Now TIMESTAMPTZ |
| `price_at_alert` | `alerts.alert_price` | NUMERIC type |

### New Features with PostgreSQL

✅ **JSONB Support** - Store and query JSON metadata
✅ **Full-Text Search** - Search across tokens/callers
✅ **Window Functions** - Advanced analytics
✅ **CTEs** - Complex queries made simple
✅ **Concurrent Access** - Multiple users simultaneously

## 🧪 Testing the Dashboard

### 1. Health Check

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2025-12-06T..."
}
```

### 2. Get Dashboard Metrics

```bash
curl http://localhost:3000/api/dashboard
```

### 3. Get Recent Alerts

```bash
curl http://localhost:3000/api/recent-alerts
```

### 4. Get Caller History

```bash
curl "http://localhost:3000/api/caller-history?limit=10&offset=0"
```

## 🐛 Troubleshooting

### Issue: "Cannot connect to database"

**Solution**:
1. Check PostgreSQL is running: `docker-compose ps`
2. Verify `.env.local` has correct credentials
3. Test connection: `tsx ../../scripts/test-postgres-connection.ts`

### Issue: "No data showing"

**Solution**:
1. Verify data was migrated: 
   ```bash
   docker-compose exec postgres psql -U quantbot -d quantbot -c "SELECT COUNT(*) FROM alerts;"
   ```
2. Check browser console for errors
3. Clear cache and refresh

### Issue: "Module not found" errors

**Solution**:
```bash
# Install dependencies
cd packages/web
npm install

# Make sure PostgreSQL packages are installed
npm install pg @types/pg
```

## 📝 Environment Variables

Make sure `packages/web/.env.local` has:

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=quantbot_secure_password
POSTGRES_DATABASE=quantbot
```

## ✨ Next Steps

1. **Update Remaining Routes** - Convert any remaining SQLite routes to PostgreSQL
2. **Add Caching** - Use Redis or in-memory cache for frequently accessed data
3. **Add Realtime** - Use PostgreSQL LISTEN/NOTIFY for live updates
4. **Optimize Queries** - Add indexes for common query patterns

## 📚 Resources

- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **pg Library**: https://node-postgres.com/
- **Next.js API Routes**: https://nextjs.org/docs/api-routes/introduction
- **Connection Test**: `tsx ../../scripts/test-postgres-connection.ts`

---

**Your web dashboard is now ready to use with PostgreSQL!** 🎉

The dashboard will automatically connect to the migrated PostgreSQL database with all 18,917 rows of data.

