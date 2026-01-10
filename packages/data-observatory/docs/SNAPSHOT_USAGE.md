# Snapshot System Usage Guide

## Overview

The snapshot system provides reproducible data slices with content hashing. All data reads should go through snapshots for deterministic results.

## Creating Snapshots

```typescript
import { createSnapshotManager } from '@quantbot/data-observatory';
import { DateTime } from 'luxon';

const snapshotManager = createSnapshotManager('./data/snapshots.duckdb');

// Create a snapshot
const snapshot = await snapshotManager.createSnapshot({
  sources: ['calls', 'ohlcv'],
  from: DateTime.utc().minus({ days: 30 }).toISO()!,
  to: DateTime.utc().toISO()!,
  filters: {
    chain: 'solana',
    tokenAddresses: ['So11111111111111111111111111111111111111112'],
  },
  name: '30-day-solana-data',
});

console.log('Snapshot ID:', snapshot.snapshotId);
console.log('Content Hash:', snapshot.contentHash);
```

## Deterministic Reads

All data reads should use snapshots for reproducibility:

```typescript
import { createDeterministicReader, DuckDBSnapshotStorage } from '@quantbot/data-observatory';

const storage = new DuckDBSnapshotStorage('./data/snapshots.duckdb');
const reader = createDeterministicReader(storage, snapshot.snapshotId);

// Read all events
const events = await reader.readEvents();

// Read events for a specific token
const tokenEvents = await reader.readTokenEvents('So11111111111111111111111111111111111111112');

// Read events of a specific type
const callEvents = await reader.readEventType('call');

// Read events in a time range
const timeRangeEvents = await reader.readTimeRange(
  '2024-01-01T00:00:00Z',
  '2024-01-31T23:59:59Z'
);
```

## Snapshot References

Snapshots are immutable and identified by:

- **snapshotId**: Unique identifier (derived from spec hash)
- **contentHash**: SHA-256 hash of manifest (for integrity verification)
- **spec**: Original snapshot specification
- **manifest**: Actual snapshot contents (event counts, coverage, etc.)

## Best Practices

1. **Always use snapshots for data reads** - Never read directly from storage in workflows
2. **Store snapshot IDs** - Reference snapshots by ID for reproducibility
3. **Verify content hashes** - Check contentHash to ensure snapshot integrity
4. **Use deterministic readers** - Use `DeterministicDataReader` for all data access
5. **Create snapshots at workflow start** - Create a snapshot before running workflows

## Preventing WAL Files

The snapshot storage uses DuckDB, which can create WAL files if connections aren't properly closed. The Python scripts ensure connections are always closed, but follow these practices:

- All Python scripts use try/finally blocks
- Connections are closed immediately after operations
- Never commit WAL files to git (already in .gitignore)
- Use connection utilities from `@quantbot/storage` for tracking

## Example: Workflow with Snapshots

```typescript
import { createSnapshotManager, createDeterministicReader } from '@quantbot/data-observatory';

async function runWorkflow() {
  // 1. Create snapshot at start
  const snapshotManager = createSnapshotManager('./data/snapshots.duckdb');
  const snapshot = await snapshotManager.createSnapshot({
    sources: ['calls', 'ohlcv'],
    from: '2024-01-01T00:00:00Z',
    to: '2024-01-31T23:59:59Z',
  });

  // 2. Use deterministic reader
  const reader = createDeterministicReader(
    snapshotManager['storage'], // Access storage from manager
    snapshot.snapshotId
  );

  // 3. All reads go through snapshot
  const events = await reader.readEvents();

  // 4. Run workflow with deterministic data
  // ... workflow logic ...

  // 5. Store snapshot ID for reproducibility
  return {
    result: workflowResult,
    snapshotId: snapshot.snapshotId,
    contentHash: snapshot.contentHash,
  };
}
```

