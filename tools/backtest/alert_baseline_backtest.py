#!/usr/bin/env python3
"""
Baseline per-alert backtest: ATH multiples, drawdowns, time-to-2x, simple TP/SL.

Architecture:
1. Load alerts from DuckDB
2. Query ClickHouse ONCE for coverage stats (which tokens have sufficient candles)
3. Filter alerts to only those with coverage
4. Export candle slice to Parquet (materialized, reproducible)
5. Run backtest from Parquet via DuckDB (offline, no ClickHouse during hot path)

Usage:
  # Console output (default)
  python alert_baseline_backtest.py --from 2025-05-01 --to 2025-05-31

  # JSON output for CLI integration
  python alert_baseline_backtest.py --from 2025-05-01 --to 2025-05-31 --output-format json

  # Skip slice export if already exists
  python alert_baseline_backtest.py --from 2025-05-01 --to 2025-05-31 --reuse-slice
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import hashlib
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any, Dict, List, Optional, Set, Tuple
from threading import Lock

import duckdb

try:
    from clickhouse_driver import Client as ClickHouseClient  # type: ignore[import-untyped]
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)

# Rich TUI (optional, graceful fallback)
try:
    from rich.console import Console, Group
    from rich.live import Live
    from rich.panel import Panel
    from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
    from rich.table import Table
    from rich.text import Text
    from rich.layout import Layout
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False


# -----------------------------
# Helpers
# -----------------------------

UTC = timezone.utc


def parse_yyyy_mm_dd(s: str) -> datetime:
    """Parse date string (inclusive lower bound in UTC at 00:00)"""
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)


def dt_to_ch(dt: datetime) -> str:
    """Format datetime for ClickHouse (YYYY-MM-DD HH:MM:SS)"""
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


def ceil_to_interval(dt: datetime, interval_seconds: int) -> datetime:
    """Ceil datetime to next interval boundary"""
    ts = dt.timestamp()
    q = int(math.ceil(ts / interval_seconds) * interval_seconds)
    return datetime.fromtimestamp(q, tz=UTC)


def pct(x: float) -> float:
    """Convert ratio to percentage"""
    return 100.0 * x


def safe_sql_string(s: str) -> str:
    """Escape single quotes for SQL"""
    return s.replace("'", "''")


@dataclass(frozen=True)
class Alert:
    mint: str
    ts_ms: int
    caller: str

    @property
    def ts(self) -> datetime:
        return datetime.fromtimestamp(self.ts_ms / 1000.0, tz=UTC)


@dataclass
class Candle:
    ts: datetime
    o: float
    h: float
    l: float
    c: float
    v: float


# -----------------------------
# DuckDB: read alerts
# -----------------------------


def duckdb_table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    q = """
    SELECT COUNT(*)::INT
    FROM information_schema.tables
    WHERE table_name = ?
    """
    return conn.execute(q, [table_name]).fetchone()[0] > 0


def load_alerts(
    duckdb_path: str, chain: str, date_from: datetime, date_to: datetime
) -> List[Alert]:
    """
    Pull alerts from caller_links_d or user_calls_d.
    Dynamically detects schema columns.
    """
    conn = duckdb.connect(duckdb_path, read_only=True)

    from_ms = int(date_from.timestamp() * 1000)
    end_excl = date_to + timedelta(days=1)
    to_ms_excl = int(end_excl.timestamp() * 1000)

    has_caller_links = duckdb_table_exists(conn, "caller_links_d")
    has_user_calls = duckdb_table_exists(conn, "user_calls_d")

    if not has_caller_links and not has_user_calls:
        raise SystemExit(
            f"No alerts source found in DuckDB: {duckdb_path}\n"
            "Expected caller_links_d or user_calls_d."
        )

    alerts: List[Alert] = []

    if has_caller_links:
        cols = [
            r[1].lower()
            for r in conn.execute("PRAGMA table_info('caller_links_d')").fetchall()
        ]
        has_chain = "chain" in cols
        has_trigger_from_name = "trigger_from_name" in cols
        has_caller_name = "caller_name" in cols

        if has_trigger_from_name:
            caller_expr = "COALESCE(trigger_from_name, '')::TEXT AS caller"
        elif has_caller_name:
            caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
        else:
            caller_expr = "''::TEXT AS caller"

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

        rows = conn.execute(sql, params).fetchall()
        for mint, ts_ms, caller in rows:
            if mint:
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=caller or ""))

    if (not alerts) and has_user_calls:
        cols = [
            r[1].lower()
            for r in conn.execute("PRAGMA table_info('user_calls_d')").fetchall()
        ]
        has_chain = "chain" in cols
        has_caller_name = "caller_name" in cols
        has_trigger_from_name = "trigger_from_name" in cols
        has_call_ts_ms = "call_ts_ms" in cols
        has_trigger_ts_ms = "trigger_ts_ms" in cols
        ts_col = (
            "call_ts_ms"
            if has_call_ts_ms
            else "trigger_ts_ms" if has_trigger_ts_ms else None
        )

        if ts_col is None:
            raise SystemExit(f"No timestamp column found in user_calls_d: {cols}")

        if has_caller_name:
            caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
        elif has_trigger_from_name:
            caller_expr = "COALESCE(trigger_from_name, '')::TEXT AS caller"
        else:
            caller_expr = "''::TEXT AS caller"

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
        params = [from_ms, to_ms_excl]
        if has_chain:
            sql += " AND lower(chain) = lower(?)"
            params.append(chain)

        rows = conn.execute(sql, params).fetchall()
        for mint, ts_ms, caller in rows:
            if mint:
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=caller or ""))

    # Fallback: try core.alert_mints_f + core.alerts_d (new schema)
    if not alerts:
        try:
            sql = """
            SELECT DISTINCT
              am.mint::TEXT AS mint,
              a.alert_ts_ms::BIGINT AS ts_ms,
              COALESCE(a.caller_name, '')::TEXT AS caller
            FROM core.alert_mints_f am
            JOIN core.alerts_d a USING (source_system, chat_id, message_id)
            WHERE am.mint IS NOT NULL
              AND a.alert_ts_ms >= ?
              AND a.alert_ts_ms < ?
            """
            rows = conn.execute(sql, [from_ms, to_ms_excl]).fetchall()
            for mint, ts_ms, caller in rows:
                if mint:
                    alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=caller or ""))
        except Exception:
            pass  # Table doesn't exist or query failed

    conn.close()
    alerts.sort(key=lambda a: (a.ts_ms, a.mint))
    return alerts


# -----------------------------
# ClickHouse: coverage check and slice export
# -----------------------------


@dataclass(frozen=True)
class ClickHouseCfg:
    host: str
    port: int
    database: str
    table: str
    user: str
    password: str
    connect_timeout: int
    send_receive_timeout: int

    def get_client(self) -> ClickHouseClient:
        """Create a ClickHouse client connection."""
        return ClickHouseClient(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            connect_timeout=self.connect_timeout,
            send_receive_timeout=self.send_receive_timeout,
        )


def ch_query_rows(cfg: ClickHouseCfg, sql: str) -> List[Dict[str, Any]]:
    """Execute ClickHouse query and return rows as dicts."""
    client = cfg.get_client()
    result = client.execute(sql, with_column_types=True)
    rows_data, columns = result
    col_names = [col[0] for col in columns]
    return [dict(zip(col_names, row)) for row in rows_data]


def query_coverage(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    min_coverage_pct: float = 0.8,
) -> Dict[str, int]:
    """
    Query ClickHouse ONCE to get candle counts per token.
    Returns {mint: candle_count} for tokens with ANY candles in the range.
    
    NOTE: This is a GLOBAL coverage check. For per-alert coverage,
    use query_coverage_per_alert() instead.
    """
    if not mints:
        return {}

    chain_q = safe_sql_string(chain)

    # Build mint list for IN clause (batched to avoid huge queries)
    mint_list = ", ".join(f"'{safe_sql_string(m)}'" for m in mints)

    sql = f"""
SELECT
  token_address,
  count() as candle_count
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(date_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(date_to + timedelta(days=1))}')
GROUP BY token_address
""".strip()

    rows = ch_query_rows(cfg, sql)
    return {row["token_address"]: int(row["candle_count"]) for row in rows}


def query_coverage_per_alert(
    cfg: ClickHouseCfg,
    chain: str,
    alerts: List["Alert"],
    interval_seconds: int,
    horizon: timedelta,
    min_coverage_pct: float = 0.8,
) -> Set[Tuple[str, int]]:
    """
    Per-alert coverage check: for each (mint, ts_ms), check if there are
    enough candles from alert_ts to alert_ts + horizon.
    
    Returns set of (mint, ts_ms) tuples that have sufficient coverage.
    """
    if not alerts:
        return set()
    
    # Required candles per alert (based on horizon)
    horizon_seconds = horizon.total_seconds()
    required_candles = int((horizon_seconds / interval_seconds) * min_coverage_pct)
    
    chain_q = safe_sql_string(chain)
    
    # Build a UNION ALL query to check each alert's coverage
    # This is more efficient than N queries
    subqueries = []
    for a in alerts:
        mint_q = safe_sql_string(a.mint)
        alert_ts = datetime.fromtimestamp(a.ts_ms / 1000.0, tz=UTC)
        end_ts = alert_ts + horizon
        
        subqueries.append(f"""
SELECT
  '{mint_q}' AS mint,
  {a.ts_ms} AS ts_ms,
  count() AS candle_count
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address = '{mint_q}'
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(alert_ts)}')
  AND timestamp <  toDateTime('{dt_to_ch(end_ts)}')
""")
    
    # Batch subqueries to avoid huge queries (max 100 per batch)
    covered_alerts = set()
    batch_size = 100
    
    for i in range(0, len(subqueries), batch_size):
        batch = subqueries[i:i + batch_size]
        sql = " UNION ALL ".join(batch)
        
        rows = ch_query_rows(cfg, sql)
        for row in rows:
            if int(row["candle_count"]) >= required_candles:
                covered_alerts.add((row["mint"], int(row["ts_ms"])))
    
    return covered_alerts


def query_coverage_detailed(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
) -> Dict[str, Dict[str, Any]]:
    """
    Query ClickHouse to get detailed coverage info per token including:
    - candle_count
    - first_timestamp
    - last_timestamp
    - missing_periods (gaps in data)
    
    Returns {mint: {candle_count, first_ts, last_ts, missing_periods}} for all tokens.
    """
    if not mints:
        return {}

    chain_q = safe_sql_string(chain)
    mint_list = ", ".join(f"'{safe_sql_string(m)}'" for m in mints)

    sql = f"""
SELECT
  token_address,
  count() as candle_count,
  min(timestamp) as first_timestamp,
  max(timestamp) as last_timestamp
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(date_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(date_to + timedelta(days=1))}')
GROUP BY token_address
""".strip()

    rows = ch_query_rows(cfg, sql)
    result = {}
    for row in rows:
        mint = row["token_address"]
        result[mint] = {
            "candle_count": int(row["candle_count"]),
            "first_timestamp": row["first_timestamp"],
            "last_timestamp": row["last_timestamp"],
        }
    return result


def export_slice_to_parquet(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    output_path: Path,
) -> int:
    """
    Export candles for specified mints to Parquet file.
    Returns number of rows exported.
    """
    if not mints:
        return 0

    chain_q = safe_sql_string(chain)
    mint_list = ", ".join(f"'{safe_sql_string(m)}'" for m in mints)

    # Query all candles for covered mints
    sql = f"""
SELECT
  token_address,
  timestamp,
  open,
  high,
  low,
  close,
  volume
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(date_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(date_to + timedelta(days=1))}')
ORDER BY token_address, timestamp
""".strip()

    client = cfg.get_client()
    result = client.execute(sql, with_column_types=True)
    rows_data, columns = result
    col_names = [col[0] for col in columns]

    if not rows_data:
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write to Parquet using DuckDB (avoids pandas dependency)
    conn = duckdb.connect(":memory:")

    # Create table with schema
    conn.execute("""
        CREATE TABLE candles (
            token_address VARCHAR,
            timestamp TIMESTAMP,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume DOUBLE
        )
    """)

    # Insert data in batches
    batch_size = 10000
    for i in range(0, len(rows_data), batch_size):
        batch = rows_data[i : i + batch_size]
        conn.executemany(
            "INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", batch
        )

    # Export to Parquet
    conn.execute(f"COPY candles TO '{output_path}' (FORMAT PARQUET)")
    count = conn.execute("SELECT count(*) FROM candles").fetchone()[0]
    conn.close()

    return count


def load_candles_from_parquet(
    parquet_path: Path, mint: str, start_ts: datetime, end_ts: datetime
) -> List[Candle]:
    """Load candles for a specific mint from Parquet file using DuckDB."""
    conn = duckdb.connect(":memory:")

    sql = f"""
    SELECT timestamp, open, high, low, close, volume
    FROM '{parquet_path}'
    WHERE token_address = ?
      AND timestamp >= ?
      AND timestamp < ?
    ORDER BY timestamp
    """

    rows = conn.execute(
        sql, [mint, start_ts.strftime("%Y-%m-%d %H:%M:%S"), end_ts.strftime("%Y-%m-%d %H:%M:%S")]
    ).fetchall()
    conn.close()

    candles = []
    for row in rows:
        ts_val = row[0]
        if isinstance(ts_val, str):
            ts = datetime.strptime(ts_val, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
        else:
            ts = ts_val.replace(tzinfo=UTC) if ts_val.tzinfo is None else ts_val
        candles.append(
            Candle(
                ts=ts,
                o=float(row[1]),
                h=float(row[2]),
                l=float(row[3]),
                c=float(row[4]),
                v=float(row[5]) if row[5] else 0.0,
            )
        )
    return candles


# -----------------------------
# Metrics + simple backtest policies
# -----------------------------


def compute_core_metrics(entry_price: float, candles: List[Candle]) -> Dict[str, Any]:
    """
    Compute comprehensive metrics for an alert:
    - ATH multiple after alert
    - Time to ATH
    - Time to 2x
    - Time to 3x
    - Drawdown from alert
    - Drawdown after 2x
    - Drawdown after 3x
    - Peak PNL
    """
    if not candles or entry_price <= 0:
        return {
            "ath_mult": float("nan"),
            "time_to_ath_s": None,
            "time_to_2x_s": None,
            "time_to_3x_s": None,
            "time_to_4x_s": None,
            "dd_initial": None,
            "dd_overall": float("nan"),
            "dd_pre2x": None,
            "dd_after_2x": None,
            "dd_after_3x": None,
            "dd_after_4x": None,
            "dd_after_ath": None,
            "peak_pnl_pct": float("nan"),
            "ret_end": float("nan"),
        }

    highs = [c.h for c in candles]
    lows = [c.l for c in candles]
    closes = [c.c for c in candles]

    max_high = max(highs)
    min_low = min(lows)
    end_close = closes[-1]

    ath_mult = max_high / entry_price if entry_price > 0 else float("nan")
    dd_overall = (min_low / entry_price) - 1.0 if entry_price > 0 else float("nan")
    ret_end = (end_close / entry_price) - 1.0 if entry_price > 0 else float("nan")
    
    # Peak PNL (maximum profit percentage)
    peak_pnl_pct = (max_high / entry_price - 1.0) * 100.0 if entry_price > 0 else float("nan")

    # ---------------------------------------------------------
    # Initial drawdown: max dip BEFORE price goes above entry
    # This measures "how much pain before recovery"
    # ---------------------------------------------------------
    dd_initial: Optional[float] = None
    recovery_idx: Optional[int] = None
    
    # First candle is at entry, skip it and find first candle where high > entry
    for i, c in enumerate(candles[1:], start=1):
        if c.h > entry_price:
            recovery_idx = i
            break
    
    if recovery_idx is not None and recovery_idx > 0:
        # Get min low from candles BEFORE recovery (including first candle)
        pre_recovery_lows = [c.l for c in candles[:recovery_idx]]
        if pre_recovery_lows:
            min_pre_recovery = min(pre_recovery_lows)
            dd_initial = (min_pre_recovery / entry_price) - 1.0
    elif recovery_idx is None:
        # Price never recovered above entry - dd_initial = dd_overall
        dd_initial = dd_overall

    # Find time to ATH (first candle that reaches max_high)
    time_to_ath_s: Optional[int] = None
    ath_idx: Optional[int] = None
    for i, c in enumerate(candles):
        if c.h >= max_high - 1e-9:  # Account for floating point precision
            ath_idx = i
            time_to_ath_s = int((c.ts - candles[0].ts).total_seconds())
            break

    # Find time to 2x
    t2x_s: Optional[int] = None
    dd_pre2x: Optional[float] = None
    hit_2x_idx: Optional[int] = None
    target_2x = entry_price * 2.0

    for i, c in enumerate(candles):
        if c.h >= target_2x:
            hit_2x_idx = i
            t2x_s = int((c.ts - candles[0].ts).total_seconds())
            break

    if hit_2x_idx is not None:
        pre_lows = [c.l for c in candles[: hit_2x_idx + 1]]
        dd_pre2x = (min(pre_lows) / entry_price) - 1.0

    # Find time to 3x
    t3x_s: Optional[int] = None
    hit_3x_idx: Optional[int] = None
    target_3x = entry_price * 3.0

    for i, c in enumerate(candles):
        if c.h >= target_3x:
            hit_3x_idx = i
            t3x_s = int((c.ts - candles[0].ts).total_seconds())
            break

    # Drawdown after 2x (if 2x was hit)
    dd_after_2x: Optional[float] = None
    if hit_2x_idx is not None and hit_2x_idx < len(candles) - 1:
        post_2x_lows = [c.l for c in candles[hit_2x_idx + 1:]]
        if post_2x_lows:
            min_post_2x = min(post_2x_lows)
            # Drawdown from 2x price level
            dd_after_2x = (min_post_2x / target_2x) - 1.0

    # Drawdown after 3x (if 3x was hit)
    dd_after_3x: Optional[float] = None
    if hit_3x_idx is not None and hit_3x_idx < len(candles) - 1:
        post_3x_lows = [c.l for c in candles[hit_3x_idx + 1:]]
        if post_3x_lows:
            min_post_3x = min(post_3x_lows)
            # Drawdown from 3x price level
            dd_after_3x = (min_post_3x / target_3x) - 1.0

    # Find time to 4x
    t4x_s: Optional[int] = None
    hit_4x_idx: Optional[int] = None
    target_4x = entry_price * 4.0

    for i, c in enumerate(candles):
        if c.h >= target_4x:
            hit_4x_idx = i
            t4x_s = int((c.ts - candles[0].ts).total_seconds())
            break

    # Drawdown after 4x (if 4x was hit)
    dd_after_4x: Optional[float] = None
    if hit_4x_idx is not None and hit_4x_idx < len(candles) - 1:
        post_4x_lows = [c.l for c in candles[hit_4x_idx + 1:]]
        if post_4x_lows:
            min_post_4x = min(post_4x_lows)
            dd_after_4x = (min_post_4x / target_4x) - 1.0

    # Drawdown after ATH (lowest point after reaching ATH)
    dd_after_ath: Optional[float] = None
    if ath_idx is not None and ath_idx < len(candles) - 1:
        post_ath_lows = [c.l for c in candles[ath_idx + 1:]]
        if post_ath_lows:
            min_post_ath = min(post_ath_lows)
            dd_after_ath = (min_post_ath / max_high) - 1.0

    return {
        "ath_mult": ath_mult,
        "time_to_ath_s": time_to_ath_s,
        "time_to_2x_s": t2x_s,
        "time_to_3x_s": t3x_s,
        "time_to_4x_s": t4x_s,
        "dd_initial": dd_initial,  # Max dip before price goes above entry
        "dd_overall": dd_overall,
        "dd_pre2x": dd_pre2x,
        "dd_after_2x": dd_after_2x,
        "dd_after_3x": dd_after_3x,
        "dd_after_4x": dd_after_4x,
        "dd_after_ath": dd_after_ath,
        "peak_pnl_pct": peak_pnl_pct,
        "ret_end": ret_end,
    }


def simulate_tp_sl(
    entry_price: float,
    candles: List[Candle],
    tp_mult: float,
    sl_mult: float,
    intrabar_order: str,
    fee_bps: float,
    slippage_bps: float,
) -> Dict[str, Any]:
    """Simple candle-based TP/SL trigger model."""
    tp_price = entry_price * tp_mult
    sl_price = entry_price * sl_mult

    exit_reason = "horizon"
    exit_price = candles[-1].c

    for c in candles[1:]:
        hit_tp = c.h >= tp_price
        hit_sl = c.l <= sl_price

        if hit_tp and hit_sl:
            if intrabar_order == "tp_first":
                exit_reason, exit_price = "tp", tp_price
            else:
                exit_reason, exit_price = "sl", sl_price
            break
        elif hit_sl:
            exit_reason, exit_price = "sl", sl_price
            break
        elif hit_tp:
            exit_reason, exit_price = "tp", tp_price
            break

    cost_mult = 1.0 - (fee_bps + slippage_bps) / 10000.0
    entry_eff = entry_price * (1.0 + (slippage_bps / 10000.0))
    exit_eff = exit_price * cost_mult
    ret = (exit_eff / entry_eff) - 1.0

    return {
        "tp_sl_exit_reason": exit_reason,
        "tp_sl_ret": ret,
    }


def simulate_time_gate_tp_sl(
    entry_price: float,
    candles: List[Candle],
    entry_ts: datetime,
    tp_mult: float,
    sl_mult: float,
    time_gate_minutes: int,
    min_gain_pct: float,  # e.g., 0.50 for +50%
    intrabar_order: str,
    fee_bps: float,
    slippage_bps: float,
) -> Dict[str, Any]:
    """
    Time-gated TP/SL strategy:
    - If price is not at least +min_gain_pct by time_gate_minutes, exit at market
    - Otherwise, hold for TP/SL exit
    
    Example: "sell if <+50% by 45min, else hold for TP"
    """
    tp_price = entry_price * tp_mult
    sl_price = entry_price * sl_mult
    min_gain_price = entry_price * (1.0 + min_gain_pct)
    time_gate_delta = timedelta(minutes=time_gate_minutes)
    time_gate_ts = entry_ts + time_gate_delta
    
    exit_reason = "horizon"
    exit_price = candles[-1].c
    exit_ts: Optional[datetime] = None
    
    # Track if we've passed the time gate check
    passed_time_gate = False
    time_gate_checked = False
    
    for i, c in enumerate(candles[1:], start=1):
        current_ts = c.ts
        hit_tp = c.h >= tp_price
        hit_sl = c.l <= sl_price
        
        # Check stop loss first (always active)
        if hit_sl:
            if hit_tp and intrabar_order == "tp_first":
                exit_reason, exit_price = "tp", tp_price
            else:
                exit_reason, exit_price = "sl", sl_price
            exit_ts = current_ts
            break
        
        # Time gate check: at or after 45min, check if we're at +50%
        if not time_gate_checked and current_ts >= time_gate_ts:
            time_gate_checked = True
            # Check current price at this candle
            current_high = c.h
            if current_high >= min_gain_price:
                passed_time_gate = True
            else:
                # Exit at market - didn't meet minimum gain
                exit_reason = "time_gate_exit"
                exit_price = c.c  # Exit at close of this candle
                exit_ts = current_ts
                break
        
        # After passing time gate, continue checking for TP
        if passed_time_gate and hit_tp:
            exit_reason, exit_price = "tp", tp_price
            exit_ts = current_ts
            break
    
    cost_mult = 1.0 - (fee_bps + slippage_bps) / 10000.0
    entry_eff = entry_price * (1.0 + (slippage_bps / 10000.0))
    exit_eff = exit_price * cost_mult
    ret = (exit_eff / entry_eff) - 1.0
    
    return {
        "tg_exit_reason": exit_reason,
        "tg_ret": ret,
        "tg_passed_gate": passed_time_gate,
    }


# -----------------------------
# TUI Dashboard (rich-based) with file-based logging
# -----------------------------


class BacktestLogger:
    """File-based activity logger with optional TUI display."""

    def __init__(self, log_path: Path):
        self.log_path = log_path
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        # Clear/create log file
        self.log_path.write_text("")
        self._file = open(self.log_path, "a", buffering=1)  # Line buffered

    def write(self, msg: str) -> None:
        """Write a line to the log file."""
        timestamp = datetime.now(UTC).strftime("%H:%M:%S")
        self._file.write(f"[{timestamp}] {msg}\n")
        self._file.flush()

    def close(self) -> None:
        """Close the log file."""
        self._file.close()

    def tail(self, n: int = 20) -> List[str]:
        """Read the last n lines from the log file."""
        try:
            with open(self.log_path, "r") as f:
                lines = f.readlines()
                return [line.rstrip() for line in lines[-n:]]
        except Exception:
            return []


class BacktestTUI:
    """Live terminal UI for backtest progress and metrics."""

    def __init__(self, total_alerts: int, config: Dict[str, Any], logger: BacktestLogger):
        self.total = total_alerts
        self.processed = 0
        self.config = config
        self.logger = logger

        # Running metrics
        self.ok_count = 0
        self.skip_count = 0
        self.error_count = 0
        self.returns: List[float] = []
        self.ath_mults: List[float] = []
        self.hit_2x_count = 0

        self.max_log_lines = 18
        self.console = Console()

    def log(self, msg: str) -> None:
        """Write to log file."""
        self.logger.write(msg)

    def update(self, result: Dict[str, Any]) -> None:
        """Update metrics with a processed alert result."""
        self.processed += 1
        status = result.get("status", "error")

        if status == "ok":
            self.ok_count += 1
            if result.get("peak_pnl_pct") is not None:
                self.returns.append(result["peak_pnl_pct"] / 100.0)  # Store as ratio
            if result.get("ath_mult") is not None:
                self.ath_mults.append(result["ath_mult"])
            if result.get("time_to_2x_s") is not None:
                self.hit_2x_count += 1
            t2x_h = result.get("time_to_2x_s", 0) / 3600.0 if result.get("time_to_2x_s") else None
            t2x_str = f"2x@{t2x_h:.1f}h" if t2x_h else "no 2x"
            self.log(f"✓ {result.get('caller', '?'):20} | {result.get('mint', '?')} | ATH {result.get('ath_mult', 0):.2f}x | {t2x_str}")
        elif status == "no_coverage":
            self.skip_count += 1
            self.log(f"○ {result.get('caller', '?'):20} | {result.get('mint', '?')} | skipped (no coverage)")
        else:
            self.error_count += 1
            self.log(f"✗ {result.get('caller', '?'):20} | {result.get('mint', '?')} | {status}")

    def _make_metrics_table(self) -> Table:
        """Create the metrics table for the dashboard."""
        table = Table(show_header=False, box=None, padding=(0, 2))
        table.add_column("Label", style="dim")
        table.add_column("Value", style="bold cyan")
        table.add_column("Label2", style="dim")
        table.add_column("Value2", style="bold cyan")

        # Row 1: Progress and counts
        pct = (self.processed / self.total * 100) if self.total > 0 else 0
        table.add_row(
            "Progress", f"{self.processed:,} / {self.total:,} ({pct:.1f}%)",
            "OK / Skip / Err", f"{self.ok_count:,} / {self.skip_count:,} / {self.error_count:,}"
        )

        # Row 2: Performance metrics (pure path metrics, no strategy)
        med_peak_pnl = median(self.returns) * 100 if self.returns else 0  # returns stores peak_pnl as ratio
        med_ath = median(self.ath_mults) if self.ath_mults else 0
        hit_2x_pct = (self.hit_2x_count / self.ok_count * 100) if self.ok_count > 0 else 0
        table.add_row(
            "Median Peak PnL", f"{med_peak_pnl:+.1f}%",
            "Median ATH", f"{med_ath:.2f}x"
        )
        table.add_row(
            "Hit 2x Rate", f"{hit_2x_pct:.1f}%",
            "Processed", f"{self.ok_count:,} alerts"
        )

        return table

    def _make_progress_bar(self) -> Text:
        """Create a simple progress bar."""
        width = 50
        filled = int((self.processed / self.total) * width) if self.total > 0 else 0
        bar = "█" * filled + "░" * (width - filled)
        pct = (self.processed / self.total * 100) if self.total > 0 else 0
        return Text(f"[{bar}] {pct:.1f}%", style="green")

    def _make_config_line(self) -> Text:
        """Show config summary."""
        cfg = self.config
        return Text(
            f"📅 {cfg.get('date_from', '?')} → {cfg.get('date_to', '?')} | "
            f"⏱ {cfg.get('interval_seconds', 60)}s candles / {cfg.get('horizon_hours', 48)}h horizon",
            style="dim"
        )

    def _make_log_panel(self) -> Panel:
        """Create the scrolling activity log panel (tails log file)."""
        log_lines = self.logger.tail(self.max_log_lines)
        log_text = "\n".join(log_lines) if log_lines else "(waiting for alerts...)"
        return Panel(
            Text(log_text, style="white"),
            title=f"[bold]Activity Log[/bold] [dim]({self.logger.log_path})[/dim]",
            border_style="dim",
            height=self.max_log_lines + 2,
        )

    def render(self) -> Group:
        """Render the full dashboard."""
        # Header
        header = Panel(
            Group(
                self._make_config_line(),
                Text(""),
                self._make_progress_bar(),
                Text(""),
                self._make_metrics_table(),
            ),
            title="[bold blue]📊 Backtest Dashboard[/bold blue]",
            border_style="blue",
        )

        return Group(header, self._make_log_panel())


# -----------------------------
# Summary
# -----------------------------


def summarize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    ok = [r for r in rows if r.get("status") == "ok"]
    missing = [r for r in rows if r.get("status") != "ok"]

    def take(field: str) -> List[float]:
        xs = []
        for r in ok:
            v = r.get(field)
            if v is None:
                continue
            if isinstance(v, (int, float)) and (not math.isnan(v)):
                xs.append(float(v))
        return xs

    ath = take("ath_mult")
    dd_initial = take("dd_initial")  # Max dip before recovery above entry
    dd = take("dd_overall")
    ret_end = take("ret_end")
    peak_pnl = take("peak_pnl_pct")
    t_ath = [float(r["time_to_ath_s"]) for r in ok if r.get("time_to_ath_s") is not None]
    t2x = [float(r["time_to_2x_s"]) for r in ok if r.get("time_to_2x_s") is not None]
    t3x = [float(r["time_to_3x_s"]) for r in ok if r.get("time_to_3x_s") is not None]
    dd_after_2x = take("dd_after_2x")
    dd_after_3x = take("dd_after_3x")

    def fmt_med(xs: List[float]) -> Optional[float]:
        return median(xs) if xs else None

    def fmt_pct_hit_2x() -> float:
        if not ok:
            return 0.0
        hit = sum(1 for r in ok if r.get("time_to_2x_s") is not None)
        return hit / len(ok)

    # TP/SL policy metrics
    tp_sl_returns = take("tp_sl_ret")
    tp_exits = [r for r in ok if r.get("tp_sl_exit_reason") == "tp"]
    sl_exits = [r for r in ok if r.get("tp_sl_exit_reason") == "sl"]
    horizon_exits = [r for r in ok if r.get("tp_sl_exit_reason") == "horizon"]
    
    # PNL accounting (assuming equal position sizing per trade)
    total_trades = len(ok)
    wins = [r for r in ok if r.get("tp_sl_ret", 0) > 0]
    losses = [r for r in ok if r.get("tp_sl_ret", 0) < 0]
    
    # Aggregate returns (sum of all trade returns as % of bankroll per trade)
    total_return_pct = sum(tp_sl_returns) * 100 if tp_sl_returns else 0.0
    avg_return_pct = (sum(tp_sl_returns) / len(tp_sl_returns) * 100) if tp_sl_returns else 0.0
    
    # Win/loss stats
    win_rate = len(wins) / total_trades if total_trades > 0 else 0.0
    avg_win = (sum(r.get("tp_sl_ret", 0) for r in wins) / len(wins) * 100) if wins else 0.0
    avg_loss = (sum(r.get("tp_sl_ret", 0) for r in losses) / len(losses) * 100) if losses else 0.0
    
    # Profit factor = gross profit / gross loss
    gross_profit = sum(r.get("tp_sl_ret", 0) for r in wins)
    gross_loss = abs(sum(r.get("tp_sl_ret", 0) for r in losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf") if gross_profit > 0 else 0.0
    
    # Expectancy = (win_rate * avg_win) + ((1 - win_rate) * avg_loss)
    expectancy_pct = (win_rate * avg_win) + ((1 - win_rate) * avg_loss)

    result = {
        "alerts_total": len(rows),
        "alerts_ok": len(ok),
        "alerts_missing": len(missing),
        "median_ath_mult": fmt_med(ath),
        "median_time_to_ath_s": fmt_med(t_ath),
        "median_time_to_2x_s": fmt_med(t2x),
        "median_time_to_3x_s": fmt_med(t3x),
        "median_dd_initial": fmt_med(dd_initial),  # Max dip before recovery
        "median_dd_overall": fmt_med(dd),
        "median_dd_after_2x": fmt_med(dd_after_2x),
        "median_dd_after_3x": fmt_med(dd_after_3x),
        "median_peak_pnl_pct": fmt_med(peak_pnl),
        "median_ret_end": fmt_med(ret_end),
        "pct_hit_2x": fmt_pct_hit_2x(),
        # TP/SL policy metrics
        "tp_sl_total_return_pct": total_return_pct,
        "tp_sl_avg_return_pct": avg_return_pct,
        "tp_sl_median_return_pct": fmt_med(tp_sl_returns) * 100 if fmt_med(tp_sl_returns) else None,
        "tp_sl_win_rate": win_rate,
        "tp_sl_avg_win_pct": avg_win,
        "tp_sl_avg_loss_pct": avg_loss,
        "tp_sl_profit_factor": profit_factor,
        "tp_sl_expectancy_pct": expectancy_pct,
        "tp_sl_tp_exits": len(tp_exits),
        "tp_sl_sl_exits": len(sl_exits),
        "tp_sl_horizon_exits": len(horizon_exits),
        # Time-gate policy metrics (if enabled) - populated below if data exists
        "tg_total_return_pct": None,
        "tg_avg_return_pct": None,
        "tg_win_rate": None,
        "tg_profit_factor": None,
        "tg_expectancy_pct": None,
        "tg_tp_exits": None,
        "tg_sl_exits": None,
        "tg_time_gate_exits": None,
        "tg_horizon_exits": None,
        "tg_passed_gate_count": None,
    }
    
    # Calculate time-gate metrics if available
    tg_returns = take("tg_ret")
    if tg_returns:
        tg_tp_exits = [r for r in ok if r.get("tg_exit_reason") == "tp"]
        tg_sl_exits = [r for r in ok if r.get("tg_exit_reason") == "sl"]
        tg_time_gate_exits = [r for r in ok if r.get("tg_exit_reason") == "time_gate_exit"]
        tg_horizon_exits = [r for r in ok if r.get("tg_exit_reason") == "horizon"]
        tg_passed = [r for r in ok if r.get("tg_passed_gate") == True]
        
        tg_total_trades = len(ok)
        tg_wins = [r for r in ok if r.get("tg_ret", 0) > 0]
        tg_losses = [r for r in ok if r.get("tg_ret", 0) < 0]
        
        tg_total_return_pct = sum(tg_returns) * 100 if tg_returns else 0.0
        tg_avg_return_pct = (sum(tg_returns) / len(tg_returns) * 100) if tg_returns else 0.0
        tg_win_rate = len(tg_wins) / tg_total_trades if tg_total_trades > 0 else 0.0
        
        tg_gross_profit = sum(r.get("tg_ret", 0) for r in tg_wins)
        tg_gross_loss = abs(sum(r.get("tg_ret", 0) for r in tg_losses))
        tg_profit_factor = tg_gross_profit / tg_gross_loss if tg_gross_loss > 0 else float("inf") if tg_gross_profit > 0 else 0.0
        
        tg_avg_win = (sum(r.get("tg_ret", 0) for r in tg_wins) / len(tg_wins) * 100) if tg_wins else 0.0
        tg_avg_loss = (sum(r.get("tg_ret", 0) for r in tg_losses) / len(tg_losses) * 100) if tg_losses else 0.0
        tg_expectancy_pct = (tg_win_rate * tg_avg_win) + ((1 - tg_win_rate) * tg_avg_loss)
        
        result["tg_total_return_pct"] = tg_total_return_pct
        result["tg_avg_return_pct"] = tg_avg_return_pct
        result["tg_win_rate"] = tg_win_rate
        result["tg_profit_factor"] = tg_profit_factor
        result["tg_expectancy_pct"] = tg_expectancy_pct
        result["tg_tp_exits"] = len(tg_tp_exits)
        result["tg_sl_exits"] = len(tg_sl_exits)
        result["tg_time_gate_exits"] = len(tg_time_gate_exits)
        result["tg_horizon_exits"] = len(tg_horizon_exits)
        result["tg_passed_gate_count"] = len(tg_passed)
    
    return result


# -----------------------------
# DuckDB Storage (bt.* schema)
# -----------------------------


def store_run_to_duckdb(
    duckdb_path: str,
    run_id: str,
    run_name: str,
    config: Dict[str, Any],
    rows_out: List[Dict[str, Any]],
    summary: Dict[str, Any],
) -> None:
    """
    Store backtest run results to bt.* schema in DuckDB.
    
    Tables written:
    - bt.runs_d: Run metadata (1 row)
    - bt.alert_scenarios_d: Per-alert scenario (1 row per covered alert)
    - bt.alert_outcomes_f: Per-alert path metrics (1 row per ok alert)
    - bt.metrics_f: Aggregate summary metrics (multiple rows)
    """
    conn = duckdb.connect(duckdb_path)
    
    try:
        # Ensure bt schema exists
        conn.execute("CREATE SCHEMA IF NOT EXISTS bt")
        
        # -----------------------------
        # 1. Insert run metadata into bt.runs_d
        # -----------------------------
        run_uuid = run_id  # Already a valid UUID string
        created_at = datetime.now(UTC)
        
        # Check if runs_d table exists, if not create it
        conn.execute("""
            CREATE TABLE IF NOT EXISTS bt.runs_d (
                run_id UUID PRIMARY KEY,
                created_at TIMESTAMP,
                run_name VARCHAR,
                strategy_name VARCHAR,
                strategy_version VARCHAR,
                candle_interval_s INTEGER,
                window_from_ts_ms BIGINT,
                window_to_ts_ms BIGINT,
                entry_rule VARCHAR,
                exit_rule VARCHAR,
                config_json JSON,
                notes VARCHAR
            )
        """)
        
        # Parse dates for window bounds
        date_from = datetime.strptime(config.get("date_from", ""), "%Y-%m-%d").replace(tzinfo=UTC) if config.get("date_from") else None
        date_to = datetime.strptime(config.get("date_to", ""), "%Y-%m-%d").replace(tzinfo=UTC) if config.get("date_to") else None
        window_from_ms = int(date_from.timestamp() * 1000) if date_from else None
        window_to_ms = int(date_to.timestamp() * 1000) if date_to else None
        
        conn.execute("""
            INSERT INTO bt.runs_d (
                run_id, created_at, run_name, strategy_name, strategy_version,
                candle_interval_s, window_from_ts_ms, window_to_ts_ms,
                entry_rule, exit_rule, config_json, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            run_uuid,
            created_at,
            run_name,
            "baseline",  # strategy_name
            "1.0",  # strategy_version
            config.get("interval_seconds", 60),
            window_from_ms,
            window_to_ms,
            f"tp={config.get('tp_mult', 2.0)}x",  # entry_rule (simplified)
            f"sl={config.get('sl_mult', 0.5)}x",  # exit_rule (simplified)
            json.dumps(config),
            f"Baseline backtest: {config.get('date_from')} to {config.get('date_to')}"
        ])
        
        # -----------------------------
        # 2. Insert alert scenarios into bt.alert_scenarios_d
        # -----------------------------
        conn.execute("""
            CREATE TABLE IF NOT EXISTS bt.alert_scenarios_d (
                scenario_id UUID PRIMARY KEY,
                created_at TIMESTAMP,
                run_id UUID,
                alert_id UUID,
                mint VARCHAR,
                alert_ts_ms BIGINT,
                interval_seconds INTEGER,
                eval_window_s INTEGER,
                entry_delay_s INTEGER,
                price_source VARCHAR,
                caller_name VARCHAR,
                source_system VARCHAR,
                scenario_json JSON
            )
        """)
        
        # Insert one scenario per covered alert
        ok_rows = [r for r in rows_out if r.get("status") == "ok"]
        for row in ok_rows:
            scenario_id = str(uuid.uuid4())
            alert_id = str(uuid.uuid4())  # Generate alert_id (could be derived from mint+ts)
            
            # Parse alert_ts_utc to milliseconds
            alert_ts_str = row.get("alert_ts_utc", "")
            try:
                alert_ts = datetime.strptime(alert_ts_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
                alert_ts_ms = int(alert_ts.timestamp() * 1000)
            except:
                alert_ts_ms = 0
            
            conn.execute("""
                INSERT INTO bt.alert_scenarios_d (
                    scenario_id, created_at, run_id, alert_id, mint, alert_ts_ms,
                    interval_seconds, eval_window_s, entry_delay_s, price_source,
                    caller_name, source_system, scenario_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                scenario_id,
                created_at,
                run_uuid,
                alert_id,
                row.get("mint", ""),
                alert_ts_ms,
                row.get("interval_seconds", 60),
                row.get("horizon_hours", 48) * 3600,  # eval_window_s
                0,  # entry_delay_s
                "candle_open",  # price_source
                row.get("caller", ""),
                "telegram",  # source_system
                json.dumps(row)  # Full row as scenario_json
            ])
            
            # -----------------------------
            # 3. Insert alert outcome into bt.alert_outcomes_f
            # -----------------------------
            conn.execute("""
                CREATE TABLE IF NOT EXISTS bt.alert_outcomes_f (
                    scenario_id UUID PRIMARY KEY,
                    computed_at TIMESTAMP,
                    alert_price_usd DOUBLE,
                    entry_price_usd DOUBLE,
                    entry_ts_ms BIGINT,
                    ath_price_usd DOUBLE,
                    ath_multiple DOUBLE,
                    ath_ts_ms BIGINT,
                    min_price_usd DOUBLE,
                    min_ts_ms BIGINT,
                    max_drawdown_pct DOUBLE,
                    hit_2x BOOLEAN,
                    ts_2x_ms BIGINT,
                    time_to_2x_s INTEGER,
                    min_price_before_2x_usd DOUBLE,
                    min_ts_before_2x_ms BIGINT,
                    max_dd_before_2x_pct DOUBLE,
                    candles_seen INTEGER,
                    notes VARCHAR,
                    details_json JSON
                )
            """)
            
            # Calculate outcome metrics from row
            entry_price = row.get("entry_price", 0.0)
            ath_mult = row.get("ath_mult")
            ath_price = entry_price * ath_mult if ath_mult and entry_price else None
            
            # Parse entry timestamp
            entry_ts_str = row.get("entry_ts_utc", "")
            try:
                entry_ts = datetime.strptime(entry_ts_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
                entry_ts_ms = int(entry_ts.timestamp() * 1000)
            except:
                entry_ts_ms = 0
            
            # Calculate ATH timestamp from time_to_ath_s
            time_to_ath_s = row.get("time_to_ath_s")
            ath_ts_ms = entry_ts_ms + (time_to_ath_s * 1000) if time_to_ath_s else None
            
            # Calculate 2x timestamp from time_to_2x_s  
            time_to_2x_s = row.get("time_to_2x_s")
            ts_2x_ms = entry_ts_ms + (time_to_2x_s * 1000) if time_to_2x_s else None
            
            # Drawdown metrics (convert from ratio to percentage)
            dd_overall = row.get("dd_overall")
            max_drawdown_pct = dd_overall * 100 if dd_overall is not None else None
            
            dd_pre2x = row.get("dd_pre2x")
            max_dd_before_2x_pct = dd_pre2x * 100 if dd_pre2x is not None else None
            
            conn.execute("""
                INSERT INTO bt.alert_outcomes_f (
                    scenario_id, computed_at, alert_price_usd, entry_price_usd, entry_ts_ms,
                    ath_price_usd, ath_multiple, ath_ts_ms, min_price_usd, min_ts_ms,
                    max_drawdown_pct, hit_2x, ts_2x_ms, time_to_2x_s,
                    min_price_before_2x_usd, min_ts_before_2x_ms, max_dd_before_2x_pct,
                    candles_seen, notes, details_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                scenario_id,
                created_at,
                entry_price,  # alert_price_usd (same as entry for baseline)
                entry_price,
                entry_ts_ms,
                ath_price,
                ath_mult,
                ath_ts_ms,
                None,  # min_price_usd (would need to track)
                None,  # min_ts_ms
                max_drawdown_pct,
                time_to_2x_s is not None,  # hit_2x
                ts_2x_ms,
                time_to_2x_s,
                None,  # min_price_before_2x_usd
                None,  # min_ts_before_2x_ms
                max_dd_before_2x_pct,
                row.get("candles", 0),
                None,  # notes
                json.dumps({
                    "peak_pnl_pct": row.get("peak_pnl_pct"),
                    "ret_end": row.get("ret_end"),
                    "time_to_3x_s": row.get("time_to_3x_s"),
                    "time_to_4x_s": row.get("time_to_4x_s"),
                    "dd_after_2x": row.get("dd_after_2x"),
                    "dd_after_3x": row.get("dd_after_3x"),
                    "dd_after_4x": row.get("dd_after_4x"),
                    "tp_sl_exit_reason": row.get("tp_sl_exit_reason"),
                    "tp_sl_ret": row.get("tp_sl_ret"),
                })
            ])
        
        # -----------------------------
        # 4. Insert aggregate metrics into bt.metrics_f
        # -----------------------------
        conn.execute("""
            CREATE TABLE IF NOT EXISTS bt.metrics_f (
                run_id UUID,
                mint VARCHAR,
                metric_name VARCHAR,
                metric_value DOUBLE,
                metric_json JSON,
                computed_at TIMESTAMP
            )
        """)
        
        # Insert summary metrics as rows
        metrics = [
            ("alerts_total", summary.get("alerts_total")),
            ("alerts_ok", summary.get("alerts_ok")),
            ("alerts_missing", summary.get("alerts_missing")),
            ("median_ath_mult", summary.get("median_ath_mult")),
            ("median_time_to_ath_s", summary.get("median_time_to_ath_s")),
            ("median_time_to_2x_s", summary.get("median_time_to_2x_s")),
            ("median_time_to_3x_s", summary.get("median_time_to_3x_s")),
            ("median_dd_initial", summary.get("median_dd_initial")),
            ("median_dd_overall", summary.get("median_dd_overall")),
            ("median_dd_after_2x", summary.get("median_dd_after_2x")),
            ("median_dd_after_3x", summary.get("median_dd_after_3x")),
            ("median_peak_pnl_pct", summary.get("median_peak_pnl_pct")),
            ("median_ret_end", summary.get("median_ret_end")),
            ("pct_hit_2x", summary.get("pct_hit_2x")),
            ("tp_sl_total_return_pct", summary.get("tp_sl_total_return_pct")),
            ("tp_sl_avg_return_pct", summary.get("tp_sl_avg_return_pct")),
            ("tp_sl_win_rate", summary.get("tp_sl_win_rate")),
            ("tp_sl_profit_factor", summary.get("tp_sl_profit_factor")),
            ("tp_sl_expectancy_pct", summary.get("tp_sl_expectancy_pct")),
        ]
        
        for metric_name, metric_value in metrics:
            if metric_value is not None:
                conn.execute("""
                    INSERT INTO bt.metrics_f (run_id, mint, metric_name, metric_value, metric_json, computed_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, [
                    run_uuid,
                    None,  # mint (null for run-level aggregates)
                    metric_name,
                    float(metric_value) if not math.isnan(float(metric_value)) else None,
                    None,
                    created_at
                ])
        
        conn.commit()
        
    finally:
        conn.close()


# -----------------------------
# Main
# -----------------------------


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Baseline per-alert backtest: ATH, drawdowns, time-to-2x, simple TP/SL."
    )

    # Core parameters
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"))
    ap.add_argument("--chain", default="solana")
    ap.add_argument("--from", dest="date_from", help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--to", dest="date_to", help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--interval-seconds", type=int, choices=[60, 300], default=60)
    ap.add_argument("--horizon-hours", type=int, default=48)
    ap.add_argument("--threads", type=int, default=16)
    ap.add_argument(
        "--min-coverage-pct",
        type=float,
        default=0.8,
        help="Minimum coverage percentage required (0.0-1.0)",
    )

    # Slice management
    ap.add_argument(
        "--slice-dir",
        default=os.getenv("SLICE_DIR", "slices"),
        help="Directory for Parquet slice files",
    )
    ap.add_argument(
        "--reuse-slice",
        action="store_true",
        help="Reuse existing slice if available",
    )

    # Output options
    ap.add_argument("--out-csv", help="Output CSV path")
    ap.add_argument("--out-dir", default=os.getenv("BACKTEST_OUT_DIR", "results"))
    ap.add_argument(
        "--output-format",
        choices=["console", "json"],
        default="console",
    )
    ap.add_argument(
        "--tui",
        action="store_true",
        help="Enable live TUI dashboard (requires rich library)",
    )
    ap.add_argument(
        "--log-file",
        help="Activity log file path (default: <out-dir>/backtest_<date>.log)",
    )

    # ClickHouse
    # ClickHouse native protocol connection
    ap.add_argument("--ch-host", default=os.getenv("CLICKHOUSE_HOST", "127.0.0.1"))
    ap.add_argument("--ch-port", type=int, default=int(os.getenv("CLICKHOUSE_PORT", "19000")))
    ap.add_argument("--ch-db", default=os.getenv("CLICKHOUSE_DATABASE", os.getenv("CH_DB", "quantbot")))
    ap.add_argument("--ch-table", default=os.getenv("CH_TABLE", "ohlcv_candles"))
    ap.add_argument("--ch-user", default=os.getenv("CLICKHOUSE_USER", os.getenv("CH_USER", "default")))
    ap.add_argument("--ch-pass", default=os.getenv("CLICKHOUSE_PASSWORD", os.getenv("CH_PASSWORD", "")))
    ap.add_argument(
        "--ch-connect-timeout", type=int, default=int(os.getenv("CH_CONNECT_TIMEOUT", "10"))
    )
    ap.add_argument(
        "--ch-timeout-s", type=int, default=int(os.getenv("CH_TIMEOUT_S", "300"))
    )

    # TP/SL policy parameters
    ap.add_argument(
        "--tp-mult", type=float, default=2.0,
        help="Take profit multiplier (default: 2.0)"
    )
    ap.add_argument(
        "--sl-mult", type=float, default=0.5,
        help="Stop loss multiplier (default: 0.5)"
    )
    ap.add_argument(
        "--intrabar-order", choices=["sl_first", "tp_first"], default="sl_first",
        help="Intrabar order for TP/SL simulation (default: sl_first)"
    )
    ap.add_argument(
        "--fee-bps", type=float, default=30.0,
        help="Fee in basis points (default: 30)"
    )
    ap.add_argument(
        "--slippage-bps", type=float, default=50.0,
        help="Slippage in basis points (default: 50)"
    )
    
    # Time-gate strategy arguments
    ap.add_argument(
        "--time-gate", action="store_true",
        help="Enable time-gate strategy (sell if <min-gain by gate-minutes, else hold for TP)"
    )
    ap.add_argument(
        "--gate-minutes", type=int, default=45,
        help="Time gate in minutes (default: 45)"
    )
    ap.add_argument(
        "--min-gain-pct", type=float, default=0.50,
        help="Minimum gain required at time gate as decimal (default: 0.50 = +50%%)"
    )
    
    # DuckDB storage
    ap.add_argument(
        "--store-duckdb", action="store_true", default=True,
        help="Store results to bt.* schema in DuckDB (default: True)"
    )
    ap.add_argument(
        "--no-store-duckdb", action="store_false", dest="store_duckdb",
        help="Disable storing to DuckDB"
    )
    ap.add_argument(
        "--run-name",
        help="Optional name for the backtest run (default: auto-generated)"
    )

    args = ap.parse_args()

    # Compute default dates if not provided
    now = datetime.now(UTC)
    if args.date_from:
        date_from = parse_yyyy_mm_dd(args.date_from)
    else:
        date_from = (now - timedelta(days=30)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

    if args.date_to:
        date_to = parse_yyyy_mm_dd(args.date_to)
    else:
        date_to = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Compute output CSV path
    if args.out_csv:
        out_csv = args.out_csv
    else:
        date_str = now.strftime("%Y%m%d")
        out_csv = os.path.join(
            args.out_dir,
            f"backtest_{date_str}_{args.interval_seconds}s_{args.horizon_hours}h.csv",
        )

    cfg = ClickHouseCfg(
        host=args.ch_host,
        port=args.ch_port,
        database=args.ch_db,
        table=args.ch_table,
        user=args.ch_user,
        password=args.ch_pass,
        connect_timeout=args.ch_connect_timeout,
        send_receive_timeout=args.ch_timeout_s,
    )

    horizon = timedelta(hours=args.horizon_hours)

    def log(msg: str) -> None:
        if args.output_format != "json":
            print(msg, file=sys.stderr)

    # ─────────────────────────────────────────────────────────────
    # STEP 1: Load alerts from DuckDB
    # ─────────────────────────────────────────────────────────────
    log(f"[1/5] Loading alerts from {args.duckdb}...")
    try:
        alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
    except Exception as e:
        if args.output_format == "json":
            print(json.dumps({"success": False, "error": str(e), "summary": None, "csv_path": None}))
            sys.exit(1)
        raise

    if not alerts:
        error_msg = f"No alerts found for {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}"
        if args.output_format == "json":
            print(json.dumps({"success": False, "error": error_msg, "summary": None, "csv_path": None}))
            sys.exit(1)
        raise SystemExit(error_msg)

    log(f"    Found {len(alerts)} alerts")
    unique_mints = set(a.mint for a in alerts)
    log(f"    Unique tokens: {len(unique_mints)}")

    # ─────────────────────────────────────────────────────────────
    # STEP 2: Query coverage from ClickHouse (ONE query)
    # ─────────────────────────────────────────────────────────────
    # Compute slice hash for caching
    slice_hash = hashlib.md5(
        f"{args.chain}:{date_from}:{date_to}:{args.interval_seconds}:{args.horizon_hours}:{sorted(unique_mints)}".encode()
    ).hexdigest()[:12]
    slice_path = Path(args.slice_dir) / f"slice_{slice_hash}.parquet"

    if args.reuse_slice and slice_path.exists():
        log(f"[2/5] Reusing existing slice: {slice_path}")
        # Load covered mints from slice - assume all alerts with data in slice are covered
        conn = duckdb.connect(":memory:")
        covered_mints_rows = conn.execute(
            f"SELECT DISTINCT token_address FROM '{slice_path}'"
        ).fetchall()
        conn.close()
        covered_mints_set = {row[0] for row in covered_mints_rows}
        # For reuse mode, filter by mint presence (can't check per-alert without re-querying)
        covered_alerts = [a for a in alerts if a.mint in covered_mints_set]
        skipped_alerts = [a for a in alerts if a.mint not in covered_mints_set]
        log(f"    Tokens in slice: {len(covered_mints_set)}")
    else:
        log(f"[2/5] Querying per-alert coverage from ClickHouse...")
        try:
            # Use per-alert coverage check: each alert needs coverage from alert_ts to alert_ts + horizon
            covered_alert_keys = query_coverage_per_alert(
                cfg,
                args.chain,
                alerts,
                args.interval_seconds,
                horizon,
                args.min_coverage_pct,
            )
        except Exception as e:
            if args.output_format == "json":
                print(json.dumps({"success": False, "error": f"ClickHouse coverage query failed: {e}", "summary": None, "csv_path": None}))
                sys.exit(1)
            raise

        log(f"    Alerts with sufficient coverage: {len(covered_alert_keys)} / {len(alerts)}")
        
        # Filter alerts by (mint, ts_ms) key
        covered_alerts = [a for a in alerts if (a.mint, a.ts_ms) in covered_alert_keys]
        skipped_alerts = [a for a in alerts if (a.mint, a.ts_ms) not in covered_alert_keys]

    # ─────────────────────────────────────────────────────────────
    # STEP 3: Summary of coverage filtering
    # ─────────────────────────────────────────────────────────────
    log(f"[3/5] Filtering alerts to covered tokens...")
    log(f"    Covered alerts: {len(covered_alerts)}")
    log(f"    Skipped (no coverage): {len(skipped_alerts)}")

    if not covered_alerts:
        error_msg = "No alerts have sufficient candle coverage"
        if args.output_format == "json":
            print(json.dumps({
                "success": False,
                "error": error_msg,
                "summary": {
                    "alerts_total": len(alerts),
                    "alerts_ok": 0,
                    "alerts_missing": len(alerts),
                },
                "csv_path": None,
            }))
            sys.exit(1)
        raise SystemExit(error_msg)

    # ─────────────────────────────────────────────────────────────
    # STEP 4: Export slice to Parquet (if not reusing)
    # ─────────────────────────────────────────────────────────────
    if not (args.reuse_slice and slice_path.exists()):
        log(f"[4/5] Exporting slice to {slice_path}...")
        covered_mints = set(a.mint for a in covered_alerts)
        
        # Calculate export range based on actual covered alerts
        earliest_alert_ts = min(a.ts_ms for a in covered_alerts)
        latest_alert_ts = max(a.ts_ms for a in covered_alerts)
        export_from = datetime.fromtimestamp(earliest_alert_ts / 1000.0, tz=UTC)
        export_to = datetime.fromtimestamp(latest_alert_ts / 1000.0, tz=UTC) + horizon
        
        try:
            row_count = export_slice_to_parquet(
                cfg,
                args.chain,
                covered_mints,
                args.interval_seconds,
                export_from,
                export_to,
                slice_path,
            )
            log(f"    Exported {row_count} candles to Parquet")
        except Exception as e:
            if args.output_format == "json":
                print(json.dumps({"success": False, "error": f"Slice export failed: {e}", "summary": None, "csv_path": None}))
                sys.exit(1)
            raise
    else:
        log(f"[4/5] Skipped (reusing slice)")

    # ─────────────────────────────────────────────────────────────
    # STEP 5: Run backtest from Parquet (OFFLINE - no ClickHouse)
    # ─────────────────────────────────────────────────────────────
    log(f"[5/5] Running backtest from Parquet...")

    os.makedirs(os.path.dirname(out_csv) or ".", exist_ok=True)

    fieldnames = [
        "mint",
        "caller",
        "alert_ts_utc",
        "entry_ts_utc",
        "interval_seconds",
        "horizon_hours",
        "status",
        "candles",
        "entry_price",
        "ath_mult",
        "time_to_ath_s",
        "time_to_2x_s",
        "time_to_3x_s",
        "time_to_4x_s",
        "dd_initial",
        "dd_overall",
        "dd_pre2x",
        "dd_after_2x",
        "dd_after_3x",
        "dd_after_4x",
        "dd_after_ath",
        "peak_pnl_pct",
        "ret_end",
        "tp_sl_exit_reason",
        "tp_sl_ret",
        "tg_exit_reason",
        "tg_ret",
        "tg_passed_gate",
    ]

    rows_out: List[Dict[str, Any]] = []

    # Generate worklist for missing OHLCV data
    worklist_path = Path(args.out_dir) / f"worklist_missing_ohlcv_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.json"
    worklist = []
    
    # Query detailed coverage for skipped alerts to generate worklist
    if skipped_alerts:
        log(f"[2.5/5] Generating worklist for {len(skipped_alerts)} alerts with missing OHLCV data...")
        skipped_mints = set(a.mint for a in skipped_alerts)
        try:
            detailed_coverage = query_coverage_detailed(
                cfg,
                args.chain,
                skipped_mints,
                args.interval_seconds,
                date_from,
                date_to + horizon,
            )
            
            # Group alerts by mint to identify missing periods
            alerts_by_mint: Dict[str, List[Alert]] = {}
            for a in skipped_alerts:
                if a.mint not in alerts_by_mint:
                    alerts_by_mint[a.mint] = []
                alerts_by_mint[a.mint].append(a)
            
            for mint, mint_alerts in alerts_by_mint.items():
                cov_info = detailed_coverage.get(mint, {})
                candle_count = cov_info.get("candle_count", 0)
                first_ts = cov_info.get("first_timestamp")
                last_ts = cov_info.get("last_timestamp")
                
                # Calculate required time window for each alert
                for alert in mint_alerts:
                    alert_ts = alert.ts
                    required_start = alert_ts
                    required_end = alert_ts + horizon
                    
                    worklist_entry = {
                        "mint": mint,
                        "caller": alert.caller,
                        "alert_ts_utc": dt_to_ch(alert_ts),
                        "required_start_utc": dt_to_ch(required_start),
                        "required_end_utc": dt_to_ch(required_end),
                        "interval_seconds": args.interval_seconds,
                        "horizon_hours": args.horizon_hours,
                        "current_candle_count": candle_count,
                        "has_data": candle_count > 0,
                        "first_available_ts": dt_to_ch(first_ts) if first_ts else None,
                        "last_available_ts": dt_to_ch(last_ts) if last_ts else None,
                    }
                    worklist.append(worklist_entry)
        except Exception as e:
            log(f"    Warning: Could not generate detailed worklist: {e}")
            # Fallback: simple worklist
            for a in skipped_alerts:
                worklist.append({
                    "mint": a.mint,
                    "caller": a.caller,
                    "alert_ts_utc": dt_to_ch(a.ts),
                    "required_start_utc": dt_to_ch(a.ts),
                    "required_end_utc": dt_to_ch(a.ts + horizon),
                    "interval_seconds": args.interval_seconds,
                    "horizon_hours": args.horizon_hours,
                    "current_candle_count": 0,
                    "has_data": False,
                })
    
    # Write worklist to JSON file
    if worklist:
        os.makedirs(os.path.dirname(worklist_path) or ".", exist_ok=True)
        with open(worklist_path, "w") as f:
            json.dump({
                "generated_at": datetime.now(UTC).isoformat(),
                "date_range": {
                    "from": date_from.strftime("%Y-%m-%d"),
                    "to": date_to.strftime("%Y-%m-%d"),
                },
                "chain": args.chain,
                "interval_seconds": args.interval_seconds,
                "horizon_hours": args.horizon_hours,
                "total_missing": len(worklist),
                "entries": worklist,
            }, f, indent=2)
        log(f"    Worklist written: {worklist_path}")

    # Add skipped alerts as "no_coverage"
    for a in skipped_alerts:
        rows_out.append({
            "mint": a.mint,
            "caller": a.caller,
            "alert_ts_utc": dt_to_ch(a.ts),
            "entry_ts_utc": "",
            "interval_seconds": args.interval_seconds,
            "horizon_hours": args.horizon_hours,
            "status": "no_coverage",
            "candles": 0,
        })

    # TUI config for dashboard
    tui_config = {
        "date_from": date_from.strftime("%Y-%m-%d"),
        "date_to": date_to.strftime("%Y-%m-%d"),
        "interval_seconds": args.interval_seconds,
        "horizon_hours": args.horizon_hours,
    }

    def process_alert(a: Alert) -> Dict[str, Any]:
        """Process a single alert and return result dict."""
        alert_ts = a.ts
        entry_ts = ceil_to_interval(alert_ts, args.interval_seconds)
        end_ts = entry_ts + horizon

        base = {
            "mint": a.mint,
            "caller": a.caller,
            "alert_ts_utc": dt_to_ch(alert_ts),
            "entry_ts_utc": dt_to_ch(entry_ts),
            "interval_seconds": args.interval_seconds,
            "horizon_hours": args.horizon_hours,
        }

        try:
            candles = load_candles_from_parquet(slice_path, a.mint, entry_ts, end_ts)

            if len(candles) < 2:
                return {**base, "status": "missing", "candles": len(candles)}

            entry_price = candles[0].o
            if entry_price <= 0:
                return {
                    **base,
                    "status": "bad_entry",
                    "candles": len(candles),
                    "entry_price": entry_price,
                }

            core = compute_core_metrics(entry_price, candles)
            
            # Simulate TP/SL policy
            tp_sl = simulate_tp_sl(
                entry_price,
                candles,
                args.tp_mult,
                args.sl_mult,
                args.intrabar_order,
                args.fee_bps,
                args.slippage_bps,
            )
            
            # Simulate time-gate TP/SL policy (if enabled)
            tg_results = {}
            if args.time_gate:
                tg_results = simulate_time_gate_tp_sl(
                    entry_price,
                    candles,
                    entry_ts,
                    args.tp_mult,
                    args.sl_mult,
                    args.gate_minutes,
                    args.min_gain_pct,
                    args.intrabar_order,
                    args.fee_bps,
                    args.slippage_bps,
                )
            
            return {
                **base,
                "status": "ok",
                "candles": len(candles),
                "entry_price": entry_price,
                **core,
                **tp_sl,
                **tg_results,
            }
        except Exception as e:
            return {**base, "status": "error", "error": str(e)}

    # Determine log file path
    if args.log_file:
        log_file_path = Path(args.log_file)
    else:
        date_str = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        log_file_path = Path(args.out_dir) / f"backtest_{date_str}.log"

    # Check if TUI mode is enabled and rich is available
    use_tui = args.tui and RICH_AVAILABLE and args.output_format != "json"

    if use_tui:
        # TUI mode with live dashboard + file logging
        total_alerts = len(covered_alerts) + len(skipped_alerts)
        logger = BacktestLogger(log_file_path)
        tui = BacktestTUI(total_alerts, tui_config, logger)

        # Log startup info
        logger.write(f"=== Backtest started ===")
        logger.write(f"Date range: {tui_config['date_from']} to {tui_config['date_to']}")
        logger.write(f"Alerts: {len(covered_alerts)} covered, {len(skipped_alerts)} skipped")
        logger.write(f"---")

        # Pre-populate skipped alerts in TUI
        for row in rows_out:
            tui.update(row)

        try:
            # Process alerts in parallel batches for TUI mode
            done_lock = Lock()
            
            def process_alert_with_tui(a: Alert) -> Dict[str, Any]:
                result = process_alert(a)
                with done_lock:
                    rows_out.append(result)
                    tui.update(result)
                return result
            
            with Live(tui.render(), console=tui.console, refresh_per_second=4) as live:
                # Process in parallel batches
                batch_size = args.threads
                for i in range(0, len(covered_alerts), batch_size):
                    batch = covered_alerts[i:i + batch_size]
                    with ThreadPoolExecutor(max_workers=args.threads) as executor:
                        futures = {executor.submit(process_alert_with_tui, a): a for a in batch}
                        for future in as_completed(futures):
                            try:
                                future.result()
                            except Exception as e:
                                alert = futures[future]
                                result = {
                                    "mint": alert.mint,
                                    "caller": alert.caller,
                                    "alert_ts_utc": dt_to_ch(alert.ts),
                                    "entry_ts_utc": "",
                                    "interval_seconds": args.interval_seconds,
                                    "horizon_hours": args.horizon_hours,
                                    "status": "error",
                                    "error": str(e),
                                }
                                with done_lock:
                                    rows_out.append(result)
                                    tui.update(result)
                            live.update(tui.render())

            # Log completion
            logger.write(f"---")
            logger.write(f"=== Backtest complete ===")
            logger.write(f"Results: {out_csv}")
        finally:
            logger.close()

        log(f"Activity log: {log_file_path}")
    else:
        # Standard mode with parallelization
        done = 0
        done_lock = Lock()
        
        def process_alert_with_lock(a: Alert) -> Dict[str, Any]:
            result = process_alert(a)
            nonlocal done
            with done_lock:
                done += 1
                if done % 100 == 0:
                    log(f"    Progress: {done}/{len(covered_alerts)} alerts")
            return result
        
        # Process alerts in parallel using ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=args.threads) as executor:
            futures = {executor.submit(process_alert_with_lock, a): a for a in covered_alerts}
            for future in as_completed(futures):
                try:
                    result = future.result()
                    rows_out.append(result)
                except Exception as e:
                    alert = futures[future]
                    rows_out.append({
                        "mint": alert.mint,
                        "caller": alert.caller,
                        "alert_ts_utc": dt_to_ch(alert.ts),
                        "entry_ts_utc": "",
                        "interval_seconds": args.interval_seconds,
                        "horizon_hours": args.horizon_hours,
                        "status": "error",
                        "error": str(e),
                    })

    # Write CSV
    with open(out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows_out:
            w.writerow(row)

    # Compute summary
    s = summarize(rows_out)

    # Generate run_id (always, even if not storing to DuckDB)
    run_id = str(uuid.uuid4())
    
    # Store to DuckDB if requested
    if args.store_duckdb:
        run_name = args.run_name or f"baseline_{date_from.strftime('%Y%m%d')}_{date_to.strftime('%Y%m%d')}_{args.interval_seconds}s"
        config_dict = {
            "date_from": date_from.strftime("%Y-%m-%d"),
            "date_to": date_to.strftime("%Y-%m-%d"),
            "interval_seconds": args.interval_seconds,
            "horizon_hours": args.horizon_hours,
            "chain": args.chain,
            "tp_mult": args.tp_mult,
            "sl_mult": args.sl_mult,
            "fee_bps": args.fee_bps,
            "slippage_bps": args.slippage_bps,
            "min_coverage_pct": args.min_coverage_pct,
        }
        try:
            store_run_to_duckdb(args.duckdb, run_id, run_name, config_dict, rows_out, s)
            if args.output_format != "json":
                print(f"[DuckDB] Stored run to bt.* schema: run_id={run_id}")
        except Exception as e:
            if args.output_format != "json":
                print(f"[DuckDB] Warning: Failed to store run: {e}", file=sys.stderr)
            # Don't fail the whole backtest if DuckDB storage fails

    if args.output_format == "json":
        result = {
            "success": True,
            "error": None,
            "run_id": run_id,
            "csv_path": out_csv,
            "slice_path": str(slice_path),
            "log_path": str(log_file_path),
            "worklist_path": str(worklist_path) if worklist else None,
            "stored_to_duckdb": args.store_duckdb,
            "summary": {
                "alerts_total": s["alerts_total"],
                "alerts_ok": s["alerts_ok"],
                "alerts_missing": s["alerts_missing"],
                "median_ath_mult": s["median_ath_mult"],
                "median_time_to_ath_hours": (
                    s["median_time_to_ath_s"] / 3600.0
                    if s["median_time_to_ath_s"] is not None
                    else None
                ),
                "median_time_to_2x_hours": (
                    s["median_time_to_2x_s"] / 3600.0
                    if s["median_time_to_2x_s"] is not None
                    else None
                ),
                "median_time_to_3x_hours": (
                    s["median_time_to_3x_s"] / 3600.0
                    if s["median_time_to_3x_s"] is not None
                    else None
                ),
                "median_dd_initial_pct": (
                    pct(s["median_dd_initial"])
                    if s.get("median_dd_initial") is not None
                    else None
                ),
                "median_dd_overall_pct": (
                    pct(s["median_dd_overall"])
                    if s["median_dd_overall"] is not None
                    else None
                ),
                "median_dd_after_2x_pct": (
                    pct(s["median_dd_after_2x"])
                    if s["median_dd_after_2x"] is not None
                    else None
                ),
                "median_dd_after_3x_pct": (
                    pct(s["median_dd_after_3x"])
                    if s["median_dd_after_3x"] is not None
                    else None
                ),
                "median_peak_pnl_pct": (
                    s["median_peak_pnl_pct"]
                    if s["median_peak_pnl_pct"] is not None
                    else None
                ),
                "median_ret_end_pct": (
                    pct(s["median_ret_end"])
                    if s["median_ret_end"] is not None
                    else None
                ),
                "pct_hit_2x": pct(s["pct_hit_2x"]),
                "median_peak_pnl_pct": s["median_peak_pnl_pct"],
                # TP/SL policy metrics
                "tp_sl_total_return_pct": s.get("tp_sl_total_return_pct"),
                "tp_sl_avg_return_pct": s.get("tp_sl_avg_return_pct"),
                "tp_sl_median_return_pct": s.get("tp_sl_median_return_pct"),
                "tp_sl_win_rate": s.get("tp_sl_win_rate"),
                "tp_sl_avg_win_pct": s.get("tp_sl_avg_win_pct"),
                "tp_sl_avg_loss_pct": s.get("tp_sl_avg_loss_pct"),
                "tp_sl_profit_factor": s.get("tp_sl_profit_factor"),
                "tp_sl_expectancy_pct": s.get("tp_sl_expectancy_pct"),
                "tp_sl_tp_exits": s.get("tp_sl_tp_exits"),
                "tp_sl_sl_exits": s.get("tp_sl_sl_exits"),
                "tp_sl_horizon_exits": s.get("tp_sl_horizon_exits"),
            },
            "config": {
                "date_from": date_from.strftime("%Y-%m-%d"),
                "date_to": date_to.strftime("%Y-%m-%d"),
                "interval_seconds": args.interval_seconds,
                "horizon_hours": args.horizon_hours,
                "chain": args.chain,
                "tp_mult": args.tp_mult,
                "sl_mult": args.sl_mult,
                "fee_bps": args.fee_bps,
                "slippage_bps": args.slippage_bps,
            },
        }
        print(json.dumps(result))
    else:
        print("\n" + "=" * 60)
        print("BACKTEST SUMMARY")
        print("=" * 60)
        print(f"Date range: {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}")
        print(f"Slice: {slice_path}")
        print(f"Alerts: {s['alerts_total']} total, {s['alerts_ok']} ok, {s['alerts_missing']} missing/skipped")
        if s["median_ath_mult"] is not None:
            print(f"Median ATH multiple: {s['median_ath_mult']:.3f}x")
        if s["median_time_to_ath_s"] is not None:
            print(f"Median time-to-ATH: {s['median_time_to_ath_s']/3600.0:.2f} hours")
        if s["median_time_to_2x_s"] is not None:
            print(f"Median time-to-2x: {s['median_time_to_2x_s']/3600.0:.2f} hours")
        if s["median_time_to_3x_s"] is not None:
            print(f"Median time-to-3x: {s['median_time_to_3x_s']/3600.0:.2f} hours")
        if s.get("median_dd_initial") is not None:
            print(f"Median initial dip (before recovery): {pct(s['median_dd_initial']):.2f}%")
        if s["median_dd_overall"] is not None:
            print(f"Median max drawdown (overall): {pct(s['median_dd_overall']):.2f}%")
        if s["median_dd_after_2x"] is not None:
            print(f"Median drawdown after 2x: {pct(s['median_dd_after_2x']):.2f}%")
        if s["median_dd_after_3x"] is not None:
            print(f"Median drawdown after 3x: {pct(s['median_dd_after_3x']):.2f}%")
        if s["median_peak_pnl_pct"] is not None:
            print(f"Median peak PNL: {s['median_peak_pnl_pct']:.2f}%")
        if s["median_ret_end"] is not None:
            print(f"Median return (hold-to-horizon): {pct(s['median_ret_end']):.2f}%")
        print(f"% that hit 2x: {pct(s['pct_hit_2x']):.2f}%")
        if s["median_peak_pnl_pct"] is not None:
            print(f"Median peak PnL: {s['median_peak_pnl_pct']:.2f}%")
        
        # TP/SL Policy Results
        print()
        print("-" * 40)
        print(f"TP/SL POLICY: TP={args.tp_mult}x, SL={args.sl_mult}x")
        print("-" * 40)
        print(f"Exit breakdown: TP={s.get('tp_sl_tp_exits', 0)}, SL={s.get('tp_sl_sl_exits', 0)}, Horizon={s.get('tp_sl_horizon_exits', 0)}")
        print(f"Win rate: {pct(s.get('tp_sl_win_rate', 0)):.1f}%")
        print(f"Avg win: +{s.get('tp_sl_avg_win_pct', 0):.2f}%  |  Avg loss: {s.get('tp_sl_avg_loss_pct', 0):.2f}%")
        print(f"Profit factor: {s.get('tp_sl_profit_factor', 0):.2f}")
        print(f"Expectancy per trade: {s.get('tp_sl_expectancy_pct', 0):.2f}%")
        print(f"Total return (equal sizing): {s.get('tp_sl_total_return_pct', 0):.1f}%")
        print(f"Median trade return: {s.get('tp_sl_median_return_pct', 0):.2f}%")
        print("-" * 40)
        
        print(f"\nResults: {out_csv}")


if __name__ == "__main__":
    main()
