"""
Experiment Deduplication

Checks if an experiment with the same parameter vector hash already exists.
Python performs database queries, TypeScript orchestrates.
"""

import json
import sys
import duckdb
from typing import Dict, Any, Optional


def check_duplicate_experiment(
    duckdb_path: str,
    parameter_vector_hash: str
) -> Optional[Dict[str, Any]]:
    """
    Check if an experiment with the same parameter vector hash already exists.
    
    Args:
        duckdb_path: Path to DuckDB database
        parameter_vector_hash: Parameter vector hash to check
        
    Returns:
        Existing experiment metadata if found, None otherwise
    """
    try:
        con = duckdb.connect(duckdb_path, read_only=True)
        
        # Check if experiments table exists
        try:
            result = con.execute("""
                SELECT 
                    experiment_id,
                    strategy_id,
                    data_snapshot_hash,
                    parameter_vector_hash,
                    git_commit_hash,
                    status,
                    created_at
                FROM experiments
                WHERE parameter_vector_hash = ?
                LIMIT 1
            """, [parameter_vector_hash]).fetchone()
            
            if result:
                return {
                    'experimentId': result[0],
                    'strategyId': result[1],
                    'dataSnapshotHash': result[2],
                    'parameterVectorHash': result[3],
                    'gitCommitHash': result[4],
                    'status': result[5],
                    'createdAt': result[6],
                }
        except Exception as e:
            # Table might not exist or have different schema
            # Try alternative table name
            try:
                result = con.execute("""
                    SELECT 
                        run_id,
                        strategy_id,
                        data_snapshot_hash,
                        parameter_vector_hash,
                        git_commit_hash,
                        status,
                        created_at
                    FROM simulation_runs
                    WHERE parameter_vector_hash = ?
                    LIMIT 1
                """, [parameter_vector_hash]).fetchone()
                
                if result:
                    return {
                        'experimentId': result[0],
                        'strategyId': result[1],
                        'dataSnapshotHash': result[2],
                        'parameterVectorHash': result[3],
                        'gitCommitHash': result[4],
                        'status': result[5],
                        'createdAt': result[6],
                    }
            except Exception:
                # Table doesn't exist or schema is different
                pass
        
        con.close()
        return None
    except Exception as e:
        # Database error - return None (let TypeScript handle it)
        return None


def main():
    """Main entry point for PythonEngine calls."""
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Missing input JSON'}), file=sys.stderr)
        sys.exit(1)
    
    try:
        # Parse input JSON from stdin or first argument
        input_data = json.loads(sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read())
        
        duckdb_path = input_data.get('duckdbPath')
        parameter_vector_hash = input_data.get('parameterVectorHash')
        
        if not duckdb_path or not parameter_vector_hash:
            print(json.dumps({'error': 'Missing duckdbPath or parameterVectorHash'}), file=sys.stderr)
            sys.exit(1)
        
        existing = check_duplicate_experiment(duckdb_path, parameter_vector_hash)
        
        # Output result as JSON
        result = {
            'exists': existing is not None,
            'experiment': existing,
        }
        print(json.dumps(result))
    except Exception as e:
        error_result = {
            'error': str(e),
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

