#!/usr/bin/env python3
"""
Query the artifact bus catalog

Usage:
    python3 scripts/query_catalog.py
    python3 scripts/query_catalog.py --runs
    python3 scripts/query_catalog.py --artifacts
    python3 scripts/query_catalog.py --latest
"""

import argparse
import json
import sys
from pathlib import Path

import duckdb


def query_runs(con: duckdb.DuckDBPyConnection, limit: int = 10):
    """Query recent runs from catalog."""
    try:
        runs = con.execute(
            """
            SELECT 
                run_id,
                producer,
                kind,
                created_at_utc,
                last_seen_at,
                meta_json
            FROM catalog.runs_d
            ORDER BY last_seen_at DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()

        if not runs:
            print("No runs found in catalog")
            return

        print(f"\n📊 Recent Runs (last {limit}):")
        print("=" * 80)
        for run in runs:
            run_id, producer, kind, created_at, last_seen, meta_json = run
            meta = json.loads(meta_json) if meta_json else {}
            print(f"\nRun ID: {run_id}")
            print(f"  Producer: {producer}")
            print(f"  Kind: {kind}")
            print(f"  Created: {created_at}")
            print(f"  Last Seen: {last_seen}")
            if meta:
                print(f"  Meta: {json.dumps(meta, indent=4)}")
    except Exception as e:
        if "does not exist" in str(e) or "Catalog" in str(e):
            print("⚠ Catalog tables not found. Run the daemon to create them.")
        else:
            raise


def query_artifacts(con: duckdb.DuckDBPyConnection, limit: int = 20):
    """Query recent artifacts from catalog."""
    try:
        artifacts = con.execute(
            """
            SELECT 
                artifact_key,
                run_id,
                artifact_id,
                producer,
                kind,
                format,
                rows,
                canonical_path,
                created_at_utc,
                ingested_at
            FROM catalog.artifacts_f
            ORDER BY ingested_at DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()

        if not artifacts:
            print("No artifacts found in catalog")
            return

        print(f"\n📦 Recent Artifacts (last {limit}):")
        print("=" * 80)
        for art in artifacts:
            (
                key,
                run_id,
                artifact_id,
                producer,
                kind,
                fmt,
                rows,
                path,
                created_at,
                ingested_at,
            ) = art
            print(f"\n{artifact_id} ({producer}/{kind})")
            print(f"  Run ID: {run_id[:8]}...")
            print(f"  Format: {fmt}")
            print(f"  Rows: {rows}")
            print(f"  Path: {path}")
            print(f"  Ingested: {ingested_at}")
    except Exception as e:
        if "does not exist" in str(e) or "Catalog" in str(e):
            print("⚠ Catalog tables not found. Run the daemon to create them.")
        else:
            raise


def query_latest(con: duckdb.DuckDBPyConnection):
    """Query latest artifacts per kind."""
    try:
        latest = con.execute(
            """
            SELECT 
                producer,
                kind,
                artifact_id,
                run_id,
                rows,
                canonical_path,
                ingested_at
            FROM catalog.latest_artifacts_v
            ORDER BY producer, kind, ingested_at DESC
            """
        ).fetchall()

        if not latest:
            print("No latest artifacts found")
            return

        print("\n⭐ Latest Artifacts (per producer/kind):")
        print("=" * 80)
        for art in latest:
            producer, kind, artifact_id, run_id, rows, path, ingested_at = art
            print(f"\n{producer}/{kind}/{artifact_id}")
            print(f"  Run ID: {run_id[:8]}...")
            print(f"  Rows: {rows}")
            print(f"  Path: {path}")
            print(f"  Ingested: {ingested_at}")
    except Exception as e:
        if "does not exist" in str(e) or "Catalog" in str(e):
            print("⚠ Catalog tables not found. Run the daemon to create them.")
        else:
            raise


def main():
    parser = argparse.ArgumentParser(description="Query artifact bus catalog")
    parser.add_argument("--db-path", default="data/alerts.duckdb", help="Path to DuckDB database")
    parser.add_argument("--runs", action="store_true", help="Show recent runs")
    parser.add_argument("--artifacts", action="store_true", help="Show recent artifacts")
    parser.add_argument("--latest", action="store_true", help="Show latest artifacts per kind")
    parser.add_argument("--limit", type=int, default=10, help="Limit for queries")

    args = parser.parse_args()

    db_path = Path(args.db_path)
    if not db_path.exists():
        print(f"❌ Database not found: {db_path}")
        print("   Make sure the daemon has run at least once")
        return 1

    con = duckdb.connect(str(db_path), read_only=True)

    try:
        if args.runs:
            query_runs(con, args.limit)
        elif args.artifacts:
            query_artifacts(con, args.limit)
        elif args.latest:
            query_latest(con)
        else:
            # Default: show all
            query_runs(con, args.limit)
            query_artifacts(con, args.limit)
            query_latest(con)
    finally:
        con.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())

