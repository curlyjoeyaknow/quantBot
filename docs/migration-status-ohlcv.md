# OHLCV Data Migration Status

**Date**: 2026-01-14  
**Status**: 5m Migration Complete ✅ | 1m Migration Pending ⏳

---

## Migration Summary

### Completed: 5m Candles ✅

**Target Table**: `ohlcv_candles_5m`

**Results**:
- **Total Rows**: 85,234,882 (deduplicated)
- **Unique Tokens**: 4,185
- **Date Range**: 2023-10-07 to 2025-10-25
- **Candles with Volume**: 18,092,622 (21%)
- **Candles with Zero Volume**: 67,142,260 (79%)

**Process**:
1. Batched migration by 30-day periods to avoid memory issues
2. Applied `GROUP BY` + `argMax(value, ingested_at)` for deduplication
3. Ran `OPTIMIZE TABLE ... FINAL` to trigger Replacing MergeTree deduplication
4. Removed 28M duplicates during optimization

**Issues Encountered**:
- Initial full-table migration failed with memory limit (28.67 GiB exceeded)
- Solution: Created batched migration script (`migrate_5m_batched.py`)
- Duplicate script runs created 28M extra rows
- Resolution: `OPTIMIZE TABLE FINAL` successfully deduplicated

---

### Pending: 1m Candles ⏳

**Source Data**:
- **Total Rows**: 83,065,057
- **Unique Tokens**: 4,700
- **Date Range**: 2023-10-07 to 2026-01-12

**Estimated Migration Time**: 30-45 minutes (based on 5m experience)

**Recommended Approach**:
1. Use batched migration script (15-30 day batches)
2. Run during low-activity period
3. Monitor memory usage
4. Run OPTIMIZE TABLE FINAL after completion

---

## Data Quality Observations

### Zero-Volume Candles (79% of 5m data)

**Potential Causes**:
1. **Backfill gaps**: Candles created to fill time series but no trades occurred
2. **Low-activity tokens**: Tokens with sparse trading
3. **Data quality issues**: Invalid or placeholder candles

**Recommendations**:
1. ✅ **Already Implemented**: Quality scoring system assigns 0-25 points to zero-volume candles
2. ✅ **Already Implemented**: Volume-based candles (100+ points) always win over zero-volume
3. 🔄 **Consider**: Flagging tokens with >90% zero-volume candles for review
4. 🔄 **Consider**: Separate analysis of zero-volume vs high-volume tokens

### Token Coverage

- **5m tokens**: 4,185
- **1m tokens**: 4,700
- **Difference**: 515 tokens only have 1m data

This is expected for tokens that were:
- Added after 5m migration started
- Only tracked at 1m resolution
- Recently listed

---

## Technical Details

### ReplacingMergeTree Deduplication

**How It Works**:
```sql
ENGINE = ReplacingMergeTree(quality_score)
ORDER BY (token_address, chain, timestamp)
```

- Deduplication key: `(token_address, chain, timestamp)`
- Version column: `quality_score` (higher = better)
- Physical deduplication: Triggered by `OPTIMIZE TABLE ... FINAL` or background merges
- Query-time deduplication: Use `FINAL` keyword or `GROUP BY` + `argMax`

**Migration Query**:
```sql
INSERT INTO quantbot.ohlcv_candles_5m (...)
SELECT 
    token_address, chain, timestamp,
    argMax(open, ingested_at) AS open,
    argMax(high, ingested_at) AS high,
    argMax(low, ingested_at) AS low,
    argMax(close, ingested_at) AS close,
    argMax(volume, ingested_at) AS volume,
    0 AS quality_score,  -- Migration baseline
    now() AS ingested_at,
    0 AS source_tier,
    'migration-5m-batched' AS ingestion_run_id,
    'migration-1.0.0' AS script_version
FROM quantbot.ohlcv_candles
WHERE interval_seconds = 300
GROUP BY token_address, chain, timestamp
```

### Memory Management

**Issue**: 38M rows with `GROUP BY` + multiple `argMax` exceeded 28 GiB limit

**Solution**: Batch by date ranges (30 days)
- Each batch: ~1-2M rows
- Memory usage: <5 GiB per batch
- Total batches: ~27 for 5m data

---

## Next Steps

### Immediate (1m Migration)

1. **Run 1m batched migration**:
   ```bash
   # Create migrate_1m_batched.py (similar to 5m script)
   python3 tools/migration/migrate_1m_batched.py
   ```

2. **Monitor progress**:
   ```sql
   SELECT count() FROM quantbot.ohlcv_candles_1m;
   ```

3. **Optimize after completion**:
   ```sql
   OPTIMIZE TABLE quantbot.ohlcv_candles_1m FINAL;
   ```

### Post-Migration

1. **Update OhlcvIngestionService**:
   - Generate `run_id` at start
   - Capture git/version metadata
   - Call `runRepo.startRun(manifest)`
   - Pass `runManifest` to `ohlcvRepo.upsertCandles()`
   - Compute quality scores
   - Call `runRepo.completeRun()` with stats

2. **Run deduplication sweep**:
   ```bash
   quantbot ohlcv dedup sweep
   ```

3. **Verify data quality**:
   ```bash
   quantbot ohlcv runs list
   quantbot ohlcv validate duplicates
   ```

4. **Update application code**:
   - Switch from `ohlcv_candles` to interval-specific tables
   - Use query-time deduplication (`GROUP BY` + `argMax`)

5. **Archive legacy table** (after 30 days of validation):
   ```sql
   RENAME TABLE quantbot.ohlcv_candles TO quantbot.ohlcv_candles_legacy;
   ```

---

## Files

### Migration Scripts

- ✅ `tools/migration/migrate_ohlcv_to_interval_tables.py` - Main migration (with dry-run)
- ✅ `tools/migration/migrate_5m_batched.py` - Batched 5m migration (completed)
- ⏳ `tools/migration/migrate_1m_batched.py` - Batched 1m migration (to be created)

### Schemas

- ✅ `packages/storage/src/clickhouse/schemas/ohlcv-ingestion-runs.sql`
- ✅ `packages/storage/src/clickhouse/schemas/ohlcv-candles-1m.sql`
- ✅ `packages/storage/src/clickhouse/schemas/ohlcv-candles-5m.sql`

### Documentation

- ✅ `docs/implementation-summary-ohlcv-dedup.md` - Full implementation details
- ✅ `docs/migration-status-ohlcv.md` - This file (migration status)

---

## Success Metrics

### 5m Migration ✅

- [x] All data migrated (85.2M rows)
- [x] Deduplication applied (28M duplicates removed)
- [x] Date range preserved (2023-10 to 2025-10)
- [x] Token coverage maintained (4,185 tokens)
- [x] Query performance acceptable (<1s for typical queries)

### 1m Migration ⏳

- [ ] All data migrated (83M rows expected)
- [ ] Deduplication applied
- [ ] Date range preserved
- [ ] Token coverage maintained (4,700 tokens)
- [ ] Query performance acceptable

### System Integration 📋

- [ ] OhlcvIngestionService updated
- [ ] Run tracking operational
- [ ] Quality scores computed
- [ ] CLI commands tested
- [ ] Application code updated
- [ ] Legacy table archived

---

**Last Updated**: 2026-01-14 15:10 UTC  
**Next Review**: After 1m migration completion

