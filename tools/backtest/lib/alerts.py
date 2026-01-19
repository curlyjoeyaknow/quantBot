"""
Alert loading from DuckDB.

Supports multiple schema variants:
- caller_links_d (primary)
- user_calls_d (fallback)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

import duckdb

UTC = timezone.utc


@dataclass(frozen=True)
class Alert:
    """An alert representing a token call at a specific time."""

    mint: str
    ts_ms: int
    caller: str
    mcap_usd: Optional[float] = None  # Market cap in USD at alert time (if available)

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

    Tries canon.alerts_final first, falls back to caller_links_d, then user_calls_d.
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

        alerts: List[Alert] = []

        # Try canon.alerts_final first
        has_canon_alerts_final = False
        try:
            conn.execute("SELECT 1 FROM canon.alerts_final LIMIT 1").fetchone()
            has_canon_alerts_final = True
        except Exception:
            pass

        if has_canon_alerts_final:
            alerts = _load_from_canon_alerts_final(conn, chain, from_ms, to_ms_excl)

        # Fallback to caller_links_d if no alerts from canon
        if not alerts:
            has_caller_links = _table_exists(conn, "caller_links_d")
            if has_caller_links:
                alerts = _load_from_caller_links(conn, chain, from_ms, to_ms_excl, False)

        # Fallback to user_calls_d if still no alerts
        if not alerts:
            has_user_calls = _table_exists(conn, "user_calls_d")
            if has_user_calls:
                alerts = _load_from_user_calls(conn, chain, from_ms, to_ms_excl, False)

        if not alerts:
            raise SystemExit(f"No alerts found in DuckDB: {duckdb_path}")

        alerts.sort(key=lambda a: (a.ts_ms, a.mint))
        return alerts


def _load_from_canon_alerts_final(
    conn: duckdb.DuckDBPyConnection,
    chain: str,
    from_ms: int,
    to_ms_excl: int,
) -> List[Alert]:
    """Load alerts from canon.alerts_final table."""
    # Check if caller_links_d exists to get mcap_usd
    has_caller_links = _table_exists(conn, "caller_links_d")
    
    if has_caller_links:
        # Join with caller_links_d to get mcap_usd if available
        sql = """
        SELECT DISTINCT
          a.mint::TEXT AS mint,
          a.alert_ts_ms::BIGINT AS ts_ms,
          COALESCE(a.caller_name, '')::TEXT AS caller,
          c.mcap_usd::DOUBLE AS mcap_usd
        FROM canon.alerts_final a
        LEFT JOIN caller_links_d c
          ON c.mint = a.mint
          AND c.trigger_ts_ms = a.alert_ts_ms
        WHERE a.mint IS NOT NULL
          AND a.alert_ts_ms >= ?
          AND a.alert_ts_ms < ?
          AND lower(a.chain) = lower(?)
        """
        params: List[Any] = [from_ms, to_ms_excl, chain]
    else:
        # No caller_links_d, just load from canon.alerts_final
        sql = """
        SELECT DISTINCT
          mint::TEXT AS mint,
          alert_ts_ms::BIGINT AS ts_ms,
          COALESCE(caller_name, '')::TEXT AS caller,
          NULL::DOUBLE AS mcap_usd
        FROM canon.alerts_final
        WHERE mint IS NOT NULL
          AND alert_ts_ms >= ?
          AND alert_ts_ms < ?
          AND lower(chain) = lower(?)
        """
        params: List[Any] = [from_ms, to_ms_excl, chain]

    alerts = []
    for row in conn.execute(sql, params).fetchall():
        mint, ts_ms, caller, mcap_usd = row
        if mint:
            alerts.append(Alert(
                mint=mint,
                ts_ms=int(ts_ms),
                caller=(caller or "").strip(),
                mcap_usd=float(mcap_usd) if mcap_usd is not None else None
            ))

    return alerts


def _load_from_caller_links(
    conn: duckdb.DuckDBPyConnection,
    chain: str,
    from_ms: int,
    to_ms_excl: int,
    has_canon_alerts_final: bool = False,
) -> List[Alert]:
    """Load alerts from caller_links_d table, optionally joining with canon.alerts_final for market cap."""
    cols = _get_table_columns(conn, "caller_links_d")
    has_chain = "chain" in cols
    caller_expr = _build_caller_expr(cols)

    # Try to join with canon.alerts_final for market cap if available
    if has_canon_alerts_final:
        # Build caller expression with table prefix for join
        # Remove "AS caller" from the original expression since we'll add it in SQL
        caller_expr_no_alias = caller_expr.replace(" AS caller", "").replace("::TEXT AS caller", "::TEXT")
        caller_expr_with_prefix = caller_expr_no_alias.replace("caller_name", "c.caller_name").replace("trigger_from_name", "c.trigger_from_name")
        
        sql = f"""
        SELECT DISTINCT
          c.mint::TEXT AS mint,
          c.trigger_ts_ms::BIGINT AS ts_ms,
          {caller_expr_with_prefix} AS caller,
          a.mcap_usd::DOUBLE AS mcap_usd
        FROM caller_links_d c
        LEFT JOIN canon.alerts_final a
          ON a.mint = c.mint
          AND a.alert_ts_ms = c.trigger_ts_ms
        WHERE c.mint IS NOT NULL
          AND c.trigger_ts_ms >= ?
          AND c.trigger_ts_ms <  ?
        """
    else:
        sql = f"""
        SELECT DISTINCT
          mint::TEXT AS mint,
          trigger_ts_ms::BIGINT AS ts_ms,
          {caller_expr},
          NULL::DOUBLE AS mcap_usd
        FROM caller_links_d
        WHERE mint IS NOT NULL
          AND trigger_ts_ms >= ?
          AND trigger_ts_ms <  ?
        """
    
    params: List[Any] = [from_ms, to_ms_excl]

    if has_chain:
        sql += " AND lower(c.chain) = lower(?)" if has_canon_alerts_final else " AND lower(chain) = lower(?)"
        params.append(chain)

    alerts = []
    for row in conn.execute(sql, params).fetchall():
        if has_canon_alerts_final:
            mint, ts_ms, caller, mcap_usd = row
        else:
            mint, ts_ms, caller, mcap_usd = row
        if mint:
            alerts.append(Alert(
                mint=mint,
                ts_ms=int(ts_ms),
                caller=(caller or "").strip(),
                mcap_usd=float(mcap_usd) if mcap_usd is not None else None
            ))

    return alerts


def _load_from_user_calls(
    conn: duckdb.DuckDBPyConnection,
    chain: str,
    from_ms: int,
    to_ms_excl: int,
    has_canon_alerts_final: bool = False,
) -> List[Alert]:
    """Load alerts from user_calls_d table, optionally joining with canon.alerts_final for market cap."""
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

    # Try to join with canon.alerts_final for market cap if available
    if has_canon_alerts_final:
        sql = f"""
        SELECT DISTINCT
          u.mint::TEXT AS mint,
          u.{ts_col}::BIGINT AS ts_ms,
          {caller_expr.replace('COALESCE(caller_name', 'COALESCE(u.caller_name').replace('trigger_from_name', 'u.trigger_from_name')},
          a.mcap_usd::DOUBLE AS mcap_usd
        FROM user_calls_d u
        LEFT JOIN canon.alerts_final a
          ON a.mint = u.mint
          AND a.alert_ts_ms = u.{ts_col}
        WHERE u.mint IS NOT NULL
          AND u.{ts_col} >= ?
          AND u.{ts_col} <  ?
        """
    else:
        sql = f"""
        SELECT DISTINCT
          mint::TEXT AS mint,
          {ts_col}::BIGINT AS ts_ms,
          {caller_expr},
          NULL::DOUBLE AS mcap_usd
        FROM user_calls_d
        WHERE mint IS NOT NULL
          AND {ts_col} >= ?
          AND {ts_col} <  ?
        """
    
    params: List[Any] = [from_ms, to_ms_excl]

    if has_chain:
        sql += " AND lower(u.chain) = lower(?)" if has_canon_alerts_final else " AND lower(chain) = lower(?)"
        params.append(chain)

    alerts = []
    for row in conn.execute(sql, params).fetchall():
        mint, ts_ms, caller, mcap_usd = row
        if mint:
            alerts.append(Alert(
                mint=mint,
                ts_ms=int(ts_ms),
                caller=(caller or "").strip(),
                mcap_usd=float(mcap_usd) if mcap_usd is not None else None
            ))

    return alerts
