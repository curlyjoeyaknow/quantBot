# DuckDB Idempotency Schema Design

## Current State

**Tables without PRIMARY KEYs or UNIQUE constraints:**
- `tg_norm_d` - No constraints, allows duplicates
- `caller_links_d` - No constraints, allows duplicates  
- `user_calls_d` - No constraints, allows duplicates

**Problems:**
1. Same input run twice → creates duplicate rows
2. No run tracking → can't identify which run inserted which rows
3. No idempotency → partial runs can't be safely resumed
4. No concurrency control → concurrent writes can corrupt data

## Enhanced Schema

### 1. Ingestion Runs Table

```sql
CREATE TABLE IF NOT EXISTS ingestion_runs (
  run_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  input_file_path TEXT NOT NULL,
  input_file_hash TEXT NOT NULL,  -- SHA256 hash of input file
  status TEXT NOT NULL,  -- 'running', 'completed', 'failed', 'partial'
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  rows_inserted_tg_norm INTEGER DEFAULT 0,
  rows_inserted_caller_links INTEGER DEFAULT 0,
  rows_inserted_user_calls INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_chat_id ON ingestion_runs(chat_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_input_hash ON ingestion_runs(input_file_hash);
```

**Purpose:**
- Track each ingestion run
- Enable idempotency checks (same input_file_hash = skip or resume)
- Enable partial run detection and repair

### 2. Enhanced tg_norm_d Table

```sql
CREATE TABLE IF NOT EXISTS tg_norm_d (
  chat_id TEXT NOT NULL,
  chat_name TEXT,
  message_id BIGINT NOT NULL,
  ts_ms BIGINT,
  from_name TEXT,
  from_id TEXT,
  type TEXT,
  is_service BOOLEAN,
  reply_to_message_id BIGINT,
  text TEXT,
  links_json TEXT,
  norm_json TEXT,
  run_id TEXT NOT NULL,  -- NEW: Track which run inserted this row
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, run_id)  -- NEW: Prevent duplicates per run
);

CREATE INDEX IF NOT EXISTS idx_tg_norm_run_id ON tg_norm_d(run_id);
CREATE INDEX IF NOT EXISTS idx_tg_norm_chat_message ON tg_norm_d(chat_id, message_id);
```

**Key Changes:**
- Added `run_id` column
- Added `PRIMARY KEY (chat_id, message_id, run_id)` to prevent duplicates per run
- Added `inserted_at` for audit trail

**Idempotency Strategy:**
- Use `INSERT OR IGNORE` or `INSERT ... ON CONFLICT DO NOTHING`
- Check `ingestion_runs` table: if `input_file_hash` exists and status='completed', skip
- If status='partial', delete rows for that run_id and re-insert

### 3. Enhanced caller_links_d Table

```sql
CREATE TABLE IF NOT EXISTS caller_links_d (
  trigger_chat_id TEXT NOT NULL,
  trigger_message_id BIGINT NOT NULL,
  trigger_ts_ms BIGINT,
  trigger_from_id TEXT,
  trigger_from_name TEXT,
  trigger_text TEXT,
  bot_message_id BIGINT NOT NULL,
  bot_ts_ms BIGINT,
  bot_from_name TEXT,
  bot_type TEXT,
  token_name TEXT,
  ticker TEXT,
  mint TEXT,
  mint_raw TEXT,
  mint_validation_status TEXT,
  mint_validation_reason TEXT,
  chain TEXT,
  platform TEXT,
  -- ... (all other fields)
  run_id TEXT NOT NULL,  -- NEW: Track which run inserted this row
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trigger_chat_id, trigger_message_id, bot_message_id, run_id)  -- NEW
);

CREATE INDEX IF NOT EXISTS idx_caller_links_run_id ON caller_links_d(run_id);
CREATE INDEX IF NOT EXISTS idx_caller_links_mint ON caller_links_d(mint);
```

**Key Changes:**
- Added `run_id` column
- Added composite PRIMARY KEY to prevent duplicates per run

### 4. Enhanced user_calls_d Table

```sql
CREATE TABLE IF NOT EXISTS user_calls_d (
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  call_ts_ms BIGINT,
  call_datetime TIMESTAMP,
  caller_name TEXT,
  caller_id TEXT,
  trigger_text TEXT,
  bot_reply_id_1 BIGINT,
  bot_reply_id_2 BIGINT,
  mint TEXT,
  ticker TEXT,
  mcap_usd DOUBLE,
  price_usd DOUBLE,
  first_caller BOOLEAN DEFAULT FALSE,
  run_id TEXT NOT NULL,  -- NEW: Track which run inserted this row
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, message_id, run_id)  -- NEW
);

CREATE INDEX IF NOT EXISTS idx_user_calls_run_id ON user_calls_d(run_id);
CREATE INDEX IF NOT EXISTS idx_user_calls_mint ON user_calls_d(mint);
```

**Key Changes:**
- Added `run_id` column
- Added composite PRIMARY KEY to prevent duplicates per run

## Idempotency Implementation

### Python Script Changes

**1. Generate run_id:**
```python
import hashlib
import uuid
from datetime import datetime

def generate_run_id(input_file_path: str, chat_id: str) -> str:
    """Generate deterministic run_id from input file hash + chat_id"""
    with open(input_file_path, 'rb') as f:
        file_hash = hashlib.sha256(f.read()).hexdigest()[:16]
    
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    return f"ingest_{chat_id}_{timestamp}_{file_hash}"
```

**2. Check for existing run:**
```python
def check_existing_run(con, input_file_path: str, chat_id: str) -> Optional[str]:
    """Check if this input was already processed successfully"""
    with open(input_file_path, 'rb') as f:
        file_hash = hashlib.sha256(f.read()).hexdigest()
    
    result = con.execute("""
        SELECT run_id, status 
        FROM ingestion_runs 
        WHERE input_file_hash = ? AND chat_id = ?
        ORDER BY started_at DESC
        LIMIT 1
    """, [file_hash, chat_id]).fetchone()
    
    if result and result[1] == 'completed':
        return result[0]  # Already processed
    elif result and result[1] == 'partial':
        return result[0]  # Partial run - can resume
    return None
```

**3. Start run:**
```python
def start_ingestion_run(con, run_id: str, chat_id: str, input_file_path: str) -> None:
    """Record start of ingestion run"""
    with open(input_file_path, 'rb') as f:
        file_hash = hashlib.sha256(f.read()).hexdigest()
    
    con.execute("""
        INSERT INTO ingestion_runs 
        (run_id, chat_id, input_file_path, input_file_hash, status, started_at)
        VALUES (?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)
    """, [run_id, chat_id, input_file_path, file_hash])
```

**4. Idempotent inserts:**
```python
# Instead of: INSERT INTO tg_norm_d VALUES (...)
# Use: INSERT OR IGNORE INTO tg_norm_d VALUES (..., run_id)

con.executemany("""
    INSERT OR IGNORE INTO tg_norm_d 
    (chat_id, chat_name, message_id, ts_ms, from_name, from_id, type, is_service, 
     reply_to_message_id, text, links_json, norm_json, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
""", [(..., run_id) for row in batch])
```

**5. Complete run:**
```python
def complete_ingestion_run(con, run_id: str, row_counts: dict) -> None:
    """Mark run as completed with row counts"""
    con.execute("""
        UPDATE ingestion_runs 
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            rows_inserted_tg_norm = ?,
            rows_inserted_caller_links = ?,
            rows_inserted_user_calls = ?
        WHERE run_id = ?
    """, [
        row_counts['tg_norm'],
        row_counts['caller_links'],
        row_counts['user_calls'],
        run_id
    ])
```

**6. Handle partial runs:**
```python
def resume_partial_run(con, run_id: str) -> None:
    """Delete partial data and allow re-insert"""
    con.execute("DELETE FROM tg_norm_d WHERE run_id = ?", [run_id])
    con.execute("DELETE FROM caller_links_d WHERE run_id = ?", [run_id])
    con.execute("DELETE FROM user_calls_d WHERE run_id = ?", [run_id])
    con.execute("""
        UPDATE ingestion_runs 
        SET status = 'running', completed_at = NULL
        WHERE run_id = ?
    """, [run_id])
```

## Concurrency Control

### DuckDB Locking

DuckDB uses file-level locking:
- **Read operations**: Multiple readers allowed
- **Write operations**: Exclusive lock required

**Strategy:**
1. Try to acquire write lock
2. If locked, wait with exponential backoff (max 30s)
3. If still locked, fail with clear error:
   ```
   Database is locked by another process. 
   File: {db_path}
   Suggestion: Wait for current ingestion to complete, or use --force to override.
   ```

**Implementation:**
```python
import time
import os

def acquire_db_lock(db_path: str, max_wait_seconds: int = 30) -> bool:
    """Try to acquire database lock with exponential backoff"""
    lock_file = db_path + '.lock'
    wait_time = 1
    elapsed = 0
    
    while elapsed < max_wait_seconds:
        try:
            # Try to create lock file (atomic operation)
            fd = os.open(lock_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except OSError:
            # Lock file exists - another process is writing
            time.sleep(wait_time)
            wait_time = min(wait_time * 2, 5)  # Exponential backoff, max 5s
            elapsed += wait_time
    
    raise RuntimeError(
        f"Could not acquire database lock after {max_wait_seconds}s. "
        f"Another process may be writing to {db_path}"
    )

def release_db_lock(db_path: str) -> None:
    """Release database lock"""
    lock_file = db_path + '.lock'
    try:
        os.remove(lock_file)
    except OSError:
        pass
```

## Schema Migration

### Version Tracking

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);
```

### Migration Steps

1. **Add schema_version table** (if not exists)
2. **Check current version**
3. **Apply migrations incrementally:**
   - v1 → v2: Add `run_id` columns
   - v2 → v3: Add PRIMARY KEYs
   - v3 → v4: Add `ingestion_runs` table
   - v4 → v5: Add indexes

### Migration Error Handling

If schema mismatch detected:
```
Error: Schema version mismatch
  Current: v1
  Required: v5
  Action: Run migration script: python tools/telegram/migrate_schema.py --to v5
```

## Test Scenarios

### 1. Same Input Twice
- **Setup**: Run ingestion with same input file
- **Expected**: Second run detects existing `input_file_hash` and skips (or completes idempotently)
- **Verify**: Row counts identical, no duplicates

### 2. Partial Run
- **Setup**: Start ingestion, kill process mid-run
- **Expected**: `ingestion_runs.status = 'partial'`
- **Action**: Rerun same input
- **Expected**: Deletes partial rows, re-inserts, completes successfully

### 3. Concurrent Writes
- **Setup**: Two processes try to write simultaneously
- **Expected**: Second process gets lock error after timeout
- **Verify**: No silent corruption, clear error message

### 4. Schema Mismatch
- **Setup**: Old DB with v1 schema, new code expects v5
- **Expected**: Clear error with migration instructions
- **Verify**: No partial writes, actionable error

## Implementation Priority

1. ✅ **Test matrix** (created)
2. ⏳ **Schema enhancement** (add run_id, PRIMARY KEYs)
3. ⏳ **Python script modifications** (idempotent inserts)
4. ⏳ **Concurrency control** (locking)
5. ⏳ **Schema migration** (versioning)
6. ⏳ **Integration tests** (all scenarios)

