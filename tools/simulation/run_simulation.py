#!/usr/bin/env python3
"""
CLI script to run simulations from TypeScript handler.
Accepts JSON config, returns JSON results.
"""

import json
import sys
import duckdb
from datetime import datetime
from simulator import DuckDBSimulator, StrategyConfig

def main():
    # Read config from stdin (JSON)
    try:
        config = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({'error': f'Invalid JSON: {e}'}))
        sys.exit(1)
    
    # Validate required fields
    if 'duckdb_path' not in config:
        print(json.dumps({'error': 'duckdb_path required'}))
        sys.exit(1)
    
    if 'strategy' not in config:
        print(json.dumps({'error': 'strategy required'}))
        sys.exit(1)
    
    # Connect to DuckDB
    try:
        con = duckdb.connect(config['duckdb_path'])
    except Exception as e:
        print(json.dumps({'error': f'Failed to connect to DuckDB: {e}'}))
        sys.exit(1)
    
    # Create simulator
    simulator = DuckDBSimulator(con)
    
    # Parse strategy config
    try:
        strategy = StrategyConfig(**config['strategy'])
    except Exception as e:
        print(json.dumps({'error': f'Invalid strategy config: {e}'}))
        sys.exit(1)
    
    # Run simulation(s)
    try:
        if config.get('batch'):
            # Batch mode
            mints = config.get('mints', [])
            alert_timestamps = [
                datetime.fromisoformat(ts) for ts in config.get('alert_timestamps', [])
            ]
            
            if len(mints) != len(alert_timestamps):
                print(json.dumps({'error': 'mints and alert_timestamps must have same length'}))
                sys.exit(1)
            
            results = simulator.batch_simulate(
                strategy,
                mints,
                alert_timestamps,
                config.get('initial_capital', 1000.0)
            )
        else:
            # Single simulation
            if 'mint' not in config or 'alert_timestamp' not in config:
                print(json.dumps({'error': 'mint and alert_timestamp required for single simulation'}))
                sys.exit(1)
            
            result = simulator.run_simulation(
                strategy,
                config['mint'],
                datetime.fromisoformat(config['alert_timestamp']),
                config.get('initial_capital', 1000.0),
                config.get('lookback_minutes', 260),
                config.get('lookforward_minutes', 1440)
            )
            results = [result]
        
        # Output JSON results
        output = {
            'results': results,
            'summary': {
                'total_runs': len(results),
                'successful': len([r for r in results if 'error' not in r]),
                'failed': len([r for r in results if 'error' in r])
            }
        }
        
        print(json.dumps(output, indent=2))
        
    except Exception as e:
        print(json.dumps({'error': f'Simulation failed: {e}'}))
        sys.exit(1)
    finally:
        con.close()

if __name__ == '__main__':
    main()

