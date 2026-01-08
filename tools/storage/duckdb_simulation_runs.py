#!/usr/bin/env python3
"""
DuckDB Simulation Runs Repository

Provides query operations for simulation runs stored in simulation_runs table.
Supports listing runs with filters and getting individual run details.
"""

import argparse
import duckdb
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add tools to path for shared imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from shared.duckdb_adapter import safe_connect


def table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    """Check if a table exists in the database."""
    try:
        result = conn.execute(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?",
            (table_name,)
        ).fetchone()
        return result[0] > 0 if result else False
    except Exception:
        # Fallback: try to query the table directly
        try:
            conn.execute(f"SELECT 1 FROM {table_name} LIMIT 1")
            return True
        except Exception:
            return False


def ensure_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Ensure simulation_runs table exists with required schema."""
    # Create table if it doesn't exist (based on schema from tools/simulation/sql_functions.py)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS simulation_runs (
            run_id TEXT PRIMARY KEY,
            strategy_id TEXT NOT NULL,
            mint TEXT NOT NULL,
            alert_timestamp TIMESTAMP NOT NULL,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP NOT NULL,
            initial_capital DOUBLE NOT NULL,
            final_capital DOUBLE,
            total_return_pct DOUBLE,
            max_drawdown_pct DOUBLE,
            sharpe_ratio DOUBLE,
            win_rate DOUBLE,
            total_trades INTEGER,
            caller_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    # Create indexes for performance (ignore errors if they already exist)
    try:
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_simulation_runs_strategy 
            ON simulation_runs(strategy_id);
        """)
    except Exception:
        pass
    
    try:
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_simulation_runs_caller 
            ON simulation_runs(caller_name);
        """)
    except Exception:
        pass
    
    try:
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_simulation_runs_alert_timestamp 
            ON simulation_runs(alert_timestamp);
        """)
    except Exception:
        pass


def get_strategy_name(conn: duckdb.DuckDBPyConnection, strategy_id: str) -> Optional[str]:
    """Get strategy name from various possible sources."""
    # Try strategy_config table first (most likely for simulation runs)
    if table_exists(conn, 'strategy_config'):
        try:
            result = conn.execute(
                "SELECT strategy_name FROM strategy_config WHERE strategy_id = ? LIMIT 1",
                (strategy_id,)
            ).fetchone()
            if result and result[0]:
                return result[0]
        except Exception:
            pass
    
    # Try strategies table (if strategy_id can be cast to integer)
    if table_exists(conn, 'strategies'):
        try:
            # Try to cast strategy_id to integer
            strategy_id_int = int(strategy_id)
            result = conn.execute(
                "SELECT name FROM strategies WHERE id = ? LIMIT 1",
                (strategy_id_int,)
            ).fetchone()
            if result and result[0]:
                return result[0]
        except (ValueError, Exception):
            # strategy_id is not an integer or query failed
            pass
    
    # Try simulation_strategies table
    if table_exists(conn, 'simulation_strategies'):
        try:
            result = conn.execute(
                "SELECT name FROM simulation_strategies WHERE strategy_id = ? LIMIT 1",
                (strategy_id,)
            ).fetchone()
            if result and result[0]:
                return result[0]
        except Exception:
            pass
    
    return None


def list_runs(
    db_path: str,
    limit: int = 50,
    offset: int = 0,
    strategy_name: Optional[str] = None,
    caller_name: Optional[str] = None,
    from_iso: Optional[str] = None,
    to_iso: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List simulation runs with optional filters."""
    try:
        con = safe_connect(db_path)
        ensure_schema(con)
        
        # Check if table has any data
        try:
            count_result = con.execute("SELECT COUNT(*) FROM simulation_runs").fetchone()
            if not count_result or count_result[0] == 0:
                con.close()
                return []
        except Exception:
            # Table might not exist yet or query failed
            con.close()
            return []
        
        # Build base query
        query = """
            SELECT 
                run_id,
                strategy_id,
                caller_name,
                start_time,
                end_time,
                total_trades,
                total_return_pct,
                created_at
            FROM simulation_runs
            WHERE 1=1
        """
        
        params = []
        
        # Add filters
        if strategy_name:
            # Strategy name filter - need to check multiple tables
            if table_exists(con, 'strategy_config'):
                query += " AND EXISTS (SELECT 1 FROM strategy_config WHERE strategy_id = simulation_runs.strategy_id AND strategy_name = ?)"
                params.append(strategy_name)
            elif table_exists(con, 'strategies'):
                # Try integer cast
                try:
                    # This is a bit hacky - we'll filter after fetching
                    pass
                except Exception:
                    pass
        
        if caller_name:
            query += " AND caller_name = ?"
            params.append(caller_name)
        
        if from_iso:
            try:
                # Validate and parse ISO date
                datetime.fromisoformat(from_iso.replace('Z', '+00:00'))
                query += " AND alert_timestamp >= ?"
                params.append(from_iso)
            except (ValueError, AttributeError):
                # Invalid date format, skip filter
                pass
        
        if to_iso:
            try:
                # Validate and parse ISO date
                datetime.fromisoformat(to_iso.replace('Z', '+00:00'))
                query += " AND alert_timestamp <= ?"
                params.append(to_iso)
            except (ValueError, AttributeError):
                # Invalid date format, skip filter
                pass
        
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        results = con.execute(query, params).fetchall()
        
        # Convert to list of dictionaries with proper null handling
        runs = []
        for row in results:
            run_id = row[0] or ''
            strategy_id = row[1] or ''
            strategy_name_val = get_strategy_name(con, strategy_id) or strategy_id
            
            # Apply strategy_name filter if needed (post-query since we can't always join)
            if strategy_name and strategy_name_val != strategy_name:
                continue
            
            # Format timestamps safely
            from_iso_val = None
            to_iso_val = None
            created_at_val = None
            
            try:
                if row[3]:
                    from_iso_val = row[3].isoformat() if hasattr(row[3], 'isoformat') else str(row[3])
            except Exception:
                pass
            
            try:
                if row[4]:
                    to_iso_val = row[4].isoformat() if hasattr(row[4], 'isoformat') else str(row[4])
            except Exception:
                pass
            
            try:
                if row[7]:
                    created_at_val = row[7].isoformat() if hasattr(row[7], 'isoformat') else str(row[7])
            except Exception:
                pass
            
            runs.append({
                'run_id': run_id,
                'strategy_id': strategy_id,
                'strategy_name': strategy_name_val,
                'caller_name': row[2] if row[2] is not None else None,
                'from_iso': from_iso_val,
                'to_iso': to_iso_val,
                'total_calls': None,  # Not stored in simulation_runs table
                'successful_calls': None,
                'failed_calls': None,
                'total_trades': row[5] if row[5] is not None else None,
                'pnl_min': None,
                'pnl_max': None,
                'pnl_mean': row[6] if row[6] is not None else None,
                'pnl_median': None,
                'created_at': created_at_val,
            })
        
        con.close()
        return runs
    except Exception as e:
        print(f'Error listing simulation runs: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc()
        return []


def get_strategy_config(conn: duckdb.DuckDBPyConnection, run_id: str, strategy_id: str) -> Dict[str, Any]:
    """Get strategy config from various possible sources."""
    config = {}
    
    # Try run_strategies_used -> strategy_config (most reliable)
    if table_exists(conn, 'run_strategies_used') and table_exists(conn, 'strategy_config'):
        try:
            result = conn.execute("""
                SELECT 
                    sc.entry_config,
                    sc.exit_config,
                    sc.reentry_config,
                    sc.cost_config,
                    sc.stop_loss_config,
                    sc.entry_signal_config,
                    sc.exit_signal_config
                FROM run_strategies_used rsu
                JOIN strategy_config sc ON rsu.strategy_config_id = sc.strategy_config_id
                WHERE rsu.run_id = ?
                LIMIT 1
            """, (run_id,)).fetchone()
            
            if result:
                config = {
                    'entry_config': json.loads(result[0]) if isinstance(result[0], str) else (result[0] or {}),
                    'exit_config': json.loads(result[1]) if isinstance(result[1], str) else (result[1] or {}),
                    'reentry_config': json.loads(result[2]) if isinstance(result[2], str) else (result[2] or {}),
                    'cost_config': json.loads(result[3]) if isinstance(result[3], str) else (result[3] or {}),
                    'stop_loss_config': json.loads(result[4]) if isinstance(result[4], str) else (result[4] or {}),
                    'entry_signal_config': json.loads(result[5]) if isinstance(result[5], str) else (result[5] or {}),
                    'exit_signal_config': json.loads(result[6]) if isinstance(result[6], str) else (result[6] or {}),
                }
                return config
        except Exception:
            pass
    
    # Try strategies table (if strategy_id can be cast to integer)
    if table_exists(conn, 'strategies'):
        try:
            strategy_id_int = int(strategy_id)
            result = conn.execute(
                "SELECT config_json FROM strategies WHERE id = ? LIMIT 1",
                (strategy_id_int,)
            ).fetchone()
            if result and result[0]:
                config_json = result[0]
                if isinstance(config_json, str):
                    try:
                        config = json.loads(config_json)
                    except json.JSONDecodeError:
                        pass
                elif isinstance(config_json, dict):
                    config = config_json
                return config
        except (ValueError, Exception):
            pass
    
    # Try simulation_strategies table
    if table_exists(conn, 'simulation_strategies'):
        try:
            result = conn.execute("""
                SELECT 
                    entry_config,
                    exit_config,
                    reentry_config,
                    cost_config
                FROM simulation_strategies
                WHERE strategy_id = ?
                LIMIT 1
            """, (strategy_id,)).fetchone()
            
            if result:
                config = {
                    'entry_config': json.loads(result[0]) if isinstance(result[0], str) else (result[0] or {}),
                    'exit_config': json.loads(result[1]) if isinstance(result[1], str) else (result[1] or {}),
                    'reentry_config': json.loads(result[2]) if isinstance(result[2], str) else (result[2] or {}),
                    'cost_config': json.loads(result[3]) if isinstance(result[3], str) else (result[3] or {}),
                }
                return config
        except Exception:
            pass
    
    return config


def get_run(db_path: str, run_id: str) -> Optional[Dict[str, Any]]:
    """Get a single simulation run by run_id."""
    try:
        con = safe_connect(db_path)
        ensure_schema(con)
        
        # Simple query first
        query = """
            SELECT 
                run_id,
                strategy_id,
                caller_name,
                start_time,
                end_time,
                total_trades,
                total_return_pct,
                created_at
            FROM simulation_runs
            WHERE run_id = ?
            LIMIT 1
        """
        
        result = con.execute(query, (run_id,)).fetchone()
        
        if not result:
            con.close()
            return None
        
        run_id_val = result[0] or ''
        strategy_id = result[1] or ''
        strategy_name = get_strategy_name(con, strategy_id) or strategy_id
        strategy_config = get_strategy_config(con, run_id_val, strategy_id)
        
        # Format timestamps safely
        from_iso_val = None
        to_iso_val = None
        created_at_val = None
        
        try:
            if result[3]:
                from_iso_val = result[3].isoformat() if hasattr(result[3], 'isoformat') else str(result[3])
        except Exception:
            pass
        
        try:
            if result[4]:
                to_iso_val = result[4].isoformat() if hasattr(result[4], 'isoformat') else str(result[4])
        except Exception:
            pass
        
        try:
            if result[7]:
                created_at_val = result[7].isoformat() if hasattr(result[7], 'isoformat') else str(result[7])
        except Exception:
            pass
        
        run = {
            'run_id': run_id_val,
            'strategy_id': strategy_id,
            'strategy_name': strategy_name,
            'caller_name': result[2] if result[2] is not None else None,
            'from_iso': from_iso_val,
            'to_iso': to_iso_val,
            'total_calls': None,
            'successful_calls': None,
            'failed_calls': None,
            'total_trades': result[5] if result[5] is not None else None,
            'pnl_min': None,
            'pnl_max': None,
            'pnl_mean': result[6] if result[6] is not None else None,
            'pnl_median': None,
            'created_at': created_at_val,
            'strategy_config': strategy_config,
        }
        
        con.close()
        return run
    except Exception as e:
        print(f'Error getting simulation run: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc()
        return None


def main():
    parser = argparse.ArgumentParser(description='DuckDB Simulation Runs Repository')
    parser.add_argument('--operation', required=True, choices=['list', 'get'], help='Operation to perform')
    parser.add_argument('--db-path', required=True, help='Path to DuckDB database file')
    
    # List operation arguments
    parser.add_argument('--limit', type=int, default=50, help='Limit for list operation')
    parser.add_argument('--offset', type=int, default=0, help='Offset for list operation')
    parser.add_argument('--strategy-name', help='Filter by strategy name')
    parser.add_argument('--caller-name', help='Filter by caller name')
    parser.add_argument('--from-iso', help='Filter by start date (ISO format)')
    parser.add_argument('--to-iso', help='Filter by end date (ISO format)')
    
    # Get operation arguments
    parser.add_argument('--run-id', help='Run ID for get operation')
    
    args = parser.parse_args()
    
    # Validate arguments
    if args.limit < 1 or args.limit > 10000:
        print('Error: --limit must be between 1 and 10000', file=sys.stderr)
        sys.exit(1)
    
    if args.offset < 0:
        print('Error: --offset must be non-negative', file=sys.stderr)
        sys.exit(1)
    
    try:
        if args.operation == 'list':
            runs = list_runs(
                db_path=args.db_path,
                limit=args.limit,
                offset=args.offset,
                strategy_name=args.strategy_name,
                caller_name=args.caller_name,
                from_iso=args.from_iso,
                to_iso=args.to_iso,
            )
            # Ensure we always output valid JSON array
            print(json.dumps(runs if runs else [], default=str))
        elif args.operation == 'get':
            if not args.run_id:
                print('Error: --run-id is required for get operation', file=sys.stderr)
                sys.exit(1)
            
            if not args.run_id.strip():
                print('Error: --run-id cannot be empty', file=sys.stderr)
                sys.exit(1)
            
            run = get_run(db_path=args.db_path, run_id=args.run_id)
            # Always output JSON array (empty if not found)
            print(json.dumps([run] if run else [], default=str))
    except KeyboardInterrupt:
        print('Operation cancelled', file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

