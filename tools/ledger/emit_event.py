#!/usr/bin/env python3
"""
Event Emission CLI - Called from TypeScript to emit events.

Usage:
    python tools/ledger/emit_event.py --event-type run.created --run-id abc123 --run-type baseline --config '{"key": "value"}' --data-fingerprint hash123
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add tools/ledger to path
_script_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(_script_dir))

from event_writer import (
    append_event,
    emit_run_created,
    emit_run_started,
    emit_run_completed,
    emit_phase_started,
    emit_phase_completed,
    emit_trial_recorded,
    emit_baseline_completed,
    emit_artifact_created
)
from schema_registry import validate_event


def main():
    parser = argparse.ArgumentParser(description='Emit event to event log')
    parser.add_argument('--event-type', required=True, help='Event type (e.g., run.created)')
    parser.add_argument('--run-id', help='Run ID')
    parser.add_argument('--run-type', help='Run type (baseline, grid_search, etc.)')
    parser.add_argument('--config', help='Config JSON string')
    parser.add_argument('--data-fingerprint', help='Data fingerprint')
    parser.add_argument('--summary', help='Summary JSON string')
    parser.add_argument('--artifact-paths', help='Artifact paths JSON string')
    parser.add_argument('--phase-name', help='Phase name')
    parser.add_argument('--phase-order', type=int, help='Phase order')
    parser.add_argument('--duration-ms', type=int, help='Duration in milliseconds')
    parser.add_argument('--output-summary', help='Output summary JSON string')
    parser.add_argument('--trial-id', help='Trial ID')
    parser.add_argument('--params', help='Params JSON string')
    parser.add_argument('--metrics', help='Metrics JSON string')
    parser.add_argument('--alerts-total', type=int, help='Total alerts')
    parser.add_argument('--alerts-ok', type=int, help='OK alerts')
    parser.add_argument('--artifact-path', help='Artifact path')
    parser.add_argument('--artifact-type', help='Artifact type')
    parser.add_argument('--size-bytes', type=int, help='Size in bytes')
    parser.add_argument('--event-data', help='Full event JSON string (for custom events)')
    
    args = parser.parse_args()
    
    try:
        # Build event based on event type
        if args.event_type == 'run.created':
            if not args.run_id or not args.run_type or not args.config or not args.data_fingerprint:
                print(json.dumps({"success": False, "error": "Missing required fields for run.created"}))
                sys.exit(1)
            
            config = json.loads(args.config) if isinstance(args.config, str) else args.config
            emit_run_created(
                run_id=args.run_id,
                run_type=args.run_type,
                config=config,
                data_fingerprint=args.data_fingerprint
            )
        
        elif args.event_type == 'run.started':
            if not args.run_id:
                print(json.dumps({"success": False, "error": "Missing required field: run_id"}))
                sys.exit(1)
            
            emit_run_started(run_id=args.run_id)
        
        elif args.event_type == 'run.completed':
            if not args.run_id or not args.summary or not args.artifact_paths:
                print(json.dumps({"success": False, "error": "Missing required fields for run.completed"}))
                sys.exit(1)
            
            summary = json.loads(args.summary) if isinstance(args.summary, str) else args.summary
            artifact_paths = json.loads(args.artifact_paths) if isinstance(args.artifact_paths, str) else args.artifact_paths
            emit_run_completed(
                run_id=args.run_id,
                summary=summary,
                artifact_paths=artifact_paths
            )
        
        elif args.event_type == 'phase.started':
            if not args.run_id or not args.phase_name or args.phase_order is None:
                print(json.dumps({"success": False, "error": "Missing required fields for phase.started"}))
                sys.exit(1)
            
            emit_phase_started(
                run_id=args.run_id,
                phase_name=args.phase_name,
                phase_order=args.phase_order
            )
        
        elif args.event_type == 'phase.completed':
            if not args.run_id or not args.phase_name or args.duration_ms is None or not args.output_summary:
                print(json.dumps({"success": False, "error": "Missing required fields for phase.completed"}))
                sys.exit(1)
            
            output_summary = json.loads(args.output_summary) if isinstance(args.output_summary, str) else args.output_summary
            emit_phase_completed(
                run_id=args.run_id,
                phase_name=args.phase_name,
                duration_ms=args.duration_ms,
                output_summary=output_summary
            )
        
        elif args.event_type == 'trial.recorded':
            if not args.run_id or not args.trial_id or not args.params or not args.metrics:
                print(json.dumps({"success": False, "error": "Missing required fields for trial.recorded"}))
                sys.exit(1)
            
            params = json.loads(args.params) if isinstance(args.params, str) else args.params
            metrics = json.loads(args.metrics) if isinstance(args.metrics, str) else args.metrics
            emit_trial_recorded(
                run_id=args.run_id,
                trial_id=args.trial_id,
                params=params,
                metrics=metrics
            )
        
        elif args.event_type == 'baseline.completed':
            if not args.run_id or args.alerts_total is None or args.alerts_ok is None or not args.artifact_path:
                print(json.dumps({"success": False, "error": "Missing required fields for baseline.completed"}))
                sys.exit(1)
            
            emit_baseline_completed(
                run_id=args.run_id,
                alerts_total=args.alerts_total,
                alerts_ok=args.alerts_ok,
                artifact_path=args.artifact_path
            )
        
        elif args.event_type == 'artifact.created':
            if not args.run_id or not args.artifact_type or not args.artifact_path or args.size_bytes is None:
                print(json.dumps({"success": False, "error": "Missing required fields for artifact.created"}))
                sys.exit(1)
            
            emit_artifact_created(
                run_id=args.run_id,
                artifact_type=args.artifact_type,
                artifact_path=args.artifact_path,
                size_bytes=args.size_bytes
            )
        
        elif args.event_data:
            # Custom event - parse full event JSON
            event = json.loads(args.event_data)
            is_valid, error = validate_event(event)
            if not is_valid:
                print(json.dumps({"success": False, "error": f"Invalid event: {error}"}))
                sys.exit(1)
            append_event(event)
        
        else:
            print(json.dumps({"success": False, "error": f"Unknown event type: {args.event_type}"}))
            sys.exit(1)
        
        print(json.dumps({"success": True}))
    
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()

