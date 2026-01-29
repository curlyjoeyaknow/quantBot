#!/usr/bin/env python3
"""
RunSet Registry Rebuild

Rebuilds DuckDB registry from Parquet truth.

This is the high-leverage command that makes everything else "just write append-only records and rebuild".

Usage:
    python runset_registry_rebuild.py <registry_root> <duckdb_path>
    
Example:
    python runset_registry_rebuild.py /home/memez/opn/registry data/registry.duckdb
"""

import sys
import json
from pathlib import Path
from typing import Dict, Any
import duckdb
import pandas as pd


class RegistryRebuilder:
    """
    Registry Rebuilder - Recreate DuckDB from Parquet truth
    
    Steps:
    1. Scan Parquet registry tables
    2. Recreate DuckDB tables
    3. Derive membership table
    4. Create convenience views
    """
    
    def __init__(self, registry_root: str, duckdb_path: str):
        self.registry_root = Path(registry_root)
        self.duckdb_path = Path(duckdb_path)
    
    def rebuild(self, force: bool = False) -> Dict[str, Any]:
        """
        Rebuild DuckDB registry from Parquet.
        
        Args:
            force: Force rebuild even if DuckDB exists
            
        Returns:
            Rebuild summary
        """
        # 1. Check if DuckDB exists
        if self.duckdb_path.exists() and not force:
            return {
                'success': False,
                'error': f'DuckDB already exists: {self.duckdb_path}. Use --force to rebuild.'
            }
        
        # 2. Connect to DuckDB (creates if doesn't exist)
        conn = duckdb.connect(str(self.duckdb_path))
        
        try:
            # 3. Drop existing schema (if force)
            if force:
                conn.execute("DROP SCHEMA IF EXISTS registry CASCADE")
            
            # 4. Create schema
            conn.execute("CREATE SCHEMA IF NOT EXISTS registry")
            
            # 5. Load Parquet tables
            tables = self._load_parquet_tables(conn)
            
            # 6. Derive membership table
            self._derive_membership(conn)
            
            # 7. Create convenience views
            self._create_views(conn)
            
            # 8. Compute summary
            summary = self._compute_summary(conn)
            
            conn.close()
            
            return {
                'success': True,
                'summary': summary,
                'tables': tables,
            }
        except Exception as e:
            conn.close()
            raise e
    
    def _load_parquet_tables(self, conn: duckdb.DuckDBPyConnection) -> Dict[str, int]:
        """Load Parquet tables into DuckDB."""
        tables = {}
        
        # Load runsets_spec
        runsets_spec_path = self.registry_root / 'runsets_spec'
        if runsets_spec_path.exists():
            conn.execute(f"""
                CREATE TABLE registry.runsets AS
                SELECT * FROM read_parquet('{runsets_spec_path}/**/*.parquet')
            """)
            count = conn.execute("SELECT COUNT(*) FROM registry.runsets").fetchone()[0]
            tables['runsets'] = count
        else:
            conn.execute("""
                CREATE TABLE registry.runsets (
                    runset_id VARCHAR,
                    spec_json VARCHAR,
                    created_at TIMESTAMP,
                    mode VARCHAR
                )
            """)
            tables['runsets'] = 0
        
        # Load runs
        runs_path = self.registry_root / 'runs'
        if runs_path.exists():
            conn.execute(f"""
                CREATE TABLE registry.runs AS
                SELECT * FROM read_parquet('{runs_path}/**/*.parquet')
            """)
            count = conn.execute("SELECT COUNT(*) FROM registry.runs").fetchone()[0]
            tables['runs'] = count
        else:
            conn.execute("""
                CREATE TABLE registry.runs (
                    run_id VARCHAR,
                    dataset_ids JSON,
                    strategy_spec_hash VARCHAR,
                    engine_version VARCHAR,
                    seed BIGINT,
                    execution_assumptions_hash VARCHAR,
                    created_at TIMESTAMP,
                    status VARCHAR,
                    metrics_summary JSON
                )
            """)
            tables['runs'] = 0
        
        # Load artifacts
        artifacts_path = self.registry_root / 'artifacts'
        if artifacts_path.exists():
            conn.execute(f"""
                CREATE TABLE registry.artifacts AS
                SELECT * FROM read_parquet('{artifacts_path}/**/*.parquet')
            """)
            count = conn.execute("SELECT COUNT(*) FROM registry.artifacts").fetchone()[0]
            tables['artifacts'] = count
        else:
            conn.execute("""
                CREATE TABLE registry.artifacts (
                    artifact_id VARCHAR,
                    run_id VARCHAR,
                    kind VARCHAR,
                    uri VARCHAR,
                    content_hash VARCHAR,
                    created_at TIMESTAMP,
                    schema_version VARCHAR,
                    row_count BIGINT
                )
            """)
            tables['artifacts'] = 0
        
        # Load resolutions
        resolutions_path = self.registry_root / 'runsets_resolution'
        if resolutions_path.exists():
            conn.execute(f"""
                CREATE TABLE registry.resolutions AS
                SELECT * FROM read_parquet('{resolutions_path}/**/*.parquet')
            """)
            count = conn.execute("SELECT COUNT(*) FROM registry.resolutions").fetchone()[0]
            tables['resolutions'] = count
        else:
            conn.execute("""
                CREATE TABLE registry.resolutions (
                    runset_id VARCHAR,
                    resolved_at TIMESTAMP,
                    resolver_version VARCHAR,
                    resolution_hash VARCHAR,
                    run_id VARCHAR,
                    frozen BOOLEAN,
                    metadata_json VARCHAR
                )
            """)
            tables['resolutions'] = 0
        
        # Load tags
        tags_path = self.registry_root / 'tags'
        if tags_path.exists():
            conn.execute(f"""
                CREATE TABLE registry.tags AS
                SELECT * FROM read_parquet('{tags_path}/**/*.parquet')
            """)
            count = conn.execute("SELECT COUNT(*) FROM registry.tags").fetchone()[0]
            tables['tags'] = count
        else:
            conn.execute("""
                CREATE TABLE registry.tags (
                    runset_id VARCHAR,
                    tag VARCHAR,
                    created_at TIMESTAMP
                )
            """)
            tables['tags'] = 0
        
        return tables
    
    def _derive_membership(self, conn: duckdb.DuckDBPyConnection):
        """Derive runset_membership table from resolutions."""
        conn.execute("""
            CREATE TABLE registry.runset_membership AS
            SELECT DISTINCT
                r.runset_id,
                r.run_id
            FROM registry.resolutions r
            WHERE r.run_id IS NOT NULL
              AND (r.runset_id, r.resolved_at) IN (
                  SELECT runset_id, MAX(resolved_at)
                  FROM registry.resolutions
                  WHERE frozen = TRUE
                  GROUP BY runset_id
              )
        """)
    
    def _create_views(self, conn: duckdb.DuckDBPyConnection):
        """Create convenience views."""
        # View: RunSets with latest resolution
        conn.execute("""
            CREATE VIEW registry.runsets_with_resolution AS
            SELECT
                rs.runset_id,
                rs.spec_json,
                rs.created_at,
                rs.mode,
                r.resolved_at,
                r.resolver_version,
                r.resolution_hash,
                r.frozen,
                COUNT(DISTINCT r.run_id) as run_count
            FROM registry.runsets rs
            LEFT JOIN LATERAL (
                SELECT *
                FROM registry.resolutions
                WHERE runset_id = rs.runset_id
                ORDER BY resolved_at DESC
                LIMIT 1
            ) r ON TRUE
            GROUP BY rs.runset_id, rs.spec_json, rs.created_at, rs.mode,
                     r.resolved_at, r.resolver_version, r.resolution_hash, r.frozen
        """)
        
        # View: Runs with artifact counts
        conn.execute("""
            CREATE VIEW registry.runs_with_artifacts AS
            SELECT
                r.run_id,
                r.dataset_ids,
                r.strategy_spec_hash,
                r.engine_version,
                r.status,
                r.created_at,
                COUNT(a.artifact_id) as artifact_count,
                COUNT(DISTINCT m.runset_id) as runset_count
            FROM registry.runs r
            LEFT JOIN registry.artifacts a ON r.run_id = a.run_id
            LEFT JOIN registry.runset_membership m ON r.run_id = m.run_id
            GROUP BY r.run_id, r.dataset_ids, r.strategy_spec_hash,
                     r.engine_version, r.status, r.created_at
        """)
    
    def _compute_summary(self, conn: duckdb.DuckDBPyConnection) -> Dict[str, Any]:
        """Compute rebuild summary."""
        return {
            'runsets': conn.execute("SELECT COUNT(*) FROM registry.runsets").fetchone()[0],
            'runs': conn.execute("SELECT COUNT(*) FROM registry.runs").fetchone()[0],
            'artifacts': conn.execute("SELECT COUNT(*) FROM registry.artifacts").fetchone()[0],
            'resolutions': conn.execute("SELECT COUNT(*) FROM registry.resolutions").fetchone()[0],
            'membership': conn.execute("SELECT COUNT(*) FROM registry.runset_membership").fetchone()[0],
        }


def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error': 'Usage: runset_registry_rebuild.py <args_json>'
        }))
        sys.exit(1)
    
    args = json.loads(sys.stdin.read()) if len(sys.argv) == 2 else json.loads(sys.argv[2])
    
    registry_root = args.get('registry_root', '/home/memez/opn/registry')
    duckdb_path = args.get('duckdb_path', 'data/registry.duckdb')
    force = args.get('force', False)
    
    rebuilder = RegistryRebuilder(registry_root, duckdb_path)
    
    try:
        result = rebuilder.rebuild(force=force)
        print(json.dumps(result, default=str))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()

