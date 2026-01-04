#!/usr/bin/env python3
"""
Combined fast backtest workflow:

1. Load alerts from DuckDB
2. Partition the input slice by token_address (if not already partitioned)
3. Run vectorized backtest with predicate pushdown

This combines token_slicer.py and alert_baseline_backtest_fast.py into one workflow.

Usage:
  # Basic usage - will auto-partition if needed
  python3 run_fast_backtest.py --from 2025-12-01 --to 2025-12-24 --slice slices/slice_abc.parquet

  # Skip partitioning if already done
  python3 run_fast_backtest.py --from 2025-12-01 --to 2025-12-24 --slice slices/slice_abc_part/ --no-partition

  # Custom output
  python3 run_fast_backtest.py --from 2025-12-01 --to 2025-12-24 --slice slices/slice_abc.parquet \
    --out results/my_backtest.csv --partition-dir slices/my_partitioned/
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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any, Dict, List, Optional, Tuple

import duckdb

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
        caller_expr = "COALESCE(trigger_from_name, caller_name, '')::TEXT AS caller" if (
            "trigger_from_name" in cols or "caller_name" in cols
        ) else "''::TEXT AS caller"

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
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=caller or ""))

    if (not alerts) and has_user_calls:
        cols = [r[1].lower() for r in conn.execute("PRAGMA table_info('user_calls_d')").fetchall()]
        has_chain = "chain" in cols
        ts_col = "call_ts_ms" if "call_ts_ms" in cols else ("trigger_ts_ms" if "trigger_ts_ms" in cols else None)
        if ts_col is None:
            raise SystemExit(f"No timestamp column found in user_calls_d: {cols}")

        caller_expr = "COALESCE(caller_name, trigger_from_name, '')::TEXT AS caller" if (
            "caller_name" in cols or "trigger_from_name" in cols
        ) else "''::TEXT AS caller"

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
            pass

    conn.close()
    alerts.sort(key=lambda a: (a.ts_ms, a.mint))
    return alerts


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
    """Partition a Parquet slice by token_address using Hive-style partitioning."""
    out_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect(":memory:")
    con.execute(f"PRAGMA threads={max(1, threads)}")

    sql = f"""
COPY (
  SELECT
    token_address,
    timestamp,
    open,
    high,
    low,
    close,
    volume
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
# Summary Statistics
# =============================================================================

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

    def fmt_med(xs: List[float]) -> Optional[float]:
        return median(xs) if xs else None

    ath = take("ath_mult")
    dd_initial = take("dd_initial")
    dd = take("dd_overall")
    ret_end = take("ret_end")
    peak_pnl = take("peak_pnl_pct")
    t_ath = [float(r["time_to_ath_s"]) for r in ok if r.get("time_to_ath_s") is not None]
    t2x = [float(r["time_to_2x_s"]) for r in ok if r.get("time_to_2x_s") is not None]
    t3x = [float(r["time_to_3x_s"]) for r in ok if r.get("time_to_3x_s") is not None]
    dd_after_2x = take("dd_after_2x")
    dd_after_3x = take("dd_after_3x")

    def fmt_pct_hit_2x() -> float:
        if not ok:
            return 0.0
        hit = sum(1 for r in ok if r.get("time_to_2x_s") is not None)
        return hit / len(ok)

    tp_sl_returns = take("tp_sl_ret")
    tp_exits = [r for r in ok if r.get("tp_sl_exit_reason") == "tp"]
    sl_exits = [r for r in ok if r.get("tp_sl_exit_reason") == "sl"]
    horizon_exits = [r for r in ok if r.get("tp_sl_exit_reason") == "horizon"]

    total_trades = len(ok)
    wins = [r for r in ok if r.get("tp_sl_ret", 0) > 0]
    losses = [r for r in ok if r.get("tp_sl_ret", 0) < 0]

    total_return_pct = sum(tp_sl_returns) * 100 if tp_sl_returns else 0.0
    avg_return_pct = (sum(tp_sl_returns) / len(tp_sl_returns) * 100) if tp_sl_returns else 0.0

    win_rate = len(wins) / total_trades if total_trades > 0 else 0.0
    avg_win = (sum(r.get("tp_sl_ret", 0) for r in wins) / len(wins) * 100) if wins else 0.0
    avg_loss = (sum(r.get("tp_sl_ret", 0) for r in losses) / len(losses) * 100) if losses else 0.0

    gross_profit = sum(r.get("tp_sl_ret", 0) for r in wins)
    gross_loss = abs(sum(r.get("tp_sl_ret", 0) for r in losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf") if gross_profit > 0 else 0.0

    expectancy_pct = (win_rate * avg_win) + ((1 - win_rate) * avg_loss)

    return {
        "alerts_total": len(rows),
        "alerts_ok": len(ok),
        "alerts_missing": len(missing),
        "median_ath_mult": fmt_med(ath),
        "median_time_to_ath_s": fmt_med(t_ath),
        "median_time_to_2x_s": fmt_med(t2x),
        "median_time_to_3x_s": fmt_med(t3x),
        "median_dd_initial": fmt_med(dd_initial),
        "median_dd_overall": fmt_med(dd),
        "median_dd_after_2x": fmt_med(dd_after_2x),
        "median_dd_after_3x": fmt_med(dd_after_3x),
        "median_peak_pnl_pct": fmt_med(peak_pnl),
        "median_ret_end": fmt_med(ret_end),
        "pct_hit_2x": fmt_pct_hit_2x(),
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
    }


# =============================================================================
# Vectorized Backtest
# =============================================================================

def run_vectorized_backtest(
    alerts: List[Alert],
    slice_path: Path,
    is_partitioned: bool,
    interval_seconds: int,
    horizon_hours: int,
    tp_mult: float,
    sl_mult: float,
    intrabar_order: str,
    fee_bps: float,
    slippage_bps: float,
    threads: int,
    verbose: bool,
) -> List[Dict[str, Any]]:
    """Run the vectorized backtest query."""
    horizon_s = horizon_hours * 3600

    # Build alerts table
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

        # Create view over Parquet
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

        tp = float(tp_mult)
        sl = float(sl_mult)
        intrabar = intrabar_order

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
    max(j.h) AS max_high, min(j.l) AS min_low, arg_max(j.cl, j.ts) AS end_close,
    min(j.ts) FILTER (WHERE j.h > e.entry_price) AS recovery_ts,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*2.0) AS ts_2x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*3.0) AS ts_3x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*4.0) AS ts_4x
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
    min(CASE WHEN ath_cte.ath_ts IS NOT NULL AND j.ts > ath_cte.ath_ts THEN j.l END) AS min_postath
  FROM j
  JOIN agg ag USING(alert_id)
  LEFT JOIN ath_cte USING(alert_id)
  GROUP BY j.alert_id
),
first_exit AS (
  SELECT j.alert_id,
    min(j.ts) FILTER (WHERE j.h >= (ag.entry_price*{tp}) OR j.l <= (ag.entry_price*{sl})) AS exit_ts
  FROM j JOIN agg ag USING(alert_id) GROUP BY j.alert_id
),
exit_candle AS (
  SELECT fe.alert_id, fe.exit_ts, j.h AS exit_h, j.l AS exit_l, j.cl AS exit_cl,
    ag.entry_price AS entry_price, ag.end_close AS end_close
  FROM first_exit fe
  LEFT JOIN j ON j.alert_id = fe.alert_id AND j.ts = fe.exit_ts
  JOIN agg ag ON ag.alert_id = fe.alert_id
)
SELECT
  a.alert_id, a.mint, a.caller,
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
  CASE
    WHEN ag.recovery_ts IS NULL THEN (ag.min_low/ag.entry_price) - 1.0
    WHEN mi.min_pre_recovery IS NULL THEN (ag.min_low/ag.entry_price) - 1.0
    ELSE (mi.min_pre_recovery/ag.entry_price) - 1.0
  END AS dd_initial,
  (ag.min_low/ag.entry_price) - 1.0 AS dd_overall,
  CASE WHEN ag.ts_2x IS NULL OR mi.min_pre2x IS NULL THEN NULL ELSE (mi.min_pre2x/ag.entry_price) - 1.0 END AS dd_pre2x,
  CASE WHEN ag.ts_2x IS NULL OR mi.min_post2x IS NULL THEN NULL ELSE (mi.min_post2x/(ag.entry_price*2.0)) - 1.0 END AS dd_after_2x,
  CASE WHEN ag.ts_3x IS NULL OR mi.min_post3x IS NULL THEN NULL ELSE (mi.min_post3x/(ag.entry_price*3.0)) - 1.0 END AS dd_after_3x,
  CASE WHEN ag.ts_4x IS NULL OR mi.min_post4x IS NULL THEN NULL ELSE (mi.min_post4x/(ag.entry_price*4.0)) - 1.0 END AS dd_after_4x,
  CASE WHEN ath_cte.ath_ts IS NULL OR mi.min_postath IS NULL THEN NULL ELSE (mi.min_postath/ag.max_high) - 1.0 END AS dd_after_ath,
  ((ag.max_high/ag.entry_price) - 1.0) * 100.0 AS peak_pnl_pct,
  (ag.end_close/ag.entry_price) - 1.0 AS ret_end,
  CASE
    WHEN ec.exit_ts IS NULL THEN 'horizon'
    WHEN ec.exit_h >= (ec.entry_price*{tp}) AND ec.exit_l <= (ec.entry_price*{sl}) THEN
      CASE WHEN '{intrabar}' = 'tp_first' THEN 'tp' ELSE 'sl' END
    WHEN ec.exit_l <= (ec.entry_price*{sl}) THEN 'sl'
    WHEN ec.exit_h >= (ec.entry_price*{tp}) THEN 'tp'
    ELSE 'horizon'
  END AS tp_sl_exit_reason,
  (((CASE
    WHEN ec.exit_ts IS NULL THEN ec.end_close
    WHEN ec.exit_h >= (ec.entry_price*{tp}) AND ec.exit_l <= (ec.entry_price*{sl}) THEN
      CASE WHEN '{intrabar}' = 'tp_first' THEN (ec.entry_price*{tp}) ELSE (ec.entry_price*{sl}) END
    WHEN ec.exit_l <= (ec.entry_price*{sl}) THEN (ec.entry_price*{sl})
    WHEN ec.exit_h >= (ec.entry_price*{tp}) THEN (ec.entry_price*{tp})
    ELSE ec.end_close
  END) * (1.0 - ({fee_bps} + {slippage_bps})/10000.0)) / (ec.entry_price * (1.0 + ({slippage_bps}/10000.0)))) - 1.0 AS tp_sl_ret
FROM a
LEFT JOIN agg ag ON ag.alert_id = a.alert_id
LEFT JOIN ath_cte ON ath_cte.alert_id = a.alert_id
LEFT JOIN mins mi ON mi.alert_id = a.alert_id
LEFT JOIN exit_candle ec ON ec.alert_id = a.alert_id
ORDER BY a.alert_id
        """

        if verbose:
            print("[backtest] running vectorized query...", file=sys.stderr)

        rows = con.execute(sql).fetchall()
        cols = [d[0] for d in con.description]

        out_rows: List[Dict[str, Any]] = []
        for r in rows:
            out_rows.append(dict(zip(cols, r)))

        return out_rows

    finally:
        con.close()


# =============================================================================
# Main
# =============================================================================

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Combined fast backtest: partition slice + run vectorized backtest"
    )
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"))
    ap.add_argument("--chain", default="solana")
    ap.add_argument("--from", dest="date_from", required=True)
    ap.add_argument("--to", dest="date_to", required=True)
    ap.add_argument("--interval-seconds", type=int, choices=[60, 300], default=60)
    ap.add_argument("--horizon-hours", type=int, default=48)

    ap.add_argument("--slice", required=True, help="Input Parquet slice (file or partitioned directory)")
    ap.add_argument("--partition-dir", default=None,
                    help="Output directory for partitioned slice (auto-generated if not specified)")
    ap.add_argument("--no-partition", action="store_true",
                    help="Skip partitioning (use if slice is already partitioned or you want single-file mode)")
    ap.add_argument("--out", default="results/backtest_fast.csv")

    ap.add_argument("--tp-mult", type=float, default=2.0)
    ap.add_argument("--sl-mult", type=float, default=0.5)
    ap.add_argument("--intrabar-order", choices=["sl_first", "tp_first"], default="sl_first")
    ap.add_argument("--fee-bps", type=float, default=30.0)
    ap.add_argument("--slippage-bps", type=float, default=50.0)

    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--output-format", choices=["console", "json"], default="console")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    date_from = parse_yyyy_mm_dd(args.date_from)
    date_to = parse_yyyy_mm_dd(args.date_to)
    slice_path = Path(args.slice)
    verbose = args.verbose or args.output_format != "json"

    if not slice_path.exists():
        raise SystemExit(f"Slice not found: {slice_path}")

    # Step 1: Load alerts
    if verbose:
        print(f"[1/3] Loading alerts from {args.duckdb}...", file=sys.stderr)

    alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
    if not alerts:
        raise SystemExit("No alerts found for that date range.")

    if verbose:
        print(f"      Found {len(alerts)} alerts", file=sys.stderr)

    # Step 2: Partition slice if needed
    is_partitioned = slice_path.is_dir()

    if not args.no_partition and not is_partitioned:
        if verbose:
            print(f"[2/3] Partitioning slice by token_address...", file=sys.stderr)

        if args.partition_dir:
            partition_path = Path(args.partition_dir)
        else:
            partition_path = slice_path.parent / f"{slice_path.stem}_part"

        start_time = time.time()
        partition_slice(slice_path, partition_path, args.threads, verbose=verbose)
        elapsed = time.time() - start_time

        if verbose:
            print(f"      Partitioned in {elapsed:.1f}s -> {partition_path}", file=sys.stderr)

        slice_path = partition_path
        is_partitioned = True
    else:
        if verbose:
            mode = "partitioned directory" if is_partitioned else "single file"
            print(f"[2/3] Using existing slice ({mode}): {slice_path}", file=sys.stderr)

    # Step 3: Run vectorized backtest
    if verbose:
        print(f"[3/3] Running vectorized backtest...", file=sys.stderr)

    start_time = time.time()
    out_rows = run_vectorized_backtest(
        alerts=alerts,
        slice_path=slice_path,
        is_partitioned=is_partitioned,
        interval_seconds=args.interval_seconds,
        horizon_hours=args.horizon_hours,
        tp_mult=args.tp_mult,
        sl_mult=args.sl_mult,
        intrabar_order=args.intrabar_order,
        fee_bps=args.fee_bps,
        slippage_bps=args.slippage_bps,
        threads=args.threads,
        verbose=verbose,
    )
    elapsed = time.time() - start_time

    if verbose:
        print(f"      Query completed in {elapsed:.1f}s", file=sys.stderr)

    # Write CSV
    fieldnames = [
        "mint", "caller", "alert_ts_utc", "entry_ts_utc", "interval_seconds", "horizon_hours",
        "status", "candles", "entry_price", "ath_mult", "time_to_ath_s", "time_to_2x_s",
        "time_to_3x_s", "time_to_4x_s", "dd_initial", "dd_overall", "dd_pre2x", "dd_after_2x",
        "dd_after_3x", "dd_after_4x", "dd_after_ath", "peak_pnl_pct", "ret_end",
        "tp_sl_exit_reason", "tp_sl_ret"
    ]
    write_csv(args.out, fieldnames, out_rows)

    # Compute summary
    s = summarize(out_rows)
    run_id = str(uuid.uuid4())

    if args.output_format == "json":
        result = {
            "success": True,
            "run_id": run_id,
            "csv_path": args.out,
            "slice_path": str(slice_path),
            "partitioned": is_partitioned,
            "summary": {
                "alerts_total": s["alerts_total"],
                "alerts_ok": s["alerts_ok"],
                "alerts_missing": s["alerts_missing"],
                "median_ath_mult": s["median_ath_mult"],
                "median_time_to_2x_hours": s["median_time_to_2x_s"] / 3600.0 if s["median_time_to_2x_s"] else None,
                "pct_hit_2x": pct(s["pct_hit_2x"]),
                "median_peak_pnl_pct": s["median_peak_pnl_pct"],
                "tp_sl_win_rate": s["tp_sl_win_rate"],
                "tp_sl_profit_factor": s["tp_sl_profit_factor"],
                "tp_sl_total_return_pct": s["tp_sl_total_return_pct"],
            },
            "config": {
                "date_from": date_from.strftime("%Y-%m-%d"),
                "date_to": date_to.strftime("%Y-%m-%d"),
                "interval_seconds": args.interval_seconds,
                "horizon_hours": args.horizon_hours,
                "tp_mult": args.tp_mult,
                "sl_mult": args.sl_mult,
            },
        }
        print(json.dumps(result))
        return

    # Console output
    ok = [x for x in out_rows if x.get("status") == "ok"]
    print()
    print("=" * 60)
    print("FAST BACKTEST COMPLETE")
    print("=" * 60)
    print(f"Date range: {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}")
    print(f"Slice: {slice_path} (partitioned: {is_partitioned})")
    print(f"Alerts: {s['alerts_total']} total, {s['alerts_ok']} ok, {s['alerts_missing']} missing")
    print()

    if s["median_ath_mult"] is not None:
        print(f"Median ATH: {s['median_ath_mult']:.3f}x")
    if s["median_time_to_2x_s"] is not None:
        print(f"Median time-to-2x: {s['median_time_to_2x_s']/3600.0:.2f} hours")
    if s["median_peak_pnl_pct"] is not None:
        print(f"Median peak PNL: {s['median_peak_pnl_pct']:.2f}%")
    print(f"% hit 2x: {pct(s['pct_hit_2x']):.2f}%")
    print()

    print("-" * 40)
    print(f"TP/SL POLICY: TP={args.tp_mult}x, SL={args.sl_mult}x")
    print("-" * 40)
    print(f"Exit breakdown: TP={s['tp_sl_tp_exits']}, SL={s['tp_sl_sl_exits']}, Horizon={s['tp_sl_horizon_exits']}")
    print(f"Win rate: {pct(s['tp_sl_win_rate']):.1f}%")
    print(f"Profit factor: {s['tp_sl_profit_factor']:.2f}")
    print(f"Total return (equal sizing): {s['tp_sl_total_return_pct']:.1f}%")
    print("-" * 40)
    print(f"\nResults: {args.out}")


if __name__ == "__main__":
    main()

