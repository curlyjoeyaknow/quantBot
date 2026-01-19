"""
DuckDB Data Helper

Provides a safe, documented interface for querying data/alerts.duckdb.
Prevents agents from querying wrong tables/views and provides helpful error messages.

This module follows the codebase architecture:
- Python for heavy data lifting
- Type-safe query functions
- Schema validation
- Helpful error messages

Usage:
    from tools.shared.duckdb_data_helper import (
        query_alerts,
        query_callers,
        validate_view_name,
        get_view_schema,
        CANON_VIEWS,
        DEFAULT_DB_PATH,
    )

    # Query alerts with filters
    with get_readonly_connection(DEFAULT_DB_PATH) as con:
        alerts = query_alerts(con, {
            'caller_name': 'brook',
            'from_ts_ms': 1609459200000,
            'to_ts_ms': 1640995200000,
            'limit': 100,
        })
"""

from __future__ import annotations

import sys
from typing import Dict, List, Optional, Any
from datetime import datetime

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

from tools.shared.duckdb_adapter import get_readonly_connection

# =============================================================================
# Constants
# =============================================================================

# Default database path
DEFAULT_DB_PATH = "data/alerts.duckdb"

# Canonical schema views - these are the ONLY views agents should use
CANON_VIEWS = {
    "alerts_std": {
        "description": "Primary canonical alert view - one row per alert, stable columns forever",
        "columns": [
            "alert_id",
            "alert_chat_id",
            "alert_message_id",
            "alert_ts_ms",
            "alert_kind",
            "mint",
            "chain",
            "mint_source",
            "caller_raw_name",
            "caller_id",
            "caller_name_norm",
            "caller_base",
            "alert_text",
            "run_id",
            "ingested_at",
        ],
        "primary": True,
    },
    "callers_d": {
        "description": "Caller lookup table - maps caller names to caller IDs",
        "columns": ["caller_id", "caller_raw_name", "caller_name_norm", "caller_base"],
        "primary": False,
    },
    "bot_cards": {
        "description": "Bot response cards - bot replies to alerts",
        "columns": ["chat_id", "message_id", "ts_ms", "bot_name", "bot_text", "reply_to_message_id"],
        "primary": False,
    },
    "messages": {
        "description": "Raw messages view - original Telegram messages",
        "columns": ["chat_id", "message_id", "ts_ms", "from_name", "text", "reply_to_message_id"],
        "primary": False,
    },
}

# Deprecated views and their replacements
DEPRECATED_VIEWS = {
    "alerts_canon": "canon.alerts_std",
    "alerts_final": "canon.alerts_std",
    "alerts_resolved": "canon.alerts_std",
    "alerts_enriched": "canon.alerts_std",
    "alerts_clean": "canon.alerts_std",
    "alerts_ready": "canon.alerts_std WHERE caller_id IS NOT NULL",
    "alerts_unknown": "canon.alerts_std WHERE caller_id IS NULL",
    "alerts_v": "canon.alerts_std",
    "alerts_analysis": "canon.alerts_std",
    "alerts_canon_filled": "canon.alerts_std",
    "alerts_final_pretty": "canon.alerts_std",
    "alerts_health": "Use SELECT COUNT(*) FROM canon.alerts_std",
    "alerts_health_origin": "Use canon.alerts_std with caller_id checks",
    "alerts_promoted_from_raw": "canon.alerts_std",
    "alerts_universe": "canon.alerts_std",
    "alert_resolved": "canon.alerts_std",
    "alert_resolved_light": "canon.alerts_std",
    "alert_mints": "Data available in canon.alerts_std (mint, chain, mint_source columns)",
    "alert_mints_1": "Data available in canon.alerts_std",
    "alert_mint_best": "Data available in canon.alerts_std",
    "alert_mint_resolved": "Data available in canon.alerts_std",
    "alert_mint_counts": "Use SELECT COUNT(*) FROM canon.alerts_std GROUP BY alert_id",
    "alert_bot_links": "Join canon.alerts_std with canon.bot_cards",
    "alert_bot_links_1": "Join canon.alerts_std with canon.bot_cards",
}

# =============================================================================
# Validation Functions
# =============================================================================


def validate_view_name(view_name: str, schema: str = "canon") -> tuple[bool, Optional[str]]:
    """
    Validate that a view name is allowed.

    Args:
        view_name: Name of the view (without schema prefix)
        schema: Schema name (default: "canon")

    Returns:
        Tuple of (is_valid, error_message)
        - If valid: (True, None)
        - If invalid: (False, helpful error message)
    """
    if schema != "canon":
        return (
            False,
            f"Schema '{schema}' is not allowed. Use 'canon' schema only. "
            f"Available views: {', '.join(CANON_VIEWS.keys())}",
        )

    # Check if deprecated
    if view_name in DEPRECATED_VIEWS:
        replacement = DEPRECATED_VIEWS[view_name]
        return (
            False,
            f"View 'canon.{view_name}' is deprecated. Use: {replacement}\n"
            f"See docs/data/duckdb-schema.md for migration guide.",
        )

    # Check if exists in allowed views
    if view_name not in CANON_VIEWS:
        available = ", ".join(CANON_VIEWS.keys())
        return (
            False,
            f"View 'canon.{view_name}' does not exist or is not allowed.\n"
            f"Available views: {available}\n"
            f"Primary view: canon.alerts_std (use this for alerts/calls)\n"
            f"See docs/data/duckdb-schema.md for schema documentation.",
        )

    return (True, None)


def get_view_schema(con: duckdb.DuckDBPyConnection, view_name: str, schema: str = "canon") -> Dict[str, Any]:
    """
    Get schema information for a view.

    Args:
        con: DuckDB connection
        view_name: Name of the view (without schema prefix)
        schema: Schema name (default: "canon")

    Returns:
        Dictionary with schema information:
        {
            "view_name": str,
            "schema": str,
            "description": str,
            "columns": List[Dict[str, str]],  # [{"name": "col", "type": "BIGINT"}]
            "primary": bool,
        }

    Raises:
        ValueError: If view is not valid or does not exist
    """
    is_valid, error_msg = validate_view_name(view_name, schema)
    if not is_valid:
        raise ValueError(error_msg)

    view_info = CANON_VIEWS[view_name]

    # Get actual column types from database
    try:
        result = con.execute(f'DESCRIBE "{schema}.{view_name}"').fetchall()
        columns = [{"name": row[0], "type": row[1]} for row in result]
    except Exception:
        # Fallback to documented columns if DESCRIBE fails
        columns = [{"name": col, "type": "unknown"} for col in view_info["columns"]]

    return {
        "view_name": view_name,
        "schema": schema,
        "description": view_info["description"],
        "columns": columns,
        "primary": view_info.get("primary", False),
    }


# =============================================================================
# Query Functions
# =============================================================================


def query_alerts(
    con: duckdb.DuckDBPyConnection,
    filters: Optional[Dict[str, Any]] = None,
    limit: int = 1000,
) -> List[Dict[str, Any]]:
    """
    Query alerts from canon.alerts_std view.

    This is the PRIMARY way to query alerts/calls. All other alert views are deprecated.

    Args:
        con: DuckDB connection (use get_readonly_connection)
        filters: Optional filters:
            - caller_name: Filter by caller name (normalized or raw)
            - caller_id: Filter by caller ID
            - mint: Filter by mint address
            - chain: Filter by chain ('solana', 'evm')
            - from_ts_ms: Start timestamp (milliseconds)
            - to_ts_ms: End timestamp (milliseconds)
            - alert_kind: Filter by alert kind ('human', 'bot_only')
            - has_caller_id: Filter by whether caller_id is present (True/False)
        limit: Maximum number of results (default: 1000, max: 10000)

    Returns:
        List of alert dictionaries with all columns from canon.alerts_std

    Example:
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            alerts = query_alerts(con, {
                'caller_name': 'brook',
                'from_ts_ms': 1609459200000,
                'limit': 100,
            })
    """
    if filters is None:
        filters = {}

    if limit > 10000:
        limit = 10000

    # Build query
    query = "SELECT * FROM canon.alerts_std WHERE 1=1"
    params = []

    # Apply filters
    if "caller_name" in filters:
        query += " AND (caller_name_norm = ? OR caller_raw_name = ?)"
        params.extend([filters["caller_name"], filters["caller_name"]])

    if "caller_id" in filters:
        query += " AND caller_id = ?"
        params.append(filters["caller_id"])

    if "mint" in filters:
        query += " AND mint = ?"
        params.append(filters["mint"])

    if "chain" in filters:
        query += " AND chain = ?"
        params.append(filters["chain"])

    if "from_ts_ms" in filters:
        query += " AND alert_ts_ms >= ?"
        params.append(filters["from_ts_ms"])

    if "to_ts_ms" in filters:
        query += " AND alert_ts_ms <= ?"
        params.append(filters["to_ts_ms"])

    if "alert_kind" in filters:
        query += " AND alert_kind = ?"
        params.append(filters["alert_kind"])

    if "has_caller_id" in filters:
        if filters["has_caller_id"]:
            query += " AND caller_id IS NOT NULL"
        else:
            query += " AND caller_id IS NULL"

    # Order and limit
    query += " ORDER BY alert_ts_ms DESC LIMIT ?"
    params.append(limit)

    # Execute query
    try:
        # Get column names from schema
        columns = CANON_VIEWS["alerts_std"]["columns"]
        result = con.execute(query, params).fetchall()

        # Convert to list of dictionaries
        alerts = []
        for row in result:
            alert = {}
            for i, col_name in enumerate(columns):
                if i < len(row):
                    alert[col_name] = row[i]
            alerts.append(alert)

        return alerts
    except Exception as e:
        raise ValueError(f"Failed to query alerts: {str(e)}") from e


def query_callers(
    con: duckdb.DuckDBPyConnection,
    filters: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Query callers from canon.callers_d table.

    Args:
        con: DuckDB connection (use get_readonly_connection)
        filters: Optional filters:
            - caller_id: Filter by caller ID
            - caller_raw_name: Filter by raw caller name
            - caller_name_norm: Filter by normalized caller name
            - caller_base: Filter by caller base

    Returns:
        List of caller dictionaries

    Example:
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            callers = query_callers(con, {'caller_base': 'brook'})
    """
    if filters is None:
        filters = {}

    # Build query
    query = "SELECT * FROM canon.callers_d WHERE 1=1"
    params = []

    # Apply filters
    if "caller_id" in filters:
        query += " AND caller_id = ?"
        params.append(filters["caller_id"])

    if "caller_raw_name" in filters:
        query += " AND caller_raw_name = ?"
        params.append(filters["caller_raw_name"])

    if "caller_name_norm" in filters:
        query += " AND caller_name_norm = ?"
        params.append(filters["caller_name_norm"])

    if "caller_base" in filters:
        query += " AND caller_base = ?"
        params.append(filters["caller_base"])

    # Execute query
    try:
        # Get column names from schema
        columns = CANON_VIEWS["callers_d"]["columns"]
        result = con.execute(query, params).fetchall()

        # Convert to list of dictionaries
        callers = []
        for row in result:
            caller = {}
            for i, col_name in enumerate(columns):
                if i < len(row):
                    caller[col_name] = row[i]
            callers.append(caller)

        return callers
    except Exception as e:
        raise ValueError(f"Failed to query callers: {str(e)}") from e


def get_database_info(con: duckdb.DuckDBPyConnection) -> Dict[str, Any]:
    """
    Get information about the database schema.

    Args:
        con: DuckDB connection

    Returns:
        Dictionary with database information:
        {
            "schemas": List[str],
            "canon_views": List[str],
            "view_count": int,
            "alerts_count": int,
        }
    """
    try:
        # Get schemas
        schemas = con.execute(
            "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog') ORDER BY schema_name"
        ).fetchall()
        schema_names = [s[0] for s in schemas]

        # Get canon views
        canon_views = con.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'canon' AND table_type = 'VIEW' ORDER BY table_name"
        ).fetchall()
        view_names = [v[0] for v in canon_views]

        # Get alerts count
        alerts_count = con.execute("SELECT COUNT(*) FROM canon.alerts_std").fetchone()[0]

        return {
            "schemas": schema_names,
            "canon_views": view_names,
            "view_count": len(view_names),
            "alerts_count": alerts_count,
        }
    except Exception as e:
        raise ValueError(f"Failed to get database info: {str(e)}") from e


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    "DEFAULT_DB_PATH",
    "CANON_VIEWS",
    "DEPRECATED_VIEWS",
    "validate_view_name",
    "get_view_schema",
    "query_alerts",
    "query_callers",
    "get_database_info",
]

