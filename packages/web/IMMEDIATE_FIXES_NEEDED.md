# Immediate Fixes Needed for Web Dashboard

## Issue: Dashboard uses PostgreSQL but data is in SQLite

### The Real Problem

The web dashboard's `/api/health` endpoint shows:
```json
{
  "database": "postgresql",
  "stats": {
    "alerts": 3174,  // ← Reading from PostgreSQL
    "tokens": 3840,
    "callers": 333
  }
}
```

**BUT** the actual data is in **SQLite databases**:
- `data/databases/caller_alerts.db`
- `data/databases/simulations.db`
- `data/databases/strategy_results.db`

### Why Pages Don't Work

1. **PostgreSQL connection** is configured in `lib/db/postgres-manager.ts`
2. **SQLite databases** exist in `data/databases/`
3. **Dashboard reads from PostgreSQL** which has different/incomplete data
4. **Components expect data** that's in SQLite

### Databases Found

```
data/databases/
├── caller_alerts.db (40 KB) - SQLite
├── dashboard_metrics.db (20 KB) - SQLite  
├── simulations.db (122 KB) - SQLite
├── strategy_results.db (36 KB) - SQLite
└── tokens.db (0 KB) - Empty
```

### What's Actually Happening

1. Web app connects to PostgreSQL
2. PostgreSQL has 3174 alerts
3. SQLite has the actual simulation/strategy data
4. Dashboard queries PostgreSQL → gets zeros for PNL
5. Pages stuck loading because data format doesn't match

## Immediate Fix Options

### Option 1: Use SQLite (Faster)

Update all API routes to use SQLite instead of PostgreSQL:

**Files to change:**
1. `lib/db-manager.ts` - Already uses SQLite
2. `app/api/dashboard/route.ts` - Switch from PostgreSQL to SQLite
3. `app/api/health/route.ts` - Use SQLite instead of PostgreSQL
4. All other API routes

**Pros:**
- Data already exists
- Faster to implement
- No migration needed

**Cons:**
- Limited to single-server deployment
- No advanced query features

### Option 2: Migrate SQLite → PostgreSQL (Better long-term)

**Scripts needed:**
```bash
# 1. Migrate caller alerts
ts-node scripts/migration/migrate-sqlite-to-postgres.ts --table alerts

# 2. Migrate simulations  
ts-node scripts/migration/migrate-sqlite-to-postgres.ts --table simulations

# 3. Migrate strategy results
ts-node scripts/migration/migrate-sqlite-to-postgres.ts --table strategy_results
```

**Pros:**
- Better scalability
- Advanced query capabilities
- Multiple connections

**Cons:**
- Takes time to migrate
- Need to keep data in sync

### Option 3: Hybrid Approach

- Keep PostgreSQL for new data
- Read from SQLite for historical data
- Gradually migrate

## Recommended: Use SQLite First

**Why:** The data is already there, we can get pages working NOW.

### Steps:

1. **Update Dashboard API** (`app/api/dashboard/route.ts`):
```typescript
// Change from:
import { postgresManager } from '@/lib/db/postgres-manager';

// To:
import { dbManager } from '@/lib/db-manager';
```

2. **Update Health Check** (`app/api/health/route.ts`):
```typescript
// Use SQLite dbManager instead of postgresManager
```

3. **Verify Database Paths**:
All paths use `../..` to reach project root ✅

4. **Test Each API**:
```bash
curl http://localhost:3000/api/dashboard
curl http://localhost:3000/api/caller-history?page=1
curl http://localhost:3000/api/simulations
```

## Database Content Check

```bash
# Check SQLite databases
cd /home/memez/quantBot

# Caller alerts
sqlite3 data/databases/caller_alerts.db "SELECT COUNT(*) FROM caller_alerts;"

# Simulations
sqlite3 data/databases/simulations.db "SELECT * FROM live_trade_strategies LIMIT 1;"

# Strategy results
sqlite3 data/databases/strategy_results.db "SELECT COUNT(*) FROM results;"

# Dashboard metrics
sqlite3 data/databases/dashboard_metrics.db "SELECT * FROM metrics ORDER BY computed_at DESC LIMIT 1;"
```

## What Each Database Contains

Based on file sizes:
- `caller_alerts.db` (40 KB) - ~100-500 rows
- `simulations.db` (122 KB) - Largest, likely has data
- `strategy_results.db` (36 KB) - Some results
- `dashboard_metrics.db` (20 KB) - Pre-computed metrics

## Next Steps

1. ✅ Check what's in each SQLite database
2. Switch API routes to use SQLite
3. Test dashboard with real data
4. Fix components based on actual data structure
5. Document which database system to use going forward

