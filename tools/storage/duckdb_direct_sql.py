#!/usr/bin/env python3
"""
DuckDB Direct SQL Execution - Execute SQL queries directly
Supports both file-based and in-memory databases
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

# Global connection cache for in-memory databases
_connection_cache: dict[str, duckdb.DuckDBPyConnection] = {}


def get_connection(db_path: str) -> duckdb.DuckDBPyConnection:
    """Get or create DuckDB connection, handling in-memory and file-based databases"""
    # For in-memory databases, reuse connection
    if db_path == ':memory:':
        if db_path not in _connection_cache:
            _connection_cache[db_path] = duckdb.connect(db_path)
        return _connection_cache[db_path]
    
    # For file-based databases, create new connection each time
    # (connections are closed after each operation)
    db_file = Path(db_path)
    if db_file.exists() and db_file.stat().st_size == 0:
        db_file.unlink()  # Delete empty file
    
    return duckdb.connect(db_path)


def execute_sql(db_path: str, sql: str) -> dict:
    """Execute SQL statement (no return value)"""
    try:
        con = get_connection(db_path)
        con.execute(sql)
        
        # For file-based databases, commit and close
        if db_path != ':memory:':
            con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def query_sql(db_path: str, sql: str) -> dict:
    """Execute SQL query and return results"""
    try:
        con = get_connection(db_path)
        result = con.execute(sql)
        
        # Get column information
        # DuckDB description format: (name, type, ...)
        columns = []
        if result.description:
            for col in result.description:
                col_name = col[0] if len(col) > 0 else ""
                col_type = col[1] if len(col) > 1 else ""
                columns.append({"name": col_name, "type": col_type})
        
        # Fetch all rows
        rows = result.fetchall()
        
        # For file-based databases, close connection
        if db_path != ':memory:':
            con.close()
        
        return {
            "columns": columns,
            "rows": rows,
        }
    except Exception as e:
        return {
            "columns": [],
            "rows": [],
            "error": str(e),
        }


def close_connection(db_path: str) -> dict:
    """Close database connection (for in-memory databases)"""
    try:
        if db_path == ':memory:' and db_path in _connection_cache:
            _connection_cache[db_path].close()
            del _connection_cache[db_path]
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description='DuckDB Direct SQL Execution')
    parser.add_argument('--db-path', required=True, help='Path to DuckDB file or :memory:')
    parser.add_argument('--operation', required=True, choices=['execute_sql', 'query_sql', 'close'])
    parser.add_argument('--sql', help='SQL statement or query')
    
    args = parser.parse_args()
    
    if args.operation == 'execute_sql':
        if not args.sql:
            print(json.dumps({"success": False, "error": "SQL statement required"}))
            sys.exit(1)
        result = execute_sql(args.db_path, args.sql)
        print(json.dumps(result))
    
    elif args.operation == 'query_sql':
        if not args.sql:
            print(json.dumps({"columns": [], "rows": [], "error": "SQL query required"}))
            sys.exit(1)
        result = query_sql(args.db_path, args.sql)
        print(json.dumps(result))
    
    elif args.operation == 'close':
        result = close_connection(args.db_path)
        print(json.dumps(result))


if __name__ == '__main__':
    main()

