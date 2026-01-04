#!/usr/bin/env python3
"""
Complete Baseline Backtest Pipeline

End-to-end workflow:
1. Load alerts from DuckDB
2. Query ClickHouse for coverage (which tokens have candles)
3. Export candle slice to Parquet
4. Run vectorized baseline backtest (pure path metrics)
5. Aggregate results by caller for leaderboard
6. Optionally store to DuckDB

This computes:
- ATH multiple within horizon
- Time to 2x, 3x, 4x, 5x, 10x, ATH
- Drawdown metrics (initial, overall, after milestones)
- Peak PnL, return at horizon

NO trading strategies. NO TP/SL. Just pure price path analysis.

Usage:
  # Full pipeline (query ClickHouse, export slice, run backtest)
  python3 run_baseline_all.py --from 2025-12-01 --to 2025-12-24

  # Reuse existing slice (skip ClickHouse query + export)
  python3 run_baseline_all.py --from 2025-12-01 --to 2025-12-24 --reuse-slice

  # With DuckDB storage
  python3 run_baseline_all.py --from 2025-12-01 --to 2025-12-24 --store-duckdb
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import sys
import time
import uuid
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
    if kind == "num":
        return f"{x:8.4f}"
    return str(x)


def compute_slice_fingerprint(
    mints: Set[str],
    chain: str,
    date_from: datetime,
    date_to: datetime,
    interval_seconds: int,
) -> str:
    """Compute a stable fingerprint for slice caching."""
    sorted_mints = sorted(mints)
    data = f"{chain}|{date_from.isoformat()}|{date_to.isoformat()}|{interval_seconds}|{','.join(sorted_mints)}"
    return hashlib.sha256(data.encode()).hexdigest()[:16]


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
    q = """
    SELECT COUNT(*)::INT
    FROM information_schema.tables
    WHERE table_name = ?
    """
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

        # Prefer caller_name over trigger_from_name
        if "caller_name" in cols:
            caller_expr = "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller"
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

        if "caller_name" in cols:
            caller_expr = "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller"
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
# ClickHouse: Coverage Check & Slice Export
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
    send_receive_timeout: int = 300

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


def ch_query_rows(cfg: ClickHouseCfg, sql: str) -> List[Dict[str, Any]]:
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
) -> Dict[str, int]:
    """Query ClickHouse for candle counts per token."""
    if not mints:
        return {}

    chain_q = _sql_escape(chain)
    mint_list = ", ".join(f"'{_sql_escape(m)}'" for m in mints)

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


def export_slice_to_parquet(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    output_path: Path,
    pre_window_minutes: int = 60,
    post_window_hours: int = 72,
    verbose: bool = False,
) -> int:
    """Export candles for specified mints to Parquet file."""
    if not mints:
        return 0

    chain_q = _sql_escape(chain)
    mint_list = ", ".join(f"'{_sql_escape(m)}'" for m in mints)

    # Expand time range for pre/post window
    expanded_from = date_from - timedelta(minutes=pre_window_minutes)
    expanded_to = date_to + timedelta(hours=post_window_hours)

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
  AND timestamp >= toDateTime('{dt_to_ch(expanded_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(expanded_to)}')
ORDER BY token_address, timestamp
""".strip()

    if verbose:
        print(f"[clickhouse] querying {len(mints)} tokens...", file=sys.stderr)

    client = cfg.get_client()
    result = client.execute(sql, with_column_types=True)
    rows_data, columns = result

    if not rows_data:
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write to Parquet using DuckDB
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

    # Insert in batches
    batch_size = 50000
    for i in range(0, len(rows_data), batch_size):
        batch = rows_data[i:i + batch_size]
        conn.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", batch)

    conn.execute(f"COPY candles TO '{output_path}' (FORMAT PARQUET, COMPRESSION 'zstd')")
    count = conn.execute("SELECT count(*) FROM candles").fetchone()[0]
    conn.close()

    if verbose:
        print(f"[clickhouse] exported {count:,} candles to {output_path}", file=sys.stderr)

    return count


# =============================================================================
# Partitioning
# =============================================================================

def partition_slice(
    in_path: Path,
    out_dir: Path,
    threads: int,
    compression: str = "zstd",
    verbose: bool = False,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(":memory:")
    con.execute(f"PRAGMA threads={max(1, threads)}")

    sql = f"""
COPY (
  SELECT token_address, timestamp, open, high, low, close, volume
  FROM parquet_scan('{_sql_escape(in_path.as_posix())}')
  ORDER BY token_address, timestamp
)
TO '{_sql_escape(out_dir.as_posix())}'
(FORMAT PARQUET, PARTITION_BY (token_address), COMPRESSION '{_sql_escape(compression)}');
""".strip()

    if verbose:
        print(f"[partition] {in_path} -> {out_dir}", file=sys.stderr)
    con.execute(sql)
    con.close()

    if verbose:
        num_dirs = len([d for d in out_dir.iterdir() if d.is_dir()])
        print(f"[partition] done: {num_dirs} token partitions", file=sys.stderr)


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
# Baseline Vectorized Query (NO TP/SL - Pure Path Metrics)
# =============================================================================

def run_baseline_backtest(
    alerts: List[Alert],
    slice_path: Path,
    is_partitioned: bool,
    interval_seconds: int,
    horizon_hours: int,
    threads: int,
    verbose: bool,
) -> List[Dict[str, Any]]:
    """Pure baseline backtest - computes path metrics only. NO trading strategies."""
    horizon_s = horizon_hours * 3600

    alert_rows: List[Tuple[int, str, str, int, int, int]] = []
    for i, a in enumerate(alerts, start=1):
        entry_ts_ms = ceil_ms_to_interval_ts_ms(a.ts_ms, interval_seconds)
        end_ts_ms = entry_ts_ms + (horizon_s * 1000)
        alert_rows.append((i, a.mint, a.caller, a.ts_ms, entry_ts_ms, end_ts_ms))

    con = duckdb.connect(":memory:")
    try:
        con.execute(f"PRAGMA threads={threads}")
        con.execute("""
            CREATE TABLE alerts_tmp(
              alert_id BIGINT,
              mint TEXT,
              caller TEXT,
              alert_ts_ms BIGINT,
              entry_ts_ms BIGINT,
              end_ts_ms BIGINT
            )
        """)
        con.executemany("INSERT INTO alerts_tmp VALUES (?, ?, ?, ?, ?, ?)", alert_rows)

        if is_partitioned:
            parquet_glob = f"{slice_path.as_posix()}/**/*.parquet"
            con.execute(f"""
                CREATE VIEW candles AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{parquet_glob}', hive_partitioning=true)
            """)
        else:
            con.execute(f"""
                CREATE VIEW candles AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{slice_path.as_posix()}')
            """)

        # Pure baseline query - NO TP/SL logic
        sql = f"""
WITH
a AS (
  SELECT
    alert_id, mint, caller, alert_ts_ms,
    to_timestamp(alert_ts_ms/1000.0) AS alert_ts,
    to_timestamp(entry_ts_ms/1000.0) AS entry_ts,
    to_timestamp(end_ts_ms/1000.0) AS end_ts
  FROM alerts_tmp
),
j AS (
  SELECT
    a.alert_id, a.mint, a.caller, a.alert_ts, a.entry_ts, a.end_ts,
    c.timestamp AS ts, c.open AS o, c.high AS h, c.low AS l, c.close AS cl
  FROM a
  JOIN candles c ON c.token_address = a.mint AND c.timestamp >= a.entry_ts AND c.timestamp < a.end_ts
),
entry AS (
  SELECT alert_id, arg_min(o, ts) AS entry_price, count(*)::BIGINT AS candles
  FROM j GROUP BY alert_id
),
agg AS (
  SELECT
    j.alert_id, e.entry_price, e.candles,
    max(j.h) AS max_high,
    min(j.l) AS min_low,
    arg_max(j.cl, j.ts) AS end_close,
    min(j.ts) FILTER (WHERE j.h > e.entry_price) AS recovery_ts,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price * 2.0) AS ts_2x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price * 3.0) AS ts_3x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price * 4.0) AS ts_4x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price * 5.0) AS ts_5x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price * 10.0) AS ts_10x
  FROM j JOIN entry e USING(alert_id)
  GROUP BY j.alert_id, e.entry_price, e.candles
),
ath_cte AS (
  SELECT j.alert_id, min(j.ts) AS ath_ts
  FROM j JOIN agg ag USING(alert_id) WHERE j.h = ag.max_high
  GROUP BY j.alert_id
),
mins AS (
  SELECT
    j.alert_id,
    min(CASE WHEN ag.recovery_ts IS NOT NULL AND j.ts < ag.recovery_ts THEN j.l END) AS min_pre_recovery,
    min(CASE WHEN ag.ts_2x IS NOT NULL AND j.ts <= ag.ts_2x THEN j.l END) AS min_pre2x,
    min(CASE WHEN ag.ts_2x IS NOT NULL AND j.ts > ag.ts_2x THEN j.l END) AS min_post2x,
    min(CASE WHEN ag.ts_3x IS NOT NULL AND j.ts > ag.ts_3x THEN j.l END) AS min_post3x,
    min(CASE WHEN ag.ts_4x IS NOT NULL AND j.ts > ag.ts_4x THEN j.l END) AS min_post4x,
    min(CASE WHEN ag.ts_5x IS NOT NULL AND j.ts > ag.ts_5x THEN j.l END) AS min_post5x,
    min(CASE WHEN ag.ts_10x IS NOT NULL AND j.ts > ag.ts_10x THEN j.l END) AS min_post10x,
    min(CASE WHEN ath_cte.ath_ts IS NOT NULL AND j.ts > ath_cte.ath_ts THEN j.l END) AS min_postath
  FROM j
  JOIN agg ag USING(alert_id)
  LEFT JOIN ath_cte USING(alert_id)
  GROUP BY j.alert_id
)
SELECT
  a.alert_id,
  a.mint,
  a.caller,
  strftime(a.alert_ts, '%Y-%m-%d %H:%M:%S') AS alert_ts_utc,
  strftime(a.entry_ts, '%Y-%m-%d %H:%M:%S') AS entry_ts_utc,
  {interval_seconds}::INT AS interval_seconds,
  {horizon_hours}::INT AS horizon_hours,

  CASE
    WHEN ag.candles IS NULL OR ag.candles < 2 THEN 'missing'
    WHEN ag.entry_price IS NULL OR ag.entry_price <= 0 THEN 'bad_entry'
    ELSE 'ok'
  END AS status,

  coalesce(ag.candles, 0)::BIGINT AS candles,
  ag.entry_price AS entry_price,

  (ag.max_high / ag.entry_price) AS ath_mult,
  datediff('second', a.entry_ts, ath_cte.ath_ts) AS time_to_ath_s,

  datediff('second', a.entry_ts, ag.ts_2x) AS time_to_2x_s,
  datediff('second', a.entry_ts, ag.ts_3x) AS time_to_3x_s,
  datediff('second', a.entry_ts, ag.ts_4x) AS time_to_4x_s,
  datediff('second', a.entry_ts, ag.ts_5x) AS time_to_5x_s,
  datediff('second', a.entry_ts, ag.ts_10x) AS time_to_10x_s,

  CASE
    WHEN ag.recovery_ts IS NULL THEN (ag.min_low / ag.entry_price) - 1.0
    WHEN mi.min_pre_recovery IS NULL THEN (ag.min_low / ag.entry_price) - 1.0
    ELSE (mi.min_pre_recovery / ag.entry_price) - 1.0
  END AS dd_initial,

  (ag.min_low / ag.entry_price) - 1.0 AS dd_overall,

  CASE WHEN ag.ts_2x IS NULL OR mi.min_pre2x IS NULL THEN NULL
       ELSE (mi.min_pre2x / ag.entry_price) - 1.0 END AS dd_pre2x,

  CASE WHEN ag.ts_2x IS NULL OR mi.min_post2x IS NULL THEN NULL
       ELSE (mi.min_post2x / (ag.entry_price * 2.0)) - 1.0 END AS dd_after_2x,

  CASE WHEN ag.ts_3x IS NULL OR mi.min_post3x IS NULL THEN NULL
       ELSE (mi.min_post3x / (ag.entry_price * 3.0)) - 1.0 END AS dd_after_3x,

  CASE WHEN ag.ts_4x IS NULL OR mi.min_post4x IS NULL THEN NULL
       ELSE (mi.min_post4x / (ag.entry_price * 4.0)) - 1.0 END AS dd_after_4x,

  CASE WHEN ag.ts_5x IS NULL OR mi.min_post5x IS NULL THEN NULL
       ELSE (mi.min_post5x / (ag.entry_price * 5.0)) - 1.0 END AS dd_after_5x,

  CASE WHEN ag.ts_10x IS NULL OR mi.min_post10x IS NULL THEN NULL
       ELSE (mi.min_post10x / (ag.entry_price * 10.0)) - 1.0 END AS dd_after_10x,

  CASE WHEN ath_cte.ath_ts IS NULL OR mi.min_postath IS NULL THEN NULL
       ELSE (mi.min_postath / ag.max_high) - 1.0 END AS dd_after_ath,

  ((ag.max_high / ag.entry_price) - 1.0) * 100.0 AS peak_pnl_pct,
  ((ag.end_close / ag.entry_price) - 1.0) * 100.0 AS ret_end_pct

FROM a
LEFT JOIN agg ag ON ag.alert_id = a.alert_id
LEFT JOIN ath_cte ON ath_cte.alert_id = a.alert_id
LEFT JOIN mins mi ON mi.alert_id = a.alert_id
ORDER BY a.alert_id
        """

        if verbose:
            print("[baseline] running vectorized query...", file=sys.stderr)

        rows = con.execute(sql).fetchall()
        cols = [d[0] for d in con.description]

        out_rows: List[Dict[str, Any]] = []
        for r in rows:
            out_rows.append(dict(zip(cols, r)))

        return out_rows

    finally:
        con.close()


# =============================================================================
# Summary Statistics
# =============================================================================

def summarize_overall(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    ok = [r for r in rows if r.get("status") == "ok"]

    def take(field: str) -> List[float]:
        xs = []
        for r in ok:
            v = r.get(field)
            if v is not None and isinstance(v, (int, float)) and not math.isnan(v):
                xs.append(float(v))
        return xs

    def med(xs: List[float]) -> Optional[float]:
        return median(xs) if xs else None

    def pct_hit(field: str) -> float:
        if not ok:
            return 0.0
        return sum(1 for r in ok if r.get(field) is not None) / len(ok)

    def percentile(xs: List[float], p: float) -> Optional[float]:
        if not xs:
            return None
        s = sorted(xs)
        idx = int(len(s) * p)
        return s[min(idx, len(s) - 1)]

    ath = take("ath_mult")
    t2x = take("time_to_2x_s")
    t3x = take("time_to_3x_s")
    t4x = take("time_to_4x_s")

    dd_initial = take("dd_initial")
    dd_overall = take("dd_overall")
    dd_after_2x = take("dd_after_2x")
    dd_after_ath = take("dd_after_ath")

    peak_pnl = take("peak_pnl_pct")
    ret_end = take("ret_end_pct")

    return {
        "alerts_total": len(rows),
        "alerts_ok": len(ok),
        "alerts_missing": len(rows) - len(ok),

        "median_ath_mult": med(ath),
        "p25_ath_mult": percentile(ath, 0.25),
        "p75_ath_mult": percentile(ath, 0.75),

        "pct_hit_2x": pct_hit("time_to_2x_s"),
        "pct_hit_3x": pct_hit("time_to_3x_s"),
        "pct_hit_4x": pct_hit("time_to_4x_s"),
        "pct_hit_5x": pct_hit("time_to_5x_s"),
        "pct_hit_10x": pct_hit("time_to_10x_s"),

        "median_time_to_2x_s": med(t2x),
        "median_time_to_3x_s": med(t3x),
        "median_time_to_4x_s": med(t4x),

        "median_dd_initial": med(dd_initial),
        "median_dd_overall": med(dd_overall),
        "median_dd_after_2x": med(dd_after_2x),
        "median_dd_after_ath": med(dd_after_ath),

        "median_peak_pnl_pct": med(peak_pnl),
        "median_ret_end_pct": med(ret_end),
    }


# =============================================================================
# Caller Aggregation
# =============================================================================

def aggregate_by_caller(rows: List[Dict[str, Any]], min_trades: int = 5) -> List[Dict[str, Any]]:
    ok = [r for r in rows if r.get("status") == "ok" and r.get("caller")]

    by_caller: Dict[str, List[Dict[str, Any]]] = {}
    for r in ok:
        caller = r.get("caller", "").strip()
        if not caller:
            continue
        if caller not in by_caller:
            by_caller[caller] = []
        by_caller[caller].append(r)

    def take(rlist: List[Dict[str, Any]], field: str) -> List[float]:
        xs = []
        for r in rlist:
            v = r.get(field)
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

    def pct_hit(rlist: List[Dict[str, Any]], field: str) -> float:
        if not rlist:
            return 0.0
        return sum(1 for r in rlist if r.get(field) is not None) / len(rlist)

    results: List[Dict[str, Any]] = []
    for caller, rlist in by_caller.items():
        if len(rlist) < min_trades:
            continue

        ath = take(rlist, "ath_mult")
        dd_initial = take(rlist, "dd_initial")
        dd_overall = take(rlist, "dd_overall")
        dd_after_2x = take(rlist, "dd_after_2x")
        dd_after_ath = take(rlist, "dd_after_ath")
        peak_pnl = take(rlist, "peak_pnl_pct")
        ret_end = take(rlist, "ret_end_pct")
        t2x = take(rlist, "time_to_2x_s")

        results.append({
            "caller": caller,
            "n": len(rlist),
            "median_ath": med(ath),
            "p25_ath": percentile(ath, 0.25),
            "p75_ath": percentile(ath, 0.75),
            "hit2x_pct": pct_hit(rlist, "time_to_2x_s") * 100,
            "hit3x_pct": pct_hit(rlist, "time_to_3x_s") * 100,
            "hit4x_pct": pct_hit(rlist, "time_to_4x_s") * 100,
            "hit5x_pct": pct_hit(rlist, "time_to_5x_s") * 100,
            "hit10x_pct": pct_hit(rlist, "time_to_10x_s") * 100,
            "median_t2x_hrs": med(t2x) / 3600 if med(t2x) else None,
            "median_dd_initial_pct": med(dd_initial) * 100 if med(dd_initial) else None,
            "median_dd_overall_pct": med(dd_overall) * 100 if med(dd_overall) else None,
            "median_dd_after_2x_pct": med(dd_after_2x) * 100 if med(dd_after_2x) else None,
            "median_dd_after_ath_pct": med(dd_after_ath) * 100 if med(dd_after_ath) else None,
            "worst_dd_pct": min(dd_overall) * 100 if dd_overall else None,
            "median_peak_pnl_pct": med(peak_pnl),
            "median_ret_end_pct": med(ret_end),
        })

    results.sort(key=lambda x: (x.get("median_ath") or 0), reverse=True)
    for i, r in enumerate(results, start=1):
        r["rank"] = i

    return results


def print_caller_leaderboard(callers: List[Dict[str, Any]], limit: int = 30) -> None:
    if not callers:
        print("No callers with enough trades.", file=sys.stderr)
        return

    headers = [
        ("rank", "int"),
        ("caller", "str"),
        ("n", "int"),
        ("median_ath", "x"),
        ("hit2x_pct", "pct"),
        ("hit3x_pct", "pct"),
        ("hit4x_pct", "pct"),
        ("median_t2x_hrs", "hrs"),
        ("median_dd_initial_pct", "pct"),
        ("median_dd_overall_pct", "pct"),
        ("median_peak_pnl_pct", "pct"),
    ]

    col_widths: Dict[str, int] = {k: max(len(k), 8) for k, _ in headers}

    for r in callers[:limit]:
        for key, kind in headers:
            if key == "caller":
                v = (r.get("caller") or "-").strip()
                col_widths[key] = max(col_widths[key], min(24, len(v)))
            else:
                txt = _fmt(r.get(key), kind)
                col_widths[key] = max(col_widths[key], len(txt))

    line = "  ".join(k.ljust(col_widths[k]) for k, _ in headers)
    print(line)
    print("-" * len(line))

    for r in callers[:limit]:
        parts = []
        for key, kind in headers:
            if key == "caller":
                v = (r.get("caller") or "-").strip()[: col_widths[key]]
                parts.append(v.ljust(col_widths[key]))
            else:
                txt = _fmt(r.get(key), kind)
                parts.append(txt.rjust(col_widths[key]))
        print("  ".join(parts))


# =============================================================================
# DuckDB Storage
# =============================================================================

def store_baseline_to_duckdb(
    duckdb_path: str,
    run_id: str,
    run_name: str,
    config: Dict[str, Any],
    rows: List[Dict[str, Any]],
    summary: Dict[str, Any],
    caller_agg: List[Dict[str, Any]],
) -> None:
    con = duckdb.connect(duckdb_path)
    try:
        con.execute("CREATE SCHEMA IF NOT EXISTS baseline")

        con.execute("""
            CREATE TABLE IF NOT EXISTS baseline.runs_d (
                run_id UUID PRIMARY KEY,
                created_at TIMESTAMP,
                run_name VARCHAR,
                date_from DATE,
                date_to DATE,
                interval_seconds INTEGER,
                horizon_hours INTEGER,
                chain VARCHAR,
                alerts_total INTEGER,
                alerts_ok INTEGER,
                config_json JSON,
                summary_json JSON
            )
        """)

        created_at = datetime.now(UTC)
        con.execute("""
            INSERT INTO baseline.runs_d VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            run_id,
            created_at,
            run_name,
            config.get("date_from"),
            config.get("date_to"),
            config.get("interval_seconds"),
            config.get("horizon_hours"),
            config.get("chain"),
            summary.get("alerts_total"),
            summary.get("alerts_ok"),
            json.dumps(config),
            json.dumps(summary),
        ])

        con.execute("""
            CREATE TABLE IF NOT EXISTS baseline.alert_results_f (
                run_id UUID,
                alert_id BIGINT,
                mint VARCHAR,
                caller VARCHAR,
                alert_ts_utc TIMESTAMP,
                entry_ts_utc TIMESTAMP,
                status VARCHAR,
                candles BIGINT,
                entry_price DOUBLE,
                ath_mult DOUBLE,
                time_to_ath_s BIGINT,
                time_to_2x_s BIGINT,
                time_to_3x_s BIGINT,
                time_to_4x_s BIGINT,
                time_to_5x_s BIGINT,
                time_to_10x_s BIGINT,
                dd_initial DOUBLE,
                dd_overall DOUBLE,
                dd_pre2x DOUBLE,
                dd_after_2x DOUBLE,
                dd_after_3x DOUBLE,
                dd_after_4x DOUBLE,
                dd_after_5x DOUBLE,
                dd_after_10x DOUBLE,
                dd_after_ath DOUBLE,
                peak_pnl_pct DOUBLE,
                ret_end_pct DOUBLE
            )
        """)

        for r in rows:
            con.execute("""
                INSERT INTO baseline.alert_results_f VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?
                )
            """, [
                run_id,
                r.get("alert_id"),
                r.get("mint"),
                r.get("caller"),
                r.get("alert_ts_utc"),
                r.get("entry_ts_utc"),
                r.get("status"),
                r.get("candles"),
                r.get("entry_price"),
                r.get("ath_mult"),
                r.get("time_to_ath_s"),
                r.get("time_to_2x_s"),
                r.get("time_to_3x_s"),
                r.get("time_to_4x_s"),
                r.get("time_to_5x_s"),
                r.get("time_to_10x_s"),
                r.get("dd_initial"),
                r.get("dd_overall"),
                r.get("dd_pre2x"),
                r.get("dd_after_2x"),
                r.get("dd_after_3x"),
                r.get("dd_after_4x"),
                r.get("dd_after_5x"),
                r.get("dd_after_10x"),
                r.get("dd_after_ath"),
                r.get("peak_pnl_pct"),
                r.get("ret_end_pct"),
            ])

        con.execute("""
            CREATE TABLE IF NOT EXISTS baseline.caller_stats_f (
                run_id UUID,
                caller VARCHAR,
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
                median_dd_after_2x_pct DOUBLE,
                median_dd_after_ath_pct DOUBLE,
                worst_dd_pct DOUBLE,
                median_peak_pnl_pct DOUBLE,
                median_ret_end_pct DOUBLE
            )
        """)

        for c in caller_agg:
            con.execute("""
                INSERT INTO baseline.caller_stats_f VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
            """, [
                run_id,
                c.get("caller"),
                c.get("n"),
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
                c.get("median_dd_after_2x_pct"),
                c.get("median_dd_after_ath_pct"),
                c.get("worst_dd_pct"),
                c.get("median_peak_pnl_pct"),
                c.get("median_ret_end_pct"),
            ])

        con.commit()
    finally:
        con.close()


# =============================================================================
# Main
# =============================================================================

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Complete Baseline Backtest Pipeline - ClickHouse export + vectorized DuckDB analysis"
    )
    
    # Date range
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")
    
    # DuckDB alerts source
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"))
    ap.add_argument("--chain", default="solana")
    
    # ClickHouse config
    ap.add_argument("--ch-host", default=os.getenv("CLICKHOUSE_HOST", "localhost"))
    ap.add_argument("--ch-port", type=int, default=int(os.getenv("CLICKHOUSE_PORT", "9000")))
    ap.add_argument("--ch-database", default=os.getenv("CLICKHOUSE_DATABASE", "default"))
    ap.add_argument("--ch-table", default=os.getenv("CLICKHOUSE_TABLE", "ohlcv_1m"))
    ap.add_argument("--ch-user", default=os.getenv("CLICKHOUSE_USER", "default"))
    ap.add_argument("--ch-password", default=os.getenv("CLICKHOUSE_PASSWORD", ""))
    
    # Backtest params
    ap.add_argument("--interval-seconds", type=int, choices=[60, 300], default=60)
    ap.add_argument("--horizon-hours", type=int, default=48)
    
    # Slice handling
    ap.add_argument("--slice-dir", default="slices", help="Directory for Parquet slices")
    ap.add_argument("--reuse-slice", action="store_true", help="Reuse existing slice if fingerprint matches")
    ap.add_argument("--slice", default=None, help="Use specific slice file (skip ClickHouse)")
    ap.add_argument("--partition", action="store_true", help="Partition slice by token_address")
    
    # Output
    ap.add_argument("--out-alerts", default="results/baseline_alerts.csv")
    ap.add_argument("--out-callers", default="results/baseline_callers.csv")
    ap.add_argument("--min-trades", type=int, default=10)
    ap.add_argument("--top", type=int, default=50)
    
    # Execution
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--output-format", choices=["console", "json"], default="console")
    ap.add_argument("--verbose", action="store_true")
    
    # Storage
    ap.add_argument("--store-duckdb", action="store_true")
    ap.add_argument("--run-name", default=None)

    args = ap.parse_args()

    date_from = parse_yyyy_mm_dd(args.date_from)
    date_to = parse_yyyy_mm_dd(args.date_to)
    verbose = args.verbose or args.output_format != "json"

    # Step 1: Load alerts
    if verbose:
        print(f"[1/5] Loading alerts from {args.duckdb}...", file=sys.stderr)

    alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
    if not alerts:
        raise SystemExit("No alerts found for that date range.")
    if verbose:
        print(f"      Found {len(alerts)} alerts", file=sys.stderr)

    mints = set(a.mint for a in alerts)

    # Step 2: Determine slice path
    if args.slice:
        # Use provided slice
        slice_path = Path(args.slice)
        if not slice_path.exists():
            raise SystemExit(f"Slice not found: {slice_path}")
        if verbose:
            print(f"[2/5] Using provided slice: {slice_path}", file=sys.stderr)
    else:
        # Export from ClickHouse
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

        # Compute slice fingerprint for caching
        fingerprint = compute_slice_fingerprint(mints, args.chain, date_from, date_to, args.interval_seconds)
        slice_path = Path(args.slice_dir) / f"slice_{date_from.strftime('%Y%m%d')}_{date_to.strftime('%Y%m%d')}_{fingerprint}.parquet"

        if args.reuse_slice and slice_path.exists():
            if verbose:
                print(f"[2/5] Reusing cached slice: {slice_path}", file=sys.stderr)
        else:
            if verbose:
                print(f"[2/5] Querying ClickHouse for coverage...", file=sys.stderr)

            t0 = time.time()
            coverage = query_coverage(ch_cfg, args.chain, mints, args.interval_seconds, date_from, date_to)
            covered_mints = set(m for m, cnt in coverage.items() if cnt > 0)

            if verbose:
                print(f"      Coverage: {len(covered_mints)}/{len(mints)} tokens have candles ({time.time()-t0:.1f}s)", file=sys.stderr)

            if not covered_mints:
                raise SystemExit("No tokens have candle data in ClickHouse for this period.")

            if verbose:
                print(f"[3/5] Exporting slice to Parquet...", file=sys.stderr)

            t0 = time.time()
            row_count = export_slice_to_parquet(
                ch_cfg, args.chain, covered_mints, args.interval_seconds,
                date_from, date_to, slice_path,
                pre_window_minutes=60,
                post_window_hours=args.horizon_hours + 24,
                verbose=verbose,
            )
            if verbose:
                print(f"      Exported {row_count:,} candles in {time.time()-t0:.1f}s", file=sys.stderr)

    # Step 3: Partition if requested
    is_partitioned = slice_path.is_dir()

    if args.partition and not is_partitioned:
        if verbose:
            print(f"[4/5] Partitioning slice by token_address...", file=sys.stderr)
        partition_path = slice_path.parent / f"{slice_path.stem}_part"
        t0 = time.time()
        partition_slice(slice_path, partition_path, args.threads, verbose=verbose)
        if verbose:
            print(f"      Partitioned in {time.time()-t0:.1f}s", file=sys.stderr)
        slice_path = partition_path
        is_partitioned = True
    elif verbose:
        step = "4/5" if not args.slice else "3/5"
        mode = "partitioned" if is_partitioned else "single file"
        print(f"[{step}] Using slice ({mode}): {slice_path}", file=sys.stderr)

    # Step 4: Run baseline backtest
    if verbose:
        print(f"[5/5] Running baseline backtest (pure path metrics)...", file=sys.stderr)

    t0 = time.time()
    out_rows = run_baseline_backtest(
        alerts=alerts,
        slice_path=slice_path,
        is_partitioned=is_partitioned,
        interval_seconds=args.interval_seconds,
        horizon_hours=args.horizon_hours,
        threads=args.threads,
        verbose=verbose,
    )
    if verbose:
        print(f"      Query completed in {time.time()-t0:.1f}s", file=sys.stderr)

    # Step 5: Aggregate and summarize
    summary = summarize_overall(out_rows)
    caller_agg = aggregate_by_caller(out_rows, min_trades=args.min_trades)

    # Write CSVs
    alert_fields = [
        "alert_id", "mint", "caller", "alert_ts_utc", "entry_ts_utc",
        "interval_seconds", "horizon_hours", "status", "candles", "entry_price",
        "ath_mult", "time_to_ath_s", "time_to_2x_s", "time_to_3x_s", "time_to_4x_s",
        "time_to_5x_s", "time_to_10x_s",
        "dd_initial", "dd_overall", "dd_pre2x", "dd_after_2x", "dd_after_3x",
        "dd_after_4x", "dd_after_5x", "dd_after_10x", "dd_after_ath",
        "peak_pnl_pct", "ret_end_pct"
    ]
    write_csv(args.out_alerts, alert_fields, out_rows)

    caller_fields = [
        "rank", "caller", "n", "median_ath", "p25_ath", "p75_ath",
        "hit2x_pct", "hit3x_pct", "hit4x_pct", "hit5x_pct", "hit10x_pct",
        "median_t2x_hrs",
        "median_dd_initial_pct", "median_dd_overall_pct",
        "median_dd_after_2x_pct", "median_dd_after_ath_pct", "worst_dd_pct",
        "median_peak_pnl_pct", "median_ret_end_pct"
    ]
    write_csv(args.out_callers, caller_fields, caller_agg)

    run_id = str(uuid.uuid4())

    # Store to DuckDB if requested
    stored = False
    if args.store_duckdb:
        run_name = args.run_name or f"baseline_{date_from.strftime('%Y%m%d')}_{date_to.strftime('%Y%m%d')}"
        config = {
            "date_from": date_from.strftime("%Y-%m-%d"),
            "date_to": date_to.strftime("%Y-%m-%d"),
            "interval_seconds": args.interval_seconds,
            "horizon_hours": args.horizon_hours,
            "chain": args.chain,
            "slice_path": str(slice_path),
            "min_trades": args.min_trades,
        }
        store_baseline_to_duckdb(args.duckdb, run_id, run_name, config, out_rows, summary, caller_agg)
        stored = True
        if verbose:
            print(f"[stored] baseline.* run_id={run_id}", file=sys.stderr)

    # Output
    if args.output_format == "json":
        print(json.dumps({
            "success": True,
            "run_id": run_id,
            "stored": stored,
            "slice_path": str(slice_path),
            "out_alerts": args.out_alerts,
            "out_callers": args.out_callers,
            "summary": summary,
            "callers_count": len(caller_agg),
        }))
        return

    # Console output
    print()
    print("=" * 70)
    print("BASELINE BACKTEST COMPLETE (Pure Path Metrics)")
    print("=" * 70)
    print(f"Date range: {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}")
    print(f"Horizon: {args.horizon_hours} hours | Interval: {args.interval_seconds}s")
    print(f"Slice: {slice_path}")
    print(f"Alerts: {summary['alerts_total']} total, {summary['alerts_ok']} ok, {summary['alerts_missing']} missing")
    print(f"Run ID: {run_id} (stored: {stored})")
    print()

    print("--- OVERALL METRICS ---")
    if summary["median_ath_mult"]:
        print(f"Median ATH: {summary['median_ath_mult']:.2f}x (p25={summary.get('p25_ath_mult') or 0:.2f}x, p75={summary.get('p75_ath_mult') or 0:.2f}x)")
    print(f"% hit 2x: {pct(summary['pct_hit_2x']):.1f}%")
    print(f"% hit 3x: {pct(summary['pct_hit_3x']):.1f}%")
    print(f"% hit 4x: {pct(summary['pct_hit_4x']):.1f}%")
    print(f"% hit 5x: {pct(summary['pct_hit_5x']):.1f}%")
    print(f"% hit 10x: {pct(summary['pct_hit_10x']):.1f}%")
    if summary["median_time_to_2x_s"]:
        print(f"Median time-to-2x: {summary['median_time_to_2x_s']/3600:.2f} hours")
    if summary["median_dd_initial"]:
        print(f"Median initial DD: {summary['median_dd_initial']*100:.1f}%")
    if summary["median_dd_overall"]:
        print(f"Median overall DD: {summary['median_dd_overall']*100:.1f}%")
    if summary["median_peak_pnl_pct"]:
        print(f"Median peak PnL: {summary['median_peak_pnl_pct']:.1f}%")
    print()

    print(f"--- CALLER LEADERBOARD (min {args.min_trades} trades, top {args.top}) ---")
    print_caller_leaderboard(caller_agg, limit=args.top)
    print()

    print(f"Alerts CSV: {args.out_alerts}")
    print(f"Callers CSV: {args.out_callers}")


if __name__ == "__main__":
    main()
