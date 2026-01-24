# Event Log Implementation Review

**Date**: 2026-01-23  
**Reviewer**: AI Assistant  
**Status**: ✅ **VERIFIED** with minor fixes needed

## Overview

The event log implementation follows the event log + derived index pattern correctly. The core architecture is sound, but there are a few issues that need fixing.

## ✅ What Works Well

1. **Atomic Append**: The `append_event()` function correctly implements atomic writes (temp → fsync → rename)
2. **Day Partitioning**: Events are correctly partitioned by day (`day=YYYY-MM-DD/`)
3. **Part File Rotation**: 100MB rotation limit is reasonable
4. **Event Structure**: All event types have proper schemas defined
5. **Indexer Logic**: DuckDB indexer correctly rebuilds tables from events
6. **Tests**: Basic tests pass

## ⚠️ Issues Found

### 1. **Critical: Indexer Glob Pattern Won't Work**

**Location**: `tools/ledger/indexer.py:52`

**Problem**: DuckDB's `read_json_auto()` doesn't support glob patterns with comparisons like `day>={since_date}`. It needs actual file paths.

**Current Code**:
```python
if since_date:
    event_glob = str(EVENTS_DIR / f"day>={since_date}" / "**" / "*.jsonl")
```

**Fix**: Build a list of actual file paths:
```python
if since_date:
    # Collect all event files from since_date onwards
    event_files = []
    for day_dir in EVENTS_DIR.iterdir():
        if day_dir.is_dir() and day_dir.name.startswith('day='):
            day_str = day_dir.name.split('=')[1]
            if day_str >= since_date:
                event_files.extend(day_dir.glob('*.jsonl'))
    event_glob = [str(f) for f in event_files]
else:
    event_glob = str(EVENTS_DIR / "**" / "*.jsonl")
```

### 2. **Schema Validation Not Integrated**

**Location**: `tools/ledger/event_writer.py`

**Problem**: Events are written without schema validation. The `schema_registry.py` module exists but isn't used.

**Fix**: Add optional validation:
```python
from schema_registry import validate_event

def append_event(event: Dict[str, Any], validate: bool = True) -> None:
    """..."""
    if validate:
        is_valid, error = validate_event(event)
        if not is_valid:
            raise ValueError(f"Invalid event: {error}")
    # ... rest of function
```

### 3. **Test Syntax Error**

**Location**: `tools/ledger/tests/test_event_writer.py:116`

**Problem**: Syntax error - duplicate `if` condition:
```python
day_dirs = [d for d in events_dir.iterdir() if d.is_dir() if d.name.startswith('day=')]
```

**Fix**:
```python
day_dirs = [d for d in events_dir.iterdir() if d.is_dir() and d.name.startswith('day=')]
```

### 4. **Index Daemon File Change Detection**

**Location**: `tools/ledger/index_daemon.py:49-63`

**Problem**: `_has_new_events()` only checks file count, not file modification time. If events are appended to existing files, changes won't be detected.

**Fix**: Check mtime or use a more robust approach:
```python
def _has_new_events(self) -> bool:
    """Check if there are new events since last check."""
    current_files = self._get_event_files()
    
    # Check for new files
    if len(current_files) > len(self.last_event_files):
        return True
    
    # Check if any existing files were modified
    for file_path in current_files:
        if file_path not in self.last_event_files:
            return True
        # Check mtime
        if file_path.stat().st_mtime > self.last_check_time:
            return True
    
    return False
```

### 5. **Atomic Append Efficiency**

**Location**: `tools/ledger/event_writer.py:85-91`

**Problem**: When appending to existing file, the temp file is read entirely into memory. For very large events, this could be inefficient.

**Current Code**:
```python
if part_file.exists():
    with open(part_file, 'a') as f:
        with open(temp_file) as tmp:
            f.write(tmp.read())
```

**Note**: This is probably fine for JSONL events (each event is one line), but could be optimized:
```python
if part_file.exists():
    with open(part_file, 'ab') as f:
        with open(temp_file, 'rb') as tmp:
            f.write(tmp.read())
```

### 6. **Missing Error Handling in Indexer**

**Location**: `tools/ledger/indexer.py:34`

**Problem**: If `read_json_auto()` fails (e.g., invalid JSON, missing files), the error isn't handled gracefully.

**Fix**: Add try/except around DuckDB operations:
```python
try:
    con.execute("""
        CREATE OR REPLACE TABLE runs_d AS
        SELECT ...
        FROM read_json_auto(?, format='newline_delimited')
        WHERE event_type = 'run.created'
    """, [event_glob])
except Exception as e:
    raise RuntimeError(f"Failed to rebuild index: {e}") from e
```

## 🔍 Additional Recommendations

### 1. **Add Event Validation to Convenience Functions**

The convenience functions (`emit_run_created`, etc.) should validate their inputs:

```python
def emit_run_created(
    run_id: str,
    run_type: str,
    config: Dict[str, Any],
    data_fingerprint: str,
    **kwargs
) -> None:
    """Emit run.created event."""
    event = {
        'event_type': 'run.created',
        'timestamp_ms': int(time.time() * 1000),
        'run_id': run_id,
        'run_type': run_type,
        'config': config,
        'data_fingerprint': data_fingerprint,
        **kwargs
    }
    # Validate before appending
    is_valid, error = validate_event(event)
    if not is_valid:
        raise ValueError(f"Invalid run.created event: {error}")
    append_event(event, validate=False)  # Already validated
```

### 2. **Add Event ID Uniqueness Check**

Event IDs should be unique. Consider adding a check:

```python
def append_event(event: Dict[str, Any]) -> None:
    """..."""
    if 'event_id' not in event:
        event['event_id'] = f"{event['timestamp_ms']}_{uuid.uuid4().hex[:8]}"
    
    # Optional: Check for duplicate event_id in recent events
    # (This would require reading recent events, so maybe skip for now)
```

### 3. **Add Metrics/Logging**

Add logging for event writes and index rebuilds:

```python
import logging

logger = logging.getLogger(__name__)

def append_event(event: Dict[str, Any]) -> None:
    """..."""
    logger.debug(f"Appending event: {event['event_type']} (id: {event.get('event_id')})")
    # ... rest of function
```

### 4. **Document Event Ordering Guarantees**

Events are written with `timestamp_ms`, but there's no guarantee of ordering if multiple processes write concurrently. Document this:

```python
"""
Event Log Writer - Atomic append-only event storage.

EVENT ORDERING:
- Events are ordered by timestamp_ms within a single part file
- Events from different processes may be interleaved
- Use event_id for unique identification, not position
- For strict ordering, use a single writer process or add sequence numbers
"""
```

## ✅ Verification Checklist

- [x] Event writer creates files correctly
- [x] Events are written atomically
- [x] Day partitioning works
- [x] Convenience functions work
- [x] Tests pass
- [ ] Indexer handles glob patterns correctly (needs fix)
- [ ] Schema validation integrated (needs fix)
- [ ] Test syntax error fixed (needs fix)
- [ ] Index daemon detects file changes (needs fix)

## Summary

The implementation is **solid** but needs these fixes:
1. Fix indexer glob pattern handling
2. Integrate schema validation
3. Fix test syntax error
4. Improve index daemon change detection

After these fixes, the event log will be production-ready.

