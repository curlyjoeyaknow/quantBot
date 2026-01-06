#!/usr/bin/env python3
"""
DuckDB StrategiesRepository - Strategy configuration storage
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# Add tools to path for shared imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from shared.duckdb_adapter import safe_connect


def init_database(db_path: str) -> dict:
    """Initialize DuckDB database and schema"""
    try:
        con = safe_connect(db_path)
        
        # Create table if it doesn't exist
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
        
        # Create sequence for ID generation (if it doesn't exist)
        try:
            con.execute("""
                CREATE SEQUENCE IF NOT EXISTS strategies_id_seq;
            """)
            
            # Initialize sequence to max existing ID + 1 if table has data
            try:
                max_id_result = con.execute("SELECT COALESCE(MAX(id), 0) FROM strategies").fetchone()
                if max_id_result and max_id_result[0] is not None and max_id_result[0] > 0:
                    # Set sequence to max ID + 1
                    con.execute(f"SELECT setval('strategies_id_seq', {max_id_result[0] + 1}, false)")
            except Exception:
                # If setval fails, sequence will start from 1, which is fine
                pass
        except Exception:
            # Sequence creation failed, we'll handle ID generation manually
            pass
        
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
        con = safe_connect(db_path)
        
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
        con = safe_connect(db_path)
        
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
        con = safe_connect(db_path)
        
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
        
        # Get next ID from sequence or calculate max + 1
        try:
            # Try to use sequence
            next_id_result = con.execute("SELECT nextval('strategies_id_seq')").fetchone()
            next_id = next_id_result[0] if next_id_result else None
        except Exception:
            # Sequence doesn't exist or failed, calculate max + 1
            max_id_result = con.execute("SELECT COALESCE(MAX(id), 0) FROM strategies").fetchone()
            next_id = (max_id_result[0] if max_id_result and max_id_result[0] is not None else 0) + 1
        
        # Insert the new strategy with explicit ID
        con.execute("""
            INSERT INTO strategies (id, name, version, category, description, config_json, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (next_id, name, version, category, description, config_json, is_active))
        
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
        con = safe_connect(db_path)
        
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

