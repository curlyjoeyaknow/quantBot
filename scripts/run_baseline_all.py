#!/usr/bin/env python3
"""
Complete Baseline Backtest Pipeline (per-token parallel)

End-to-end workflow:
1. Load alerts from DuckDB
2. Export per-token candle slices from ClickHouse (parallel)
3. Run vectorized baseline backtest per token (parallel)
4. Aggregate results by caller for leaderboard
5. Optionally store to DuckDB

NO strategies. NO TP/SL. Pure price-path analysis only.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any, Dict, List, Optional, Set, Tuple

import duckdb

try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    ClickHouseClient = None

UTC = timezone.utc


# =============================================================================
# Helpers
# =============================================================================

def parse_yyyy_mm_dd(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)

def ms_to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000.0, tz=UTC)

def ceil_ms_to_interval_ts_ms(ts_ms: int, interval_seconds: int) -> int:
    step = interval_seconds * 1000
    return ((ts_ms + step - 1) // step) * step

def pct(x: float) -> float:
    return 100.0 * x

def _sql_escape(s: str) -> str:
    return s.replace("'", "''")

def dt_to_ch(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")

def _fmt(x: Any, kind: str = "num") -> str:
    if x is None:
        return "-"
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return "-"
    if kind == "pct":
        return f"{x:6.2f}%"
    if kind == "x":
        return f"{x:6.2f}x"
    if kind == "int":
        return f"{int(x):6d}"
    if kind == "hrs":
        return f"{x:6.2f}h"
    if kind == "mins":
        # Format as hours if >= 60 mins, otherwise mins
        if x >= 60:
            return f"{x/60:.1f}h"
        return f"{x:.0f}m"
    if kind == "num":
        return f"{x:8.4f}"
    return str(x)

def parse_utc_ts(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)

def safe_filename(mint: str) -> str:
    if len(mint) > 16:
        return f"{mint[:8]}_{mint[-4:]}"
    return mint


# =============================================================================
# Alert Loading
# =============================================================================

@dataclass(frozen=True)
class Alert:
    mint: str
    ts_ms: int
    caller: str

    @property
    def ts(self) -> datetime:
        return datetime.fromtimestamp(self.ts_ms / 1000.0, tz=UTC)

def duckdb_table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    q = "SELECT COUNT(*)::INT FROM information_schema.tables WHERE table_name = ?"
    return conn.execute(q, [table_name]).fetchone()[0] > 0

def load_alerts(duckdb_path: str, chain: str, date_from: datetime, date_to: datetime) -> List[Alert]:
    conn = duckdb.connect(duckdb_path, read_only=True)
    from_ms = int(date_from.timestamp() * 1000)
    to_ms_excl = int((date_to + timedelta(days=1)).timestamp() * 1000)

    has_caller_links = duckdb_table_exists(conn, "caller_links_d")
    has_user_calls = duckdb_table_exists(conn, "user_calls_d")

    if not has_caller_links and not has_user_calls:
        raise SystemExit(f"No alerts source found in DuckDB: {duckdb_path}")

    alerts: List[Alert] = []

    if has_caller_links:
        cols = [r[1].lower() for r in conn.execute("PRAGMA table_info('caller_links_d')").fetchall()]
        has_chain = "chain" in cols

        if "caller_name" in cols and "trigger_from_name" in cols:
            caller_expr = "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller"
        elif "caller_name" in cols:
            caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
        elif "trigger_from_name" in cols:
            caller_expr = "COALESCE(trigger_from_name, '')::TEXT AS caller"
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

        for mint, ts_ms, caller in conn.execute(sql, params).fetchall():
            if mint:
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=(caller or "").strip()))

    if (not alerts) and has_user_calls:
        cols = [r[1].lower() for r in conn.execute("PRAGMA table_info('user_calls_d')").fetchall()]
        has_chain = "chain" in cols
        ts_col = "call_ts_ms" if "call_ts_ms" in cols else ("trigger_ts_ms" if "trigger_ts_ms" in cols else None)
        if ts_col is None:
            raise SystemExit(f"No timestamp column found in user_calls_d: {cols}")

        if "caller_name" in cols and "trigger_from_name" in cols:
            caller_expr = "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller"
        elif "caller_name" in cols:
            caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
        elif "trigger_from_name" in cols:
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

        for mint, ts_ms, caller in conn.execute(sql, params).fetchall():
            if mint:
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=(caller or "").strip()))

    conn.close()
    alerts.sort(key=lambda a: (a.ts_ms, a.mint))
    return alerts


# =============================================================================
# ClickHouse Config
# =============================================================================

@dataclass(frozen=True)
class ClickHouseCfg:
    host: str
    port: int
    database: str
    table: str
    user: str
    password: str
    connect_timeout: int = 10
    send_receive_timeout: int = 120

    def get_client(self):
        if ClickHouseClient is None:
            raise SystemExit("clickhouse-driver not installed. Run: pip install clickhouse-driver")
        return ClickHouseClient(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            connect_timeout=self.connect_timeout,
            send_receive_timeout=self.send_receive_timeout,
        )


# =============================================================================
# Per-Token Export + Backtest (single function for thread)
# =============================================================================

@dataclass
class TokenResult:
    """Result for a single alert."""
    alert_id: int
    mint: str
    caller: str
    alert_ts_ms: int
    entry_ts_ms: int
    status: str
    candles: int
    entry_price: Optional[float]
    ath_mult: Optional[float]
    time_to_ath_s: Optional[int]
    time_to_recovery_s: Optional[int]  # time to first go above entry price
    time_to_2x_s: Optional[int]
    time_to_3x_s: Optional[int]
    time_to_4x_s: Optional[int]
    time_to_5x_s: Optional[int]
    time_to_10x_s: Optional[int]
    time_to_dd_pre2x_s: Optional[int]  # time to min dd before 2x (or horizon end)
    time_to_dd_after_2x_s: Optional[int]  # time to min dd after 2x
    time_to_dd_after_3x_s: Optional[int]  # time to min dd after 3x
    dd_initial: Optional[float]
    dd_overall: Optional[float]
    dd_pre2x: Optional[float]  # NULL if no 2x hit (only for 2x-hitters)
    dd_pre2x_or_horizon: Optional[float]  # min dd up to 2x OR end of horizon (defined for all)
    dd_after_2x: Optional[float]
    dd_after_3x: Optional[float]
    dd_after_4x: Optional[float]
    dd_after_5x: Optional[float]
    dd_after_10x: Optional[float]
    dd_after_ath: Optional[float]
    peak_pnl_pct: Optional[float]
    ret_end_pct: Optional[float]


def process_single_alert(
    alert_id: int,
    alert: Alert,
    ch_cfg: ClickHouseCfg,
    chain: str,
    interval_seconds: int,
    horizon_hours: int,
    pre_window_minutes: int,
    slice_dir: Path,
    reuse_slice: bool,
    entry_mode: str = "next_open",
    slippage_bps: float = 0.0,
) -> TokenResult:
    """
    Export candles for one token and compute path metrics.
    Runs in a thread.
    """
    horizon_s = horizon_hours * 3600
    entry_ts_ms = ceil_ms_to_interval_ts_ms(alert.ts_ms, interval_seconds)
    end_ts_ms = entry_ts_ms + (horizon_s * 1000)

    alert_dt = ms_to_dt(alert.ts_ms)
    start_time = alert_dt - timedelta(minutes=pre_window_minutes)
    end_time = ms_to_dt(end_ts_ms)

    # Slice filename
    date_str = alert_dt.strftime("%Y%m%d_%H%M")
    filename = f"{date_str}_{safe_filename(alert.mint)}.parquet"
    slice_path = slice_dir / filename

    # Export if needed
    if not reuse_slice or not slice_path.exists():
        try:
            candle_count = export_token_slice(
                ch_cfg, chain, alert.mint, interval_seconds, start_time, end_time, slice_path
            )
            if candle_count == 0:
                return TokenResult(
                    alert_id=alert_id, mint=alert.mint, caller=alert.caller,
                    alert_ts_ms=alert.ts_ms, entry_ts_ms=entry_ts_ms,
                    status="missing", candles=0, entry_price=None,
                    ath_mult=None, time_to_ath_s=None, time_to_recovery_s=None,
                    time_to_2x_s=None, time_to_3x_s=None, time_to_4x_s=None,
                    time_to_5x_s=None, time_to_10x_s=None,
                    time_to_dd_pre2x_s=None, time_to_dd_after_2x_s=None, time_to_dd_after_3x_s=None,
                    dd_initial=None, dd_overall=None, dd_pre2x=None, dd_pre2x_or_horizon=None,
                    dd_after_2x=None, dd_after_3x=None, dd_after_4x=None,
                    dd_after_5x=None, dd_after_10x=None, dd_after_ath=None,
                    peak_pnl_pct=None, ret_end_pct=None,
                )
        except Exception as e:
            return TokenResult(
                alert_id=alert_id, mint=alert.mint, caller=alert.caller,
                alert_ts_ms=alert.ts_ms, entry_ts_ms=entry_ts_ms,
                status=f"error:{str(e)[:50]}", candles=0, entry_price=None,
                ath_mult=None, time_to_ath_s=None, time_to_recovery_s=None,
                time_to_2x_s=None, time_to_3x_s=None, time_to_4x_s=None,
                time_to_5x_s=None, time_to_10x_s=None,
                time_to_dd_pre2x_s=None, time_to_dd_after_2x_s=None, time_to_dd_after_3x_s=None,
                dd_initial=None, dd_overall=None, dd_pre2x=None, dd_pre2x_or_horizon=None,
                dd_after_2x=None, dd_after_3x=None, dd_after_4x=None,
                dd_after_5x=None, dd_after_10x=None, dd_after_ath=None,
                peak_pnl_pct=None, ret_end_pct=None,
            )

    # Run backtest on the slice
    return run_single_token_backtest(
        alert_id, alert, slice_path, interval_seconds, entry_ts_ms, end_ts_ms,
        entry_mode, slippage_bps
    )


def export_token_slice(
    cfg: ClickHouseCfg,
    chain: str,
    mint: str,
    interval_seconds: int,
    start_time: datetime,
    end_time: datetime,
    output_path: Path,
) -> int:
    """Export candles for a single token. Returns row count."""
    chain_q = _sql_escape(chain)
    mint_q = _sql_escape(mint)

    sql = f"""
SELECT
  token_address,
  timestamp,
  any(open) as open,
  any(high) as high,
  any(low) as low,
  any(close) as close,
  any(volume) as volume
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address = '{mint_q}'
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(start_time)}')
  AND timestamp < toDateTime('{dt_to_ch(end_time)}')
GROUP BY token_address, timestamp
ORDER BY timestamp
""".strip()

    client = cfg.get_client()
    result = client.execute(sql, with_column_types=True)
    rows_data, _ = result

    if not rows_data:
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)

    conn = duckdb.connect(":memory:")
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
    conn.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", rows_data)
    conn.execute(f"COPY candles TO '{output_path}' (FORMAT PARQUET, COMPRESSION 'zstd')")
    count = conn.execute("SELECT count(*) FROM candles").fetchone()[0]
    conn.close()

    return count


def run_single_token_backtest(
    alert_id: int,
    alert: Alert,
    slice_path: Path,
    interval_seconds: int,
    entry_ts_ms: int,
    end_ts_ms: int,
    entry_mode: str = "next_open",
    slippage_bps: float = 0.0,
) -> TokenResult:
    """Run path metrics on a single token slice.
    
    Entry modes:
    - next_open: Open of first candle after alert (default, clean)
    - close: Close of first candle (different entry time semantics)
    - worst_high: High of first candle (worst-case stress test)
    
    Slippage is applied as: entry_price * (1 + slippage_bps / 10000)
    """
    if not slice_path.exists():
        return TokenResult(
            alert_id=alert_id, mint=alert.mint, caller=alert.caller,
            alert_ts_ms=alert.ts_ms, entry_ts_ms=entry_ts_ms,
            status="missing", candles=0, entry_price=None,
            ath_mult=None, time_to_ath_s=None, time_to_recovery_s=None,
            time_to_2x_s=None, time_to_3x_s=None, time_to_4x_s=None,
            time_to_5x_s=None, time_to_10x_s=None,
            time_to_dd_pre2x_s=None, time_to_dd_after_2x_s=None, time_to_dd_after_3x_s=None,
            dd_initial=None, dd_overall=None, dd_pre2x=None, dd_pre2x_or_horizon=None,
            dd_after_2x=None, dd_after_3x=None, dd_after_4x=None,
            dd_after_5x=None, dd_after_10x=None, dd_after_ath=None,
            peak_pnl_pct=None, ret_end_pct=None,
        )

    con = duckdb.connect(":memory:")
    try:
        entry_ts = ms_to_dt(entry_ts_ms)
        end_ts = ms_to_dt(end_ts_ms)

        # Entry price expression based on mode
        # next_open: arg_min(o, ts) - open of first candle (default, clean)
        # close: arg_min(cl, ts) - close of first candle  
        # worst_high: arg_min(h, ts) - high of first candle (stress test)
        if entry_mode == "close":
            raw_entry_expr = "arg_min(cl, ts)"
        elif entry_mode == "worst_high":
            raw_entry_expr = "arg_min(h, ts)"
        else:  # next_open (default)
            raw_entry_expr = "arg_min(o, ts)"
        
        # Apply slippage: entry_price * (1 + slippage_bps / 10000)
        slippage_mult = 1.0 + (slippage_bps / 10000.0)
        entry_expr = f"({raw_entry_expr}) * {slippage_mult}"

        sql = f"""
WITH
candles AS (
  SELECT timestamp AS ts, open AS o, high AS h, low AS l, close AS cl
  FROM parquet_scan('{slice_path.as_posix()}')
  WHERE timestamp >= '{entry_ts.strftime('%Y-%m-%d %H:%M:%S')}'::TIMESTAMP
    AND timestamp < '{end_ts.strftime('%Y-%m-%d %H:%M:%S')}'::TIMESTAMP
  ORDER BY timestamp
),
entry AS (
  SELECT {entry_expr} AS entry_price, count(*)::BIGINT AS candles, min(ts) AS first_ts
  FROM candles
),
agg AS (
  SELECT
    e.entry_price, e.candles, e.first_ts,
    max(c.h) AS max_high,
    min(c.l) AS min_low,
    arg_max(c.cl, c.ts) AS end_close,
    min(c.ts) FILTER (WHERE c.h > e.entry_price) AS recovery_ts,
    min(c.ts) FILTER (WHERE c.h >= e.entry_price * 2.0) AS ts_2x,
    min(c.ts) FILTER (WHERE c.h >= e.entry_price * 3.0) AS ts_3x,
    min(c.ts) FILTER (WHERE c.h >= e.entry_price * 4.0) AS ts_4x,
    min(c.ts) FILTER (WHERE c.h >= e.entry_price * 5.0) AS ts_5x,
    min(c.ts) FILTER (WHERE c.h >= e.entry_price * 10.0) AS ts_10x
  FROM candles c, entry e
  GROUP BY e.entry_price, e.candles, e.first_ts
),
ath_cte AS (
  SELECT min(c.ts) AS ath_ts
  FROM candles c, agg a WHERE c.h = a.max_high
),
mins AS (
  SELECT
    -- Lowest low BEFORE first time price exceeds entry (recovery_ts)
    -- Clamp at entry_price so dd is always <= 0
    min(CASE WHEN a.recovery_ts IS NOT NULL AND c.ts < a.recovery_ts 
             THEN LEAST(c.l, a.entry_price) END) AS min_pre_recovery,
    -- Lowest low from entry UNTIL we hit 2x (measures dip on the way to 2x)
    min(CASE WHEN a.ts_2x IS NOT NULL AND c.ts < a.ts_2x 
             THEN LEAST(c.l, a.entry_price) END) AS min_pre2x,
    -- Lowest low up to 2x OR end of horizon (defined for everyone)
    min(CASE WHEN a.ts_2x IS NOT NULL AND c.ts < a.ts_2x THEN LEAST(c.l, a.entry_price)
             WHEN a.ts_2x IS NULL THEN LEAST(c.l, a.entry_price)
             END) AS min_pre2x_or_horizon,
    -- Lowest low AFTER hitting 2x (how far does it fall from 2x level)
    min(CASE WHEN a.ts_2x IS NOT NULL AND c.ts > a.ts_2x 
             THEN LEAST(c.l, a.entry_price * 2.0) END) AS min_post2x,
    min(CASE WHEN a.ts_3x IS NOT NULL AND c.ts > a.ts_3x 
             THEN LEAST(c.l, a.entry_price * 3.0) END) AS min_post3x,
    min(CASE WHEN a.ts_4x IS NOT NULL AND c.ts > a.ts_4x 
             THEN LEAST(c.l, a.entry_price * 4.0) END) AS min_post4x,
    min(CASE WHEN a.ts_5x IS NOT NULL AND c.ts > a.ts_5x 
             THEN LEAST(c.l, a.entry_price * 5.0) END) AS min_post5x,
    min(CASE WHEN a.ts_10x IS NOT NULL AND c.ts > a.ts_10x 
             THEN LEAST(c.l, a.entry_price * 10.0) END) AS min_post10x,
    min(CASE WHEN ath.ath_ts IS NOT NULL AND c.ts > ath.ath_ts 
             THEN LEAST(c.l, a.max_high) END) AS min_postath
  FROM candles c, agg a, ath_cte ath
),
-- Timestamps when the min dd values occur (for time-to-dd metrics)
min_times AS (
  SELECT
    -- Time to min dd before 2x (or horizon)
    min(CASE WHEN c.l = m.min_pre2x_or_horizon THEN c.ts END) AS ts_min_pre2x_or_horizon,
    -- Time to min dd after 2x
    min(CASE WHEN a.ts_2x IS NOT NULL AND c.ts > a.ts_2x AND c.l = m.min_post2x THEN c.ts END) AS ts_min_post2x,
    -- Time to min dd after 3x
    min(CASE WHEN a.ts_3x IS NOT NULL AND c.ts > a.ts_3x AND c.l = m.min_post3x THEN c.ts END) AS ts_min_post3x
  FROM candles c, agg a, mins m
)
SELECT
  a.candles,
  a.entry_price,
  (a.max_high / a.entry_price) AS ath_mult,
  EXTRACT(EPOCH FROM (ath.ath_ts - a.first_ts))::BIGINT AS time_to_ath_s,
  EXTRACT(EPOCH FROM (a.recovery_ts - a.first_ts))::BIGINT AS time_to_recovery_s,
  EXTRACT(EPOCH FROM (a.ts_2x - a.first_ts))::BIGINT AS time_to_2x_s,
  EXTRACT(EPOCH FROM (a.ts_3x - a.first_ts))::BIGINT AS time_to_3x_s,
  EXTRACT(EPOCH FROM (a.ts_4x - a.first_ts))::BIGINT AS time_to_4x_s,
  EXTRACT(EPOCH FROM (a.ts_5x - a.first_ts))::BIGINT AS time_to_5x_s,
  EXTRACT(EPOCH FROM (a.ts_10x - a.first_ts))::BIGINT AS time_to_10x_s,
  EXTRACT(EPOCH FROM (mt.ts_min_pre2x_or_horizon - a.first_ts))::BIGINT AS time_to_dd_pre2x_s,
  EXTRACT(EPOCH FROM (mt.ts_min_post2x - a.first_ts))::BIGINT AS time_to_dd_after_2x_s,
  EXTRACT(EPOCH FROM (mt.ts_min_post3x - a.first_ts))::BIGINT AS time_to_dd_after_3x_s,
  -- dd_initial: how far below entry before FIRST time price exceeds entry
  -- NULL if it never dipped before recovering (immediate recovery), 0 if never below entry
  CASE
    WHEN a.recovery_ts IS NULL THEN LEAST(0.0, (a.min_low / a.entry_price) - 1.0)
    WHEN m.min_pre_recovery IS NULL THEN 0.0
    ELSE (m.min_pre_recovery / a.entry_price) - 1.0
  END AS dd_initial,
  LEAST(0.0, (a.min_low / a.entry_price) - 1.0) AS dd_overall,
  -- dd_pre2x: how far below entry on the journey to 2x (only for tokens that hit 2x)
  -- NULL if no 2x, 0 if never dipped below entry before hitting 2x
  CASE WHEN a.ts_2x IS NULL THEN NULL
       WHEN m.min_pre2x IS NULL THEN 0.0
       ELSE (m.min_pre2x / a.entry_price) - 1.0 END AS dd_pre2x,
  -- dd_pre2x_or_horizon: min drawdown up to 2x OR end of horizon (defined for everyone)
  CASE WHEN m.min_pre2x_or_horizon IS NULL THEN 0.0
       ELSE (m.min_pre2x_or_horizon / a.entry_price) - 1.0 END AS dd_pre2x_or_horizon,
  CASE WHEN a.ts_2x IS NULL OR m.min_post2x IS NULL THEN NULL
       ELSE (m.min_post2x / (a.entry_price * 2.0)) - 1.0 END AS dd_after_2x,
  CASE WHEN a.ts_3x IS NULL OR m.min_post3x IS NULL THEN NULL
       ELSE (m.min_post3x / (a.entry_price * 3.0)) - 1.0 END AS dd_after_3x,
  CASE WHEN a.ts_4x IS NULL OR m.min_post4x IS NULL THEN NULL
       ELSE (m.min_post4x / (a.entry_price * 4.0)) - 1.0 END AS dd_after_4x,
  CASE WHEN a.ts_5x IS NULL OR m.min_post5x IS NULL THEN NULL
       ELSE (m.min_post5x / (a.entry_price * 5.0)) - 1.0 END AS dd_after_5x,
  CASE WHEN a.ts_10x IS NULL OR m.min_post10x IS NULL THEN NULL
       ELSE (m.min_post10x / (a.entry_price * 10.0)) - 1.0 END AS dd_after_10x,
  CASE WHEN ath.ath_ts IS NULL OR m.min_postath IS NULL THEN NULL
       ELSE (m.min_postath / a.max_high) - 1.0 END AS dd_after_ath,
  ((a.max_high / a.entry_price) - 1.0) * 100.0 AS peak_pnl_pct,
  ((a.end_close / a.entry_price) - 1.0) * 100.0 AS ret_end_pct
FROM agg a, ath_cte ath, mins m, min_times mt
"""
        row = con.execute(sql).fetchone()

        if row is None or row[0] is None or row[0] < 2:
            return TokenResult(
                alert_id=alert_id, mint=alert.mint, caller=alert.caller,
                alert_ts_ms=alert.ts_ms, entry_ts_ms=entry_ts_ms,
                status="missing", candles=int(row[0]) if row and row[0] else 0,
                entry_price=None, ath_mult=None, time_to_ath_s=None, time_to_recovery_s=None,
                time_to_2x_s=None, time_to_3x_s=None, time_to_4x_s=None,
                time_to_5x_s=None, time_to_10x_s=None,
                time_to_dd_pre2x_s=None, time_to_dd_after_2x_s=None, time_to_dd_after_3x_s=None,
                dd_initial=None, dd_overall=None, dd_pre2x=None, dd_pre2x_or_horizon=None,
                dd_after_2x=None, dd_after_3x=None, dd_after_4x=None,
                dd_after_5x=None, dd_after_10x=None, dd_after_ath=None,
                peak_pnl_pct=None, ret_end_pct=None,
            )

        entry_price = row[1]
        if entry_price is None or entry_price <= 0:
            return TokenResult(
                alert_id=alert_id, mint=alert.mint, caller=alert.caller,
                alert_ts_ms=alert.ts_ms, entry_ts_ms=entry_ts_ms,
                status="bad_entry", candles=int(row[0]),
                entry_price=entry_price, ath_mult=None, time_to_ath_s=None, time_to_recovery_s=None,
                time_to_2x_s=None, time_to_3x_s=None, time_to_4x_s=None,
                time_to_5x_s=None, time_to_10x_s=None,
                time_to_dd_pre2x_s=None, time_to_dd_after_2x_s=None, time_to_dd_after_3x_s=None,
                dd_initial=None, dd_overall=None, dd_pre2x=None, dd_pre2x_or_horizon=None,
                dd_after_2x=None, dd_after_3x=None, dd_after_4x=None,
                dd_after_5x=None, dd_after_10x=None, dd_after_ath=None,
                peak_pnl_pct=None, ret_end_pct=None,
            )

        return TokenResult(
            alert_id=alert_id,
            mint=alert.mint,
            caller=alert.caller,
            alert_ts_ms=alert.ts_ms,
            entry_ts_ms=entry_ts_ms,
            status="ok",
            candles=int(row[0]),
            entry_price=float(row[1]) if row[1] else None,
            ath_mult=float(row[2]) if row[2] else None,
            time_to_ath_s=int(row[3]) if row[3] else None,
            time_to_recovery_s=int(row[4]) if row[4] else None,
            time_to_2x_s=int(row[5]) if row[5] else None,
            time_to_3x_s=int(row[6]) if row[6] else None,
            time_to_4x_s=int(row[7]) if row[7] else None,
            time_to_5x_s=int(row[8]) if row[8] else None,
            time_to_10x_s=int(row[9]) if row[9] else None,
            time_to_dd_pre2x_s=int(row[10]) if row[10] else None,
            time_to_dd_after_2x_s=int(row[11]) if row[11] else None,
            time_to_dd_after_3x_s=int(row[12]) if row[12] else None,
            dd_initial=float(row[13]) if row[13] else None,
            dd_overall=float(row[14]) if row[14] else None,
            dd_pre2x=float(row[15]) if row[15] else None,
            dd_pre2x_or_horizon=float(row[16]) if row[16] else None,
            dd_after_2x=float(row[17]) if row[17] else None,
            dd_after_3x=float(row[18]) if row[18] else None,
            dd_after_4x=float(row[19]) if row[19] else None,
            dd_after_5x=float(row[20]) if row[20] else None,
            dd_after_10x=float(row[21]) if row[21] else None,
            dd_after_ath=float(row[22]) if row[22] else None,
            peak_pnl_pct=float(row[23]) if row[23] else None,
            ret_end_pct=float(row[24]) if row[24] else None,
        )
    finally:
        con.close()


# =============================================================================
# Parallel Processing
# =============================================================================

def run_parallel_backtest(
    alerts: List[Alert],
    ch_cfg: ClickHouseCfg,
    chain: str,
    interval_seconds: int,
    horizon_hours: int,
    pre_window_minutes: int,
    slice_dir: Path,
    reuse_slice: bool,
    threads: int,
    verbose: bool,
    entry_mode: str = "next_open",
    slippage_bps: float = 0.0,
) -> List[TokenResult]:
    """Run backtest on all alerts in parallel."""
    slice_dir.mkdir(parents=True, exist_ok=True)

    results: List[TokenResult] = []
    completed = 0
    total = len(alerts)

    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = {}
        for i, alert in enumerate(alerts, start=1):
            future = executor.submit(
                process_single_alert,
                i, alert, ch_cfg, chain, interval_seconds, horizon_hours,
                pre_window_minutes, slice_dir, reuse_slice, entry_mode, slippage_bps,
            )
            futures[future] = (i, alert)

        for future in as_completed(futures):
            alert_id, alert = futures[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                results.append(TokenResult(
                    alert_id=alert_id, mint=alert.mint, caller=alert.caller,
                    alert_ts_ms=alert.ts_ms, entry_ts_ms=0,
                    status=f"error:{str(e)[:50]}", candles=0, entry_price=None,
                    ath_mult=None, time_to_ath_s=None, time_to_recovery_s=None,
                    time_to_2x_s=None, time_to_3x_s=None, time_to_4x_s=None,
                    time_to_5x_s=None, time_to_10x_s=None,
                    time_to_dd_pre2x_s=None, time_to_dd_after_2x_s=None, time_to_dd_after_3x_s=None,
                    dd_initial=None, dd_overall=None, dd_pre2x=None, dd_pre2x_or_horizon=None,
                    dd_after_2x=None, dd_after_3x=None, dd_after_4x=None,
                    dd_after_5x=None, dd_after_10x=None, dd_after_ath=None,
                    peak_pnl_pct=None, ret_end_pct=None,
                ))

            completed += 1
            if verbose and completed % 50 == 0:
                print(f"      Progress: {completed}/{total} alerts processed", file=sys.stderr)

    results.sort(key=lambda r: r.alert_id)
    return results


# =============================================================================
# CSV Writing
# =============================================================================

def write_csv(path: str, fieldnames: List[str], rows: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


# =============================================================================
# Summary Statistics + Caller Aggregation
# =============================================================================

def results_to_dicts(results: List[TokenResult], interval_seconds: int, horizon_hours: int) -> List[Dict[str, Any]]:
    out = []
    for r in results:
        out.append({
            "alert_id": r.alert_id,
            "mint": r.mint,
            "caller": r.caller,
            "alert_ts_utc": ms_to_dt(r.alert_ts_ms).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_ts_utc": ms_to_dt(r.entry_ts_ms).strftime("%Y-%m-%d %H:%M:%S") if r.entry_ts_ms else None,
            "interval_seconds": interval_seconds,
            "horizon_hours": horizon_hours,
            "status": r.status,
            "candles": r.candles,
            "entry_price": r.entry_price,
            "ath_mult": r.ath_mult,
            "time_to_ath_s": r.time_to_ath_s,
            "time_to_recovery_s": r.time_to_recovery_s,
            "time_to_2x_s": r.time_to_2x_s,
            "time_to_3x_s": r.time_to_3x_s,
            "time_to_4x_s": r.time_to_4x_s,
            "time_to_5x_s": r.time_to_5x_s,
            "time_to_10x_s": r.time_to_10x_s,
            "time_to_dd_pre2x_s": r.time_to_dd_pre2x_s,
            "time_to_dd_after_2x_s": r.time_to_dd_after_2x_s,
            "time_to_dd_after_3x_s": r.time_to_dd_after_3x_s,
            "dd_initial": r.dd_initial,
            "dd_overall": r.dd_overall,
            "dd_pre2x": r.dd_pre2x,
            "dd_pre2x_or_horizon": r.dd_pre2x_or_horizon,
            "dd_after_2x": r.dd_after_2x,
            "dd_after_3x": r.dd_after_3x,
            "dd_after_4x": r.dd_after_4x,
            "dd_after_5x": r.dd_after_5x,
            "dd_after_10x": r.dd_after_10x,
            "dd_after_ath": r.dd_after_ath,
            "peak_pnl_pct": r.peak_pnl_pct,
            "ret_end_pct": r.ret_end_pct,
        })
    return out


def summarize_overall(results: List[TokenResult]) -> Dict[str, Any]:
    ok = [r for r in results if r.status == "ok"]

    def take(field: str) -> List[float]:
        xs = []
        for r in ok:
            v = getattr(r, field, None)
            if v is not None and isinstance(v, (int, float)) and not math.isnan(v):
                xs.append(float(v))
        return xs

    def med(xs: List[float]) -> Optional[float]:
        return median(xs) if xs else None

    def pct_hit(field: str) -> float:
        if not ok:
            return 0.0
        return sum(1 for r in ok if getattr(r, field, None) is not None) / len(ok)

    def percentile(xs: List[float], p: float) -> Optional[float]:
        if not xs:
            return None
        s = sorted(xs)
        idx = int(len(s) * p)
        return s[min(idx, len(s) - 1)]

    ath = take("ath_mult")
    t_recovery = take("time_to_recovery_s")
    t2x = take("time_to_2x_s")
    t3x = take("time_to_3x_s")
    t_ath = take("time_to_ath_s")
    t_dd_pre2x = take("time_to_dd_pre2x_s")
    t_dd_after_2x = take("time_to_dd_after_2x_s")

    dd_initial = take("dd_initial")
    dd_overall = take("dd_overall")
    dd_pre2x_or_horizon = take("dd_pre2x_or_horizon")
    peak_pnl = take("peak_pnl_pct")

    return {
        "alerts_total": len(results),
        "alerts_ok": len(ok),
        "alerts_missing": len(results) - len(ok),
        "median_ath_mult": med(ath),
        "p25_ath_mult": percentile(ath, 0.25),
        "p75_ath_mult": percentile(ath, 0.75),
        "p95_ath_mult": percentile(ath, 0.95),
        "pct_hit_2x": pct_hit("time_to_2x_s"),
        "pct_hit_3x": pct_hit("time_to_3x_s"),
        "pct_hit_4x": pct_hit("time_to_4x_s"),
        "pct_hit_5x": pct_hit("time_to_5x_s"),
        "pct_hit_10x": pct_hit("time_to_10x_s"),
        # Timing metrics
        "median_time_to_recovery_s": med(t_recovery),
        "median_time_to_2x_s": med(t2x),
        "median_time_to_3x_s": med(t3x),
        "median_time_to_ath_s": med(t_ath),
        "median_time_to_dd_pre2x_s": med(t_dd_pre2x),
        "median_time_to_dd_after_2x_s": med(t_dd_after_2x),
        # Drawdown metrics
        "median_dd_initial": med(dd_initial),
        "median_dd_overall": med(dd_overall),
        "median_dd_pre2x_or_horizon": med(dd_pre2x_or_horizon),
        "median_peak_pnl_pct": med(peak_pnl),
    }


def aggregate_by_caller(results: List[TokenResult], min_trades: int = 5) -> List[Dict[str, Any]]:
    ok = [r for r in results if r.status == "ok" and (r.caller or "").strip()]

    by_caller: Dict[str, List[TokenResult]] = {}
    for r in ok:
        caller = (r.caller or "").strip()
        by_caller.setdefault(caller, []).append(r)

    def take(rlist: List[TokenResult], field: str) -> List[float]:
        xs = []
        for r in rlist:
            v = getattr(r, field, None)
            if v is not None and isinstance(v, (int, float)) and not math.isnan(v):
                xs.append(float(v))
        return xs

    def med(xs: List[float]) -> Optional[float]:
        return median(xs) if xs else None

    def percentile(xs: List[float], p: float) -> Optional[float]:
        if not xs:
            return None
        s = sorted(xs)
        idx = int(len(s) * p)
        return s[min(idx, len(s) - 1)]

    def pct_hit(rlist: List[TokenResult], field: str) -> float:
        if not rlist:
            return 0.0
        return sum(1 for r in rlist if getattr(r, field, None) is not None) / len(rlist)

    out: List[Dict[str, Any]] = []
    for caller, rlist in by_caller.items():
        if len(rlist) < min_trades:
            continue

        ath = take(rlist, "ath_mult")
        dd_initial = take(rlist, "dd_initial")
        dd_overall = take(rlist, "dd_overall")
        dd_pre2x = take(rlist, "dd_pre2x")
        dd_pre2x_or_horizon = take(rlist, "dd_pre2x_or_horizon")
        dd_after_2x = take(rlist, "dd_after_2x")
        dd_after_3x = take(rlist, "dd_after_3x")
        dd_after_ath = take(rlist, "dd_after_ath")
        peak_pnl = take(rlist, "peak_pnl_pct")
        ret_end = take(rlist, "ret_end_pct")
        # Timing metrics
        t_recovery = take(rlist, "time_to_recovery_s")
        t2x = take(rlist, "time_to_2x_s")
        t3x = take(rlist, "time_to_3x_s")
        t_ath = take(rlist, "time_to_ath_s")
        t_dd_pre2x = take(rlist, "time_to_dd_pre2x_s")

        def to_mins(xs: List[float]) -> Optional[float]:
            m = med(xs)
            return (m / 60.0) if m else None

        out.append({
            "caller": caller,
            "n": len(rlist),
            "median_ath": med(ath),
            "p25_ath": percentile(ath, 0.25),
            "p75_ath": percentile(ath, 0.75),
            "p95_ath": percentile(ath, 0.95),
            "hit2x_pct": pct_hit(rlist, "time_to_2x_s") * 100,
            "hit3x_pct": pct_hit(rlist, "time_to_3x_s") * 100,
            "hit4x_pct": pct_hit(rlist, "time_to_4x_s") * 100,
            "hit5x_pct": pct_hit(rlist, "time_to_5x_s") * 100,
            "hit10x_pct": pct_hit(rlist, "time_to_10x_s") * 100,
            # Timing metrics (in minutes)
            "median_t_recovery_m": to_mins(t_recovery),
            "median_t2x_m": to_mins(t2x),
            "median_t3x_m": to_mins(t3x),
            "median_t_ath_m": to_mins(t_ath),
            "median_t_dd_pre2x_m": to_mins(t_dd_pre2x),
            "median_t2x_hrs": (med(t2x) / 3600.0) if med(t2x) else None,  # Keep for backwards compat
            # Drawdown metrics
            "median_dd_initial_pct": (med(dd_initial) * 100.0) if med(dd_initial) else None,
            "median_dd_overall_pct": (med(dd_overall) * 100.0) if med(dd_overall) else None,
            "median_dd_pre2x_pct": (med(dd_pre2x) * 100.0) if med(dd_pre2x) else None,
            "median_dd_pre2x_or_horizon_pct": (med(dd_pre2x_or_horizon) * 100.0) if med(dd_pre2x_or_horizon) else None,
            "median_dd_after_2x_pct": (med(dd_after_2x) * 100.0) if med(dd_after_2x) else None,
            "median_dd_after_3x_pct": (med(dd_after_3x) * 100.0) if med(dd_after_3x) else None,
            "median_dd_after_ath_pct": (med(dd_after_ath) * 100.0) if med(dd_after_ath) else None,
            "worst_dd_pct": (min(dd_overall) * 100.0) if dd_overall else None,
            "median_peak_pnl_pct": med(peak_pnl),
            "median_ret_end_pct": med(ret_end),
        })

    out.sort(key=lambda x: (x.get("median_ath") or 0.0), reverse=True)
    for i, r in enumerate(out, start=1):
        r["rank"] = i
    return out


# =============================================================================
# DuckDB Storage
# =============================================================================

def ensure_baseline_schema(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("CREATE SCHEMA IF NOT EXISTS baseline;")

    # Drop old table if schema changed
    try:
        cols = [r[1].lower() for r in con.execute("PRAGMA table_info('baseline.runs_d')").fetchall()]
        if "slice_path" in cols and "slice_dir" not in cols:
            # Old schema - drop and recreate
            con.execute("DROP TABLE IF EXISTS baseline.runs_d")
    except Exception:
        pass

    con.execute("""
        CREATE TABLE IF NOT EXISTS baseline.runs_d (
            run_id TEXT PRIMARY KEY,
            created_at TIMESTAMP,
            run_name TEXT,
            date_from DATE,
            date_to DATE,
            interval_seconds INTEGER,
            horizon_hours INTEGER,
            chain TEXT,
            alerts_total INTEGER,
            alerts_ok INTEGER,
            config_json TEXT,
            summary_json TEXT,
            slice_dir TEXT
        );
    """)

    # Check if schema needs to be recreated (count columns)
    try:
        col_count = con.execute("""
            SELECT count(*) FROM information_schema.columns 
            WHERE table_schema = 'baseline' AND table_name = 'alert_results_f'
        """).fetchone()[0]
        # We expect 32 columns now; if different, recreate
        if col_count != 32 and col_count > 0:
            con.execute("DROP TABLE baseline.alert_results_f;")
    except Exception:
        pass  # Table doesn't exist yet

    con.execute("""
        CREATE TABLE IF NOT EXISTS baseline.alert_results_f (
            run_id TEXT,
            alert_id BIGINT,
            mint TEXT,
            caller TEXT,
            alert_ts_utc TIMESTAMP,
            entry_ts_utc TIMESTAMP,
            status TEXT,
            candles BIGINT,
            entry_price DOUBLE,
            ath_mult DOUBLE,
            time_to_ath_s BIGINT,
            time_to_recovery_s BIGINT,
            time_to_2x_s BIGINT,
            time_to_3x_s BIGINT,
            time_to_4x_s BIGINT,
            time_to_5x_s BIGINT,
            time_to_10x_s BIGINT,
            time_to_dd_pre2x_s BIGINT,
            time_to_dd_after_2x_s BIGINT,
            time_to_dd_after_3x_s BIGINT,
            dd_initial DOUBLE,
            dd_overall DOUBLE,
            dd_pre2x DOUBLE,
            dd_pre2x_or_horizon DOUBLE,
            dd_after_2x DOUBLE,
            dd_after_3x DOUBLE,
            dd_after_4x DOUBLE,
            dd_after_5x DOUBLE,
            dd_after_10x DOUBLE,
            dd_after_ath DOUBLE,
            peak_pnl_pct DOUBLE,
            ret_end_pct DOUBLE,
            PRIMARY KEY(run_id, alert_id)
        );
    """)

    # Drop and recreate to ensure schema is up to date
    con.execute("DROP TABLE IF EXISTS baseline.caller_stats_f;")
    con.execute("""
        CREATE TABLE baseline.caller_stats_f (
            run_id TEXT,
            caller TEXT,
            n INTEGER,
            median_ath DOUBLE,
            p25_ath DOUBLE,
            p75_ath DOUBLE,
            hit2x_pct DOUBLE,
            hit3x_pct DOUBLE,
            hit4x_pct DOUBLE,
            hit5x_pct DOUBLE,
            hit10x_pct DOUBLE,
            median_t2x_hrs DOUBLE,
            median_dd_initial_pct DOUBLE,
            median_dd_overall_pct DOUBLE,
            median_dd_pre2x_pct DOUBLE,
            median_dd_pre2x_or_horizon_pct DOUBLE,
            median_dd_after_2x_pct DOUBLE,
            median_dd_after_3x_pct DOUBLE,
            median_dd_after_ath_pct DOUBLE,
            worst_dd_pct DOUBLE,
            median_peak_pnl_pct DOUBLE,
            median_ret_end_pct DOUBLE
        );
    """)

    # Convenience views
    con.execute("""
        CREATE OR REPLACE VIEW baseline.caller_leaderboard_v AS
        SELECT
          run_id,
          caller,
          n,
          median_ath,
          hit2x_pct,
          hit3x_pct,
          hit4x_pct,
          median_t2x_hrs,
          median_dd_initial_pct,
          median_dd_overall_pct,
          median_peak_pnl_pct,
          median_ret_end_pct
        FROM baseline.caller_stats_f
        ORDER BY run_id, median_ath DESC;
    """)

    con.execute("""
        CREATE OR REPLACE VIEW baseline.run_summary_v AS
        SELECT
          run_id, created_at, run_name, chain, date_from, date_to, interval_seconds, horizon_hours,
          alerts_total, alerts_ok,
          json_extract_string(summary_json, '$.median_ath_mult') AS median_ath_mult,
          json_extract_string(summary_json, '$.pct_hit_2x') AS pct_hit_2x,
          json_extract_string(summary_json, '$.median_dd_overall') AS median_dd_overall,
          json_extract_string(summary_json, '$.median_peak_pnl_pct') AS median_peak_pnl_pct
        FROM baseline.runs_d
        ORDER BY created_at DESC;
    """)


def store_baseline_to_duckdb(
    duckdb_path: str,
    run_id: str,
    run_name: str,
    config: Dict[str, Any],
    results: List[TokenResult],
    summary: Dict[str, Any],
    caller_agg: List[Dict[str, Any]],
    slice_dir: str,
) -> None:
    con = duckdb.connect(duckdb_path)
    try:
        con.execute("BEGIN;")
        ensure_baseline_schema(con)

        con.execute("""
            INSERT OR REPLACE INTO baseline.runs_d
            (run_id, created_at, run_name, date_from, date_to, interval_seconds, horizon_hours, chain,
             alerts_total, alerts_ok, config_json, summary_json, slice_dir)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            run_id,
            datetime.now(tz=UTC).replace(tzinfo=None),
            run_name,
            config.get("date_from"),
            config.get("date_to"),
            int(config.get("interval_seconds")),
            int(config.get("horizon_hours")),
            config.get("chain"),
            int(summary.get("alerts_total", 0)),
            int(summary.get("alerts_ok", 0)),
            json.dumps(config, separators=(",", ":"), sort_keys=True),
            json.dumps(summary, separators=(",", ":"), sort_keys=True),
            slice_dir,
        ])

        # Replace existing facts for this run_id
        con.execute("DELETE FROM baseline.alert_results_f WHERE run_id = ?", [run_id])
        con.execute("DELETE FROM baseline.caller_stats_f WHERE run_id = ?", [run_id])

        # Insert alert results
        out_rows = []
        for r in results:
            out_rows.append((
                run_id,
                r.alert_id,
                r.mint,
                r.caller,
                ms_to_dt(r.alert_ts_ms).replace(tzinfo=None),
                ms_to_dt(r.entry_ts_ms).replace(tzinfo=None) if r.entry_ts_ms else None,
                r.status,
                r.candles,
                r.entry_price,
                r.ath_mult,
                r.time_to_ath_s,
                r.time_to_recovery_s,
                r.time_to_2x_s,
                r.time_to_3x_s,
                r.time_to_4x_s,
                r.time_to_5x_s,
                r.time_to_10x_s,
                r.time_to_dd_pre2x_s,
                r.time_to_dd_after_2x_s,
                r.time_to_dd_after_3x_s,
                r.dd_initial,
                r.dd_overall,
                r.dd_pre2x,
                r.dd_pre2x_or_horizon,
                r.dd_after_2x,
                r.dd_after_3x,
                r.dd_after_4x,
                r.dd_after_5x,
                r.dd_after_10x,
                r.dd_after_ath,
                r.peak_pnl_pct,
                r.ret_end_pct,
            ))

        con.executemany("""
            INSERT INTO baseline.alert_results_f VALUES (
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
            )
        """, out_rows)

        # Insert caller stats
        caller_rows = []
        for c in caller_agg:
            caller_rows.append((
                run_id,
                c.get("caller"),
                int(c.get("n") or 0),
                c.get("median_ath"),
                c.get("p25_ath"),
                c.get("p75_ath"),
                c.get("hit2x_pct"),
                c.get("hit3x_pct"),
                c.get("hit4x_pct"),
                c.get("hit5x_pct"),
                c.get("hit10x_pct"),
                c.get("median_t2x_hrs"),
                c.get("median_dd_initial_pct"),
                c.get("median_dd_overall_pct"),
                c.get("median_dd_pre2x_pct"),
                c.get("median_dd_pre2x_or_horizon_pct"),
                c.get("median_dd_after_2x_pct"),
                c.get("median_dd_after_3x_pct"),
                c.get("median_dd_after_ath_pct"),
                c.get("worst_dd_pct"),
                c.get("median_peak_pnl_pct"),
                c.get("median_ret_end_pct"),
            ))

        con.executemany("""
            INSERT INTO baseline.caller_stats_f VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, caller_rows)

        con.execute("COMMIT;")
    except Exception:
        con.execute("ROLLBACK;")
        raise
    finally:
        con.close()


def print_caller_leaderboard(callers: List[Dict[str, Any]], limit: int = 30) -> None:
    if not callers:
        print("No callers with enough trades.", file=sys.stderr)
        return

    # Map display names to data keys (shorter headers for readability)
    headers = [
        ("rank", "rank", "int"),
        ("caller", "caller", "str"),
        ("n", "n", "int"),
        ("p25", "p25_ath", "x"),
        ("med_ath", "median_ath", "x"),
        ("p75", "p75_ath", "x"),
        ("p95", "p95_ath", "x"),
        ("hit2x", "hit2x_pct", "pct"),
        ("hit3x", "hit3x_pct", "pct"),
        ("hit4x", "hit4x_pct", "pct"),
        ("hit5x", "hit5x_pct", "pct"),
        ("t_recv", "median_t_recovery_m", "mins"),
        ("t_2x", "median_t2x_m", "mins"),
        ("t_3x", "median_t3x_m", "mins"),
        ("t_ath", "median_t_ath_m", "mins"),
        ("dd_init", "median_dd_initial_pct", "pct"),
        ("dd_pre2x", "median_dd_pre2x_pct", "pct"),
        ("dd_all", "median_dd_pre2x_or_horizon_pct", "pct"),
    ]

    col_widths: Dict[str, int] = {display: max(len(display), 6) for display, _, _ in headers}
    for r in callers[:limit]:
        for display, data_key, kind in headers:
            if data_key == "caller":
                v = (r.get("caller") or "-").strip()
                col_widths[display] = max(col_widths[display], min(24, len(v)))
            else:
                txt = _fmt(r.get(data_key), kind)
                col_widths[display] = max(col_widths[display], len(txt))

    line = "  ".join(display.ljust(col_widths[display]) for display, _, _ in headers)
    print(line)
    print("-" * len(line))

    for r in callers[:limit]:
        parts = []
        for display, data_key, kind in headers:
            if data_key == "caller":
                v = (r.get("caller") or "-").strip()[: col_widths[display]]
                parts.append(v.ljust(col_widths[display]))
            else:
                txt = _fmt(r.get(data_key), kind)
                parts.append(txt.rjust(col_widths[display]))
        print("  ".join(parts))


# =============================================================================
# Main
# =============================================================================

def main() -> None:
    ap = argparse.ArgumentParser(description="Baseline pipeline: per-token parallel backtest")

    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")

    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"))
    ap.add_argument("--chain", default="solana")

    ap.add_argument("--ch-host", default=os.getenv("CLICKHOUSE_HOST", "localhost"))
    ap.add_argument("--ch-port", type=int, default=int(os.getenv("CLICKHOUSE_PORT", "19000")))
    ap.add_argument("--ch-database", default=os.getenv("CLICKHOUSE_DATABASE", "quantbot"))
    ap.add_argument("--ch-table", default=os.getenv("CLICKHOUSE_TABLE", "ohlcv_candles"))
    ap.add_argument("--ch-user", default=os.getenv("CLICKHOUSE_USER", "default"))
    ap.add_argument("--ch-password", default=os.getenv("CLICKHOUSE_PASSWORD", ""))

    ap.add_argument("--interval-seconds", type=int, choices=[60, 300], default=60)
    ap.add_argument("--horizon-hours", type=int, default=48)
    ap.add_argument("--pre-window-minutes", type=int, default=5)

    ap.add_argument("--entry-mode", choices=["next_open", "close", "worst_high"], default="next_open",
                    help="Entry price mode: next_open (default, clean), close (candle close), worst_high (stress test)")
    ap.add_argument("--slippage-bps", type=float, default=0.0,
                    help="Slippage in basis points to add to entry price (e.g., 50 = 0.5%%)")

    ap.add_argument("--slice-dir", default="slices/per_token")
    ap.add_argument("--reuse-slice", action="store_true", help="Skip export if slice exists")

    ap.add_argument("--out-alerts", default="results/baseline_alerts.csv")
    ap.add_argument("--out-callers", default="results/baseline_callers.csv")
    ap.add_argument("--min-trades", type=int, default=10)
    ap.add_argument("--top", type=int, default=50)

    ap.add_argument("--threads", type=int, default=16)
    ap.add_argument("--output-format", choices=["console", "json"], default="console")
    ap.add_argument("--verbose", action="store_true")

    ap.add_argument("--store-duckdb", action="store_true", help="Store results in DuckDB baseline.* schema")
    ap.add_argument("--run-name", default=None, help="Name for the run (auto-generated if not specified)")

    args = ap.parse_args()

    date_from = parse_yyyy_mm_dd(args.date_from)
    date_to = parse_yyyy_mm_dd(args.date_to)
    verbose = args.verbose or args.output_format != "json"

    if verbose:
        print(f"[1/3] Loading alerts from {args.duckdb}...", file=sys.stderr)
    alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
    if not alerts:
        raise SystemExit("No alerts found for that date range.")
    if verbose:
        print(f"      Found {len(alerts)} alerts", file=sys.stderr)

    if ClickHouseClient is None:
        raise SystemExit("clickhouse-driver not installed. Run: pip install clickhouse-driver")

    ch_cfg = ClickHouseCfg(
        host=args.ch_host,
        port=args.ch_port,
        database=args.ch_database,
        table=args.ch_table,
        user=args.ch_user,
        password=args.ch_password,
    )

    slice_dir = Path(args.slice_dir)

    if verbose:
        print(f"[2/3] Running parallel backtest ({args.threads} threads)...", file=sys.stderr)
        print(f"      Horizon: {args.horizon_hours}h | Interval: {args.interval_seconds}s", file=sys.stderr)
        entry_desc = args.entry_mode
        if args.slippage_bps > 0:
            entry_desc += f" +{args.slippage_bps}bps"
        print(f"      Entry mode: {entry_desc}", file=sys.stderr)
        print(f"      Slice dir: {slice_dir}", file=sys.stderr)

    t0 = time.time()
    results = run_parallel_backtest(
        alerts=alerts,
        ch_cfg=ch_cfg,
        chain=args.chain,
        interval_seconds=args.interval_seconds,
        horizon_hours=args.horizon_hours,
        pre_window_minutes=args.pre_window_minutes,
        slice_dir=slice_dir,
        reuse_slice=args.reuse_slice,
        threads=args.threads,
        verbose=verbose,
        entry_mode=args.entry_mode,
        slippage_bps=args.slippage_bps,
    )

    if verbose:
        elapsed = time.time() - t0
        ok_count = sum(1 for r in results if r.status == "ok")
        print(f"      Completed in {elapsed:.1f}s ({ok_count}/{len(results)} ok)", file=sys.stderr)

    if verbose:
        print(f"[3/3] Aggregating results...", file=sys.stderr)

    summary = summarize_overall(results)
    caller_agg = aggregate_by_caller(results, min_trades=args.min_trades)

    # Write CSVs
    out_rows = results_to_dicts(results, args.interval_seconds, args.horizon_hours)
    alert_fields = [
        "alert_id", "mint", "caller", "alert_ts_utc", "entry_ts_utc",
        "interval_seconds", "horizon_hours", "status", "candles", "entry_price",
        "ath_mult", "time_to_ath_s", "time_to_recovery_s", "time_to_2x_s", "time_to_3x_s", "time_to_4x_s",
        "time_to_5x_s", "time_to_10x_s",
        "time_to_dd_pre2x_s", "time_to_dd_after_2x_s", "time_to_dd_after_3x_s",
        "dd_initial", "dd_overall", "dd_pre2x", "dd_pre2x_or_horizon",
        "dd_after_2x", "dd_after_3x", "dd_after_4x", "dd_after_5x", "dd_after_10x", "dd_after_ath",
        "peak_pnl_pct", "ret_end_pct"
    ]
    write_csv(args.out_alerts, alert_fields, out_rows)

    caller_fields = [
        "rank", "caller", "n", "median_ath", "p25_ath", "p75_ath", "p95_ath",
        "hit2x_pct", "hit3x_pct", "hit4x_pct", "hit5x_pct", "hit10x_pct",
        "median_t_recovery_m", "median_t2x_m", "median_t3x_m", "median_t_ath_m", "median_t_dd_pre2x_m",
        "median_t2x_hrs",
        "median_dd_initial_pct", "median_dd_overall_pct", "median_dd_pre2x_pct", "median_dd_pre2x_or_horizon_pct",
        "median_dd_after_2x_pct", "median_dd_after_3x_pct", "median_dd_after_ath_pct",
        "worst_dd_pct", "median_peak_pnl_pct", "median_ret_end_pct"
    ]
    write_csv(args.out_callers, caller_fields, caller_agg)

    run_id = uuid.uuid4().hex
    stored = False

    if args.store_duckdb:
        run_name = args.run_name or f"baseline:{args.chain}:{args.date_from}->{args.date_to}:{args.interval_seconds}s:{args.horizon_hours}h"
        config = {
            "date_from": date_from.strftime("%Y-%m-%d"),
            "date_to": date_to.strftime("%Y-%m-%d"),
            "interval_seconds": int(args.interval_seconds),
            "horizon_hours": int(args.horizon_hours),
            "chain": args.chain,
            "min_trades": int(args.min_trades),
            "entry_mode": args.entry_mode,
            "slippage_bps": args.slippage_bps,
        }
        store_baseline_to_duckdb(
            args.duckdb,
            run_id,
            run_name,
            config,
            results,
            summary,
            caller_agg,
            slice_dir=str(slice_dir),
        )
        stored = True
        if verbose:
            print(f"[stored] baseline.* run_id={run_id}", file=sys.stderr)

    if args.output_format == "json":
        print(json.dumps({
            "success": True,
            "run_id": run_id,
            "stored": stored,
            "out_alerts": args.out_alerts,
            "out_callers": args.out_callers,
            "summary": summary,
            "callers_count": len(caller_agg),
        }))
        return

    print()
    print("=" * 70)
    print("BASELINE BACKTEST COMPLETE (Per-Token Parallel)")
    print("=" * 70)
    print(f"Date range: {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}")
    entry_desc = args.entry_mode
    if args.slippage_bps > 0:
        entry_desc += f" +{args.slippage_bps}bps"
    print(f"Horizon: {args.horizon_hours} hours | Interval: {args.interval_seconds}s | Entry: {entry_desc}")
    print(f"Threads: {args.threads}")
    print(f"Alerts: {summary['alerts_total']} total, {summary['alerts_ok']} ok, {summary['alerts_missing']} missing")
    print(f"Run ID: {run_id} (stored: {stored})")
    print()

    print("--- OVERALL METRICS ---")
    if summary["median_ath_mult"] is not None:
        p25 = summary.get("p25_ath_mult") or 0
        p75 = summary.get("p75_ath_mult") or 0
        p95 = summary.get("p95_ath_mult") or 0
        print(f"Median ATH: {summary['median_ath_mult']:.2f}x (p25={p25:.2f}x, p75={p75:.2f}x, p95={p95:.2f}x)")
    print(f"% hit 2x: {pct(summary['pct_hit_2x']):.1f}%  |  3x: {pct(summary['pct_hit_3x']):.1f}%  |  4x: {pct(summary['pct_hit_4x']):.1f}%  |  5x: {pct(summary['pct_hit_5x']):.1f}%  |  10x: {pct(summary['pct_hit_10x']):.1f}%")
    
    # Timing metrics
    print()
    print("--- TIMING (median, in minutes) ---")
    def fmt_time(s: Optional[float]) -> str:
        if s is None:
            return "-"
        mins = s / 60
        if mins >= 60:
            return f"{mins/60:.1f}h"
        return f"{mins:.1f}m"
    
    t_recovery = summary.get("median_time_to_recovery_s")
    t_2x = summary.get("median_time_to_2x_s")
    t_3x = summary.get("median_time_to_3x_s")
    t_ath = summary.get("median_time_to_ath_s")
    t_dd_pre2x = summary.get("median_time_to_dd_pre2x_s")
    t_dd_after_2x = summary.get("median_time_to_dd_after_2x_s")
    
    print(f"Time to recovery (above entry): {fmt_time(t_recovery)}")
    print(f"Time to 2x: {fmt_time(t_2x)}")
    print(f"Time to 3x: {fmt_time(t_3x)}")
    print(f"Time to ATH: {fmt_time(t_ath)}")
    print(f"Time to max DD (pre-2x or horizon): {fmt_time(t_dd_pre2x)}")
    print(f"Time to max DD (after 2x): {fmt_time(t_dd_after_2x)}")
    
    # Drawdown metrics
    print()
    print("--- DRAWDOWNS (median) ---")
    if summary["median_dd_initial"] is not None:
        print(f"Initial DD (before recovery): {summary['median_dd_initial']*100:.1f}%")
    dd_pre2x_h = summary.get("median_dd_pre2x_or_horizon")
    if dd_pre2x_h is not None:
        print(f"DD pre-2x or horizon: {dd_pre2x_h*100:.1f}%")
    if summary["median_dd_overall"] is not None:
        print(f"Overall DD (worst): {summary['median_dd_overall']*100:.1f}%")
    if summary["median_peak_pnl_pct"] is not None:
        print(f"Peak PnL: {summary['median_peak_pnl_pct']:.1f}%")
    print()

    print(f"--- CALLER LEADERBOARD (min {args.min_trades} trades, top {args.top}) ---")
    print_caller_leaderboard(caller_agg, limit=args.top)
    print()
    print(f"Alerts CSV: {args.out_alerts}")
    print(f"Callers CSV: {args.out_callers}")


if __name__ == "__main__":
    main()
