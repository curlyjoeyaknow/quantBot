#!/usr/bin/env python3
"""
Run simulation from canonical contract

CLI bridge script that accepts SimInput JSON and returns SimResult JSON.
Used by the dual-run harness to execute Python simulations.
"""

import sys
import json
import os
from pathlib import Path

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'simulation'))

import duckdb
from contracts import SimInput, SimResult
from simulator import DuckDBSimulator

def main():
    """Main entry point"""
    try:
        # Read SimInput from stdin
        input_json = sys.stdin.read()
        sim_input = SimInput.from_dict(json.loads(input_json))
        
        # Create in-memory DuckDB connection
        con = duckdb.connect(':memory:')
        simulator = DuckDBSimulator(con)
        
        # Run simulation from contract
        result = simulator.run_from_contract(sim_input)
        
        # Output SimResult as JSON
        print(json.dumps(result.to_dict()))
        
        con.close()
        sys.exit(0)
    except Exception as e:
        # Output error as JSON
        error_result = {
            'error': str(e),
            'run_id': json.loads(sys.stdin.read()).get('run_id', 'unknown') if sys.stdin.readable() else 'unknown'
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == '__main__':
    main()

