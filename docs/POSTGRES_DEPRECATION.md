# PostgreSQL Deprecation Notice

## Overview

PostgreSQL is being phased out in favor of:
- **DuckDB** for event logging and data storage
- **Prometheus** for live counters and alerting

## Migration Status

### ✅ Migrated to DuckDB

- **Event Logging**: `@quantbot/observability/event-log` (DuckDB)
  - Billing-grade API call tracking
  - Cost, status, latency, run_id tracking
  - Circuit breaker implementation

- **Token Data**: `TokenDataRepository` (DuckDB)
  - OHLCV coverage tracking for ClickHouse

- **Callers**: `CallersRepository` (DuckDB)
  - Extracted from calls data

- **Strategies**: `StrategiesRepository` (DuckDB)
  - Strategy configuration storage

### ✅ Removed (PostgreSQL Completely Removed)

All PostgreSQL repositories have been removed:

- ✅ `TokensRepository` (Postgres) - **REMOVED** - Use DuckDB `TokenDataRepository` or ClickHouse for OHLCV metadata
- ✅ `CallsRepository` (Postgres) - **REMOVED** - Use DuckDB `user_calls_d` table via `queryCallsDuckdb` workflow
- ✅ `AlertsRepository` (Postgres) - **REMOVED** - No longer needed (no live monitoring)
- ✅ `CallersRepository` (Postgres) - **REMOVED** - Use DuckDB `CallersRepository`
- ✅ `StrategiesRepository` (Postgres) - **REMOVED** - Use DuckDB `StrategiesRepository`
- ✅ `SimulationResultsRepository` (Postgres) - **REMOVED** - Use ClickHouse `storeEvents()` via `ClickHouseService`
- ✅ `SimulationRunsRepository` (Postgres) - **REMOVED** - Metadata logging implemented (full DuckDB table pending if needed)
- ✅ `ErrorRepository` (Postgres) - **REMOVED** - Use DuckDB event log or logging system
- ✅ `ApiQuotaRepository` (Postgres) - **REMOVED** - Replaced by DuckDB event log + Prometheus

## Replacement Architecture

### API Usage Tracking

**Old (Postgres):**
```typescript
import { ApiQuotaRepository } from '@quantbot/storage';
const repo = new ApiQuotaRepository();
await repo.recordUsage('birdeye', 120);
```

**New (DuckDB + Prometheus):**
```typescript
import { EventLogService, getEventLogService } from '@quantbot/observability';
import { PrometheusMetricsService, getPrometheusMetrics } from '@quantbot/observability';

const eventLog = getEventLogService({ dbPath: 'data/event_log.duckdb' });
const prometheus = getPrometheusMetrics();

// Event log (billing-grade)
await eventLog.logEvent({
  timestamp: new Date(),
  api_name: 'birdeye',
  endpoint: '/defi/ohlcv',
  status_code: 200,
  success: true,
  latency_ms: 150,
  credits_cost: 120,
  run_id: 'run-123',
});

// Prometheus (live counters)
prometheus.recordApiCall('birdeye', '/defi/ohlcv', 200, 150, 120);
```

### Circuit Breaker

**Old:** None (manual monitoring required)

**New:** Built into `EventLogService`
```typescript
const eventLog = getEventLogService({
  dbPath: 'data/event_log.duckdb',
  circuitBreaker: {
    enabled: true,
    windowMinutes: 60,
    threshold: 1000000, // 1M credits
  },
});

// Automatically blocks API calls if threshold exceeded
```

## Timeline

- **Phase 1** ✅ COMPLETE: DuckDB repositories created, PostgreSQL marked as deprecated
- **Phase 2** ✅ COMPLETE: Updated `StorageEngine` to use DuckDB repositories
- **Phase 3** ✅ COMPLETE: PostgreSQL dependencies and code removed

## Breaking Changes

When PostgreSQL is fully removed:
- All `@quantbot/storage` PostgreSQL repository exports will be removed
- `getPostgresPool()`, `getPostgresClient()`, etc. will be removed
- Environment variables (`POSTGRES_*`) will no longer be used
- `docker-compose.yml` PostgreSQL service can be removed

## Migration Guide

### For Repository Users

1. **Token Data**: Use `TokenDataRepository` from `@quantbot/storage/duckdb`
2. **Callers**: Use `CallersRepository` from `@quantbot/storage/duckdb`
3. **Strategies**: Use `StrategiesRepository` from `@quantbot/storage/duckdb`
4. **API Quota**: Use `EventLogService` + `PrometheusMetricsService` from `@quantbot/observability`

### For Service Users

Services should be updated to use DuckDB repositories. The `StorageEngine` will be updated to use DuckDB internally.

## Questions?

- See `docs/MIGRATION_POSTGRES_TO_DUCKDB.md` for detailed migration plan
- See `packages/observability/src/event-log.ts` for event logging API
- See `packages/observability/src/prometheus-metrics.ts` for metrics API

