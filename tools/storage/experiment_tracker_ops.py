#!/usr/bin/env python3
"""
Experiment Tracker Operations

Wrapper script for experiment tracking operations.
Provides JSON stdin/stdout interface for TypeScript integration via PythonEngine.

Follows existing pattern used by:
- tools/storage/artifact_store_ops.py
- tools/storage/duckdb_run_events.py
"""

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
import duckdb


def ensure_schema(db_path: str) -> None:
    """Ensure experiment tracker schema exists"""
    schema_path = Path(__file__).parent / "experiment_tracker_schema.sql"
    
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")
    
    schema_sql = schema_path.read_text()
    
    con = duckdb.connect(db_path)
    con.execute(schema_sql)
    con.close()


def row_to_dict(row: Any) -> Dict[str, Any]:
    """Convert DuckDB row to dict with camelCase keys"""
    # DuckDB returns tuples, so access by index
    result = {
        'experimentId': row[0],
        'name': row[1],
        'status': row[3],
        'inputs': {
            'alerts': json.loads(row[4]),
            'ohlcv': json.loads(row[5]),
        },
        'config': json.loads(row[7]),
        'provenance': {
            'gitCommit': row[8],
            'gitDirty': bool(row[9]),
            'engineVersion': row[10],
            'createdAt': str(row[11]),
        },
    }
    
    # Add optional description if present
    if row[2]:
        result['description'] = row[2]
    
    # Add optional input_strategies if present
    if row[6]:
        result['inputs']['strategies'] = json.loads(row[6])
    
    # Add outputs if present
    if row[12] or row[13] or row[14] or row[15]:
        result['outputs'] = {}
        if row[12]:
            result['outputs']['trades'] = row[12]
        if row[13]:
            result['outputs']['metrics'] = row[13]
        if row[14]:
            result['outputs']['curves'] = row[14]
        if row[15]:
            result['outputs']['diagnostics'] = row[15]
    
    # Add execution metadata if present
    if row[16]:
        result['execution'] = {
            'startedAt': str(row[16]),
        }
        if row[17]:
            result['execution']['completedAt'] = str(row[17])
        if row[18] is not None:
            result['execution']['duration'] = row[18]
        if row[19]:
            result['execution']['error'] = row[19]
    
    return result


def create_experiment(db_path: str, definition: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new experiment"""
    ensure_schema(db_path)
    
    con = duckdb.connect(db_path)
    
    # Extract fields
    experiment_id = definition['experimentId']
    name = definition['name']
    description = definition.get('description')
    
    inputs = definition['inputs']
    input_alerts = json.dumps(inputs['alerts'])
    input_ohlcv = json.dumps(inputs['ohlcv'])
    input_strategies = json.dumps(inputs.get('strategies')) if inputs.get('strategies') else None
    
    config = json.dumps(definition['config'])
    
    provenance = definition['provenance']
    git_commit = provenance['gitCommit']
    git_dirty = provenance['gitDirty']
    engine_version = provenance['engineVersion']
    created_at = provenance['createdAt']
    
    # Insert experiment
    con.execute("""
        INSERT INTO experiments (
            experiment_id, name, description, status,
            input_alerts, input_ohlcv, input_strategies,
            config,
            git_commit, git_dirty, engine_version, created_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        experiment_id, name, description,
        input_alerts, input_ohlcv, input_strategies,
        config,
        git_commit, git_dirty, engine_version, created_at
    ))
    
    # Fetch created experiment
    row = con.execute(
        "SELECT * FROM experiments WHERE experiment_id = ?",
        (experiment_id,)
    ).fetchone()
    
    con.close()
    
    return row_to_dict(row)


def get_experiment(db_path: str, experiment_id: str) -> Dict[str, Any]:
    """Get experiment by ID"""
    ensure_schema(db_path)
    
    con = duckdb.connect(db_path)
    row = con.execute(
        "SELECT * FROM experiments WHERE experiment_id = ?",
        (experiment_id,)
    ).fetchone()
    con.close()
    
    if row is None:
        raise ValueError(f"Experiment not found: {experiment_id}")
    
    return row_to_dict(row)


def list_experiments(db_path: str, filter_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List experiments with filters"""
    ensure_schema(db_path)
    
    con = duckdb.connect(db_path)
    
    # Build WHERE clause from filter
    where_clauses = []
    params = []
    
    if filter_dict.get('status'):
        where_clauses.append("status = ?")
        params.append(filter_dict['status'])
    
    if filter_dict.get('gitCommit'):
        where_clauses.append("git_commit = ?")
        params.append(filter_dict['gitCommit'])
    
    if filter_dict.get('minCreatedAt'):
        where_clauses.append("created_at >= ?")
        params.append(filter_dict['minCreatedAt'])
    
    if filter_dict.get('maxCreatedAt'):
        where_clauses.append("created_at <= ?")
        params.append(filter_dict['maxCreatedAt'])
    
    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
    limit = filter_dict.get('limit', 100)
    
    rows = con.execute(
        f"SELECT * FROM experiments WHERE {where_sql} ORDER BY created_at DESC LIMIT ?",
        (*params, limit)
    ).fetchall()
    
    con.close()
    
    return [row_to_dict(row) for row in rows]


def update_status(db_path: str, experiment_id: str, status: str) -> Dict[str, bool]:
    """Update experiment status"""
    ensure_schema(db_path)
    
    # Validate status
    valid_statuses = ['pending', 'running', 'completed', 'failed', 'cancelled']
    if status not in valid_statuses:
        raise ValueError(f"Invalid status: {status}. Must be one of {valid_statuses}")
    
    con = duckdb.connect(db_path)
    
    # Update status and set started_at if transitioning to 'running'
    if status == 'running':
        con.execute("""
            UPDATE experiments 
            SET status = ?, started_at = CURRENT_TIMESTAMP
            WHERE experiment_id = ? AND started_at IS NULL
        """, (status, experiment_id))
    elif status in ['completed', 'failed', 'cancelled']:
        # Set completed_at and calculate duration
        con.execute("""
            UPDATE experiments 
            SET status = ?, 
                completed_at = CURRENT_TIMESTAMP,
                duration_ms = CASE 
                    WHEN started_at IS NOT NULL 
                    THEN CAST((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) * 1000) AS INTEGER)
                    ELSE NULL 
                END
            WHERE experiment_id = ?
        """, (status, experiment_id))
    else:
        con.execute(
            "UPDATE experiments SET status = ? WHERE experiment_id = ?",
            (status, experiment_id)
        )
    
    con.close()
    
    return {'success': True}


def store_results(db_path: str, experiment_id: str, results: Dict[str, Any]) -> Dict[str, bool]:
    """Store experiment results (output artifact IDs)"""
    ensure_schema(db_path)
    
    con = duckdb.connect(db_path)
    
    # Build UPDATE statement dynamically based on provided results
    updates = []
    params = []
    
    if results.get('tradesArtifactId'):
        updates.append("output_trades = ?")
        params.append(results['tradesArtifactId'])
    
    if results.get('metricsArtifactId'):
        updates.append("output_metrics = ?")
        params.append(results['metricsArtifactId'])
    
    if results.get('curvesArtifactId'):
        updates.append("output_curves = ?")
        params.append(results['curvesArtifactId'])
    
    if results.get('diagnosticsArtifactId'):
        updates.append("output_diagnostics = ?")
        params.append(results['diagnosticsArtifactId'])
    
    if not updates:
        con.close()
        return {'success': True}
    
    update_sql = ", ".join(updates)
    params.append(experiment_id)
    
    con.execute(
        f"UPDATE experiments SET {update_sql} WHERE experiment_id = ?",
        params
    )
    
    con.close()
    
    return {'success': True}


def find_by_input_artifacts(db_path: str, artifact_ids: List[str]) -> List[Dict[str, Any]]:
    """Find experiments by input artifact IDs"""
    ensure_schema(db_path)
    
    con = duckdb.connect(db_path)
    
    # Search in all input artifact columns using JSON contains
    # DuckDB JSON functions: json_contains checks if array contains value
    conditions = []
    for artifact_id in artifact_ids:
        conditions.append(f"""
            (list_contains(json_extract(input_alerts, '$'), '{artifact_id}')
             OR list_contains(json_extract(input_ohlcv, '$'), '{artifact_id}')
             OR (input_strategies IS NOT NULL AND list_contains(json_extract(input_strategies, '$'), '{artifact_id}')))
        """)
    
    where_clause = " OR ".join(conditions)
    
    rows = con.execute(
        f"SELECT * FROM experiments WHERE {where_clause} ORDER BY created_at DESC"
    ).fetchall()
    
    con.close()
    
    return [row_to_dict(row) for row in rows]


def main():
    """Main entry point - reads JSON from stdin, executes operation, writes JSON to stdout"""
    try:
        # Read input
        input_data = json.loads(sys.stdin.read())
        
        operation = input_data.get('operation')
        if not operation:
            raise ValueError("Missing 'operation' field")
        
        db_path = input_data.get('dbPath')
        if not db_path:
            raise ValueError("Missing 'dbPath' field")
        
        # Route to appropriate function
        if operation == 'create_experiment':
            definition = input_data.get('definition')
            if not definition:
                raise ValueError("Missing 'definition' field")
            result = create_experiment(db_path, definition)
        
        elif operation == 'get_experiment':
            experiment_id = input_data.get('experimentId')
            if not experiment_id:
                raise ValueError("Missing 'experimentId' field")
            result = get_experiment(db_path, experiment_id)
        
        elif operation == 'list_experiments':
            filter_dict = input_data.get('filter', {})
            result = list_experiments(db_path, filter_dict)
        
        elif operation == 'update_status':
            experiment_id = input_data.get('experimentId')
            status = input_data.get('status')
            if not experiment_id or not status:
                raise ValueError("Missing 'experimentId' or 'status' field")
            result = update_status(db_path, experiment_id, status)
        
        elif operation == 'store_results':
            experiment_id = input_data.get('experimentId')
            results = input_data.get('results')
            if not experiment_id or not results:
                raise ValueError("Missing 'experimentId' or 'results' field")
            result = store_results(db_path, experiment_id, results)
        
        elif operation == 'find_by_input_artifacts':
            artifact_ids = input_data.get('artifactIds')
            if not artifact_ids:
                raise ValueError("Missing 'artifactIds' field")
            result = find_by_input_artifacts(db_path, artifact_ids)
        
        else:
            raise ValueError(f"Unknown operation: {operation}")
        
        # Write result
        print(json.dumps(result))
        sys.exit(0)
    
    except Exception as e:
        # Write error
        error_result = {
            'error': str(e),
            'type': type(e).__name__
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == '__main__':
    main()

