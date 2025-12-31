#!/usr/bin/env python3
"""
DuckDB RunsRepository - Simulation run metadata storage
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
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                strategy_id TEXT NOT NULL,
                filter_id TEXT NOT NULL,
                status TEXT NOT NULL,
                summary_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finished_at TIMESTAMP
            );
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_runs_strategy_id 
            ON runs(strategy_id);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_runs_status 
            ON runs(status);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_runs_created_at 
            ON runs(created_at DESC);
        """)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def find_by_id(db_path: str, run_id: str) -> dict:
    """Find run by ID"""
    try:
        con = safe_connect(db_path)
        
        result = con.execute(
            """
            SELECT run_id, strategy_id, filter_id, status, summary_json, created_at, finished_at
            FROM runs WHERE run_id = ?
            """,
            [run_id]
        ).fetchone()
        
        con.close()
        
        if not result:
            return None
        
        summary_json = json.loads(result[4]) if result[4] else None
        
        return {
            "run_id": result[0],
            "strategy_id": result[1],
            "filter_id": result[2],
            "status": result[3],
            "summary_json": summary_json,
            "created_at": result[5].isoformat() if result[5] else None,
            "finished_at": result[6].isoformat() if result[6] else None,
        }
    except Exception as e:
        return {"error": str(e)}


def list_runs(db_path: str, strategy_id: str = None, status: str = None, limit: int = 100) -> dict:
    """List runs with optional filters"""
    try:
        con = safe_connect(db_path)
        
        query = "SELECT run_id, strategy_id, filter_id, status, summary_json, created_at, finished_at FROM runs WHERE 1=1"
        params = []
        
        if strategy_id:
            query += " AND strategy_id = ?"
            params.append(strategy_id)
        
        if status:
            query += " AND status = ?"
            params.append(status)
        
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        
        results = con.execute(query, params).fetchall()
        
        con.close()
        
        runs = []
        for row in results:
            summary_json = json.loads(row[4]) if row[4] else None
            runs.append({
                "run_id": row[0],
                "strategy_id": row[1],
                "filter_id": row[2],
                "status": row[3],
                "summary_json": summary_json,
                "created_at": row[5].isoformat() if row[5] else None,
                "finished_at": row[6].isoformat() if row[6] else None,
            })
        
        return {"runs": runs}
    except Exception as e:
        return {"error": str(e)}


def create_run(db_path: str, data: dict) -> dict:
    """Create a new run"""
    try:
        con = safe_connect(db_path)
        
        run_id = data.get("run_id")
        strategy_id = data.get("strategy_id")
        filter_id = data.get("filter_id")
        status = data.get("status", "pending")
        summary_json = data.get("summary_json")
        
        if not run_id or not strategy_id or not filter_id:
            return {"success": False, "error": "run_id, strategy_id, and filter_id are required"}
        
        summary_json_str = json.dumps(summary_json) if summary_json else None
        
        con.execute(
            """
            INSERT INTO runs (run_id, strategy_id, filter_id, status, summary_json, created_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            [run_id, strategy_id, filter_id, status, summary_json_str]
        )
        
        con.close()
        
        return {"success": True, "run_id": run_id}
    except Exception as e:
        return {"success": False, "error": str(e)}


def update_run(db_path: str, run_id: str, data: dict) -> dict:
    """Update a run"""
    try:
        con = safe_connect(db_path)
        
        updates = []
        params = []
        
        if "status" in data:
            updates.append("status = ?")
            params.append(data["status"])
        
        if "summary_json" in data:
            updates.append("summary_json = ?")
            params.append(json.dumps(data["summary_json"]) if data["summary_json"] else None)
        
        if "finished_at" in data:
            updates.append("finished_at = ?")
            params.append(data["finished_at"])
        
        if not updates:
            con.close()
            return {"success": True, "message": "No updates provided"}
        
        params.append(run_id)
        
        query = f"UPDATE runs SET {', '.join(updates)} WHERE run_id = ?"
        con.execute(query, params)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="DuckDB RunsRepository")
    parser.add_argument("--operation", required=True, choices=["init", "find_by_id", "list", "create", "update"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--data", help="Data (JSON string)")
    parser.add_argument("--run-id", help="Run ID")
    parser.add_argument("--strategy-id", help="Strategy ID filter")
    parser.add_argument("--status", help="Status filter")
    parser.add_argument("--limit", type=int, default=100, help="Limit for list operation")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "find_by_id":
        if not args.run_id:
            result = None
        else:
            result = find_by_id(args.db_path, args.run_id)
    elif args.operation == "list":
        result = list_runs(args.db_path, args.strategy_id, args.status, args.limit)
    elif args.operation == "create":
        if not args.data:
            print("ERROR: Data required for create operation", file=sys.stderr)
            sys.exit(1)
        else:
            try:
                data = json.loads(args.data)
                result = create_run(args.db_path, data)
            except (json.JSONDecodeError, ValueError, RuntimeError) as e:
                print(f"ERROR: {str(e)}", file=sys.stderr)
                sys.exit(1)
    elif args.operation == "update":
        if not args.run_id or not args.data:
            print("ERROR: run-id and data required for update operation", file=sys.stderr)
            sys.exit(1)
        else:
            try:
                data = json.loads(args.data)
                result = update_run(args.db_path, args.run_id, data)
            except (json.JSONDecodeError, ValueError, RuntimeError) as e:
                print(f"ERROR: {str(e)}", file=sys.stderr)
                sys.exit(1)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

