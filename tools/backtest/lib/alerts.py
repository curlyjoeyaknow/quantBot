"""
Alert loading from DuckDB.

Supports multiple schema variants:
- caller_links_d (primary)
- user_calls_d (fallback)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, List

import duckdb

UTC = timezone.utc


@dataclass(frozen=True)
class Alert:
    """An alert representing a token call at a specific time."""

    mint: str
    ts_ms: int
    caller: str

    @property
    def ts(self) -> datetime:
        """Alert timestamp as datetime."""
        return datetime.fromtimestamp(self.ts_ms / 1000.0, tz=UTC)


def _table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    """Check if a table exists in the DuckDB database."""
    q = """
    SELECT COUNT(*)::INT
    FROM information_schema.tables
    WHERE table_name = ?
    """
    result = conn.execute(q, [table_name]).fetchone()
    return result[0] > 0 if result else False


def _get_table_columns(conn: duckdb.DuckDBPyConnection, table_name: str) -> List[str]:
    """Get lowercase column names for a table."""
    rows = conn.execute(f"PRAGMA table_info('{table_name}')").fetchall()
    return [r[1].lower() for r in rows]


def _build_caller_expr(cols: List[str]) -> str:
    """Build SQL expression for caller column based on available columns."""
    has_caller_name = "caller_name" in cols
    has_trigger_from_name = "trigger_from_name" in cols

    if has_caller_name and has_trigger_from_name:
        return "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller"
    elif has_caller_name:
        return "COALESCE(caller_name, '')::TEXT AS caller"
    elif has_trigger_from_name:
        return "COALESCE(trigger_from_name, '')::TEXT AS caller"
    else:
        return "''::TEXT AS caller"


def load_alerts(
    duckdb_path: str,
    chain: str,
    date_from: datetime,
    date_to: datetime,
) -> List[Alert]:
    """
    Load alerts from DuckDB for a date range.

    Tries caller_links_d first, falls back to user_calls_d.
    Date range is inclusive of date_from, exclusive of date_to + 1 day.

    Args:
        duckdb_path: Path to DuckDB file
        chain: Chain name (e.g., 'solana')
        date_from: Start date (inclusive)
        date_to: End date (inclusive, converted to exclusive internally)

    Returns:
        List of Alert objects sorted by (ts_ms, mint)
    """
    from tools.shared.duckdb_adapter import get_readonly_connection
    with get_readonly_connection(duckdb_path) as conn:
        from_ms = int(date_from.timestamp() * 1000)
        to_ms_excl = int((date_to + timedelta(days=1)).timestamp() * 1000)

        has_caller_links = _table_exists(conn, "caller_links_d")
        has_user_calls = _table_exists(conn, "user_calls_d")

        if not has_caller_links and not has_user_calls:
            raise SystemExit(f"No alerts source found in DuckDB: {duckdb_path}")

        alerts: List[Alert] = []

        # Try caller_links_d first
        if has_caller_links:
            alerts = _load_from_caller_links(conn, chain, from_ms, to_ms_excl)

        # Fallback to user_calls_d if no alerts from caller_links_d
        if not alerts and has_user_calls:
            alerts = _load_from_user_calls(conn, chain, from_ms, to_ms_excl)

        alerts.sort(key=lambda a: (a.ts_ms, a.mint))
        return alerts


def _load_from_caller_links(
    conn: duckdb.DuckDBPyConnection,
    chain: str,
    from_ms: int,
    to_ms_excl: int,
) -> List[Alert]:
    """Load alerts from caller_links_d table."""
    cols = _get_table_columns(conn, "caller_links_d")
    has_chain = "chain" in cols
    caller_expr = _build_caller_expr(cols)

    sql = f"""
    SELECT DISTINCT
      mint::TEXT AS mint,
      trigger_ts_ms::BIGINT AS ts_ms,
      {caller_expr}
    FROM caller_links_d
    WHERE mint IS NOT NULL
      AND trigger_ts_ms >= ?
      AND trigger_ts_ms <  ?
    """
    params: List[Any] = [from_ms, to_ms_excl]

    if has_chain:
        sql += " AND lower(chain) = lower(?)"
        params.append(chain)

    alerts = []
    for mint, ts_ms, caller in conn.execute(sql, params).fetchall():
        if mint:
            alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=(caller or "").strip()))

    return alerts


def _load_from_user_calls(
    conn: duckdb.DuckDBPyConnection,
    chain: str,
    from_ms: int,
    to_ms_excl: int,
) -> List[Alert]:
    """Load alerts from user_calls_d table."""
    cols = _get_table_columns(conn, "user_calls_d")
    has_chain = "chain" in cols

    # Find timestamp column
    if "call_ts_ms" in cols:
        ts_col = "call_ts_ms"
    elif "trigger_ts_ms" in cols:
        ts_col = "trigger_ts_ms"
    else:
        raise SystemExit(f"No timestamp column found in user_calls_d: {cols}")

    caller_expr = _build_caller_expr(cols)

    sql = f"""
    SELECT DISTINCT
      mint::TEXT AS mint,
      {ts_col}::BIGINT AS ts_ms,
      {caller_expr}
    FROM user_calls_d
    WHERE mint IS NOT NULL
      AND {ts_col} >= ?
      AND {ts_col} <  ?
    """
    params: List[Any] = [from_ms, to_ms_excl]

    if has_chain:
        sql += " AND lower(chain) = lower(?)"
        params.append(chain)

    alerts = []
    for mint, ts_ms, caller in conn.execute(sql, params).fetchall():
        if mint:
            alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=(caller or "").strip()))

    return alerts

