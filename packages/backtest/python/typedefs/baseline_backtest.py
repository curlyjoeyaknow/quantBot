"""Auto-generated Python type stubs from Zod schemas."""

from typing import Literal
from typing import Optional
from typing import TypedDict


class BaselineBacktestConfig(TypedDict, total=False):
    """
    BaselineBacktestConfig type definition.
    Auto-generated from Zod schema.
    """
    # Required fields
    duckdb: str
    from_: str  # from in TypeScript
    to: str

    # Optional fields
    chain: str  # default: 'solana'
    interval_seconds: int  # default: 60
    horizon_hours: int  # default: 48
    pre_window_minutes: int  # default: 5
    slice_dir: str  # default: 'slices/per_token'
    reuse_slice: bool  # default: False
    threads: int  # default: 16
    min_trades: int  # default: 10
    store_duckdb: bool  # default: False
    run_name: Optional[str]
    entry_mode: Literal["next_open", "close", "worst_high"]  # default: "next_open"
    slippage_bps: float  # default: 0

class TokenResult(TypedDict):
    """
    TokenResult type definition.
    Auto-generated from Zod schema.
    """
    alert_id: int
    mint: str
    caller: str
    alert_ts_ms: int
    entry_ts_ms: int
    status: str
    candles: int
    entry_price: Optional[float]
    ath_mult: Optional[float]
    time_to_ath_s: Optional[float]
    time_to_recovery_s: Optional[float]
    time_to_2x_s: Optional[float]
    time_to_3x_s: Optional[float]
    time_to_4x_s: Optional[float]
    time_to_5x_s: Optional[float]
    time_to_10x_s: Optional[float]
    time_to_dd_pre2x_s: Optional[float]
    time_to_dd_after_2x_s: Optional[float]
    time_to_dd_after_3x_s: Optional[float]
    dd_initial: Optional[float]
    dd_overall: Optional[float]
    dd_pre2x: Optional[float]
    dd_pre2x_or_horizon: Optional[float]
    dd_after_2x: Optional[float]
    dd_after_3x: Optional[float]
    dd_after_4x: Optional[float]
    dd_after_5x: Optional[float]
    dd_after_10x: Optional[float]
    dd_after_ath: Optional[float]
    peak_pnl_pct: Optional[float]
    ret_end_pct: Optional[float]

class BaselineBacktestSummary(TypedDict):
    """
    BaselineBacktestSummary type definition.
    Auto-generated from Zod schema.
    """
    alerts_total: int
    alerts_ok: int
    alerts_missing: int
    median_ath_mult: Optional[float]
    p25_ath_mult: Optional[float]
    p75_ath_mult: Optional[float]
    p95_ath_mult: Optional[float]
    pct_hit_2x: float
    pct_hit_3x: float
    pct_hit_4x: float
    pct_hit_5x: float
    pct_hit_10x: float
    median_time_to_recovery_s: Optional[float]
    median_time_to_2x_s: Optional[float]
    median_time_to_3x_s: Optional[float]
    median_time_to_ath_s: Optional[float]
    median_time_to_dd_pre2x_s: Optional[float]
    median_time_to_dd_after_2x_s: Optional[float]
    median_dd_initial: Optional[float]
    median_dd_overall: Optional[float]
    median_dd_pre2x_or_horizon: Optional[float]
    median_peak_pnl_pct: Optional[float]

class BaselineBacktestResult(TypedDict):
    """
    BaselineBacktestResult type definition.
    Auto-generated from Zod schema.
    """
    success: bool
    run_id: str
    stored: bool
    out_alerts: str
    out_callers: str
    summary: BaselineBacktestSummary
    callers_count: int
