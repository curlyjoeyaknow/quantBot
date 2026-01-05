"""
Baseline backtest query.

Pure path metrics - no TP/SL strategies.
Computes ATH, time-to-Nx, drawdowns in a single vectorized SQL pass.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import duckdb

from .alerts import Alert
from .helpers import ceil_ms_to_interval_ts_ms, sql_escape


def run_baseline_query(
    alerts: List[Alert],
    slice_path: Path,
    is_partitioned: bool,
    interval_seconds: int,
    horizon_hours: int,
    threads: int = 8,
    verbose: bool = False,
) -> List[Dict[str, Any]]:
    """
    Run baseline backtest query over alerts.

    Computes pure path metrics:
    - ATH multiple
    - Time to 2x, 3x, 4x, 5x, 10x, ATH
    - Drawdowns (initial, overall, after milestones)
    - Peak PnL, return at horizon

    Args:
        alerts: List of alerts to backtest
        slice_path: Path to Parquet slice (file or partitioned directory)
        is_partitioned: Whether slice is Hive-partitioned
        interval_seconds: Candle interval
        horizon_hours: Lookforward window in hours
        threads: Number of DuckDB threads
        verbose: Print progress

    Returns:
        List of result dicts, one per alert
    """
    horizon_s = int(horizon_hours) * 3600

    # Build alert rows for temp table
    alert_rows: List[Tuple[int, str, str, int, int, int]] = []
    for i, a in enumerate(alerts, start=1):
        entry_ts_ms = ceil_ms_to_interval_ts_ms(a.ts_ms, interval_seconds)
        end_ts_ms = entry_ts_ms + (horizon_s * 1000)
        alert_rows.append((i, a.mint, a.caller, a.ts_ms, entry_ts_ms, end_ts_ms))

    con = duckdb.connect(":memory:")
    try:
        con.execute(f"PRAGMA threads={max(1, int(threads))}")

        # Create alerts temp table
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

        # Create candles view
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
                FROM parquet_scan('{sql_escape(slice_path.as_posix())}')
            """)

        sql = _build_baseline_sql(interval_seconds, horizon_hours)

        if verbose:
            print("[baseline] running vectorized query...", file=sys.stderr)

        rows = con.execute(sql).fetchall()
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        con.close()


def _build_baseline_sql(interval_seconds: int, horizon_hours: int) -> str:
    """Build the baseline metrics SQL query."""
    return f"""
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
    -- Granular tier timestamps (1.2x, 1.5x for finer DD analysis)
    min(j.ts) FILTER (WHERE j.h >= e.entry_price * 1.2) AS ts_1_2x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price * 1.5) AS ts_1_5x,
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
    -- Granular tier min prices (DD before each tier, measured from entry)
    min(CASE WHEN ag.ts_1_2x IS NOT NULL AND j.ts <= ag.ts_1_2x THEN j.l END) AS min_pre_1_2x,
    min(CASE WHEN ag.ts_1_5x IS NOT NULL AND j.ts <= ag.ts_1_5x THEN j.l END) AS min_pre_1_5x,
    min(CASE WHEN ag.ts_2x IS NOT NULL AND j.ts <= ag.ts_2x THEN j.l END) AS min_pre2x,
    -- Min prices in tier bands (after 1.2x but before 1.5x, etc.)
    min(CASE WHEN ag.ts_1_2x IS NOT NULL AND ag.ts_1_5x IS NOT NULL 
             AND j.ts > ag.ts_1_2x AND j.ts <= ag.ts_1_5x THEN j.l END) AS min_band_1_2x_to_1_5x,
    min(CASE WHEN ag.ts_1_5x IS NOT NULL AND ag.ts_2x IS NOT NULL 
             AND j.ts > ag.ts_1_5x AND j.ts <= ag.ts_2x THEN j.l END) AS min_band_1_5x_to_2x,
    -- Post-tier mins (existing)
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
  {int(interval_seconds)}::INT AS interval_seconds,
  {int(horizon_hours)}::INT AS horizon_hours,

  CASE
    WHEN ag.candles IS NULL OR ag.candles < 2 THEN 'missing'
    WHEN ag.entry_price IS NULL OR ag.entry_price <= 0 THEN 'bad_entry'
    ELSE 'ok'
  END AS status,

  coalesce(ag.candles, 0)::BIGINT AS candles,
  ag.entry_price AS entry_price,

  (ag.max_high / ag.entry_price) AS ath_mult,
  datediff('second', a.entry_ts, ath_cte.ath_ts) AS time_to_ath_s,

  -- Time to granular tiers
  datediff('second', a.entry_ts, ag.ts_1_2x) AS time_to_1_2x_s,
  datediff('second', a.entry_ts, ag.ts_1_5x) AS time_to_1_5x_s,
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

  -- DD before granular tiers (from entry price) - key metrics for tiered analysis
  CASE WHEN ag.ts_1_2x IS NULL OR mi.min_pre_1_2x IS NULL THEN NULL
       ELSE (mi.min_pre_1_2x / ag.entry_price) - 1.0 END AS dd_pre_1_2x,
  CASE WHEN ag.ts_1_5x IS NULL OR mi.min_pre_1_5x IS NULL THEN NULL
       ELSE (mi.min_pre_1_5x / ag.entry_price) - 1.0 END AS dd_pre_1_5x,
  CASE WHEN ag.ts_2x IS NULL OR mi.min_pre2x IS NULL THEN NULL
       ELSE (mi.min_pre2x / ag.entry_price) - 1.0 END AS dd_pre2x,
       
  -- DD in tier bands (after hitting tier X but before reaching tier Y)
  -- Measured from the tier's own price level (e.g., DD from 1.2x price after 1.2x hit)
  CASE WHEN ag.ts_1_2x IS NULL OR ag.ts_1_5x IS NULL OR mi.min_band_1_2x_to_1_5x IS NULL THEN NULL
       ELSE (mi.min_band_1_2x_to_1_5x / (ag.entry_price * 1.2)) - 1.0 END AS dd_band_1_2x_to_1_5x,
  CASE WHEN ag.ts_1_5x IS NULL OR ag.ts_2x IS NULL OR mi.min_band_1_5x_to_2x IS NULL THEN NULL
       ELSE (mi.min_band_1_5x_to_2x / (ag.entry_price * 1.5)) - 1.0 END AS dd_band_1_5x_to_2x,

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

