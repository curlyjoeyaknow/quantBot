# @quantbot/storage

> Storage layer for QuantBot - DuckDB, ClickHouse, and InfluxDB adapters

## Overview

`@quantbot/storage` provides the storage layer for QuantBot:

- **DuckDB**: Primary OLAP database for analytics (file-based)
- **ClickHouse**: High-performance time-series database for OHLCV data
- **InfluxDB**: Optional time-series database (legacy support)
- **Port Adapters**: Storage port implementations

## Architecture

### Storage Engines

**DuckDB** (Primary):
- File-based OLAP database
- Used for analytics, simulation results, strategies
- Python-driven via `PythonEngine` (intentional architectural decision)
- No server setup required

**ClickHouse** (Time-Series):
- High-performance time-series database
- Used for OHLCV candle data
- Supports partitioning and replication
- Requires server setup (Docker or standalone)

**InfluxDB** (Legacy):
- Optional time-series database
- Being phased out in favor of ClickHouse

### Port Adapters

The package implements storage ports defined in `@quantbot/core`:

- `CandleSlicePort` - Export candle slices
- `FeatureComputePort` - Compute features from data
- `SimulationPort` - Execute simulations
- `LeaderboardPort` - Rank simulation runs
- `CatalogPort` - Data catalog operations

## Key Exports

### DuckDB Client

```typescript
import { DuckDBClient } from '@quantbot/storage';

const client = new DuckDBClient({ dbPath: './data/quantbot.duckdb' });
const result = await client.query('SELECT * FROM strategies');
```

### ClickHouse Client

```typescript
import { ClickHouseClient } from '@quantbot/storage';

const client = new ClickHouseClient({
  host: 'localhost',
  port: 18123,
  database: 'quantbot',
});

const result = await client.query({
  query: 'SELECT * FROM candles_1m WHERE chain = {chain:String}',
  query_params: { chain: 'solana' },
});
```

### Storage Ports

```typescript
import {
  CandleSliceExporter,
  FeatureComputer,
  SimulationExecutor,
} from '@quantbot/storage';
```

## Dependencies

- `@quantbot/core` - Foundation types
- `@quantbot/utils` - Utilities (logger, PythonEngine)
- `@clickhouse/client` - ClickHouse client
- `duckdb` - DuckDB Node.js bindings (for metadata, Python used for queries)

### Build Order

This package must be built **third** (position 3-5) in the build order:

```bash
# Build dependencies first
pnpm --filter @quantbot/core build
pnpm --filter @quantbot/utils build

# Then build storage
pnpm --filter @quantbot/storage build
```

## Usage Examples

### DuckDB Operations

```typescript
import { DuckDBClient } from '@quantbot/storage';

const client = new DuckDBClient({ dbPath: './data/quantbot.duckdb' });

// Query strategies
const strategies = await client.query('SELECT * FROM strategies');

// Store simulation run
await client.execute('INSERT INTO simulation_runs VALUES (?, ?, ?)', [
  runId,
  strategyId,
  JSON.stringify(result),
]);
```

### ClickHouse Operations

```typescript
import { ClickHouseClient } from '@quantbot/storage';

const client = new ClickHouseClient({
  host: 'localhost',
  port: 18123,
  database: 'quantbot',
});

// Query candles (parameterized query)
const candles = await client.query({
  query: `
    SELECT *
    FROM candles_1m
    WHERE chain = {chain:String}
      AND mint = {mint:String}
      AND timestamp >= {from:DateTime}
      AND timestamp <= {to:DateTime}
  `,
  query_params: {
    chain: 'solana',
    mint: 'So11111111111111111111111111111111111111112',
    from: '2024-01-01 00:00:00',
    to: '2024-12-31 23:59:59',
  },
});

// Insert candles (idempotent upsert)
await client.insert({
  table: 'candles_1m',
  values: candles,
  format: 'JSONEachRow',
});
```

### Storage Ports

```typescript
import { CandleSliceExporter } from '@quantbot/storage/adapters/clickhouse/CandleSliceExporter';

const exporter = new CandleSliceExporter(clickhouseClient);
const slice = await exporter.exportSlice({
  dataset: 'candles_1m',
  tokens: ['token1', 'token2'],
  from: '2024-01-01T00:00:00.000Z',
  to: '2024-12-31T23:59:59.999Z',
  outputPath: './slices/slice.parquet',
});
```

## Python Integration

DuckDB operations are executed via Python scripts through `PythonEngine`:

- **Rationale**: Better DuckDB bindings, heavy computation support, data science ecosystem
- **Location**: `tools/storage/duckdb_*.py`
- **Pattern**: Python scripts accept JSON input, return JSON output

See [ARCHITECTURE.md](../../docs/architecture/ARCHITECTURE.md) for details.

## Database Setup

### DuckDB

No setup required - files are created automatically:

```bash
# Default database location
data/quantbot.duckdb
data/result.duckdb
```

### ClickHouse

```bash
# Start ClickHouse
docker-compose up -d clickhouse

# Initialize schema
pnpm clickhouse:setup
```

## Related Documentation

- [ARCHITECTURE.md](../../docs/architecture/ARCHITECTURE.md) - System architecture
- [DUCKDB_SCHEMA.md](../../docs/architecture/DUCKDB_SCHEMA.md) - DuckDB schema documentation
- [MIGRATION_POSTGRES_TO_DUCKDB.md](../../docs/migration/MIGRATION_POSTGRES_TO_DUCKDB.md) - Migration guide

