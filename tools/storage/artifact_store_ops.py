#!/usr/bin/env python3
"""
Artifact Store Operations

Wrapper script for artifact_store Python package.
Provides JSON stdin/stdout interface for TypeScript integration via PythonEngine.

Follows existing pattern used by:
- tools/storage/duckdb_run_events.py
- tools/storage/duckdb_canonical.py
- tools/storage/duckdb_artifacts.py
"""

import json
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List

# Import artifact_store package
from artifact_store.manifest import (
    connect_manifest,
    supersede as manifest_supersede,
)
from artifact_store.publisher import publish_dataframe
import pandas as pd


def validate_filter_key(key: str) -> bool:
    """Validate filter key is safe (alphanumeric + underscore only)"""
    return bool(re.match(r'^[a-zA-Z0-9_]+$', key))


def validate_filter_value(value: str) -> bool:
    """Validate filter value doesn't contain SQL injection attempts"""
    # Check for common SQL injection patterns
    dangerous_patterns = [
        r';\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE)',
        r'--',
        r'/\*',
        r'\*/',
        r"'\s*OR\s*'",
        r"'\s*AND\s*'",
    ]
    for pattern in dangerous_patterns:
        if re.search(pattern, value, re.IGNORECASE):
            return False
    return True


def row_to_dict(row: Any) -> Dict[str, Any]:
    """Convert SQLite row to dict with camelCase keys"""
    return {
        'artifactId': row['artifact_id'],
        'artifactType': row['artifact_type'],
        'schemaVersion': row['schema_version'],
        'logicalKey': row['logical_key'],
        'status': row['status'],
        'pathParquet': row['path_parquet'],
        'pathSidecar': row['path_sidecar'],
        'fileHash': row['file_hash'],
        'contentHash': row['content_hash'],
        'rowCount': row['row_count'],
        'minTs': row['min_ts'],
        'maxTs': row['max_ts'],
        'createdAt': row['created_at'],
    }


def get_artifact(manifest_db: str, artifact_id: str) -> Dict[str, Any]:
    """Get artifact by ID"""
    con = connect_manifest(Path(manifest_db))
    row = con.execute(
        "SELECT * FROM artifacts WHERE artifact_id = ?",
        (artifact_id,)
    ).fetchone()
    con.close()
    
    if row is None:
        raise ValueError(f"Artifact not found: {artifact_id}")
    
    return row_to_dict(row)


def get_artifacts_batch(manifest_db: str, artifact_ids: List[str]) -> List[Dict[str, Any]]:
    """Get multiple artifacts by IDs (batch operation)"""
    if not artifact_ids:
        return []
    
    con = connect_manifest(Path(manifest_db))
    
    # Use IN clause for batch query
    placeholders = ','.join('?' * len(artifact_ids))
    rows = con.execute(
        f"SELECT * FROM artifacts WHERE artifact_id IN ({placeholders})",
        artifact_ids
    ).fetchall()
    con.close()
    
    # Create a map of artifact_id -> artifact for quick lookup
    artifact_map = {row['artifact_id']: row_to_dict(row) for row in rows}
    
    # Return artifacts in the same order as requested, with None for missing ones
    # (caller can filter out None values if needed)
    result = []
    for artifact_id in artifact_ids:
        if artifact_id in artifact_map:
            result.append(artifact_map[artifact_id])
        else:
            # Include None to maintain order and indicate missing artifact
            result.append(None)
    
    return result


def list_artifacts(manifest_db: str, filter_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List artifacts with filters"""
    con = connect_manifest(Path(manifest_db))
    
    # Build WHERE clause from filter
    where_clauses = []
    params = []
    
    # Validate and filter artifactType
    if filter_dict.get('artifactType'):
        artifact_type = str(filter_dict['artifactType'])
        if not validate_filter_value(artifact_type):
            raise ValueError(f"Invalid artifactType value: {artifact_type}")
        where_clauses.append("artifact_type = ?")
        params.append(artifact_type)
    
    # Validate and filter status
    if filter_dict.get('status'):
        status = str(filter_dict['status'])
        if status not in ('active', 'superseded', 'tombstoned'):
            raise ValueError(f"Invalid status value: {status}")
        where_clauses.append("status = ?")
        params.append(status)
    
    # Validate and filter minCreatedAt
    if filter_dict.get('minCreatedAt'):
        min_created_at = str(filter_dict['minCreatedAt'])
        if not validate_filter_value(min_created_at):
            raise ValueError(f"Invalid minCreatedAt value: {min_created_at}")
        where_clauses.append("created_at >= ?")
        params.append(min_created_at)
    
    # Validate and filter maxCreatedAt
    if filter_dict.get('maxCreatedAt'):
        max_created_at = str(filter_dict['maxCreatedAt'])
        if not validate_filter_value(max_created_at):
            raise ValueError(f"Invalid maxCreatedAt value: {max_created_at}")
        where_clauses.append("created_at <= ?")
        params.append(max_created_at)
    
    # Tag filtering (if provided) - validate keys and values
    if filter_dict.get('tags'):
        if not isinstance(filter_dict['tags'], dict):
            raise ValueError("tags must be a dictionary")
        for k, v in filter_dict['tags'].items():
            # Validate tag key
            if not validate_filter_key(str(k)):
                raise ValueError(f"Invalid tag key: {k}")
            # Validate tag value
            tag_value = str(v)
            if not validate_filter_value(tag_value):
                raise ValueError(f"Invalid tag value: {tag_value}")
            where_clauses.append(
                "artifact_id IN (SELECT artifact_id FROM artifact_tags WHERE k = ? AND v = ?)"
            )
            params.extend([k, tag_value])
    
    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
    limit = filter_dict.get('limit', 100)
    
    # Validate limit
    if not isinstance(limit, int) or limit < 1 or limit > 10000:
        raise ValueError(f"Invalid limit value: {limit} (must be between 1 and 10000)")
    
    rows = con.execute(
        f"SELECT * FROM artifacts WHERE {where_sql} ORDER BY created_at DESC LIMIT ?",
        (*params, limit)
    ).fetchall()
    con.close()
    
    return [row_to_dict(row) for row in rows]


def find_by_logical_key(
    manifest_db: str,
    artifact_type: str,
    logical_key: str
) -> List[Dict[str, Any]]:
    """Find artifacts by logical key"""
    con = connect_manifest(Path(manifest_db))
    rows = con.execute(
        """
        SELECT * FROM artifacts
        WHERE artifact_type = ? AND logical_key = ?
        ORDER BY created_at DESC
        """,
        (artifact_type, logical_key)
    ).fetchall()
    con.close()
    
    return [row_to_dict(row) for row in rows]


def publish_artifact_op(
    manifest_db: str,
    manifest_sql: str,
    artifacts_root: str,
    request: Dict[str, Any]
) -> Dict[str, Any]:
    """Publish artifact using artifact_store package"""
    # Load data from file
    data_path = request['data_path']
    if data_path.endswith('.csv'):
        df = pd.read_csv(data_path)
    elif data_path.endswith('.parquet'):
        df = pd.read_parquet(data_path)
    else:
        raise ValueError(f"Unsupported file format: {data_path}")
    
    # Publish using artifact_store
    result = publish_dataframe(
        manifest_db=Path(manifest_db),
        manifest_sql=Path(manifest_sql),
        artifacts_root=Path(artifacts_root),
        artifact_type=request['artifact_type'],
        schema_version=request['schema_version'],
        logical_key=request['logical_key'],
        df=df,
        tags=[(k, v) for k, v in request.get('tags', {}).items()],
        input_artifact_ids=request.get('input_artifact_ids', []),
        writer_name=request['writer_name'],
        writer_version=request['writer_version'],
        git_commit=request['git_commit'],
        git_dirty=request['git_dirty'],
        params=request.get('params', {}),
        filename_hint=request.get('filename_hint'),
    )
    
    # Handle deduplication result
    if result.get('deduped'):
        return {
            'success': True,
            'deduped': True,
            'mode': result.get('mode'),
            'existingArtifactId': result.get('existing_artifact_id'),
        }
    
    # New artifact published
    return {
        'success': True,
        'deduped': False,
        'artifactId': result['artifact_id'],
        'pathParquet': result['paths']['parquet'],
        'pathSidecar': result['paths']['sidecar'],
    }


def get_lineage(manifest_db: str, artifact_id: str) -> Dict[str, Any]:
    """Get artifact lineage (inputs)"""
    con = connect_manifest(Path(manifest_db))
    
    # Get input artifacts
    rows = con.execute(
        """
        SELECT a.* FROM artifacts a
        JOIN artifact_lineage l ON a.artifact_id = l.input_artifact_id
        WHERE l.artifact_id = ?
        ORDER BY a.created_at
        """,
        (artifact_id,)
    ).fetchall()
    con.close()
    
    inputs = [row_to_dict(row) for row in rows]
    
    return {
        'artifactId': artifact_id,
        'inputs': inputs,
        'depth': 1,  # Simple implementation, can be extended for recursive lineage
    }


def get_downstream(manifest_db: str, artifact_id: str) -> List[Dict[str, Any]]:
    """Get downstream artifacts (outputs that depend on this artifact)"""
    con = connect_manifest(Path(manifest_db))
    
    # Get downstream artifacts
    rows = con.execute(
        """
        SELECT a.* FROM artifacts a
        JOIN artifact_lineage l ON a.artifact_id = l.artifact_id
        WHERE l.input_artifact_id = ?
        ORDER BY a.created_at DESC
        """,
        (artifact_id,)
    ).fetchall()
    con.close()
    
    return [row_to_dict(row) for row in rows]


def supersede_artifact(manifest_db: str, new_artifact_id: str, old_artifact_id: str) -> Dict[str, Any]:
    """Supersede old artifact with new one"""
    con = connect_manifest(Path(manifest_db))
    manifest_supersede(con, new_artifact_id=new_artifact_id, old_artifact_id=old_artifact_id)
    con.close()
    
    return {'success': True}


def health_check(manifest_db: str) -> Dict[str, Any]:
    """Check if artifact store is available
    
    Verifies:
    - Database file exists and is accessible
    - Database schema is valid (artifacts table exists)
    - Can execute queries
    """
    try:
        # Check if manifest DB file exists
        manifest_path = Path(manifest_db)
        if not manifest_path.exists():
            return {'available': False, 'error': f'Manifest database not found: {manifest_db}'}
        
        # Check file permissions
        if not os.access(manifest_path, os.R_OK):
            return {'available': False, 'error': f'Manifest database not readable: {manifest_db}'}
        
        # Connect and verify schema
        con = connect_manifest(manifest_path)
        
        # Verify artifacts table exists
        table_check = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='artifacts'"
        ).fetchone()
        if table_check is None:
            con.close()
            return {'available': False, 'error': 'Artifacts table not found in manifest database'}
        
        # Test query execution
        con.execute("SELECT 1").fetchone()
        con.close()
        
        return {'available': True}
    except Exception as e:
        return {'available': False, 'error': str(e), 'type': type(e).__name__}


def main() -> None:
    """Main entry point - reads JSON from stdin, executes operation, writes JSON to stdout"""
    input_data = None
    operation = None
    try:
        input_data = json.load(sys.stdin)
        operation = input_data.get('operation')
        
        if not operation:
            raise ValueError("Missing required field: operation")
        
        if operation == 'get_artifact':
            result = get_artifact(input_data['manifest_db'], input_data['artifact_id'])
        elif operation == 'get_artifacts_batch':
            result = get_artifacts_batch(input_data['manifest_db'], input_data['artifact_ids'])
        elif operation == 'list_artifacts':
            result = list_artifacts(input_data['manifest_db'], input_data.get('filter', {}))
        elif operation == 'find_by_logical_key':
            result = find_by_logical_key(
                input_data['manifest_db'],
                input_data['artifact_type'],
                input_data['logical_key']
            )
        elif operation == 'publish_artifact':
            result = publish_artifact_op(
                input_data['manifest_db'],
                input_data['manifest_sql'],
                input_data['artifacts_root'],
                input_data
            )
        elif operation == 'get_lineage':
            result = get_lineage(input_data['manifest_db'], input_data['artifact_id'])
        elif operation == 'get_downstream':
            result = get_downstream(input_data['manifest_db'], input_data['artifact_id'])
        elif operation == 'supersede':
            result = supersede_artifact(
                input_data['manifest_db'],
                input_data['new_artifact_id'],
                input_data['old_artifact_id']
            )
        elif operation == 'health_check':
            result = health_check(input_data['manifest_db'])
        else:
            raise ValueError(f"Unknown operation: {operation}")
        
        json.dump(result, sys.stdout, indent=2)
        sys.exit(0)
    except Exception as e:
        # Build error result with context
        error_result = {
            'error': str(e),
            'type': type(e).__name__,
            'operation': operation or 'unknown',
        }
        
        # Include stack trace if DEBUG environment variable is set
        if os.getenv('DEBUG') or os.getenv('ARTIFACT_STORE_DEBUG'):
            error_result['traceback'] = traceback.format_exc()
        
        json.dump(error_result, sys.stderr, indent=2)
        sys.exit(1)


if __name__ == '__main__':
    main()

