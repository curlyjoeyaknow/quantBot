#!/usr/bin/env python3
"""
Schema Migration Runner

Usage:
    python tools/storage/migrate.py up [--duckdb PATH]
    python tools/storage/migrate.py status [--duckdb PATH]
    python tools/storage/migrate.py history [--duckdb PATH]

Addresses: Risk #1 from ARCHITECTURE_REVIEW_2026-01-21.md
          "Schema migration strategy is implicit"
"""

import sys
import os
import argparse
from pathlib import Path
from datetime import datetime
import hashlib
import duckdb

def load_migrations(migrations_dir: Path) -> list:
    """Load all migration SQL files"""
    migrations = []
    
    if not migrations_dir.exists():
        return migrations
    
    for file in sorted(migrations_dir.glob("*.sql")):
        if not file.name[0].isdigit():
            continue
            
        version = int(file.name[:3])
        name = file.name[4:-4]  # Remove "000_" and ".sql"
        sql = file.read_text()
        checksum = hashlib.sha256(sql.encode()).hexdigest()
        
        migrations.append({
            'version': version,
            'name': name,
            'filepath': str(file),
            'sql': sql,
            'checksum': checksum
        })
    
    return migrations

def get_current_version(conn: duckdb.DuckDBPyConnection, db_type: str = 'duckdb') -> int:
    """Get current schema version"""
    try:
        result = conn.execute("""
            SELECT MAX(version) as current_version
            FROM schema_migrations
            WHERE database_type = ?
              AND status = 'applied'
        """, [db_type]).fetchone()
        
        return result[0] if result and result[0] is not None else 0
    except Exception:
        # Table doesn't exist yet
        return 0

def migrate_up(duckdb_path: str):
    """Apply all pending migrations"""
    print("🔄 Running migrations...\n")
    
    conn = duckdb.connect(duckdb_path)
    
    try:
        current_version = get_current_version(conn)
        print(f"📌 Current version: {current_version}")
        
        # Load migration files
        migrations_dir = Path("packages/storage/migrations")
        migrations = load_migrations(migrations_dir)
        
        # Filter pending migrations (include current_version if it's 0 and migration 0 exists)
        if current_version == 0:
            # First run: apply migration 0 and all others
            pending = migrations
        else:
            # Normal: only apply migrations > current_version
            pending = [m for m in migrations if m['version'] > current_version]
        
        if not pending:
            print("✅ No pending migrations")
            return
        
        print(f"📦 Found {len(pending)} pending migration(s)\n")
        
        for migration in pending:
            print(f"⏳ Applying migration {migration['version']}: {migration['name']}...")
            
            start_time = datetime.now()
            
            try:
                # Execute migration
                conn.execute(migration['sql'])
                
                execution_time = int((datetime.now() - start_time).total_seconds() * 1000)
                
                # Record migration in tracking table
                # Note: Migration 000 creates the schema_migrations table itself
                # So we only try to record if version > 0
                try:
                    conn.execute("""
                        INSERT INTO schema_migrations 
                        (version, name, description, database_type, checksum, execution_time_ms, status)
                        VALUES (?, ?, ?, 'duckdb', ?, ?, 'applied')
                    """, [
                        migration['version'],
                        migration['name'],
                        f"Migration: {migration['name']}",
                        migration['checksum'],
                        execution_time
                    ])
                except Exception as record_error:
                    # If version 0, the table might not exist yet (it's being created by this migration)
                    if migration['version'] == 0:
                        print(f"   (Schema migrations table created by this migration)")
                    else:
                        raise record_error
                
                print(f"✅ Migration {migration['version']} applied ({execution_time}ms)\n")
                
            except Exception as e:
                print(f"❌ Migration {migration['version']} failed: {e}")
                raise
        
        new_version = get_current_version(conn)
        print(f"\n🎉 Migrations complete! Version: {current_version} → {new_version}")
        
    finally:
        conn.close()

def show_status(duckdb_path: str):
    """Show current schema status"""
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        current_version = get_current_version(conn)
        
        print("\n📊 Schema Status")
        print(f"Database: {duckdb_path}")
        print(f"Current version: {current_version}")
        
        # Try to get migration count
        try:
            result = conn.execute("""
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied
                FROM schema_migrations
                WHERE database_type = 'duckdb'
            """).fetchone()
            
            if result:
                print(f"Total migrations: {result[1]} applied")
        except:
            pass
        
        print()
        
    finally:
        conn.close()

def show_history(duckdb_path: str):
    """Show migration history"""
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        rows = conn.execute("""
            SELECT version, name, status, applied_at, execution_time_ms
            FROM schema_migrations
            WHERE database_type = 'duckdb'
            ORDER BY version
        """).fetchall()
        
        print("\n📜 Migration History\n")
        print(f"{'Ver':<5} {'Name':<30} {'Status':<12} {'Applied':<20} {'Time':<10}")
        print("=" * 80)
        
        for row in rows:
            version, name, status, applied_at, exec_time = row
            exec_time_str = f"{exec_time}ms" if exec_time else "-"
            applied_str = str(applied_at)[:19] if applied_at else "-"
            print(f"{version:<5} {name:<30} {status:<12} {applied_str:<20} {exec_time_str:<10}")
        
        print()
        
    except Exception as e:
        print(f"⚠️  No migration history available: {e}\n")
    finally:
        conn.close()

def main():
    parser = argparse.ArgumentParser(description='Schema Migration Runner')
    parser.add_argument('command', choices=['up', 'status', 'history'],
                       help='Migration command')
    parser.add_argument('--duckdb', default=os.environ.get('DUCKDB_PATH', 'data/quantbot.duckdb'),
                       help='Path to DuckDB file')
    
    args = parser.parse_args()
    
    if args.command == 'up':
        migrate_up(args.duckdb)
    elif args.command == 'status':
        show_status(args.duckdb)
    elif args.command == 'history':
        show_history(args.duckdb)

if __name__ == '__main__':
    main()

