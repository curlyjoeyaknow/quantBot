#!/usr/bin/env python3
"""
DuckDB Data Helper Script

Python script called by TypeScript PythonEngine to provide safe DuckDB queries.
This script wraps tools/shared/duckdb_data_helper.py for use via subprocess.

Usage:
    python tools/storage/duckdb_data_helper.py --operation query_alerts --db-path data/alerts.duckdb --filters '{"caller_name": "brook", "limit": 100}'
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add workspace root to path for imports
workspace_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(workspace_root))

from tools.shared.duckdb_data_helper import (
    DEFAULT_DB_PATH,
    query_alerts,
    query_callers,
    validate_view_name,
    get_view_schema,
    get_database_info,
    get_readonly_connection,
)


def main():
    parser = argparse.ArgumentParser(description="DuckDB Data Helper")
    parser.add_argument("--operation", required=True, help="Operation to perform")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help="Path to DuckDB database")
    parser.add_argument("--filters", help="JSON filters for query operations")
    parser.add_argument("--view-name", help="View name for validation/schema operations")
    parser.add_argument("--schema", default="canon", help="Schema name (default: canon)")

    args = parser.parse_args()

    try:
        if args.operation == "query_alerts":
            filters = json.loads(args.filters) if args.filters else {}
            limit = filters.pop("limit", 1000)

            with get_readonly_connection(args.db_path) as con:
                alerts = query_alerts(con, filters, limit)
                result = {"success": True, "alerts": alerts}

        elif args.operation == "query_callers":
            filters = json.loads(args.filters) if args.filters else {}

            with get_readonly_connection(args.db_path) as con:
                callers = query_callers(con, filters)
                result = {"success": True, "callers": callers}

        elif args.operation == "validate_view":
            if not args.view_name:
                raise ValueError("--view-name is required for validate_view operation")

            is_valid, error_msg = validate_view_name(args.view_name, args.schema)
            result = {"success": is_valid, "error": error_msg}

        elif args.operation == "get_view_schema":
            if not args.view_name:
                raise ValueError("--view-name is required for get_view_schema operation")

            with get_readonly_connection(args.db_path) as con:
                schema = get_view_schema(con, args.view_name, args.schema)
                result = {"success": True, "schema": schema}

        elif args.operation == "get_database_info":
            with get_readonly_connection(args.db_path) as con:
                info = get_database_info(con)
                result = {"success": True, "info": info}

        else:
            raise ValueError(f"Unknown operation: {args.operation}")

        # Output JSON result
        print(json.dumps(result, default=str))

    except Exception as e:
        error_result = {"success": False, "error": str(e)}
        print(json.dumps(error_result, default=str))
        sys.exit(1)


if __name__ == "__main__":
    main()

