# Next Steps - Slice Export & Analyze

## Immediate (This Week)

### 1. Test the ClickHouse Exporter ✅
**Goal:** Verify the exporter works with real data

```bash
# Create a simple test script
# Test with a small time range (1 day) and known tokens
```

**Action Items:**
- [ ] Create integration test that exports real `candles_1m` data
- [ ] Verify Parquet file is valid (can read with DuckDB)
- [ ] Verify manifest is correct (row counts, file paths)
- [ ] Test with empty result set (no data in time range)
- [ ] Test with token filter (specific tokenIds)

### 2. Implement Basic DuckDB Analyzer
**Goal:** Make the analyzer actually work (not just stub)

**Start simple:**
- [ ] Open DuckDB connection (in-memory or file)
- [ ] Attach Parquet files from manifest
- [ ] Execute simple SQL queries
- [ ] Return summary results

**Example queries to support:**
```sql
-- Count rows
SELECT COUNT(*) as total_rows FROM slice;

-- Basic stats per token
SELECT 
  token_address,
  COUNT(*) as candle_count,
  MIN(timestamp) as first_ts,
  MAX(timestamp) as last_ts,
  AVG(volume) as avg_volume
FROM slice
GROUP BY token_address;
```

### 3. Create CLI Command
**Goal:** Make it easy to use from command line

**Action Items:**
- [ ] Add command to `packages/cli/src/commands/`
- [ ] Wire handler in `packages/cli/src/handlers/`
- [ ] Support basic options:
  - `--dataset candles_1m`
  - `--chain sol`
  - `--from 2024-12-01`
  - `--to 2024-12-02`
  - `--tokens mint1,mint2` (optional)
  - `--output-dir ./slices`

## Short Term (Next 2 Weeks)

### 4. Add More Datasets
**Goal:** Support other data types you have

**Priority order:**
1. [ ] `alerts_1m` - If you have alerts in ClickHouse
2. [ ] `indicators_1m` - If you have indicators
3. [ ] `token_metadata` - Static/slow-changing data

**Implementation pattern:**
- Add dataset mapping in exporter
- Each dataset maps to a ClickHouse table
- Keep it simple: one dataset at a time

### 5. Improve Error Handling
**Goal:** Better error messages and recovery

**Action Items:**
- [ ] Handle ClickHouse connection errors gracefully
- [ ] Validate time ranges (start < end)
- [ ] Validate token addresses (length, format)
- [ ] Handle empty exports (no data found)
- [ ] Add retry logic for transient failures

### 6. Add Validation
**Goal:** Catch problems early

**Action Items:**
- [ ] Validate manifest against JSON schema
- [ ] Verify Parquet files are readable
- [ ] Check row counts match expectations
- [ ] Validate time ranges in exported data

## Medium Term (Next Month)

### 7. Support Multiple Parquet Files
**Goal:** Handle large exports that need splitting

**Action Items:**
- [ ] Implement file splitting by row count (`maxRowsPerFile`)
- [ ] Support partitioning by date/token
- [ ] Update manifest to list all files
- [ ] Test with large time ranges (1 week, 1 month)

### 8. Compression Options
**Goal:** Reduce file sizes

**Action Items:**
- [ ] Support different compression (snappy, zstd, gzip)
- [ ] Make compression configurable in layout spec
- [ ] Benchmark compression vs speed tradeoffs

### 9. Analysis Result Storage
**Goal:** Save analysis results for later use

**Action Items:**
- [ ] Support writing analysis results to Parquet/CSV
- [ ] Add result artifacts to manifest
- [ ] Optionally ingest summaries into ClickHouse

### 10. Incremental Exports
**Goal:** Export only new data since last export

**Action Items:**
- [ ] Track last export timestamp per dataset
- [ ] Support "since last export" mode
- [ ] Merge with previous exports if needed

## Long Term (Future)

### 11. S3/Cloud Storage Support
**Goal:** Store slices in cloud storage

**Action Items:**
- [ ] Support S3 URIs in `baseUri`
- [ ] Implement S3 file writer
- [ ] Handle credentials and regions

### 12. Named Analysis Plans
**Goal:** Reusable analysis queries

**Action Items:**
- [ ] Create plan registry
- [ ] Support parameterized plans
- [ ] Document common analysis patterns

### 13. Slice Comparison Tools
**Goal:** Compare exports between runs

**Action Items:**
- [ ] Diff two manifests
- [ ] Compare row counts
- [ ] Identify missing/extra data

## Testing Checklist

Before considering this "done", verify:

- [ ] Can export 1 day of `candles_1m` data
- [ ] Can read exported Parquet with DuckDB
- [ ] Can run simple analysis queries
- [ ] Manifest is valid JSON and matches schema
- [ ] Works with empty result sets
- [ ] Works with token filters
- [ ] Error messages are helpful
- [ ] CLI command works end-to-end

## Keep It Simple

Remember the principle: **Start boring, iterate fast.**

- One dataset at a time
- One feature at a time
- Test each step before moving on
- Don't optimize prematurely

The goal is a working pipeline, not a perfect one.

