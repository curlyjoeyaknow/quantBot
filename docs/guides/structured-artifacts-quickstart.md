# Structured Artifacts Quick Start

## What You Get

A research-lab architecture for backtest runs with:

- **Narrow Parquet files** per artifact type (alerts, paths, trades, summary, etc.)
- **JSON manifests** for metadata and provenance
- **DuckDB catalog** for cross-run queries
- **Completion markers** to prevent incomplete runs from polluting the catalog

## 5-Minute Setup

### 1. Run a Backtest (Automatically Creates Artifacts)

```bash
# Path-only backtest
quantbot backtest path-only \
  --calls-from-duckdb data/alerts.duckdb \
  --interval 5m \
  --from 2024-01-01 \
  --to 2024-01-31

# Policy backtest
quantbot backtest policy \
  --calls-from-duckdb data/alerts.duckdb \
  --policy-id fixed-stop-5pct \
  --policy '{"kind":"fixed_stop","stop_loss_bps":500}' \
  --interval 5m \
  --from 2024-01-01 \
  --to 2024-01-31
```

This creates:

```
runs/
  2024-01/
    run_id=<uuid>/
      run.json
      inputs/alerts.parquet
      truth/paths.parquet
      policy/trades.parquet
      results/summary.parquet
      _SUCCESS
```

### 2. Sync to Catalog

```bash
quantbot backtest catalog-sync --stats
```

Output:
```
✓ Initialized catalog tables
✓ Registered 1 run
✓ Skipped 0 runs

Catalog Statistics:
  Total runs: 1
  Completed: 1
  Failed: 0
  By type: { "path-only": 1 }
  Total artifacts: 2
  By type: { "alerts": 1, "paths": 1 }
```

### 3. Query the Catalog

```bash
# List recent runs
quantbot backtest catalog-query --limit 10

# Filter by type
quantbot backtest catalog-query --run-type path-only --status completed

# Get artifact path
quantbot backtest catalog-query --run-id <uuid> --artifact-type paths
```

## Directory Structure

```
runs/
  YYYY-MM/                          # Month partition
    run_id=<uuid>/
      run.json                      # Manifest (metadata, provenance, inventory)
      inputs/
        alerts.parquet              # Input calls
      truth/
        paths.parquet               # Truth layer (ATH, drawdowns, multiples)
      features/
        features.parquet            # Derived features (optional)
      policy/
        trades.parquet              # Policy simulation trades
      results/
        summary.parquet             # Aggregate metrics (one row)
        frontier.parquet            # Optimization frontier (optional)
      logs/
        stdout.txt                  # Standard output
        stderr.txt                  # Standard error
      errors/
        errors.parquet              # Errors and warnings (optional)
      _SUCCESS                      # Completion marker
```

## Artifact Types

### `alerts.parquet` (Inputs)

Input calls/alerts for the run.

```typescript
{
  call_id: string
  mint: string
  caller_name: string
  chain: string
  alert_ts_ms: number
  created_at: string
}
```

### `paths.parquet` (Truth Layer)

Truth layer outputs: ATH, drawdowns, time-to-multiples.

```typescript
{
  run_id: string
  call_id: string
  caller_name: string
  mint: string
  chain: string
  interval: string
  alert_ts_ms: number
  p0: number
  hit_2x: boolean
  t_2x_ms: number | null
  hit_3x: boolean
  t_3x_ms: number | null
  hit_4x: boolean
  t_4x_ms: number | null
  dd_bps: number
  dd_to_2x_bps: number | null
  alert_to_activity_ms: number | null
  peak_multiple: number
}
```

### `trades.parquet` (Policy Layer)

Policy simulation events/fills.

```typescript
{
  run_id: string
  policy_id?: string
  call_id: string
  entry_ts_ms: number
  entry_px: number
  exit_ts_ms: number
  exit_px: number
  exit_reason: string
  realized_return_bps: number
  stop_out: boolean
  max_adverse_excursion_bps: number
  time_exposed_ms: number
  tail_capture: number | null
}
```

### `summary.parquet` (Results)

One-row aggregate metrics.

```typescript
{
  run_id: string
  calls_processed: number
  calls_excluded: number
  trades_count: number
  avg_return_bps: number
  median_return_bps: number
  stop_out_rate: number
  avg_max_adverse_excursion_bps: number
  avg_time_exposed_ms: number
  avg_tail_capture: number | null
  median_tail_capture: number | null
}
```

## Programmatic Access

### Read Artifacts Directly

```typescript
import duckdb from 'duckdb';

const db = new duckdb.Database(':memory:');

// Read paths artifact
db.all(`
  SELECT * FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
  WHERE hit_2x = true
`, (err, rows) => {
  console.log(`Calls that hit 2x: ${rows.length}`);
});
```

### Query Catalog

```typescript
import { DuckDBClient } from '@quantbot/storage';
import { queryRuns, getArtifactPath } from '@quantbot/backtest';

const db = new DuckDBClient('data/backtest_catalog.duckdb');

// Query runs
const runs = await queryRuns(db, {
  runType: 'path-only',
  status: 'completed',
  fromDate: '2024-01-01',
  limit: 100,
});

console.log(`Found ${runs.length} runs`);

// Get artifact path
const pathsFile = await getArtifactPath(db, runs[0].run_id, 'paths');
console.log(`Paths artifact: ${pathsFile}`);

await db.close();
```

### Read Run Manifest

```typescript
import { RunDirectory } from '@quantbot/backtest';

const manifest = await RunDirectory.readManifest('runs/2024-01/run_id=<uuid>');

console.log(`Run ID: ${manifest.run_id}`);
console.log(`Run type: ${manifest.run_type}`);
console.log(`Status: ${manifest.status}`);
console.log(`Git commit: ${manifest.git_commit}`);
console.log(`Artifacts:`, manifest.artifacts);
```

## Automation

### Cron Job for Catalog Sync

Add to crontab:

```bash
# Sync catalog every 5 minutes
*/5 * * * * cd /path/to/quantbot && quantbot backtest catalog-sync >> /var/log/quantbot-catalog.log 2>&1
```

### Systemd Service (Linux)

Create `/etc/systemd/system/quantbot-catalog.service`:

```ini
[Unit]
Description=QuantBot Catalog Sync
After=network.target

[Service]
Type=oneshot
User=quantbot
WorkingDirectory=/path/to/quantbot
ExecStart=/path/to/quantbot/node_modules/.bin/quantbot backtest catalog-sync
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/quantbot-catalog.timer`:

```ini
[Unit]
Description=QuantBot Catalog Sync Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
```

Enable:

```bash
sudo systemctl enable quantbot-catalog.timer
sudo systemctl start quantbot-catalog.timer
```

## Analysis Examples

### Find Best Callers (Path-Only)

```sql
SELECT
  caller_name,
  COUNT(*) as calls,
  AVG(CASE WHEN hit_2x THEN 1 ELSE 0 END) as hit_rate_2x,
  AVG(peak_multiple) as avg_peak_multiple,
  AVG(dd_bps) as avg_drawdown_bps
FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
GROUP BY caller_name
HAVING calls >= 10
ORDER BY hit_rate_2x DESC
LIMIT 20;
```

### Compare Policies

```sql
WITH policy_a AS (
  SELECT * FROM read_parquet('runs/2024-01/run_id=<policy-a>/policy/trades.parquet')
),
policy_b AS (
  SELECT * FROM read_parquet('runs/2024-01/run_id=<policy-b>/policy/trades.parquet')
)
SELECT
  'Policy A' as policy,
  AVG(realized_return_bps) as avg_return,
  AVG(CASE WHEN stop_out THEN 1 ELSE 0 END) as stop_out_rate
FROM policy_a
UNION ALL
SELECT
  'Policy B' as policy,
  AVG(realized_return_bps) as avg_return,
  AVG(CASE WHEN stop_out THEN 1 ELSE 0 END) as stop_out_rate
FROM policy_b;
```

### Time Series Analysis

```sql
SELECT
  DATE_TRUNC('day', TIMESTAMP 'epoch' + alert_ts_ms * INTERVAL '1 millisecond') as day,
  COUNT(*) as calls,
  AVG(CASE WHEN hit_2x THEN 1 ELSE 0 END) as hit_rate_2x,
  AVG(peak_multiple) as avg_peak_multiple
FROM read_parquet('runs/2024-01/run_id=<uuid>/truth/paths.parquet')
GROUP BY day
ORDER BY day;
```

## Next Steps

- [Full Documentation](../architecture/structured-artifacts.md)
- [Architecture: Backtest Ports & Adapters](../architecture/10-architecture-ports-adapters.md)
- [Testing Contracts](../../.cursor/rules/40-testing-contracts.mdc)

## Troubleshooting

### Run Not Appearing in Catalog

1. Check if `_SUCCESS` marker exists:
   ```bash
   ls runs/2024-01/run_id=<uuid>/_SUCCESS
   ```

2. Check `run.json` status:
   ```bash
   cat runs/2024-01/run_id=<uuid>/run.json | jq .status
   ```

3. Run catalog sync manually:
   ```bash
   quantbot backtest catalog-sync --stats
   ```

### Artifact Schema Mismatch

Check schema version:
```bash
cat runs/2024-01/run_id=<uuid>/run.json | jq .schema_version
```

If outdated, update catalog schema and re-sync.

### Performance Issues

1. Check month partition size:
   ```bash
   ls -l runs/2024-01/ | wc -l
   ```

2. Prune old runs:
   ```bash
   tar -czf runs-archive-2023-01.tar.gz runs/2023-01/
   rm -rf runs/2023-01/
   ```

3. Optimize DuckDB queries (add indexes if needed).

