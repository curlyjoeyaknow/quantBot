# @quantbot/data-observatory

Data observatory for canonical data models, snapshots, and quality checks.

## Purpose

This package provides:

1. **Canonical Data Model** - Unified event schemas for calls, trades, OHLCV, metadata, signals
2. **Snapshotting System** - Time machine for data (reproducible slices with content hashes)
3. **Pipeline Reliability** - Raw append-only store, canonical transforms, data quality checks
4. **Fast Query Surface** - Optimized queries for simulation consumption

## Architecture

### Canonical Data Model

All events are normalized to a unified schema:

- `(asset, venue, timestamp, event_type, value, confidence)`

### Snapshotting

A data snapshot is a reproducible slice:
- What sources
- What time range
- What filters
- What version of transforms

Generates `DataSnapshotRef` with content hash.

### Data Quality

- Coverage tooling (% completeness per token/window)
- Anomaly detection
- Explicit missingness rules

## Usage

```typescript
import { createSnapshotManager, createDeterministicReader, DuckDBSnapshotStorage } from '@quantbot/data-observatory';
import { DateTime } from 'luxon';

// Create a snapshot manager
const manager = createSnapshotManager('./data/snapshots.duckdb');

// Create a snapshot
const snapshot = await manager.createSnapshot({
  sources: ['calls', 'ohlcv'],
  from: DateTime.utc().minus({ days: 30 }).toISO()!,
  to: DateTime.utc().toISO()!,
  filters: { chain: 'solana' },
});

// Read deterministically from snapshot
const storage = new DuckDBSnapshotStorage('./data/snapshots.duckdb');
const reader = createDeterministicReader(storage, snapshot.snapshotId);

// Query snapshot data
const events = await reader.readEvents({
  queryOptions: {
    eventTypes: ['call'],
    tokenAddresses: ['So11111111111111111111111111111111111111112'],
  },
});
```

