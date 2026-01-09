#!/usr/bin/env python3
"""
Query EVM Tokens from DuckDB

Finds all tokens with chain='evm' in caller_links_d table.
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import duckdb
except ImportError:
    print(json.dumps({"error": "duckdb package not installed"}))
    sys.exit(1)


def query_evm_tokens(db_path: str) -> dict:
    """Query tokens with chain='evm' from DuckDB"""
    
    if not Path(db_path).exists():
        return {"error": f"Database not found: {db_path}", "tokens": []}
    
    try:
        from tools.shared.duckdb_adapter import get_readonly_connection
        with get_readonly_connection(db_path) as conn:
            # Check if caller_links_d exists
        tables = conn.execute("SHOW TABLES").fetchall()
        table_names = [t[0] for t in tables]
        
        if 'caller_links_d' not in table_names:
            return {"error": "caller_links_d table not found", "tokens": []}
        
        # Query for EVM tokens
        query = """
        SELECT DISTINCT mint
        FROM caller_links_d
        WHERE LOWER(chain) = 'evm'
          AND mint IS NOT NULL
          AND mint != ''
        """
        
        results = conn.execute(query).fetchall()
        tokens = [row[0] for row in results]
        
        conn.close()
        
        return {"tokens": tokens}
        
    except Exception as e:
        return {"error": str(e), "tokens": []}


def main():
    parser = argparse.ArgumentParser(description='Query EVM tokens from DuckDB')
    parser.add_argument('--db-path', required=True, help='Path to DuckDB database')
    
    args = parser.parse_args()
    
    result = query_evm_tokens(args.db_path)
    print(json.dumps(result))


if __name__ == '__main__':
    main()

