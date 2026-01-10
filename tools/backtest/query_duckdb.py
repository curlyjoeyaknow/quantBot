#!/usr/bin/env python3
"""
Query DuckDB in readonly mode.

Usage:
    python3 query_duckdb.py data/alerts.duckdb "SELECT * FROM optimizer.runs_d LIMIT 10"
    python3 query_duckdb.py data/alerts.duckdb "SELECT * FROM optimizer.trials_f WHERE run_id = 'xxx'"
"""
import sys
import duckdb
from pathlib import Path

def query_duckdb(duckdb_path: str, sql: str, read_only: bool = True):
    """Execute SQL query on DuckDB in readonly mode."""
    if not Path(duckdb_path).exists():
        print(f"Error: Database not found: {duckdb_path}", file=sys.stderr)
        return None
    
    try:
        # Open in readonly mode to prevent locks
        from tools.shared.duckdb_adapter import get_readonly_connection
        with get_readonly_connection(duckdb_path) as con:
            result = con.execute(sql).fetchall()
            columns = [d[0] for d in con.description] if con.description else []
            
            # Print as JSON for easy parsing
            import json
            rows = [dict(zip(columns, r)) for r in result]
            print(json.dumps(rows, indent=2, default=str))
            return rows
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return None

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    
    duckdb_path = sys.argv[1]
    sql = sys.argv[2]
    read_only = True  # Always use readonly for queries
    
    query_duckdb(duckdb_path, sql, read_only)
