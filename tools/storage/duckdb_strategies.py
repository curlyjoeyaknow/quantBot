#!/usr/bin/env python3
"""
DuckDB StrategiesRepository - Strategy configuration storage
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


def init_database(db_path: str) -> dict:
    """Initialize DuckDB database and schema"""
    try:
        con = duckdb.connect(db_path)
        
        con.execute("""
            CREATE TABLE IF NOT EXISTS strategies (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL DEFAULT '1',
                category TEXT,
                description TEXT,
                config_json TEXT NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (name, version)
            );
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_strategies_name_version 
            ON strategies(name, version);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_strategies_is_active 
            ON strategies(is_active);
        """)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def find_all_active(db_path: str) -> dict:
    """Find all active strategies"""
    try:
        con = duckdb.connect(db_path)
        
        results = con.execute("""
            SELECT id, name, version, category, description, config_json, is_active, created_at, updated_at
            FROM strategies
            WHERE is_active = true
            ORDER BY name, version
        """).fetchall()
        
        con.close()
        
        return [
            {
                "id": row[0],
                "name": row[1],
                "version": row[2],
                "category": row[3],
                "description": row[4],
                "config_json": json.loads(row[5]),
                "is_active": row[6],
                "created_at": row[7].isoformat(),
                "updated_at": row[8].isoformat(),
            }
            for row in results
        ]
    except Exception as e:
        return {"error": str(e)}


def find_by_name(db_path: str, name: str, version: str) -> dict:
    """Find strategy by name and version"""
    try:
        con = duckdb.connect(db_path)
        
        result = con.execute("""
            SELECT id, name, version, category, description, config_json, is_active, created_at, updated_at
            FROM strategies
            WHERE name = ? AND version = ?
        """, (name, version)).fetchone()
        
        con.close()
        
        if not result:
            return None
        
        return {
            "id": result[0],
            "name": result[1],
            "version": result[2],
            "category": result[3],
            "description": result[4],
            "config_json": json.loads(result[5]),
            "is_active": result[6],
            "created_at": result[7].isoformat(),
            "updated_at": result[8].isoformat(),
        }
    except Exception as e:
        return {"error": str(e)}


def create_strategy(db_path: str, data: dict) -> dict:
    """Create a new strategy"""
    try:
        con = duckdb.connect(db_path)
        
        name = data.get("name")
        if not name:
            con.close()
            raise ValueError("Strategy name is required")
        
        version = data.get("version", "1")
        category = data.get("category")
        description = data.get("description")
        config_json = json.dumps(data.get("config_json", {}))
        is_active = data.get("is_active", True)
        
        # Check if strategy already exists
        existing = con.execute("""
            SELECT id FROM strategies
            WHERE name = ? AND version = ?
        """, (name, version)).fetchone()
        
        if existing:
            con.close()
            raise ValueError(f"Strategy '{name}' version '{version}' already exists")
        
        # Insert the new strategy
        con.execute("""
            INSERT INTO strategies (name, version, category, description, config_json, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (name, version, category, description, config_json, is_active))
        
        # Get the created record
        result = con.execute("""
            SELECT id FROM strategies
            WHERE name = ? AND version = ?
        """, (name, version)).fetchone()
        
        con.close()
        
        if not result or len(result) == 0:
            raise RuntimeError("Failed to retrieve created strategy ID")
        
        return {"id": result[0]}
    except Exception as e:
        # Re-raise as ValueError so it can be caught and handled properly
        raise ValueError(str(e)) from e


def list_strategies(db_path: str) -> dict:
    """List all strategies"""
    try:
        con = duckdb.connect(db_path)
        
        results = con.execute("""
            SELECT id, name, version, category, description, config_json, is_active, created_at, updated_at
            FROM strategies
            ORDER BY name, version DESC
        """).fetchall()
        
        con.close()
        
        return [
            {
                "id": row[0],
                "name": row[1],
                "version": row[2],
                "category": row[3],
                "description": row[4],
                "config_json": json.loads(row[5]),
                "is_active": row[6],
                "created_at": row[7].isoformat(),
                "updated_at": row[8].isoformat(),
            }
            for row in results
        ]
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="DuckDB StrategiesRepository")
    parser.add_argument("--operation", required=True, choices=["init", "find_all_active", "find_by_name", "create", "list"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--data", help="Data (JSON string)")
    parser.add_argument("--name", help="Strategy name")
    parser.add_argument("--version", help="Strategy version")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "find_all_active":
        result = find_all_active(args.db_path)
    elif args.operation == "find_by_name":
        if not args.name:
            result = None
        else:
            version = args.version or "1"
            result = find_by_name(args.db_path, args.name, version)
    elif args.operation == "create":
        if not args.data:
            print("ERROR: Data required for create operation", file=sys.stderr)
            sys.exit(1)
        else:
            try:
                data = json.loads(args.data)
                result = create_strategy(args.db_path, data)
            except (json.JSONDecodeError, ValueError, RuntimeError) as e:
                print(f"ERROR: {str(e)}", file=sys.stderr)
                sys.exit(1)
    elif args.operation == "list":
        result = list_strategies(args.db_path)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

