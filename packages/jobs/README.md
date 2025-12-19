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

```typescript
import { generateOhlcvWorklist } from '@quantbot/ingestion';
import { OhlcvFetchJob } from '@quantbot/jobs';

// 1. Generate worklist (offline - DuckDB queries)
const worklist = await generateOhlcvWorklist({
  duckdbPath: process.env.DUCKDB_PATH!,
  from: '2024-01-01',
  to: '2024-01-02',
});

// 2. Execute fetch job (online - API calls + storage)
const fetchJob = new OhlcvFetchJob({
  rateLimitMs: 100,
  maxRetries: 3,
});

const results = await fetchJob.fetchWorkList(worklist);

// Results include:
// - success/failure status
// - candles fetched and stored
// - errors and retry information
```

## Boundaries

This package **can**:
- Import `@quantbot/api-clients`
- Make HTTP requests
- Write to ClickHouse
- Enforce rate limits
- Emit metrics

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

