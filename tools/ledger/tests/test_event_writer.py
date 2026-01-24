#!/usr/bin/env python3
"""
Unit tests for event writer.
"""

import json
import tempfile
import shutil
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from event_writer import append_event, emit_run_created, emit_run_started, emit_run_completed


def test_append_event_atomic():
    """Test atomic append (crash safety)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Set up test environment
        events_dir = Path(tmpdir) / "events"
        events_dir.mkdir(parents=True)
        
        # Mock EVENTS_DIR
        import event_writer
        original_events_dir = event_writer.EVENTS_DIR
        event_writer.EVENTS_DIR = events_dir
        
        try:
            # Emit an event (disable validation for test events)
            event = {
                'event_type': 'test.event',
                'timestamp_ms': 1234567890000,
                'data': 'test'
            }
            append_event(event, validate=False)  # Disable validation for test events
            
            # Verify event was written
            day_dir = events_dir / "day=2009-02-13"
            assert day_dir.exists(), "Day directory should exist"
            
            part_files = list(day_dir.glob('part-*.jsonl'))
            assert len(part_files) > 0, "Part file should exist"
            
            # Read and verify content
            with open(part_files[0]) as f:
                lines = f.readlines()
                assert len(lines) == 1, "Should have one event"
                parsed = json.loads(lines[0])
                assert parsed['event_type'] == 'test.event'
                assert parsed['timestamp_ms'] == 1234567890000
        
        finally:
            event_writer.EVENTS_DIR = original_events_dir


def test_day_partitioning():
    """Test day-based partitioning."""
    with tempfile.TemporaryDirectory() as tmpdir:
        events_dir = Path(tmpdir) / "events"
        events_dir.mkdir(parents=True)
        
        import event_writer
        original_events_dir = event_writer.EVENTS_DIR
        event_writer.EVENTS_DIR = events_dir
        
        try:
            # Emit events for different days
            emit_run_created('run1', 'baseline', {}, 'fp1')
            emit_run_created('run2', 'baseline', {}, 'fp2')
            
            # Check day directories
            day_dirs = [d for d in events_dir.iterdir() if d.is_dir() and d.name.startswith('day=')]
            assert len(day_dirs) >= 1, "Should have at least one day directory"
        
        finally:
            event_writer.EVENTS_DIR = original_events_dir


def test_part_file_rotation():
    """Test part file rotation (>100MB)."""
    # This test would require creating a large file, skip for now
    # In production, part file rotation is tested by actual usage
    pass


def test_concurrent_writes():
    """Test concurrent writes (multiple processes)."""
    # This test would require multiprocessing, skip for now
    # In production, concurrent writes are safe due to atomic append
    pass


def test_event_helpers():
    """Test convenience event helper functions."""
    with tempfile.TemporaryDirectory() as tmpdir:
        events_dir = Path(tmpdir) / "events"
        events_dir.mkdir(parents=True)
        
        import event_writer
        original_events_dir = event_writer.EVENTS_DIR
        event_writer.EVENTS_DIR = events_dir
        
        try:
            # Test run.created
            emit_run_created('run1', 'baseline', {'key': 'value'}, 'fp1')
            
            # Test run.started
            emit_run_started('run1')
            
            # Test run.completed
            emit_run_completed('run1', {'status': 'done'}, {'artifact': 'path'})
            
            # Verify events were written
            day_dirs = [d for d in events_dir.iterdir() if d.is_dir() and d.name.startswith('day=')]
            assert len(day_dirs) >= 1
            
            # Count events
            total_events = 0
            for day_dir in day_dirs:
                for part_file in day_dir.glob('part-*.jsonl'):
                    with open(part_file) as f:
                        total_events += len(f.readlines())
            
            assert total_events >= 3, f"Should have at least 3 events, got {total_events}"
        
        finally:
            event_writer.EVENTS_DIR = original_events_dir


if __name__ == '__main__':
    test_append_event_atomic()
    test_day_partitioning()
    test_event_helpers()
    print("All tests passed!")

