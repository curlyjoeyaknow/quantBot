# Next Steps - Post-Migration Priorities

## Overview

This document outlines the immediate next steps after completing the PostgreSQL removal and single factory pattern implementation.

## 🔴 High Priority - Critical Functionality

### 1. Implement WorkflowContext Repository Methods

**Location**: `packages/workflows/src/context/createProductionContext.ts`

**Current State**: Methods return empty arrays or no-op with warnings

**Actions Needed**:

#### 1.1 `calls.list()` Implementation
```typescript
// Current: Returns empty array with warning
// Needed: Query DuckDB user_calls_d table via workflow
```

**Implementation Options**:
- Option A: Create `queryCallsDuckdb` workflow that queries `user_calls_d` table
- Option B: Use existing `runSimulationDuckdb` workflow's call querying logic
- Option C: Add calls querying to `DuckDBStorageService`

**Recommendation**: Option A - Create dedicated workflow for call queries

#### 1.2 `simulationRuns.create()` Implementation
```typescript
// Current: No-op with warning
// Needed: Store simulation run metadata in DuckDB
```

**Implementation Options**:
- Use `DuckDBStorageService.storeSimulationRun()` method
- Create workflow for simulation run creation

**Recommendation**: Use `DuckDBStorageService` directly

#### 1.3 `simulationResults.insertMany()` Implementation
```typescript
// Current: No-op with warning
// Needed: Store simulation results in DuckDB
```

**Implementation Options**:
- Use `DuckDBStorageService.storeSimulationResults()` method
- Create workflow for batch result insertion

**Recommendation**: Use `DuckDBStorageService` directly

### 2. Re-implement CallDataLoader.loadCalls()

**Location**: `packages/analytics/src/loaders/CallDataLoader.ts`

**Current State**: Throws error - PostgreSQL removed

**Actions Needed**:
- Create `queryCallsDuckdb` workflow
- Update `CallDataLoader.loadCalls()` to use workflow
- Ensure proper data transformation from DuckDB format to `CallPerformance[]`

**Dependencies**: Requires `calls.list()` implementation above

### 3. Re-implement MetricsAggregator.calculateSystemMetrics()

**Location**: `packages/analytics/src/aggregators/MetricsAggregator.ts`

**Current State**: Throws error - PostgreSQL removed

**Actions Needed**:
- Determine what system metrics are needed
- Query DuckDB for system-level statistics
- Calculate metrics from provided calls (if no DB queries needed)

**Note**: May be able to calculate from provided calls without DB queries

## 🟡 Medium Priority - Workflow Completeness

### 4. Create `queryCallsDuckdb` Workflow

**Purpose**: Query calls from DuckDB `user_calls_d` table

**Location**: `packages/workflows/src/calls/queryCallsDuckdb.ts`

**Features**:
- Filter by caller name
- Filter by date range
- Filter by chain
- Return `CallRecord[]` format

**Dependencies**: DuckDB `user_calls_d` table schema

### 5. Update Scripts Migration Decisions

**Location**: `docs/SCRIPTS_WORKFLOW_MIGRATION.md`

**Pending Decisions**:

#### 5.1 `scripts/workflows/fetch-ohlcv.ts`
- **Status**: ⏸️ DECISION NEEDED
- **Options**:
  - Keep as-is (Postgres-based utility)
  - Migrate to DuckDB-based workflow
  - Deprecate if not needed

#### 5.2 `scripts/ingest/fetch-ohlcv-for-alerts-14d.ts`
- **Status**: ⏸️ DECISION NEEDED
- **Options**:
  - Keep as-is (custom optimizations)
  - Refactor to use `ingestOhlcv` workflow
  - Create specialized multi-interval workflow

## 🟢 Low Priority - Documentation & Cleanup

### 6. Update Migration Documentation

**Files to Update**:
- `docs/MIGRATION_POSTGRES_TO_DUCKDB.md` - Mark PostgreSQL removal as complete
- `docs/POSTGRES_DEPRECATION.md` - Update status to "Removed" instead of "Deprecated"
- Remove outdated TODO sections

### 7. Remove Deprecated Code References

**Search for**:
- `@deprecated` comments that reference PostgreSQL
- Old migration guides that are no longer relevant
- Outdated examples in documentation

### 8. Add Integration Tests

**Test Coverage Needed**:
- `queryCallsDuckdb` workflow
- `calls.list()` in WorkflowContext
- `simulationRuns.create()` in WorkflowContext
- `simulationResults.insertMany()` in WorkflowContext
- `CallDataLoader.loadCalls()` with DuckDB

## 📋 Implementation Order

### Phase 1: Core Functionality (Week 1)
1. ✅ Implement `calls.list()` using DuckDB query
2. ✅ Implement `simulationRuns.create()` using DuckDBStorageService
3. ✅ Implement `simulationResults.insertMany()` using DuckDBStorageService
4. ✅ Create `queryCallsDuckdb` workflow

### Phase 2: Analytics Integration (Week 1-2)
5. ✅ Re-implement `CallDataLoader.loadCalls()` using workflow
6. ✅ Re-implement `MetricsAggregator.calculateSystemMetrics()` (if needed)

### Phase 3: Scripts & Documentation (Week 2)
7. ✅ Make decisions on script migrations
8. ✅ Update documentation
9. ✅ Add integration tests

## 🔍 Quick Wins

These can be done immediately:

1. **Update `simulationRuns.create()`** - Just call `DuckDBStorageService.storeSimulationRun()`
2. **Update `simulationResults.insertMany()`** - Just call `DuckDBStorageService.storeSimulationResults()`
3. **Update migration docs** - Mark PostgreSQL removal as complete

## 🚀 Getting Started

### To implement `calls.list()`:

1. Check DuckDB schema for `user_calls_d` table:
   ```bash
   python -c "import duckdb; con = duckdb.connect('data/quantbot.db'); print(con.execute('DESCRIBE user_calls_d').fetchall())"
   ```

2. Create workflow:
   ```typescript
   // packages/workflows/src/calls/queryCallsDuckdb.ts
   export async function queryCallsDuckdb(
     spec: QueryCallsSpec,
     ctx: WorkflowContext
   ): Promise<CallRecord[]>
   ```

3. Update `createProductionContext`:
   ```typescript
   calls: {
     async list(q) {
       return await queryCallsDuckdb(q, ctx);
     }
   }
   ```

## 📝 Notes

- All PostgreSQL code has been removed ✅
- Single factory pattern implemented ✅
- DuckDB repositories created ✅
- Workflows need to be wired up to use DuckDB services
- Some analytics functionality temporarily broken (needs re-implementation)

