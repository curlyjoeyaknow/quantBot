# Artifact Bus Quick Start Guide

## Prerequisites

- Python 3.8+ with `duckdb` package installed
- Node.js/pnpm for TypeScript commands
- Bus daemon running (see below)

## Step 1: Start the Daemon

```bash
# In a terminal, start the daemon
python3 scripts/bus_daemon.py
```

You should see:
```
[bus_daemon] up. inbox=data/bus/inbox duckdb=data/alerts.duckdb
```

**Keep this terminal open** - the daemon runs continuously.

## Step 2: Run a Simulation

In another terminal, run:

```bash
# Interactive mode (easiest)
quantbot sim

# Or use research command
quantbot research run --request-file <path-to-request.json>
```

## Step 3: Verify Integration

### Check Daemon Logs

In the daemon terminal, you should see:
```
[bus_daemon] processed 2026-01-08T05-12-33Z__simulation__fills + exports refreshed
[bus_daemon] processed 2026-01-08T05-12-33Z__simulation__positions + exports refreshed
[bus_daemon] processed 2026-01-08T05-12-33Z__simulation__events + exports refreshed
```

### Run Verification Script

```bash
./scripts/verify_bus_integration.sh
```

This checks:
- ✅ Daemon is running
- ✅ Catalog schema exists
- ✅ Recent runs in catalog
- ✅ Golden exports are up-to-date

### Query the Catalog

```bash
# Show all recent activity
python3 scripts/query_catalog.py

# Show only runs
python3 scripts/query_catalog.py --runs

# Show only artifacts
python3 scripts/query_catalog.py --artifacts

# Show latest artifacts per kind
python3 scripts/query_catalog.py --latest
```

### Check Golden Exports

```bash
# List export files
ls -lh data/exports/

# Check export status
cat data/exports/_export_status.json
```

## Step 4: Test with Python Script

```bash
# Run the test script
python3 scripts/test_bus.py
```

This creates a test job and verifies it gets processed.

## Troubleshooting

### Daemon Not Processing Jobs

1. **Check daemon is running:**
   ```bash
   pgrep -f bus_daemon.py
   ```

2. **Check for rejected jobs:**
   ```bash
   ls -la data/bus/rejected/
   cat data/bus/rejected/*/REJECT_REASON.json
   ```

3. **Check inbox:**
   ```bash
   ls -la data/bus/inbox/
   ```

### Exports Not Updating

1. **Check export status:**
   ```bash
   cat data/exports/_export_status.json
   ```

2. **Verify database has canon views:**
   ```bash
   python3 -c "import duckdb; con = duckdb.connect('data/alerts.duckdb', read_only=True); print(con.execute(\"SELECT table_name FROM information_schema.views WHERE table_schema = 'canon'\").fetchall())"
   ```

3. **Manually regenerate exports:**
   ```bash
   python3 scripts/run_exports.py
   ```

### Lock Timeouts

If you see lock timeout errors:

1. **Check for stale lock file:**
   ```bash
   ls -la data/alerts.duckdb.writer.lock
   ```

2. **Remove stale lock (if daemon is not running):**
   ```bash
   rm data/alerts.duckdb.writer.lock
   ```

3. **Increase timeout in config:**
   Edit `scripts/bus_config.json`:
   ```json
   {
     "lock_timeout_s": 300
   }
   ```

## Next Steps

1. **Monitor daemon logs** for processed jobs
2. **Query catalog** to see ingested artifacts
3. **Check exports** are being regenerated
4. **Run more simulations** to test end-to-end

## Integration Status

✅ **Migrated Producers:**
- `SimulationArtifactWriter` - fills, positions, events
- `materialiseSlice` - backtest slices
- `FeatureSetCompiler` - computed features

📋 **Future Migrations:**
- ClickHouse slice exporters
- Python baseline scripts
- Other Parquet writers

## Architecture

```
Producer (TS/Python)
  ↓ writes Parquet + manifest
data/bus/inbox/<job_id>/
  ↓ daemon processes
data/bus/store/runs/<run_id>/artifacts/
  ↓ catalog updated
catalog.runs_d, catalog.artifacts_f
  ↓ exports regenerated
data/exports/*.parquet
```

## Commands Reference

```bash
# Start daemon
python3 scripts/bus_daemon.py

# Submit job manually
python3 scripts/bus_submit.py --job-id test --run-id run-123 --producer test --kind test --artifact-id test --parquet file.parquet

# Regenerate exports
python3 scripts/run_exports.py

# Query catalog
python3 scripts/query_catalog.py

# Verify integration
./scripts/verify_bus_integration.sh

# Test bus
python3 scripts/test_bus.py
```

