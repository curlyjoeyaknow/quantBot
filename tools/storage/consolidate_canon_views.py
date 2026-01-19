#!/usr/bin/env python3
"""
Consolidate Canon Views

Safely consolidates redundant views in the canon schema by:
1. Backing up current view definitions
2. Creating migration views pointing to alerts_std
3. Dropping redundant views
4. Generating migration report

Usage:
    python tools/storage/consolidate_canon_views.py --db-path data/alerts.duckdb --dry-run
    python tools/storage/consolidate_canon_views.py --db-path data/alerts.duckdb --execute
"""

from __future__ import annotations

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

# Add workspace root to path
workspace_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(workspace_root))

from tools.shared.duckdb_adapter import get_readonly_connection, get_write_connection
from tools.shared.duckdb_data_helper import CANON_VIEWS, DEPRECATED_VIEWS


def backup_views(con: duckdb.DuckDBPyConnection) -> dict:
    """
    Backup all canon view definitions.

    Returns:
        Dictionary mapping view names to their SQL definitions
    """
    backups = {}

    try:
        views = con.execute(
            "SELECT view_name, sql FROM duckdb_views() WHERE schema_name = 'canon' ORDER BY view_name"
        ).fetchall()

        for view_name, sql in views:
            backups[view_name] = sql

    except Exception as e:
        print(f"Warning: Failed to backup views: {e}", file=sys.stderr)

    return backups


def create_migration_views(con: duckdb.DuckDBPyConnection, dry_run: bool = False) -> list[str]:
    """
    Create migration views that point to alerts_std.

    Returns:
        List of migration view names created
    """
    migrations = []

    # Migration view definitions
    migration_defs = {
        "alerts": "SELECT * FROM canon.alerts_std",
        "alerts_ready": "SELECT * FROM canon.alerts_std WHERE caller_id IS NOT NULL",
    }

    for view_name, sql in migration_defs.items():
        full_view_name = f"canon.{view_name}"
        create_sql = f"CREATE OR REPLACE VIEW {full_view_name} AS {sql}"

        if dry_run:
            print(f"[DRY RUN] Would create: {full_view_name}")
            print(f"  SQL: {create_sql}")
        else:
            try:
                con.execute(create_sql)
                print(f"Created migration view: {full_view_name}")
                migrations.append(view_name)
            except Exception as e:
                print(f"Warning: Failed to create {full_view_name}: {e}", file=sys.stderr)

    return migrations


def drop_redundant_views(con: duckdb.DuckDBPyConnection, dry_run: bool = False) -> list[str]:
    """
    Drop redundant views (deprecated views that aren't essential).

    Returns:
        List of dropped view names
    """
    dropped = []

    # Views to drop (deprecated views)
    views_to_drop = sorted(DEPRECATED_VIEWS.keys())

    for view_name in views_to_drop:
        full_view_name = f"canon.{view_name}"

        # Check if view exists
        try:
            exists = con.execute(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'canon' AND table_name = ?",
                [view_name],
            ).fetchone()[0] > 0

            if not exists:
                continue

            if dry_run:
                print(f"[DRY RUN] Would drop: {full_view_name}")
            else:
                try:
                    con.execute(f"DROP VIEW IF EXISTS {full_view_name}")
                    print(f"Dropped view: {full_view_name}")
                    dropped.append(view_name)
                except Exception as e:
                    print(f"Warning: Failed to drop {full_view_name}: {e}", file=sys.stderr)

        except Exception as e:
            print(f"Warning: Failed to check existence of {full_view_name}: {e}", file=sys.stderr)

    return dropped


def consolidate_views(db_path: str, dry_run: bool = False) -> dict:
    """
    Consolidate canon views.

    Returns:
        Dictionary with consolidation results
    """
    results = {
        "database_path": db_path,
        "dry_run": dry_run,
        "timestamp": datetime.now().isoformat(),
        "backed_up_views": {},
        "migration_views_created": [],
        "views_dropped": [],
        "errors": [],
    }

    try:
        if dry_run:
            con = get_readonly_connection(db_path)
        else:
            con = get_write_connection(db_path)

        with con:
            # Backup views
            print("Backing up view definitions...")
            results["backed_up_views"] = backup_views(con)
            print(f"Backed up {len(results['backed_up_views'])} views")

            # Create migration views
            print("\nCreating migration views...")
            results["migration_views_created"] = create_migration_views(con, dry_run)

            # Drop redundant views
            print("\nDropping redundant views...")
            results["views_dropped"] = drop_redundant_views(con, dry_run)

            if dry_run:
                print("\n[DRY RUN] No changes were made to the database.")
            else:
                print(f"\nConsolidation complete:")
                print(f"  - Migration views created: {len(results['migration_views_created'])}")
                print(f"  - Views dropped: {len(results['views_dropped'])}")

    except Exception as e:
        error_msg = f"Failed to consolidate views: {e}"
        print(f"Error: {error_msg}", file=sys.stderr)
        results["errors"].append(error_msg)

    return results


def print_report(results: dict):
    """Print consolidation report."""
    print("\n" + "=" * 80)
    print("VIEW CONSOLIDATION REPORT")
    print("=" * 80)
    print(f"\nDatabase: {results['database_path']}")
    print(f"Dry run: {results['dry_run']}")
    print(f"Timestamp: {results['timestamp']}")

    print(f"\nBacked up views: {len(results['backed_up_views'])}")
    for view_name in sorted(results["backed_up_views"].keys()):
        print(f"  - {view_name}")

    print(f"\nMigration views created: {len(results['migration_views_created'])}")
    for view_name in results["migration_views_created"]:
        print(f"  - {view_name}")

    print(f"\nViews dropped: {len(results['views_dropped'])}")
    for view_name in results["views_dropped"]:
        print(f"  - {view_name}")

    if results["errors"]:
        print(f"\nErrors: {len(results['errors'])}")
        for error in results["errors"]:
            print(f"  - {error}")

    print("\n" + "=" * 80)


def main():
    parser = argparse.ArgumentParser(description="Consolidate canon views")
    parser.add_argument("--db-path", default="data/alerts.duckdb", help="Path to DuckDB database")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    parser.add_argument("--execute", action="store_true", help="Actually execute the consolidation (required)")
    parser.add_argument("--output", help="Output JSON report to file")

    args = parser.parse_args()

    if not args.dry_run and not args.execute:
        print("Error: Must specify --dry-run or --execute", file=sys.stderr)
        sys.exit(1)

    dry_run = args.dry_run or not args.execute

    # Consolidate
    results = consolidate_views(args.db_path, dry_run=dry_run)

    # Output
    print_report(results)

    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nReport saved to: {args.output}")


if __name__ == "__main__":
    main()

