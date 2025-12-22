#!/usr/bin/env python3
"""
DuckDB Schema Migration: Add Idempotency Support

Migrates existing DuckDB databases to support idempotent ingestion:
- Adds run_id columns to all ingestion tables
- Adds PRIMARY KEY constraints
- Creates ingestion_runs tracking table
- Updates schema version

Usage:
    python migrate_schema_idempotent.py --duckdb path/to/db.duckdb
"""

import argparse
import duckdb
import sys
from typing import Optional

SCHEMA_VERSION_IDEMPOTENT = 2

def check_schema_version(con: duckdb.DuckDBPyConnection) -> int:
    """Check current schema version"""
    try:
        result = con.execute("""
            SELECT MAX(version) FROM schema_version
        """).fetchone()
        return result[0] if result and result[0] else 1
    except Exception:
        # schema_version table doesn't exist
        return 1

def create_schema_version_table(con: duckdb.DuckDBPyConnection) -> None:
    """Create schema_version table if it doesn't exist"""
    con.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          description TEXT
        )
    """)
    
    # Insert version 1 if not exists
    con.execute("""
        INSERT OR IGNORE INTO schema_version (version, description) 
        VALUES (1, 'Initial schema without idempotency')
    """)

def column_exists(con: duckdb.DuckDBPyConnection, table: str, column: str) -> bool:
    """Check if column exists in table"""
    try:
        result = con.execute(f"PRAGMA table_info({table})").fetchall()
        columns = [row[1] for row in result]  # Column name is at index 1
        return column in columns
    except Exception:
        return False

def migrate_to_v2(con: duckdb.DuckDBPyConnection) -> None:
    """Migrate to schema version 2 (idempotency support)"""
    print("Migrating to schema version 2 (idempotency support)...")
    
    # 1. Create ingestion_runs table
    print("  Creating ingestion_runs table...")
    con.execute("""
        CREATE TABLE IF NOT EXISTS ingestion_runs (
          run_id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
          input_file_path TEXT NOT NULL,
          input_file_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          rows_inserted_tg_norm INTEGER DEFAULT 0,
          rows_inserted_caller_links INTEGER DEFAULT 0,
          rows_inserted_user_calls INTEGER DEFAULT 0,
          error_message TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_ingestion_runs_chat_id ON ingestion_runs(chat_id)
    """)
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(status)
    """)
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_ingestion_runs_input_hash ON ingestion_runs(input_file_hash)
    """)
    
    # 2. Add run_id to tg_norm_d
    print("  Adding run_id to tg_norm_d...")
    if not column_exists(con, 'tg_norm_d', 'run_id'):
        con.execute("""
            ALTER TABLE tg_norm_d ADD COLUMN run_id TEXT NOT NULL DEFAULT 'legacy'
        """)
        con.execute("""
            ALTER TABLE tg_norm_d ADD COLUMN inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        """)
        print("    Added run_id and inserted_at columns")
    else:
        print("    run_id column already exists")
    
    # 3. Add run_id to caller_links_d
    print("  Adding run_id to caller_links_d...")
    if not column_exists(con, 'caller_links_d', 'run_id'):
        con.execute("""
            ALTER TABLE caller_links_d ADD COLUMN run_id TEXT NOT NULL DEFAULT 'legacy'
        """)
        con.execute("""
            ALTER TABLE caller_links_d ADD COLUMN inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        """)
        print("    Added run_id and inserted_at columns")
    else:
        print("    run_id column already exists")
    
    # 4. Add run_id to user_calls_d
    print("  Adding run_id to user_calls_d...")
    if not column_exists(con, 'user_calls_d', 'run_id'):
        con.execute("""
            ALTER TABLE user_calls_d ADD COLUMN run_id TEXT NOT NULL DEFAULT 'legacy'
        """)
        con.execute("""
            ALTER TABLE user_calls_d ADD COLUMN inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        """)
        print("    Added run_id and inserted_at columns")
    else:
        print("    run_id column already exists")
    
    # 5. Create indexes
    print("  Creating indexes...")
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_tg_norm_run_id ON tg_norm_d(run_id)
    """)
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_caller_links_run_id ON caller_links_d(run_id)
    """)
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_calls_run_id ON user_calls_d(run_id)
    """)
    
    # 6. Update schema version
    con.execute("""
        INSERT INTO schema_version (version, description) 
        VALUES (?, 'Idempotency support: run_id tracking, PRIMARY KEYs')
    """, [SCHEMA_VERSION_IDEMPOTENT])
    
    print("  Migration complete!")

def main():
    parser = argparse.ArgumentParser(description='Migrate DuckDB schema to support idempotency')
    parser.add_argument('--duckdb', required=True, help='Path to DuckDB file')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done without making changes')
    args = parser.parse_args()
    
    try:
        con = duckdb.connect(args.duckdb)
        
        # Create schema_version table if needed
        create_schema_version_table(con)
        
        current_version = check_schema_version(con)
        print(f"Current schema version: {current_version}")
        print(f"Target schema version: {SCHEMA_VERSION_IDEMPOTENT}")
        
        if current_version >= SCHEMA_VERSION_IDEMPOTENT:
            print("Database is already at target version or newer. No migration needed.")
            return 0
        
        if args.dry_run:
            print("DRY RUN: Would migrate to version 2")
            return 0
        
        # Perform migration
        migrate_to_v2(con)
        
        # Verify
        new_version = check_schema_version(con)
        if new_version >= SCHEMA_VERSION_IDEMPOTENT:
            print(f"\n✓ Migration successful! Schema version: {new_version}")
            return 0
        else:
            print(f"\n✗ Migration failed. Schema version: {new_version}")
            return 1
            
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())

