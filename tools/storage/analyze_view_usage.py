#!/usr/bin/env python3
"""
Analyze View Usage

Scans codebase and database for references to canon views to identify:
- Which views are actually used
- Which views are redundant
- View dependencies
- Migration candidates

Usage:
    python tools/storage/analyze_view_usage.py --db-path data/alerts.duckdb
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Set

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

# Add workspace root to path
workspace_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(workspace_root))

from tools.shared.duckdb_adapter import get_readonly_connection
from tools.shared.duckdb_data_helper import CANON_VIEWS, DEPRECATED_VIEWS


def scan_codebase_for_view_references() -> Dict[str, List[str]]:
    """
    Scan codebase for references to canon views.

    Returns:
        Dictionary mapping view names to list of file paths where they're referenced
    """
    view_references: Dict[str, List[str]] = defaultdict(list)

    # Patterns to search for
    patterns = [
        r"canon\.(\w+)",  # canon.view_name
        r'"canon\.(\w+)"',  # "canon.view_name"
        r"'canon\.(\w+)'",  # 'canon.view_name'
        r"FROM canon\.(\w+)",  # FROM canon.view_name
        r"JOIN canon\.(\w+)",  # JOIN canon.view_name
    ]

    # Directories to scan
    scan_dirs = [
        workspace_root / "packages",
        workspace_root / "tools",
        workspace_root / "scripts",
    ]

    # File extensions to scan
    extensions = {".ts", ".tsx", ".js", ".jsx", ".py", ".sql"}

    for scan_dir in scan_dirs:
        if not scan_dir.exists():
            continue

        for file_path in scan_dir.rglob("*"):
            if file_path.suffix not in extensions:
                continue

            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            # Search for view references
            for pattern in patterns:
                matches = re.finditer(pattern, content, re.IGNORECASE)
                for match in matches:
                    view_name = match.group(1).lower()
                    if view_name not in view_references:
                        view_references[view_name] = []
                    rel_path = str(file_path.relative_to(workspace_root))
                    if rel_path not in view_references[view_name]:
                        view_references[view_name].append(rel_path)

    return dict(view_references)


def get_database_view_dependencies(con: duckdb.DuckDBPyConnection) -> Dict[str, List[str]]:
    """
    Get view dependencies from database.

    Returns:
        Dictionary mapping view names to list of views/tables they depend on
    """
    dependencies: Dict[str, List[str]] = {}

    try:
        # Get all canon views
        views = con.execute(
            "SELECT view_name FROM information_schema.tables WHERE table_schema = 'canon' AND table_type = 'VIEW' ORDER BY view_name"
        ).fetchall()

        for (view_name,) in views:
            try:
                # Get view definition
                view_def = con.execute(
                    f"SELECT sql FROM duckdb_views() WHERE schema_name = 'canon' AND view_name = ?",
                    [view_name],
                ).fetchone()

                if view_def:
                    sql = view_def[0]
                    # Extract dependencies (simplified - looks for canon.* references)
                    deps = re.findall(r"canon\.(\w+)", sql, re.IGNORECASE)
                    dependencies[view_name] = list(set(deps))
            except Exception:
                dependencies[view_name] = []

    except Exception as e:
        print(f"Warning: Failed to get view dependencies: {e}", file=sys.stderr)

    return dependencies


def analyze_view_usage(db_path: str) -> Dict:
    """
    Analyze view usage across codebase and database.

    Returns:
        Dictionary with analysis results
    """
    # Scan codebase
    print("Scanning codebase for view references...")
    codebase_refs = scan_codebase_for_view_references()

    # Get database info
    print("Analyzing database view dependencies...")
    with get_readonly_connection(db_path) as con:
        db_deps = get_database_view_dependencies(con)

        # Get all canon views
        views = con.execute(
            "SELECT view_name FROM information_schema.tables WHERE table_schema = 'canon' AND table_type = 'VIEW' ORDER BY view_name"
        ).fetchall()
        all_views = [v[0] for v in views]

    # Categorize views
    essential_views = set(CANON_VIEWS.keys())
    deprecated_views = set(DEPRECATED_VIEWS.keys())
    other_views = set(all_views) - essential_views - deprecated_views

    # Analyze usage
    used_views: Set[str] = set()
    unused_views: Set[str] = set()

    for view_name in all_views:
        view_lower = view_name.lower()
        has_codebase_refs = view_lower in codebase_refs
        has_db_deps = view_name in db_deps and len(db_deps[view_name]) > 0

        if has_codebase_refs or has_db_deps or view_name in essential_views:
            used_views.add(view_name)
        else:
            unused_views.add(view_name)

    # Build report
    report = {
        "database_path": db_path,
        "total_views": len(all_views),
        "essential_views": sorted(essential_views),
        "deprecated_views": sorted(deprecated_views),
        "other_views": sorted(other_views),
        "used_views": sorted(used_views),
        "unused_views": sorted(unused_views),
        "codebase_references": {
            view: files for view, files in codebase_refs.items() if files
        },
        "database_dependencies": db_deps,
        "recommendations": {
            "keep": sorted(essential_views),
            "migrate": sorted(deprecated_views),
            "remove_candidates": sorted(unused_views - essential_views),
        },
    }

    return report


def print_report(report: Dict):
    """Print analysis report."""
    print("\n" + "=" * 80)
    print("VIEW USAGE ANALYSIS REPORT")
    print("=" * 80)
    print(f"\nDatabase: {report['database_path']}")
    print(f"Total views: {report['total_views']}")

    print("\n--- Essential Views (KEEP) ---")
    for view in report["essential_views"]:
        print(f"  ✓ {view}")

    print("\n--- Deprecated Views (MIGRATE) ---")
    for view in report["deprecated_views"]:
        refs = report["codebase_references"].get(view.lower(), [])
        if refs:
            print(f"  ⚠ {view} (used in {len(refs)} files)")
            for ref in refs[:3]:  # Show first 3
                print(f"      - {ref}")
            if len(refs) > 3:
                print(f"      ... and {len(refs) - 3} more")
        else:
            print(f"  ⚠ {view} (not used in codebase)")

    print("\n--- Other Views ---")
    for view in report["other_views"]:
        refs = report["codebase_references"].get(view.lower(), [])
        deps = report["database_dependencies"].get(view, [])
        if refs or deps:
            print(f"  ? {view}")
            if refs:
                print(f"      Codebase refs: {len(refs)}")
            if deps:
                print(f"      DB deps: {', '.join(deps)}")
        else:
            print(f"  - {view} (unused)")

    print("\n--- Recommendations ---")
    print("KEEP:")
    for view in report["recommendations"]["keep"]:
        print(f"  - {view}")

    print("\nMIGRATE (to canon.alerts_std):")
    for view in report["recommendations"]["migrate"]:
        print(f"  - {view}")

    print("\nREMOVE CANDIDATES:")
    for view in report["recommendations"]["remove_candidates"]:
        print(f"  - {view}")

    print("\n" + "=" * 80)


def main():
    parser = argparse.ArgumentParser(description="Analyze view usage in codebase and database")
    parser.add_argument("--db-path", default="data/alerts.duckdb", help="Path to DuckDB database")
    parser.add_argument("--output", help="Output JSON report to file")
    parser.add_argument("--json", action="store_true", help="Output as JSON only")

    args = parser.parse_args()

    # Analyze
    report = analyze_view_usage(args.db_path)

    # Output
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_report(report)

    if args.output:
        with open(args.output, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nReport saved to: {args.output}")


if __name__ == "__main__":
    main()

