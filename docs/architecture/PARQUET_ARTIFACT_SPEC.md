# Parquet Artifact Specification (Canonical)

**Status**: Enforced  
**Version**: 1.0  
**Last Updated**: 2026-01-22

## Overview

This document defines the **canonical artifact specification** for Parquet files exported from ClickHouse for use in QuantBot backtesting and simulation workflows.

**Core Principle**: Parquet is the "frozen lake" your data lives on. DuckDB/ClickHouse are the "skates" that query it.

## The Pattern

```
ClickHouse (raw/warehouse) 
  → Export Parquet (artifact lake) 
  → DuckDB queries + joins over Parquet 
  → Write derived Parquet outputs
```

### Why This Pattern?

1. **Reproducibility**: Parquet slices = frozen datasets that can be replayed deterministically
2. **Portability**: Parquet works across tools (DuckDB, Polars, Spark, BigQuery external tables)
3. **Cost Efficiency**: Export once, query many times locally without hitting ClickHouse
4. **Composability**: Join slices with external data (CSV, JSON, other Parquet files)

## Partition Structure (Required)

### Canonical Template

```
{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}/part-*.parquet
```

### Example Paths

```
slices/
  candles_1m/
    chain=sol/
      dt=2024-12-01/
        run_id=abc123/
          part-000.parquet
          part-001.parquet
          slice.manifest.json
      dt=2024-12-02/
        run_id=abc123/
          part-000.parquet
          slice.manifest.json
    chain=eth/
      dt=2024-12-01/
        run_id=def456/
          part-000.parquet
          slice.manifest.json
```

### Partition Keys (Required)

All exports **must** partition by:

1. **`dataset`** - What you're extracting (e.g., `candles_1m`, `candles_5m`, `indicators_1m`)
2. **`chain`** - Blockchain (e.g., `sol`, `eth`, `base`, `bsc`)
3. **`dt`** - Date partition in format `YYYY-MM-DD` (e.g., `2024-12-01`)

**Optional but recommended**:
4. **`runId`** - Run identifier for experiment tracking

### Why These Partition Keys?

- **`dataset`**: Different datasets have different schemas/use cases
- **`chain`**: Different chains = different token addresses, different data sources
- **`dt`**: Time-based filtering is the most common query pattern
- **`runId`**: Enables experiment tracking and reproducibility

### What NOT to Partition By

❌ **Don't partition by**:
- Token mint address directly (millions of files = metadata hell)
- Hour/minute/second (too granular, file explosion)
- Strategy ID (unless you have very few strategies)

✅ **Instead**:
- Use token filters in queries (DuckDB can filter efficiently)
- Use date partitions (daily is usually fine)
- Use runId for experiment scoping

## File Sizing Rules

### Target Size Range

- **Minimum**: 128 MB per file
- **Maximum**: 1 GB per file
- **Sweet spot**: 256-512 MB per file

### Why Size Matters

- **Too small** (< 128 MB): Death by a thousand file opens, poor compression, metadata overhead
- **Too large** (> 1 GB): Less parallelism, rougher incremental updates, memory pressure

### How to Control Size

Set `maxRowsPerFile` in `ParquetLayoutSpec`:

```typescript
{
  maxRowsPerFile: 1_000_000, // ~100MB assuming 100 bytes/row
}
```

**Rough estimates**:
- Candle rows: ~100-200 bytes/row
- Trade rows: ~150-300 bytes/row
- Indicator rows: ~200-400 bytes/row

Adjust based on your schema.

## Compression

### Recommended: `snappy` (default)

- Fast compression/decompression
- Good balance of size vs speed
- Widely supported

### Alternatives

- **`zstd`**: Better compression ratio, slightly slower
- **`gzip`**: Widely supported but slower
- **`none`**: Only for debugging (files will be huge)

```typescript
{
  compression: 'snappy', // or 'zstd', 'gzip', 'none'
}
```

## Layout Specification

### TypeScript Interface

```typescript
interface ParquetLayoutSpec {
  baseUri: string; // e.g., "file:///data/slices" or "s3://quantbot-artifacts"
  subdirTemplate: string; // e.g., "{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}"
  compression?: 'snappy' | 'zstd' | 'gzip' | 'none';
  maxRowsPerFile?: number; // Target rows per file
  partitionKeys?: Array<'dt' | 'chain' | 'dataset' | 'runId' | 'strategyId'>;
}
```

### Canonical Example

```typescript
const canonicalLayout: ParquetLayoutSpec = {
  baseUri: 'file://./slices',
  subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
  compression: 'snappy',
  maxRowsPerFile: 1_000_000,
  partitionKeys: ['dataset', 'chain', 'dt', 'runId'],
};
```

### Template Variables

Available variables for `subdirTemplate`:

- `{dataset}` - Dataset name (e.g., `candles_1m`)
- `{chain}` - Chain identifier (e.g., `sol`, `eth`)
- `{runId}` - Run identifier
- `{strategyId}` - Strategy identifier (if provided)
- `{yyyy}` - Year (4 digits, e.g., `2024`)
- `{mm}` - Month (2 digits, e.g., `01`)
- `{dd}` - Day (2 digits, e.g., `15`)

**Date variables are derived from `spec.timeRange.startIso`**.

## Manifest Files

Every partition directory **must** contain a `slice.manifest.json` file:

```typescript
interface SliceManifestV1 {
  version: 1;
  manifestId: string;
  createdAtIso: string;
  run: RunContext;
  spec: SliceSpec;
  layout: ParquetLayoutSpec;
  parquetFiles: Array<{
    path: string; // file:// URI
    rowCount?: number;
    byteSize?: number;
    dt?: string; // YYYY-MM-DD
  }>;
  summary: {
    totalFiles: number;
    totalRows?: number;
    totalBytes?: number;
    timeRangeObserved?: { startIso: string; endIso: string };
  };
  integrity?: {
    specHash?: string;
    contentHash?: string;
    schemaHash?: string;
  };
}
```

**Purpose**:
- Reproducibility: Know exactly what was exported
- Integrity: Verify files haven't been corrupted
- Discovery: Find slices without scanning filesystem

## Validation Rules

### Enforced at Export Time

The exporter **validates**:

1. ✅ `subdirTemplate` contains required partition keys: `{dataset}`, `{chain}`, `{dt}` (or `{yyyy}-{mm}-{dd}`)
2. ✅ `partitionKeys` array matches template placeholders
3. ✅ `compression` is valid (`snappy`, `zstd`, `gzip`, `none`)
4. ✅ `baseUri` format is valid (`file://` or `s3://`)
5. ⚠️ `maxRowsPerFile` produces files in recommended size range (warning only)

### Validation Errors vs Warnings

- **Errors**: Export fails (e.g., missing required partition key)
- **Warnings**: Export succeeds but logs recommendation (e.g., file size too small)

## Query Patterns

### DuckDB Query Examples

```sql
-- Read single partition
SELECT * FROM read_parquet('slices/candles_1m/chain=sol/dt=2024-12-01/run_id=abc123/part-*.parquet');

-- Read multiple partitions (glob pattern)
SELECT * FROM read_parquet('slices/candles_1m/chain=sol/dt=2024-12-*/run_id=abc123/part-*.parquet');

-- Join across partitions
SELECT 
  c.*,
  i.value_json as indicator_value
FROM read_parquet('slices/candles_1m/chain=sol/dt=2024-12-01/run_id=abc123/part-*.parquet') c
JOIN read_parquet('slices/indicators_1m/chain=sol/dt=2024-12-01/run_id=abc123/part-*.parquet') i
  ON c.token_address = i.token_address 
  AND c.timestamp = i.timestamp;
```

### Partition Pruning

DuckDB automatically prunes partitions based on path filters:

```sql
-- Only reads dt=2024-12-01 partition
SELECT * FROM read_parquet('slices/candles_1m/chain=sol/dt=2024-12-01/run_id=abc123/part-*.parquet')
WHERE timestamp >= '2024-12-01T00:00:00Z' 
  AND timestamp < '2024-12-02T00:00:00Z';
```

## Migration from Flat Structure

If you have existing flat Parquet files (e.g., `slices/per_token_v2/*.parquet`), use the migration script:

```bash
tsx scripts/data-processing/migrate-parquet-to-partitioned.ts \
  --source-dir ./slices/per_token_v2 \
  --target-base ./slices/partitioned \
  --dataset candles_1m \
  --chain sol \
  [--dry-run]
```

The script:
1. Infers metadata from filenames or Parquet metadata
2. Reorganizes into canonical partitioned structure
3. Creates manifests for migrated files
4. Validates integrity after migration

## Best Practices

### DO ✅

- Use canonical partition structure for all exports
- Keep files in 128MB-1GB range
- Include manifests in every partition directory
- Use `snappy` compression (or `zstd` for better ratio)
- Partition by date, chain, dataset (required)
- Use runId for experiment tracking (recommended)

### DON'T ❌

- Don't partition by token mint directly (use filters instead)
- Don't create millions of tiny files (< 128MB)
- Don't skip manifests (they enable reproducibility)
- Don't use mutable storage patterns (Parquet is append-only)
- Don't mix schemas in same partition (use different datasets)

## Schema Evolution

### Adding Columns

✅ **Safe**: Adding new columns is backward compatible
- Existing queries still work
- New columns are `null` for old files

### Changing Column Types

❌ **Breaking**: Changing column types requires new dataset version
- Create new dataset (e.g., `candles_1m_v2`)
- Migrate queries to new dataset
- Deprecate old dataset after migration

### Changing Partition Structure

❌ **Breaking**: Changing partition structure breaks existing queries
- Create new export with new structure
- Update all queries to new paths
- Migrate old files if needed

## Examples

### Example 1: Export 1m Candles

```typescript
import { exportAndAnalyzeSlice } from '@quantbot/workflows/slices';
import { getCanonicalLayoutSpec } from '@quantbot/core/slices/validate-layout';

const layout = getCanonicalLayoutSpec('file://./slices');

await exportAndAnalyzeSlice({
  run: {
    runId: 'run_2024_12_01',
    createdAtIso: new Date().toISOString(),
  },
  spec: {
    dataset: 'candles_1m',
    chain: 'sol',
    timeRange: {
      startIso: '2024-12-01T00:00:00.000Z',
      endIso: '2024-12-02T00:00:00.000Z',
    },
  },
  layout,
  // ... exporter, analyzer, etc.
});
```

### Example 2: Custom Layout (Still Valid)

```typescript
const customLayout: ParquetLayoutSpec = {
  baseUri: 'file://./slices',
  subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
  compression: 'zstd', // Better compression
  maxRowsPerFile: 2_000_000, // Larger files
  partitionKeys: ['dataset', 'chain', 'dt', 'runId'],
};
```

This is valid because it includes all required partition keys.

## Enforcement

### Validation

- ✅ Exporter validates layout at export time
- ✅ `validateParquetLayout()` function enforces rules
- ✅ Errors prevent export, warnings log recommendations

### Migration

- ✅ Migration script reorganizes flat files
- ✅ Validates integrity after migration
- ✅ Creates manifests for migrated files

### Documentation

- ✅ This spec documents canonical structure
- ✅ Examples show correct usage
- ✅ Best practices guide implementation

## References

- [Parquet Format Specification](https://parquet.apache.org/docs/)
- [DuckDB Parquet Documentation](https://duckdb.org/docs/data/parquet)
- [QuantBot Storage Strategy](./STORAGE_STRATEGY.md)
- [QuantBot Architecture Rules](../.cursor/rules/10-architecture-ports-adapters.mdc)

