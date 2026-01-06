#!/usr/bin/env python3
"""
DuckDB CallersRepository - Extract and manage caller information from calls data
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
        
        con.execute("""
            CREATE TABLE IF NOT EXISTS callers (
                id INTEGER PRIMARY KEY,
                source TEXT NOT NULL,
                handle TEXT NOT NULL,
                display_name TEXT,
                attributes_json TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (source, handle)
            );
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_callers_source_handle 
            ON callers(source, handle);
        """)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_or_create_caller(db_path: str, source: str, handle: str, display_name: str = None, attributes: str = None) -> dict:
    """Get or create a caller"""
    try:
        con = safe_connect(db_path)
        
        # Try to find existing
        result = con.execute("""
            SELECT id, source, handle, display_name, attributes_json, created_at, updated_at
            FROM callers
            WHERE source = ? AND handle = ?
        """, (source, handle)).fetchone()
        
        if result:
            con.close()
            return {
                "id": result[0],
                "source": result[1],
                "handle": result[2],
                "display_name": result[3],
                "attributes_json": json.loads(result[4]) if result[4] else None,
                "created_at": result[5].isoformat(),
                "updated_at": result[6].isoformat(),
            }
        
        # Create new
        con.execute("""
            INSERT INTO callers (source, handle, display_name, attributes_json)
            VALUES (?, ?, ?, ?)
        """, (source, handle, display_name, attributes))
        
        # Get the created record
        result = con.execute("""
            SELECT id, source, handle, display_name, attributes_json, created_at, updated_at
            FROM callers
            WHERE source = ? AND handle = ?
        """, (source, handle)).fetchone()
        
        con.close()
        
        return {
            "id": result[0],
            "source": result[1],
            "handle": result[2],
            "display_name": result[3],
            "attributes_json": json.loads(result[4]) if result[4] else None,
            "created_at": result[5].isoformat(),
            "updated_at": result[6].isoformat(),
        }
    except Exception as e:
        return {"error": str(e)}


def find_by_name(db_path: str, source: str, handle: str) -> dict:
    """Find caller by name"""
    try:
        con = safe_connect(db_path)
        
        result = con.execute("""
            SELECT id, source, handle, display_name, attributes_json, created_at, updated_at
            FROM callers
            WHERE source = ? AND handle = ?
        """, (source, handle)).fetchone()
        
        con.close()
        
        if not result:
            return None
        
        return {
            "id": result[0],
            "source": result[1],
            "handle": result[2],
            "display_name": result[3],
            "attributes_json": json.loads(result[4]) if result[4] else None,
            "created_at": result[5].isoformat(),
            "updated_at": result[6].isoformat(),
        }
    except Exception as e:
        return {"error": str(e)}


def find_by_id(db_path: str, caller_id: int) -> dict:
    """Find caller by ID"""
    try:
        con = safe_connect(db_path)
        
        result = con.execute("""
            SELECT id, source, handle, display_name, attributes_json, created_at, updated_at
            FROM callers
            WHERE id = ?
        """, (caller_id,)).fetchone()
        
        con.close()
        
        if not result:
            return None
        
        return {
            "id": result[0],
            "source": result[1],
            "handle": result[2],
            "display_name": result[3],
            "attributes_json": json.loads(result[4]) if result[4] else None,
            "created_at": result[5].isoformat(),
            "updated_at": result[6].isoformat(),
        }
    except Exception as e:
        return {"error": str(e)}


def list_callers(db_path: str) -> dict:
    """List all callers"""
    try:
        con = safe_connect(db_path)
        
        results = con.execute("""
            SELECT id, source, handle, display_name, attributes_json, created_at, updated_at
            FROM callers
            ORDER BY created_at DESC
        """).fetchall()
        
        con.close()
        
        return [
            {
                "id": row[0],
                "source": row[1],
                "handle": row[2],
                "display_name": row[3],
                "attributes_json": json.loads(row[4]) if row[4] else None,
                "created_at": row[5].isoformat(),
                "updated_at": row[6].isoformat(),
            }
            for row in results
        ]
    except Exception as e:
        return {"error": str(e)}


def sync_from_calls(db_path: str) -> dict:
    """Sync callers from calls data (user_calls_d and caller_links_d)"""
    try:
        con = safe_connect(db_path)
        
        # Extract unique callers from user_calls_d
        # Note: This assumes the calls database is in the same DuckDB file or accessible
        # In practice, you might need to pass the calls database path separately
        
        # For now, we'll extract from user_calls_d if it exists in the same database
        try:
            callers_from_calls = con.execute("""
                SELECT DISTINCT 
                    'telegram' as source,
                    caller_name as handle,
                    caller_name as display_name
                FROM user_calls_d
                WHERE caller_name IS NOT NULL AND caller_name != ''
            """).fetchall()
            
            synced_count = 0
            for caller_row in callers_from_calls:
                source, handle, display_name = caller_row
                try:
                    con.execute("""
                        INSERT OR IGNORE INTO callers (source, handle, display_name)
                        VALUES (?, ?, ?)
                    """, (source, handle, display_name))
                    synced_count += 1
                except:
                    pass  # Already exists
            
            con.close()
            
            return {"synced_count": synced_count}
        except Exception as e:
            # Table doesn't exist or error
            con.close()
            return {"synced_count": 0, "warning": f"Could not sync from calls: {str(e)}"}
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="DuckDB CallersRepository")
    parser.add_argument("--operation", required=True, choices=["init", "get_or_create", "find_by_name", "find_by_id", "list", "sync_from_calls"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--source", help="Caller source")
    parser.add_argument("--handle", help="Caller handle")
    parser.add_argument("--display-name", help="Display name")
    parser.add_argument("--attributes", help="Attributes (JSON string)")
    parser.add_argument("--id", type=int, help="Caller ID")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "get_or_create":
        if not args.source or not args.handle:
            result = {"error": "Source and handle required"}
        else:
            result = get_or_create_caller(args.db_path, args.source, args.handle, args.display_name, args.attributes)
    elif args.operation == "find_by_name":
        if not args.source or not args.handle:
            result = None
        else:
            result = find_by_name(args.db_path, args.source, args.handle)
    elif args.operation == "find_by_id":
        if not args.id:
            result = None
        else:
            result = find_by_id(args.db_path, args.id)
    elif args.operation == "list":
        result = list_callers(args.db_path)
    elif args.operation == "sync_from_calls":
        result = sync_from_calls(args.db_path)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

