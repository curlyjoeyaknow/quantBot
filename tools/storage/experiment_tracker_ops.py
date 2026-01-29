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
import time
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

# Import shared DuckDB adapter for proper connection management
try:
    from tools.shared.duckdb_adapter import (
        get_readonly_connection,
        get_write_connection,
        is_lock_error,
    )
except ImportError:
    # Fallback if shared adapter not available (shouldn't happen in normal usage)
    import duckdb
    
    def get_readonly_connection(db_path: str):
        """Fallback read-only connection"""
        return duckdb.connect(db_path, read_only=True)
    
    def get_write_connection(db_path: str):
        """Fallback write connection"""
        return duckdb.connect(db_path, read_only=False)
    
    def is_lock_error(e: Exception) -> bool:
        """Fallback lock error check"""
        msg = str(e).lower()
        return "lock" in msg or "conflicting" in msg or "could not set lock" in msg


# Input validation functions
def validate_artifact_id(artifact_id: str) -> bool:
    """Validate artifact ID format (alphanumeric, hyphens, underscores only)"""
    if not artifact_id or len(artifact_id) > 100:
        return False
    return bool(re.match(r'^[a-zA-Z0-9_-]+$', artifact_id))


def validate_experiment_id(experiment_id: str) -> bool:
    """Validate experiment ID format"""
    if not experiment_id or len(experiment_id) > 100:
        return False
    return bool(re.match(r'^[a-zA-Z0-9_-]+$', experiment_id))


def validate_status(status: str) -> bool:
    """Validate experiment status"""
    valid_statuses = ['pending', 'running', 'completed', 'failed', 'cancelled']
    return status in valid_statuses


def validate_git_commit(commit: str) -> bool:
    """Validate git commit hash format"""
    if not commit or len(commit) > 40:
        return False
    # Allow alphanumeric for flexibility (some test scenarios use non-standard formats)
    # Real git commits are hex (a-f0-9), but we allow alphanumeric for test flexibility
    return bool(re.match(r'^[a-zA-Z0-9]+$', commit))


def validate_date_string(date_str: str) -> bool:
    """Validate ISO 8601 date string"""
    try:
        datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return True
    except (ValueError, AttributeError):
        return False


def validate_limit(limit: int) -> bool:
    """Validate limit (must be positive and reasonable)"""
    return isinstance(limit, int) and 1 <= limit <= 10000


def ensure_schema(db_path: str) -> None:
    """Ensure experiment tracker schema exists"""
    schema_path = Path(__file__).parent / "experiment_tracker_schema.sql"
    
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")
    
    # Check if schema already exists using read-only connection (avoids write lock)
    try:
        with get_readonly_connection(db_path) as con:
            # Try to query the experiments table - if it exists, schema is already there
            con.execute("SELECT 1 FROM experiments LIMIT 1")
            return  # Schema exists, no need to create
    except Exception:
        # Schema doesn't exist or table doesn't exist, need to create it
        pass
    
    # Schema doesn't exist - use write connection to create it
    schema_sql = schema_path.read_text()
    with get_write_connection(db_path) as con:
        con.execute(schema_sql)


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
    
    # Validate experiment ID
    experiment_id = definition.get('experimentId')
    if not experiment_id or not validate_experiment_id(experiment_id):
        raise ValueError(f"Invalid experiment ID format: {experiment_id}")
    
    # Validate artifact IDs
    inputs = definition.get('inputs', {})
    for artifact_id in inputs.get('alerts', []):
        if not validate_artifact_id(artifact_id):
            raise ValueError(f"Invalid artifact ID format in alerts: {artifact_id}")
    for artifact_id in inputs.get('ohlcv', []):
        if not validate_artifact_id(artifact_id):
            raise ValueError(f"Invalid artifact ID format in ohlcv: {artifact_id}")
    for artifact_id in inputs.get('strategies', []):
        if not validate_artifact_id(artifact_id):
            raise ValueError(f"Invalid artifact ID format in strategies: {artifact_id}")
    
    # Use write connection for INSERT operation
    with get_write_connection(db_path) as con:
        # Use transaction for atomicity
        con.execute("BEGIN TRANSACTION")
        try:
            # Extract fields (already validated above)
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
            
            con.execute("COMMIT")
            return row_to_dict(row)
        except Exception:
            con.execute("ROLLBACK")
            raise


def get_experiment(db_path: str, experiment_id: str) -> Dict[str, Any]:
    """Get experiment by ID"""
    ensure_schema(db_path)
    
    # Validate experiment ID
    if not experiment_id or not validate_experiment_id(experiment_id):
        raise ValueError(f"Invalid experiment ID format: {experiment_id}")
    
    # Use read-only connection for SELECT operation (allows concurrent reads)
    with get_readonly_connection(db_path) as con:
        row = con.execute(
            "SELECT * FROM experiments WHERE experiment_id = ?",
            (experiment_id,)
        ).fetchone()
        
        if row is None:
            raise ValueError(f"Experiment not found: {experiment_id}")
        
        return row_to_dict(row)


def list_experiments(db_path: str, filter_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List experiments with filters"""
    ensure_schema(db_path)
    
    # Validate filter parameters
    if filter_dict.get('status'):
        status = filter_dict['status']
        if not validate_status(status):
            raise ValueError(f"Invalid status: {status}. Must be one of ['pending', 'running', 'completed', 'failed', 'cancelled']")
    
    if filter_dict.get('gitCommit'):
        git_commit = filter_dict['gitCommit']
        if not validate_git_commit(git_commit):
            raise ValueError(f"Invalid git commit format: {git_commit}")
    
    if filter_dict.get('minCreatedAt'):
        min_date = filter_dict['minCreatedAt']
        if not validate_date_string(min_date):
            raise ValueError(f"Invalid date format: {min_date}")
    
    if filter_dict.get('maxCreatedAt'):
        max_date = filter_dict['maxCreatedAt']
        if not validate_date_string(max_date):
            raise ValueError(f"Invalid date format: {max_date}")
    
    limit = filter_dict.get('limit', 100)
    if not validate_limit(limit):
        raise ValueError(f"Invalid limit: {limit}. Must be between 1 and 10000")
    
    # Use read-only connection for SELECT operation (allows concurrent reads)
    with get_readonly_connection(db_path) as con:
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
        
        rows = con.execute(
            f"SELECT * FROM experiments WHERE {where_sql} ORDER BY created_at DESC LIMIT ?",
            (*params, limit)
        ).fetchall()
        
        return [row_to_dict(row) for row in rows]


def update_status(db_path: str, experiment_id: str, status: str) -> Dict[str, bool]:
    """Update experiment status"""
    ensure_schema(db_path)
    
    # Validate experiment ID
    if not experiment_id or not validate_experiment_id(experiment_id):
        raise ValueError(f"Invalid experiment ID format: {experiment_id}")
    
    # Validate status
    if not validate_status(status):
        raise ValueError(f"Invalid status: {status}. Must be one of ['pending', 'running', 'completed', 'failed', 'cancelled']")
    
    # Use write connection for UPDATE operation
    # Retry on lock errors for concurrent write scenarios
    max_retries = 3
    retry_delay = 0.1
    
    for attempt in range(max_retries):
        try:
            with get_write_connection(db_path) as con:
                # Use transaction for atomicity
                con.execute("BEGIN TRANSACTION")
                try:
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
                    
                    con.execute("COMMIT")
                    return {'success': True}
                except Exception:
                    con.execute("ROLLBACK")
                    raise
        except Exception as e:
            if is_lock_error(e) and attempt < max_retries - 1:
                # Retry on lock errors with exponential backoff
                time.sleep(retry_delay * (attempt + 1))
                continue
            raise


def store_results(db_path: str, experiment_id: str, results: Dict[str, Any]) -> Dict[str, bool]:
    """Store experiment results (output artifact IDs)"""
    ensure_schema(db_path)
    
    # Validate experiment ID
    if not experiment_id or not validate_experiment_id(experiment_id):
        raise ValueError(f"Invalid experiment ID format: {experiment_id}")
    
    # Validate artifact IDs
    if results.get('tradesArtifactId') and not validate_artifact_id(results['tradesArtifactId']):
        raise ValueError(f"Invalid artifact ID format: {results['tradesArtifactId']}")
    if results.get('metricsArtifactId') and not validate_artifact_id(results['metricsArtifactId']):
        raise ValueError(f"Invalid artifact ID format: {results['metricsArtifactId']}")
    if results.get('curvesArtifactId') and not validate_artifact_id(results['curvesArtifactId']):
        raise ValueError(f"Invalid artifact ID format: {results['curvesArtifactId']}")
    if results.get('diagnosticsArtifactId') and not validate_artifact_id(results['diagnosticsArtifactId']):
        raise ValueError(f"Invalid artifact ID format: {results['diagnosticsArtifactId']}")
    
    # Use write connection for UPDATE operation
    # Retry on lock errors for concurrent write scenarios
    max_retries = 3
    retry_delay = 0.1
    
    for attempt in range(max_retries):
        try:
            with get_write_connection(db_path) as con:
                # Use transaction for atomicity
                con.execute("BEGIN TRANSACTION")
                try:
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
                        con.execute("COMMIT")
                        return {'success': True}
                    
                    update_sql = ", ".join(updates)
                    params.append(experiment_id)
                    
                    con.execute(
                        f"UPDATE experiments SET {update_sql} WHERE experiment_id = ?",
                        params
                    )
                    
                    con.execute("COMMIT")
                    return {'success': True}
                except Exception:
                    con.execute("ROLLBACK")
                    raise
        except Exception as e:
            if is_lock_error(e) and attempt < max_retries - 1:
                # Retry on lock errors with exponential backoff
                time.sleep(retry_delay * (attempt + 1))
                continue
            raise


def find_by_input_artifacts(db_path: str, artifact_ids: List[str]) -> List[Dict[str, Any]]:
    """Find experiments by input artifact IDs"""
    ensure_schema(db_path)
    
    # Validate all artifact IDs
    for artifact_id in artifact_ids:
        if not validate_artifact_id(artifact_id):
            raise ValueError(f"Invalid artifact ID format: {artifact_id}")
    
    # Use read-only connection for SELECT operation (allows concurrent reads)
    with get_readonly_connection(db_path) as con:
        # Use parameterized LIKE queries for safe matching
        # Since artifact IDs are validated, we can safely construct JSON pattern strings
        # The pattern will be: %"artifact-id"% (JSON array format)
        conditions = []
        params = []
        
        for artifact_id in artifact_ids:
            # Create JSON pattern string (artifact IDs are already validated)
            # Format: "artifact-id" as it appears in JSON array
            json_pattern = f'"{artifact_id}"'
            # Use parameterized LIKE queries - all values come from params array
            conditions.append("""
                (input_alerts LIKE ? ESCAPE '\\'
                 OR input_ohlcv LIKE ? ESCAPE '\\'
                 OR (input_strategies IS NOT NULL AND input_strategies LIKE ? ESCAPE '\\'))
            """)
            # Add pattern with wildcards for LIKE matching
            params.extend([f'%{json_pattern}%', f'%{json_pattern}%', f'%{json_pattern}%'])
        
        where_clause = " OR ".join(conditions)
        
        # Use parameterized query - all values are in params array, no string interpolation
        rows = con.execute(
            f"SELECT * FROM experiments WHERE {where_clause} ORDER BY created_at DESC",
            params
        ).fetchall()
        
        return [row_to_dict(row) for row in rows]


def main():
    """Main entry point - reads JSON from stdin, executes operation, writes JSON to stdout"""
    input_data = None
    operation = 'unknown'
    
    try:
        # Read input
        input_data = json.loads(sys.stdin.read())
        
        operation = input_data.get('operation', 'unknown')
        if not operation or operation == 'unknown':
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
        # Write error with operation context
        import traceback
        import os
        error_result = {
            'error': str(e),
            'type': type(e).__name__,
            'operation': operation,
            'traceback': traceback.format_exc() if os.getenv('DEBUG') else None
        }
        json.dump(error_result, sys.stderr, indent=2)
        sys.stderr.write('\n')
        sys.exit(1)


if __name__ == '__main__':
    main()

