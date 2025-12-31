#!/usr/bin/env python3
"""
DuckDB RunReplayIndexRepository - Replay frame index storage
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
            CREATE TABLE IF NOT EXISTS run_replay_index (
                run_id TEXT NOT NULL,
                token TEXT NOT NULL,
                path TEXT NOT NULL,
                frame_count INTEGER NOT NULL,
                PRIMARY KEY (run_id, token)
            );
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_run_replay_index_run_id 
            ON run_replay_index(run_id);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_run_replay_index_token 
            ON run_replay_index(token);
        """)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert(db_path: str, data: dict) -> dict:
    """Upsert replay index entry"""
    try:
        con = safe_connect(db_path)
        
        run_id = data.get("run_id")
        token = data.get("token")
        path = data.get("path")
        frame_count = data.get("frame_count", 0)
        
        if not run_id or not token or not path:
            return {"success": False, "error": "run_id, token, and path are required"}
        
        con.execute(
            """
            INSERT INTO run_replay_index (run_id, token, path, frame_count)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (run_id, token) DO UPDATE SET
                path = EXCLUDED.path,
                frame_count = EXCLUDED.frame_count
            """,
            [run_id, token, path, frame_count]
        )
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def find_by_run_and_token(db_path: str, run_id: str, token: str) -> dict:
    """Find replay index entry by run_id and token"""
    try:
        con = safe_connect(db_path)
        
        result = con.execute(
            "SELECT run_id, token, path, frame_count FROM run_replay_index WHERE run_id = ? AND token = ?",
            [run_id, token]
        ).fetchone()
        
        con.close()
        
        if not result:
            return None
        
        return {
            "run_id": result[0],
            "token": result[1],
            "path": result[2],
            "frame_count": result[3],
        }
    except Exception as e:
        return {"error": str(e)}


def list_by_run_id(db_path: str, run_id: str) -> dict:
    """List all replay index entries for a run"""
    try:
        con = safe_connect(db_path)
        
        results = con.execute(
            "SELECT run_id, token, path, frame_count FROM run_replay_index WHERE run_id = ? ORDER BY token",
            [run_id]
        ).fetchall()
        
        con.close()
        
        entries = []
        for row in results:
            entries.append({
                "run_id": row[0],
                "token": row[1],
                "path": row[2],
                "frame_count": row[3],
            })
        
        return {"entries": entries}
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="DuckDB RunReplayIndexRepository")
    parser.add_argument("--operation", required=True, choices=["init", "upsert", "find_by_run_and_token", "list_by_run_id"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--data", help="Data (JSON string)")
    parser.add_argument("--run-id", help="Run ID")
    parser.add_argument("--token", help="Token address")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "upsert":
        if not args.data:
            print("ERROR: Data required for upsert operation", file=sys.stderr)
            sys.exit(1)
        else:
            try:
                data = json.loads(args.data)
                result = upsert(args.db_path, data)
            except (json.JSONDecodeError, ValueError, RuntimeError) as e:
                print(f"ERROR: {str(e)}", file=sys.stderr)
                sys.exit(1)
    elif args.operation == "find_by_run_and_token":
        if not args.run_id or not args.token:
            print("ERROR: run-id and token required for find_by_run_and_token operation", file=sys.stderr)
            sys.exit(1)
        result = find_by_run_and_token(args.db_path, args.run_id, args.token)
    elif args.operation == "list_by_run_id":
        if not args.run_id:
            print("ERROR: run-id required for list_by_run_id operation", file=sys.stderr)
            sys.exit(1)
        result = list_by_run_id(args.db_path, args.run_id)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

