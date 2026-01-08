"""
DuckDB Run Event Repository

Provides append-only event storage and run state projection for event sourcing.
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


def ensure_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Ensure run_events and run_state tables exist."""
    # Create run_events table (append-only event stream)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS run_events (
            event_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            occurred_at TIMESTAMP NOT NULL,
            event_version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            metadata_json TEXT
        )
    """)

    # Create indexes for efficient queries
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_run_events_run_id 
        ON run_events(run_id, occurred_at)
    """)

    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_run_events_type 
        ON run_events(event_type, occurred_at)
    """)

    # Create run_state table (materialized projection)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS run_state (
            run_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            failed_at TIMESTAMP,
            strategy_id TEXT NOT NULL,
            strategy_name TEXT NOT NULL,
            code_version TEXT,
            config_hash TEXT,
            seed INTEGER,
            last_event_type TEXT,
            last_event_at TIMESTAMP,
            error_message TEXT,
            error_code TEXT,
            calls_attempted INTEGER,
            calls_succeeded INTEGER,
            calls_failed INTEGER,
            trades_total INTEGER
        )
    """)

    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_run_state_status 
        ON run_state(status, created_at)
    """)

    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_run_state_strategy 
        ON run_state(strategy_id, created_at)
    """)


def append_event(
    conn: duckdb.DuckDBPyConnection,
    event_id: str,
    run_id: str,
    event_type: str,
    occurred_at: str,
    event_version: int,
    payload_json: str,
    metadata_json: Optional[str]
) -> Dict[str, Any]:
    """Append a single event to the stream."""
    ensure_schema(conn)

    try:
        conn.execute("""
            INSERT INTO run_events (
                event_id, run_id, event_type, occurred_at, 
                event_version, payload_json, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, [event_id, run_id, event_type, occurred_at, event_version, payload_json, metadata_json])

        # Update run_state projection
        update_run_state(conn, run_id, event_type, occurred_at, json.loads(payload_json))

        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def append_events(conn: duckdb.DuckDBPyConnection, events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Append multiple events atomically."""
    ensure_schema(conn)

    try:
        # Use transaction for atomicity
        conn.begin()
        try:
            for event in events:
                conn.execute("""
                    INSERT INTO run_events (
                        event_id, run_id, event_type, occurred_at,
                        event_version, payload_json, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, [
                    event['event_id'],
                    event['run_id'],
                    event['event_type'],
                    event['occurred_at'],
                    event['event_version'],
                    event['payload_json'],
                    event.get('metadata_json')
                ])

                # Update run_state for each event
                update_run_state(
                    conn,
                    event['run_id'],
                    event['event_type'],
                    event['occurred_at'],
                    json.loads(event['payload_json'])
                )

            conn.commit()
            return {'success': True}
        except Exception as e:
            conn.rollback()
            raise e
    except Exception as e:
        return {'success': False, 'error': str(e)}


def update_run_state(
    conn: duckdb.DuckDBPyConnection,
    run_id: str,
    event_type: str,
    occurred_at: str,
    payload: Dict[str, Any]
) -> None:
    """Update run_state projection based on event."""
    # Get current state or create new
    result = conn.execute("""
        SELECT * FROM run_state WHERE run_id = ?
    """, [run_id]).fetchone()

    if result:
        # Update existing state
        state = dict(zip([col[0] for col in conn.description], result))
    else:
        # Create new state (will be populated by RunCreated event)
        state = {
            'run_id': run_id,
            'status': 'pending',
            'created_at': occurred_at,
            'strategy_id': '',
            'strategy_name': '',
        }

    # Update state based on event type
    if event_type == 'RunCreated':
        state['status'] = 'running'
        state['created_at'] = occurred_at
        state['strategy_id'] = payload.get('strategy_id', '')
        state['strategy_name'] = payload.get('strategy_name', '')
        if not state.get('started_at'):
            state['started_at'] = occurred_at

    elif event_type == 'InputsResolved':
        state['code_version'] = payload.get('code_version')
        state['config_hash'] = payload.get('config_hash')
        state['seed'] = payload.get('seed')

    elif event_type == 'SimulationStarted':
        if not state.get('started_at'):
            state['started_at'] = occurred_at

    elif event_type == 'SimulationCompleted':
        state['calls_attempted'] = payload.get('calls_attempted')
        state['calls_succeeded'] = payload.get('calls_succeeded')
        state['calls_failed'] = payload.get('calls_failed')
        state['trades_total'] = payload.get('trades_total')

    elif event_type == 'RunFailed':
        state['status'] = 'failed'
        state['failed_at'] = occurred_at
        state['error_message'] = payload.get('error_message')
        state['error_code'] = payload.get('error_code')

    # Check if run is completed (has SimulationCompleted and no RunFailed)
    if event_type == 'SimulationCompleted' and state.get('status') != 'failed':
        # Check if this is the final completion (could be multiple phases)
        # For now, mark as completed if we have a SimulationCompleted
        state['status'] = 'completed'
        state['completed_at'] = occurred_at

    # Always update last event info
    state['last_event_type'] = event_type
    state['last_event_at'] = occurred_at

    # Upsert state
    conn.execute("""
        INSERT INTO run_state (
            run_id, status, created_at, started_at, completed_at, failed_at,
            strategy_id, strategy_name, code_version, config_hash, seed,
            last_event_type, last_event_at, error_message, error_code,
            calls_attempted, calls_succeeded, calls_failed, trades_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (run_id) DO UPDATE SET
            status = EXCLUDED.status,
            started_at = COALESCE(EXCLUDED.started_at, run_state.started_at),
            completed_at = COALESCE(EXCLUDED.completed_at, run_state.completed_at),
            failed_at = COALESCE(EXCLUDED.failed_at, run_state.failed_at),
            code_version = COALESCE(EXCLUDED.code_version, run_state.code_version),
            config_hash = COALESCE(EXCLUDED.config_hash, run_state.config_hash),
            seed = COALESCE(EXCLUDED.seed, run_state.seed),
            last_event_type = EXCLUDED.last_event_type,
            last_event_at = EXCLUDED.last_event_at,
            error_message = COALESCE(EXCLUDED.error_message, run_state.error_message),
            error_code = COALESCE(EXCLUDED.error_code, run_state.error_code),
            calls_attempted = COALESCE(EXCLUDED.calls_attempted, run_state.calls_attempted),
            calls_succeeded = COALESCE(EXCLUDED.calls_succeeded, run_state.calls_succeeded),
            calls_failed = COALESCE(EXCLUDED.calls_failed, run_state.calls_failed),
            trades_total = COALESCE(EXCLUDED.trades_total, run_state.trades_total)
    """, [
        state.get('run_id'),
        state.get('status', 'pending'),
        state.get('created_at'),
        state.get('started_at'),
        state.get('completed_at'),
        state.get('failed_at'),
        state.get('strategy_id', ''),
        state.get('strategy_name', ''),
        state.get('code_version'),
        state.get('config_hash'),
        state.get('seed'),
        state.get('last_event_type'),
        state.get('last_event_at'),
        state.get('error_message'),
        state.get('error_code'),
        state.get('calls_attempted'),
        state.get('calls_succeeded'),
        state.get('calls_failed'),
        state.get('trades_total'),
    ])


def query_events(
    conn: duckdb.DuckDBPyConnection,
    run_id: Optional[str] = None,
    event_type: Optional[List[str]] = None,
    from_occurred_at: Optional[str] = None,
    to_occurred_at: Optional[str] = None,
    limit: Optional[int] = None,
    offset: Optional[int] = None
) -> Dict[str, Any]:
    """Query events with filters."""
    ensure_schema(conn)

    conditions = []
    params = []

    if run_id:
        conditions.append('run_id = ?')
        params.append(run_id)

    if event_type:
        if isinstance(event_type, list) and len(event_type) > 0:
            placeholders = ','.join(['?' for _ in event_type])
            conditions.append(f'event_type IN ({placeholders})')
            params.extend(event_type)

    if from_occurred_at:
        conditions.append('occurred_at >= ?')
        params.append(from_occurred_at)

    if to_occurred_at:
        conditions.append('occurred_at <= ?')
        params.append(to_occurred_at)

    where_clause = ' AND '.join(conditions) if conditions else '1=1'

    # Get total count
    count_result = conn.execute(
        f'SELECT COUNT(*) as total FROM run_events WHERE {where_clause}',
        params
    ).fetchone()
    total = count_result[0] if count_result else 0

    # Get events
    query = f"""
        SELECT 
            event_id, run_id, event_type, occurred_at, event_version,
            payload_json, metadata_json
        FROM run_events
        WHERE {where_clause}
        ORDER BY occurred_at ASC
    """

    if limit:
        query += f' LIMIT {limit}'
        if offset:
            query += f' OFFSET {offset}'

    result = conn.execute(query, params).fetchall()
    columns = [col[0] for col in conn.description]

    events = []
    for row in result:
        event = dict(zip(columns, row))
        events.append(event)

    return {
        'success': True,
        'events': events,
        'total': total
    }


def get_run_state(conn: duckdb.DuckDBPyConnection, run_id: str) -> Dict[str, Any]:
    """Get run state projection."""
    ensure_schema(conn)

    result = conn.execute("""
        SELECT * FROM run_state WHERE run_id = ?
    """, [run_id]).fetchone()

    if not result:
        return {'success': True, 'state': None}

    columns = [col[0] for col in conn.description]
    state = dict(zip(columns, result))

    return {
        'success': True,
        'state': state
    }


def check_available(conn: duckdb.DuckDBPyConnection) -> Dict[str, Any]:
    """Check if storage is available."""
    try:
        ensure_schema(conn)
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def main():
    parser = argparse.ArgumentParser(description='DuckDB Run Event Repository')
    parser.add_argument('--db-path', required=True, help='Path to DuckDB database file')
    parser.add_argument('operation', choices=[
        'init_schema',
        'append_event',
        'append_events',
        'query_events',
        'get_run_state',
        'check_available'
    ])

    args, unknown = parser.parse_known_args()

    # Parse additional arguments based on operation
    operation_args = {}
    for i in range(0, len(unknown), 2):
        if i + 1 < len(unknown):
            key = unknown[i].lstrip('--').replace('-', '_')
            value = unknown[i + 1]
            operation_args[key] = value

    # Connect to DuckDB (writer - this is the only writer process)
    from tools.shared.duckdb_adapter import get_write_connection
    with get_write_connection(args.db_path) as conn:
        if args.operation == 'init_schema':
            ensure_schema(conn)
            result = {'success': True}

        elif args.operation == 'append_event':
            result = append_event(
                conn,
                operation_args['event_id'],
                operation_args['run_id'],
                operation_args['event_type'],
                operation_args['occurred_at'],
                int(operation_args['event_version']),
                operation_args['payload_json'],
                operation_args.get('metadata_json')
            )

        elif args.operation == 'append_events':
            events = json.loads(operation_args['events']) if isinstance(operation_args['events'], str) else operation_args['events']
            result = append_events(conn, events)

        elif args.operation == 'query_events':
            result = query_events(
                conn,
                run_id=operation_args.get('run_id'),
                event_type=json.loads(operation_args['event_type']) if operation_args.get('event_type') else None,
                from_occurred_at=operation_args.get('from_occurred_at'),
                to_occurred_at=operation_args.get('to_occurred_at'),
                limit=int(operation_args['limit']) if operation_args.get('limit') else None,
                offset=int(operation_args['offset']) if operation_args.get('offset') else None
            )

        elif args.operation == 'get_run_state':
            result = get_run_state(conn, operation_args['run_id'])

        elif args.operation == 'check_available':
            result = check_available(conn)

        else:
            result = {'success': False, 'error': f'Unknown operation: {args.operation}'}

        print(json.dumps(result))


if __name__ == '__main__':
    main()

