#!/usr/bin/env python3
"""
CLI script for running simulations.
"""

import argparse
import json
import sys
import duckdb
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from simulation.simulator import DuckDBSimulator, StrategyConfig
from datetime import datetime

def main():
    parser = argparse.ArgumentParser(description='Run trading simulations')
    parser.add_argument('--duckdb', required=True, help='DuckDB file path')
    parser.add_argument('--strategy', required=True, help='Strategy JSON file')
    parser.add_argument('--mint', help='Single mint to simulate')
    parser.add_argument('--batch', action='store_true', help='Batch mode')
    parser.add_argument('--output', help='Output JSON file')
    
    args = parser.parse_args()
    
    # Load strategy
    try:
        with open(args.strategy, 'r') as f:
            strategy_data = json.load(f)
        strategy = StrategyConfig(**strategy_data)
    except Exception as e:
        print(json.dumps({'error': f'Failed to load strategy: {e}'}))
        sys.exit(1)
    
    # Connect to DuckDB
    try:
        con = duckdb.connect(args.duckdb)
    except Exception as e:
        print(json.dumps({'error': f'Failed to connect to DuckDB: {e}'}))
        sys.exit(1)
    
    try:
        simulator = DuckDBSimulator(con)
        
        # Run simulation
        if args.batch:
            # Batch mode - would need to fetch all calls from DB
            print(json.dumps({'error': 'Batch mode not yet implemented - use single mint mode'}))
            sys.exit(1)
        else:
            # Single mint
            if not args.mint:
                print(json.dumps({'error': '--mint required for single simulation'}))
                sys.exit(1)
            
            # Default alert timestamp to now if not provided
            alert_time = datetime.now()
            
            result = simulator.run_simulation(
                strategy,
                args.mint,
                alert_time,
                initial_capital=1000.0
            )
            results = [result]
        
        # Output results
        output = {'results': results}
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(output, f, indent=2)
        else:
            print(json.dumps(output, indent=2))
    finally:
        con.close()

if __name__ == '__main__':
    main()

