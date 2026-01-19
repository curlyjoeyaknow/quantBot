#!/usr/bin/env python3
"""
Populate main.caller_links_d from canon.alerts_final.

This ensures caller_links_d has the full dataset (8+ months) instead of just a subset.
"""

import sys
from pathlib import Path

# Add tools to path
root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(root))

import duckdb
from tools.shared.duckdb_adapter import get_write_connection


def populate_caller_links_d(duckdb_path: str, source_db_path: str = None, dry_run: bool = False) -> None:
    """
    Populate main.caller_links_d from canon.alerts_final.
    
    Args:
        duckdb_path: Path to DuckDB database
        dry_run: If True, only show what would be done without making changes
    """
    # If source_db_path is provided, use it as the source; otherwise use the same database
    source_path = source_db_path or duckdb_path
    
    with get_write_connection(duckdb_path) as conn:
        # Check if canon.alerts_final exists in source database
        try:
            if source_db_path:
                # Connect to source database to check
                source_conn = duckdb.connect(source_db_path, read_only=True)
                canon_count = source_conn.execute('SELECT COUNT(*) FROM canon.alerts_final').fetchone()[0]
                source_conn.close()
                print(f"Source database ({source_db_path}):")
                print(f"  canon.alerts_final: {canon_count:,} alerts")
            else:
                canon_count = conn.execute('SELECT COUNT(*) FROM canon.alerts_final').fetchone()[0]
                print(f"canon.alerts_final: {canon_count:,} alerts")
        except Exception as e:
            print(f"Error: canon.alerts_final not found in source: {e}")
            return
        
        # Check if caller_links_d table exists
        table_exists = False
        try:
            conn.execute("SELECT 1 FROM caller_links_d LIMIT 1").fetchone()
            table_exists = True
        except:
            print("caller_links_d table does not exist, will create it...")
        
        # Check current caller_links_d count
        current_count = 0
        if table_exists:
            try:
                current_count = conn.execute("SELECT COUNT(*) FROM caller_links_d WHERE mint IS NOT NULL").fetchone()[0]
                print(f"main.caller_links_d (current): {current_count:,} alerts")
            except Exception as e:
                print(f"Warning: Could not count caller_links_d: {e}")
        else:
            print(f"main.caller_links_d (current): 0 alerts (table will be created)")
        
        if dry_run:
            print("\n[DRY RUN] Would execute:")
            print("""
            -- Clear existing data
            DELETE FROM caller_links_d;
            
            -- Populate from canon.alerts_final
            INSERT INTO caller_links_d (mint, trigger_ts_ms, caller_name, chain)
            SELECT DISTINCT
                mint,
                alert_ts_ms AS trigger_ts_ms,
                COALESCE(caller_name, caller_name_norm) AS caller_name,
                chain
            FROM canon.alerts_final
            WHERE mint IS NOT NULL
              AND alert_ts_ms IS NOT NULL;
            """)
            return
        
        print("\nPopulating caller_links_d from canon.alerts_final...")
        
        # Create table if it doesn't exist (minimal schema for backtesting)
        if not table_exists:
            # Create minimal table with just the columns we need
            create_sql = """
            CREATE TABLE IF NOT EXISTS caller_links_d (
                mint VARCHAR,
                trigger_ts_ms BIGINT,
                caller_name VARCHAR,
                chain VARCHAR
            )
            """
            conn.execute(create_sql)
            print(f"  Created caller_links_d table (minimal schema)")
        else:
            # Clear existing data
            deleted = conn.execute("DELETE FROM caller_links_d").fetchone()
            print(f"  Cleared existing data")
        
        # Insert from canon.alerts_final
        # Check what columns exist in caller_links_d
        cols = conn.execute("PRAGMA table_info('caller_links_d')").fetchall()
        col_names = [c[1].lower() for c in cols]
        
        # Build INSERT statement - use source database if provided
        source_db_attached = False
        source_db_name = None
        if source_db_path:
            # Use ATTACH to access source database
            source_db_name = f"source_{abs(hash(source_db_path)) % 10000}"
            try:
                conn.execute(f"ATTACH '{source_db_path}' AS {source_db_name} (READ_ONLY)")
                source_prefix = f"{source_db_name}.canon.alerts_final"
                source_db_attached = True
            except Exception as e:
                print(f"Error: Could not attach source database: {e}")
                return
        else:
            source_prefix = "canon.alerts_final"
        
        # Build INSERT statement based on available columns
        if "chain" in col_names:
            insert_sql = f"""
            INSERT INTO caller_links_d (mint, trigger_ts_ms, caller_name, chain)
            SELECT DISTINCT
                mint,
                alert_ts_ms AS trigger_ts_ms,
                COALESCE(caller_name, caller_name_norm) AS caller_name,
                chain
            FROM {source_prefix}
            WHERE mint IS NOT NULL
              AND alert_ts_ms IS NOT NULL
            """
        else:
            insert_sql = f"""
            INSERT INTO caller_links_d (mint, trigger_ts_ms, caller_name)
            SELECT DISTINCT
                mint,
                alert_ts_ms AS trigger_ts_ms,
                COALESCE(caller_name, caller_name_norm) AS caller_name
            FROM {source_prefix}
            WHERE mint IS NOT NULL
              AND alert_ts_ms IS NOT NULL
            """
        
        result = conn.execute(insert_sql)
        inserted = conn.execute("SELECT COUNT(*) FROM caller_links_d WHERE mint IS NOT NULL").fetchone()[0]
        
        # Detach source database if we attached it
        if source_db_attached:
            try:
                conn.execute(f"DETACH {source_db_name}")
            except:
                pass
        
        print(f"  Inserted {inserted:,} alerts")
        print(f"  Increase: {inserted - current_count:,} alerts")
        
        # Show date range
        date_range = conn.execute("""
            SELECT 
                MIN(trigger_ts_ms) as min_ts,
                MAX(trigger_ts_ms) as max_ts
            FROM caller_links_d
            WHERE mint IS NOT NULL
        """).fetchone()
        
        if date_range[0]:
            from datetime import datetime
            min_date = datetime.fromtimestamp(date_range[0]/1000).date()
            max_date = datetime.fromtimestamp(date_range[1]/1000).date()
            days = (date_range[1] - date_range[0]) / (1000*60*60*24)
            print(f"  Date range: {min_date} to {max_date} ({days:.0f} days)")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Populate caller_links_d from canon.alerts_final")
    parser.add_argument("--duckdb", default="data/alerts.duckdb", help="Path to target DuckDB database")
    parser.add_argument("--source", help="Path to source DuckDB database (if different from target)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    args = parser.parse_args()
    
    populate_caller_links_d(args.duckdb, source_db_path=args.source, dry_run=args.dry_run)

