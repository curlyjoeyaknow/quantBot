#!/usr/bin/env python3
"""
Event Schema Registry - Schema versioning and validation for event log.

Provides schema validation, versioning, and evolution support for events.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime

# Find repo root
_repo_root = Path(__file__).resolve()
for _ in range(5):
    if (_repo_root / ".git").exists() or (_repo_root / "data").exists():
        break
    _repo_root = _repo_root.parent
else:
    _repo_root = Path.cwd()

SCHEMA_FILE = (_repo_root / "data" / "ledger" / "events" / "_schema.json").resolve()

# Current schema version
CURRENT_SCHEMA_VERSION = "1.0.0"

# Event type schemas (required fields)
EVENT_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "run.created": {
        "required_fields": ["event_type", "event_id", "timestamp_ms", "run_id", "run_type", "config", "data_fingerprint"],
        "optional_fields": [],
        "field_types": {
            "event_type": str,
            "event_id": str,
            "timestamp_ms": int,
            "run_id": str,
            "run_type": str,  # "baseline" | "grid_search" | "random_search" | "walk_forward"
            "config": dict,
            "data_fingerprint": str
        }
    },
    "run.started": {
        "required_fields": ["event_type", "event_id", "timestamp_ms", "run_id"],
        "optional_fields": [],
        "field_types": {
            "event_type": str,
            "event_id": str,
            "timestamp_ms": int,
            "run_id": str
        }
    },
    "run.completed": {
        "required_fields": ["event_type", "event_id", "timestamp_ms", "run_id", "summary", "artifact_paths"],
        "optional_fields": [],
        "field_types": {
            "event_type": str,
            "event_id": str,
            "timestamp_ms": int,
            "run_id": str,
            "summary": dict,
            "artifact_paths": dict
        }
    },
    "phase.started": {
        "required_fields": ["event_type", "event_id", "timestamp_ms", "run_id", "phase_name", "phase_order"],
        "optional_fields": [],
        "field_types": {
            "event_type": str,
            "event_id": str,
            "timestamp_ms": int,
            "run_id": str,
            "phase_name": str,
            "phase_order": int
        }
    },
    "phase.completed": {
        "required_fields": ["event_type", "event_id", "timestamp_ms", "run_id", "phase_name", "duration_ms", "output_summary"],
        "optional_fields": [],
        "field_types": {
            "event_type": str,
            "event_id": str,
            "timestamp_ms": int,
            "run_id": str,
            "phase_name": str,
            "duration_ms": int,
            "output_summary": dict
        }
    },
    "trial.recorded": {
        "required_fields": ["event_type", "event_id", "timestamp_ms", "run_id", "trial_id", "params", "metrics"],
        "optional_fields": [],
        "field_types": {
            "event_type": str,
            "event_id": str,
            "timestamp_ms": int,
            "run_id": str,
            "trial_id": str,
            "params": dict,
            "metrics": dict
        }
    },
    "baseline.completed": {
        "required_fields": ["event_type", "event_id", "timestamp_ms", "run_id", "alerts_total", "alerts_ok", "artifact_path"],
        "optional_fields": [],
        "field_types": {
            "event_type": str,
            "event_id": str,
            "timestamp_ms": int,
            "run_id": str,
            "alerts_total": int,
            "alerts_ok": int,
            "artifact_path": str
        }
    },
    "artifact.created": {
        "required_fields": ["event_type", "event_id", "timestamp_ms", "run_id", "artifact_type", "artifact_path", "size_bytes"],
        "optional_fields": [],
        "field_types": {
            "event_type": str,
            "event_id": str,
            "timestamp_ms": int,
            "run_id": str,
            "artifact_type": str,
            "artifact_path": str,
            "size_bytes": int
        }
    }
}


def load_schema_registry() -> Dict[str, Any]:
    """Load schema registry from disk."""
    if SCHEMA_FILE.exists():
        with open(SCHEMA_FILE, 'r') as f:
            return json.load(f)
    else:
        # Initialize new registry
        registry = {
            "version": CURRENT_SCHEMA_VERSION,
            "created_at": datetime.utcnow().isoformat(),
            "event_types": {},
            "migrations": []
        }
        save_schema_registry(registry)
        return registry


def save_schema_registry(registry: Dict[str, Any]) -> None:
    """Save schema registry to disk."""
    SCHEMA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SCHEMA_FILE, 'w') as f:
        json.dump(registry, f, indent=2)


def validate_event(event: Dict[str, Any]) -> tuple[bool, Optional[str]]:
    """
    Validate event against schema.
    
    Args:
        event: Event dict to validate
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not isinstance(event, dict):
        return False, "Event must be a dictionary"
    
    event_type = event.get("event_type")
    if not event_type:
        return False, "Event must have 'event_type' field"
    
    if event_type not in EVENT_SCHEMAS:
        return False, f"Unknown event type: {event_type}"
    
    schema = EVENT_SCHEMAS[event_type]
    
    # Check required fields
    for field in schema["required_fields"]:
        if field not in event:
            return False, f"Missing required field: {field}"
    
    # Check field types (basic validation)
    for field, expected_type in schema["field_types"].items():
        if field not in event:
            continue  # Already checked required fields
        
        value = event[field]
        if expected_type == dict and not isinstance(value, dict):
            return False, f"Field '{field}' must be a dict, got {type(value).__name__}"
        elif expected_type == int and not isinstance(value, int):
            return False, f"Field '{field}' must be an int, got {type(value).__name__}"
        elif expected_type == str and not isinstance(value, str):
            return False, f"Field '{field}' must be a str, got {type(value).__name__}"
    
    return True, None


def register_event_type(
    event_type: str,
    required_fields: List[str],
    optional_fields: List[str],
    field_types: Dict[str, type]
) -> None:
    """
    Register a new event type in the schema registry.
    
    Args:
        event_type: Event type name (e.g., "run.created")
        required_fields: List of required field names
        optional_fields: List of optional field names
        field_types: Dict mapping field names to Python types
    """
    registry = load_schema_registry()
    
    registry["event_types"][event_type] = {
        "required_fields": required_fields,
        "optional_fields": optional_fields,
        "field_types": {k: v.__name__ for k, v in field_types.items()},
        "registered_at": datetime.utcnow().isoformat()
    }
    
    save_schema_registry(registry)


def get_schema_version() -> str:
    """Get current schema version."""
    registry = load_schema_registry()
    return registry.get("version", CURRENT_SCHEMA_VERSION)


def migrate_schema(from_version: str, to_version: str, migration_fn: callable) -> None:
    """
    Register a schema migration.
    
    Args:
        from_version: Source schema version
        to_version: Target schema version
        migration_fn: Function to migrate events from old to new schema
    """
    registry = load_schema_registry()
    
    migration = {
        "from_version": from_version,
        "to_version": to_version,
        "migration_fn": migration_fn.__name__,
        "created_at": datetime.utcnow().isoformat()
    }
    
    registry["migrations"].append(migration)
    save_schema_registry(registry)

