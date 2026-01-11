# Write-Once Artifact Bus

**Single-writer daemon pattern** for artifact ingestion and cataloging.

## Architecture

- **Producers** (TS, notebooks, Python scripts) = **read-only**
  - Drop Parquet files + manifest into `data/bus/inbox/<job_id>/`
  - Mark as ready by creating `COMMIT` file
  - No direct DuckDB writes

- **Daemon** (Python) = **only writer**
  - Polls `data/bus/inbox/` for committed jobs
  - Validates manifests
  - Moves files to canonical layout in `data/bus/store/`
  - Updates DuckDB catalog (`catalog.runs_d`, `catalog.artifacts_f`)
  - Auto-generates golden exports in `data/exports/`

## Filesystem Layout

```
data/
  bus/
    inbox/              # Producers drop jobs here
      <job_id>/
        manifest.json
        <artifact>.parquet
        COMMIT
    processed/         # Successfully ingested jobs
    rejected/          # Invalid jobs (with REJECT_REASON.json)
    store/             # Canonical storage (daemon owns this)
      runs/
        <run_id>/
          meta.json
          artifacts/
            <artifact_id>/
              data.parquet
              schema.json (optional)
  exports/             # Golden exports (auto-generated)
    alerts_std.parquet
    alerts_std_tradable.parquet
    schema_*.parquet
    _export_status.json
```

## Usage

### Start the daemon

```bash
python3 scripts/bus_daemon.py
```

The daemon will:
- Poll `data/bus/inbox/` every second
- Process committed jobs
- Update catalog and regenerate exports

### Submit a job (producer)

```bash
python3 scripts/bus_submit.py \
  --job-id "2026-01-08T05-12-33Z__baseline__alerts" \
  --run-id "f33593ab-67ff-4ad7-a6a9-57200b4c800a" \
  --producer "baseline" \
  --kind "alerts_std" \
  --artifact-id "alerts_std" \
  --parquet "path/to/alerts.parquet" \
  --schema-hint "canon.alerts_std" \
  --rows 7317 \
  --meta-json '{"interval": "1m"}'
```

### Manually regenerate exports

```bash
python3 scripts/run_exports.py
```

## Manifest Contract

Every producer must output `manifest.json`:

```json
{
  "run_id": "f33593ab-67ff-4ad7-a6a9-57200b4c800a",
  "job_id": "2026-01-08T05-12-33Z__baseline__alerts",
  "producer": "baseline|optimizer|backtest|ingestion|manual",
  "kind": "alerts_std|alerts_analysis|trades|metrics|whatever",
  "created_at_utc": "2026-01-08T05:12:33Z",
  "artifacts": [
    {
      "artifact_id": "alerts_std",
      "format": "parquet",
      "relpath": "alerts_std.parquet",
      "schema_hint": "canon.alerts_std",
      "rows": 7317,
      "sha256": null
    }
  ],
  "meta": {
    "git_sha": "optional",
    "params": { "interval": "1m" }
  }
}
```

## Configuration

Edit `scripts/bus_config.json`:

- `duckdb_path`: Path to DuckDB containing `canon.alerts_std` (default: `data/alerts.duckdb`)
- `bus_root`: Root directory for bus (default: `data/bus`)
- `poll_interval_s`: How often to check inbox (default: `1.0`)
- `lock_timeout_s`: Max wait for writer lock (default: `120`)
- `export`: Export configuration (see config file for details)

## DuckDB Catalog Schema

The daemon creates these tables in the `catalog` schema:

- `catalog.runs_d` - One row per run
- `catalog.artifacts_f` - One row per artifact file
- `catalog.latest_artifacts_v` - Convenience view (latest per kind, per producer)

## Why This Pattern?

1. **No DB lock contention** - Only daemon writes to DuckDB
2. **Schema flexibility** - Change catalog schema without touching producers
3. **Atomic operations** - Producers write to temp folder, commit atomically
4. **Golden exports** - Always-fresh Parquet files in `data/exports/`
5. **Single source of truth** - Daemon is the only schema authority

## Project Law

> **Pipelines produce artifacts (parquet + manifest); the bus daemon is the only writer and the only schema authority.**

