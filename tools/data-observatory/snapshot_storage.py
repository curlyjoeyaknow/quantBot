#!/usr/bin/env python3
"""
DuckDB Snapshot Storage
Stores snapshot references and events in DuckDB for fast querying.
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
    """
    Safely connect to DuckDB, handling empty/invalid files.
    
    Args:
        db_path: Path to DuckDB database file
    """
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
        
        # Snapshot references table
        con.execute("""
            CREATE TABLE IF NOT EXISTS snapshot_refs (
                snapshot_id TEXT NOT NULL PRIMARY KEY,
                content_hash TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL,
                spec_json TEXT NOT NULL,
                manifest_json TEXT NOT NULL
            );
        """)
        
        # Create indexes separately (DuckDB syntax)
        con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_content_hash ON snapshot_refs(content_hash);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_created_at ON snapshot_refs(created_at);")
        
        # Snapshot events table
        # Stores canonical events keyed by snapshot_id
        con.execute("""
            CREATE TABLE IF NOT EXISTS snapshot_events (
                id INTEGER PRIMARY KEY,
                snapshot_id TEXT NOT NULL,
                asset TEXT NOT NULL,
                chain TEXT NOT NULL,
                venue TEXT NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                event_type TEXT NOT NULL,
                event_json TEXT NOT NULL
            );
        """)
        
        # Create indexes separately (DuckDB syntax)
        con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_events_snapshot_id ON snapshot_events(snapshot_id);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_events_asset ON snapshot_events(asset);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_events_timestamp ON snapshot_events(timestamp);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_events_event_type ON snapshot_events(event_type);")
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def store_snapshot_ref(db_path: str, ref: dict) -> dict:
    """Store snapshot reference"""
    try:
        con = safe_connect(db_path)
        
        snapshot_id = ref.get("snapshotId")
        content_hash = ref.get("contentHash")
        created_at = ref.get("createdAt")
        spec = ref.get("spec", {})
        manifest = ref.get("manifest", {})
        
        # Delete existing ref (idempotent replacement)
        con.execute("DELETE FROM snapshot_refs WHERE snapshot_id = ?", (snapshot_id,))
        
        con.execute("""
            INSERT INTO snapshot_refs (
                snapshot_id, content_hash, created_at, spec_json, manifest_json
            ) VALUES (?, ?, ?, ?, ?)
        """, (
            snapshot_id,
            content_hash,
            created_at,
            json.dumps(spec),
            json.dumps(manifest),
        ))
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_snapshot_ref(db_path: str, snapshot_id: str) -> dict:
    """Retrieve snapshot reference by ID"""
    try:
        con = safe_connect(db_path)
        
        result = con.execute("""
            SELECT snapshot_id, content_hash, created_at, spec_json, manifest_json
            FROM snapshot_refs
            WHERE snapshot_id = ?
        """, (snapshot_id,)).fetchone()
        
        con.close()
        
        if not result:
            return None
        
        return {
            "snapshotId": result[0],
            "contentHash": result[1],
            "createdAt": result[2],
            "spec": json.loads(result[3]),
            "manifest": json.loads(result[4]),
        }
    except Exception as e:
        return {"error": str(e)}


def store_snapshot_events(db_path: str, snapshot_id: str, events: list) -> dict:
    """Store snapshot events"""
    try:
        con = safe_connect(db_path)
        
        # Delete existing events for this snapshot (idempotent replacement)
        con.execute("DELETE FROM snapshot_events WHERE snapshot_id = ?", (snapshot_id,))
        
        # Insert events in batch
        for event in events:
            con.execute("""
                INSERT INTO snapshot_events (
                    snapshot_id, asset, chain, venue, timestamp, event_type, event_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                snapshot_id,
                event.get("asset"),
                event.get("chain"),
                event.get("venue"),
                event.get("timestamp"),
                event.get("eventType"),
                json.dumps(event),
            ))
        
        con.close()
        
        return {"success": True, "count": len(events)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def query_snapshot_events(db_path: str, snapshot_id: str, options: dict = None) -> dict:
    """Query snapshot events with filters"""
    try:
        con = safe_connect(db_path)
        
        options = options or {}
        
        # Build query
        query = """
            SELECT event_json
            FROM snapshot_events
            WHERE snapshot_id = ?
        """
        params = [snapshot_id]
        
        # Apply filters
        if options.get("eventTypes"):
            placeholders = ",".join(["?"] * len(options["eventTypes"]))
            query += f" AND event_type IN ({placeholders})"
            params.extend(options["eventTypes"])
        
        if options.get("tokenAddresses"):
            placeholders = ",".join(["?"] * len(options["tokenAddresses"]))
            query += f" AND asset IN ({placeholders})"
            params.extend(options["tokenAddresses"])
        
        if options.get("from"):
            query += " AND timestamp >= ?"
            params.append(options["from"])
        
        if options.get("to"):
            query += " AND timestamp <= ?"
            params.append(options["to"])
        
        query += " ORDER BY timestamp ASC"
        
        if options.get("limit"):
            query += f" LIMIT {int(options['limit'])}"
        
        results = con.execute(query, params).fetchall()
        
        con.close()
        
        # Parse JSON events
        events = [json.loads(row[0]) for row in results]
        
        return events
    except Exception as e:
        return {"error": str(e)}


def list_snapshot_refs(db_path: str, limit: int = None) -> dict:
    """List all snapshot references"""
    try:
        con = safe_connect(db_path)
        
        query = """
            SELECT snapshot_id, content_hash, created_at
            FROM snapshot_refs
            ORDER BY created_at DESC
        """
        
        if limit:
            query += f" LIMIT {int(limit)}"
        
        results = con.execute(query).fetchall()
        
        con.close()
        
        return [
            {
                "snapshotId": row[0],
                "contentHash": row[1],
                "createdAt": row[2],
            }
            for row in results
        ]
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="DuckDB Snapshot Storage")
    parser.add_argument("--operation", required=True, 
                       choices=["init", "store_ref", "get_ref", "store_events", "query_events", "list_refs"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--data", help="Data (JSON string)")
    parser.add_argument("--snapshot-id", help="Snapshot ID")
    parser.add_argument("--options", help="Query options (JSON string)")
    parser.add_argument("--limit", type=int, help="Limit results")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "store_ref":
        if not args.data:
            result = {"success": False, "error": "Data required for store_ref operation"}
        else:
            try:
                ref = json.loads(args.data)
                result = store_snapshot_ref(args.db_path, ref)
            except json.JSONDecodeError as e:
                result = {"success": False, "error": f"Invalid JSON: {str(e)}"}
    elif args.operation == "get_ref":
        if not args.snapshot_id:
            result = None
        else:
            result = get_snapshot_ref(args.db_path, args.snapshot_id)
    elif args.operation == "store_events":
        if not args.snapshot_id or not args.data:
            result = {"success": False, "error": "snapshot_id and data required"}
        else:
            try:
                events = json.loads(args.data)
                result = store_snapshot_events(args.db_path, args.snapshot_id, events)
            except json.JSONDecodeError as e:
                result = {"success": False, "error": f"Invalid JSON: {str(e)}"}
    elif args.operation == "query_events":
        if not args.snapshot_id:
            result = {"error": "snapshot_id required"}
        else:
            options = json.loads(args.options) if args.options else {}
            if args.limit:
                options["limit"] = args.limit
            result = query_snapshot_events(args.db_path, args.snapshot_id, options)
    elif args.operation == "list_refs":
        result = list_snapshot_refs(args.db_path, args.limit)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

