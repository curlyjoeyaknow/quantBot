# Structured Artifacts System

## Overview

The structured artifacts system provides a research-lab architecture for backtest runs, separating concerns between:

1. **Immutable run outputs** (Parquet files)
2. **Run metadata** (JSON manifests)
3. **Queryable catalog** (DuckDB index)

This design prevents half-written garbage from polluting the catalog and enables efficient cross-run analysis.

## Core Principles

### 1. Multiple Parquets per Run (by Artifact Type)

Each artifact type is a narrow, purpose-built Parquet file:

- **`alerts.parquet`** - Input calls/alerts for the run
- **`paths.parquet`** - Truth layer outputs (ATH, drawdowns, time-to-multiples)
- **`features.parquet`** - Derived feature columns (for ML/analysis)
- **`trades.parquet`** - Policy simulation events/fills
- **`summary.parquet`** - One-row aggregate metrics
- **`frontier.parquet`** - Optimization candidates with scores
- **`errors.parquet`** - Errors and warnings during run

Each file is columnar and small enough to scan quickly.

### 2. Metadata as JSON/YAML (Not Parquet Columns)

For each run, we write `run.json` containing:

- `run_id`, timestamps, git commit, dataset window
- Parameters / config hashes
- Schema versions
- Row counts per artifact
- "Links" to file paths

This is your index card. Humans can read it. Machines can, too.

### 3. Gradual Registration into DuckDB (Daemon Pattern)

The daemon:

- Watches `runs/**/` for completed artifacts
- Validates schema/version
- Registers into DuckDB tables for querying
- Never blocks the run itself

**Pipeline**: Run writes Parquet → daemon catalogs → DuckDB becomes query layer.

## Directory Structure

```
runs/
  YYYY-MM/                          # Month partition
    run_id=<uuid>/
      run.json                      # Manifest
      inputs/
        alerts.parquet
      truth/
        paths.parquet
      features/
        features.parquet
      policy/
        trades.parquet
      results/
        summary.parquet
        frontier.parquet
      logs/
        stdout.txt
        stderr.txt
      errors/
        errors.parquet
      _SUCCESS                      # Completion marker
```

### Month Partitioning

Runs are partitioned by month (`YYYY-MM/`) to keep directory sizes sane. This is configurable but recommended for production use.

### Completion Marker

Runs only become "visible" when a `_SUCCESS` marker exists (or `status=completed` in `run.json`). The daemon only ingests "complete" runs.

## Artifact Types

### Input Layer

#### `alerts.parquet`

Input calls/alerts for the run.

**Schema**:
```typescript
{
  call_id: string
  mint: string
  caller_name: string
  chain: string
  alert_ts_ms: number
  created_at: string  // ISO timestamp
}
```

### Truth Layer

#### `paths.parquet`

Truth layer outputs: ATH, drawdowns, time-to-multiples.

**Schema**:
```typescript
{
  run_id: string
  call_id: string
  caller_name: string
  mint: string
  chain: string
  interval: string
  
  // Alert context
  alert_ts_ms: number
  p0: number  // Entry price
  
  // Multiple hits
  hit_2x: boolean
  t_2x_ms: number | null
  hit_3x: boolean
  t_3x_ms: number | null
  hit_4x: boolean
  t_4x_ms: number | null
  
  // Drawdowns
  dd_bps: number  // Initial drawdown from alert
  dd_to_2x_bps: number | null  // Drawdown before hitting 2x
  
  // Timing
  alert_to_activity_ms: number | null
  
  // Peak
  peak_multiple: number
}
```

### Feature Layer

#### `features.parquet`

Derived feature columns for ML/analysis.

**Schema**:
```typescript
{
  run_id: string
  call_id: string
  features: Record<string, unknown>  // Extensible
}
```

### Policy Layer

#### `trades.parquet`

Policy simulation events/fills.

**Schema**:
```typescript
{
  run_id: string
  policy_id?: string
  call_id: string
  
  // Entry
  entry_ts_ms: number
  entry_px: number
  
  // Exit
  exit_ts_ms: number
  exit_px: number
  exit_reason: string
  
  // Performance
  realized_return_bps: number
  stop_out: boolean
  max_adverse_excursion_bps: number
  time_exposed_ms: number
  tail_capture: number | null
}
```

### Results Layer

#### `summary.parquet`

One-row aggregate metrics.

**Schema**:
```typescript
{
  run_id: string
  
  // Counts
  calls_processed: number
  calls_excluded: number
  trades_count: number
  
  // Returns
  avg_return_bps: number
  median_return_bps: number
  p25_return_bps?: number
  p75_return_bps?: number
  p90_return_bps?: number
  
  // Risk
  stop_out_rate: number
  avg_max_adverse_excursion_bps: number
  
  // Timing
  avg_time_exposed_ms: number
  median_time_exposed_ms?: number
  
  // Tail capture
  avg_tail_capture: number | null
  median_tail_capture: number | null
}
```

#### `frontier.parquet`

Optimization candidates with scores.

**Schema**:
```typescript
{
  run_id: string
  caller_name: string
  
  // Policy parameters (serialized)
  policy_params: string  // JSON string
  
  // Constraints
  meets_constraints: boolean
  
  // Scores
  objective_score: number
  avg_return_bps: number
  median_return_bps: number
  stop_out_rate: number
  
  // Ranking
  rank?: number
}
```

### Error Layer

#### `errors.parquet`

Errors and warnings during run.

**Schema**:
```typescript
{
  run_id: string
  timestamp: string  // ISO timestamp
  level: 'error' | 'warning' | 'info'
  phase: string  // 'plan', 'coverage', 'slice', 'execution', 'optimization'
  call_id?: string
  message: string
  details?: string  // JSON string
}
```

## Run Manifest (`run.json`)

The manifest is the index card for each run.

**Schema**:
```typescript
{
  // Identity
  run_id: string
  run_type: 'path-only' | 'policy' | 'optimization' | 'full'
  
  // Timestamps
  created_at: string  // ISO timestamp
  started_at?: string
  completed_at?: string
  
  // Status
  status: 'pending' | 'running' | 'completed' | 'failed'
  
  // Provenance
  git_commit?: string
  git_branch?: string
  git_dirty?: boolean
  
  // Dataset window
  dataset: {
    from?: string  // ISO timestamp
    to?: string
    interval: string
    calls_count: number
  }
  
  // Parameters (hashed for reproducibility)
  parameters: {
    strategy_id?: string
    policy_id?: string
    config_hash?: string
    // Extensible
  }
  
  // Schema versions (for forward compatibility)
  schema_version: {
    manifest: string  // e.g., "1.0.0"
    artifacts: string
  }
  
  // Artifact inventory
  artifacts: {
    alerts?: { rows: number, path: string }
    paths?: { rows: number, path: string }
    features?: { rows: number, path: string }
    trades?: { rows: number, path: string }
    summary?: { rows: number, path: string }
    frontier?: { rows: number, path: string }
    errors?: { rows: number, path: string }
  }
  
  // Timing
  timing?: {
    plan_ms?: number
    coverage_ms?: number
    slice_ms?: number
    execution_ms?: number
    optimization_ms?: number
    total_ms?: number
  }
  
  // Logs
  logs?: {
    stdout?: string
    stderr?: string
  }
}
```

## Usage

### Writing Artifacts (in Backtest Flows)

```typescript
import { createRunDirectory, getGitProvenance } from '@quantbot/backtest';

// Initialize run directory
const runDir = await createRunDirectory(runId, 'path-only');

// Set git provenance
const gitInfo = await getGitProvenance();
runDir.updateManifest({
  git_commit: gitInfo.commit,
  git_branch: gitInfo.branch,
  git_dirty: gitInfo.dirty,
  dataset: {
    from: req.from?.toISOString(),
    to: req.to?.toISOString(),
    interval: req.interval,
    calls_count: req.calls.length,
  },
});

// Write artifacts
await runDir.writeArtifact('alerts', alertArtifacts);
await runDir.writeArtifact('paths', pathArtifacts);

// Update timing and mark success
runDir.updateManifest({
  timing: {
    plan_ms: timing.phases.plan?.durationMs,
    coverage_ms: timing.phases.coverage?.durationMs,
    // ...
  },
});
await runDir.markSuccess();
```

### Catalog Sync (Daemon)

```bash
# Sync all completed runs into catalog
quantbot backtest catalog-sync --base-dir runs --duckdb data/backtest_catalog.duckdb --stats

# Run as cron job (every 5 minutes)
*/5 * * * * cd /path/to/quantbot && quantbot backtest catalog-sync
```

### Querying the Catalog

```bash
# List recent runs
quantbot backtest catalog-query --limit 10

# Filter by run type
quantbot backtest catalog-query --run-type path-only --limit 20

# Filter by git branch
quantbot backtest catalog-query --git-branch main --status completed

# Get artifact path
quantbot backtest catalog-query --run-id <uuid> --artifact-type paths
```

### Programmatic Access

```typescript
import { DuckDBClient } from '@quantbot/storage';
import { queryRuns, getArtifactPath, getCatalogStats } from '@quantbot/backtest';

const db = new DuckDBClient('data/backtest_catalog.duckdb');

// Query runs
const runs = await queryRuns(db, {
  runType: 'path-only',
  status: 'completed',
  fromDate: '2024-01-01',
  limit: 100,
});

// Get artifact path
const pathsFile = await getArtifactPath(db, runId, 'paths');

// Get catalog stats
const stats = await getCatalogStats(db);
console.log(`Total runs: ${stats.totalRuns}`);
console.log(`Completed: ${stats.completedRuns}`);
console.log(`By type:`, stats.runsByType);

await db.close();
```

## Integration with Existing Systems

### Backward Compatibility

The structured artifacts system is **additive**. Existing backtest flows continue to work:

- Old artifact directory (`artifacts/backtest/<runId>/`) is still used for bus integration
- New structured directory (`runs/YYYY-MM/run_id=<uuid>/`) is used for catalog
- Both can coexist during migration

### Migration Path

1. **Phase 1**: New runs write to both old and new locations
2. **Phase 2**: Update consumers to read from catalog
3. **Phase 3**: Deprecate old artifact directory

### Bus Integration

The structured artifacts system is compatible with the existing bus integration:

- Artifacts are still submitted to the bus (if configured)
- Bus daemon can watch `runs/` directory for new artifacts
- Catalog provides a queryable index over bus artifacts

## Performance Considerations

### Write Performance

- Parquet writes are batched (1000 rows per batch)
- DuckDB in-memory mode for fast schema inference
- Month partitioning keeps directory scans fast

### Query Performance

- DuckDB catalog provides indexed access to runs
- Parquet files are columnar and compressed
- Only read artifacts you need (not all at once)

### Storage Efficiency

- Parquet compression (typically 5-10x vs JSON)
- Month partitioning enables pruning old runs
- Separate artifacts enable selective deletion

## Best Practices

### 1. Always Write `_SUCCESS` Marker

```typescript
await runDir.markSuccess();
```

This prevents incomplete runs from being cataloged.

### 2. Use Git Provenance

```typescript
const gitInfo = await getGitProvenance();
runDir.updateManifest({
  git_commit: gitInfo.commit,
  git_branch: gitInfo.branch,
  git_dirty: gitInfo.dirty,
});
```

This enables reproducibility and debugging.

### 3. Write Errors to `errors.parquet`

```typescript
const errorArtifacts = warnings.map(w => ({
  run_id: runId,
  timestamp: new Date().toISOString(),
  level: 'warning',
  phase: 'execution',
  call_id: w.callId,
  message: w.message,
  details: JSON.stringify(w.details),
}));
await runDir.writeArtifact('errors', errorArtifacts);
```

This makes debugging easier.

### 4. Run Catalog Sync Regularly

Set up a cron job to sync the catalog every 5-10 minutes:

```bash
*/5 * * * * cd /path/to/quantbot && quantbot backtest catalog-sync
```

### 5. Prune Old Runs

Archive or delete old month partitions to save space:

```bash
# Archive runs older than 6 months
tar -czf runs-archive-2023-01.tar.gz runs/2023-01/
rm -rf runs/2023-01/
```

## Troubleshooting

### Run Not Appearing in Catalog

1. Check if `_SUCCESS` marker exists
2. Check `run.json` status field
3. Run catalog sync manually
4. Check daemon logs

### Artifact Schema Mismatch

1. Check `schema_version` in `run.json`
2. Update catalog schema if needed
3. Re-run catalog sync

### Performance Issues

1. Check month partition size (should be < 1000 runs)
2. Prune old runs
3. Optimize DuckDB queries (add indexes)

## Future Enhancements

### 1. Incremental Catalog Updates

Instead of full scans, watch filesystem for new runs:

```typescript
import { watch } from 'fs/promises';

for await (const event of watch('runs/', { recursive: true })) {
  if (event.filename.endsWith('_SUCCESS')) {
    // Register run
  }
}
```

### 2. Remote Storage Support

Store artifacts in S3/GCS and keep only metadata locally:

```typescript
await runDir.writeArtifact('paths', pathArtifacts, {
  storage: 's3://bucket/runs/',
});
```

### 3. Artifact Compression

Compress artifacts with Zstd for better storage efficiency:

```typescript
await runDir.writeArtifact('paths', pathArtifacts, {
  compression: 'zstd',
  compressionLevel: 3,
});
```

### 4. Schema Evolution

Support schema migrations for forward compatibility:

```typescript
await runDir.writeArtifact('paths', pathArtifacts, {
  schemaVersion: '2.0.0',
  migrations: [migrateV1toV2],
});
```

## References

- [Architecture: Backtest Ports & Adapters](./10-architecture-ports-adapters.md)
- [Testing: Contracts](../../.cursor/rules/40-testing-contracts.mdc)
- [DuckDB Parquet Documentation](https://duckdb.org/docs/data/parquet)

