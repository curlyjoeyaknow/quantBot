# @quantbot/jobs

**Online orchestration jobs for OHLCV fetching and data ingestion.**

This package is the **only** place allowed to make network calls for OHLCV data. It orchestrates API calls, rate limiting, and storage operations.

## Architecture

- **Online boundary**: The only package allowed to call `@quantbot/api-clients`
- **Orchestration**: Coordinates between API clients, storage, and ingestion services
- **Rate limiting**: Enforces API rate limits and circuit breakers
- **Metrics**: Emits usage metrics and monitoring data

## Services

### OhlcvFetchJob
Fetches OHLCV candles from Birdeye API and stores them to ClickHouse.

```typescript
import { OhlcvFetchJob } from '@quantbot/jobs';
import { generateOhlcvWorklist } from '@quantbot/ingestion';

// Generate worklist (offline)
const worklist = await generateOhlcvWorklist({
  duckdbPath: '/path/to/duckdb',
  from: '2024-01-01',
  to: '2024-01-02',
});

// Execute fetch job (online)
const fetchJob = new OhlcvFetchJob({
  rateLimitMs: 100,
  maxRetries: 3,
});

const results = await fetchJob.fetchWorkList(worklist);
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

