#!/usr/bin/env python3
"""
DuckDB Canonical Events Storage

Stores and retrieves canonical events (unified market data representation).
"""

import duckdb
import json
import sys
from typing import Dict, Any, Optional, List
from pathlib import Path
from datetime import datetime

def init_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Initialize canonical events schema in DuckDB."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS canonical_events (
            id TEXT NOT NULL PRIMARY KEY,
            asset_address TEXT NOT NULL,
            asset_chain TEXT NOT NULL,
            asset_symbol TEXT,
            asset_name TEXT,
            venue_name TEXT NOT NULL,
            venue_type TEXT NOT NULL,
            venue_id TEXT,
            timestamp TIMESTAMP NOT NULL,
            event_type TEXT NOT NULL,
            value_json JSON NOT NULL,
            confidence DOUBLE,
            metadata_json JSON,
            source_hash TEXT,
            source_run_id TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_canonical_asset_address ON canonical_events(asset_address);
        CREATE INDEX IF NOT EXISTS idx_canonical_asset_chain ON canonical_events(asset_chain);
        CREATE INDEX IF NOT EXISTS idx_canonical_venue_name ON canonical_events(venue_name);
        CREATE INDEX IF NOT EXISTS idx_canonical_venue_type ON canonical_events(venue_type);
        CREATE INDEX IF NOT EXISTS idx_canonical_timestamp ON canonical_events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_canonical_event_type ON canonical_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_canonical_source_hash ON canonical_events(source_hash);
        CREATE INDEX IF NOT EXISTS idx_canonical_source_run_id ON canonical_events(source_run_id);
        CREATE INDEX IF NOT EXISTS idx_canonical_asset_time ON canonical_events(asset_address, timestamp);
        CREATE INDEX IF NOT EXISTS idx_canonical_venue_time ON canonical_events(venue_name, timestamp);
    """)


def store_canonical_event(con: duckdb.DuckDBPyConnection, event: Dict[str, Any]) -> Dict[str, Any]:
    """Store a canonical event."""
    init_schema(con)
    
    asset = event['asset']
    venue = event['venue']
    
    # Parse timestamp
    timestamp = event['timestamp']
    if isinstance(timestamp, str):
        timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    
    con.execute("""
        INSERT OR REPLACE INTO canonical_events (
            id, asset_address, asset_chain, asset_symbol, asset_name,
            venue_name, venue_type, venue_id,
            timestamp, event_type, value_json, confidence, metadata_json,
            source_hash, source_run_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        event['id'],
        asset['address'],
        asset['chain'],
        asset.get('symbol'),
        asset.get('name'),
        venue['name'],
        venue['type'],
        venue.get('venueId'),
        timestamp,
        event['eventType'],
        json.dumps(event['value']),
        event.get('confidence'),
        json.dumps(event.get('metadata', {})) if event.get('metadata') else None,
        event.get('sourceHash'),
        event.get('sourceRunId'),
    ))
    
    return {"success": True}


def store_canonical_events_batch(con: duckdb.DuckDBPyConnection, events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Store multiple canonical events (batch)."""
    init_schema(con)
    
    for event in events:
        store_canonical_event(con, event)
    
    return {"success": True, "count": len(events)}


def get_canonical_event(con: duckdb.DuckDBPyConnection, event_id: str) -> Optional[Dict[str, Any]]:
    """Get canonical event by ID."""
    result = con.execute("""
        SELECT id, asset_address, asset_chain, asset_symbol, asset_name,
               venue_name, venue_type, venue_id,
               timestamp, event_type, value_json, confidence, metadata_json,
               source_hash, source_run_id
        FROM canonical_events
        WHERE id = ?
    """, (event_id,)).fetchone()
    
    if not result:
        return None
    
    return {
        "id": result[0],
        "asset": {
            "address": result[1],
            "chain": result[2],
            "symbol": result[3],
            "name": result[4],
        },
        "venue": {
            "name": result[5],
            "type": result[6],
            "venueId": result[7],
        },
        "timestamp": result[8].isoformat() if result[8] else None,
        "eventType": result[9],
        "value": json.loads(result[10]),
        "confidence": result[11],
        "metadata": json.loads(result[12]) if result[12] else {},
        "sourceHash": result[13],
        "sourceRunId": result[14],
    }


def query_canonical_events(con: duckdb.DuckDBPyConnection, filter: Dict[str, Any]) -> Dict[str, Any]:
    """Query canonical events by filter."""
    conditions = []
    params = []
    
    if filter.get('assetAddress'):
        # Normalize address (lowercase for EVM, case-preserved for Solana)
        asset_address = filter['assetAddress'].lower() if filter.get('chain') in ['ethereum', 'bsc', 'base', 'evm'] else filter['assetAddress']
        conditions.append("LOWER(asset_address) = LOWER(?)")
        params.append(asset_address)
    
    if filter.get('chain'):
        conditions.append("asset_chain = ?")
        params.append(filter['chain'])
    
    if filter.get('venueName'):
        conditions.append("venue_name = ?")
        params.append(filter['venueName'])
    
    if filter.get('venueType'):
        conditions.append("venue_type = ?")
        params.append(filter['venueType'])
    
    if filter.get('eventType'):
        conditions.append("event_type = ?")
        params.append(filter['eventType'])
    
    if filter.get('timeRange'):
        if filter['timeRange'].get('from'):
            conditions.append("timestamp >= ?")
            params.append(filter['timeRange']['from'])
        if filter['timeRange'].get('to'):
            conditions.append("timestamp <= ?")
            params.append(filter['timeRange']['to'])
    
    if filter.get('sourceHash'):
        conditions.append("source_hash = ?")
        params.append(filter['sourceHash'])
    
    if filter.get('sourceRunId'):
        conditions.append("source_run_id = ?")
        params.append(filter['sourceRunId'])
    
    where_clause = " AND ".join(conditions) if conditions else "1=1"
    
    # Get total count
    count_result = con.execute(f"""
        SELECT COUNT(*) FROM canonical_events WHERE {where_clause}
    """, params).fetchone()
    total = count_result[0] if count_result else 0
    
    # Apply limit and offset
    limit = filter.get('limit', 1000)
    offset = filter.get('offset', 0)
    
    results = con.execute(f"""
        SELECT id, asset_address, asset_chain, asset_symbol, asset_name,
               venue_name, venue_type, venue_id,
               timestamp, event_type, value_json, confidence, metadata_json,
               source_hash, source_run_id
        FROM canonical_events
        WHERE {where_clause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset]).fetchall()
    
    events = [
        {
            "id": row[0],
            "asset": {
                "address": row[1],
                "chain": row[2],
                "symbol": row[3],
                "name": row[4],
            },
            "venue": {
                "name": row[5],
                "type": row[6],
                "venueId": row[7],
            },
            "timestamp": row[8].isoformat() if row[8] else None,
            "eventType": row[9],
            "value": json.loads(row[10]),
            "confidence": row[11],
            "metadata": json.loads(row[12]) if row[12] else {},
            "sourceHash": row[13],
            "sourceRunId": row[14],
        }
        for row in results
    ]
    
    return {
        "events": events,
        "total": total,
    }


def get_by_asset(con: duckdb.DuckDBPyConnection, asset_address: str, time_range: Optional[Dict[str, Any]] = None, event_types: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Get events for a specific asset (chain-agnostic)."""
    filter: Dict[str, Any] = {
        "assetAddress": asset_address,
    }
    
    if time_range:
        filter["timeRange"] = time_range
    
    if event_types:
        # Query each event type separately and combine
        all_events = []
        for event_type in event_types:
            filter_copy = filter.copy()
            filter_copy["eventType"] = event_type
            result = query_canonical_events(con, filter_copy)
            all_events.extend(result["events"])
        return all_events
    
    result = query_canonical_events(con, filter)
    return result["events"]


def main():
    """Main entry point."""
    import argparse
    from tools.shared.duckdb_adapter import get_write_connection, get_readonly_connection
    
    parser = argparse.ArgumentParser(description='DuckDB Canonical Events Storage')
    parser.add_argument('--db-path', required=True, help='Path to DuckDB file')
    parser.add_argument('--operation', required=True,
                        choices=['init', 'store', 'store_batch', 'get', 'query', 'get_by_asset'])
    parser.add_argument('--data', type=str, help='JSON data for operation')
    
    args = parser.parse_args()
    
    if args.operation in ['store', 'store_batch', 'init']:
        con = get_write_connection(args.db_path)
    else:
        con = get_readonly_connection(args.db_path)
    
    try:
        if args.operation == 'init':
            init_schema(con)
            print(json.dumps({"success": True}))
        
        elif args.operation == 'store':
            event = json.loads(args.data)
            result = store_canonical_event(con, event)
            print(json.dumps(result))
        
        elif args.operation == 'store_batch':
            events = json.loads(args.data)
            result = store_canonical_events_batch(con, events)
            print(json.dumps(result))
        
        elif args.operation == 'get':
            data = json.loads(args.data)
            event = get_canonical_event(con, data['id'])
            if event:
                print(json.dumps(event))
            else:
                print(json.dumps({"error": "Event not found"}))
        
        elif args.operation == 'query':
            filter_data = json.loads(args.data) if args.data else {}
            result = query_canonical_events(con, filter_data)
            print(json.dumps(result))
        
        elif args.operation == 'get_by_asset':
            data = json.loads(args.data)
            events = get_by_asset(con, data['assetAddress'], data.get('timeRange'), data.get('eventTypes'))
            print(json.dumps(events))
    finally:
        con.close()


if __name__ == '__main__':
    main()

