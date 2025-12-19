#!/usr/bin/env python3
"""
DuckDB Event Log Service
========================
Billing-grade event log for API calls with cost, status, latency, and run_id tracking.
"""

import argparse
import json
import sys
import uuid
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
            CREATE TABLE IF NOT EXISTS api_event_log (
                id TEXT PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL,
                api_name TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                method TEXT NOT NULL DEFAULT 'GET',
                status_code INTEGER,
                success BOOLEAN NOT NULL,
                latency_ms DOUBLE NOT NULL,
                credits_cost DOUBLE NOT NULL DEFAULT 0,
                run_id TEXT,
                error_message TEXT,
                metadata_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_event_log_timestamp 
            ON api_event_log(timestamp);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_event_log_api_name 
            ON api_event_log(api_name);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_event_log_run_id 
            ON api_event_log(run_id);
        """)
        
        con.execute("""
            CREATE INDEX IF NOT EXISTS idx_event_log_success 
            ON api_event_log(success);
        """)
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def log_event(db_path: str, event: dict) -> dict:
    """Log an API call event"""
    try:
        con = duckdb.connect(db_path)
        
        event_id = event.get("id") or str(uuid.uuid4())
        timestamp = event.get("timestamp")
        api_name = event.get("api_name")
        endpoint = event.get("endpoint")
        method = event.get("method", "GET")
        status_code = event.get("status_code")
        success = event.get("success", False)
        latency_ms = event.get("latency_ms", 0.0)
        credits_cost = event.get("credits_cost", 0.0)
        run_id = event.get("run_id")
        error_message = event.get("error_message")
        metadata = event.get("metadata")
        metadata_json = json.dumps(metadata) if metadata else None
        
        con.execute("""
            INSERT INTO api_event_log (
                id, timestamp, api_name, endpoint, method, status_code,
                success, latency_ms, credits_cost, run_id, error_message, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            event_id,
            timestamp,
            api_name,
            endpoint,
            method,
            status_code,
            success,
            latency_ms,
            credits_cost,
            run_id,
            error_message,
            metadata_json,
        ))
        
        con.close()
        
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_credits_in_window(db_path: str, window_start: str) -> dict:
    """Get credits spent in time window"""
    try:
        con = duckdb.connect(db_path)
        
        result = con.execute("""
            SELECT COALESCE(SUM(credits_cost), 0) as total_credits
            FROM api_event_log
            WHERE timestamp >= ? AND success = true
        """, (window_start,)).fetchone()
        
        total_credits = float(result[0]) if result else 0.0
        
        con.close()
        
        return {"total_credits": total_credits}
    except Exception as e:
        return {"total_credits": 0.0, "error": str(e)}


def get_stats(db_path: str, api_name: str = None, start_date: str = None, end_date: str = None) -> dict:
    """Get event log statistics"""
    try:
        con = duckdb.connect(db_path)
        
        query = """
            SELECT
                COUNT(*) as total_events,
                COALESCE(SUM(credits_cost), 0) as total_credits,
                COALESCE(AVG(CASE WHEN success = true THEN 1.0 ELSE 0.0 END), 0) as success_rate,
                COALESCE(AVG(latency_ms), 0) as avg_latency,
                SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as error_count
            FROM api_event_log
            WHERE 1=1
        """
        
        params = []
        
        if api_name:
            query += " AND api_name = ?"
            params.append(api_name)
        
        if start_date:
            query += " AND timestamp >= ?"
            params.append(start_date)
        
        if end_date:
            query += " AND timestamp <= ?"
            params.append(end_date)
        
        result = con.execute(query, params).fetchone()
        
        con.close()
        
        return {
            "total_events": int(result[0]) if result else 0,
            "total_credits": float(result[1]) if result else 0.0,
            "success_rate": float(result[2]) if result else 0.0,
            "avg_latency": float(result[3]) if result else 0.0,
            "error_count": int(result[4]) if result else 0,
        }
    except Exception as e:
        return {
            "total_events": 0,
            "total_credits": 0.0,
            "success_rate": 0.0,
            "avg_latency": 0.0,
            "error_count": 0,
            "error": str(e),
        }


def main():
    parser = argparse.ArgumentParser(description="DuckDB Event Log Service")
    parser.add_argument("--operation", required=True, choices=["init", "log", "get_credits_in_window", "get_stats"])
    parser.add_argument("--db-path", required=True, help="Path to DuckDB database file")
    parser.add_argument("--event", help="Event data (JSON string)")
    parser.add_argument("--window-start", help="Window start timestamp (ISO format)")
    parser.add_argument("--api-name", help="API name for filtering")
    parser.add_argument("--start-date", help="Start date (ISO format)")
    parser.add_argument("--end-date", help="End date (ISO format)")
    
    args = parser.parse_args()
    
    # Ensure database directory exists
    db_path_obj = Path(args.db_path)
    db_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    result = {}
    
    if args.operation == "init":
        result = init_database(args.db_path)
    elif args.operation == "log":
        if not args.event:
            result = {"success": False, "error": "Event data required for log operation"}
        else:
            try:
                event_data = json.loads(args.event)
                result = log_event(args.db_path, event_data)
            except json.JSONDecodeError as e:
                result = {"success": False, "error": f"Invalid JSON: {str(e)}"}
    elif args.operation == "get_credits_in_window":
        if not args.window_start:
            result = {"total_credits": 0.0, "error": "Window start required"}
        else:
            result = get_credits_in_window(args.db_path, args.window_start)
    elif args.operation == "get_stats":
        result = get_stats(args.db_path, args.api_name, args.start_date, args.end_date)
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()

