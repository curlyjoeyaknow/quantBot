#!/usr/bin/env python3
"""
Event Log Writer - Atomic append-only event storage.

This is the source of truth. All state changes go through here.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

# Set up logger
logger = logging.getLogger(__name__)

# Import schema validation (optional - graceful fallback if not available)
try:
    from schema_registry import validate_event as _validate_event
    SCHEMA_VALIDATION_AVAILABLE = True
except ImportError:
    SCHEMA_VALIDATION_AVAILABLE = False
    logger.warning("Schema validation not available - events will be written without validation")

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
ARTIFACTS_DIR = LEDGER_DIR / "artifacts" / "runs"

# Ensure directories exist
EVENTS_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

# Max part file size (100MB)
MAX_PART_SIZE = 100 * 1024 * 1024


def append_event(event: Dict[str, Any], validate: bool = True) -> None:
    """
    Atomically append event to log.
    
    CRASH-SAFE: Write to temp file, fsync, rename.
    
    Args:
        event: Event dict with at least 'event_type' and 'timestamp_ms'
        validate: Whether to validate event against schema (default: True)
    
    Raises:
        ValueError: If event is invalid or missing required fields
    """
    # Validate event structure
    if 'event_type' not in event:
        raise ValueError("Event must have 'event_type' field")
    
    # Auto-generate missing fields
    if 'timestamp_ms' not in event:
        event['timestamp_ms'] = int(time.time() * 1000)
    if 'event_id' not in event:
        event['event_id'] = f"{event['timestamp_ms']}_{uuid.uuid4().hex[:8]}"
    
    # Schema validation (if available and enabled)
    if validate and SCHEMA_VALIDATION_AVAILABLE:
        is_valid, error = _validate_event(event)
        if not is_valid:
            raise ValueError(f"Invalid event: {error}")
    
    # Log event write
    logger.debug(f"Appending event: {event['event_type']} (id: {event['event_id']}, run_id: {event.get('run_id', 'N/A')})")
    
    # Partition by day
    day = datetime.fromtimestamp(event['timestamp_ms'] / 1000, tz=timezone.utc).strftime('%Y-%m-%d')
    day_dir = EVENTS_DIR / f"day={day}"
    day_dir.mkdir(parents=True, exist_ok=True)
    
    # Find next part file (or use existing if under size limit)
    part_files = sorted(day_dir.glob('part-*.jsonl'))
    if part_files:
        last_part = part_files[-1]
        if last_part.stat().st_size < MAX_PART_SIZE:
            part_file = last_part
        else:
            # Rotate to new part file
            last_num = int(last_part.stem.split('-')[1])
            part_file = day_dir / f'part-{last_num + 1:06d}.jsonl'
    else:
        part_file = day_dir / 'part-000001.jsonl'
    
    # Atomic append: write to temp, then append to final
    event_line = json.dumps(event, separators=(',', ':'), default=str) + '\n'
    
    # Write to temp file first
    temp_file = part_file.with_suffix('.jsonl.tmp')
    try:
        with open(temp_file, 'a') as f:
            f.write(event_line)
            f.flush()
            os.fsync(f.fileno())
        
        # Append to existing part file or rename temp to new
        if part_file.exists():
            # Append temp content to existing file
            with open(part_file, 'a') as f:
                with open(temp_file) as tmp:
                    f.write(tmp.read())
            temp_file.unlink()
        else:
            # First write - rename temp to final
            temp_file.rename(part_file)
        
        logger.debug(f"Event written to {part_file.name}")
    except Exception as e:
        # Clean up temp file on error
        logger.error(f"Failed to write event {event.get('event_id', 'unknown')}: {e}")
        if temp_file.exists():
            temp_file.unlink()
        raise


def store_run_artifacts(run_id: str, artifacts: Dict[str, Any]) -> Dict[str, str]:
    """
    Store run artifacts as Parquet/JSON files.
    
    Args:
        run_id: Run identifier
        artifacts: Dict with keys like 'trades', 'summary', 'config', etc.
    
    Returns:
        Dict mapping artifact type to file path
    """
    artifact_dir = ARTIFACTS_DIR / run_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    
    paths = {}
    
    # Store trades as Parquet if pandas available
    if 'trades' in artifacts:
        try:
            import pandas as pd
            trades_df = pd.DataFrame(artifacts['trades'])
            trades_path = artifact_dir / 'trades.parquet'
            trades_df.to_parquet(trades_path, index=False)
            paths['trades'] = str(trades_path.relative_to(_repo_root))
        except ImportError:
            # Fallback to JSON
            trades_path = artifact_dir / 'trades.json'
            with open(trades_path, 'w') as f:
                json.dump(artifacts['trades'], f, indent=2)
            paths['trades'] = str(trades_path.relative_to(_repo_root))
    
    # Store summary as JSON
    if 'summary' in artifacts:
        summary_path = artifact_dir / 'summary.json'
        with open(summary_path, 'w') as f:
            json.dump(artifacts['summary'], f, indent=2)
        paths['summary'] = str(summary_path.relative_to(_repo_root))
    
    # Store config as JSON
    if 'config' in artifacts:
        config_path = artifact_dir / 'config.json'
        with open(config_path, 'w') as f:
            json.dump(artifacts['config'], f, indent=2)
        paths['config'] = str(config_path.relative_to(_repo_root))
    
    return paths


# Convenience functions for common events

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
    # Validate before appending (schema validation will happen in append_event)
    append_event(event, validate=True)


def emit_run_completed(
    run_id: str,
    summary: Dict[str, Any],
    artifact_paths: Dict[str, str],
    **kwargs
) -> None:
    """Emit run.completed event."""
    event = {
        'event_type': 'run.completed',
        'timestamp_ms': int(time.time() * 1000),
        'run_id': run_id,
        'summary': summary,
        'artifact_paths': artifact_paths,
        **kwargs
    }
    append_event(event, validate=True)


def emit_run_started(
    run_id: str,
    **kwargs
) -> None:
    """Emit run.started event."""
    append_event({
        'event_type': 'run.started',
        'timestamp_ms': int(time.time() * 1000),
        'run_id': run_id,
        **kwargs
    })


def emit_phase_started(
    run_id: str,
    phase_name: str,
    phase_order: int,
    **kwargs
) -> None:
    """Emit phase.started event."""
    append_event({
        'event_type': 'phase.started',
        'timestamp_ms': int(time.time() * 1000),
        'run_id': run_id,
        'phase_name': phase_name,
        'phase_order': phase_order,
        **kwargs
    })


def emit_phase_completed(
    run_id: str,
    phase_name: str,
    duration_ms: int,
    output_summary: Dict[str, Any],
    **kwargs
) -> None:
    """Emit phase.completed event."""
    append_event({
        'event_type': 'phase.completed',
        'timestamp_ms': int(time.time() * 1000),
        'run_id': run_id,
        'phase_name': phase_name,
        'duration_ms': duration_ms,
        'output_summary': output_summary,
        **kwargs
    })


def emit_trial_recorded(
    run_id: str,
    trial_id: str,
    params: Dict[str, Any],
    metrics: Dict[str, Any],
    **kwargs
) -> None:
    """Emit trial.recorded event."""
    event = {
        'event_type': 'trial.recorded',
        'timestamp_ms': int(time.time() * 1000),
        'run_id': run_id,
        'trial_id': trial_id,
        'params': params,
        'metrics': metrics,
        **kwargs
    }
    append_event(event, validate=True)


def emit_baseline_completed(
    run_id: str,
    alerts_total: int,
    alerts_ok: int,
    artifact_path: str,
    **kwargs
) -> None:
    """Emit baseline.completed event."""
    append_event({
        'event_type': 'baseline.completed',
        'timestamp_ms': int(time.time() * 1000),
        'run_id': run_id,
        'alerts_total': alerts_total,
        'alerts_ok': alerts_ok,
        'artifact_path': artifact_path,
        **kwargs
    })


def emit_artifact_created(
    run_id: str,
    artifact_type: str,
    artifact_path: str,
    size_bytes: int,
    **kwargs
) -> None:
    """Emit artifact.created event."""
    append_event({
        'event_type': 'artifact.created',
        'timestamp_ms': int(time.time() * 1000),
        'run_id': run_id,
        'artifact_type': artifact_type,
        'artifact_path': artifact_path,
        'size_bytes': size_bytes,
        **kwargs
    })

