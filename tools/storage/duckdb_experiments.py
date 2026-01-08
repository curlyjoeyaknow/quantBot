"""
DuckDB Experiment Repository

Provides query operations for experiment tracking data stored in simulation_runs table.
Supports filtering by experiment ID, strategy, parameter hash, git commit, data snapshot, status, and time range.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import duckdb
except ImportError:
    print('Error: duckdb package not installed', file=sys.stderr)
    sys.exit(1)


def ensure_experiment_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Ensure experiment tracking columns exist in simulation_runs table."""
    # Check if columns exist, if not add them
    # We'll use ALTER TABLE ADD COLUMN IF NOT EXISTS (DuckDB supports this)
    
    columns_to_add = [
        ('experiment_id', 'TEXT'),
        ('git_commit_hash', 'TEXT'),
        ('data_snapshot_hash', 'TEXT'),
        ('parameter_vector_hash', 'TEXT'),
        ('random_seed', 'BIGINT'),
        ('contract_version', 'TEXT'),
        ('strategy_version', 'TEXT'),
        ('data_version', 'TEXT'),
        ('status', 'TEXT'),  # 'pending'|'running'|'completed'|'failed'
        ('started_at', 'TIMESTAMP'),
        ('completed_at', 'TIMESTAMP'),
        ('error_message', 'TEXT'),
    ]
    
    for column_name, column_type in columns_to_add:
        try:
            # Try to add column (will fail if already exists, which is fine)
            conn.execute(f'ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS {column_name} {column_type}')
        except Exception:
            # Column might already exist, continue
            pass
    
    # Create index on experiment_id if it doesn't exist
    try:
        conn.execute('CREATE INDEX IF NOT EXISTS idx_simulation_runs_experiment_id ON simulation_runs(experiment_id)')
    except Exception:
        pass
    
    # Create index on parameter_vector_hash
    try:
        conn.execute('CREATE INDEX IF NOT EXISTS idx_simulation_runs_parameter_hash ON simulation_runs(parameter_vector_hash)')
    except Exception:
        pass
    
    # Create index on git_commit_hash
    try:
        conn.execute('CREATE INDEX IF NOT EXISTS idx_simulation_runs_git_commit ON simulation_runs(git_commit_hash)')
    except Exception:
        pass
    
    # Create index on data_snapshot_hash
    try:
        conn.execute('CREATE INDEX IF NOT EXISTS idx_simulation_runs_data_snapshot ON simulation_runs(data_snapshot_hash)')
    except Exception:
        pass


def get_experiment(conn: duckdb.DuckDBPyConnection, experiment_id: str) -> Optional[Dict[str, Any]]:
    """Get experiment by ID."""
    ensure_experiment_schema(conn)
    
    result = conn.execute(
        """
        SELECT 
            run_id,
            strategy_id,
            mint,
            alert_timestamp,
            start_time,
            end_time,
            initial_capital,
            final_capital,
            total_return_pct,
            max_drawdown_pct,
            sharpe_ratio,
            win_rate,
            total_trades,
            caller_name,
            created_at,
            experiment_id,
            git_commit_hash,
            data_snapshot_hash,
            parameter_vector_hash,
            random_seed,
            contract_version,
            strategy_version,
            data_version,
            status,
            started_at,
            completed_at,
            error_message
        FROM simulation_runs
        WHERE experiment_id = ?
        LIMIT 1
        """,
        [experiment_id]
    ).fetchone()
    
    if not result:
        return None
    
    columns = [
        'run_id', 'strategy_id', 'mint', 'alert_timestamp', 'start_time', 'end_time',
        'initial_capital', 'final_capital', 'total_return_pct', 'max_drawdown_pct',
        'sharpe_ratio', 'win_rate', 'total_trades', 'caller_name', 'created_at',
        'experiment_id', 'git_commit_hash', 'data_snapshot_hash', 'parameter_vector_hash',
        'random_seed', 'contract_version', 'strategy_version', 'data_version',
        'status', 'started_at', 'completed_at', 'error_message'
    ]
    
    experiment = dict(zip(columns, result))
    
    # Convert timestamps to ISO strings
    for timestamp_field in ['alert_timestamp', 'start_time', 'end_time', 'created_at', 'started_at', 'completed_at']:
        if experiment.get(timestamp_field):
            experiment[timestamp_field] = str(experiment[timestamp_field])
    
    return experiment


def list_experiments(
    conn: duckdb.DuckDBPyConnection,
    filter_params: Dict[str, Any],
    limit: Optional[int] = None,
    offset: Optional[int] = None
) -> Dict[str, Any]:
    """List experiments matching filter criteria."""
    ensure_experiment_schema(conn)
    
    # Build WHERE clause
    where_conditions = []
    params = []
    
    if filter_params.get('experiment_id'):
        where_conditions.append('experiment_id = ?')
        params.append(filter_params['experiment_id'])
    
    if filter_params.get('strategy_id'):
        where_conditions.append('strategy_id = ?')
        params.append(filter_params['strategy_id'])
    
    if filter_params.get('parameter_vector_hash'):
        where_conditions.append('parameter_vector_hash = ?')
        params.append(filter_params['parameter_vector_hash'])
    
    if filter_params.get('git_commit_hash'):
        where_conditions.append('git_commit_hash = ?')
        params.append(filter_params['git_commit_hash'])
    
    if filter_params.get('data_snapshot_hash'):
        where_conditions.append('data_snapshot_hash = ?')
        params.append(filter_params['data_snapshot_hash'])
    
    if filter_params.get('status'):
        where_conditions.append('status = ?')
        params.append(filter_params['status'])
    
    if filter_params.get('started_after'):
        where_conditions.append('started_at >= ?')
        params.append(filter_params['started_after'])
    
    if filter_params.get('started_before'):
        where_conditions.append('started_at <= ?')
        params.append(filter_params['started_before'])
    
    where_clause = ' AND '.join(where_conditions) if where_conditions else '1=1'
    
    # Get total count
    count_result = conn.execute(
        f'SELECT COUNT(*) FROM simulation_runs WHERE {where_clause}',
        params
    ).fetchone()
    total = count_result[0] if count_result else 0
    
    # Get experiments
    query = f"""
        SELECT 
            run_id,
            strategy_id,
            mint,
            alert_timestamp,
            start_time,
            end_time,
            initial_capital,
            final_capital,
            total_return_pct,
            max_drawdown_pct,
            sharpe_ratio,
            win_rate,
            total_trades,
            caller_name,
            created_at,
            experiment_id,
            git_commit_hash,
            data_snapshot_hash,
            parameter_vector_hash,
            random_seed,
            contract_version,
            strategy_version,
            data_version,
            status,
            started_at,
            completed_at,
            error_message
        FROM simulation_runs
        WHERE {where_clause}
        ORDER BY created_at DESC
    """
    
    if limit:
        query += f' LIMIT {limit}'
    if offset:
        query += f' OFFSET {offset}'
    
    results = conn.execute(query, params).fetchall()
    
    columns = [
        'run_id', 'strategy_id', 'mint', 'alert_timestamp', 'start_time', 'end_time',
        'initial_capital', 'final_capital', 'total_return_pct', 'max_drawdown_pct',
        'sharpe_ratio', 'win_rate', 'total_trades', 'caller_name', 'created_at',
        'experiment_id', 'git_commit_hash', 'data_snapshot_hash', 'parameter_vector_hash',
        'random_seed', 'contract_version', 'strategy_version', 'data_version',
        'status', 'started_at', 'completed_at', 'error_message'
    ]
    
    experiments = []
    for row in results:
        experiment = dict(zip(columns, row))
        # Convert timestamps to ISO strings
        for timestamp_field in ['alert_timestamp', 'start_time', 'end_time', 'created_at', 'started_at', 'completed_at']:
            if experiment.get(timestamp_field):
                experiment[timestamp_field] = str(experiment[timestamp_field])
        experiments.append(experiment)
    
    return {
        'experiments': experiments,
        'total': total
    }


def main() -> None:
    """Main entry point for experiment query operations."""
    parser = argparse.ArgumentParser(description='DuckDB Experiment Repository')
    parser.add_argument('--db-path', required=True, help='Path to DuckDB database file')
    parser.add_argument('--operation', required=True, choices=['get', 'list'], help='Operation to perform')
    parser.add_argument('--data', help='JSON data for operation parameters')
    
    args = parser.parse_args()
    
    # Connect to DuckDB (reader - queries only)
    from tools.shared.duckdb_adapter import get_readonly_connection
    with get_readonly_connection(str(args.db_path)) as conn:
        if args.operation == 'get':
            data = json.loads(args.data or '{}')
            experiment_id = data.get('experiment_id')
            if not experiment_id:
                print(json.dumps({'error': 'experiment_id is required'}))
                sys.exit(1)
            
            experiment = get_experiment(conn, experiment_id)
            if experiment:
                print(json.dumps({'success': True, 'experiment': experiment}))
            else:
                print(json.dumps({'success': False, 'error': 'Experiment not found'}))
        
        elif args.operation == 'list':
            data = json.loads(args.data or '{}')
            filter_params = data.get('filter', {})
            limit = data.get('limit')
            offset = data.get('offset')
            
            result = list_experiments(conn, filter_params, limit, offset)
            print(json.dumps({'success': True, **result}))

if __name__ == '__main__':
    main()

