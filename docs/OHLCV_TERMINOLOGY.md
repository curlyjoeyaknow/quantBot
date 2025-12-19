# OHLCV Terminology

## Clear Separation: Fetch vs Ingestion

### "Fetch" = Birdeye API Call Only

**Definition**: Fetching OHLCV candles from Birdeye API. Returns raw candles, does NOT store them.

**Implementation**: `OhlcvBirdeyeFetch` in `@quantbot/jobs`

**Responsibilities**:
- Call `@quantbot/api-clients` to fetch from Birdeye API
- Enforce rate limits and circuit breakers
- Return raw candles (no storage)

**Location**: `packages/jobs/src/ohlcv-birdeye-fetch.ts`

### "Ingestion" = Storage + Metadata

**Definition**: Storing OHLCV candles in ClickHouse and updating DuckDB metadata.

**Implementation**: `ingestOhlcv` workflow in `@quantbot/workflows`

**Responsibilities**:
- Store candles in ClickHouse (via `storeCandles` from `@quantbot/ohlcv`)
- Update DuckDB metadata (via `duckdbStorage.updateOhlcvMetadata`)
- Orchestrate the full ingestion process

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

## Complete Flow

```
1. Generate worklist (offline - DuckDB query)
   ↓
2. Fetch from Birdeye (online - API call)
   ↓
3. Store in ClickHouse (ingestion)
   ↓
4. Update DuckDB metadata (ingestion)
```

## Code Examples

### Fetch Only (Birdeye API)

```typescript
import { OhlcvBirdeyeFetch } from '@quantbot/jobs';

const fetchService = new OhlcvBirdeyeFetch();
const result = await fetchService.fetchWorkItem(workItem);

// result.candles contains raw candles from Birdeye
// No storage happens here
```

### Full Ingestion (Workflow)

```typescript
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';

const workflowContext = createOhlcvIngestionContext();
const result = await ingestOhlcv({
  duckdbPath: '/path/to/duckdb',
  from: '2024-01-01',
  to: '2024-01-02',
  // ... other options
}, workflowContext);

// Workflow handles:
// 1. Generate worklist
// 2. Fetch from Birdeye
// 3. Store in ClickHouse
// 4. Update DuckDB metadata
```

## Deprecated

### `OhlcvFetchJob` (Old)

**Status**: Deprecated, kept for backward compatibility

**Old behavior**: Did both fetch AND store

**Replacement**: 
- Use `OhlcvBirdeyeFetch` for fetch only
- Use `ingestOhlcv` workflow for full ingestion

## Migration Guide

### Before (Old Terminology)

```typescript
// Old: OhlcvFetchJob did both fetch and store
const fetchJob = new OhlcvFetchJob();
const results = await fetchJob.fetchWorkList(worklist);
// Results included candlesFetched and candlesStored
```

### After (New Terminology)

```typescript
// New: Separate fetch and ingestion
const fetchService = new OhlcvBirdeyeFetch();
const fetchResults = await fetchService.fetchWorkList(worklist);
// fetchResults contain raw candles

// Then store via workflow (or directly)
await ingestOhlcv(spec, context);
// Workflow handles storage + metadata
```

## Benefits

1. **Clear separation**: Fetch = API call, Ingestion = storage
2. **Testability**: Can test fetch without storage, storage without fetch
3. **Flexibility**: Can fetch candles and use them differently (e.g., analysis without storage)
4. **Consistency**: Terminology matches actual behavior

