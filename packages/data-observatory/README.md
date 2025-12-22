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
import { createSnapshot, querySnapshot } from '@quantbot/data-observatory';

// Create a snapshot
const snapshot = await createSnapshot({
  sources: ['calls', 'ohlcv'],
  from: DateTime.fromISO('2024-01-01'),
  to: DateTime.fromISO('2024-01-31'),
  filters: { chain: 'solana' },
});

// Query snapshot data
const data = await querySnapshot(snapshot.ref, {
  eventType: 'call',
  tokenAddress: 'So11111111111111111111111111111111111111112',
});
```

