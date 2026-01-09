# Artifact Bus - Next Steps

## ✅ Completed

1. **Universal Helper Created** (`packages/backtest/src/bus-integration.ts`)
   - `writeBacktestResults()` - writes Parquet directly + metadata.json
   - No DuckDB intermediate step
   - Reusable across all backtest commands

2. **All Backtest Commands Refactored**
   - ✅ `runPathOnly` - uses universal helper
   - ✅ `runBacktest` - uses universal helper
   - ✅ `runPolicyBacktest` - uses universal helper

3. **Daemon Updated**
   - ✅ Handles `metadata.json` files
   - ✅ Writes metadata to `catalog.runs_d`
   - ✅ References metadata.json in artifact catalog

## 🔄 Next Steps

### 1. Update `list-runs.ts` (High Priority)

**File**: `packages/backtest/src/reporting/list-runs.ts`

**Issue**: Still looks for `results.duckdb` files, but we now write Parquet directly.

**Action**: Update to:
- Look for `metadata.json` files instead of `results.duckdb`
- Read metadata from `metadata.json` to get run info
- Optionally read Parquet files to get row counts

**Impact**: `quantbot backtest list` command will work with new format

### 2. Update `getAllRunSummaries()` (High Priority)

**File**: `packages/backtest/src/reporting/list-runs.ts`

**Issue**: Queries `results.duckdb` files that no longer exist.

**Action**: 
- Read `metadata.json` files from `artifacts/backtest/{runId}/`
- Aggregate metadata to build summaries
- Optionally query Parquet files for additional stats

### 3. Testing (High Priority)

**Test Commands**:
```bash
# 1. Start daemon
python3 scripts/bus_daemon.py

# 2. Run path-only backtest
quantbot backtest run --strategy path-only --interval 1m --from 2024-01-01 --to 2024-01-02

# 3. Verify artifacts
ls -lh artifacts/backtest/*/
# Should see: metadata.json, backtest_call_path_metrics.parquet

# 4. Check daemon logs
# Should see: [bus_daemon] processed ... + exports refreshed

# 5. Query catalog
python3 scripts/query_catalog.py

# 6. Test list command
quantbot backtest list
```

### 4. Documentation Updates (Medium Priority)

**Files to Update**:
- `packages/backtest/BUS_INTEGRATION.md` - Update with new flow
- `packages/backtest/README.md` - Mention Parquet-first approach
- `scripts/BUS_PROGRESS.md` - Mark refactoring complete

### 5. Cleanup (Low Priority)

**Files to Consider Deprecating**:
- `packages/backtest/src/reporting/backtest-results-duckdb.ts`
  - `insertCallResults()` - no longer used
  - `insertPathMetrics()` - no longer used
  - `insertPolicyResults()` - no longer used
  - Keep for backward compatibility or mark as deprecated

**Note**: These functions may still be used by:
- Legacy code paths
- Migration scripts
- Other consumers

### 6. Performance Optimization (Future)

**Potential Improvements**:
- Batch Parquet writes (currently writes one file per table)
- Parallel artifact submission
- Compression options for Parquet files
- Schema validation before writing

## 🎯 Immediate Actions

1. **Update `list-runs.ts`** to read `metadata.json` instead of `results.duckdb`
2. **Test end-to-end** with a real backtest run
3. **Verify daemon** processes metadata.json correctly
4. **Update documentation** with new flow

## 📊 Migration Status

| Component | Status | Notes |
|-----------|--------|-------|
| Universal Helper | ✅ Complete | `writeBacktestResults()` ready |
| runPathOnly | ✅ Complete | Uses helper, writes Parquet |
| runBacktest | ✅ Complete | Uses helper, writes Parquet |
| runPolicyBacktest | ✅ Complete | Uses helper, writes Parquet |
| Daemon | ✅ Complete | Handles metadata.json |
| list-runs.ts | ⏳ Pending | Needs update for Parquet |
| Documentation | ⏳ Pending | Update with new flow |
| Testing | ⏳ Pending | End-to-end verification |

## 🔍 Verification Checklist

- [ ] Run path-only backtest and verify Parquet + metadata.json created
- [ ] Verify daemon processes artifacts correctly
- [ ] Verify catalog entries include metadata
- [ ] Test `quantbot backtest list` command
- [ ] Verify no `results.duckdb` files created
- [ ] Check exports directory for updated files
- [ ] Verify backward compatibility (if needed)

