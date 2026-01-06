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

# Queue directory
QUEUE_DIR = Path("data/.duckdb_write_queue")
QUEUE_DIR.mkdir(parents=True, exist_ok=True)

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
) -> str:
    """
    Enqueue a DuckDB write operation for background processing.
    
    Args:
        duckdb_path: Path to DuckDB file
        operation: Operation type (e.g., 'store_tp_sl_run', 'store_baseline_run')
        payload: Operation-specific data (must be JSON-serializable)
        priority: 1-9 (lower = higher priority)
    
    Returns:
        Job ID
    """
    job_id = f"{int(time.time() * 1000)}_{priority}_{uuid.uuid4().hex[:8]}"
    
    job = {
        "job_id": job_id,
        "duckdb_path": str(duckdb_path),
        "operation": operation,
        "payload": payload,
        "priority": priority,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "attempts": 0,
        "max_attempts": 5,
    }
    
    job_file = PENDING_DIR / f"{job_id}.json"
    with open(job_file, "w") as f:
        json.dump(job, f, indent=2, default=str)
    
    print(f"[queue] Enqueued job {job_id}: {operation}", file=sys.stderr)
    return job_id


def get_pending_jobs() -> list[Path]:
    """Get pending jobs sorted by priority and timestamp."""
    jobs = list(PENDING_DIR.glob("*.json"))
    # Sort by filename (timestamp_priority_uuid) - lower priority number first
    return sorted(jobs, key=lambda p: p.name)


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
        elif operation == "store_trial":
            from .trial_ledger import store_trial
            store_trial(
                duckdb_path,
                payload["trial"],
            )
        elif operation == "raw_sql":
            # Execute raw SQL (for simple operations)
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
            # Retry later - move back to pending
            print(f"[worker] Lock conflict on {job_id}, will retry (attempt {attempts}/{max_attempts})", file=sys.stderr)
            with open(processing_path, "w") as f:
                json.dump(job, f, indent=2, default=str)
            # Rename with new timestamp for retry delay
            retry_name = f"{int(time.time() * 1000) + 5000}_{job['priority']}_{job_id.split('_')[-1]}.json"
            processing_path.rename(PENDING_DIR / retry_name)
            return False
        
        # Permanent failure - move to failed
        print(f"[worker] Failed {job_id}: {error_msg}", file=sys.stderr)
        job["failed_at"] = datetime.now(timezone.utc).isoformat()
        with open(processing_path, "w") as f:
            json.dump(job, f, indent=2, default=str)
        processing_path.rename(FAILED_DIR / processing_path.name)
        return False


def run_worker(poll_interval: float = 1.0, max_jobs: Optional[int] = None):
    """
    Run the write queue worker.
    
    Args:
        poll_interval: Seconds between queue checks
        max_jobs: Maximum jobs to process (None = unlimited)
    """
    print(f"[worker] Starting DuckDB write queue worker", file=sys.stderr)
    print(f"[worker] Queue dir: {QUEUE_DIR}", file=sys.stderr)
    print(f"[worker] Poll interval: {poll_interval}s", file=sys.stderr)
    
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
        else:
            time.sleep(poll_interval)
    
    print(f"[worker] Shutdown complete. Processed {jobs_processed} jobs.", file=sys.stderr)


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
            removed += 1
    
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

