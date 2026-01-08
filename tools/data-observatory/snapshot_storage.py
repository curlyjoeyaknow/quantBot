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

# Add tools to path for shared imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from shared.duckdb_adapter import safe_connect


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
        try:
            con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_content_hash ON snapshot_refs(content_hash);")
        except Exception:
            pass  # Index may already exist
        
        try:
            con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_created_at ON snapshot_refs(created_at);")
        except Exception:
            pass
        
        # Snapshot events table
        # Stores canonical events keyed by snapshot_id
        # Create sequence for auto-incrementing id
        try:
            con.execute("CREATE SEQUENCE IF NOT EXISTS snapshot_events_id_seq START 1;")
        except Exception:
            pass  # Sequence may already exist
        
        con.execute("""
            CREATE TABLE IF NOT EXISTS snapshot_events (
                id BIGINT PRIMARY KEY DEFAULT nextval('snapshot_events_id_seq'),
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
        try:
            con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_events_snapshot_id ON snapshot_events(snapshot_id);")
        except Exception:
            pass
        
        try:
            con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_events_asset ON snapshot_events(asset);")
        except Exception:
            pass
        
        try:
            con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_events_timestamp ON snapshot_events(timestamp);")
        except Exception:
            pass
        
        try:
            con.execute("CREATE INDEX IF NOT EXISTS idx_snapshot_events_event_type ON snapshot_events(event_type);")
        except Exception:
            pass
        
        # Ensure connection is closed to prevent WAL files
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
        
        # Convert datetime to ISO string with Z suffix (UTC)
        created_at = result[2]
        if isinstance(created_at, datetime):
            # Ensure UTC and add Z suffix for Zod datetime format
            if created_at.tzinfo is None:
                # Assume UTC if no timezone
                created_at = created_at.replace(tzinfo=None).isoformat() + 'Z'
            else:
                created_at = created_at.astimezone(datetime.timezone.utc).replace(tzinfo=None).isoformat() + 'Z'
        elif hasattr(created_at, 'isoformat'):
            # Handle DuckDB timestamp objects
            iso_str = created_at.isoformat()
            if not iso_str.endswith('Z'):
                iso_str += 'Z'
            created_at = iso_str
        elif created_at is not None:
            # Ensure it's a string and has Z suffix
            created_at_str = str(created_at)
            if not created_at_str.endswith('Z'):
                created_at_str += 'Z'
            created_at = created_at_str
        
        # Parse spec and manifest JSON
        spec = json.loads(result[3])
        manifest = json.loads(result[4])
        
        # Ensure manifest datetime strings have Z suffix for Zod validation
        # Simple approach: remove timezone offset and add Z (assumes stored times are already UTC)
        if isinstance(manifest, dict):
            if 'actualFrom' in manifest and manifest['actualFrom']:
                actual_from = manifest['actualFrom']
                if isinstance(actual_from, str) and not actual_from.endswith('Z'):
                    # Remove timezone offset if present
                    if '+' in actual_from:
                        actual_from = actual_from.split('+')[0]
                    elif actual_from.count('-') > 2:
                        # Check if last part looks like timezone offset (e.g., -05:00)
                        parts = actual_from.rsplit('-', 1)
                        if len(parts) == 2 and ':' in parts[1]:
                            actual_from = parts[0]
                    manifest['actualFrom'] = actual_from + 'Z'
            
            if 'actualTo' in manifest and manifest['actualTo']:
                actual_to = manifest['actualTo']
                if isinstance(actual_to, str) and not actual_to.endswith('Z'):
                    # Remove timezone offset if present
                    if '+' in actual_to:
                        actual_to = actual_to.split('+')[0]
                    elif actual_to.count('-') > 2:
                        parts = actual_to.rsplit('-', 1)
                        if len(parts) == 2 and ':' in parts[1]:
                            actual_to = parts[0]
                    manifest['actualTo'] = actual_to + 'Z'
        
        return {
            "snapshotId": result[0],
            "contentHash": result[1],
            "createdAt": created_at,
            "spec": spec,
            "manifest": manifest,
        }
    except Exception as e:
        return None


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
        return []


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
        
        # Convert datetime objects to ISO strings
        refs = []
        for row in results:
            created_at = row[2]
            if isinstance(created_at, datetime):
                created_at = created_at.isoformat()
            elif hasattr(created_at, 'isoformat'):
                created_at = created_at.isoformat()
            elif created_at is not None:
                created_at = str(created_at)
            
            refs.append({
                "snapshotId": row[0],
                "contentHash": row[1],
                "createdAt": created_at,
            })
        
        return refs
    except Exception as e:
        return []


def main():
    parser = argparse.ArgumentParser(description="DuckDB Snapshot Storage")
    parser.add_argument("--operation", required=True, 
                       choices=["init", "store_ref", "get_ref", "store_events", "query_events", "list_refs"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--data", help="Data (JSON string)")
    parser.add_argument("--data-file", help="Path to file containing data (JSON string)")
    parser.add_argument("--snapshot-id", help="Snapshot ID")
    parser.add_argument("--options", help="Query options (JSON string)")
    parser.add_argument("--limit", type=int, help="Limit results")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    # Helper function to read data from either --data or --data-file
    def read_data():
        if args.data_file:
            with open(args.data_file, 'r', encoding='utf-8') as f:
                return f.read()
        elif args.data:
            return args.data
        else:
            return None
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "store_ref":
        data_str = read_data()
        if not data_str:
            result = {"success": False, "error": "Data required for store_ref operation"}
        else:
            try:
                ref = json.loads(data_str)
                result = store_snapshot_ref(args.db_path, ref)
            except json.JSONDecodeError as e:
                result = {"success": False, "error": f"Invalid JSON: {str(e)}"}
    elif args.operation == "get_ref":
        if not args.snapshot_id:
            result = None
        else:
            result = get_snapshot_ref(args.db_path, args.snapshot_id)
    elif args.operation == "store_events":
        if not args.snapshot_id:
            result = {"success": False, "error": "snapshot_id required"}
        else:
            data_str = read_data()
            if not data_str:
                result = {"success": False, "error": "data or data-file required"}
            else:
                try:
                    events = json.loads(data_str)
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

