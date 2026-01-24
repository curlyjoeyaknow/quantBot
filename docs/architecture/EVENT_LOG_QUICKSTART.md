# Event Log Architecture - Quick Start Guide

**Status**: ✅ **READY FOR USE**  
**Date**: 2026-01-23

## Quick Start

### 1. Verify Installation

Check that all files are in place:

```bash
# Python files
ls tools/ledger/*.py
ls tools/ledger/tests/*.py

# TypeScript files
ls packages/backtest/src/events/*.ts
ls packages/backtest/src/adapters/legacy-duckdb-adapter.ts
ls packages/backtest/src/artifacts/index.ts
```

### 2. Run a Backtest (Events Auto-Emitted)

When you run a backtest, events are automatically emitted:

```bash
# Path-only backtest (emits run lifecycle + phase events)
quantbot backtest path-only --calls <calls> --interval 1m

# Policy backtest (emits run lifecycle + phase + trial events)
quantbot backtest policy --policy-id <id> --calls <calls> --interval 1m
```

Events are written to `data/ledger/events/day=YYYY-MM-DD/part-NNNNNN.jsonl`

### 3. Rebuild Index

After events are emitted, rebuild the DuckDB index:

```bash
# Rebuild runs index
python tools/ledger/rebuild_index.py --db data/ledger/index/runs.duckdb --verbose

# Rebuild all indexes
python tools/ledger/rebuild_index.py --full-rebuild --verbose

# Incremental rebuild (only new events)
python tools/ledger/rebuild_index.py --db data/ledger/index/runs.duckdb --since-date 2026-01-23 --verbose
```

### 4. Query Index

Query the rebuilt index using DuckDB:

```bash
# Using DuckDB CLI
duckdb data/ledger/index/runs.duckdb

# Then run queries:
SELECT * FROM latest_runs LIMIT 10;
SELECT * FROM run_phase_summary WHERE run_id = 'your-run-id';
SELECT * FROM phase_timings WHERE run_id = 'your-run-id';
```

### 5. Run Index Daemon (Optional)

For automatic index updates, run the daemon:

```bash
# Run daemon in background
python tools/ledger/index_daemon.py --interval 30 --verbose &

# Or run in foreground (Ctrl+C to stop)
python tools/ledger/index_daemon.py --interval 30 --verbose
```

## Directory Structure

```
data/ledger/
├── events/                    # Event log (source of truth)
│   ├── day=2026-01-23/
│   │   ├── part-000001.jsonl
│   │   └── ...
│   └── _schema.json
├── artifacts/                 # Run artifacts
│   └── runs/
│       └── {run_id}/
│           ├── trades.parquet
│           ├── summary.json
│           └── config.json
└── index/                      # Derived DuckDB indexes
    ├── runs.duckdb
    ├── alerts.duckdb
    └── catalog.duckdb
```

## Event Types

- **`run.created`** - Run lifecycle start (config, data fingerprint)
- **`run.started`** - Run execution start
- **`run.completed`** - Run completion (summary, artifact paths)
- **`phase.started`** - Phase execution start (phase name, order)
- **`phase.completed`** - Phase completion (duration, output summary)
- **`trial.recorded`** - Trial result (params, metrics)
- **`baseline.completed`** - Baseline run completion
- **`artifact.created`** - Artifact storage event

## Common Queries

### Latest Runs

```sql
SELECT 
  run_id,
  run_type,
  status,
  created_at_ms,
  started_at_ms,
  completed_at_ms
FROM latest_runs
ORDER BY created_at_ms DESC
LIMIT 10;
```

### Run Phase Timings

```sql
SELECT 
  run_id,
  phase_name,
  phase_order,
  duration_ms,
  started_at_ms,
  completed_at_ms
FROM phase_timings
WHERE run_id = 'your-run-id'
ORDER BY phase_order;
```

### Run Summary

```sql
SELECT 
  run_id,
  phase_count,
  total_duration_ms,
  phase_names,
  phase_durations_ms
FROM run_phase_summary
WHERE run_id = 'your-run-id';
```

## Troubleshooting

### Events Not Being Emitted

1. Check Python script is executable: `chmod +x tools/ledger/emit_event.py`
2. Check Python path: `which python3`
3. Check event log directory exists: `ls -la data/ledger/events/`
4. Check logs for Python errors

### Index Not Rebuilding

1. Verify events exist: `ls data/ledger/events/day=*/part-*.jsonl`
2. Check DuckDB path is correct
3. Run with `--verbose` flag to see errors
4. Check DuckDB file permissions

### Index Queries Return Empty

1. Verify index was rebuilt: `duckdb data/ledger/index/runs.duckdb "SELECT COUNT(*) FROM runs_d;"`
2. Check event log has events for the date range
3. Verify event types match what you're querying

## Next Steps

1. Run unit tests: `python tools/ledger/tests/test_event_writer.py`
2. Run integration tests: See `packages/backtest/src/events/__tests__/event-log.integration.test.ts`
3. Test with real backtest runs
4. Monitor event log growth
5. Set up index daemon for production

## Support

- See `docs/architecture/EVENT_LOG_MIGRATION.md` for detailed migration guide
- See `docs/architecture/EVENT_LOG_IMPLEMENTATION_SUMMARY.md` for implementation details

