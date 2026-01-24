#!/usr/bin/env python3
"""
DuckDB Raw Data Storage

Stores and retrieves immutable raw data (Telegram exports, API responses, etc.)
"""

import duckdb
import json
import sys
from typing import Dict, Any, Optional, List
from pathlib import Path

def init_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Initialize raw data schema in DuckDB."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS raw_data (
            id TEXT NOT NULL PRIMARY KEY,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            hash TEXT NOT NULL,
            content TEXT NOT NULL,
            run_id TEXT NOT NULL,
            ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            metadata_json JSON
        );
        
        CREATE INDEX IF NOT EXISTS idx_raw_data_source_type ON raw_data(source_type);
        CREATE INDEX IF NOT EXISTS idx_raw_data_source_id ON raw_data(source_id);
        CREATE INDEX IF NOT EXISTS idx_raw_data_hash ON raw_data(hash);
        CREATE INDEX IF NOT EXISTS idx_raw_data_run_id ON raw_data(run_id);
        CREATE INDEX IF NOT EXISTS idx_raw_data_ingested_at ON raw_data(ingested_at);
        CREATE INDEX IF NOT EXISTS idx_raw_data_source_time ON raw_data(source_type, source_id, ingested_at);
    """)


def store_raw_data(con: duckdb.DuckDBPyConnection, record: Dict[str, Any]) -> Dict[str, Any]:
    """Store raw data record (append-only)."""
    init_schema(con)
    
    # Check for duplicate by hash
    existing = con.execute("""
        SELECT id FROM raw_data WHERE hash = ?
    """, (record['hash'],)).fetchone()
    
    if existing:
        # Return existing record (idempotency)
        return {"success": True, "id": existing[0], "duplicate": True}
    
    # Insert new record
    con.execute("""
        INSERT INTO raw_data (id, source_type, source_id, hash, content, run_id, ingested_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        record['id'],
        record['sourceType'],
        record['sourceId'],
        record['hash'],
        record['content'],
        record['runId'],
        record.get('ingestedAt'),
        json.dumps(record.get('metadata', {})) if record.get('metadata') else None
    ))
    
    return {"success": True, "id": record['id'], "duplicate": False}


def query_raw_data(con: duckdb.DuckDBPyConnection, filter: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Query raw data by filter."""
    conditions = []
    params = []
    
    if filter.get('sourceType'):
        conditions.append("source_type = ?")
        params.append(filter['sourceType'])
    
    if filter.get('sourceId'):
        conditions.append("source_id = ?")
        params.append(filter['sourceId'])
    
    if filter.get('hash'):
        conditions.append("hash = ?")
        params.append(filter['hash'])
    
    if filter.get('runId'):
        conditions.append("run_id = ?")
        params.append(filter['runId'])
    
    if filter.get('timeRange'):
        if filter['timeRange'].get('from'):
            conditions.append("ingested_at >= ?")
            params.append(filter['timeRange']['from'])
        if filter['timeRange'].get('to'):
            conditions.append("ingested_at <= ?")
            params.append(filter['timeRange']['to'])
    
    where_clause = " AND ".join(conditions) if conditions else "1=1"
    
    results = con.execute(f"""
        SELECT id, source_type, source_id, hash, content, run_id, ingested_at, metadata_json
        FROM raw_data
        WHERE {where_clause}
        ORDER BY ingested_at DESC
    """, params).fetchall()
    
    return [
        {
            "id": row[0],
            "sourceType": row[1],
            "sourceId": row[2],
            "hash": row[3],
            "content": row[4],
            "runId": row[5],
            "ingestedAt": row[6].isoformat() if row[6] else None,
            "metadata": json.loads(row[7]) if row[7] else {}
        }
        for row in results
    ]


def get_by_hash(con: duckdb.DuckDBPyConnection, hash: str) -> Optional[Dict[str, Any]]:
    """Get raw data by hash."""
    result = con.execute("""
        SELECT id, source_type, source_id, hash, content, run_id, ingested_at, metadata_json
        FROM raw_data
        WHERE hash = ?
        LIMIT 1
    """, (hash,)).fetchone()
    
    if not result:
        return None
    
    return {
        "id": result[0],
        "sourceType": result[1],
        "sourceId": result[2],
        "hash": result[3],
        "content": result[4],
        "runId": result[5],
        "ingestedAt": result[6].isoformat() if result[6] else None,
        "metadata": json.loads(result[7]) if result[7] else {}
    }


def list_sources(con: duckdb.DuckDBPyConnection) -> List[Dict[str, Any]]:
    """List all raw data sources with counts."""
    results = con.execute("""
        SELECT source_type, source_id, COUNT(*) as record_count
        FROM raw_data
        GROUP BY source_type, source_id
        ORDER BY source_type, source_id
    """).fetchall()
    
    return [
        {
            "sourceType": row[0],
            "sourceId": row[1],
            "recordCount": row[2]
        }
        for row in results
    ]


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='DuckDB Raw Data Storage')
    parser.add_argument('--db-path', required=True, help='Path to DuckDB file')
    parser.add_argument('--operation', required=True,
                       choices=['init', 'store', 'query', 'get_by_hash', 'list_sources'])
    parser.add_argument('--data', type=str, help='JSON data for operation')
    
    args = parser.parse_args()
    
    # Connect to DuckDB
    from tools.shared.duckdb_adapter import get_write_connection
    with get_write_connection(args.db_path) as con:
        if args.operation == 'init':
            init_schema(con)
            print(json.dumps({"success": True}))
        
        elif args.operation == 'store':
            record = json.loads(args.data)
            result = store_raw_data(con, record)
            print(json.dumps(result))
        
        elif args.operation == 'query':
            filter_data = json.loads(args.data) if args.data else {}
            records = query_raw_data(con, filter_data)
            print(json.dumps(records))
        
        elif args.operation == 'get_by_hash':
            data = json.loads(args.data)
            record = get_by_hash(con, data['hash'])
            if record:
                print(json.dumps(record))
            else:
                print(json.dumps({"error": "Raw data not found"}))
        
        elif args.operation == 'list_sources':
            sources = list_sources(con)
            print(json.dumps(sources))


if __name__ == '__main__':
    main()

