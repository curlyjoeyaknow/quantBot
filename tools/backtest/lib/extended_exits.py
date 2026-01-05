"""
Extended Exit Types - Time stop, break-even, trailing stop.

These are still deterministic TP/SL exits, just with dynamic behavior:

1. Time Stop: Exit at T_max if TP/SL not hit (prevents zombie positions)
2. Break-even Move: After +X%, move SL to entry (locks in no-loss)
3. Trailing Stop: After activation, trail from local high

All logic is vectorized in DuckDB SQL for performance.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

import duckdb

from .alerts import Alert
from .helpers import ceil_ms_to_interval_ts_ms, sql_escape

SliceType = Literal["file", "hive", "per_token"]


@dataclass
class ExitConfig:
    """
    Configuration for extended exit logic.
    
    All parameters are optional - None means disabled.
    """
    # Basic TP/SL
    tp_mult: float = 2.0          # Take profit multiplier (e.g., 2.0 = 2x)
    sl_mult: float = 0.5          # Stop loss multiplier (e.g., 0.5 = -50%)
    intrabar_order: str = "sl_first"
    
    # Time stop (exit after max hours if TP/SL not hit)
    time_stop_hours: Optional[float] = None  # e.g., 24 = exit after 24h if no TP/SL
    
    # Break-even move (move SL to entry after +X% gain)
    breakeven_trigger_pct: Optional[float] = None  # e.g., 0.20 = after +20% gain
    breakeven_offset_pct: float = 0.0  # Offset from entry (0 = exact entry, negative = lock some profit)
    
    # Trailing stop (after activation, trail from local high)
    trail_activation_pct: Optional[float] = None  # e.g., 0.30 = activate after +30%
    trail_distance_pct: float = 0.15  # e.g., 0.15 = trail 15% from high
    
    # Cost model
    fee_bps: float = 30.0
    slippage_bps: float = 50.0
    
    def has_time_stop(self) -> bool:
        return self.time_stop_hours is not None and self.time_stop_hours > 0
    
    def has_breakeven(self) -> bool:
        return self.breakeven_trigger_pct is not None and self.breakeven_trigger_pct > 0
    
    def has_trailing(self) -> bool:
        return self.trail_activation_pct is not None and self.trail_activation_pct > 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "tp_mult": self.tp_mult,
            "sl_mult": self.sl_mult,
            "intrabar_order": self.intrabar_order,
            "time_stop_hours": self.time_stop_hours,
            "breakeven_trigger_pct": self.breakeven_trigger_pct,
            "breakeven_offset_pct": self.breakeven_offset_pct,
            "trail_activation_pct": self.trail_activation_pct,
            "trail_distance_pct": self.trail_distance_pct,
            "fee_bps": self.fee_bps,
            "slippage_bps": self.slippage_bps,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExitConfig":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


def run_extended_exit_query(
    alerts: List[Alert],
    slice_path: Path,
    exit_config: ExitConfig,
    interval_seconds: int = 60,
    horizon_hours: int = 48,
    threads: int = 8,
    verbose: bool = False,
    slice_type: Optional[SliceType] = None,
) -> List[Dict[str, Any]]:
    """
    Run backtest with extended exit types.
    
    Supports:
    - Basic TP/SL
    - Time stop (exit after N hours)
    - Break-even move (SL to entry after trigger)
    - Trailing stop (trail from high after activation)
    
    All exits are deterministic and vectorized.
    
    Args:
        alerts: List of alerts to backtest
        slice_path: Path to candle data
        exit_config: Extended exit configuration
        interval_seconds: Candle interval
        horizon_hours: Max lookforward window
        threads: DuckDB threads
        verbose: Print progress
        slice_type: Slice format
    
    Returns:
        List of result dicts per alert
    """
    horizon_s = int(horizon_hours) * 3600
    
    # Apply time stop if configured (reduces horizon)
    effective_horizon_hours = horizon_hours
    if exit_config.has_time_stop():
        effective_horizon_hours = min(horizon_hours, exit_config.time_stop_hours)
        horizon_s = int(effective_horizon_hours * 3600)
    
    # Build alert rows
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
        
        # Determine slice type
        if slice_type is None:
            if slice_path.is_dir():
                from .partitioner import is_hive_partitioned, is_per_token_directory
                if is_hive_partitioned(slice_path):
                    slice_type = "hive"
                elif is_per_token_directory(slice_path):
                    slice_type = "per_token"
                else:
                    slice_type = "hive"
            else:
                slice_type = "file"
        
        # Create candles view
        if slice_type == "hive":
            parquet_glob = f"{slice_path.as_posix()}/**/*.parquet"
            con.execute(f"""
                CREATE VIEW candles AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{parquet_glob}', hive_partitioning=true)
            """)
        elif slice_type == "per_token":
            parquet_glob = f"{slice_path.as_posix()}/*.parquet"
            con.execute(f"""
                CREATE VIEW candles AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{parquet_glob}')
            """)
        else:
            con.execute(f"""
                CREATE VIEW candles AS
                SELECT token_address, timestamp, open, high, low, close, volume
                FROM parquet_scan('{sql_escape(slice_path.as_posix())}')
            """)
        
        if verbose:
            features = []
            if exit_config.has_time_stop():
                features.append(f"time_stop={exit_config.time_stop_hours}h")
            if exit_config.has_breakeven():
                features.append(f"breakeven={exit_config.breakeven_trigger_pct*100:.0f}%")
            if exit_config.has_trailing():
                features.append(f"trail={exit_config.trail_activation_pct*100:.0f}%/{exit_config.trail_distance_pct*100:.0f}%")
            print(f"[extended_exit] features: {', '.join(features) or 'basic TP/SL only'}", file=sys.stderr)
        
        sql = _build_extended_exit_sql(exit_config, interval_seconds, effective_horizon_hours)
        
        if verbose:
            print("[extended_exit] running vectorized query...", file=sys.stderr)
        
        rows = con.execute(sql).fetchall()
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        con.close()


def _build_extended_exit_sql(
    config: ExitConfig,
    interval_seconds: int,
    horizon_hours: float,
) -> str:
    """
    Build SQL for extended exit simulation.
    
    The key insight: we need to track running max high for trailing stop,
    and check dynamic SL levels (original, break-even, or trailing).
    
    We use window functions to compute running max high per alert,
    then determine exit based on priority:
    1. TP hit first
    2. Trailing stop hit (if active)
    3. Break-even stop hit (if triggered but trailing not active)
    4. Original SL hit
    5. Time stop / horizon
    """
    tp = float(config.tp_mult)
    sl = float(config.sl_mult)
    intrabar = config.intrabar_order
    fee_bps = config.fee_bps
    slippage_bps = config.slippage_bps
    
    # Break-even thresholds
    be_trigger = config.breakeven_trigger_pct if config.has_breakeven() else 999.0
    be_offset = config.breakeven_offset_pct
    
    # Trailing thresholds
    trail_act = config.trail_activation_pct if config.has_trailing() else 999.0
    trail_dist = config.trail_distance_pct
    
    return f"""
WITH
-- Base alert data
a AS (
  SELECT
    alert_id, mint, caller, alert_ts_ms,
    to_timestamp(alert_ts_ms/1000.0) AS alert_ts,
    to_timestamp(entry_ts_ms/1000.0) AS entry_ts,
    to_timestamp(end_ts_ms/1000.0) AS end_ts
  FROM alerts_tmp
),

-- Join with candles
j AS (
  SELECT
    a.alert_id, a.mint, a.caller, a.alert_ts, a.entry_ts, a.end_ts,
    c.timestamp AS ts, c.open AS o, c.high AS h, c.low AS l, c.close AS cl,
    ROW_NUMBER() OVER (PARTITION BY a.alert_id ORDER BY c.timestamp) AS candle_idx
  FROM a
  JOIN candles c ON c.token_address = a.mint 
    AND c.timestamp >= a.entry_ts 
    AND c.timestamp < a.end_ts
),

-- Entry price (first candle open)
entry AS (
  SELECT alert_id, arg_min(o, ts) AS entry_price, count(*)::BIGINT AS candles
  FROM j GROUP BY alert_id
),

-- Running max high (for trailing stop)
running AS (
  SELECT
    j.alert_id, j.ts, j.h, j.l, j.cl,
    e.entry_price,
    MAX(j.h) OVER (PARTITION BY j.alert_id ORDER BY j.ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_max_high,
    -- Price relative to entry
    (j.h / e.entry_price) - 1.0 AS high_pct,
    (j.l / e.entry_price) - 1.0 AS low_pct
  FROM j
  JOIN entry e USING(alert_id)
),

-- Compute dynamic stop levels per candle
dynamic_stops AS (
  SELECT
    r.*,
    -- Running max return from entry
    (r.running_max_high / r.entry_price) - 1.0 AS max_return_pct,
    
    -- Break-even triggered? (have we ever been up by be_trigger?)
    MAX(CASE WHEN (r.running_max_high / r.entry_price) - 1.0 >= {be_trigger} THEN 1 ELSE 0 END) 
      OVER (PARTITION BY r.alert_id ORDER BY r.ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS be_triggered,
    
    -- Trailing activated? (have we ever been up by trail_act?)
    MAX(CASE WHEN (r.running_max_high / r.entry_price) - 1.0 >= {trail_act} THEN 1 ELSE 0 END) 
      OVER (PARTITION BY r.alert_id ORDER BY r.ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS trail_activated,
    
    -- Trailing stop level (running_max * (1 - trail_dist))
    r.running_max_high * (1.0 - {trail_dist}) AS trailing_stop_price
  FROM running r
),

-- Determine effective stop level for each candle
effective_stops AS (
  SELECT
    d.*,
    -- Effective SL price for this candle
    CASE
      -- Trailing active: use trailing stop
      WHEN d.trail_activated = 1 AND d.trailing_stop_price > d.entry_price THEN d.trailing_stop_price
      -- Break-even triggered but trailing not active: use entry (+ offset)
      WHEN d.be_triggered = 1 THEN d.entry_price * (1.0 + {be_offset})
      -- Neither: use original SL
      ELSE d.entry_price * {sl}
    END AS effective_sl_price
  FROM dynamic_stops d
),

-- Find first exit candle
exit_detection AS (
  SELECT
    e.alert_id, e.ts, e.h, e.l, e.cl, e.entry_price, e.effective_sl_price,
    e.trail_activated, e.be_triggered,
    -- TP hit?
    CASE WHEN e.h >= e.entry_price * {tp} THEN 1 ELSE 0 END AS tp_hit,
    -- Effective SL hit?
    CASE WHEN e.l <= e.effective_sl_price THEN 1 ELSE 0 END AS sl_hit,
    -- Exit reason this candle
    CASE
      WHEN e.h >= e.entry_price * {tp} AND e.l <= e.effective_sl_price THEN
        CASE WHEN '{intrabar}' = 'tp_first' THEN 'tp' ELSE 
          CASE 
            WHEN e.trail_activated = 1 THEN 'trail' 
            WHEN e.be_triggered = 1 THEN 'breakeven'
            ELSE 'sl'
          END
        END
      WHEN e.l <= e.effective_sl_price THEN
        CASE 
          WHEN e.trail_activated = 1 THEN 'trail' 
          WHEN e.be_triggered = 1 THEN 'breakeven'
          ELSE 'sl'
        END
      WHEN e.h >= e.entry_price * {tp} THEN 'tp'
      ELSE NULL
    END AS exit_reason_this_candle,
    -- Exit price this candle
    CASE
      WHEN e.h >= e.entry_price * {tp} AND e.l <= e.effective_sl_price THEN
        CASE WHEN '{intrabar}' = 'tp_first' THEN e.entry_price * {tp} ELSE e.effective_sl_price END
      WHEN e.l <= e.effective_sl_price THEN e.effective_sl_price
      WHEN e.h >= e.entry_price * {tp} THEN e.entry_price * {tp}
      ELSE NULL
    END AS exit_price_this_candle
  FROM effective_stops e
),

-- First exit (earliest candle with an exit)
first_exit AS (
  SELECT alert_id,
    min(ts) FILTER (WHERE exit_reason_this_candle IS NOT NULL) AS exit_ts
  FROM exit_detection
  GROUP BY alert_id
),

-- Get exit details
exit_details AS (
  SELECT 
    fe.alert_id,
    fe.exit_ts,
    ed.exit_reason_this_candle AS exit_reason,
    ed.exit_price_this_candle AS exit_price,
    ed.entry_price,
    ed.effective_sl_price,
    ed.trail_activated,
    ed.be_triggered
  FROM first_exit fe
  LEFT JOIN exit_detection ed ON ed.alert_id = fe.alert_id AND ed.ts = fe.exit_ts
),

-- Aggregates for path metrics
agg AS (
  SELECT
    j.alert_id, e.entry_price, e.candles,
    max(j.h) AS max_high, min(j.l) AS min_low, arg_max(j.cl, j.ts) AS end_close,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*2.0) AS ts_2x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*3.0) AS ts_3x,
    min(j.ts) FILTER (WHERE j.h >= e.entry_price*4.0) AS ts_4x
  FROM j JOIN entry e USING(alert_id)
  GROUP BY j.alert_id, e.entry_price, e.candles
),

-- ATH timestamp
ath_cte AS (
  SELECT j.alert_id, min(j.ts) AS ath_ts
  FROM j JOIN agg ag USING(alert_id) WHERE j.h = ag.max_high
  GROUP BY j.alert_id
)

-- Final output
SELECT
  a.alert_id, a.mint, a.caller,
  strftime(a.alert_ts, '%Y-%m-%d %H:%M:%S') AS alert_ts_utc,
  strftime(a.entry_ts, '%Y-%m-%d %H:%M:%S') AS entry_ts_utc,
  {int(interval_seconds)}::INT AS interval_seconds,
  {int(horizon_hours)}::INT AS horizon_hours,
  
  -- Status
  CASE
    WHEN ag.candles IS NULL OR ag.candles < 2 THEN 'missing'
    WHEN ag.entry_price IS NULL OR ag.entry_price <= 0 THEN 'bad_entry'
    ELSE 'ok'
  END AS status,
  
  coalesce(ag.candles, 0)::BIGINT AS candles,
  ag.entry_price AS entry_price,
  
  -- Path metrics
  (ag.max_high / ag.entry_price) AS ath_mult,
  datediff('second', a.entry_ts, ath_cte.ath_ts) AS time_to_ath_s,
  datediff('second', a.entry_ts, ag.ts_2x) AS time_to_2x_s,
  datediff('second', a.entry_ts, ag.ts_3x) AS time_to_3x_s,
  datediff('second', a.entry_ts, ag.ts_4x) AS time_to_4x_s,
  
  (ag.min_low / ag.entry_price) - 1.0 AS dd_overall,
  ((ag.max_high / ag.entry_price) - 1.0) * 100.0 AS peak_pnl_pct,
  (ag.end_close / ag.entry_price) - 1.0 AS ret_end,
  
  -- Exit info
  COALESCE(ed.exit_reason, 'horizon') AS exit_reason,
  strftime(ed.exit_ts, '%Y-%m-%d %H:%M:%S') AS exit_ts_utc,
  datediff('second', a.entry_ts, COALESCE(ed.exit_ts, a.end_ts)) AS hold_time_s,
  
  -- Stop type that was active at exit
  CASE
    WHEN ed.trail_activated = 1 THEN 'trailing'
    WHEN ed.be_triggered = 1 THEN 'breakeven'
    ELSE 'original'
  END AS stop_type_at_exit,
  
  ed.effective_sl_price AS sl_price_at_exit,
  
  -- Trade return with fees/slippage
  (((COALESCE(ed.exit_price, ag.end_close) * (1.0 - ({fee_bps} + {slippage_bps})/10000.0)) 
    / (ag.entry_price * (1.0 + ({slippage_bps}/10000.0)))) - 1.0) AS tp_sl_ret,
  
  -- Exit price
  COALESCE(ed.exit_price, ag.end_close) AS exit_price,
  
  -- Config echo (for reproducibility)
  {tp}::DOUBLE AS tp_mult,
  {sl}::DOUBLE AS sl_mult

FROM a
LEFT JOIN agg ag ON ag.alert_id = a.alert_id
LEFT JOIN ath_cte ON ath_cte.alert_id = a.alert_id
LEFT JOIN exit_details ed ON ed.alert_id = a.alert_id
ORDER BY a.alert_id
"""

