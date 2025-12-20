#!/usr/bin/env python3
"""
DuckDB ErrorRepository - Track and query application errors for observability
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
        
        con.execute("""
            CREATE TABLE IF NOT EXISTS error_events (
                id INTEGER PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL,
                error_name TEXT NOT NULL,
                error_message TEXT NOT NULL,
                error_stack TEXT,
                severity TEXT NOT NULL,
                context_json TEXT,
                service TEXT,
                resolved BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_error_timestamp 
            ON error_events(timestamp);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_error_severity 
            ON error_events(severity);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_error_service 
            ON error_events(service);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_error_resolved 
            ON error_events(resolved);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_error_name 
            ON error_events(error_name);
        """)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def insert_error(
    db_path: str,
    timestamp: str,
    error_name: str,
    error_message: str,
    error_stack: str = None,
    severity: str = 'medium',
    context_json: str = None,
    service: str = None
) -> dict:
    """Insert an error event"""
    try:
        con = safe_connect(db_path)
        
        con.execute("""
            INSERT INTO error_events (
                timestamp, error_name, error_message, error_stack,
                severity, context_json, service
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            timestamp,
            error_name,
            error_message,
            error_stack,
            severity,
            context_json,
            service,
        ))
        
        # Get the inserted ID
        result = con.execute("""
            SELECT id, timestamp, error_name, error_message, error_stack,
                   severity, context_json, service, resolved, created_at
            FROM error_events
            WHERE id = LAST_INSERT_ROWID()
        """).fetchone()
        
        con.close()
        
        return {
            "id": result[0],
            "timestamp": result[1].isoformat(),
            "error_name": result[2],
            "error_message": result[3],
            "error_stack": result[4],
            "severity": result[5],
            "context_json": json.loads(result[6]) if result[6] else None,
            "service": result[7],
            "resolved": bool(result[8]),
            "created_at": result[9].isoformat(),
        }
    except Exception as e:
        return {"error": str(e)}


def get_stats(
    db_path: str,
    start_date: str = None,
    end_date: str = None,
    severity: str = None,
    service: str = None
) -> dict:
    """Get error statistics"""
    try:
        con = safe_connect(db_path)
        
        query = """
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
                SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high_count,
                SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium_count,
                SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) as low_count,
                SUM(CASE WHEN resolved = TRUE THEN 1 ELSE 0 END) as resolved_count
            FROM error_events
            WHERE 1=1
        """
        
        params = []
        
        if start_date:
            query += " AND timestamp >= ?"
            params.append(start_date)
        
        if end_date:
            query += " AND timestamp <= ?"
            params.append(end_date)
        
        if severity:
            query += " AND severity = ?"
            params.append(severity)
        
        if service:
            query += " AND service = ?"
            params.append(service)
        
        result = con.execute(query, params).fetchone()
        
        con.close()
        
        return {
            "total": int(result[0]) if result else 0,
            "by_severity": {
                "critical": int(result[1]) if result else 0,
                "high": int(result[2]) if result else 0,
                "medium": int(result[3]) if result else 0,
                "low": int(result[4]) if result else 0,
            },
            "resolved_count": int(result[5]) if result else 0,
        }
    except Exception as e:
        return {
            "total": 0,
            "by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0},
            "resolved_count": 0,
            "error": str(e),
        }


def get_recent_errors(
    db_path: str,
    limit: int = 10,
    start_date: str = None,
    end_date: str = None,
    severity: str = None,
    service: str = None,
    resolved: bool = None
) -> dict:
    """Get recent errors"""
    try:
        con = safe_connect(db_path)
        
        query = """
            SELECT id, timestamp, error_name, error_message, error_stack,
                   severity, context_json, service, resolved, created_at
            FROM error_events
            WHERE 1=1
        """
        
        params = []
        
        if start_date:
            query += " AND timestamp >= ?"
            params.append(start_date)
        
        if end_date:
            query += " AND timestamp <= ?"
            params.append(end_date)
        
        if severity:
            query += " AND severity = ?"
            params.append(severity)
        
        if service:
            query += " AND service = ?"
            params.append(service)
        
        if resolved is not None:
            query += " AND resolved = ?"
            params.append(resolved)
        
        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        
        results = con.execute(query, params).fetchall()
        
        con.close()
        
        return [
            {
                "id": row[0],
                "timestamp": row[1].isoformat(),
                "error_name": row[2],
                "error_message": row[3],
                "error_stack": row[4],
                "severity": row[5],
                "context_json": json.loads(row[6]) if row[6] else None,
                "service": row[7],
                "resolved": bool(row[8]),
                "created_at": row[9].isoformat(),
            }
            for row in results
        ]
    except Exception as e:
        return {"error": str(e)}


def mark_resolved(db_path: str, error_id: int) -> dict:
    """Mark an error as resolved"""
    try:
        con = safe_connect(db_path)
        
        con.execute("""
            UPDATE error_events
            SET resolved = TRUE
            WHERE id = ?
        """, (error_id,))
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_by_error_name(
    db_path: str,
    error_name: str,
    limit: int = 10
) -> dict:
    """Get errors by error name (for pattern analysis)"""
    try:
        con = safe_connect(db_path)
        
        results = con.execute("""
            SELECT id, timestamp, error_name, error_message, error_stack,
                   severity, context_json, service, resolved, created_at
            FROM error_events
            WHERE error_name = ?
            ORDER BY timestamp DESC
            LIMIT ?
        """, (error_name, limit)).fetchall()
        
        con.close()
        
        return [
            {
                "id": row[0],
                "timestamp": row[1].isoformat(),
                "error_name": row[2],
                "error_message": row[3],
                "error_stack": row[4],
                "severity": row[5],
                "context_json": json.loads(row[6]) if row[6] else None,
                "service": row[7],
                "resolved": bool(row[8]),
                "created_at": row[9].isoformat(),
            }
            for row in results
        ]
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="DuckDB ErrorRepository")
    parser.add_argument(
        "--operation",
        required=True,
        choices=["init", "insert", "get_stats", "get_recent", "mark_resolved", "get_by_error_name"]
    )
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--timestamp", help="Error timestamp (ISO format)")
    parser.add_argument("--error-name", help="Error name/type")
    parser.add_argument("--error-message", help="Error message")
    parser.add_argument("--error-stack", help="Error stack trace")
    parser.add_argument("--severity", help="Error severity (low|medium|high|critical)")
    parser.add_argument("--context-json", help="Context data (JSON string)")
    parser.add_argument("--service", help="Service name")
    parser.add_argument("--start-date", help="Start date (ISO format)")
    parser.add_argument("--end-date", help="End date (ISO format)")
    parser.add_argument("--limit", type=int, default=10, help="Limit for queries")
    parser.add_argument("--id", type=int, help="Error ID")
    parser.add_argument("--resolved", type=bool, help="Filter by resolved status")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "insert":
        if not args.timestamp or not args.error_name or not args.error_message:
            result = {"error": "timestamp, error-name, and error-message required"}
        else:
            result = insert_error(
                args.db_path,
                args.timestamp,
                args.error_name,
                args.error_message,
                args.error_stack,
                args.severity or 'medium',
                args.context_json,
                args.service
            )
    elif args.operation == "get_stats":
        result = get_stats(
            args.db_path,
            args.start_date,
            args.end_date,
            args.severity,
            args.service
        )
    elif args.operation == "get_recent":
        result = get_recent_errors(
            args.db_path,
            args.limit,
            args.start_date,
            args.end_date,
            args.severity,
            args.service,
            args.resolved
        )
    elif args.operation == "mark_resolved":
        if not args.id:
            result = {"success": False, "error": "ID required"}
        else:
            result = mark_resolved(args.db_path, args.id)
    elif args.operation == "get_by_error_name":
        if not args.error_name:
            result = {"error": "error-name required"}
        else:
            result = get_by_error_name(args.db_path, args.error_name, args.limit)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

