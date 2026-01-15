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

if __name__ == '__main__':
    main()

