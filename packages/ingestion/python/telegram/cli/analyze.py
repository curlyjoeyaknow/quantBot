#!/usr/bin/env python3
"""
CLI script for statistical analysis.
"""

import argparse
import json
import sys
import duckdb
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from statistics.analysis import StatisticalAnalyzer

def main():
    parser = argparse.ArgumentParser(description='Statistical analysis')
    parser.add_argument('--duckdb', required=True)
    parser.add_argument('--caller', help='Analyze specific caller')
    parser.add_argument('--mint', help='Analyze specific token')
    parser.add_argument('--correlation', action='store_true', help='Correlation analysis')
    
    args = parser.parse_args()
    
    try:
        con = duckdb.connect(args.duckdb)
    except Exception as e:
        print(json.dumps({'error': f'Failed to connect to DuckDB: {e}'}))
        sys.exit(1)
    
    try:
        analyzer = StatisticalAnalyzer(con)
        
        if args.caller:
            result = analyzer.analyze_caller_performance(args.caller)
        elif args.mint:
            result = analyzer.analyze_token_patterns(args.mint)
        elif args.correlation:
            # Example correlation analysis
            result = analyzer.correlation_analysis(
                ['price_at_alert', 'volume_1h', 'mcap_at_alert'],
                'ath_multiple'
            )
        else:
            result = {'error': 'Specify --caller, --mint, or --correlation'}
        
        print(json.dumps(result, indent=2))
    finally:
        con.close()

if __name__ == '__main__':
    main()

