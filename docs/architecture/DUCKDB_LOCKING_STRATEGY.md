# DuckDB Locking Strategy

**Status**: ✅ IMPLEMENTED  
**Date**: 2025-01-08  
**Purpose**: Prevent database locking issues through structural fixes

## Problem

DuckDB uses file-level locking:
- **Read operations**: Multiple readers allowed
- **Write operations**: Exclusive lock required

When multiple processes try to write simultaneously, or when readers/writers overlap, we get lock conflicts that cause failures.

## Solution: Three Structural Rules

### Rule 1: One Writer Process, Always

**Writer service: the only process that opens the DB in write mode.**

Everyone else: READ_ONLY connections (or query Parquet).

#### Implementation

**Python (preferred for read-only):**
```python
from tools.shared.duckdb_adapter import get_readonly_connection, get_write_connection

# For reads (default, safe for concurrent access)
with get_readonly_connection("data/alerts.duckdb") as con:
    result = con.execute("SELECT * FROM table").fetchall()

# For writes (use sparingly, only at end of runs)
with get_write_connection("data/alerts.duckdb") as con:
    con.execute("INSERT INTO table VALUES (...)")
```

**TypeScript:**
```typescript
import { openDuckDb } from '@quantbot/storage';

// All connections now have busy_timeout=10000 automatically
const conn = await openDuckDb(dbPath, { readOnly: true }); // For reads
const conn = await openDuckDb(dbPath); // For writes (only one writer!)
```

**Direct Python (when adapter not available):**
```python
import duckdb

# Always set busy_timeout
con = duckdb.connect(db_path, read_only=True)  # For reads
con.execute("PRAGMA busy_timeout=10000")

# For writes (only one writer!)
con = duckdb.connect(db_path, read_only=False)
con.execute("PRAGMA busy_timeout=10000")
```

### Rule 2: Add Busy Timeout

**In every connection (writer and reader), set:**

```sql
PRAGMA busy_timeout=10000; -- 10 seconds
```

This won't solve "two writers forever", but it fixes the annoying "tiny overlap" locks.

#### Implementation Status

✅ **Python adapter** (`tools/shared/duckdb_adapter.py`):
- All connections automatically set `PRAGMA busy_timeout=10000`
- `get_readonly_connection()` - read-only with timeout
- `get_write_connection()` - write with timeout

✅ **Python direct SQL** (`tools/storage/duckdb_direct_sql.py`):
- All connections automatically set `PRAGMA busy_timeout=10000`
- Queries use read-only mode by default

✅ **TypeScript client** (`packages/storage/src/adapters/duckdb/duckdbClient.ts`):
- All connections automatically set `PRAGMA busy_timeout=10000`
- Supports `readOnly` option (though Node.js bindings may not fully support it)

### Rule 3: Keep Transactions Tiny

**Do batch inserts and commit quickly. Don't hold a transaction while you do other work.**

#### Best Practices

```python
# ✅ GOOD: Batch insert, commit quickly
with get_write_connection(db_path) as con:
    con.executemany("INSERT INTO table VALUES (?)", batch)
    # Transaction commits automatically on context exit

# ❌ BAD: Hold transaction while doing other work
with get_write_connection(db_path) as con:
    con.execute("BEGIN TRANSACTION")
    # ... do other work (network calls, file I/O, etc.) ...
    con.execute("INSERT INTO table VALUES (?)")
    con.execute("COMMIT")
```

## Database Splitting Strategy

### When to Split

If "runs/results/ledgers" are being appended constantly, splitting can reduce lock collisions and mental load.

### Recommended Pattern

```
data/core.duckdb     # Canonical tables / stable views
data/runs.duckdb     # Optimizer runs, trial ledger, metrics (append-heavy)
data/cache.duckdb    # Temporary scratch stuff (optional)
```

### Unified Queries

When you need to query across databases:

```sql
ATTACH 'data/runs.duckdb' AS runs;

-- Query across databases
SELECT * FROM core.caller_links_d c
JOIN runs.optimizer_trials t ON c.mint = t.mint;
```

### Benefits

- ✅ Far fewer "random writer" collisions
- ✅ Cleaner lifecycle (you can archive/rotate runs DB)
- ✅ Faster backups (runs DB can be chunked)
- ⚠️ Still doesn't allow multiple writers per DB file (just reduces contention)

## Parquet Staging Pattern (Future)

**"This will never lock me again" workflow:**

1. Everything writes to Parquet staging first (cheap, no locks)
2. Single writer process periodically ingests staged Parquet into DuckDB
3. Analysts / scripts query Parquet directly or use DuckDB read-only

This is basically "mini data lake" and fits the architecture vibe.

### Implementation Sketch

```python
# Writer process (runs periodically)
def ingest_parquet_to_duckdb():
    with get_write_connection("data/core.duckdb") as con:
        # Ingest all staged Parquet files
        con.execute("""
            INSERT INTO caller_links_d
            SELECT * FROM read_parquet('staging/caller_links_*.parquet')
        """)

# Reader processes (can run concurrently)
def query_data():
    # Option 1: Query Parquet directly (no locks)
    with get_readonly_connection("data/core.duckdb") as con:
        result = con.execute("SELECT * FROM caller_links_d").fetchall()
    
    # Option 2: Query Parquet files directly (no DB needed)
    # (DuckDB can read Parquet natively)
```

## Migration Checklist

When updating existing code:

- [ ] Replace direct `duckdb.connect()` with `get_readonly_connection()` or `get_write_connection()`
- [ ] Ensure all connections set `PRAGMA busy_timeout=10000`
- [ ] Use read-only mode for all queries
- [ ] Use write mode only when necessary (and ensure only one writer)
- [ ] Keep transactions small (batch inserts, commit quickly)
- [ ] Consider database splitting for append-heavy workloads

## Enforcement

### Code Review Checklist

- [ ] All DuckDB connections use adapter functions (`get_readonly_connection`, `get_write_connection`, `openDuckDb`)
- [ ] All connections have `busy_timeout=10000` set
- [ ] Read operations use read-only mode
- [ ] Only one writer process per database file
- [ ] Transactions are kept small (no long-running work inside transactions)

### Testing

- [ ] Test concurrent read operations (should work)
- [ ] Test single writer (should work)
- [ ] Test two writers (should fail gracefully with timeout)
- [ ] Test reader + writer overlap (should work with timeout)

## Related Documentation

- `tools/shared/duckdb_adapter.py` - Python adapter implementation
- `packages/storage/src/adapters/duckdb/duckdbClient.ts` - TypeScript client
- `tools/storage/duckdb_direct_sql.py` - Direct SQL execution script

