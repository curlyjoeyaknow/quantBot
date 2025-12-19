# PostgreSQL to DuckDB Migration Plan

## Overview

This document outlines the migration from PostgreSQL to DuckDB for event logging and the addition of Prometheus + Grafana for monitoring.

## Completed Changes

### 1. DuckDB Event Log Service ✅

- **Location**: `packages/observability/src/event-log.ts`
- **Python Script**: `tools/observability/event_log.py`
- **Features**:
  - Billing-grade event log for every API call
  - Tracks: cost, status, latency, run_id, endpoint, method
  - Circuit breaker: stops API calls if credits exceed threshold in time window
  - Efficient DuckDB storage with proper indexing

### 2. Prometheus Metrics Service ✅

- **Location**: `packages/observability/src/prometheus-metrics.ts`
- **Features**:
  - Live counters for API calls, errors, credits
  - Latency histograms
  - Circuit breaker status gauge
  - Credits spent in time window gauge
  - Default Node.js metrics (CPU, memory, etc.)

### 3. Base API Client Integration ✅

- **Location**: `packages/api-clients/src/base-client.ts`
- **Changes**:
  - Integrated event logging into request/response interceptors
  - Integrated Prometheus metrics recording
  - Automatic latency tracking
  - Credit calculation hook (override in subclasses)

### 4. Birdeye Client Updates ✅

- **Location**: `packages/api-clients/src/birdeye-client.ts`
- **Changes**:
  - Overrides `calculateCredits()` method for Birdeye-specific pricing
  - OHLCV endpoints: 120 credits (5000 candles)
  - Other endpoints: 60 credits (<1000 candles)

### 5. ESM/CJS Fixes ✅

- **Location**: `packages/ohlcv/package.json`
- **Changes**:
  - Added `"type": "module"`
  - Added `exports` field with import/require support
  - Removed `dotenv` and `axios` from dependencies (moved to CLI layer)

## Remaining Work

### 1. PostgreSQL Removal (TODO)

**Current PostgreSQL Usage:**
- `packages/storage/src/postgres/postgres-client.ts` - Main client
- `packages/storage/src/postgres/repositories/` - All repositories:
  - `TokensRepository.ts`
  - `CallsRepository.ts`
  - `StrategiesRepository.ts`
  - `AlertsRepository.ts`
  - `CallersRepository.ts`
  - `SimulationResultsRepository.ts`
  - `SimulationRunsRepository.ts`
  - `ApiQuotaRepository.ts`
  - `ErrorRepository.ts`
  - `TokenDataRepository.ts`

**Migration Strategy:**
1. Create DuckDB equivalents for each repository
2. Migrate data from PostgreSQL to DuckDB
3. Update `StorageEngine` to use DuckDB instead of PostgreSQL
4. Remove PostgreSQL dependencies from `package.json`
5. Update all references throughout codebase

### 2. Grafana Dashboard (Optional)

**Location**: `tools/grafana/dashboards/`

**Recommended Dashboards:**
- API Call Metrics (calls, errors, latency)
- Credit Usage (total, by API, time windows)
- Circuit Breaker Status
- System Health (CPU, memory, etc.)

## Configuration

### Environment Variables

```bash
# DuckDB Event Log
EVENT_LOG_DB_PATH=data/event_log.duckdb

# Circuit Breaker
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_WINDOW_MINUTES=60
CIRCUIT_BREAKER_THRESHOLD=1000000  # 1M credits

# Prometheus
PROMETHEUS_PORT=9090
PROMETHEUS_ENABLE_DEFAULT_METRICS=true
```

### Usage Example

```typescript
import { EventLogService, getEventLogService } from '@quantbot/observability';
import { PrometheusMetricsService, getPrometheusMetrics } from '@quantbot/observability';
import { BirdeyeClient } from '@quantbot/api-clients';

// Initialize services
const eventLog = getEventLogService({
  dbPath: process.env.EVENT_LOG_DB_PATH || 'data/event_log.duckdb',
  circuitBreaker: {
    enabled: true,
    windowMinutes: 60,
    threshold: 1000000,
  },
});

const prometheus = getPrometheusMetrics({
  enableDefaultMetrics: true,
});

// Create API client with observability
const birdeye = new BirdeyeClient({
  eventLogService: eventLog,
  prometheusMetrics: prometheus,
  runId: 'run-123',
});

// API calls are automatically logged and metered
const candles = await birdeye.getOHLCV(tokenAddress, interval, limit);
```

## Testing

### Event Log Tests
- Test event logging with various API calls
- Test circuit breaker tripping and reset
- Test credit calculation accuracy
- Test DuckDB query performance

### Prometheus Tests
- Test metrics collection
- Test metric export format
- Test default metrics collection
- Test metric reset (for testing)

## Performance Considerations

- DuckDB is in-process, so no network overhead
- Event log writes are async and non-blocking
- Prometheus metrics are in-memory (very fast)
- Circuit breaker checks are cached to avoid excessive queries

## Security Considerations

- Event log contains API call details (sanitize sensitive data)
- Prometheus metrics endpoint should be protected in production
- Circuit breaker prevents runaway credit spending

## Next Steps

1. **Complete PostgreSQL Migration**:
   - Create DuckDB repositories
   - Migrate data
   - Update StorageEngine
   - Remove PostgreSQL dependencies

2. **Grafana Setup** (Optional):
   - Create dashboard JSON files
   - Document dashboard setup
   - Add to docker-compose.yml

3. **Documentation**:
   - Update README with new monitoring setup
   - Add examples for event log queries
   - Document Prometheus alerting rules

