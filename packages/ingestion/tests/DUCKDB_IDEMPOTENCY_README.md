# DuckDB Ingestion Idempotency Tests

## Overview

This test suite ensures DuckDB ingestion is:
- **Repeatable**: Same input → exact same row counts (no duplicates)
- **Safe**: Partial runs can be resumed without corruption
- **Concurrent-safe**: Multiple processes handle writes cleanly
- **Schema-aware**: Fails loudly on schema mismatches with actionable errors

## Test Matrix

### 1. Same Input Twice → No Duplicates

**Scenario**: Run ingestion with identical input file twice

**Expected**:
- First run: Creates rows
- Second run: Detects existing input (via `input_file_hash`) and either:
  - Skips (if already completed), OR
  - Completes idempotently (no duplicate rows)

**Verification**:
- Row counts identical between runs
- No duplicate `(chat_id, message_id, run_id)` tuples
- `ingestion_runs` table shows both runs

**Status**: ⏳ **Pending schema migration**

### 2. Partial Run → Rerun Repairs/Finishes

**Scenario**: Ingestion starts, process crashes mid-run, then rerun

**Expected**:
- First run: `ingestion_runs.status = 'partial'`
- Rerun: Deletes partial rows for that `run_id`, re-inserts, completes
- Final state: All data present, no duplicates, consistent state

**Verification**:
- `ingestion_runs.status` transitions: `running` → `partial` → `completed`
- Row counts match expected (no missing data)
- No orphaned rows

**Status**: ⏳ **Pending implementation**

### 3. Concurrent Writes → Clean Failure

**Scenario**: Two processes attempt to write simultaneously

**Expected**:
- First process: Acquires lock, writes successfully
- Second process: Gets lock error after timeout (30s max)
- Error message: Clear, actionable (database path, suggestion to wait/retry)
- No silent corruption

**Verification**:
- Lock file created/released correctly
- Error includes database path
- No partial writes from second process

**Status**: ⏳ **Pending locking implementation**

### 4. Schema Mismatch → Actionable Error

**Scenario**: Old DB (v1 schema), new code (v5 schema)

**Expected**:
- Error detected before any writes
- Error message includes:
  - Current schema version
  - Required schema version
  - Migration command: `python tools/telegram/migrate_schema_idempotent.py --duckdb <path>`

**Verification**:
- No partial writes on schema mismatch
- Error is thrown early (before data insertion)
- Migration script works correctly

**Status**: ⏳ **Pending schema versioning**

## Current State Analysis

### Schema Issues

**Current** (before migration):
- ❌ No PRIMARY KEYs → duplicates allowed
- ❌ No `run_id` tracking → can't identify which run inserted rows
- ❌ No `ingestion_runs` table → can't track runs
- ❌ No idempotency → same input creates duplicates

**After Migration**:
- ✅ PRIMARY KEYs on all tables → prevents duplicates per run
- ✅ `run_id` column → tracks which run inserted rows
- ✅ `ingestion_runs` table → tracks run status and input hash
- ✅ Idempotent inserts → `INSERT OR IGNORE` prevents duplicates

### Python Script Changes Needed

1. **Generate run_id**: Deterministic from input file hash + chat_id + timestamp
2. **Check existing run**: Query `ingestion_runs` by `input_file_hash`
3. **Start run**: Insert into `ingestion_runs` with status='running'
4. **Idempotent inserts**: Use `INSERT OR IGNORE` with `run_id`
5. **Complete run**: Update `ingestion_runs` with status='completed' and row counts
6. **Handle partial**: Delete rows for partial `run_id`, resume

### Migration Path

1. **Run migration script**:
   ```bash
   python tools/telegram/migrate_schema_idempotent.py --duckdb path/to/db.duckdb
   ```

2. **Update Python script** (`duckdb_punch_pipeline.py`):
   - Add run_id generation
   - Add idempotency checks
   - Use `INSERT OR IGNORE` with run_id
   - Track runs in `ingestion_runs` table

3. **Test**:
   ```bash
   npm test -- duckdb-idempotency
   ```

## Running Tests

```bash
# Run all idempotency tests
cd packages/ingestion
npm test -- duckdb-idempotency

# Run specific test
npm test -- duckdb-idempotency -t "same input twice"
```

## Test Fixtures

Tests use minimal Telegram JSON fixture:
- 3 messages (2 user, 1 bot reply)
- 1 address candidate
- Small enough for fast tests, realistic enough to catch issues

## Exit Criteria

✅ All tests pass:
- [ ] Same input twice → no duplicates
- [ ] Partial run → rerun completes successfully
- [ ] Concurrent writes → clean failure
- [ ] Schema mismatch → actionable error

✅ Schema migration works:
- [ ] Existing databases migrate cleanly
- [ ] No data loss during migration
- [ ] Backward compatible (legacy run_id='legacy')

✅ Python script updated:
- [ ] Generates run_id
- [ ] Checks for existing runs
- [ ] Uses idempotent inserts
- [ ] Tracks runs in ingestion_runs

## Next Steps

1. **Run migration on test database**
2. **Update `duckdb_punch_pipeline.py`** with idempotency logic
3. **Implement locking** for concurrent writes
4. **Add schema version checks** to Python script
5. **Run full test suite** and verify all scenarios

## Related Documentation

- `DUCKDB_IDEMPOTENCY_SCHEMA.md` - Detailed schema design
- `tools/telegram/duckdb_schema_idempotent.sql` - Enhanced schema SQL
- `tools/telegram/migrate_schema_idempotent.py` - Migration script

