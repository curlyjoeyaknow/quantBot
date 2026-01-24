#!/usr/bin/env python3
"""
DuckDB Write Queue - Solves single-writer limitation.

Architecture:
    This module is an ADAPTER that wraps DuckDB write operations with queueing.
    It lives in tools/backtest/lib/ as a utility for backtest tools (apps).
    
    Dependency direction:
    - tools/backtest/*.py (apps) → lib/write_queue.py (adapter) → duckdb (SDK)
    
    The queue uses a file-based approach (JSON files) to enable inter-process
    communication without requiring a separate database or message broker.

DuckDB only allows one writer at a time. This module provides:
1. A file-based queue for pending writes
2. A background worker that processes writes sequentially
3. Retry logic for lock conflicts

Usage:
    # Enqueue a write (from any process)
    from lib.write_queue import enqueue_write
    enqueue_write(duckdb_path, operation, payload)
    
    # Run the worker (single instance)
    python -m lib.write_queue work

Queue stored in: data/.duckdb_write_queue/
"""

from __future__ import annotations

import warnings
warnings.filterwarnings("ignore", message=".*found in sys.modules.*")

import argparse
import json
import os
import signal
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

# Add tools to path for shared imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.duckdb_adapter import get_write_connection

# Queue directory - absolute path relative to repo root
# Find repo root by looking for .git or known markers
_repo_root = Path(__file__).resolve()
for _ in range(5):  # Max 5 levels up
    if (_repo_root / ".git").exists() or (_repo_root / "data").exists():
        break
    _repo_root = _repo_root.parent
else:
    # Fallback: use current working directory
    _repo_root = Path.cwd()

QUEUE_DIR = (_repo_root / "data" / ".duckdb_write_queue").resolve()
QUEUE_DIR.mkdir(parents=True, exist_ok=True)

# Worker lock file
WORKER_LOCK_FILE = QUEUE_DIR / "worker.lock"

# Status files
PENDING_DIR = QUEUE_DIR / "pending"
PROCESSING_DIR = QUEUE_DIR / "processing"
COMPLETED_DIR = QUEUE_DIR / "completed"
FAILED_DIR = QUEUE_DIR / "failed"

for d in [PENDING_DIR, PROCESSING_DIR, COMPLETED_DIR, FAILED_DIR]:
    d.mkdir(exist_ok=True)


def enqueue_write(
    duckdb_path: str,
    operation: str,
    payload: Dict[str, Any],
    priority: int = 5,
    not_before_ts_ms: Optional[int] = None,
) -> str:
    """
    Enqueue a DuckDB write operation for background processing.
    
    CRASH-SAFE: Writes to temp file, fsyncs, then renames atomically.
    This ensures the worker only sees fully-written jobs.
    
    Args:
        duckdb_path: Path to DuckDB file
        operation: Operation type (e.g., 'store_tp_sl_run', 'store_baseline_run')
        payload: Operation-specific data (must be JSON-serializable)
        priority: 1-99 (lower = higher priority). Parsed as integer for sorting.
        not_before_ts_ms: Don't process before this timestamp (milliseconds since epoch)
    
    Returns:
        Job ID
    """
    if not (1 <= priority <= 99):
        raise ValueError(f"Priority must be 1-99, got {priority}")
    
    timestamp_ms = int(time.time() * 1000)
    job_id = f"{timestamp_ms}_{priority:02d}_{uuid.uuid4().hex[:8]}"
    
    job = {
        "job_id": job_id,
        "duckdb_path": str(duckdb_path),
        "operation": operation,
        "payload": payload,
        "priority": priority,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "not_before_ts_ms": not_before_ts_ms or timestamp_ms,
        "attempts": 0,
        "max_attempts": 5,
    }
    
    # CRASH-SAFE: Write to temp file first, then rename atomically
    temp_file = PENDING_DIR / f".tmp-{job_id}.json"
    final_file = PENDING_DIR / f"{job_id}.json"
    
    try:
        with open(temp_file, "w") as f:
            json.dump(job, f, indent=2, default=str)
            f.flush()
            os.fsync(f.fileno())  # Force write to disk
        
        # Atomic rename - worker will only see complete files
        temp_file.rename(final_file)
    except Exception:
        # Clean up temp file on error
        if temp_file.exists():
            temp_file.unlink()
        raise
    
    print(f"[queue] Enqueued job {job_id}: {operation}", file=sys.stderr)
    return job_id


def _parse_job_filename(filename: str) -> tuple[int, int, str]:
    """
    Parse job filename into (priority, timestamp_ms, uuid).
    
    Format: {timestamp_ms}_{priority:02d}_{uuid}.json
    Returns: (priority:int, timestamp_ms:int, uuid:str)
    """
    try:
        # Remove .json extension
        base = filename.rsplit(".json", 1)[0]
        parts = base.split("_", 2)
        if len(parts) >= 3:
            timestamp_ms = int(parts[0])
            priority = int(parts[1])
            uuid_part = parts[2]
            return (priority, timestamp_ms, uuid_part)
    except (ValueError, IndexError):
        pass
    # Fallback: treat as lowest priority, oldest timestamp
    return (99, 0, filename)


def get_pending_jobs() -> list[Path]:
    """
    Get pending jobs sorted by priority (lower first) then timestamp (older first).
    
    Also filters out jobs whose not_before_ts_ms is in the future.
    """
    jobs = list(PENDING_DIR.glob("*.json"))
    # Filter out temp files
    jobs = [j for j in jobs if not j.name.startswith(".tmp-")]
    
    now_ms = int(time.time() * 1000)
    ready_jobs = []
    
    for job_path in jobs:
        # Check not_before timestamp from file contents
        try:
            with open(job_path) as f:
                job = json.load(f)
            not_before = job.get("not_before_ts_ms", 0)
            if not_before <= now_ms:
                ready_jobs.append(job_path)
        except (json.JSONDecodeError, KeyError):
            # Corrupt or missing metadata - include it (will fail processing)
            ready_jobs.append(job_path)
    
    # Sort by (priority:int, timestamp_ms:int) - lower priority first, then older first
    return sorted(ready_jobs, key=lambda p: _parse_job_filename(p.name))


def process_job(job_path: Path) -> bool:
    """
    Process a single job.
    
    Returns True if successful, False if failed.
    """
    with open(job_path) as f:
        job = json.load(f)
    
    job_id = job["job_id"]
    operation = job["operation"]
    duckdb_path = job["duckdb_path"]
    payload = job["payload"]
    attempts = job.get("attempts", 0) + 1
    max_attempts = job.get("max_attempts", 5)
    
    print(f"[worker] Processing {job_id}: {operation} (attempt {attempts}/{max_attempts})", file=sys.stderr)
    
    # Move to processing
    processing_path = PROCESSING_DIR / job_path.name
    job_path.rename(processing_path)
    
    # Update attempts
    job["attempts"] = attempts
    job["last_attempt_at"] = datetime.now(timezone.utc).isoformat()
    
    try:
        # Execute the operation
        if operation == "store_tp_sl_run":
            from .storage import _store_tp_sl_run_impl
            _store_tp_sl_run_impl(
                duckdb_path,
                payload["run_id"],
                payload["run_name"],
                payload["config"],
                payload["rows"],
                payload["summary"],
            )
        elif operation == "store_baseline_run":
            # Import here to avoid circular dependencies
            # FIXED: Removed duplicate execution bug
            try:
                from .storage import _store_baseline_run_impl
                _store_baseline_run_impl(
                    duckdb_path,
                    payload["run_id"],
                    payload["run_name"],
                    payload["config"],
                    payload["rows"],
                    payload["summary"],
                    payload["caller_agg"],
                    payload["slice_path"],
                    payload["partitioned"],
                )
            except ImportError:
                # Fallback: import from parent directory
                import sys
                from pathlib import Path
                parent_dir = Path(__file__).parent.parent
                if str(parent_dir) not in sys.path:
                    sys.path.insert(0, str(parent_dir))
                from run_baseline_all import store_baseline_to_duckdb
                store_baseline_to_duckdb(
                    duckdb_path,
                    payload["run_id"],
                    payload["run_name"],
                    payload["config"],
                    payload["rows"],
                    payload["summary"],
                    payload["caller_agg"],
                    payload["slice_path"],
                    payload["partitioned"],
                )
        elif operation == "store_trial":
            from .trial_ledger import store_trial
            store_trial(
                duckdb_path,
                payload["trial"],
            )
        elif operation == "ensure_schema":
            # Create optimizer schema
            schema_sql = payload.get("schema_sql", "")
            with get_write_connection(duckdb_path) as con:
                for stmt in schema_sql.split(";"):
                    stmt = stmt.strip()
                    if stmt:
                        con.execute(stmt)
        elif operation == "create_run_record":
            from .trial_ledger import create_run_record
            create_run_record(
                duckdb_path,
                payload["run_id"],
                payload["run_type"],
                payload.get("name"),
                payload.get("date_from"),
                payload.get("date_to"),
                payload.get("config"),
                force_direct=True,  # We're already in the worker
            )
        elif operation == "store_phase_start":
            from .trial_ledger import store_phase_start
            store_phase_start(
                duckdb_path,
                payload["run_id"],
                payload["phase_name"],
                payload.get("phase_order", 0),
                payload.get("input_summary"),
                force_direct=True,
            )
        elif operation == "store_phase_complete":
            from .trial_ledger import store_phase_complete
            # Reconstruct phase_id from run_id and phase_name
            phase_id = f"{payload['run_id']}_{payload['phase_name']}"
            store_phase_complete(
                duckdb_path,
                phase_id,
                payload.get("output_summary", {}),
                force_direct=True,
            )
        elif operation == "store_islands":
            from .trial_ledger import store_islands
            store_islands(
                duckdb_path,
                payload["run_id"],
                payload["islands"],
                force_direct=True,
            )
        elif operation == "store_island_champions":
            from .trial_ledger import store_island_champions
            store_island_champions(
                duckdb_path,
                payload["run_id"],
                payload["champions"],
                force_direct=True,
            )
        elif operation == "store_stress_lane_result":
            from .trial_ledger import store_stress_lane_result
            store_stress_lane_result(
                duckdb_path,
                payload["run_id"],
                payload["champion_id"],
                payload["lane_name"],
                payload["lane_config"],
                payload["robust_result"],
                force_direct=True,
            )
        elif operation == "store_champion_validation":
            from .trial_ledger import store_champion_validation
            store_champion_validation(
                duckdb_path,
                payload["run_id"],
                payload["champion_id"],
                payload["discovery_score"],
                payload["robust_score"],
                payload["stress_scores"],
                payload["validation_passed"],
                payload.get("notes"),
                force_direct=True,
            )
        elif operation == "raw_sql":
            # WARNING: This operation executes arbitrary SQL. Only use with trusted input.
            # This queue is intended for internal tooling only - do not expose to untrusted sources.
            with get_write_connection(duckdb_path) as con:
                for sql in payload.get("statements", []):
                    con.execute(sql)
        else:
            raise ValueError(f"Unknown operation: {operation}")
        
        # Success - move to completed
        job["completed_at"] = datetime.now(timezone.utc).isoformat()
        job["status"] = "completed"
        completed_path = COMPLETED_DIR / processing_path.name
        with open(processing_path, "w") as f:
            json.dump(job, f, indent=2, default=str)
        processing_path.rename(completed_path)
        
        print(f"[worker] Completed {job_id}", file=sys.stderr)
        return True
        
    except Exception as e:
        error_msg = str(e)
        job["last_error"] = error_msg
        job["status"] = "failed"
        
        # Check if it's a lock error
        is_lock_error = "lock" in error_msg.lower() or "conflicting" in error_msg.lower()
        
        if is_lock_error and attempts < max_attempts:
            # Retry later - move back to pending with future not_before timestamp
            retry_delay_ms = 5000 * (2 ** (attempts - 1))  # Exponential backoff: 5s, 10s, 20s, 40s
            not_before_ts_ms = int(time.time() * 1000) + retry_delay_ms
            job["not_before_ts_ms"] = not_before_ts_ms
            
            print(f"[worker] Lock conflict on {job_id}, will retry in {retry_delay_ms/1000:.1f}s (attempt {attempts}/{max_attempts})", file=sys.stderr)
            with open(processing_path, "w") as f:
                json.dump(job, f, indent=2, default=str)
            
            # Rename with updated timestamp and priority preserved
            priority_str = f"{job.get('priority', 5):02d}"
            uuid_part = job_id.split('_')[-1] if '_' in job_id else uuid.uuid4().hex[:8]
            retry_name = f"{not_before_ts_ms}_{priority_str}_{uuid_part}.json"
            processing_path.rename(PENDING_DIR / retry_name)
            return False
        
        # Permanent failure - move to failed
        print(f"[worker] Failed {job_id}: {error_msg}", file=sys.stderr)
        job["failed_at"] = datetime.now(timezone.utc).isoformat()
        with open(processing_path, "w") as f:
            json.dump(job, f, indent=2, default=str)
        processing_path.rename(FAILED_DIR / processing_path.name)
        return False


def _acquire_worker_lock() -> bool:
    """
    Acquire worker lock file atomically.
    
    Returns True if lock acquired, False if another worker is running.
    """
    try:
        # Try to create lock file with O_EXCL (atomic "only one creator")
        lock_fd = os.open(WORKER_LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        with os.fdopen(lock_fd, "w") as f:
            import socket
            lock_data = {
                "pid": os.getpid(),
                "hostname": socket.gethostname(),
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
            json.dump(lock_data, f, indent=2)
            f.flush()
            os.fsync(lock_fd)
        return True
    except FileExistsError:
        # Lock exists - check if PID is alive
        try:
            with open(WORKER_LOCK_FILE) as f:
                lock_data = json.load(f)
            other_pid = lock_data.get("pid")
            
            # Check if process exists (portable check)
            try:
                os.kill(other_pid, 0)  # Signal 0 = check existence
                # Process exists - another worker is running
                return False
            except ProcessLookupError:
                # Process doesn't exist - stale lock, steal it
                print(f"[worker] Stale lock detected (PID {other_pid} not found), stealing...", file=sys.stderr)
                WORKER_LOCK_FILE.unlink()
                return _acquire_worker_lock()
            except PermissionError:
                # Can't check (different user) - assume it's alive
                return False
        except (json.JSONDecodeError, KeyError, FileNotFoundError):
            # Corrupt lock file - remove and retry
            WORKER_LOCK_FILE.unlink(missing_ok=True)
            return _acquire_worker_lock()
    except Exception as e:
        print(f"[worker] Failed to acquire lock: {e}", file=sys.stderr)
        return False


def _release_worker_lock():
    """Release worker lock file."""
    WORKER_LOCK_FILE.unlink(missing_ok=True)


def _recover_stale_processing_jobs(max_age_minutes: int = 10):
    """
    Recover jobs stuck in processing/ directory (from crashed worker).
    
    Moves jobs older than max_age_minutes back to pending/.
    """
    cutoff_time = time.time() - (max_age_minutes * 60)
    recovered = 0
    
    for job_file in PROCESSING_DIR.glob("*.json"):
        try:
            if job_file.stat().st_mtime < cutoff_time:
                with open(job_file) as f:
                    job = json.load(f)
                
                # Reset attempts and update not_before for immediate retry
                job["attempts"] = job.get("attempts", 0)
                job["not_before_ts_ms"] = int(time.time() * 1000)
                job["recovered_from_stale"] = True
                
                # Move back to pending with updated timestamp
                priority_str = f"{job.get('priority', 5):02d}"
                uuid_part = job["job_id"].split('_')[-1] if '_' in job["job_id"] else uuid.uuid4().hex[:8]
                new_name = f"{int(time.time() * 1000)}_{priority_str}_{uuid_part}.json"
                new_path = PENDING_DIR / new_name
                
                with open(new_path, "w") as f:
                    json.dump(job, f, indent=2, default=str)
                job_file.unlink()
                recovered += 1
                print(f"[worker] Recovered stale job: {job['job_id']}", file=sys.stderr)
        except Exception as e:
            print(f"[worker] Failed to recover {job_file}: {e}", file=sys.stderr)
    
    if recovered > 0:
        print(f"[worker] Recovered {recovered} stale processing jobs", file=sys.stderr)
    return recovered


def run_worker(poll_interval: float = 1.0, max_jobs: Optional[int] = None):
    """
    Run the write queue worker.
    
    ENFORCES: Only one worker can run at a time (via lock file).
    RECOVERS: Stale processing jobs on startup.
    
    Args:
        poll_interval: Seconds between queue checks when no jobs found
        max_jobs: Maximum jobs to process (None = unlimited)
    """
    print(f"[worker] Starting DuckDB write queue worker", file=sys.stderr)
    print(f"[worker] Queue dir: {QUEUE_DIR}", file=sys.stderr)
    print(f"[worker] Poll interval: {poll_interval}s", file=sys.stderr)
    
    # Acquire worker lock (prevents multiple workers)
    if not _acquire_worker_lock():
        print(f"[worker] ERROR: Another worker is already running (lock: {WORKER_LOCK_FILE})", file=sys.stderr)
        print(f"[worker] If you're sure no worker is running, delete the lock file and try again.", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Recover stale processing jobs on startup
        _recover_stale_processing_jobs(max_age_minutes=10)
        
        # Handle graceful shutdown
        shutdown = False
        def handle_signal(signum, frame):
            nonlocal shutdown
            print(f"\n[worker] Received signal {signum}, shutting down...", file=sys.stderr)
            shutdown = True
        
        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)
        
        jobs_processed = 0
        
        while not shutdown:
            pending = get_pending_jobs()
            
            if pending:
                job_path = pending[0]
                process_job(job_path)
                jobs_processed += 1
                
                if max_jobs and jobs_processed >= max_jobs:
                    print(f"[worker] Processed {jobs_processed} jobs, exiting", file=sys.stderr)
                    break
                # Continue immediately if we processed a job (no sleep)
            else:
                # No jobs found - sleep before next check
                time.sleep(poll_interval)
        
        print(f"[worker] Shutdown complete. Processed {jobs_processed} jobs.", file=sys.stderr)
    finally:
        _release_worker_lock()


def queue_status() -> Dict[str, Any]:
    """Get current queue status."""
    return {
        "pending": len(list(PENDING_DIR.glob("*.json"))),
        "processing": len(list(PROCESSING_DIR.glob("*.json"))),
        "completed": len(list(COMPLETED_DIR.glob("*.json"))),
        "failed": len(list(FAILED_DIR.glob("*.json"))),
        "queue_dir": str(QUEUE_DIR),
    }


def cleanup_completed(max_age_hours: int = 24):
    """Remove completed jobs older than max_age_hours."""
    cutoff = time.time() - (max_age_hours * 3600)
    removed = 0
    
    for job_file in COMPLETED_DIR.glob("*.json"):
        if job_file.stat().st_mtime < cutoff:
            job_file.unlink()
            removed += 1  # FIXED: was incorrectly += 2
    
    print(f"[cleanup] Removed {removed} completed jobs older than {max_age_hours}h", file=sys.stderr)
    return removed


def main():
    parser = argparse.ArgumentParser(description="DuckDB Write Queue")
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # Worker command
    work_parser = subparsers.add_parser("work", help="Run the queue worker")
    work_parser.add_argument("--poll", type=float, default=1.0, help="Poll interval in seconds")
    work_parser.add_argument("--max-jobs", type=int, help="Max jobs to process then exit")
    
    # Status command
    status_parser = subparsers.add_parser("status", help="Show queue status")
    
    # Cleanup command
    cleanup_parser = subparsers.add_parser("cleanup", help="Cleanup old completed jobs")
    cleanup_parser.add_argument("--max-age", type=int, default=24, help="Max age in hours")
    
    # Retry command
    retry_parser = subparsers.add_parser("retry", help="Move failed jobs back to pending")
    
    args = parser.parse_args()
    
    if args.command == "work":
        run_worker(poll_interval=args.poll, max_jobs=args.max_jobs)
    elif args.command == "status":
        status = queue_status()
        print(json.dumps(status, indent=2))
    elif args.command == "cleanup":
        cleanup_completed(max_age_hours=args.max_age)
    elif args.command == "retry":
        # Move all failed back to pending
        moved = 0
        for job_file in FAILED_DIR.glob("*.json"):
            with open(job_file) as f:
                job = json.load(f)
            job["attempts"] = 0  # Reset attempts
            new_name = f"{int(time.time() * 1000)}_{job.get('priority', 5)}_{uuid.uuid4().hex[:8]}.json"
            new_path = PENDING_DIR / new_name
            with open(new_path, "w") as f:
                json.dump(job, f, indent=2, default=str)
            job_file.unlink()
            moved += 1
        print(f"Moved {moved} failed jobs back to pending", file=sys.stderr)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

