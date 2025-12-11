# Storage Engine Architecture

## Overview

The Storage Engine provides a unified, robust interface for storing and retrieving all QuantBot data:
- **OHLCV Candles** (ClickHouse)
- **Token Calls** (Postgres)
- **Strategies** (Postgres)
- **Indicators** (ClickHouse for computed values)
- **Simulation Results** (Postgres + ClickHouse)

## Architecture

### Multi-Database Strategy

The engine uses a hybrid storage approach:

1. **Postgres (OLTP)** - Relational data with strong consistency:
   - Token calls
   - Strategies
   - Simulation run metadata
   - Simulation results summaries

2. **ClickHouse (OLAP)** - Time-series data with high performance:
   - OHLCV candles
   - Computed indicator values
   - Simulation events (detailed traces)
   - Simulation aggregates

### Key Features

1. **Unified API**: Single interface for all storage operations
2. **Intelligent Caching**: In-memory cache with configurable TTL
3. **Automatic Indicator Storage**: Computed indicators are automatically stored for reuse
4. **Data Consistency**: Preserves full mint addresses and exact case
5. **Query Optimization**: Efficient queries with proper indexing
6. **Extensibility**: Easy to add new data types and repositories

## Usage

### Basic Usage

```typescript
import { getStorageEngine } from '@quantbot/storage';

const engine = getStorageEngine();

// Store candles
await engine.storeCandles(
  '7pXs...pump', // Full mint address
  'solana',
  candles,
  '5m'
);

// Retrieve candles
const candles = await engine.getCandles(
  '7pXs...pump',
  'solana',
  startTime,
  endTime,
  { interval: '5m', useCache: true }
);

// Store a call
const callId = await engine.storeCall({
  tokenId: 1,
  callerId: 2,
  side: 'buy',
  signalType: 'entry',
  signalTimestamp: DateTime.now(),
});

// Store a strategy
const strategyId = await engine.storeStrategy({
  name: 'ichimoku_entry',
  version: '1',
  config: { /* strategy config */ },
  isActive: true,
});

// Store computed indicators
await engine.storeIndicators(
  '7pXs...pump',
  'solana',
  timestamp,
  [
    {
      indicatorType: 'ichimoku',
      value: { tenkan: 0.001, kijun: 0.0012, /* ... */ },
      timestamp,
    },
  ]
);

// Store simulation results
await engine.storeSimulationResults(simulationRunId, result);
await engine.storeSimulationEvents(
  simulationRunId,
  '7pXs...pump',
  'solana',
  events
);
```

### Configuration

```typescript
const engine = getStorageEngine({
  enableCache: true,
  cacheTTL: 60000, // 1 minute
  maxCacheSize: 1000,
  autoComputeIndicators: true,
});
```

## Data Models

### OHLCV Candles

Stored in ClickHouse `ohlcv_candles` table:
- `token_address` (String) - Full mint address, case-preserved
- `chain` (String)
- `timestamp` (DateTime)
- `interval` (String) - '1m', '5m', '15m', '1h', etc.
- `open`, `high`, `low`, `close`, `volume` (Float64)

### Token Calls

Stored in Postgres `calls` table:
- Links to `tokens`, `callers`, `strategies`, `alerts`
- Includes signal type, strength, timestamp
- Metadata stored as JSONB

### Strategies

Stored in Postgres `strategies` table:
- Name, version, category, description
- Full config stored as JSONB
- Active/inactive flag

### Indicators

Stored in ClickHouse `indicator_values` table:
- `token_address` (String) - Full mint address, case-preserved
- `chain` (String)
- `timestamp` (DateTime)
- `indicator_type` (String) - 'ichimoku', 'ema', 'rsi', etc.
- `value_json` (String) - JSON-encoded indicator values
- `metadata_json` (String) - Additional metadata

### Simulation Results

**Postgres** (`simulation_results_summary`):
- Aggregated metrics (PnL, drawdown, Sharpe ratio, etc.)
- Links to `simulation_runs`

**ClickHouse** (`simulation_events`):
- Detailed event traces
- One row per event (entry, exit, stop loss, etc.)
- Includes indicator snapshots and position state

## Caching Strategy

The engine implements a multi-layer caching strategy:

1. **In-Memory Cache** (LRU with TTL):
   - Caches frequently accessed data
   - Configurable TTL (default: 1 minute)
   - Automatic cleanup of expired entries
   - Max size enforcement

2. **ClickHouse Cache**:
   - ClickHouse acts as a cache layer for candles
   - Reduces API calls to external data providers

3. **Cache Invalidation**:
   - Automatic invalidation on writes
   - Pattern-based invalidation (e.g., all calls for a token)

## Critical Requirements

### Mint Address Handling

⚠️ **CRITICAL**: The engine strictly preserves full mint addresses and exact case:

- ✅ Always store complete 32-44 character addresses
- ✅ Never truncate or modify addresses
- ✅ Use full address in all API calls
- ✅ Only truncate for display/logging purposes

### Data Consistency

- Postgres provides ACID guarantees for relational data
- ClickHouse provides eventual consistency for time-series data
- The engine ensures referential integrity between databases

## Performance Considerations

1. **Batch Operations**: Use batch inserts for large datasets
2. **Query Optimization**: Proper indexing on all query patterns
3. **Partitioning**: ClickHouse tables partitioned by month for efficient time-range queries
4. **Connection Pooling**: Postgres pool with configurable max connections
5. **Async Operations**: All operations are async and non-blocking

## Extensibility

To add a new data type:

1. Create a repository class (e.g., `NewDataRepository`)
2. Add methods to `StorageEngine`:
   - `storeNewData()`
   - `getNewData()`
3. Update the cache invalidation logic
4. Add to the initialization sequence

## Error Handling

- All operations throw errors that can be caught and handled
- Errors are logged with context (token address truncated for display)
- Graceful degradation when databases are unavailable (if configured)

## Testing

The engine should be tested with:
- Unit tests for each repository
- Integration tests for cross-database operations
- Performance tests for large datasets
- Cache behavior tests

## Migration

When adding new tables or columns:

1. Update ClickHouse schema in `clickhouse-client.ts` (`ensure*Table` functions)
2. Update Postgres schema in migration scripts
3. Update repository classes to handle new fields
4. Update StorageEngine to expose new functionality

## Future Enhancements

- [ ] Automatic indicator computation pipeline
- [ ] Real-time streaming updates via WebSocket
- [ ] Data archival and cleanup policies
- [ ] Query result pagination
- [ ] Advanced caching strategies (Redis, etc.)
- [ ] Data replication and backup strategies

