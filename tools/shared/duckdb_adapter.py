"""
DuckDB Adapter (Python tools layer)

Role in repo architecture
------------------------
This module is a **low-level adapter utility** for Python tooling.

- `packages/*` (TypeScript) follows a strict ports/adapters architecture.
- `tools/*` (Python) are **apps** (CLI scripts) invoked by TypeScript via `PythonEngine`.
- `tools/shared/*` contains **shared Python library code** used by those apps.

This file intentionally lives in `tools/shared/` because:
- It is not a TypeScript package, and it is not part of the TS ports/adapters tree.
- It is shared, reusable infrastructure for Python tool "apps".
- It should remain dependency-light and side-effect free at import time.

Design constraints
------------------
- No CLI / argparse here (keep it a library).
- No imports from `tools/storage/*` (app layer must depend on shared libs, not vice versa).
- Keep connection setup explicit and configurable (paths, read-only, pragmas).
- Prefer typed, small surface-area functions/classes so TS-called scripts stay stable.

Typical usage
-------------
Python "apps" in `tools/storage/*.py` import this module to open DuckDB connections,
run queries, and return results back to TypeScript `PythonEngine`.

If this grows substantially, consider promoting to a proper Python package under a
dedicated `packages/python/` directory. For now, `tools/shared/` is the right layer.

Usage:
    from tools.shared.duckdb_adapter import get_readonly_connection, get_write_connection

    # Read-only access (default, safe for concurrent access)
    with get_readonly_connection("data/alerts.duckdb") as con:
        result = con.execute("SELECT * FROM table").fetchall()

    # Write access (use sparingly, only at end of runs)
    with get_write_connection("data/alerts.duckdb") as con:
        con.execute("INSERT INTO table VALUES (...)")

Design:
    - READ-ONLY by default to prevent lock conflicts
    - Write connections require explicit opt-in via get_write_connection()
    - Context managers ensure connections are properly closed
    - Handles empty/invalid files safely
    - No hidden globals or singleton connections
"""

from __future__ import annotations

import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, Optional

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)


# =============================================================================
# Core Connection Functions
# =============================================================================

@contextmanager
def get_connection(
    db_path: str,
    read_only: bool = False,
) -> Generator[duckdb.DuckDBPyConnection, None, None]:
    """
    Get a DuckDB connection with explicit read/write mode.

    This is the base function - prefer get_readonly_connection() for reads.

    Args:
        db_path: Path to DuckDB file, or ":memory:" for in-memory DB
        read_only: If True, open in read-only mode (prevents locks)

    Yields:
        DuckDB connection (automatically closed on exit)

    Example:
        with get_connection("data/db.duckdb") as con:
            con.execute("INSERT INTO table VALUES (?)", [value])
    """
    # In-memory databases can't be read-only
    if db_path == ":memory:":
        con = duckdb.connect(db_path)
    else:
        # Handle empty/invalid files for writable connections
        if not read_only:
            db_file = Path(db_path)
            if db_file.exists():
                if db_file.stat().st_size == 0:
                    db_file.unlink()  # Delete empty file
                else:
                    # Validate file is a valid DuckDB database
                    try:
                        test_con = duckdb.connect(db_path, read_only=True)
                        test_con.close()
                    except Exception:
                        db_file.unlink()  # Delete invalid file

        con = duckdb.connect(db_path, read_only=read_only)

    try:
        yield con
    finally:
        con.close()


@contextmanager
def get_readonly_connection(
    db_path: str,
) -> Generator[duckdb.DuckDBPyConnection, None, None]:
    """
    Get a READ-ONLY DuckDB connection.

    This is the preferred function for all read operations.
    Read-only connections can run concurrently without blocking writers.

    Args:
        db_path: Path to DuckDB file

    Yields:
        Read-only DuckDB connection

    Example:
        with get_readonly_connection("data/db.duckdb") as con:
            rows = con.execute("SELECT * FROM table").fetchall()
    """
    with get_connection(db_path, read_only=True) as con:
        yield con


@contextmanager
def get_write_connection(
    db_path: str,
) -> Generator[duckdb.DuckDBPyConnection, None, None]:
    """
    Get a WRITABLE DuckDB connection.

    Use this only when you need to write data.
    Only ONE writer can access DuckDB at a time.

    For bulk operations or when you expect lock contention,
    consider using the write queue instead.

    Args:
        db_path: Path to DuckDB file

    Yields:
        Writable DuckDB connection

    Example:
        with get_write_connection("data/db.duckdb") as con:
            con.execute("INSERT INTO table VALUES (?)", [value])
    """
    with get_connection(db_path, read_only=False) as con:
        yield con


# =============================================================================
# Legacy Compatibility Functions
# =============================================================================

def safe_connect(db_path: str, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """
    Legacy function for backwards compatibility.

    DEPRECATED: Use get_connection() context manager instead.

    This function returns a raw connection that MUST be manually closed.
    Prefer the context manager version to ensure cleanup.
    """
    if db_path == ":memory:":
        return duckdb.connect(db_path)

    # Handle empty/invalid files for writable connections
    if not read_only:
        db_file = Path(db_path)
        if db_file.exists():
            if db_file.stat().st_size == 0:
                db_file.unlink()
            else:
                try:
                    test_con = duckdb.connect(db_path, read_only=True)
                    test_con.close()
                except Exception:
                    db_file.unlink()

    return duckdb.connect(db_path, read_only=read_only)


# =============================================================================
# Utility Functions
# =============================================================================

def is_lock_error(e: Exception) -> bool:
    """Check if an exception is a DuckDB lock error."""
    msg = str(e).lower()
    return "lock" in msg or "conflicting" in msg or "could not set lock" in msg


def query(db_path: str, sql: str, params: Optional[list] = None) -> list:
    """
    Execute a read-only query and return all results.

    Convenience function for quick one-off queries.

    Args:
        db_path: Path to DuckDB file
        sql: SQL query to execute
        params: Optional query parameters

    Returns:
        List of result rows
    """
    with get_readonly_connection(db_path) as con:
        if params:
            return con.execute(sql, params).fetchall()
        return con.execute(sql).fetchall()


def execute(db_path: str, sql: str, params: Optional[list] = None) -> None:
    """
    Execute a write query.

    Convenience function for quick one-off writes.

    Args:
        db_path: Path to DuckDB file
        sql: SQL query to execute
        params: Optional query parameters
    """
    with get_write_connection(db_path) as con:
        if params:
            con.execute(sql, params)
        else:
            con.execute(sql)


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Core (preferred)
    "get_connection",
    "get_readonly_connection",
    "get_write_connection",
    # Legacy compatibility
    "safe_connect",
    # Utilities
    "is_lock_error",
    "query",
    "execute",
]

