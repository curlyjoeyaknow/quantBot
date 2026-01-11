#!/usr/bin/env python3
"""
Export all alerts as CSV for Dune Analytics.

Output columns:
  - mint_b58 (string): Full mint address, base58 encoded
  - call_time (timestamp): ISO 8601 format
  - caller (string): Caller name/handle
  - alert_id (string, optional): Dedupe ID (mint + ts_ms + caller hash)
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, NamedTuple

import duckdb

UTC = timezone.utc


class AlertRow(NamedTuple):
    """Alert row for export."""
    mint_b58: str
    call_time: str
    caller: str
    alert_id: str


def _table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    """Check if a table exists in DuckDB."""
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
        return "COALESCE(caller_name, trigger_from_name, '')::TEXT"
    elif has_caller_name:
        return "COALESCE(caller_name, '')::TEXT"
    elif has_trigger_from_name:
        return "COALESCE(trigger_from_name, '')::TEXT"
    else:
        return "''::TEXT"


def _make_alert_id(mint: str, ts_ms: int, caller: str) -> str:
    """Create a deterministic dedupe ID from mint + ts + caller."""
    raw = f"{mint}|{ts_ms}|{caller}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _ts_ms_to_iso(ts_ms: int) -> str:
    """Convert milliseconds timestamp to ISO 8601 string."""
    dt = datetime.fromtimestamp(ts_ms / 1000.0, tz=UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def load_all_alerts(duckdb_path: str, chain: str | None = None) -> List[AlertRow]:
    """
    Load all alerts from DuckDB.
    
    Args:
        duckdb_path: Path to DuckDB file
        chain: Optional chain filter (e.g., 'solana')
    
    Returns:
        List of AlertRow objects
    """
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        has_caller_links = _table_exists(conn, "caller_links_d")
        has_user_calls = _table_exists(conn, "user_calls_d")
        
        if not has_caller_links and not has_user_calls:
            print(f"ERROR: No alerts table found in {duckdb_path}", file=sys.stderr)
            print("Expected: caller_links_d or user_calls_d", file=sys.stderr)
            sys.exit(1)
        
        alerts: List[AlertRow] = []
        
        # Load from caller_links_d (primary)
        if has_caller_links:
            alerts = _load_from_caller_links(conn, chain)
            print(f"Loaded {len(alerts)} alerts from caller_links_d", file=sys.stderr)
        
        # Fallback to user_calls_d if no alerts
        if not alerts and has_user_calls:
            alerts = _load_from_user_calls(conn, chain)
            print(f"Loaded {len(alerts)} alerts from user_calls_d", file=sys.stderr)
        
        # Sort by call_time, mint
        alerts.sort(key=lambda a: (a.call_time, a.mint_b58))
        return alerts
        
    finally:
        conn.close()


def _load_from_caller_links(
    conn: duckdb.DuckDBPyConnection,
    chain: str | None,
) -> List[AlertRow]:
    """Load alerts from caller_links_d table."""
    cols = _get_table_columns(conn, "caller_links_d")
    has_chain = "chain" in cols
    caller_expr = _build_caller_expr(cols)
    
    sql = f"""
    SELECT DISTINCT
      mint::TEXT AS mint,
      trigger_ts_ms::BIGINT AS ts_ms,
      {caller_expr} AS caller
    FROM caller_links_d
    WHERE mint IS NOT NULL
      AND mint != ''
      AND trigger_ts_ms IS NOT NULL
    """
    params: List[Any] = []
    
    if chain and has_chain:
        sql += " AND lower(chain) = lower(?)"
        params.append(chain)
    
    sql += " ORDER BY trigger_ts_ms, mint"
    
    alerts = []
    for mint, ts_ms, caller in conn.execute(sql, params).fetchall():
        if mint and ts_ms:
            caller = (caller or "").strip()
            alerts.append(AlertRow(
                mint_b58=mint,
                call_time=_ts_ms_to_iso(int(ts_ms)),
                caller=caller,
                alert_id=_make_alert_id(mint, int(ts_ms), caller),
            ))
    
    return alerts


def _load_from_user_calls(
    conn: duckdb.DuckDBPyConnection,
    chain: str | None,
) -> List[AlertRow]:
    """Load alerts from user_calls_d table."""
    cols = _get_table_columns(conn, "user_calls_d")
    has_chain = "chain" in cols
    caller_expr = _build_caller_expr(cols)
    
    # Find timestamp column
    if "call_ts_ms" in cols:
        ts_col = "call_ts_ms"
    elif "trigger_ts_ms" in cols:
        ts_col = "trigger_ts_ms"
    else:
        print(f"ERROR: No timestamp column found in user_calls_d: {cols}", file=sys.stderr)
        sys.exit(1)
    
    sql = f"""
    SELECT DISTINCT
      mint::TEXT AS mint,
      {ts_col}::BIGINT AS ts_ms,
      {caller_expr} AS caller
    FROM user_calls_d
    WHERE mint IS NOT NULL
      AND mint != ''
      AND {ts_col} IS NOT NULL
    """
    params: List[Any] = []
    
    if chain and has_chain:
        sql += " AND lower(chain) = lower(?)"
        params.append(chain)
    
    sql += f" ORDER BY {ts_col}, mint"
    
    alerts = []
    for mint, ts_ms, caller in conn.execute(sql, params).fetchall():
        if mint and ts_ms:
            caller = (caller or "").strip()
            alerts.append(AlertRow(
                mint_b58=mint,
                call_time=_ts_ms_to_iso(int(ts_ms)),
                caller=caller,
                alert_id=_make_alert_id(mint, int(ts_ms), caller),
            ))
    
    return alerts


def export_to_csv(alerts: List[AlertRow], output_path: str, include_id: bool = True) -> None:
    """
    Export alerts to CSV file.
    
    Args:
        alerts: List of AlertRow objects
        output_path: Path to output CSV file
        include_id: Whether to include alert_id column
    """
    fieldnames = ["mint_b58", "call_time", "caller"]
    if include_id:
        fieldnames.append("alert_id")
    
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        
        for alert in alerts:
            row = {
                "mint_b58": alert.mint_b58,
                "call_time": alert.call_time,
                "caller": alert.caller,
            }
            if include_id:
                row["alert_id"] = alert.alert_id
            writer.writerow(row)
    
    print(f"Exported {len(alerts)} alerts to {output_path}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export all alerts as CSV for Dune Analytics",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Output columns:
  mint_b58    Full mint address (base58)
  call_time   ISO 8601 timestamp (e.g., 2024-05-15T14:30:00.000Z)
  caller      Caller name/handle
  alert_id    Dedupe ID (optional, hash of mint+ts+caller)

Examples:
  %(prog)s --output alerts_dune.csv
  %(prog)s --duckdb data/alerts.duckdb --output alerts_dune.csv
  %(prog)s --chain solana --no-id --output alerts_dune.csv
        """,
    )
    parser.add_argument(
        "--duckdb",
        default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"),
        help="Path to DuckDB file (default: data/alerts.duckdb or DUCKDB_PATH env)",
    )
    parser.add_argument(
        "--chain",
        default=None,
        help="Filter by chain (e.g., solana). Default: all chains",
    )
    parser.add_argument(
        "--output", "-o",
        default="alerts_dune.csv",
        help="Output CSV file path (default: alerts_dune.csv)",
    )
    parser.add_argument(
        "--no-id",
        action="store_true",
        help="Exclude alert_id column from output",
    )
    
    args = parser.parse_args()
    
    # Validate DuckDB path
    if not Path(args.duckdb).exists():
        print(f"ERROR: DuckDB file not found: {args.duckdb}", file=sys.stderr)
        sys.exit(1)
    
    print(f"Loading alerts from {args.duckdb}...", file=sys.stderr)
    alerts = load_all_alerts(args.duckdb, args.chain)
    
    if not alerts:
        print("WARNING: No alerts found!", file=sys.stderr)
    else:
        # Show summary
        callers = set(a.caller for a in alerts if a.caller)
        mints = set(a.mint_b58 for a in alerts)
        print(f"Summary: {len(alerts)} alerts, {len(mints)} unique tokens, {len(callers)} unique callers", file=sys.stderr)
    
    export_to_csv(alerts, args.output, include_id=not args.no_id)
    print("Done!", file=sys.stderr)


if __name__ == "__main__":
    main()

