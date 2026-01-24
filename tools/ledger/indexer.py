#!/usr/bin/env python3
"""
DuckDB Indexer - Rebuilds DuckDB indexes from event log.

This is the ONLY process that writes to index DuckDB files.
Can be run periodically or on-demand.
"""

from __future__ import annotations

import json
import logging
import duckdb
from pathlib import Path
from typing import Optional
from datetime import datetime

# Set up logger
logger = logging.getLogger(__name__)

# Find repo root
_repo_root = Path(__file__).resolve()
for _ in range(5):
    if (_repo_root / ".git").exists() or (_repo_root / "data").exists():
        break
    _repo_root = _repo_root.parent
else:
    _repo_root = Path.cwd()

LEDGER_DIR = (_repo_root / "data" / "ledger").resolve()
EVENTS_DIR = LEDGER_DIR / "events"
INDEX_DIR = LEDGER_DIR / "index"

# Ensure index directory exists
INDEX_DIR.mkdir(parents=True, exist_ok=True)


def rebuild_index(duckdb_path: Path, since_date: Optional[str] = None) -> None:
    """
    Rebuild DuckDB index from event log.
    
    This is the ONLY process that writes to index DuckDB files.
    Can be run periodically or on-demand.
    
    Args:
        duckdb_path: Path to DuckDB index file (e.g., runs.duckdb)
        since_date: Optional date string (YYYY-MM-DD) to only process events after this date
    """
    logger.info(f"Rebuilding index: {duckdb_path} (since_date: {since_date})")
    
    # Connect to DuckDB
    con = duckdb.connect(str(duckdb_path))
    
    try:
        # Use EVENTS_DIR (can be overridden by tests)
        events_dir = EVENTS_DIR
        if not events_dir.exists():
            events_dir.mkdir(parents=True, exist_ok=True)
        # Build event file list
        if since_date:
            # Only process events from since_date onwards
            event_files = []
            for day_dir in events_dir.iterdir():
                if day_dir.is_dir() and day_dir.name.startswith('day='):
                    day_str = day_dir.name.split('=')[1]
                    if day_str >= since_date:
                        event_files.extend(day_dir.glob('*.jsonl'))
            # DuckDB read_json_auto can take a list of files
            if event_files:
                event_glob = [str(f) for f in event_files]
                logger.debug(f"Found {len(event_files)} event files since {since_date}")
            else:
                # No files found - create empty table
                event_glob = []
                logger.debug(f"No event files found since {since_date}")
        else:
            # Process all events - collect all JSONL files
            event_files = list(events_dir.rglob('*.jsonl'))
            event_glob = [str(f) for f in event_files] if event_files else []
            logger.debug(f"Found {len(event_files)} total event files")
        
        if event_glob:
            # Read all events into temp table first (so DuckDB can infer schema)
            # DuckDB read_json_auto can handle multiple files if we pass them as a list
            # But we need to escape single quotes in file paths
            if len(event_glob) == 1:
                # Single file - use parameterized query
                file_path = str(event_glob[0]).replace("'", "''")
                con.execute(f"""
                    CREATE OR REPLACE TEMP TABLE all_events AS
                    SELECT * FROM read_json_auto('{file_path}', format='newline_delimited')
                """)
            else:
                # Multiple files - use UNION ALL
                union_parts = []
                for file_path in event_glob:
                    escaped_path = str(file_path).replace("'", "''")
                    union_parts.append(f"SELECT * FROM read_json_auto('{escaped_path}', format='newline_delimited')")
                union_query = "CREATE OR REPLACE TEMP TABLE all_events AS " + " UNION ALL ".join(union_parts)
                con.execute(union_query)
            
            # Create or replace runs dimension table (from run.created events)
            con.execute("""
                CREATE OR REPLACE TABLE runs_d AS
                SELECT 
                    run_id,
                    run_type,
                    timestamp_ms AS created_at_ms,
                    config,
                    data_fingerprint
                FROM all_events
                WHERE event_type = 'run.created'
            """)
        else:
            # No events - create empty tables with proper schema
            con.execute("""
                CREATE OR REPLACE TABLE runs_d (
                    run_id TEXT,
                    run_type TEXT,
                    created_at_ms BIGINT,
                    config JSON,
                    data_fingerprint TEXT
                )
            """)
        
        # Create or replace run status table (from run lifecycle events)
        if event_glob:
            # DuckDB read_json_auto should handle missing fields as NULL
            # But we need to ensure all fields are present in the temp table
            # So we'll use a subquery that selects all fields first
            try:
                con.execute("""
                    CREATE OR REPLACE TABLE runs_status AS
                    SELECT 
                        run_id,
                        MAX(CASE WHEN event_type = 'run.started' THEN timestamp_ms END) AS started_at_ms,
                        MAX(CASE WHEN event_type = 'run.completed' THEN timestamp_ms END) AS completed_at_ms,
                        MAX(CASE WHEN event_type = 'run.completed' THEN summary END) AS summary_json
                    FROM all_events
                    WHERE event_type IN ('run.started', 'run.completed')
                    GROUP BY run_id
                """)
            except Exception as e:
                # If summary field doesn't exist, create table without it
                if 'summary' in str(e).lower():
                    con.execute("""
                        CREATE OR REPLACE TABLE runs_status AS
                        SELECT 
                            run_id,
                            MAX(CASE WHEN event_type = 'run.started' THEN timestamp_ms END) AS started_at_ms,
                            MAX(CASE WHEN event_type = 'run.completed' THEN timestamp_ms END) AS completed_at_ms,
                            NULL::JSON AS summary_json
                        FROM all_events
                        WHERE event_type IN ('run.started', 'run.completed')
                        GROUP BY run_id
                    """)
                else:
                    raise
        else:
            con.execute("""
                CREATE OR REPLACE TABLE runs_status (
                    run_id TEXT,
                    started_at_ms BIGINT,
                    completed_at_ms BIGINT,
                    summary_json JSON
                )
            """)
        
        # Create or replace phase timings table (from phase lifecycle events)
        if event_glob:
            try:
                con.execute("""
                    CREATE OR REPLACE TABLE phase_timings AS
                    SELECT 
                        run_id,
                        phase_name,
                        phase_order,
                        MAX(CASE WHEN event_type = 'phase.started' THEN timestamp_ms END) AS started_at_ms,
                        MAX(CASE WHEN event_type = 'phase.completed' THEN timestamp_ms END) AS completed_at_ms,
                        MAX(CASE WHEN event_type = 'phase.completed' THEN duration_ms END) AS duration_ms,
                        MAX(CASE WHEN event_type = 'phase.completed' THEN output_summary END) AS output_summary_json
                    FROM all_events
                    WHERE event_type IN ('phase.started', 'phase.completed')
                    GROUP BY run_id, phase_name, phase_order
                """)
            except Exception as e:
                # If phase fields don't exist, create empty table
                if any(field in str(e).lower() for field in ['phase_name', 'phase_order', 'duration_ms', 'output_summary']):
                    con.execute("""
                        CREATE OR REPLACE TABLE phase_timings (
                            run_id TEXT,
                            phase_name TEXT,
                            phase_order INTEGER,
                            started_at_ms BIGINT,
                            completed_at_ms BIGINT,
                            duration_ms BIGINT,
                            output_summary_json JSON
                        )
                    """)
                else:
                    raise
        else:
            con.execute("""
                CREATE OR REPLACE TABLE phase_timings (
                    run_id TEXT,
                    phase_name TEXT,
                    phase_order INTEGER,
                    started_at_ms BIGINT,
                    completed_at_ms BIGINT,
                    duration_ms BIGINT,
                    output_summary_json JSON
                )
            """)
        
        # Create or replace trial results table (from trial.recorded events)
        if event_glob:
            try:
                con.execute("""
                    CREATE OR REPLACE TABLE trial_results AS
                    SELECT 
                        run_id,
                        trial_id,
                        timestamp_ms AS recorded_at_ms,
                        params,
                        metrics
                    FROM all_events
                    WHERE event_type = 'trial.recorded'
                """)
            except Exception as e:
                # If trial fields don't exist, create empty table
                if any(field in str(e).lower() for field in ['trial_id', 'params', 'metrics']):
                    con.execute("""
                        CREATE OR REPLACE TABLE trial_results (
                            run_id TEXT,
                            trial_id TEXT,
                            recorded_at_ms BIGINT,
                            params JSON,
                            metrics JSON
                        )
                    """)
                else:
                    raise
        else:
            con.execute("""
                CREATE OR REPLACE TABLE trial_results (
                    run_id TEXT,
                    trial_id TEXT,
                    recorded_at_ms BIGINT,
                    params JSON,
                    metrics JSON
                )
            """)
        
        # Create or replace artifacts catalog table (from artifact.created events)
        if event_glob:
            try:
                con.execute("""
                    CREATE OR REPLACE TABLE artifacts_catalog AS
                    SELECT 
                        run_id,
                        artifact_type,
                        artifact_path,
                        size_bytes,
                        timestamp_ms AS created_at_ms
                    FROM all_events
                    WHERE event_type = 'artifact.created'
                """)
            except Exception as e:
                # If artifact fields don't exist, create empty table
                if any(field in str(e).lower() for field in ['artifact_type', 'artifact_path', 'size_bytes']):
                    con.execute("""
                        CREATE OR REPLACE TABLE artifacts_catalog (
                            run_id TEXT,
                            artifact_type TEXT,
                            artifact_path TEXT,
                            size_bytes BIGINT,
                            created_at_ms BIGINT
                        )
                    """)
                else:
                    raise
        else:
            con.execute("""
                CREATE OR REPLACE TABLE artifacts_catalog (
                    run_id TEXT,
                    artifact_type TEXT,
                    artifact_path TEXT,
                    size_bytes BIGINT,
                    created_at_ms BIGINT
                )
            """)
        
        # Create or replace materialized view for latest runs
        con.execute("""
            CREATE OR REPLACE VIEW latest_runs AS
            SELECT 
                r.run_id,
                r.run_type,
                r.created_at_ms,
                s.started_at_ms,
                s.completed_at_ms,
                s.summary_json,
                CASE 
                    WHEN s.completed_at_ms IS NOT NULL THEN 'completed'
                    WHEN s.started_at_ms IS NOT NULL THEN 'running'
                    ELSE 'pending'
                END AS status
            FROM runs_d r
            LEFT JOIN runs_status s USING (run_id)
            ORDER BY r.created_at_ms DESC
        """)
        
        # Create or replace view for run phase timings summary
        con.execute("""
            CREATE OR REPLACE VIEW run_phase_summary AS
            SELECT 
                run_id,
                COUNT(*) AS phase_count,
                SUM(duration_ms) AS total_duration_ms,
                LIST(phase_name ORDER BY phase_order) AS phase_names,
                LIST(duration_ms ORDER BY phase_order) AS phase_durations_ms
            FROM phase_timings
            WHERE duration_ms IS NOT NULL
            GROUP BY run_id
        """)
        
        # Commit changes
        con.commit()
        logger.info(f"Index rebuilt successfully: {duckdb_path}")
        
    except Exception as e:
        logger.error(f"Failed to rebuild index {duckdb_path}: {e}")
        raise RuntimeError(f"Failed to rebuild index {duckdb_path}: {e}") from e
    finally:
        con.close()


def rebuild_runs_index(since_date: Optional[str] = None) -> None:
    """Rebuild runs.duckdb index."""
    runs_db = INDEX_DIR / "runs.duckdb"
    rebuild_index(runs_db, since_date)


def rebuild_alerts_index(since_date: Optional[str] = None) -> None:
    """Rebuild alerts.duckdb index (for future alert ingestion events)."""
    alerts_db = INDEX_DIR / "alerts.duckdb"
    rebuild_index(alerts_db, since_date)


def rebuild_catalog_index(since_date: Optional[str] = None) -> None:
    """Rebuild catalog.duckdb index (light metadata)."""
    catalog_db = INDEX_DIR / "catalog.duckdb"
    rebuild_index(catalog_db, since_date)


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python indexer.py <duckdb_path> [since_date]")
        sys.exit(1)
    
    duckdb_path = Path(sys.argv[1])
    since_date = sys.argv[2] if len(sys.argv) > 2 else None
    
    rebuild_index(duckdb_path, since_date)
    print(f"Index rebuilt: {duckdb_path}")

