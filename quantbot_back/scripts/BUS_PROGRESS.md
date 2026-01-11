# Artifact Bus Migration Progress

## Phase 1: Deploy Bus Infrastructure ✅ COMPLETE

- [x] `scripts/bus_config.json` - Configuration
- [x] `scripts/db_lock.py` - File-based locking
- [x] `scripts/bus_daemon.py` - Main daemon
- [x] `scripts/bus_submit.py` - Producer helper
- [x] `scripts/run_exports.py` - Manual export runner
- [x] `scripts/test_bus.py` - Python test script
- [x] `packages/infra/src/utils/bus/artifact-bus.ts` - TypeScript helper
- [x] Documentation (BUS_README.md, BUS_MIGRATION.md)

## Phase 2: Migrate One Producer ✅ COMPLETE

### SimulationArtifactWriter ✅

- [x] Updated to submit artifacts to bus after writing Parquet
- [x] Submits fills, positions, and events artifacts
- [x] Graceful error handling (doesn't fail if bus submission fails)
- [x] Location: `packages/lab/src/simulation/SimulationArtifactWriter.ts`

### materialiseSlice ✅

- [x] Updated to optionally submit slices to bus
- [x] Graceful error handling
- [x] Location: `packages/backtest/src/slice.ts`

## Phase 3: Verify End-to-End Flow 🔄 IN PROGRESS

### Test Infrastructure

- [x] `scripts/test_bus.py` - Python end-to-end test
- [x] `packages/infra/src/utils/bus/artifact-bus.test.ts` - TypeScript unit tests

### Testing Steps

1. [ ] Start daemon: `python3 scripts/bus_daemon.py`
2. [ ] Run Python test: `python3 scripts/test_bus.py`
3. [ ] Run TypeScript tests: `pnpm test packages/infra/src/utils/bus/artifact-bus.test.ts`
4. [ ] Verify exports: Check `data/exports/` for updated files
5. [ ] Verify catalog: Query `catalog.runs_d` and `catalog.artifacts_f`

## Phase 4: Migrate Remaining Producers 📋 PENDING

### Identified Producers

#### TypeScript Producers

- [x] `packages/lab/src/features/FeatureSetCompiler.ts` ✅
  - Writes `features.parquet`
  - Submits to bus after compilation
- [x] `packages/backtest/src/runPathOnly.ts` ✅
  - Exports `backtest_call_path_metrics` table to Parquet
  - Submits to bus after path-only backtest
- [x] `packages/backtest/src/runBacktest.ts` ✅
  - Exports all tables from `results.duckdb` to Parquet
  - Submits to bus after full backtest
- [x] `packages/backtest/src/runPolicyBacktest.ts` ✅
  - Exports policy results tables to Parquet
  - Submits to bus after policy backtest
- [ ] `packages/storage/src/adapters/clickhouse-slice-exporter-adapter-impl.ts`
  - Exports slices from ClickHouse to Parquet
  - Should submit to bus after export (complex - multiple files)
- [ ] Any other Parquet writers in TypeScript codebase

#### Python Producers

- [ ] `tools/storage/populate_coverage_matrix.py` (if it writes Parquet)
- [ ] `tools/storage/compute_ath_metrics.py` (if it writes Parquet)
- [ ] Any other Python scripts that write Parquet files

### Migration Checklist (per producer)

- [ ] Identify Parquet output location
- [ ] Add `submitArtifact()` call after Parquet write
- [ ] Add error handling (graceful degradation)
- [ ] Test with daemon running
- [ ] Verify catalog entry
- [ ] Verify golden exports update

## Phase 5: Remove Direct DuckDB Writes 📋 PENDING

### Current Direct Writers

- [ ] Identify all code that writes directly to DuckDB
- [ ] Migrate to bus pattern or read-only access
- [ ] Update readers to use `data/exports/*.parquet` or catalog queries
- [ ] Remove write permissions from non-daemon code

## Next Steps

1. **Complete Phase 3 Testing** ✅
   - [x] Created verification script (`verify_bus_integration.sh`)
   - [x] Created catalog query tool (`query_catalog.py`)
   - [x] Created quick start guide (`BUS_QUICKSTART.md`)
   - [ ] Run end-to-end test with real simulation
   - [ ] Document any issues

2. **Continue Phase 4 Migration** 🔄
   - [x] FeatureSetCompiler migrated
   - [x] Backtest commands migrated (runPathOnly, runBacktest, runPolicyBacktest)
   - [ ] ClickHouse slice exporters (complex - multiple files per export)
   - [ ] Python baseline scripts (if they write Parquet)
   - [ ] Other Parquet writers

3. **Monitor and Optimize**
   - Monitor daemon logs
   - Check for rejected jobs
   - Optimize export queries if needed
   - Consider batch artifact submission (multiple artifacts per job)

## Known Issues / Notes

- Bus submission is currently non-blocking (artifacts still written locally if bus fails)
- This is intentional for graceful degradation during migration
- Future: Consider making bus submission required (configurable)

## Success Criteria

- [x] All major producers submit to bus (simulation, backtest, features)
- [ ] No direct DuckDB writes from producers (backtest still creates local results.duckdb)
- [ ] Golden exports always up-to-date
- [x] No DB lock contention (daemon is only writer)
- [ ] Catalog accurately reflects all artifacts (needs testing)
