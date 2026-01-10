# Artifact Bus Migration Guide

This guide explains how to migrate existing producers to use the Write-Once Artifact Bus pattern.

## Overview

**Before**: Producers write directly to DuckDB → DB lock contention, schema coupling

**After**: Producers write Parquet + manifest → Bus daemon handles everything → No lock contention

## Migration Steps

### 1. Identify Producers

Find all code that writes Parquet files or directly writes to DuckDB:

- `SimulationArtifactWriter` - writes fills.parquet, positions.parquet, events.parquet
- `packages/backtest/src/slice.ts` - writes slice parquet files
- Any Python scripts that write Parquet files
- Any code that directly inserts into DuckDB tables

### 2. Update TypeScript Producers

**Before**:
```typescript
// Direct DuckDB write
const db = new DuckDBClient('data/alerts.duckdb');
await db.execute(`INSERT INTO table VALUES (...)`);

// Or writing Parquet directly
await db.execute(`COPY data TO 'output.parquet' (FORMAT PARQUET)`);
```

**After**:
```typescript
import { submitArtifact } from '@quantbot/infra/utils';

// Write Parquet to temp location first
const tempParquet = '/tmp/my-artifact.parquet';
await db.execute(`COPY data TO '${tempParquet}' (FORMAT PARQUET)`);

// Submit to bus
await submitArtifact({
  runId: 'run-123',
  producer: 'simulation',
  kind: 'trades',
  artifactId: 'trades',
  parquetPath: tempParquet,
  schemaHint: 'canon.trades',
  rows: 1000,
  meta: { interval: '1m' }
});
```

### 3. Update SimulationArtifactWriter

**Location**: `packages/lab/src/simulation/SimulationArtifactWriter.ts`

**Change**: After writing Parquet files, submit them to the bus instead of (or in addition to) writing to DuckDB.

```typescript
// After writing artifacts
const fillsPath = await this.writeFillsParquet(outputDir, fills);
const positionsPath = await this.writePositionsParquet(outputDir, positions);
const eventsPath = await this.writeEventsParquet(outputDir, events);

// Submit to bus
await submitArtifact({
  runId,
  producer: 'simulation',
  kind: 'fills',
  artifactId: 'fills',
  parquetPath: fillsPath,
  rows: fills.length,
  meta: { presetName }
});

await submitArtifact({
  runId,
  producer: 'simulation',
  kind: 'positions',
  artifactId: 'positions',
  parquetPath: positionsPath,
  rows: positions.length,
  meta: { presetName }
});

await submitArtifact({
  runId,
  producer: 'simulation',
  kind: 'events',
  artifactId: 'events',
  parquetPath: eventsPath,
  rows: events.length,
  meta: { presetName }
});
```

### 4. Update Python Producers

**Before**:
```python
# Direct DuckDB write
con = duckdb.connect("data/alerts.duckdb")
con.execute("INSERT INTO table VALUES (...)")
```

**After**:
```python
# Write Parquet first
con.execute("COPY data TO 'output.parquet' (FORMAT PARQUET)")

# Submit via bus_submit.py
import subprocess
subprocess.run([
    "python3", "scripts/bus_submit.py",
    "--job-id", job_id,
    "--run-id", run_id,
    "--producer", "baseline",
    "--kind", "alerts_std",
    "--artifact-id", "alerts_std",
    "--parquet", "output.parquet",
    "--schema-hint", "canon.alerts_std",
    "--rows", str(row_count),
    "--meta-json", json.dumps(meta)
])
```

### 5. Update Readers

**Before**: Query DuckDB directly
```typescript
const db = await openDuckDb('data/alerts.duckdb');
const rows = await db.query('SELECT * FROM canon.alerts_std');
```

**After**: Read from golden exports (or query catalog to find paths)
```typescript
// Option 1: Read golden export directly
import { readParquet } from '@quantbot/storage';
const rows = await readParquet('data/exports/alerts_std.parquet');

// Option 2: Query catalog to find latest artifact
const db = await openDuckDb('data/alerts.duckdb', { readOnly: true });
const latest = await db.query(`
  SELECT canonical_path 
  FROM catalog.latest_artifacts_v 
  WHERE producer = 'baseline' AND kind = 'alerts_std'
`);
const rows = await readParquet(latest[0].canonical_path);
```

## Benefits

1. **No DB lock contention** - Only daemon writes to DuckDB
2. **Schema flexibility** - Change catalog without touching producers
3. **Atomic operations** - Producers write to temp, commit atomically
4. **Golden exports** - Always-fresh Parquet files in `data/exports/`
5. **Single source of truth** - Daemon is the only schema authority

## Testing

1. Start the daemon: `python3 scripts/bus_daemon.py`
2. Run test: `python3 scripts/test_bus.py`
3. Verify exports: Check `data/exports/` for updated Parquet files

## Rollout Strategy

1. **Phase 1**: Deploy bus infrastructure (done)
2. **Phase 2**: Migrate one producer (e.g., SimulationArtifactWriter)
3. **Phase 3**: Verify end-to-end flow
4. **Phase 4**: Migrate remaining producers incrementally
5. **Phase 5**: Remove direct DuckDB writes from producers

## Troubleshooting

### Daemon not processing jobs

- Check `data/bus/rejected/` for error messages
- Verify daemon is running: `ps aux | grep bus_daemon`
- Check logs in daemon output

### Exports not updating

- Verify `canon.alerts_std` exists in target database
- Check `data/exports/_export_status.json` for errors
- Ensure daemon has write access to export directory

### Lock timeouts

- Increase `lock_timeout_s` in `bus_config.json`
- Check for stale lock files: `data/alerts.duckdb.writer.lock`
- Ensure only one daemon instance is running

