from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import duckdb

UTC = timezone.utc


@dataclass(frozen=True)
class RunMeta:
    run_id: str
    created_at_utc: str
    duration_s: float
    duckdb_path: str
    chain: str
    date_from: str
    date_to: str
    interval_seconds: int
    horizon_hours: int
    tp_mult: float
    sl_mult: float
    intrabar_order: str
    fee_bps: float
    slippage_bps: float
    slice_path: str
    partitioned_hive: bool
    out_csv: str
    alerts_total: int
    alerts_ok: int
    alerts_missing: int
    summary_json: str
    config_json: str


def _now_utc_iso() -> str:
    return datetime.now(tz=UTC).strftime("%Y-%m-%d %H:%M:%S")


def _ensure_schema(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("CREATE SCHEMA IF NOT EXISTS backtests;")

    con.execute("""
    CREATE TABLE IF NOT EXISTS backtests.runs (
      run_id TEXT,
      created_at_utc TIMESTAMP,
      duration_s DOUBLE,

      alerts_duckdb TEXT,
      chain TEXT,
      date_from DATE,
      date_to DATE,

      interval_seconds INTEGER,
      horizon_hours INTEGER,

      tp_mult DOUBLE,
      sl_mult DOUBLE,
      intrabar_order TEXT,
      fee_bps DOUBLE,
      slippage_bps DOUBLE,

      slice_path TEXT,
      partitioned_hive BOOLEAN,
      out_csv TEXT,

      alerts_total INTEGER,
      alerts_ok INTEGER,
      alerts_missing INTEGER,

      summary_json TEXT,
      config_json TEXT
    );
    """)

    con.execute("""
    CREATE TABLE IF NOT EXISTS backtests.results (
      run_id TEXT,
      alert_id BIGINT,
      mint TEXT,
      caller TEXT,
      alert_ts_utc TIMESTAMP,
      entry_ts_utc TIMESTAMP,
      interval_seconds INTEGER,
      horizon_hours INTEGER,
      status TEXT,
      candles BIGINT,
      entry_price DOUBLE,
      ath_mult DOUBLE,
      time_to_ath_s BIGINT,
      time_to_2x_s BIGINT,
      time_to_3x_s BIGINT,
      time_to_4x_s BIGINT,
      dd_initial DOUBLE,
      dd_overall DOUBLE,
      dd_pre2x DOUBLE,
      dd_after_2x DOUBLE,
      dd_after_3x DOUBLE,
      dd_after_4x DOUBLE,
      dd_after_ath DOUBLE,
      peak_pnl_pct DOUBLE,
      ret_end DOUBLE,
      tp_sl_exit_reason TEXT,
      tp_sl_ret DOUBLE
    );
    """)

    # Nice-to-have indexes (DuckDB "CREATE INDEX" is supported in newer versions; ignore failures gracefully)
    try:
        con.execute("CREATE INDEX IF NOT EXISTS idx_runs_created ON backtests.runs(created_at_utc);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_results_run ON backtests.results(run_id);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_results_mint ON backtests.results(mint);")
    except Exception:
        pass


def open_run_db(path: str) -> duckdb.DuckDBPyConnection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(path)
    con.execute("PRAGMA enable_object_cache=true")
    _ensure_schema(con)
    return con


def build_run_meta(
    *,
    start_time: float,
    alerts_duckdb: str,
    chain: str,
    date_from: str,
    date_to: str,
    interval_seconds: int,
    horizon_hours: int,
    tp_mult: float,
    sl_mult: float,
    intrabar_order: str,
    fee_bps: float,
    slippage_bps: float,
    slice_path: str,
    partitioned_hive: bool,
    out_csv: str,
    alerts_total: int,
    alerts_ok: int,
    alerts_missing: int,
    summary: Dict[str, Any],
    config: Dict[str, Any],
    run_id: Optional[str] = None,
) -> RunMeta:
    rid = run_id or str(uuid.uuid4())
    duration_s = time.time() - start_time

    return RunMeta(
        run_id=rid,
        created_at_utc=_now_utc_iso(),
        duration_s=duration_s,
        duckdb_path=alerts_duckdb,
        chain=chain,
        date_from=date_from,
        date_to=date_to,
        interval_seconds=interval_seconds,
        horizon_hours=horizon_hours,
        tp_mult=tp_mult,
        sl_mult=sl_mult,
        intrabar_order=intrabar_order,
        fee_bps=fee_bps,
        slippage_bps=slippage_bps,
        slice_path=slice_path,
        partitioned_hive=partitioned_hive,
        out_csv=out_csv,
        alerts_total=alerts_total,
        alerts_ok=alerts_ok,
        alerts_missing=alerts_missing,
        summary_json=json.dumps(summary, default=str),
        config_json=json.dumps(config, default=str),
    )


def insert_run(con: duckdb.DuckDBPyConnection, meta: RunMeta) -> None:
    con.execute("""
    INSERT INTO backtests.runs VALUES (
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    );
    """, [
        meta.run_id,
        meta.created_at_utc,
        meta.duration_s,
        meta.duckdb_path,
        meta.chain,
        meta.date_from,
        meta.date_to,
        meta.interval_seconds,
        meta.horizon_hours,
        meta.tp_mult,
        meta.sl_mult,
        meta.intrabar_order,
        meta.fee_bps,
        meta.slippage_bps,
        meta.slice_path,
        meta.partitioned_hive,
        meta.out_csv,
        meta.alerts_total,
        meta.alerts_ok,
        meta.alerts_missing,
        meta.summary_json,
        meta.config_json,
    ])


def insert_results(con: duckdb.DuckDBPyConnection, run_id: str, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return

    # Ensure all keys exist to avoid KeyError
    cols = [
        "alert_id","mint","caller","alert_ts_utc","entry_ts_utc","interval_seconds","horizon_hours",
        "status","candles","entry_price","ath_mult","time_to_ath_s","time_to_2x_s","time_to_3x_s","time_to_4x_s",
        "dd_initial","dd_overall","dd_pre2x","dd_after_2x","dd_after_3x","dd_after_4x","dd_after_ath",
        "peak_pnl_pct","ret_end","tp_sl_exit_reason","tp_sl_ret"
    ]

    payload = []
    for r in rows:
        payload.append([
            run_id,
            r.get("alert_id"),
            r.get("mint"),
            r.get("caller"),
            r.get("alert_ts_utc"),
            r.get("entry_ts_utc"),
            r.get("interval_seconds"),
            r.get("horizon_hours"),
            r.get("status"),
            r.get("candles"),
            r.get("entry_price"),
            r.get("ath_mult"),
            r.get("time_to_ath_s"),
            r.get("time_to_2x_s"),
            r.get("time_to_3x_s"),
            r.get("time_to_4x_s"),
            r.get("dd_initial"),
            r.get("dd_overall"),
            r.get("dd_pre2x"),
            r.get("dd_after_2x"),
            r.get("dd_after_3x"),
            r.get("dd_after_4x"),
            r.get("dd_after_ath"),
            r.get("peak_pnl_pct"),
            r.get("ret_end"),
            r.get("tp_sl_exit_reason"),
            r.get("tp_sl_ret"),
        ])

    con.executemany("""
    INSERT INTO backtests.results (
      run_id,
      alert_id, mint, caller, alert_ts_utc, entry_ts_utc, interval_seconds, horizon_hours,
      status, candles, entry_price, ath_mult,
      time_to_ath_s, time_to_2x_s, time_to_3x_s, time_to_4x_s,
      dd_initial, dd_overall, dd_pre2x, dd_after_2x, dd_after_3x, dd_after_4x, dd_after_ath,
      peak_pnl_pct, ret_end, tp_sl_exit_reason, tp_sl_ret
    ) VALUES (
      ?,?,?,?,?,?,?,?,
      ?,?,?,?,?,?,?,?,
      ?,?,?,?,?,?,?,?,
      ?,?,?
    );
    """, payload)


def print_last_runs(con: duckdb.DuckDBPyConnection, limit: int = 10) -> None:
    rows = con.execute(f"""
      SELECT created_at_utc, run_id, date_from, date_to, interval_seconds, horizon_hours,
             alerts_ok, alerts_missing,
             json_extract(summary_json, '$.median_ath_mult') AS med_ath,
             json_extract(summary_json, '$.pct_hit_2x') AS hit_2x,
             out_csv
      FROM backtests.runs
      ORDER BY created_at_utc DESC
      LIMIT {int(limit)}
    """).fetchall()

    print("\n== last runs ==")
    for r in rows:
        print("  ", r)

