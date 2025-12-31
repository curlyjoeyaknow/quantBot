#!/usr/bin/env python3
"""
DuckDB FiltersRepository - Filter preset storage (FilterV1)
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)


def safe_connect(db_path: str):
    """Safely connect to DuckDB, handling empty/invalid files"""
    db_file = Path(db_path)
    if db_file.exists():
        # Check if file is empty (0 bytes)
        if db_file.stat().st_size == 0:
            db_file.unlink()  # Delete empty file
        else:
            # Try to connect to validate it's a valid DuckDB file
            try:
                test_con = duckdb.connect(db_path)
                test_con.close()
            except Exception:
                # File exists but is invalid - delete it
                db_file.unlink()
    
    return duckdb.connect(db_path)


def init_database(db_path: str) -> dict:
    """Initialize DuckDB database and schema"""
    try:
        con = safe_connect(db_path)
        
        # Create table if it doesn't exist
        con.execute("""
            CREATE TABLE IF NOT EXISTS filters (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                json TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_filters_name 
            ON filters(name);
        """)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def find_by_id(db_path: str, filter_id: str) -> dict:
    """Find filter by ID"""
    try:
        con = safe_connect(db_path)
        
        result = con.execute(
            "SELECT id, name, json, updated_at FROM filters WHERE id = ?",
            [filter_id]
        ).fetchone()
        
        con.close()
        
        if not result:
            return None
        
        return {
            "id": result[0],
            "name": result[1],
            "json": json.loads(result[2]),
            "updated_at": result[3].isoformat() if result[3] else None,
        }
    except Exception as e:
        return {"error": str(e)}


def list_filters(db_path: str) -> dict:
    """List all filters"""
    try:
        con = safe_connect(db_path)
        
        results = con.execute(
            "SELECT id, name, json, updated_at FROM filters ORDER BY updated_at DESC"
        ).fetchall()
        
        con.close()
        
        filters = []
        for row in results:
            filters.append({
                "id": row[0],
                "name": row[1],
                "json": json.loads(row[2]),
                "updated_at": row[3].isoformat() if row[3] else None,
            })
        
        return {"filters": filters}
    except Exception as e:
        return {"error": str(e)}


def create_filter(db_path: str, data: dict) -> dict:
    """Create a new filter"""
    try:
        con = safe_connect(db_path)
        
        filter_id = data.get("id")
        name = data.get("name")
        filter_json = data.get("json", {})
        
        if not filter_id or not name:
            return {"success": False, "error": "id and name are required"}
        
        # Convert filter_json to JSON string
        json_str = json.dumps(filter_json)
        
        con.execute(
            """
            INSERT INTO filters (id, name, json, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                json = EXCLUDED.json,
                updated_at = CURRENT_TIMESTAMP
            """,
            [filter_id, name, json_str]
        )
        
        con.close()
        
        return {"success": True, "id": filter_id}
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_filter(db_path: str, filter_id: str) -> dict:
    """Delete a filter"""
    try:
        con = safe_connect(db_path)
        
        con.execute("DELETE FROM filters WHERE id = ?", [filter_id])
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="DuckDB FiltersRepository")
    parser.add_argument("--operation", required=True, choices=["init", "find_by_id", "list", "create", "delete"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--data", help="Data (JSON string)")
    parser.add_argument("--filter-id", help="Filter ID")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "find_by_id":
        if not args.filter_id:
            result = None
        else:
            result = find_by_id(args.db_path, args.filter_id)
    elif args.operation == "list":
        result = list_filters(args.db_path)
    elif args.operation == "create":
        if not args.data:
            print("ERROR: Data required for create operation", file=sys.stderr)
            sys.exit(1)
        else:
            try:
                data = json.loads(args.data)
                result = create_filter(args.db_path, data)
            except (json.JSONDecodeError, ValueError, RuntimeError) as e:
                print(f"ERROR: {str(e)}", file=sys.stderr)
                sys.exit(1)
    elif args.operation == "delete":
        if not args.filter_id:
            print("ERROR: filter-id required for delete operation", file=sys.stderr)
            sys.exit(1)
        result = delete_filter(args.db_path, args.filter_id)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

