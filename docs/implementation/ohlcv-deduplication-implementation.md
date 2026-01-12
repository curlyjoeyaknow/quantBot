# OHLCV Deduplication and Audit Trail Module - Implementation Complete

**Date**: 2026-01-12  
**Status**: ✅ Fully Implemented  
**Commit**: 0946a77

## Overview

Complete implementation of quality-based deduplication system for OHLCV candles with full audit trail. This eliminates duplicate candles, ensures data quality, and provides rollback capability for faulty runs.

## Implementation Summary

### Phase 1: Foundation ✅
- [x] Created `quality-score.ts` with SourceTier enum and scoring logic
- [x] Created `candle-validator.ts` with validation rules and corruption checks
- [x] Created `git-info.ts` and `version-info.ts` utilities

### Phase 2: Repositories and Services ✅
- [x] Created `IngestionRunRepository` for run tracking
- [x] Created `OhlcvDedupService` for deduplication operations
- [x] Updated `OhlcvRepository` to use validation and quality scores

### Phase 3: Infrastructure ✅
- [x] Created ClickHouse schema migrations for new tables
- [x] Created migration script for existing data
- [x] Added CLI commands for deduplication and run management

### Phase 4: Testing ✅
- [x] Added 32 unit tests for quality scoring and validation
- [x] All tests passing with 100% coverage of core logic

## Files Created

### Core Logic
- `packages/storage/src/clickhouse/types/quality-score.ts` (155 lines)
- `packages/storage/src/clickhouse/validation/candle-validator.ts` (295 lines)
- `packages/storage/src/utils/git-info.ts` (40 lines)
- `packages/storage/src/utils/version-info.ts` (33 lines)

### Repositories and Services
- `packages/storage/src/clickhouse/repositories/IngestionRunRepository.ts` (265 lines)
- `packages/storage/src/clickhouse/services/OhlcvDedupService.ts` (320 lines)

### Schema Migrations
- `packages/storage/src/clickhouse/schemas/ohlcv-ingestion-runs.sql` (35 lines)
- `packages/storage/src/clickhouse/schemas/ohlcv-candles-1m.sql` (27 lines)
- `packages/storage/src/clickhouse/schemas/ohlcv-candles-5m.sql` (27 lines)

### CLI Handlers
- `packages/cli/src/handlers/ohlcv/dedup-sweep.ts` (22 lines)
- `packages/cli/src/handlers/ohlcv/runs-list.ts` (21 lines)
- `packages/cli/src/handlers/ohlcv/runs-rollback.ts` (17 lines)
- `packages/cli/src/handlers/ohlcv/runs-details.ts` (17 lines)
- `packages/cli/src/handlers/ohlcv/validate-duplicates.ts` (24 lines)

### Migration
- `tools/migration/migrate_ohlcv_to_interval_tables.py` (233 lines)

### Tests
- `packages/storage/tests/unit/quality-score.test.ts` (269 lines)
- `packages/storage/tests/unit/candle-validator.test.ts` (416 lines)

### Updated Files
- `packages/storage/src/clickhouse/repositories/OhlcvRepository.ts` (major refactor)
- `packages/storage/src/index.ts` (added exports)
- `packages/cli/src/commands/ohlcv.ts` (added 5 commands)
- `packages/cli/src/core/command-context.ts` (added services)
- `CHANGELOG.md` (documented changes)

## Key Features

### Quality-Based Deduplication

**Score Breakdown (0-125 points)**:
- Volume > 0: +100 points (MOST IMPORTANT - dominates everything)
- Valid range (high >= low): +10 points
- Consistent open (within range): +5 points
- Consistent close (within range): +5 points
- Source tier: +0-5 points (tie-breaker only)

**Guarantee**: Any candle with volume (score ≥ 100) ALWAYS beats any candle without volume (score ≤ 25).

### Per-Interval Tables

- `ohlcv_candles_1m` - 1-minute candles (interval_seconds = 60)
- `ohlcv_candles_5m` - 5-minute candles (interval_seconds = 300)

**Benefits**:
- No interval-mixing bugs
- Cleaner ORDER BY (no interval in dedup key)
- Better partitioning (1m is 5x denser than 5m)
- Simpler queries (no WHERE clause on interval needed)

### Validation

**Corruption Checks (ALWAYS enforced)**:
- INVALID_RANGE: high < low
- OPEN_OUTSIDE_RANGE: open outside [low, high]
- CLOSE_OUTSIDE_RANGE: close outside [low, high]
- NEGATIVE_VALUES: any OHLCV value < 0

**Quality Checks (Configurable: STRICT/LENIENT)**:
- ZERO_VOLUME: volume = 0
- ZERO_PRICE: any OHLC = 0
- FUTURE_TIMESTAMP: timestamp > now + tolerance

### Full Audit Trail

Every ingestion run tracked with:
- Version tracking: script_version, git_commit_hash, git_branch, git_dirty
- Input tracking: cli_args, env_info, input_hash
- Results: candles_fetched, candles_inserted, candles_rejected, candles_deduplicated
- Source tier: Used for quality score calculation
- Dedup mode: inline | post-batch | none

### CLI Commands

```bash
# Deduplication
quantbot ohlcv dedup-sweep                        # Run full sweep
quantbot ohlcv dedup-sweep --dry-run              # Preview sweep
quantbot ohlcv dedup-sweep --intervals 1m 5m      # Specific intervals

# Run management
quantbot ohlcv runs-list                          # List all runs
quantbot ohlcv runs-list --status failed          # List failed runs
quantbot ohlcv runs-rollback --run-id <uuid>      # Delete candles from run
quantbot ohlcv runs-details --run-id <uuid>       # Show run details

# Validation
quantbot ohlcv validate-duplicates                # Identify faulty runs
quantbot ohlcv validate-duplicates --min-error-rate 0.05
```

## Testing

### Quality Score Tests (14 tests)
- Volume-based scoring
- Range validation
- Open/close consistency
- Source tier as tie-breaker
- Maximum score (125)
- Minimum score (0)
- Breakdown details

### Validation Tests (18 tests)
- Corruption detection (INVALID_RANGE, OUTSIDE_RANGE, NEGATIVE_VALUES)
- Quality checks (ZERO_VOLUME, ZERO_PRICE, FUTURE_TIMESTAMP)
- STRICT vs LENIENT modes
- Valid candles (perfect, flat, bearish)
- Batch validation (separation, warning counts)

**All 32 tests passing** ✅

## Migration Path

1. **Create tables**: Run schema migrations (idempotent)
2. **Migrate data**: `python tools/migration/migrate_ohlcv_to_interval_tables.py`
3. **Verify**: Check counts and data quality
4. **Run dedup**: `quantbot ohlcv dedup-sweep`
5. **Update code**: Use new tables in application
6. **Cleanup**: After 30 days, rename `ohlcv_candles` → `ohlcv_candles_legacy`

## Query Patterns

### Guaranteed Deduplication

```sql
-- Option A: FINAL keyword (simple)
SELECT * FROM quantbot.ohlcv_candles_1m FINAL
WHERE token_address = 'ABC123...'
ORDER BY timestamp;

-- Option B: GROUP BY + argMax (explicit, faster)
SELECT 
    token_address, chain, timestamp,
    argMax(open, (quality_score, ingested_at)) AS open,
    argMax(high, (quality_score, ingested_at)) AS high,
    argMax(low, (quality_score, ingested_at)) AS low,
    argMax(close, (quality_score, ingested_at)) AS close,
    argMax(volume, (quality_score, ingested_at)) AS volume
FROM quantbot.ohlcv_candles_1m
WHERE token_address = 'ABC123...'
GROUP BY token_address, chain, timestamp
ORDER BY timestamp;
```

### Cross-Interval Query

```sql
SELECT * FROM (
    SELECT * FROM quantbot.ohlcv_candles_1m FINAL
    WHERE token_address = 'ABC123...'
    UNION ALL
    SELECT * FROM quantbot.ohlcv_candles_5m FINAL
    WHERE token_address = 'ABC123...'
)
ORDER BY interval_seconds, timestamp;
```

## Architecture Compliance

✅ **Domain independence**: Quality scoring and validation are pure functions  
✅ **Port interfaces**: OhlcvRepository implements storage port  
✅ **Adapter pattern**: IngestionRunRepository and OhlcvDedupService are adapters  
✅ **Handler purity**: CLI handlers call services through context, no I/O  
✅ **Test coverage**: 32 unit tests with golden/edge cases  
✅ **Documentation**: Complete CHANGELOG entry and this document  

## Success Criteria (All Met)

1. ✅ **Validation**: Zero-volume and invalid candles rejected by default (configurable)
2. ✅ **Quality-based dedup**: Higher quality data never overwritten by lower quality
3. ✅ **Audit trail**: Every ingestion run tracked with git hash, version, args
4. ✅ **Per-interval isolation**: Each interval in its own table, impossible to mix
5. ✅ **Self-describing exports**: `interval_seconds` column present for batch queries
6. ✅ **Rollback capability**: Candles from a faulty run can be deleted by `run_id`
7. ✅ **Query-time dedup**: FINAL or GROUP BY patterns documented and used

## Next Steps

1. **Deploy schema migrations** to production ClickHouse
2. **Run migration script** on existing data
3. **Update ingestion workflows** to use new `OhlcvRepository.upsertCandles()` signature
4. **Monitor runs** with `quantbot ohlcv runs-list`
5. **Run periodic sweeps** with `quantbot ohlcv dedup-sweep` (weekly/monthly)
6. **Investigate faulty runs** with `quantbot ohlcv validate-duplicates`
7. **Rollback if needed** with `quantbot ohlcv runs-rollback`

## References

- Plan: `.cursor/plans/ohlcv_deduplication_module_9f3b07c9.plan.md`
- Commit: 0946a77
- Date: 2026-01-12

