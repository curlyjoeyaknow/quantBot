# OHLCV Run Tracking Integration - Complete

**Date**: 2026-01-12  
**Status**: ✅ Fully Integrated

## Overview

The OHLCV deduplication and audit trail module has been fully integrated into the ingestion workflows. Every ingestion run now creates a complete audit trail with git version info, CLI arguments, and environment details.

## What Was Integrated

### 1. OhlcvIngestionEngine (packages/jobs)

**Added**:

- `IngestionRunRepository` instance for run tracking
- `currentRunManifest` field to track active run
- `startRun(manifest)` - Start a tracked ingestion run
- `completeRun(stats)` - Complete run with final statistics
- `failRun(error)` - Mark run as failed with error details
- `getCurrentRunManifest()` - Get current run manifest

**Flow**:

```typescript
// Start run
await engine.startRun(manifest);

// ... fetch candles ...

// Complete run
await engine.completeRun({
  candlesFetched: 1000,
  candlesInserted: 1000,
  candlesRejected: 0,
  candlesDeduplicated: 0,
  tokensProcessed: 10,
  errorsCount: 0,
  zeroVolumeCount: 0,
});
```

### 2. OhlcvIngestionService (packages/ingestion)

**Added**:

- `createRunManifest(params)` - Generate run manifest with full audit trail
- Automatic run tracking in `ingestForCalls()`:
  - Creates manifest at start
  - Starts tracked run
  - Completes run on success
  - Fails run on error

**Run Manifest Contents**:

```typescript
{
  runId: UUID,
  scriptVersion: "1.2.3",  // from package.json
  gitCommitHash: "abc1234",
  gitBranch: "main",
  gitDirty: false,
  cliArgs: {
    from: "2024-01-01T00:00:00Z",
    to: "2024-02-01T00:00:00Z",
    chain: "solana",
    interval: "1m",
    // ... other params
  },
  envInfo: {
    CLICKHOUSE_HOST: "localhost",
    CLICKHOUSE_DATABASE: "quantbot",
    BIRDEYE_API_KEY: "***"  // Redacted
  },
  inputHash: "a1b2c3d4...",  // SHA256 of input params
  dedupMode: "none",
  sourceTier: SourceTier.BACKFILL_API
}
```

### 3. Run Tracking in ClickHouse

Every ingestion run is recorded in `ohlcv_ingestion_runs` table:

```sql
SELECT 
  run_id,
  started_at,
  completed_at,
  status,
  script_version,
  git_commit_hash,
  git_branch,
  git_dirty,
  candles_fetched,
  candles_inserted,
  tokens_processed,
  errors_count
FROM quantbot.ohlcv_ingestion_runs
ORDER BY started_at DESC
LIMIT 10;
```

## Usage

### Automatic Tracking

All ingestion runs are automatically tracked when using `OhlcvIngestionService.ingestForCalls()`:

```typescript
const service = new OhlcvIngestionService();
const result = await service.ingestForCalls({
  from: new Date('2024-01-01'),
  to: new Date('2024-02-01'),
  chain: 'solana',
  duckdbPath: 'data/tele.duckdb',
});

// Run is automatically tracked with full audit trail
```

### CLI Commands

View run history:

```bash
quantbot ohlcv runs-list --status=completed --limit=20
quantbot ohlcv runs-list --status=failed
```

View run details:

```bash
quantbot ohlcv runs-details <run-id>
```

Rollback a faulty run:

```bash
quantbot ohlcv runs-rollback <run-id>
```

Identify faulty runs:

```bash
quantbot ohlcv validate-duplicates
```

## Error Handling

The integration is designed to be resilient:

1. **Run tracking failures don't stop ingestion** - If run tracking fails to start, a warning is logged and ingestion continues
2. **Completion tracking failures are logged** - If completion tracking fails, a warning is logged but the result is still returned
3. **Failure tracking is best-effort** - If marking a run as failed fails, a warning is logged and the original error is re-thrown

This ensures that ingestion always works, even if the audit trail system has issues.

## Benefits

1. **Full Audit Trail**: Every run is traceable to exact git commit, script version, and input parameters
2. **Reproducibility**: Input hash allows detecting duplicate runs
3. **Debugging**: Failed runs include error messages and can be investigated
4. **Rollback**: Faulty runs can be identified and rolled back by run_id
5. **Quality Metrics**: Track error rates, zero-volume candles, and rejection rates per run

## Architecture Compliance

✅ **Separation of Concerns**: Run tracking is optional and doesn't affect core ingestion logic  
✅ **Dependency Direction**: Ingestion services depend on storage (correct direction)  
✅ **Error Handling**: Graceful degradation if tracking fails  
✅ **Type Safety**: Proper TypeScript types for all run tracking operations  

## Next Steps

1. **Enable deduplication modes**: Configure `dedupMode` in manifest (inline/post-batch/none)
2. **Add quality validation**: Track validation stats (zero-volume, invalid ranges)
3. **Implement scheduled sweeps**: Run periodic deduplication sweeps
4. **Add monitoring**: Alert on high error rates or failed runs
5. **Dashboard**: Build UI to visualize run history and quality metrics

## Files Modified

- `packages/jobs/src/ohlcv-ingestion-engine.ts` - Added run tracking methods
- `packages/ingestion/src/OhlcvIngestionService.ts` - Integrated run manifest creation and tracking
- `packages/storage/src/index.ts` - Already exports all required utilities

## Testing

To test the integration:

```bash
# Run a small ingestion
quantbot ingestion ohlcv --from 2024-01-01 --to 2024-01-02 --duckdb data/tele.duckdb

# Check run was tracked
quantbot ohlcv runs-list --limit=1

# View run details
quantbot ohlcv runs-details <run-id-from-above>
```

## References

- Original implementation: commit `0946a77`
- Integration: commit `<this-commit>`
- Plan: `.cursor/plans/ohlcv_deduplication_module_9f3b07c9.plan.md`
