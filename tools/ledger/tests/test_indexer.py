#!/usr/bin/env python3
"""
Unit tests for DuckDB indexer.
"""

import json
import tempfile
import shutil
from pathlib import Path
import sys
import duckdb

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from indexer import rebuild_index
from event_writer import emit_run_created, emit_run_started, emit_run_completed, emit_phase_started, emit_phase_completed


def test_rebuild_index_from_events():
    """Test rebuilding index from event log."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Set up test environment
        events_dir = Path(tmpdir) / "events"
        index_dir = Path(tmpdir) / "index"
        events_dir.mkdir(parents=True)
        index_dir.mkdir(parents=True)
        
        # Mock directories
        import event_writer
        import indexer
        
        original_events_dir = event_writer.EVENTS_DIR
        original_index_dir = indexer.INDEX_DIR
        original_indexer_events_dir = indexer.EVENTS_DIR
        
        event_writer.EVENTS_DIR = events_dir
        indexer.EVENTS_DIR = events_dir  # Must set this for indexer to use test directory
        indexer.INDEX_DIR = index_dir
        
        try:
            # Emit test events
            emit_run_created('run-1', 'baseline', {'key': 'value'}, 'fp1')
            emit_run_started('run-1')
            emit_phase_started('run-1', 'plan', 0)
            emit_phase_completed('run-1', 'plan', 1000, {'output': 'data'})
            emit_run_completed('run-1', {'status': 'done'}, {'artifact': 'path'})
            
            # Rebuild index
            index_db = index_dir / "runs.duckdb"
            rebuild_index(index_db, since_date=None)
            
            # Verify index was created
            assert index_db.exists(), "Index database should exist"
            
            # Query index
            con = duckdb.connect(str(index_db))
            try:
                # Check runs_d table
                runs = con.execute("SELECT * FROM runs_d").fetchall()
                assert len(runs) >= 1, "Should have at least one run"
                
                # Check runs_status table
                status = con.execute("SELECT * FROM runs_status WHERE run_id = 'run-1'").fetchall()
                assert len(status) == 1, "Should have run status"
                
                # Check phase_timings table
                phases = con.execute("SELECT * FROM phase_timings WHERE run_id = 'run-1'").fetchall()
                assert len(phases) >= 1, "Should have phase timings"
                
                # Check latest_runs view
                latest = con.execute("SELECT * FROM latest_runs WHERE run_id = 'run-1'").fetchall()
                assert len(latest) == 1, "Should have latest run"
                assert latest[0][-1] == 'completed', "Status should be completed"
            
            finally:
                con.close()
        
        finally:
            event_writer.EVENTS_DIR = original_events_dir
            indexer.EVENTS_DIR = original_indexer_events_dir
            indexer.INDEX_DIR = original_index_dir


def test_incremental_indexing():
    """Test incremental indexing with since_date."""
    with tempfile.TemporaryDirectory() as tmpdir:
        events_dir = Path(tmpdir) / "events"
        index_dir = Path(tmpdir) / "index"
        events_dir.mkdir(parents=True)
        index_dir.mkdir(parents=True)
        
        import event_writer
        import indexer
        
        original_events_dir = event_writer.EVENTS_DIR
        original_index_dir = indexer.INDEX_DIR
        original_indexer_events_dir = indexer.EVENTS_DIR
        
        event_writer.EVENTS_DIR = events_dir
        indexer.EVENTS_DIR = events_dir  # Must set this for indexer to use test directory
        indexer.INDEX_DIR = index_dir
        
        try:
            # Emit events for different days
            from datetime import datetime, timezone
            import time
            
            # Create event for today
            today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
            emit_run_created('run-today', 'baseline', {}, 'fp1')
            
            # Rebuild with since_date = today
            index_db = index_dir / "runs.duckdb"
            rebuild_index(index_db, since_date=today)
            
            # Verify index was created
            assert index_db.exists(), "Index database should exist"
            
            # Query to verify only today's events are included
            con = duckdb.connect(str(index_db))
            try:
                runs = con.execute("SELECT * FROM runs_d").fetchall()
                # Should have at least the run we just created
                assert len(runs) >= 1
            finally:
                con.close()
        
        finally:
            event_writer.EVENTS_DIR = original_events_dir
            indexer.EVENTS_DIR = original_indexer_events_dir
            indexer.INDEX_DIR = original_index_dir


def test_materialized_views():
    """Test that materialized views are created correctly."""
    with tempfile.TemporaryDirectory() as tmpdir:
        events_dir = Path(tmpdir) / "events"
        index_dir = Path(tmpdir) / "index"
        events_dir.mkdir(parents=True)
        index_dir.mkdir(parents=True)
        
        import event_writer
        import indexer
        
        original_events_dir = event_writer.EVENTS_DIR
        original_index_dir = indexer.INDEX_DIR
        original_indexer_events_dir = indexer.EVENTS_DIR
        
        event_writer.EVENTS_DIR = events_dir
        indexer.EVENTS_DIR = events_dir  # Must set this for indexer to use test directory
        indexer.INDEX_DIR = index_dir
        
        try:
            # Emit complete run lifecycle
            emit_run_created('run-view-test', 'baseline', {}, 'fp1')
            emit_run_started('run-view-test')
            emit_phase_started('run-view-test', 'plan', 0)
            emit_phase_completed('run-view-test', 'plan', 1000, {})
            emit_run_completed('run-view-test', {}, {})
            
            # Rebuild index
            index_db = index_dir / "runs.duckdb"
            rebuild_index(index_db)
            
            # Query materialized views
            con = duckdb.connect(str(index_db))
            try:
                # Test latest_runs view
                latest = con.execute("SELECT * FROM latest_runs WHERE run_id = 'run-view-test'").fetchall()
                assert len(latest) == 1
                status = latest[0][-1]  # Last column is status
                assert status == 'completed'
                
                # Test run_phase_summary view
                summary = con.execute("SELECT * FROM run_phase_summary WHERE run_id = 'run-view-test'").fetchall()
                assert len(summary) == 1
                phase_count = summary[0][1]  # Second column is phase_count
                assert phase_count >= 1
            
            finally:
                con.close()
        
        finally:
            event_writer.EVENTS_DIR = original_events_dir
            indexer.EVENTS_DIR = original_indexer_events_dir
            indexer.INDEX_DIR = original_index_dir


if __name__ == '__main__':
    test_rebuild_index_from_events()
    print("✓ test_rebuild_index_from_events passed")
    
    test_incremental_indexing()
    print("✓ test_incremental_indexing passed")
    
    test_materialized_views()
    print("✓ test_materialized_views passed")
    
    print("\nAll indexer tests passed!")

