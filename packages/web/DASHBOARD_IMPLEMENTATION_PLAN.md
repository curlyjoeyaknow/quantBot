# Web Dashboard - Systematic Implementation Plan

## Component Analysis & Implementation Status

### Core Components (Priority Order)

| # | Component | API Route | Data Source | Status | Priority |
|---|-----------|-----------|-------------|---------|----------|
| 1 | **Health** | `/api/health` | PostgreSQL health | 🔴 TODO | HIGH |
| 2 | **Dashboard** | `/api/dashboard` | dashboard_metrics | 🔴 TODO | HIGH |
| 3 | **Recent Alerts** | `/api/recent-alerts` | alerts (7 days) | 🔴 TODO | HIGH |
| 4 | **Caller History** | `/api/caller-history` | alerts + pagination | 🟡 PARTIAL | HIGH |
| 5 | **Callers** | `/api/callers` + `/api/callers/stats` | callers stats | 🔴 TODO | MEDIUM |
| 6 | **Simulations** | `/api/simulations` | simulation_runs | 🔴 TODO | MEDIUM |
| 7 | **Optimizations** | `/api/optimizations` | optimization_jobs | 🔴 TODO | LOW |
| 8 | **Live Trade** | `/api/live-trade/strategies` | live strategies | 🔴 TODO | LOW |
| 9 | **Recording** | `/api/recording` | recording status | 🔴 TODO | LOW |
| 10 | **Control Panel** | `/api/control-panel/*` | service control | 🔴 TODO | LOW |
| 11 | **Weekly Reports** | `/api/reports/*` | generated reports | 🔴 TODO | LOW |

## Implementation Order

### Phase 1: Critical Infrastructure (IMMEDIATE)

#### 1.1 Health Check API ✅ Start Here
**File**: `app/api/health/route.ts`
**Purpose**: Verify PostgreSQL connection and system status
**Implementation**:
```typescript
import { postgresManager } from '@/lib/db/postgres-manager';

export async function GET() {
  const healthy = await postgresManager.healthCheck();
  const stats = await postgresManager.query(`
    SELECT 
      (SELECT COUNT(*) FROM alerts) as alerts,
      (SELECT COUNT(*) FROM tokens) as tokens,
      (SELECT COUNT(*) FROM callers) as callers
  `);
  
  return Response.json({
    status: healthy ? 'healthy' : 'unhealthy',
    database: 'postgresql',
    stats: stats.rows[0],
    timestamp: new Date().toISOString()
  });
}
```

#### 1.2 Dashboard Metrics API
**File**: `app/api/dashboard/route.ts`
**Purpose**: Main dashboard overview metrics
**Data Needed**:
- Total calls count
- PNL from strategy results
- Max drawdown
- Profit metrics

#### 1.3 Recent Alerts API  
**File**: `app/api/recent-alerts/route.ts`
**Purpose**: Last 7 days of alerts
**Query**: Recent alerts with token and caller info

### Phase 2: Core Features (HIGH PRIORITY)

#### 2.1 Caller History (Already Partially Done)
**File**: `app/api/caller-history/route.ts`
**Status**: Uses `callerAlertService` - needs PostgreSQL migration
**Features**: Pagination, filtering, search

#### 2.2 Callers Stats
**Files**: 
- `app/api/callers/route.ts` - List all callers
- `app/api/callers/stats/route.ts` - Caller statistics
**Data**: Aggregated stats per caller

### Phase 3: Analysis Features (MEDIUM PRIORITY)

#### 3.1 Simulations
**Files**:
- `app/api/simulations/route.ts` - List simulations
- `app/api/simulations/[name]/route.ts` - Simulation details
**Data**: simulation_runs table

#### 3.2 Optimizations
**File**: `app/api/optimizations/route.ts`
**Data**: optimization_jobs and optimization_trials

### Phase 4: Advanced Features (LOW PRIORITY)

#### 4.1 Live Trade Strategies
**File**: `app/api/live-trade/strategies/route.ts`
**Data**: TBD based on implementation

#### 4.2 Recording Status
**File**: `app/api/recording/route.ts`
**Data**: Recording service status

#### 4.3 Control Panel
**Files**: `app/api/control-panel/*`
**Purpose**: Service management

#### 4.4 Weekly Reports
**Files**: `app/api/reports/*`
**Purpose**: Generate/retrieve reports

## Data Available in PostgreSQL

### Tables We Have:
✅ **alerts** (14,280 rows) - All caller alerts
✅ **tokens** (3,840 rows) - Token information  
✅ **callers** (333 rows) - Caller information
✅ **dashboard_metrics** (463 rows) - Pre-computed metrics
✅ **strategies** (1 row) - Strategy definitions
✅ **simulation_runs** (0 rows) - Simulation metadata
✅ **simulation_results_summary** (0 rows) - Simulation results

### Tables We Need:
🔴 **optimization_jobs** - Not yet in schema
🔴 **optimization_trials** - Not yet in schema
🔴 **live_trade_strategies** - Application specific

## Service Layer (Already Created)

### Available Services:
✅ `postgresManager` - Database connection
✅ `callerService` - Caller and alert data
✅ `dashboardServicePostgres` - Dashboard metrics

### Services Needed:
🔴 `simulationService` - Simulation data
🔴 `optimizationService` - Optimization results  
🔴 `healthService` - System health checks

## Implementation Tasks

### Immediate (Do First):
- [x] Create PostgreSQL manager
- [x] Create caller service
- [x] Create dashboard service
- [ ] Fix `/api/health` route
- [ ] Fix `/api/dashboard` route  
- [ ] Fix `/api/recent-alerts` route
- [ ] Fix `/api/callers/*` routes

### Next Steps:
- [ ] Create simulation service
- [ ] Fix `/api/simulations/*` routes
- [ ] Add caching layer
- [ ] Add error boundaries
- [ ] Add loading states

### Testing:
- [ ] Health endpoint works
- [ ] Dashboard loads data
- [ ] Recent alerts display
- [ ] Caller history pagination works
- [ ] Filters work correctly

## Example Implementations

### Health Check
```typescript
// app/api/health/route.ts
import { postgresManager } from '@/lib/db/postgres-manager';

export async function GET() {
  try {
    const healthy = await postgresManager.healthCheck();
    const stats = await postgresManager.query(`
      SELECT 
        (SELECT COUNT(*) FROM alerts) as total_alerts,
        (SELECT COUNT(*) FROM tokens) as total_tokens,
        (SELECT COUNT(*) FROM callers) as total_callers,
        (SELECT pg_size_pretty(pg_database_size(current_database()))) as db_size
    `);
    
    return Response.json({
      status: healthy ? 'healthy' : 'unhealthy',
      database: 'postgresql',
      stats: stats.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({
      status: 'unhealthy',
      error: String(error),
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
```

### Dashboard Metrics
```typescript
// app/api/dashboard/route.ts
import { dashboardServicePostgres } from '@/lib/services/dashboard-service-postgres';

export async function GET() {
  try {
    const metrics = await dashboardServicePostgres.getMetrics();
    return Response.json(metrics);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
```

### Recent Alerts  
```typescript
// app/api/recent-alerts/route.ts
import { callerService } from '@/lib/services/caller-service';

export async function GET() {
  try {
    const alerts = await callerService.getRecentAlerts(100);
    return Response.json(alerts);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
```

## Progress Tracking

- Phase 1 (Critical): 0/3 ⬜⬜⬜
- Phase 2 (High): 0/2 ⬜⬜
- Phase 3 (Medium): 0/2 ⬜⬜
- Phase 4 (Low): 0/4 ⬜⬜⬜⬜

**Total**: 0/11 components working

## Success Criteria

A component is "DONE" when:
- ✅ API route returns data successfully
- ✅ Component renders without errors
- ✅ Loading states work
- ✅ Error states work
- ✅ Data displays correctly
- ✅ User interactions work (pagination, filtering, etc.)

## Next Action

**START WITH**: `/api/health/route.ts`

This is the simplest and will verify our PostgreSQL connection is working correctly.

