"""
Pydantic Models for Runtime Validation

These models provide runtime validation, type coercion, and better error messages.
Use these when you need to validate untrusted input (e.g., from JSON, CLI args, API).

Benefits over TypedDict:
- Runtime validation (catches errors before they cause problems)
- Type coercion (converts "25" to 25 automatically)
- Clear error messages (tells you exactly what's wrong)
- Default values (handled elegantly)
- JSON serialization (built-in .model_dump_json())

Usage:
    from packages.backtest.python.types.pydantic_models import BaselineBacktestConfig
    
    # Validates at runtime!
    config = BaselineBacktestConfig(
        duckdb="path/to/db",
        from_="2024-01-01",
        to="2024-02-01"
    )
    
    # Type coercion
    config = BaselineBacktestConfig(**json_data)  # Converts types automatically
    
    # Validation errors
    try:
        config = BaselineBacktestConfig(duckdb=123)  # Wrong type!
    except ValidationError as e:
        print(e.errors())  # Clear error message
"""

from typing import Optional, Literal, List
from pydantic import BaseModel, Field


# =============================================================================
# Baseline Backtest Models
# =============================================================================

class BaselineBacktestConfig(BaseModel):
    """Baseline backtest configuration with runtime validation."""
    
    duckdb: str
    from_: str = Field(alias='from')  # Handle Python keyword
    to: str
    chain: str = 'solana'
    interval_seconds: int = 60
    horizon_hours: int = 48
    pre_window_minutes: int = 5
    slice_dir: str = 'slices/per_token'
    reuse_slice: bool = False
    threads: int = 16
    min_trades: int = 10
    store_duckdb: bool = False
    run_name: Optional[str] = None
    entry_mode: Literal['next_open', 'close', 'worst_high'] = 'next_open'
    slippage_bps: float = 0.0
    
    class Config:
        populate_by_name = True  # Allow both 'from' and 'from_'


class TokenResult(BaseModel):
    """Per-token backtest result."""
    
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


class BaselineBacktestSummary(BaseModel):
    """Aggregate backtest statistics."""
    
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


class BaselineBacktestResult(BaseModel):
    """Complete baseline backtest result."""
    
    success: bool
    run_id: str
    stored: bool
    out_alerts: str
    out_callers: str
    summary: BaselineBacktestSummary
    callers_count: int


# =============================================================================
# Token Slicer Models
# =============================================================================

class TokenSliceExportConfig(BaseModel):
    """Token slice export configuration."""
    
    mint: str
    chain: str = 'solana'
    alert_ts_ms: int
    interval_seconds: int = 60
    horizon_hours: int = 48
    pre_window_minutes: int = 5
    output_dir: str
    duckdb: Optional[str] = None


class SliceExportResult(BaseModel):
    """Single slice export result."""
    
    success: bool
    mint: str
    slice_path: str
    candles: int
    error: Optional[str] = None


class BatchSliceExportConfig(BaseModel):
    """Batch slice export configuration."""
    
    duckdb: str
    from_: str = Field(alias='from')
    to: str
    chain: str = 'solana'
    interval_seconds: int = 60
    horizon_hours: int = 48
    pre_window_minutes: int = 5
    output_dir: str
    threads: int = 16
    reuse_slice: bool = False
    
    class Config:
        populate_by_name = True


class BatchSliceExportResult(BaseModel):
    """Batch slice export result."""
    
    success: bool
    total_slices: int
    successful: int
    failed: int
    output_dir: str
    slices: List[SliceExportResult]


# =============================================================================
# Caller Analysis Models
# =============================================================================

class CallerAnalysisConfig(BaseModel):
    """Caller analysis configuration."""
    
    duckdb: str
    run_id: Optional[str] = None
    from_: Optional[str] = Field(None, alias='from')
    to: Optional[str] = None
    min_trades: int = 10
    top: int = 50
    format: Literal['json', 'table', 'csv'] = 'json'
    
    class Config:
        populate_by_name = True


class CallerStats(BaseModel):
    """Caller statistics."""
    
    rank: int
    caller: str
    n: int
    median_ath: Optional[float]
    p25_ath: Optional[float]
    p75_ath: Optional[float]
    p95_ath: Optional[float]
    hit2x_pct: float
    hit3x_pct: float
    hit4x_pct: float
    hit5x_pct: float
    hit10x_pct: float
    median_t_recovery_m: Optional[float]
    median_t2x_m: Optional[float]
    median_t3x_m: Optional[float]
    median_t_ath_m: Optional[float]
    median_t_dd_pre2x_m: Optional[float]
    median_t2x_hrs: Optional[float]
    median_dd_initial_pct: Optional[float]
    median_dd_overall_pct: Optional[float]
    median_dd_pre2x_pct: Optional[float]
    median_dd_pre2x_or_horizon_pct: Optional[float]
    median_dd_after_2x_pct: Optional[float]
    median_dd_after_3x_pct: Optional[float]
    median_dd_after_ath_pct: Optional[float]
    worst_dd_pct: Optional[float]
    median_peak_pnl_pct: Optional[float]
    median_ret_end_pct: Optional[float]


class CallerScoring(BaseModel):
    """Caller scoring with v2 algorithm."""
    
    rank: int
    caller: str
    n: int
    median_ath: Optional[float]
    p75_ath: Optional[float]
    p95_ath: Optional[float]
    hit2x_pct: float
    hit3x_pct: float
    hit4x_pct: float
    hit5x_pct: float
    median_t2x_hrs: Optional[float]
    median_t2x_min: Optional[float]
    median_dd_pre2x_pct: Optional[float]
    median_dd_pre2x_or_horizon_pct: Optional[float]
    risk_dd_pct: Optional[float]
    risk_mag: float
    base_upside: float
    tail_bonus: float
    fast2x_signal: float
    discipline_bonus: float
    risk_penalty: float
    confidence: float
    score_v2: float


class CallerAnalysisResult(BaseModel):
    """Caller analysis result."""
    
    success: bool
    run_id: Optional[str] = None
    callers: List[CallerStats]
    scored_callers: Optional[List[CallerScoring]] = None
    total_callers: int

