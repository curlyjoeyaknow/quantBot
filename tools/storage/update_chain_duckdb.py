#!/usr/bin/env python3
"""
Update Chain in DuckDB

Updates the chain field for a specific token address in caller_links_d table.
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import duckdb
except ImportError:
    print(json.dumps({"error": "duckdb package not installed", "success": False}))
    sys.exit(1)


def update_chain(db_path: str, address: str, new_chain: str) -> dict:
    """Update chain for a token address"""
    
    if not Path(db_path).exists():
        return {"error": f"Database not found: {db_path}", "success": False}
    
    try:
        conn = duckdb.connect(db_path)
        
        # Check if caller_links_d exists
        tables = conn.execute("SHOW TABLES").fetchall()
        table_names = [t[0] for t in tables]
        
        if 'caller_links_d' not in table_names:
            return {"error": "caller_links_d table not found", "success": False}
        
        # Update chain
        query = """
        UPDATE caller_links_d
        SET chain = ?
        WHERE mint = ? AND LOWER(chain) = 'evm'
        """
        
        conn.execute(query, [new_chain, address])
        rows_updated = conn.execute("SELECT changes()").fetchone()[0]
        
        conn.close()
        
        return {"success": True, "rows_updated": rows_updated}
        
    except Exception as e:
        return {"error": str(e), "success": False}


def main():
    parser = argparse.ArgumentParser(description='Update chain in DuckDB')
    parser.add_argument('--db-path', required=True, help='Path to DuckDB database')
    parser.add_argument('--address', required=True, help='Token address')
    parser.add_argument('--new-chain', required=True, help='New chain name')
    
    args = parser.parse_args()
    
    result = update_chain(args.db_path, args.address, args.new_chain)
    print(json.dumps(result))


if __name__ == '__main__':
    main()

