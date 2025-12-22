#!/usr/bin/env python3
"""
DuckDB Artifact Storage

Stores and retrieves versioned artifacts (strategies, sim runs, configs, etc.)
"""

import duckdb
import json
import sys
from typing import Dict, Any, Optional, List
from pathlib import Path

def init_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Initialize artifact schema in DuckDB."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS artifacts (
            id TEXT NOT NULL,
            version TEXT NOT NULL,
            type TEXT NOT NULL,
            hash TEXT NOT NULL,
            content_json JSON NOT NULL,
            metadata_json JSON NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id, version)
        );
        
        CREATE INDEX IF NOT EXISTS idx_artifacts_id ON artifacts(id);
        CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
        CREATE INDEX IF NOT EXISTS idx_artifacts_hash ON artifacts(hash);
        CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at);
        
        CREATE TABLE IF NOT EXISTS artifact_tags (
            artifact_id TEXT NOT NULL,
            artifact_version TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (artifact_id, artifact_version, tag),
            FOREIGN KEY (artifact_id, artifact_version) REFERENCES artifacts(id, version) ON DELETE CASCADE
        );
        
        CREATE INDEX IF NOT EXISTS idx_artifact_tags_tag ON artifact_tags(tag);
    """)


def store_artifact(con: duckdb.DuckDBPyConnection, artifact: Dict[str, Any]) -> Dict[str, Any]:
    """Store an artifact."""
    init_schema(con)
    
    metadata = artifact['metadata']
    content = artifact['content']
    
    # Store artifact
    con.execute("""
        INSERT OR REPLACE INTO artifacts (id, version, type, hash, content_json, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        metadata['id'],
        metadata['version'],
        metadata['type'],
        metadata['hash'],
        json.dumps(content),
        json.dumps(metadata),
        metadata.get('createdAt', None)
    ))
    
    # Store tags if provided
    if metadata.get('tags'):
        # Delete existing tags
        con.execute("""
            DELETE FROM artifact_tags 
            WHERE artifact_id = ? AND artifact_version = ?
        """, (metadata['id'], metadata['version']))
        
        # Insert new tags
        for tag in metadata['tags']:
            con.execute("""
                INSERT OR IGNORE INTO artifact_tags (artifact_id, artifact_version, tag)
                VALUES (?, ?, ?)
            """, (metadata['id'], metadata['version'], tag))
    
    return {"success": True}


def get_artifact(con: duckdb.DuckDBPyConnection, artifact_id: str, version: str) -> Optional[Dict[str, Any]]:
    """Get artifact by ID and version."""
    result = con.execute("""
        SELECT content_json, metadata_json
        FROM artifacts
        WHERE id = ? AND version = ?
    """, (artifact_id, version)).fetchone()
    
    if not result:
        return None
    
    return {
        "metadata": json.loads(result[1]),
        "content": json.loads(result[0])
    }


def get_latest(con: duckdb.DuckDBPyConnection, artifact_id: str) -> Optional[Dict[str, Any]]:
    """Get latest version of artifact."""
    result = con.execute("""
        SELECT content_json, metadata_json
        FROM artifacts
        WHERE id = ?
        ORDER BY created_at DESC, version DESC
        LIMIT 1
    """, (artifact_id,)).fetchone()
    
    if not result:
        return None
    
    return {
        "metadata": json.loads(result[1]),
        "content": json.loads(result[0])
    }


def list_versions(con: duckdb.DuckDBPyConnection, artifact_id: str) -> List[Dict[str, Any]]:
    """List all versions of an artifact."""
    results = con.execute("""
        SELECT content_json, metadata_json
        FROM artifacts
        WHERE id = ?
        ORDER BY created_at DESC, version DESC
    """, (artifact_id,)).fetchall()
    
    return [
        {
            "metadata": json.loads(row[1]),
            "content": json.loads(row[0])
        }
        for row in results
    ]


def query_artifacts(con: duckdb.DuckDBPyConnection, filter: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Query artifacts by filter."""
    conditions = []
    params = []
    
    if filter.get('type'):
        conditions.append("type = ?")
        params.append(filter['type'])
    
    if filter.get('tags'):
        # Join with tags table
        tag_conditions = " OR ".join(["tag = ?" for _ in filter['tags']])
        conditions.append(f"id IN (SELECT artifact_id FROM artifact_tags WHERE {tag_conditions})")
        params.extend(filter['tags'])
    
    if filter.get('parentId'):
        conditions.append("metadata_json->>'parentId' = ?")
        params.append(filter['parentId'])
    
    where_clause = " AND ".join(conditions) if conditions else "1=1"
    
    results = con.execute(f"""
        SELECT content_json, metadata_json
        FROM artifacts
        WHERE {where_clause}
        ORDER BY created_at DESC
    """, params).fetchall()
    
    return [
        {
            "metadata": json.loads(row[1]),
            "content": json.loads(row[0])
        }
        for row in results
    ]


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='DuckDB Artifact Storage')
    parser.add_argument('--db-path', required=True, help='Path to DuckDB file')
    parser.add_argument('--operation', required=True, 
                       choices=['init', 'store', 'get', 'get_latest', 'list_versions', 'query'])
    parser.add_argument('--data', type=str, help='JSON data for operation')
    
    args = parser.parse_args()
    
    con = duckdb.connect(args.db_path)
    
    try:
        if args.operation == 'init':
            init_schema(con)
            print(json.dumps({"success": True}))
        
        elif args.operation == 'store':
            artifact = json.loads(args.data)
            result = store_artifact(con, artifact)
            print(json.dumps(result))
        
        elif args.operation == 'get':
            data = json.loads(args.data)
            artifact = get_artifact(con, data['id'], data['version'])
            if artifact:
                print(json.dumps(artifact))
            else:
                print(json.dumps({"error": "Artifact not found"}))
        
        elif args.operation == 'get_latest':
            data = json.loads(args.data)
            artifact = get_latest(con, data['id'])
            if artifact:
                print(json.dumps(artifact))
            else:
                print(json.dumps({"error": "Artifact not found"}))
        
        elif args.operation == 'list_versions':
            data = json.loads(args.data)
            artifacts = list_versions(con, data['id'])
            print(json.dumps(artifacts))
        
        elif args.operation == 'query':
            filter_data = json.loads(args.data) if args.data else {}
            artifacts = query_artifacts(con, filter_data)
            print(json.dumps(artifacts))
    
    finally:
        con.close()


if __name__ == '__main__':
    main()

