"""
TP/SL backtest query.

Extends baseline path metrics with take-profit/stop-loss exit simulation.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Literal, Tuple

import duckdb

from .alerts import Alert
from .helpers import ceil_ms_to_interval_ts_ms, sql_escape

# Slice type for backwards compatibility
SliceType = Literal["file", "hive", "per_token"]


def run_tp_sl_query(
    alerts: List[Alert],
    slice_path: Path,
    is_partitioned: bool = False,
    interval_seconds: int = 60,
    horizon_hours: int = 48,
    tp_mult: float = 2.0,
    sl_mult: float = 0.5,
    intrabar_order: str = "sl_first",
    fee_bps: float = 30.0,
    slippage_bps: float = 50.0,
    threads: int = 8,
    verbose: bool = False,
    slice_type: SliceType | None = None,
    entry_delay_candles: int = 0,
) -> List[Dict[str, Any]]:
    """
    Run TP/SL backtest query over alerts.

    Computes baseline path metrics plus TP/SL exit simulation:
    - Exit reason (tp, sl, horizon)
    - Trade return after fees/slippage

    Args:
        alerts: List of alerts to backtest
        slice_path: Path to Parquet slice (file, partitioned directory, or per-token directory)
        is_partitioned: Whether slice is Hive-partitioned (legacy, use slice_type instead)
        interval_seconds: Candle interval
        horizon_hours: Lookforward window in hours
        tp_mult: Take-profit multiplier (e.g., 2.0 for 2x)
        sl_mult: Stop-loss multiplier (e.g., 0.5 for -50%)
        intrabar_order: Which exit to take if both hit in same candle ("sl_first" or "tp_first")
        fee_bps: Trading fees in basis points
        slippage_bps: Slippage in basis points
        threads: Number of DuckDB threads
        verbose: Print progress
        slice_type: Explicit slice type ('file', 'hive', 'per_token'). If None, inferred.
        entry_delay_candles: Number of candles to delay entry (0 = immediate, 1+ = latency simulation)

    Returns:
        List of result dicts, one per alert
    """
    horizon_s = int(horizon_hours) * 3600
    entry_delay_ms = entry_delay_candles * interval_seconds * 1000

    # Build alert rows for temp table
    # entry_ts_ms is adjusted by entry_delay_candles for latency simulation
    alert_rows: List[Tuple[int, str, str, int, int, int]] = []
    for i, a in enumerate(alerts, start=1):
        base_entry_ts_ms = ceil_ms_to_interval_ts_ms(a.ts_ms, interval_seconds)
        # Apply entry delay: shift entry to Nth next candle's open
        entry_ts_ms = base_entry_ts_ms + entry_delay_ms
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

        # Determine slice type
        if slice_type is None:
            # Infer from is_partitioned flag (legacy) or path structure
            if is_partitioned:
                slice_type = "hive"
            elif slice_path.is_dir():
                # Check if it's per-token style (flat dir with parquet files)
                from .partitioner import is_hive_partitioned, is_per_token_directory
                if is_hive_partitioned(slice_path):
                    slice_type = "hive"
                elif is_per_token_directory(slice_path):
                    slice_type = "per_token"
                else:
                    slice_type = "hive"  # Default for directories
            else:
                slice_type = "file"

        # Create candles view based on slice type
        if slice_type == "hive":
            parquet_glob = f"{slice_path.as_posix()}/**/*.parquet"
            con.execute(f"""
                CREATE VIEW candles AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{parquet_glob}', hive_partitioning=true)
            """)
            if verbose:
                print(f"[tp_sl] using Hive-partitioned slice: {slice_path}", file=sys.stderr)
        elif slice_type == "per_token":
            # Per-token: flat directory with *.parquet files
            parquet_glob = f"{slice_path.as_posix()}/*.parquet"
            con.execute(f"""
                CREATE VIEW candles AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{parquet_glob}')
            """)
            if verbose:
                print(f"[tp_sl] using per-token slice directory: {slice_path}", file=sys.stderr)
        else:
            # Single file
            con.execute(f"""
                CREATE VIEW candles AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{sql_escape(slice_path.as_posix())}')
            """)
            if verbose:
                print(f"[tp_sl] using single-file slice: {slice_path}", file=sys.stderr)

        sql = _build_tp_sl_sql(
            interval_seconds=interval_seconds,
            horizon_hours=horizon_hours,
            tp_mult=tp_mult,
            sl_mult=sl_mult,
            intrabar_order=intrabar_order,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            entry_delay_candles=entry_delay_candles,
        )

        if verbose:
            delay_str = f" (entry delay: {entry_delay_candles} candles)" if entry_delay_candles > 0 else ""
            print(f"[tp_sl] running vectorized query...{delay_str}", file=sys.stderr)

        rows = con.execute(sql).fetchall()
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        con.close()


def _build_tp_sl_sql(
    interval_seconds: int,
    horizon_hours: int,
    tp_mult: float,
    sl_mult: float,
    intrabar_order: str,
    fee_bps: float,
    slippage_bps: float,
    entry_delay_candles: int = 0,
) -> str:
    """Build the TP/SL metrics SQL query.
    
    Args:
        interval_seconds: Candle interval in seconds
        horizon_hours: Lookforward window in hours
        tp_mult: Take-profit multiplier
        sl_mult: Stop-loss multiplier
        intrabar_order: Which exit to take if both hit in same candle
        fee_bps: Trading fees in basis points
        slippage_bps: Slippage in basis points
        entry_delay_candles: Number of candles entry was delayed (for metadata only)
    """
    tp = float(tp_mult)
    sl = float(sl_mult)
    intrabar = intrabar_order
    entry_delay = int(entry_delay_candles)

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
    max(j.h) AS max_high, min(j.l) AS min_low, arg_max(j.cl, j.ts) AS end_close,
    min(j.ts) FILTER (WHERE j.h > e.entry_price) AS recovery_ts,
    -- Granular tier timestamps (1.2x, 1.5x for finer DD analysis)
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*1.2) AS ts_1_2x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*1.5) AS ts_1_5x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*2.0) AS ts_2x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*3.0) AS ts_3x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*4.0) AS ts_4x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*5.0) AS ts_5x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*10.0) AS ts_10x
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
),
-- =====================================================================
-- PATH QUALITY: Candle stats for time-in-band and underwater metrics
-- =====================================================================
candle_stats AS (
  SELECT
    j.alert_id,
    -- Total candles in window
    COUNT(*)::BIGINT AS total_candles,
    
    -- Candles by price band (using close price for classification)
    COUNT(*) FILTER (WHERE j.cl < ag.entry_price)::BIGINT AS candles_below_entry,
    COUNT(*) FILTER (WHERE j.cl >= ag.entry_price * 1.0 AND j.cl < ag.entry_price * 1.05)::BIGINT AS candles_1_00_1_05,
    COUNT(*) FILTER (WHERE j.cl >= ag.entry_price * 1.05 AND j.cl < ag.entry_price * 1.15)::BIGINT AS candles_1_05_1_15,
    COUNT(*) FILTER (WHERE j.cl >= ag.entry_price * 1.0 AND j.cl < ag.entry_price * 1.2)::BIGINT AS candles_1_0_1_2,
    COUNT(*) FILTER (WHERE j.cl >= ag.entry_price * 1.2 AND j.cl < ag.entry_price * 1.5)::BIGINT AS candles_1_2_1_5,
    COUNT(*) FILTER (WHERE j.cl >= ag.entry_price * 1.5 AND j.cl < ag.entry_price * 2.0)::BIGINT AS candles_1_5_2_0,
    COUNT(*) FILTER (WHERE j.cl >= ag.entry_price * 2.0)::BIGINT AS candles_2_0_plus,
    
    -- Candles before recovery (underwater period)
    COUNT(*) FILTER (WHERE ag.recovery_ts IS NULL OR j.ts < ag.recovery_ts)::BIGINT AS candles_pre_recovery,
    COUNT(*) FILTER (WHERE j.l < ag.entry_price AND (ag.recovery_ts IS NULL OR j.ts < ag.recovery_ts))::BIGINT AS candles_underwater,
    
    -- Candles after recovery (in profit period)
    COUNT(*) FILTER (WHERE ag.recovery_ts IS NOT NULL AND j.ts >= ag.recovery_ts)::BIGINT AS candles_post_recovery,
    COUNT(*) FILTER (WHERE ag.recovery_ts IS NOT NULL AND j.ts >= ag.recovery_ts AND j.l >= ag.entry_price)::BIGINT AS candles_in_profit
    
  FROM j
  JOIN agg ag USING(alert_id)
  GROUP BY j.alert_id
),
-- =====================================================================
-- PATH QUALITY: Retention stats for post-tier retention metrics
-- =====================================================================
retention_stats AS (
  SELECT
    j.alert_id,
    
    -- After hitting 1.2x: how many candles stayed >= 1.1x?
    COUNT(*) FILTER (WHERE ag.ts_1_2x IS NOT NULL AND j.ts > ag.ts_1_2x)::BIGINT AS candles_post_1_2x,
    COUNT(*) FILTER (WHERE ag.ts_1_2x IS NOT NULL AND j.ts > ag.ts_1_2x AND j.l >= ag.entry_price * 1.1)::BIGINT AS candles_post_1_2x_above_1_1x,
    COUNT(*) FILTER (WHERE ag.ts_1_2x IS NOT NULL AND j.ts > ag.ts_1_2x AND j.l >= ag.entry_price * 1.0)::BIGINT AS candles_post_1_2x_above_entry,
    
    -- After hitting 1.5x: how many candles stayed >= 1.3x?
    COUNT(*) FILTER (WHERE ag.ts_1_5x IS NOT NULL AND j.ts > ag.ts_1_5x)::BIGINT AS candles_post_1_5x,
    COUNT(*) FILTER (WHERE ag.ts_1_5x IS NOT NULL AND j.ts > ag.ts_1_5x AND j.l >= ag.entry_price * 1.3)::BIGINT AS candles_post_1_5x_above_1_3x,
    COUNT(*) FILTER (WHERE ag.ts_1_5x IS NOT NULL AND j.ts > ag.ts_1_5x AND j.l >= ag.entry_price * 1.0)::BIGINT AS candles_post_1_5x_above_entry,
    
    -- After hitting 2x: how many candles stayed >= 1.5x?
    COUNT(*) FILTER (WHERE ag.ts_2x IS NOT NULL AND j.ts > ag.ts_2x)::BIGINT AS candles_post_2x,
    COUNT(*) FILTER (WHERE ag.ts_2x IS NOT NULL AND j.ts > ag.ts_2x AND j.l >= ag.entry_price * 1.5)::BIGINT AS candles_post_2x_above_1_5x,
    
    -- Floor hold: min price after hitting each tier (to check if went below entry)
    MIN(CASE WHEN ag.ts_1_2x IS NOT NULL AND j.ts > ag.ts_1_2x THEN j.l END) AS min_low_post_1_2x,
    MIN(CASE WHEN ag.ts_1_5x IS NOT NULL AND j.ts > ag.ts_1_5x THEN j.l END) AS min_low_post_1_5x,
    MIN(CASE WHEN ag.ts_2x IS NOT NULL AND j.ts > ag.ts_2x THEN j.l END) AS min_low_post_2x
    
  FROM j
  JOIN agg ag USING(alert_id)
  GROUP BY j.alert_id
),
-- =====================================================================
-- PATH QUALITY: Headfake detection (hit tier, then dipped before next tier)
-- =====================================================================
headfake_stats AS (
  SELECT
    j.alert_id,
    
    -- Min low between 1.2x hit and 1.5x hit (or horizon if 1.5x not hit)
    MIN(CASE 
      WHEN ag.ts_1_2x IS NOT NULL 
           AND j.ts > ag.ts_1_2x 
           AND (ag.ts_1_5x IS NULL OR j.ts < ag.ts_1_5x)
      THEN j.l 
    END) AS min_low_1_2x_to_1_5x,
    
    -- Min low between 1.5x hit and 2x hit
    MIN(CASE 
      WHEN ag.ts_1_5x IS NOT NULL 
           AND j.ts > ag.ts_1_5x 
           AND (ag.ts_2x IS NULL OR j.ts < ag.ts_2x)
      THEN j.l 
    END) AS min_low_1_5x_to_2x,
    
    -- Did it ever go below entry after 1.2x but before 1.5x?
    MAX(CASE 
      WHEN ag.ts_1_2x IS NOT NULL 
           AND j.ts > ag.ts_1_2x 
           AND (ag.ts_1_5x IS NULL OR j.ts < ag.ts_1_5x)
           AND j.l < ag.entry_price
      THEN 1 ELSE 0 
    END)::INT AS dipped_below_entry_1_2x_to_1_5x,
    
    -- Did it ever go below 1.05x after 1.2x but before 1.5x?
    MAX(CASE 
      WHEN ag.ts_1_2x IS NOT NULL 
           AND j.ts > ag.ts_1_2x 
           AND (ag.ts_1_5x IS NULL OR j.ts < ag.ts_1_5x)
           AND j.l < ag.entry_price * 1.05
      THEN 1 ELSE 0 
    END)::INT AS dipped_below_1_05x_1_2x_to_1_5x
    
  FROM j
  JOIN agg ag USING(alert_id)
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
  {int(interval_seconds)}::INT AS interval_seconds,
  {int(horizon_hours)}::INT AS horizon_hours,
  {entry_delay}::INT AS entry_delay_candles,

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
    WHEN ag.recovery_ts IS NULL THEN (ag.min_low/ag.entry_price) - 1.0
    WHEN mi.min_pre_recovery IS NULL THEN (ag.min_low/ag.entry_price) - 1.0
    ELSE (mi.min_pre_recovery/ag.entry_price) - 1.0
  END AS dd_initial,

  (ag.min_low/ag.entry_price) - 1.0 AS dd_overall,

  -- DD before granular tiers (from entry price) - key metrics for tiered analysis
  CASE WHEN ag.ts_1_2x IS NULL OR mi.min_pre_1_2x IS NULL THEN NULL ELSE (mi.min_pre_1_2x/ag.entry_price) - 1.0 END AS dd_pre_1_2x,
  CASE WHEN ag.ts_1_5x IS NULL OR mi.min_pre_1_5x IS NULL THEN NULL ELSE (mi.min_pre_1_5x/ag.entry_price) - 1.0 END AS dd_pre_1_5x,
  CASE WHEN ag.ts_2x IS NULL OR mi.min_pre2x IS NULL THEN NULL ELSE (mi.min_pre2x/ag.entry_price) - 1.0 END AS dd_pre2x,
  
  -- DD in tier bands (after hitting tier X but before reaching tier Y)
  -- Measured from the tier's own price level (e.g., DD from 1.2x price after 1.2x hit)
  CASE WHEN ag.ts_1_2x IS NULL OR ag.ts_1_5x IS NULL OR mi.min_band_1_2x_to_1_5x IS NULL THEN NULL
       ELSE (mi.min_band_1_2x_to_1_5x/(ag.entry_price*1.2)) - 1.0 END AS dd_band_1_2x_to_1_5x,
  CASE WHEN ag.ts_1_5x IS NULL OR ag.ts_2x IS NULL OR mi.min_band_1_5x_to_2x IS NULL THEN NULL
       ELSE (mi.min_band_1_5x_to_2x/(ag.entry_price*1.5)) - 1.0 END AS dd_band_1_5x_to_2x,

  CASE WHEN ag.ts_2x IS NULL OR mi.min_post2x IS NULL THEN NULL ELSE (mi.min_post2x/(ag.entry_price*2.0)) - 1.0 END AS dd_after_2x,
  CASE WHEN ag.ts_3x IS NULL OR mi.min_post3x IS NULL THEN NULL ELSE (mi.min_post3x/(ag.entry_price*3.0)) - 1.0 END AS dd_after_3x,
  CASE WHEN ag.ts_4x IS NULL OR mi.min_post4x IS NULL THEN NULL ELSE (mi.min_post4x/(ag.entry_price*4.0)) - 1.0 END AS dd_after_4x,
  CASE WHEN ag.ts_5x IS NULL OR mi.min_post5x IS NULL THEN NULL ELSE (mi.min_post5x/(ag.entry_price*5.0)) - 1.0 END AS dd_after_5x,
  CASE WHEN ag.ts_10x IS NULL OR mi.min_post10x IS NULL THEN NULL ELSE (mi.min_post10x/(ag.entry_price*10.0)) - 1.0 END AS dd_after_10x,
  CASE WHEN ath_cte.ath_ts IS NULL OR mi.min_postath IS NULL THEN NULL ELSE (mi.min_postath/ag.max_high) - 1.0 END AS dd_after_ath,

  ((ag.max_high/ag.entry_price) - 1.0) * 100.0 AS peak_pnl_pct,
  (ag.end_close/ag.entry_price) - 1.0 AS ret_end,

  -- =====================================================================
  -- PATH QUALITY: Time in bands (from candle_stats)
  -- =====================================================================
  cs.total_candles,
  cs.candles_1_0_1_2,
  cs.candles_1_2_1_5,
  cs.candles_1_5_2_0,
  cs.candles_2_0_plus,

  -- Time in profit / underwater (as percentages)
  CASE WHEN cs.candles_pre_recovery > 0 
       THEN cs.candles_underwater::FLOAT / cs.candles_pre_recovery 
       ELSE 0 END AS time_underwater_pct,
  CASE WHEN cs.candles_post_recovery > 0 
       THEN cs.candles_in_profit::FLOAT / cs.candles_post_recovery 
       ELSE NULL END AS time_in_profit_pct,

  -- Stall score: % of time stuck in chop zone (1.05-1.15)
  CASE WHEN cs.total_candles > 0 
       THEN (cs.candles_1_05_1_15::FLOAT / cs.total_candles) 
       ELSE 0 END AS stall_score,

  -- =====================================================================
  -- PATH QUALITY: Retention metrics (from retention_stats)
  -- =====================================================================
  -- Retention after 1.2x: % of candles that stayed >= 1.1x
  CASE WHEN rs.candles_post_1_2x > 0 
       THEN rs.candles_post_1_2x_above_1_1x::FLOAT / rs.candles_post_1_2x 
       ELSE NULL END AS retention_1_2x_above_1_1x,

  -- Retention after 1.5x: % of candles that stayed >= 1.3x
  CASE WHEN rs.candles_post_1_5x > 0 
       THEN rs.candles_post_1_5x_above_1_3x::FLOAT / rs.candles_post_1_5x 
       ELSE NULL END AS retention_1_5x_above_1_3x,

  -- Floor hold: 1 if price never went below entry after hitting tier
  CASE WHEN ag.ts_1_2x IS NOT NULL AND rs.min_low_post_1_2x >= ag.entry_price 
       THEN 1 ELSE 0 END AS floor_hold_after_1_2x,
  CASE WHEN ag.ts_1_5x IS NOT NULL AND rs.min_low_post_1_5x >= ag.entry_price 
       THEN 1 ELSE 0 END AS floor_hold_after_1_5x,

  -- Giveback: max drawdown from tier level after hitting tier
  CASE WHEN ag.ts_1_5x IS NOT NULL AND rs.min_low_post_1_5x IS NOT NULL 
       THEN (rs.min_low_post_1_5x / (ag.entry_price * 1.5)) - 1.0 
       ELSE NULL END AS giveback_after_1_5x,
  CASE WHEN ag.ts_2x IS NOT NULL AND rs.min_low_post_2x IS NOT NULL 
       THEN (rs.min_low_post_2x / (ag.entry_price * 2.0)) - 1.0 
       ELSE NULL END AS giveback_after_2x,

  -- =====================================================================
  -- PATH QUALITY: Headfake metrics (from headfake_stats)
  -- =====================================================================
  -- Headfake: hit 1.2x, then dipped below entry before hitting 1.5x
  CASE WHEN ag.ts_1_2x IS NOT NULL AND hs.dipped_below_entry_1_2x_to_1_5x = 1 
       THEN 1 ELSE 0 END AS is_headfake,

  -- Headfake depth: how far below entry did it go?
  CASE WHEN ag.ts_1_2x IS NOT NULL AND hs.min_low_1_2x_to_1_5x IS NOT NULL 
            AND hs.min_low_1_2x_to_1_5x < ag.entry_price
       THEN (hs.min_low_1_2x_to_1_5x / ag.entry_price) - 1.0 
       ELSE NULL END AS headfake_depth,

  -- Headfake recovery: did it eventually hit 1.5x after headfaking?
  CASE WHEN ag.ts_1_2x IS NOT NULL 
            AND hs.dipped_below_entry_1_2x_to_1_5x = 1 
            AND ag.ts_1_5x IS NOT NULL 
       THEN 1 ELSE 0 END AS headfake_recovered,

  -- TP/SL exit logic
  CASE
    WHEN ec.exit_ts IS NULL THEN 'horizon'
    WHEN ec.exit_h >= (ec.entry_price*{tp}) AND ec.exit_l <= (ec.entry_price*{sl}) THEN
      CASE WHEN '{intrabar}' = 'tp_first' THEN 'tp' ELSE 'sl' END
    WHEN ec.exit_l <= (ec.entry_price*{sl}) THEN 'sl'
    WHEN ec.exit_h >= (ec.entry_price*{tp}) THEN 'tp'
    ELSE 'horizon'
  END AS tp_sl_exit_reason,

  -- Trade return with fees/slippage
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
LEFT JOIN candle_stats cs ON cs.alert_id = a.alert_id
LEFT JOIN retention_stats rs ON rs.alert_id = a.alert_id
LEFT JOIN headfake_stats hs ON hs.alert_id = a.alert_id
LEFT JOIN exit_candle ec ON ec.alert_id = a.alert_id
ORDER BY a.alert_id
"""

