# DuckDB Connection Migration Status

**Last Updated**: 2025-01-08  
**Purpose**: Track migration of direct `duckdb.connect()` calls to adapter functions

## Migration Pattern

### ✅ Completed Infrastructure

1. **Python Adapter** (`tools/shared/duckdb_adapter.py`)
   - ✅ All connections set `PRAGMA busy_timeout=10000`
   - ✅ `get_readonly_connection()` - for reads
   - ✅ `get_write_connection()` - for writes
   - ✅ Context manager pattern ensures cleanup

2. **Python Direct SQL** (`tools/storage/duckdb_direct_sql.py`)
   - ✅ All connections set `PRAGMA busy_timeout=10000`
   - ✅ Queries use `read_only=True` by default

3. **TypeScript Clients**
   - ✅ `packages/storage/src/adapters/duckdb/duckdbClient.ts` - sets busy_timeout
   - ✅ `packages/infra/src/storage/adapters/duckdb/duckdbClient.ts` - sets busy_timeout

### ✅ Migrated Files

1. **tools/telegram/duckdb_punch_pipeline.py** (Writer - ingestion pipeline)
   - ✅ Migrated to use `get_write_connection()`
   - ✅ Refactored to use context manager properly
   - ✅ Maintains custom PRAGMAs (threads, memory_limit)

2. **tools/storage/duckdb_strategies.py**
   - ✅ `safe_connect()` now uses adapter internally
   - ⚠️ Still returns connection (breaks context manager pattern) - kept for backward compatibility

3. **tools/backtest/lib/trial_ledger.py** (Partial)
   - ✅ `ensure_trial_schema()` - uses `get_write_connection()`
   - ✅ `list_runs()` - uses `get_readonly_connection()`
   - ⏳ Remaining functions still use direct `duckdb.connect()` (20+ functions)

### ⏳ Pending Migration

#### High Priority (Writers)

- `tools/backtest/lib/trial_ledger.py` - Remaining writer functions:
  - `store_optimizer_run()`
  - `store_walk_forward_run()`
  - `store_phase_start()`
  - `store_phase_complete()`
  - `store_phase_failed()`
  - `store_islands()`
  - `store_island_champions()`
  - `store_stress_lane_result()`

- `tools/storage/duckdb_*.py` files:
  - `duckdb_callers.py`
  - `duckdb_token_data.py`
  - `duckdb_errors.py`
  - `duckdb_simulation_runs.py`
  - `duckdb_run_events.py`
  - `duckdb_artifacts.py`
  - `duckdb_experiments.py`

#### Medium Priority (Readers)

- `tools/backtest/lib/trial_ledger.py` - Reader functions:
  - `get_best_trials()`
  - `get_walk_forward_summary()`
  - `get_phase_status()`
  - `get_run_phases()`
  - `load_islands()`
  - `load_island_champions()`
  - And others...

- Query/analysis tools:
  - `tools/backtest/query_duckdb.py` (already uses read_only, but could use adapter)
  - `tools/backtest/backtest_queries.py`
  - `tools/analysis/ohlcv_caller_coverage.py`
  - `tools/analysis/ohlcv_detailed_coverage.py`

#### Low Priority (Tests/Utilities)

- Test files in `tools/backtest/tests/`
- Test fixtures
- Utility scripts

## Migration Checklist

When migrating a file:

- [ ] Identify if it's a reader or writer
- [ ] Replace `duckdb.connect(db_path)` with:
  - `get_readonly_connection(db_path)` for reads
  - `get_write_connection(db_path)` for writes
- [ ] Use context manager pattern (`with` statement)
- [ ] Remove manual `con.close()` calls (context manager handles it)
- [ ] Remove manual `PRAGMA busy_timeout` (adapter sets it automatically)
- [ ] Keep custom PRAGMAs if needed (threads, memory_limit, etc.)
- [ ] Test the migration

## Example Migrations

### Writer Function

**Before:**
```python
def store_data(db_path: str, data: dict):
    con = duckdb.connect(db_path)
    try:
        con.execute("INSERT INTO table VALUES (?)", [data])
    finally:
        con.close()
```

**After:**
```python
from tools.shared.duckdb_adapter import get_write_connection

def store_data(db_path: str, data: dict):
    with get_write_connection(db_path) as con:
        con.execute("INSERT INTO table VALUES (?)", [data])
```

### Reader Function

**Before:**
```python
def get_data(db_path: str):
    con = duckdb.connect(db_path, read_only=True)
    try:
        return con.execute("SELECT * FROM table").fetchall()
    finally:
        con.close()
```

**After:**
```python
from tools.shared.duckdb_adapter import get_readonly_connection

def get_data(db_path: str):
    with get_readonly_connection(db_path) as con:
        return con.execute("SELECT * FROM table").fetchall()
```

## Benefits

✅ **Automatic busy_timeout** - No more transient lock failures  
✅ **Read-only safety** - Readers can't accidentally lock the database  
✅ **Proper cleanup** - Context managers ensure connections are closed  
✅ **Consistent pattern** - All code follows the same connection pattern  
✅ **Better error handling** - Adapter handles empty/invalid files  

## Notes

- The adapter automatically sets `PRAGMA busy_timeout=10000` on all connections
- Custom PRAGMAs (like `threads`, `memory_limit`) should still be set after getting the connection
- In-memory databases (`:memory:`) don't use read-only mode (DuckDB limitation)
- The `safe_connect()` function in storage files is deprecated but kept for backward compatibility

