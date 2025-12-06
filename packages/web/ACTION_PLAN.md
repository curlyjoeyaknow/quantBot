# Action Plan: Make Web Dashboard Functional

## Ground Truth (Verified)

✅ **Build works** - TypeScript compiles, server runs  
✅ **PostgreSQL has data** - 3174 alerts, 3840 tokens, 333 callers  
✅ **SQLite databases** - Exist but EMPTY (0 rows)  
❌ **Dashboard stuck loading** - Returns zeros because:
  - No simulations run → `pnlFromAlerts = 0`
  - No performance metrics calculated → `maxDrawdown = 0`
  
## Why Dashboard Shows Zeros

```json
{
  "totalCalls": 3174,    // ✅ From PostgreSQL
  "pnlFromAlerts": 0,    // ❌ No simulations exist
  "maxDrawdown": 0,       // ❌ No metrics computed
  "overallProfit": 0      // ❌ No PNL calculated
}
```

**Dashboard needs:**
1. Simulation results (PNL data)
2. Performance metrics (computed from simulations)
3. Strategy results

## Option 1: Run Simulations (Populate Data)

### Scripts to Run:
```bash
cd /home/memez/quantBot

# 1. Run simulations on historical alerts
npm run simulate
# OR
ts-node scripts/simulation/run-engine.ts

# 2. Compute dashboard metrics
ts-node scripts/analysis/score-and-analyze-unified-calls.ts

# 3. Calculate strategy results  
npm run optimize:strategies
```

### Expected Outcome:
- Populates `simulations` table in PostgreSQL
- Generates PNL data
- Dashboard shows real metrics

## Option 2: Fix UI to Handle Empty State

### Update Components:

**1. Dashboard Component** (`components/dashboard.tsx`):
```typescript
if (!metrics || (metrics.totalCalls > 0 && metrics.pnlFromAlerts === 0)) {
  return (
    <EmptyState
      title="No Simulation Data"
      description="Run simulations to generate performance metrics"
      action={
        <button onClick={() => router.push('/simulations')}>
          Go to Simulations
        </button>
      }
    />
  );
}
```

**2. Add Data Status Indicator**:
```typescript
<div className="bg-yellow-500/10 border border-yellow-500/50 p-4 rounded">
  <p>You have {totalCalls} alerts but no simulations run yet.</p>
  <button>Run Simulations</button>
</div>
```

## Option 3: Create Sample/Demo Data

```sql
-- Insert sample simulation results
INSERT INTO simulations (alert_id, pnl, max_reached, hold_duration)
VALUES 
  (1, 150.0, 250.0, 120),
  (2, -20.0, 50.0, 45),
  (3, 300.0, 400.0, 180);

-- Update dashboard metrics
INSERT INTO dashboard_metrics (computed_at, pnl_from_alerts, max_drawdown)
VALUES (NOW(), 430.0, -20.0);
```

## Recommended Approach

### Phase 1: Quick Wins (30 min)
1. **Fix Empty States**
   - Update Dashboard to show "No data" instead of loading forever
   - Add helpful messages explaining what's missing
   - Show data counts (3174 alerts found, 0 simulations)

2. **Test Other Pages**
   - Caller History should work (has alerts in PostgreSQL)
   - Health check works
   - Recent Alerts should work

### Phase 2: Generate Data (1-2 hours)  
1. **Run simulations** on subset of alerts
2. **Verify data** appears in dashboard
3. **Test performance analytics**

### Phase 3: Polish (1 hour)
1. **Add action buttons** ("Run Simulation", "Analyze Performance")
2. **Improve error messages**
3. **Add loading progress indicators**

## Diagnostic: What Pages Should Work NOW

### ✅ Should Work (Has PostgreSQL Data):
- Caller History (3174 alerts)
- Callers List (333 callers)
- Recent Alerts (if within date range)
- Health Check

### ❌ Won't Work (Needs Simulations):
- Dashboard metrics (PNL)
- Performance Analytics
- Optimizations
- Strategy comparison

### ❓ Unknown (Need Testing):
- Simulations list
- Reports generation
- Control panel

## Next Concrete Actions

1. **Test working pages**:
```bash
curl "http://localhost:3000/api/caller-history?page=1&pageSize=10"
curl http://localhost:3000/api/callers
curl http://localhost:3000/api/recent-alerts
```

2. **Fix Dashboard component** to show empty state

3. **Identify which simulation script** to run

4. **Run ONE simulation** as proof of concept

5. **Verify dashboard updates** with real data

## The Truth

**The dashboard IS working** - it's correctly showing that NO SIMULATION DATA EXISTS.

The fix is either:
- Run simulations to generate data
- OR update UI to explain what's missing

Not a code/path/build issue - it's a **data pipeline** issue.

