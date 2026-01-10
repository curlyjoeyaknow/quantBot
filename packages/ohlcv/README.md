# @quantbot/ohlcv

**Offline-only OHLCV candle services for simulation and analytics.**

This package provides offline candle querying, storage, and transformation services. It does **NOT** fetch candles from APIs - that responsibility belongs to `@quantbot/jobs`.

## Architecture

- **Offline-only**: No network calls, no API clients, no environment variables
- **Read-first**: Query candles from ClickHouse/cache
- **Write-only storage**: Store candles that have already been fetched
- **Deterministic**: Safe for simulation and analytics that require reproducible results

## Services

### OHLCVQueryService
Query candles from ClickHouse with gap detection and coverage checks.

```typescript
import { OHLCVQueryService } from '@quantbot/ohlcv';

const queryService = new OHLCVQueryService();
const candles = await queryService.getCandles(
  mint,
  chain,
  startTime,
  endTime,
  { interval: '5m' }
);

// Check coverage before fetching
const hasCoverage = await getCoverage(mint, chain, startTime, endTime, '5m');
```

### OHLCVEngine
Unified engine for querying and storing candles (offline operations only).

```typescript
import { getOHLCVEngine } from '@quantbot/ohlcv';

const engine = getOHLCVEngine();
await engine.initialize(); // Initialize ClickHouse connection

// Query candles (offline)
const result = await engine.query(mint, startTime, endTime, chain, {
  interval: '5m'
});

// Store candles (offline - candles must already be fetched)
await engine.storeCandles(mint, chain, candles, '5m');
```

### Storage Functions
Direct storage functions for candles that have already been fetched.

```typescript
import { storeCandles } from '@quantbot/ohlcv';

// Store candles (offline operation)
await storeCandles(mint, chain, candles, '5m');
```

## Usage in Workflows

### Fetching Candles (Online)
Use `@quantbot/jobs` for fetching:

```typescript
import { OhlcvFetchJob } from '@quantbot/jobs';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { storeCandles } from '@quantbot/ohlcv';

// Fetch from API (jobs layer)
const candles = await fetchBirdeyeCandles(mint, '5m', from, to, chain);

// Store offline (ohlcv layer)
await storeCandles(mint, chain, candles, '5m');
```

### Querying Candles (Offline)
Use this package for querying:

```typescript
import { OHLCVQueryService } from '@quantbot/ohlcv';

const queryService = new OHLCVQueryService();
const candles = await queryService.getCandles(mint, chain, startTime, endTime);
```

## Boundaries

This package **must not**:
- Import `@quantbot/api-clients`
- Make HTTP requests
- Read environment variables (`process.env`)
- Fetch candles from APIs

This package **can**:
- Query ClickHouse
- Store candles to ClickHouse
- Transform and normalize candles
- Detect gaps in candle data
- Resample candles

## Dependencies

- `@quantbot/core` - Types and interfaces
- `@quantbot/utils` - Logger and utilities
- `@quantbot/storage` - ClickHouse access

## See Also

- `@quantbot/jobs` - Online orchestration for OHLCV fetching
- `@quantbot/ingestion` - Offline worklist generation for OHLCV ingestion
- `@quantbot/api-clients` - API clients for fetching candles

