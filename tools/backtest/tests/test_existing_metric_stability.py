"""
Regression tests for existing metric stability.

Ensures that adding new path quality metrics doesn't break
existing drawdown, time-to-tier, and win/loss calculations.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List

import pytest

# Add parent directory for imports
_BACKTEST_DIR = Path(__file__).parent.parent
if str(_BACKTEST_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKTEST_DIR))

_TESTS_DIR = Path(__file__).parent
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from fixtures import (
    SyntheticCandle,
    make_candle,
    make_linear_pump,
    make_instant_rug,
    make_precise_multiples,
    write_candles_to_parquet,
)
from lib.alerts import Alert
from lib.tp_sl_query import run_tp_sl_query
from lib.summary import summarize_tp_sl

UTC = timezone.utc


# =============================================================================
# Regression Test Fixtures
# =============================================================================


@pytest.fixture
def base_timestamp() -> datetime:
    """Base timestamp for all tests."""
    return datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)


@pytest.fixture
def linear_pump_setup(tmp_path: Path, base_timestamp: datetime):
    """Setup for linear pump pattern (existing pattern from fixtures)."""
    token = "TOKEN_LINEAR_PUMP"
    candles = make_linear_pump(
        token, 
        base_timestamp, 
        entry_price=1.0,
        peak_mult=3.0,
        candles_to_peak=30,
        candles_after_peak=30,
    )
    slice_path = tmp_path / "slice.parquet"
    write_candles_to_parquet(candles, slice_path)
    
    alert = Alert(
        mint=token,
        caller="TestCaller",
        ts_ms=int(base_timestamp.timestamp() * 1000),
    )
    
    return {"slice_path": slice_path, "alerts": [alert], "token": token}


@pytest.fixture
def instant_rug_setup(tmp_path: Path, base_timestamp: datetime):
    """Setup for instant rug pattern (existing pattern from fixtures)."""
    token = "TOKEN_INSTANT_RUG"
    candles = make_instant_rug(
        token, 
        base_timestamp, 
        entry_price=1.0,
        num_candles=60,
    )
    slice_path = tmp_path / "slice.parquet"
    write_candles_to_parquet(candles, slice_path)
    
    alert = Alert(
        mint=token,
        caller="TestCaller",
        ts_ms=int(base_timestamp.timestamp() * 1000),
    )
    
    return {"slice_path": slice_path, "alerts": [alert], "token": token}


@pytest.fixture
def precise_multiples_setup(tmp_path: Path, base_timestamp: datetime):
    """Setup for precise multiples pattern (hits exactly 2x, 3x, 4x)."""
    token = "TOKEN_PRECISE"
    candles = make_precise_multiples(
        token, 
        base_timestamp, 
        entry_price=1.0,
        num_candles=60,
    )
    slice_path = tmp_path / "slice.parquet"
    write_candles_to_parquet(candles, slice_path)
    
    alert = Alert(
        mint=token,
        caller="TestCaller",
        ts_ms=int(base_timestamp.timestamp() * 1000),
    )
    
    return {"slice_path": slice_path, "alerts": [alert], "token": token}


# =============================================================================
# Regression Tests: Core Metrics Still Work
# =============================================================================


class TestExistingDrawdownMetrics:
    """Ensure existing drawdown metrics still work correctly."""
    
    def test_drawdown_to_tier_computed(self, linear_pump_setup):
        """DD pre-2x should still be computed correctly."""
        setup = linear_pump_setup
        
        rows = run_tp_sl_query(
            alerts=setup["alerts"],
            slice_path=setup["slice_path"],
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=48,
            tp_mult=3.0,
            sl_mult=0.5,
        )
        
        assert len(rows) == 1
        row = rows[0]
        
        # Core DD metrics should still exist
        assert "dd_pre_1_2x" in row
        assert "dd_pre_1_5x" in row
        assert "dd_pre2x" in row  # Note: dd_pre2x (no underscore)
        
        # Should be non-positive (0 or negative)
        dd_pre2x = row.get("dd_pre2x")
        assert dd_pre2x is not None
        assert dd_pre2x <= 0, f"DD should be <= 0, got {dd_pre2x}"
    
    def test_rug_has_high_drawdown(self, instant_rug_setup):
        """Instant rug should still have high drawdown."""
        setup = instant_rug_setup
        
        rows = run_tp_sl_query(
            alerts=setup["alerts"],
            slice_path=setup["slice_path"],
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=48,
            tp_mult=3.0,
            sl_mult=0.5,
        )
        
        row = rows[0]
        
        # Rug goes to 0.1x, should have low tp_sl_ret
        tp_sl_ret = row.get("tp_sl_ret")
        ret_end = row.get("ret_end")
        # Either TP/SL exit or end return should be low
        assert tp_sl_ret is not None or ret_end is not None
        if tp_sl_ret is not None:
            assert tp_sl_ret < 1.0, f"Expected loss, got tp_sl_ret={tp_sl_ret}"
        else:
            assert ret_end < 1.0, f"Expected loss, got ret_end={ret_end}"


class TestExistingTimeToTierMetrics:
    """Ensure existing time-to-tier metrics still work correctly."""
    
    def test_time_to_multiples_computed(self, precise_multiples_setup):
        """Time to 2x, 3x, 4x should still be computed."""
        setup = precise_multiples_setup
        
        rows = run_tp_sl_query(
            alerts=setup["alerts"],
            slice_path=setup["slice_path"],
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=48,
            tp_mult=5.0,  # High TP so we can see time to lower tiers
            sl_mult=0.5,
        )
        
        row = rows[0]
        
        # Time-to-tier metrics should exist (in seconds, not minutes)
        assert "time_to_1_2x_s" in row
        assert "time_to_1_5x_s" in row
        assert "time_to_2x_s" in row
        
        # Should have non-null values for achieved tiers
        time_to_2x = row.get("time_to_2x_s")
        assert time_to_2x is not None, "time_to_2x_s should be computed"
        assert time_to_2x > 0, f"Expected positive time, got {time_to_2x}"


class TestExistingExitMechanics:
    """Ensure TP/SL exit mechanics still work correctly."""
    
    def test_tp_exit_triggered(self, linear_pump_setup):
        """TP should trigger at specified multiplier."""
        setup = linear_pump_setup
        
        rows = run_tp_sl_query(
            alerts=setup["alerts"],
            slice_path=setup["slice_path"],
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=48,
            tp_mult=2.0,  # Lower TP to trigger
            sl_mult=0.5,
        )
        
        row = rows[0]
        
        # Linear pump to 3x should trigger 2x TP
        exit_reason = row.get("tp_sl_exit_reason")
        assert exit_reason == "tp", f"Expected tp exit, got {exit_reason}"
        
        # tp_sl_ret is the P&L percentage (return - 1), so 2x = ~100% = 1.0
        # Due to OHLC pricing nuances, we accept values close to 2x gain
        ret_exit = row.get("tp_sl_ret")
        assert ret_exit is not None
        assert ret_exit >= 0.9, f"Expected positive return near 2x, got {ret_exit}"
    
    def test_sl_exit_triggered(self, instant_rug_setup):
        """SL should trigger when price drops."""
        setup = instant_rug_setup
        
        rows = run_tp_sl_query(
            alerts=setup["alerts"],
            slice_path=setup["slice_path"],
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=48,
            tp_mult=3.0,
            sl_mult=0.5,
        )
        
        row = rows[0]
        
        # Instant rug to 0.1x should trigger 0.5x SL
        exit_reason = row.get("tp_sl_exit_reason")
        assert exit_reason == "sl", f"Expected sl exit, got {exit_reason}"


class TestExistingSummaryMetrics:
    """Ensure existing summary metrics still work correctly."""
    
    def test_summary_core_fields_present(self, linear_pump_setup):
        """Summary should still include core fields."""
        setup = linear_pump_setup
        
        rows = run_tp_sl_query(
            alerts=setup["alerts"],
            slice_path=setup["slice_path"],
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=48,
            tp_mult=3.0,
            sl_mult=0.5,
        )
        
        summary = summarize_tp_sl(rows=rows, sl_mult=0.5)
        
        # Core summary fields should still exist
        core_fields = [
            "alerts_total",
            "alerts_ok",
            "alerts_missing",
            "tp_sl_win_rate",
            "median_ret_end",
            "median_dd_pre2x",
        ]
        
        for field in core_fields:
            assert field in summary, f"Core field {field} missing from summary"
    
    def test_summary_win_rate_correct(self, linear_pump_setup):
        """Win rate should be calculated correctly."""
        setup = linear_pump_setup
        
        rows = run_tp_sl_query(
            alerts=setup["alerts"],
            slice_path=setup["slice_path"],
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=48,
            tp_mult=2.0,  # Hit TP
            sl_mult=0.5,
        )
        
        summary = summarize_tp_sl(rows=rows, sl_mult=0.5)
        
        # Single profitable trade = 100% win rate
        assert summary["tp_sl_win_rate"] == 1.0


class TestNewMetricsCoexist:
    """Ensure new and existing metrics coexist correctly."""
    
    def test_all_metric_categories_present(self, linear_pump_setup):
        """Both old and new metric categories should be present."""
        setup = linear_pump_setup
        
        rows = run_tp_sl_query(
            alerts=setup["alerts"],
            slice_path=setup["slice_path"],
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=48,
            tp_mult=3.0,
            sl_mult=0.5,
        )
        
        row = rows[0]
        
        # OLD metrics (should still exist)
        old_metrics = [
            "dd_pre_1_2x",
            "dd_pre2x",  # Note: no underscore before 2x
            "time_to_2x_s",
            "ath_mult",
            "tp_sl_ret",
            "tp_sl_exit_reason",
        ]
        
        # NEW metrics (should now exist)
        new_metrics = [
            "time_underwater_pct",
            "time_in_profit_pct",
            "stall_score",
            "retention_1_2x_above_1_1x",
            "floor_hold_after_1_2x",
            "giveback_after_1_5x",
            "is_headfake",
            "headfake_depth",
        ]
        
        for metric in old_metrics:
            assert metric in row, f"Old metric {metric} missing"
        
        for metric in new_metrics:
            assert metric in row, f"New metric {metric} missing"
    
    def test_summary_has_both_old_and_new(self, linear_pump_setup):
        """Summary should include both old and new metrics."""
        setup = linear_pump_setup
        
        rows = run_tp_sl_query(
            alerts=setup["alerts"],
            slice_path=setup["slice_path"],
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=48,
            tp_mult=3.0,
            sl_mult=0.5,
        )
        
        summary = summarize_tp_sl(rows=rows, sl_mult=0.5)
        
        # OLD summary metrics
        old_summary = [
            "tp_sl_win_rate",
            "median_dd_pre2x",
            "time_to_2x_median_min",
        ]
        
        # NEW summary metrics
        new_summary = [
            "median_time_underwater_pct",
            "median_stall_score",
            "median_retention_1_2x_above_1_1x",
            "pct_floor_hold_after_1_2x",
            "headfake_rate",
        ]
        
        for metric in old_summary:
            assert metric in summary, f"Old summary metric {metric} missing"
        
        for metric in new_summary:
            assert metric in summary, f"New summary metric {metric} missing"

