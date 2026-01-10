# create-snapshot Handler

## Overview

Creates a data snapshot for research simulations.

## Location

`packages/cli/src/handlers/research/create-snapshot.ts`

## Handler Function

`createSnapshotHandler`

## Command

```bash
quantbot research create-snapshot --from <date> --to <date> [options]
```

## Examples

```bash
# Create snapshot for date range
quantbot research create-snapshot --from 2025-05-01 --to 2026-01-07

# Filter by caller names
quantbot research create-snapshot --from 2025-05-01 --to 2026-01-07 --caller-names '["Brook","Alpha"]'

# Filter by mint addresses
quantbot research create-snapshot --from 2025-05-01 --to 2026-01-07 --mint-addresses '["So1111...","So2222..."]'

# Minimum volume filter
quantbot research create-snapshot --from 2025-05-01 --to 2026-01-07 --min-volume 10000
```

## Parameters

- `--from <date>`: Start date (ISO 8601) (required)
- `--to <date>`: End date (ISO 8601) (required)
- `--sources <sources>`: Data sources (JSON array)
- `--caller-names <names>`: Filter by caller names
- `--mint-addresses <addresses>`: Filter by mint addresses
- `--min-volume <volume>`: Minimum volume filter
- `--format <format>`: Output format

## Workflow

1. **Create workflow context**: Uses `createProductionContext()`
2. **Create data service**: `DataSnapshotService` from workflow context
3. **Create snapshot**: Calls `dataService.createSnapshot()` with filters
4. **Return snapshot**: Snapshot metadata

## Returns

```typescript
{
  snapshotId: string;
  contentHash: string;
  timeRange: { fromISO: string; toISO: string };
  sources: DataSource[];
  filters: SnapshotFilters;
  schemaVersion: string;
  createdAtISO: string;
}
```

## Related

- [[run-simulation]] - Run simulation with snapshot
- [[batch-simulation]] - Batch simulations

