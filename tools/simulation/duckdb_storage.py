#!/usr/bin/env python3
"""
DuckDB Storage Service for Simulation Components

Handles:
- Strategy storage
- Simulation runs storage
- Alerts storage
- Report generation
"""

import argparse
import json
import sys
import duckdb
from datetime import datetime
from typing import Dict, Any, Optional, List
from pathlib import Path

# Import simulation schema
sys.path.insert(0, str(Path(__file__).parent.parent / 'telegram' / 'simulation'))
from sql_functions import setup_simulation_schema, create_strategy


def store_strategy(con: duckdb.DuckDBPyConnection, strategy_data: Dict[str, Any]) -> Dict[str, Any]:
    """Store a strategy in DuckDB."""
    try:
        create_strategy(
            con,
            strategy_id=strategy_data['strategy_id'],
            name=strategy_data['name'],
            entry_config=strategy_data.get('entry_config', {}),
            exit_config=strategy_data.get('exit_config', {}),
            reentry_config=strategy_data.get('reentry_config'),
            cost_config=strategy_data.get('cost_config')
        )
        return {'success': True, 'strategy_id': strategy_data['strategy_id']}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def store_simulation_run(con: duckdb.DuckDBPyConnection, run_data: Dict[str, Any]) -> Dict[str, Any]:
    """Store a simulation run in DuckDB."""
    try:
        con.execute("""
            INSERT OR REPLACE INTO simulation_runs
            (run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
             initial_capital, final_capital, total_return_pct, max_drawdown_pct,
             sharpe_ratio, win_rate, total_trades)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            run_data['run_id'],
            run_data['strategy_id'],
            run_data['mint'],
            run_data['alert_timestamp'],
            run_data['start_time'],
            run_data['end_time'],
            run_data.get('initial_capital', 1000.0),
            run_data.get('final_capital'),
            run_data.get('total_return_pct'),
            run_data.get('max_drawdown_pct'),
            run_data.get('sharpe_ratio'),
            run_data.get('win_rate'),
            run_data.get('total_trades', 0)
        ])
        con.commit()
        return {'success': True, 'run_id': run_data['run_id']}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def store_alerts(con: duckdb.DuckDBPyConnection, alerts_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Store alerts in DuckDB (using existing alerts table from telegram pipeline)."""
    try:
        # Alerts are stored in the telegram pipeline's DuckDB
        # This function can be extended to store simulation-specific alerts
        stored_count = 0
        for alert in alerts_data:
            # Store alert logic here (depends on schema)
            stored_count += 1
        return {'success': True, 'stored_count': stored_count}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def query_calls(con: duckdb.DuckDBPyConnection, query_data: Dict[str, Any]) -> Dict[str, Any]:
    """Query calls from DuckDB for batch simulation."""
    try:
        limit = query_data.get('limit', 1000)
        
        # Query user_calls_d table for mint addresses and alert timestamps
        # Use call_datetime or call_ts_ms depending on what's available
        result = con.execute("""
            SELECT DISTINCT
                mint,
                call_datetime
            FROM user_calls_d
            WHERE mint IS NOT NULL 
              AND TRIM(CAST(mint AS VARCHAR)) != ''
              AND call_datetime IS NOT NULL
            ORDER BY call_datetime DESC
            LIMIT ?
        """, [limit]).fetchall()
        
        calls = []
        for row in result:
            mint = row[0]
            call_datetime = row[1]
            
            # Convert datetime to ISO format string
            if isinstance(call_datetime, datetime):
                alert_timestamp = call_datetime.isoformat()
            elif isinstance(call_datetime, str):
                alert_timestamp = call_datetime
            else:
                # Try to parse as timestamp
                try:
                    dt = datetime.fromtimestamp(call_datetime)
                    alert_timestamp = dt.isoformat()
                except:
                    continue  # Skip invalid timestamps
            
            calls.append({
                'mint': str(mint),
                'alert_timestamp': alert_timestamp
            })
        
        return {
            'success': True,
            'calls': calls
        }
    except Exception as e:
        return {'success': False, 'error': str(e)}


def generate_report(con: duckdb.DuckDBPyConnection, report_config: Dict[str, Any]) -> Dict[str, Any]:
    """Generate a report from DuckDB simulation data."""
    try:
        report_type = report_config.get('type', 'summary')
        
        if report_type == 'summary':
            # Summary report: aggregate metrics across all runs
            result = con.execute("""
                SELECT 
                    COUNT(*) as total_runs,
                    AVG(total_return_pct) as avg_return,
                    AVG(sharpe_ratio) as avg_sharpe,
                    AVG(win_rate) as avg_win_rate,
                    SUM(total_trades) as total_trades,
                    AVG(max_drawdown_pct) as avg_drawdown
                FROM simulation_runs
                WHERE final_capital IS NOT NULL
            """).fetchone()
            
            return {
                'success': True,
                'report_type': 'summary',
                'data': {
                    'total_runs': result[0] if result else 0,
                    'avg_return_pct': result[1] if result else 0,
                    'avg_sharpe_ratio': result[2] if result else 0,
                    'avg_win_rate': result[3] if result else 0,
                    'total_trades': result[4] if result else 0,
                    'avg_drawdown_pct': result[5] if result else 0
                }
            }
        elif report_type == 'strategy_performance':
            # Strategy performance report
            strategy_id = report_config.get('strategy_id')
            if not strategy_id:
                return {'success': False, 'error': 'strategy_id required for strategy_performance report'}
            
            result = con.execute("""
                SELECT 
                    strategy_id,
                    COUNT(*) as run_count,
                    AVG(total_return_pct) as avg_return,
                    AVG(sharpe_ratio) as avg_sharpe,
                    AVG(win_rate) as avg_win_rate,
                    SUM(total_trades) as total_trades
                FROM simulation_runs
                WHERE strategy_id = ? AND final_capital IS NOT NULL
                GROUP BY strategy_id
            """, [strategy_id]).fetchone()
            
            return {
                'success': True,
                'report_type': 'strategy_performance',
                'data': {
                    'strategy_id': result[0] if result else strategy_id,
                    'run_count': result[1] if result else 0,
                    'avg_return_pct': result[2] if result else 0,
                    'avg_sharpe_ratio': result[3] if result else 0,
                    'avg_win_rate': result[4] if result else 0,
                    'total_trades': result[5] if result else 0
                }
            }
        else:
            return {'success': False, 'error': f'Unknown report type: {report_type}'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def main():
    parser = argparse.ArgumentParser(description='DuckDB Storage Service for Simulation')
    parser.add_argument('--duckdb', required=True, help='Path to DuckDB file')
    parser.add_argument('--operation', required=True, choices=['store_strategy', 'store_run', 'store_alerts', 'generate_report', 'query_calls'])
    parser.add_argument('--data', required=True, help='JSON data for operation')
    
    args = parser.parse_args()
    
    try:
        # Connect to DuckDB
        con = duckdb.connect(args.duckdb)
        setup_simulation_schema(con)
        
        # Parse data
        data = json.loads(args.data)
        
        # Execute operation
        if args.operation == 'store_strategy':
            result = store_strategy(con, data)
        elif args.operation == 'store_run':
            result = store_simulation_run(con, data)
        elif args.operation == 'store_alerts':
            result = store_alerts(con, data)
        elif args.operation == 'generate_report':
            result = generate_report(con, data)
        elif args.operation == 'query_calls':
            result = query_calls(con, data)
        else:
            result = {'success': False, 'error': f'Unknown operation: {args.operation}'}
        
        # Output result as JSON
        print(json.dumps(result))
        
        con.close()
        sys.exit(0 if result.get('success') else 1)
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()

