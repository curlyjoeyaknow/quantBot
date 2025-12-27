# Research Services - Using Data Slices

## Overview

The `DataSnapshotService` uses **data slices** (parquet files) instead of querying databases directly. This provides:

- **Reproducibility**: Slices are immutable snapshots of data
- **Performance**: Parquet files are optimized for analytical queries
- **Isolation**: No direct database dependencies during research
- **Versioning**: Slice manifests track data lineage

## Automatic Fallback Strategy

The `DataSnapshotService` uses a smart fallback strategy:

1. **If slices are available** (sliceManifestIds provided): Uses slices (fastest, most reproducible)
2. **If no slices**: Automatically queries database and creates slices for future use
3. **If database unavailable**: Provides helpful error messages with alternatives

You don't need to create slices manually - the service will do it automatically when needed!

## Manual Workflow (Optional)

If you want to create slices manually first:

```typescript
import { exportSlicesForAlerts } from '@quantbot/workflows/slices/exportSlicesForAlerts';
import { createProductionContext } from '@quantbot/workflows/context/createProductionContext';

const ctx = createProductionContext();

const result = await exportSlicesForAlerts(
  {
    fromISO: '2024-01-01T00:00:00Z',
    toISO: '2024-01-07T00:00:00Z',
    callerName: 'example_caller',
    catalogBasePath: './catalog',
    preWindowMinutes: 260,
    postWindowMinutes: 1440,
    dataset: 'candles_1m',
    chain: 'sol',
  },
  ctx
);

// result.exports contains manifest IDs for each slice
const manifestIds = result.exports
  .filter((e) => e.success && e.manifestId)
  .map((e) => e.manifestId!);
```

### Step 2: Create Snapshot (Automatic)

The service will automatically use slices if available, or query the database and create slices:

```typescript
import { createDataSnapshotService } from '@quantbot/workflows/research/services';

const dataService = createDataSnapshotService(ctx, './catalog');

// Slices are optional - service will auto-create them if needed
const snapshot = await dataService.createSnapshot({
  timeRange: {
    fromISO: '2024-01-01T00:00:00Z',
    toISO: '2024-01-07T00:00:00Z',
  },
  sources: [
    { venue: 'pump.fun', chain: 'solana' },
  ],
  filters: {
    callerNames: ['example_caller'],
  },
  // sliceManifestIds is optional - service will use DB if not provided
  catalogBasePath: './catalog',
});
```

### Step 3: Load Snapshot Data

Load data from the snapshot (reads from parquet files):

```typescript
const data = await dataService.loadSnapshot(snapshot);

console.log(`Loaded ${data.calls.length} calls and ${data.candles.length} candles`);
```

## Benefits

### 1. No Database Queries During Research

Slices are pre-computed, so research workflows don't need database connections:

```typescript
// ✅ Good: Uses slices (parquet files)
const snapshot = await dataService.createSnapshot({
  sliceManifestIds: ['manifest-123', 'manifest-456'],
  // ... other params
});

// ❌ Bad: Would query database directly (old approach)
// const snapshot = await dataService.createSnapshot({
//   // No sliceManifestIds - would query DuckDB/ClickHouse
// });
```

### 2. Reproducible Research

Slices are immutable - the same slice manifest ID always returns the same data:

```typescript
// Same slice = same data, every time
const data1 = await dataService.loadSnapshot(snapshot);
const data2 = await dataService.loadSnapshot(snapshot);
// data1 and data2 are identical
```

### 3. Fast Iteration

Parquet files are optimized for analytical queries:

```typescript
// Fast: Reads from parquet (columnar format)
const data = await dataService.loadSnapshot(snapshot);

// vs. Slow: Queries database every time
// const data = await queryDatabase(...);
```

## CLI Usage

### Create Slices First

```bash
# Export slices for alerts
quantbot slices export-for-alerts \
  --from "2024-01-01T00:00:00Z" \
  --to "2024-01-07T00:00:00Z" \
  --caller-name "example_caller" \
  --catalog-base-path "./catalog"
```

### Create Snapshot from Slices

```bash
# Create snapshot referencing slice manifests
quantbot research create-snapshot \
  --from "2024-01-01T00:00:00Z" \
  --to "2024-01-07T00:00:00Z" \
  --venue "pump.fun" \
  --slice-manifest-ids "manifest-123,manifest-456" \
  --catalog-base-path "./catalog"
```

## Architecture

```
┌─────────────────┐
│  Database       │
│  (DuckDB/CH)    │
└────────┬────────┘
         │
         │ exportSlicesForAlerts
         ▼
┌─────────────────┐
│  Slice Manifests│
│  (JSON)         │
└────────┬────────┘
         │
         │ References
         ▼
┌─────────────────┐
│  Parquet Files  │
│  (Data)         │
└────────┬────────┘
         │
         │ DataSnapshotService
         ▼
┌─────────────────┐
│  Snapshot       │
│  (Reference)    │
└─────────────────┘
```

## Best Practices

1. **Create slices once, reuse many times**: Export slices for a time period, then create multiple snapshots from them
2. **Use catalog for organization**: Store slices in a catalog for easy discovery
3. **Version your slices**: Include run IDs and timestamps in slice metadata
4. **Filter at slice creation**: Apply filters when creating slices, not when loading snapshots

## Migration from Direct DB Queries

If you're migrating from the old approach (direct DB queries):

### Old Approach (Deprecated)
```typescript
// ❌ Queries database directly
const snapshot = await dataService.createSnapshot({
  timeRange: { fromISO: '...', toISO: '...' },
  // No sliceManifestIds - queries DB
});
```

### New Approach (Recommended)
```typescript
// ✅ Uses slices (parquet files)
// Step 1: Create slices
const sliceResult = await exportSlicesForAlerts({ ... }, ctx);

// Step 2: Create snapshot from slices
const snapshot = await dataService.createSnapshot({
  timeRange: { fromISO: '...', toISO: '...' },
  sliceManifestIds: sliceResult.exports.map(e => e.manifestId!),
});
```

## Troubleshooting

### "No slice manifests provided"

**Error**: `No slice manifests provided. Create slices first using exportSlicesForAlerts workflow.`

**Solution**: Create slices first, then reference them in the snapshot:

```typescript
// Create slices first
const sliceResult = await exportSlicesForAlerts({ ... }, ctx);

// Then create snapshot with slice IDs
const snapshot = await dataService.createSnapshot({
  sliceManifestIds: sliceResult.exports.map(e => e.manifestId!),
  // ... other params
});
```

### "Slice manifest not found"

**Error**: `Slice manifest not found`

**Solution**: Check that:
1. Slice manifests exist in the catalog
2. Catalog base path is correct
3. Manifest IDs are valid

```typescript
// Verify catalog path
const catalog = new Catalog(adapter, './catalog');
const manifest = await catalog.getSlice(manifestId);
if (!manifest) {
  console.error('Manifest not found:', manifestId);
}
```

## See Also

- [Research Services Usage Guide](./research-services-usage.md)
- [Slice Export Workflow](../workflows/slices/exportSlicesForAlerts.ts)
- [Catalog API](../../packages/labcatalog/README.md)

