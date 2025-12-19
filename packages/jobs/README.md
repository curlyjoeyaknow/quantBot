# @quantbot/jobs

**Online orchestration jobs for OHLCV fetching from Birdeye API.**

This package is the **only** place allowed to make network calls for OHLCV data.

## Terminology

- **"Fetch"** = API call to Birdeye (returns candles, no storage)
- **"Ingestion"** = Storing in ClickHouse + updating DuckDB metadata (handled by workflow)

## Architecture

- **Online boundary**: The only package allowed to call `@quantbot/api-clients`
- **Fetch only**: Returns raw candles, does NOT store them
- **Rate limiting**: Enforces API rate limits and circuit breakers
- **Metrics**: Emits usage metrics and monitoring data

## Services

### OhlcvBirdeyeFetch (Recommended)

Fetches OHLCV candles from Birdeye API only. Does NOT store candles.

**Terminology**: "Fetch" = API call to Birdeye (this service)

```typescript
import { OhlcvBirdeyeFetch } from '@quantbot/jobs';

const fetchService = new OhlcvBirdeyeFetch({
  rateLimitMs: 100,
  maxRetries: 3,
  checkCoverage: true,
});

const result = await fetchService.fetchWorkItem(workItem);
// result.candles contains raw candles from Birdeye
// No storage happens here - that's handled by the ingestion workflow
```

### OhlcvFetchJob (Deprecated)

**Status**: Deprecated, kept for backward compatibility.

**Old behavior**: Did both fetch AND store.

**Replacement**: 
- Use `OhlcvBirdeyeFetch` for fetch only
- Use `ingestOhlcv` workflow for full ingestion (storage + metadata)

```typescript
import { OhlcvBirdeyeFetch } from '@quantbot/jobs';
import { generateOhlcvWorklist } from '@quantbot/ingestion';

// Generate worklist (offline)
const worklist = await generateOhlcvWorklist({
  duckdbPath: '/path/to/duckdb',
  from: '2024-01-01',
  to: '2024-01-02',
});

// Fetch from Birdeye (online - API call only)
const fetchService = new OhlcvBirdeyeFetch({
  rateLimitMs: 100,
  maxRetries: 3,
});

const fetchResults = await fetchService.fetchWorkList(worklist);
// fetchResults contain raw candles - no storage happens here
```

### OhlcvIngestionEngine

Low-level engine for fetching and storing candles with intelligent chunking and caching.

```typescript
import { getOhlcvIngestionEngine } from '@quantbot/jobs';

const engine = getOhlcvIngestionEngine();
await engine.initialize();

const result = await engine.fetchCandles(
  mint,
  chain,
  alertTime,
  {
    interval: '1m',
    useCache: true,
  }
);
```

## Usage in Workflows

### Complete OHLCV Ingestion Flow

**Terminology**: "Ingestion" = Full process (fetch + store + metadata)

```typescript
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';

// The workflow handles the complete flow:
// 1. Generate worklist (offline - DuckDB queries)
// 2. Fetch from Birdeye (online - API call)
// 3. Store in ClickHouse (ingestion)
// 4. Update DuckDB metadata (ingestion)

const workflowContext = createOhlcvIngestionContext();
const result = await ingestOhlcv({
  duckdbPath: process.env.DUCKDB_PATH!,
  from: '2024-01-01',
  to: '2024-01-02',
  interval: '1m',
  preWindowMinutes: 260,
  postWindowMinutes: 1440,
}, workflowContext);

// Results include:
// - worklistGenerated
// - workItemsProcessed/Succeeded/Failed/Skipped
// - totalCandlesFetched (from Birdeye)
// - totalCandlesStored (in ClickHouse)
// - errors
```

## Boundaries

This package **can**:
- Import `@quantbot/api-clients`
- Make HTTP requests to Birdeye API
- Enforce rate limits
- Emit metrics

This package **does NOT**:
- Store candles (that's handled by the ingestion workflow)
- Update DuckDB metadata (that's handled by the ingestion workflow)

This package **must not** be imported by:
- `@quantbot/simulation` (simulation must be offline-only)
- `@quantbot/ohlcv` (ohlcv must be offline-only)

## Dependencies

- `@quantbot/core` - Types and interfaces
- `@quantbot/utils` - Logger and utilities
- `@quantbot/storage` - ClickHouse access
- `@quantbot/api-clients` - API clients for fetching
- `@quantbot/ohlcv` - Offline storage functions
- `@quantbot/observability` - Metrics and monitoring

## See Also

- `@quantbot/ingestion` - Offline worklist generation
- `@quantbot/ohlcv` - Offline candle querying and storage
- `@quantbot/api-clients` - API clients for external services

