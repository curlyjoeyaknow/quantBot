"""Auto-generated Python type stubs from Zod schemas."""

from typing import List
from typing import Literal
from typing import Optional
from typing import TypedDict


class CallerAnalysisConfig(TypedDict, total=False):
    """
    CallerAnalysisConfig type definition.
    Auto-generated from Zod schema.
    """
    # Required fields
    duckdb: str

    # Optional fields
    run_id: Optional[str]
    from_: Optional[str]  # from in TypeScript
    to: Optional[str]
    min_trades: int  # default: 10
    top: int  # default: 50
    format: Literal["json", "table", "csv"]  # default: "json"

class CallerStats(TypedDict):
    """
    CallerStats type definition.
    Auto-generated from Zod schema.
    """
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

class CallerScoring(TypedDict):
    """
    CallerScoring type definition.
    Auto-generated from Zod schema.
    """
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

class CallerAnalysisResult(TypedDict, total=False):
    """
    CallerAnalysisResult type definition.
    Auto-generated from Zod schema.
    """
    # Required fields
    success: bool
    callers: List[CallerStats]
    total_callers: int

    # Optional fields
    run_id: Optional[str]
    scored_callers: Optional[List[CallerScoring]]
