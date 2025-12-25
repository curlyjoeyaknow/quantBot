"""
Pydantic schemas for DuckDB storage operations.

All operations use typed input/output models for contract hygiene.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# Base response model
class BaseResponse(BaseModel):
    """Base response with success flag."""
    success: bool
    error: Optional[str] = None


# Strategy storage
class StoreStrategyInput(BaseModel):
    strategy_id: str
    name: str
    entry_config: Dict[str, Any] = Field(default_factory=dict)
    exit_config: Dict[str, Any] = Field(default_factory=dict)
    reentry_config: Optional[Dict[str, Any]] = None
    cost_config: Optional[Dict[str, Any]] = None


class StoreStrategyOutput(BaseResponse):
    strategy_id: Optional[str] = None


# Simulation run storage
class StoreRunInput(BaseModel):
    run_id: str
    strategy_id: str
    mint: str
    alert_timestamp: str
    start_time: str
    end_time: str
    initial_capital: float = Field(default=1000.0)
    final_capital: Optional[float] = None
    total_return_pct: Optional[float] = None
    max_drawdown_pct: Optional[float] = None
    sharpe_ratio: Optional[float] = None
    win_rate: Optional[float] = None
    total_trades: int = Field(default=0)


class StoreRunOutput(BaseResponse):
    run_id: Optional[str] = None


# Query calls
class QueryCallsInput(BaseModel):
    limit: int = Field(default=1000, ge=1, le=10000)
    exclude_unrecoverable: bool = Field(default=True)


class CallItem(BaseModel):
    mint: str
    alert_timestamp: str
    price_usd: Optional[float] = None  # Entry price from user_calls_d


class QueryCallsOutput(BaseResponse):
    calls: Optional[List[CallItem]] = None


# OHLCV metadata
class UpdateOhlcvMetadataInput(BaseModel):
    mint: str
    alert_timestamp: str
    interval_seconds: int = Field(gt=0)
    time_range_start: str
    time_range_end: str
    candle_count: int = Field(ge=0)


class UpdateOhlcvMetadataOutput(BaseResponse):
    pass


class QueryOhlcvMetadataInput(BaseModel):
    mint: str
    alert_timestamp: str
    interval_seconds: int = Field(gt=0)
    required_start: Optional[str] = None
    required_end: Optional[str] = None


class QueryOhlcvMetadataOutput(BaseResponse):
    available: Optional[bool] = None
    time_range_start: Optional[str] = None
    time_range_end: Optional[str] = None
    candle_count: Optional[int] = None


# OHLCV exclusions
class AddOhlcvExclusionInput(BaseModel):
    mint: str
    alert_timestamp: str
    reason: str


class AddOhlcvExclusionOutput(BaseResponse):
    pass


class QueryOhlcvExclusionsInput(BaseModel):
    mints: List[str]
    alert_timestamps: List[str]


class ExcludedItem(BaseModel):
    mint: str
    alert_timestamp: str
    reason: str


class QueryOhlcvExclusionsOutput(BaseResponse):
    excluded: Optional[List[ExcludedItem]] = None


# Report generation
class GenerateReportInput(BaseModel):
    type: str = Field(..., pattern="^(summary|strategy_performance)$")
    strategy_id: Optional[str] = None


class ReportData(BaseModel):
    total_runs: Optional[int] = None
    avg_return_pct: Optional[float] = None
    avg_sharpe_ratio: Optional[float] = None
    avg_win_rate: Optional[float] = None
    total_trades: Optional[int] = None
    avg_drawdown_pct: Optional[float] = None
    strategy_id: Optional[str] = None
    run_count: Optional[int] = None


class GenerateReportOutput(BaseResponse):
    report_type: Optional[str] = None
    data: Optional[ReportData] = None

