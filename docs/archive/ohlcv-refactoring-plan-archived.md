# OHLCV Offline-Only Refactoring Plan

**Status**: 📋 PLANNING  
**Priority**: High  
**Created**: 2025-01-19

## Goal

Refactor packages to achieve clean separation:

- **`@quantbot/ohlcv`** = 100% offline candle domain services (query, cache, gaps, normalization, resampling)
- **`@quantbot/ingestion`** = orchestration workflows (telegram + ohlcv ingestion)
- **`@quantbot/api-clients`** = talks to Birdeye/APIs

## Current Violations

### `@quantbot/ohlcv` Package

**Files with API calls (must be removed/moved):**

1. **`ohlcv-ingestion-engine.ts`**
   - Uses `getBirdeyeClient()` from `@quantbot/api-clients`
   - Uses `fetchMultiChainMetadata()` from `@quantbot/api-clients`
   - Fetches candles from Birdeye API
   - Fetches token metadata from Birdeye
   - **Action**: Move to `@quantbot/ingestion` as workflow

2. **`candles.ts`**
   - Direct Birdeye API calls (`fetchBirdeyeCandles`, `fetchBirdeyeCandlesDirect`)
   - Uses `dotenv` for API keys
   - **Action**: Move Birdeye fetching to `@quantbot/api-clients`, remove from `ohlcv`

3. **`ohlcv-service.ts`**
   - Uses `birdeyeClient` from `@quantbot/api-clients`
   - Fetches candles from Birdeye
   - **Action**: Make offline-only (query ClickHouse/cache only)

4. **`ohlcv-ingestion.ts`**
   - Uses `birdeyeClient` from `@quantbot/api-clients`
   - **Action**: Move to `@quantbot/ingestion` or remove if redundant

**Files that should remain (offline services):**

- ✅ `ohlcv-query.ts` - Query ClickHouse (offline)
- ✅ `ohlcv-engine.ts` - Should be offline (query cache/ClickHouse)
- ✅ `historical-candles.ts` - Should be offline
- ✅ `backfill-service.ts` - Should be offline
- ✅ `cache-stub.ts` - Cache utilities (offline)

**Dependencies to remove:**

- ❌ `@quantbot/api-clients` - Remove dependency
- ❌ `dotenv` - Remove (env belongs in CLI/app layer)
- ❌ `axios` - Remove if only used for API calls

## Architecture After Refactoring

### `@quantbot/ohlcv` (Offline-Only)

**Responsibilities:**
- Query candles from ClickHouse
- In-memory caching
- Gap detection
- Normalization/resampling
- Candle transformations

**Public API:**
```typescript
// Query services
export { OHLCVQueryService } from './ohlcv-query';
export { OHLCVEngine } from './ohlcv-engine';

// Storage services (write-only, no fetching)
export { storeCandles } from './ohlcv-storage';

// Utilities
export { detectGaps, normalizeCandles, resampleCandles } from './ohlcv-utils';
```

**Dependencies:**
- `@quantbot/core` - Types
- `@quantbot/utils` - Logger, utilities
- `@quantbot/storage` - ClickHouse access, cache

**NO dependencies on:**
- `@quantbot/api-clients` ❌
- `dotenv` ❌
- `axios` ❌

### `@quantbot/ingestion` (Orchestration Workflows)

**Responsibilities:**
- Orchestrate OHLCV ingestion workflow
- Read from DuckDB (worklist)
- Fetch from Birdeye via `@quantbot/api-clients`
- Store via `@quantbot/ohlcv` storage services
- Telegram ingestion (offline)

**New Workflow:**
```typescript
// packages/ingestion/src/workflows/ingest-ohlcv-workflow.ts

export async function ingestOhlcvWorkflow(params: IngestOhlcvParams): Promise<IngestOhlcvResult> {
  // 1. Read worklist from DuckDB
  const worklist = await readWorklistFromDuckDB(params.duckdbPath);
  
  // 2. For each item, fetch from Birdeye via api-clients
  for (const item of worklist) {
    const candles = await birdeyeClient.fetchOHLCVData(...);
    
    // 3. Store via ohlcv storage service (offline)
    await storeCandles(candles, { useCache: true });
  }
}
```

**Dependencies:**
- `@quantbot/api-clients` - Fetch from Birdeye ✅
- `@quantbot/ohlcv` - Store/query candles ✅
- `@quantbot/storage` - DuckDB, ClickHouse ✅

### `@quantbot/api-clients` (API Layer)

**Responsibilities:**
- All Birdeye API calls
- Token metadata fetching
- Multi-chain metadata fetching
- Rate limiting, retries, error handling

**Public API:**
```typescript
export { getBirdeyeClient, BirdeyeClient } from './birdeye-client';
export { fetchMultiChainMetadata } from './multi-chain-metadata';
```

## Implementation Plan

### Phase 1: Extract Birdeye Fetching to `@quantbot/api-clients`

1. **Move Birdeye fetching from `ohlcv/candles.ts` to `api-clients`**
   - Create `packages/api-clients/src/birdeye-ohlcv.ts`
   - Move `fetchBirdeyeCandles`, `fetchBirdeyeCandlesDirect` functions
   - Remove `dotenv` usage (use injected API keys)

2. **Update `BirdeyeClient` to include OHLCV methods**
   - Add `fetchOHLCVData()` method (if not already exists)
   - Ensure proper error handling, rate limiting

### Phase 2: Create Offline Storage Service in `@quantbot/ohlcv`

1. **Create `ohlcv-storage.ts` (offline write service)**
   ```typescript
   export async function storeCandles(
     candles: Candle[],
     options: { useCache?: boolean; forceRefresh?: boolean }
   ): Promise<void> {
     // Store to ClickHouse via StorageEngine
     // Update cache
     // No API calls
   }
   ```

2. **Refactor `ohlcv-engine.ts` to be offline-only**
   - Remove Birdeye client usage
   - Only query ClickHouse/cache
   - Accept candles as input for storage

3. **Refactor `ohlcv-service.ts` to be offline-only**
   - Remove Birdeye client
   - Only query ClickHouse/cache
   - Remove `fetchCandles()` method (moves to ingestion)

### Phase 3: Move Ingestion Logic to `@quantbot/ingestion`

1. **Move `OhlcvIngestionEngine` to `ingestion`**
   - Move `packages/ohlcv/src/ohlcv-ingestion-engine.ts` → `packages/ingestion/src/workflows/ohlcv-ingestion-engine.ts`
   - Update to use `@quantbot/api-clients` for fetching
   - Update to use `@quantbot/ohlcv` storage services

2. **Update `OhlcvIngestionService`**
   - Use new ingestion engine from `ingestion` package
   - Remove dependency on `ohlcv` ingestion engine

3. **Create workflow function**
   - `ingestOhlcvWorkflow()` - Orchestrates DuckDB → Birdeye → ClickHouse

### Phase 4: Clean Up `@quantbot/ohlcv`

1. **Remove API dependencies**
   - Remove `@quantbot/api-clients` from `package.json`
   - Remove `dotenv` from `package.json`
   - Remove `axios` if only used for API calls

2. **Remove API-related files**
   - Delete `ohlcv-ingestion.ts` (if redundant)
   - Clean up `candles.ts` (remove Birdeye fetching)

3. **Update exports**
   - Remove ingestion engine exports
   - Keep only offline services

4. **Remove environment variable usage**
   - Remove `process.env` reads from `ohlcv` package
   - Pass configuration via constructor/parameters

### Phase 5: Update Tests and Documentation

1. **Update `ohlcv` tests**
   - Remove API client mocks
   - Test offline services only
   - Mock ClickHouse/cache

2. **Update `ingestion` tests**
   - Add tests for new ingestion workflow
   - Mock `@quantbot/api-clients`
   - Mock `@quantbot/ohlcv` storage

3. **Update documentation**
   - Update `packages/ohlcv/README.md`
   - Update `packages/ingestion/README.md`
   - Update architecture docs

## Files to Modify

### `@quantbot/ohlcv`

**Remove/Refactor:**
- `src/ohlcv-ingestion-engine.ts` → Move to `ingestion`
- `src/candles.ts` → Remove Birdeye fetching, keep utilities
- `src/ohlcv-service.ts` → Make offline-only
- `src/ohlcv-ingestion.ts` → Move to `ingestion` or remove
- `package.json` → Remove `@quantbot/api-clients`, `dotenv`, `axios`

**Keep (offline services):**
- `src/ohlcv-query.ts`
- `src/ohlcv-engine.ts` (refactor to offline)
- `src/historical-candles.ts`
- `src/backfill-service.ts`
- `src/cache-stub.ts`

**New:**
- `src/ohlcv-storage.ts` (offline write service)

### `@quantbot/ingestion`

**New:**
- `src/workflows/ohlcv-ingestion-engine.ts` (moved from `ohlcv`)
- `src/workflows/ingest-ohlcv-workflow.ts` (orchestration)

**Update:**
- `src/OhlcvIngestionService.ts` (use new workflow)
- `package.json` (ensure `@quantbot/api-clients` dependency)

### `@quantbot/api-clients`

**New/Update:**
- `src/birdeye-ohlcv.ts` (extract from `ohlcv/candles.ts`)
- `src/birdeye-client.ts` (ensure OHLCV methods exist)

## Migration Strategy

### Step 1: Create New APIs (Non-Breaking)

1. Create `ohlcv-storage.ts` in `ohlcv` (new offline service)
2. Create `birdeye-ohlcv.ts` in `api-clients` (extract fetching)
3. Create workflow in `ingestion` (new orchestration)

### Step 2: Update Consumers (Gradual Migration)

1. Update `OhlcvIngestionService` to use new workflow
2. Update CLI commands to use new workflow
3. Update tests

### Step 3: Remove Old APIs (Breaking)

1. Remove `OhlcvIngestionEngine` from `ohlcv`
2. Remove API dependencies from `ohlcv`
3. Clean up unused code

## Testing Strategy

### Unit Tests

- `ohlcv` services: Test offline operations only (mock ClickHouse)
- `ingestion` workflows: Test orchestration (mock api-clients, ohlcv)
- `api-clients`: Test Birdeye API calls (mock HTTP)

### Integration Tests

- End-to-end: DuckDB → Birdeye → ClickHouse → Query
- Verify offline services work correctly
- Verify ingestion workflow orchestrates correctly

## Success Criteria

- ✅ `@quantbot/ohlcv` has zero API calls
- ✅ `@quantbot/ohlcv` has no `@quantbot/api-clients` dependency
- ✅ `@quantbot/ohlcv` has no `dotenv` dependency
- ✅ All Birdeye fetching happens in `@quantbot/api-clients`
- ✅ All ingestion orchestration happens in `@quantbot/ingestion`
- ✅ Simulation can use `ohlcv` services offline
- ✅ All tests pass
- ✅ Build order is correct

## Risks and Mitigation

**Risk**: Breaking changes for consumers
- **Mitigation**: Gradual migration, keep old APIs temporarily

**Risk**: Test failures during refactoring
- **Mitigation**: Update tests incrementally, maintain test coverage

**Risk**: Performance regression
- **Mitigation**: Benchmark before/after, optimize as needed

## Timeline

- **Phase 1-2**: Extract and create offline services (2-3 hours)
- **Phase 3**: Move ingestion logic (2-3 hours)
- **Phase 4**: Clean up (1-2 hours)
- **Phase 5**: Tests and docs (2-3 hours)

**Total**: ~8-11 hours of focused work

