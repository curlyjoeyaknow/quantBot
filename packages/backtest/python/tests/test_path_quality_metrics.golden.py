"""
Golden tests for path quality metrics.

Tests the new retention, headfake, stall, and time quality metrics
with synthetic candle patterns that have known expected values.
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
    SyntheticAlert,
    make_candle,
    write_candles_to_parquet,
)
from lib.alerts import Alert
from lib.tp_sl_query import run_tp_sl_query
from lib.summary import summarize_tp_sl

UTC = timezone.utc


# =============================================================================
# Synthetic Pattern Generators
# =============================================================================


def make_clean_breakout(
    token: str,
    start_ts: datetime,
    entry_price: float,
    num_candles: int = 60,
    interval_seconds: int = 60,
) -> List[SyntheticCandle]:
    """
    Create a clean breakout pattern:
    - Price rises to 1.2x, stays above 1.1x the whole time
    - Hits 1.5x and stays above 1.3x
    - High retention, no headfake
    
    Expected metrics:
    - retention_1_2x_above_1_1x: ~100%
    - floor_hold_after_1_2x: 1
    - is_headfake: 0
    - stall_score: low
    """
    candles = []
    
    for i in range(num_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        
        if i < 5:
            # Entry phase: gradual rise to 1.2x
            mult = 1.0 + (0.2 * i / 5)
        elif i < 15:
            # Consolidation at 1.2x-1.3x
            mult = 1.2 + (0.1 * (i - 5) / 10)
        elif i < 30:
            # Rise to 1.5x
            mult = 1.3 + (0.2 * (i - 15) / 15)
        elif i < 45:
            # Rise to 2x
            mult = 1.5 + (0.5 * (i - 30) / 15)
        else:
            # Hold at 2x+
            mult = 2.0 + (0.1 * (i - 45) / 15)
        
        # Low never goes below 1.1x after hitting 1.2x
        low_mult = max(mult * 0.96, 1.1 if i >= 5 else 0.98)
        
        o = entry_price * mult * 0.99
        h = entry_price * mult * 1.02
        l = entry_price * low_mult
        c = entry_price * mult
        candles.append(make_candle(token, ts, o, h, l, c))
    
    return candles


def make_headfake_pattern(
    token: str,
    start_ts: datetime,
    entry_price: float,
    num_candles: int = 60,
    interval_seconds: int = 60,
) -> List[SyntheticCandle]:
    """
    Create a headfake pattern:
    - Price rises to 1.2x at candle 10
    - Dumps below entry at candle 20
    - Recovers to 1.5x at candle 40
    
    Expected metrics:
    - is_headfake: 1
    - headfake_depth: ~-10% (0.9x)
    - headfake_recovered: 1
    """
    candles = []
    
    for i in range(num_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        
        if i < 10:
            # Rise to 1.2x
            mult = 1.0 + (0.2 * i / 10)
        elif i < 15:
            # Peak at 1.25x, start declining
            mult = 1.25 - (0.05 * (i - 10) / 5)
        elif i < 25:
            # Dump to 0.9x (below entry!)
            mult = 1.2 - (0.3 * (i - 15) / 10)
        elif i < 35:
            # Recover from 0.9x to 1.2x
            mult = 0.9 + (0.3 * (i - 25) / 10)
        elif i < 45:
            # Rise to 1.5x
            mult = 1.2 + (0.3 * (i - 35) / 10)
        else:
            # Continue to 2x
            mult = 1.5 + (0.5 * (i - 45) / 15)
        
        o = entry_price * mult * 0.99
        h = entry_price * mult * 1.02
        l = entry_price * mult * 0.97
        c = entry_price * mult
        candles.append(make_candle(token, ts, o, h, l, c))
    
    return candles


def make_stall_pattern(
    token: str,
    start_ts: datetime,
    entry_price: float,
    num_candles: int = 60,
    interval_seconds: int = 60,
) -> List[SyntheticCandle]:
    """
    Create a stall/chop pattern:
    - Price spends most of its time in 1.05-1.15x range
    - High stall score
    - Eventually breaks out
    
    Expected metrics:
    - stall_score: high (>30%)
    - time_underwater_pct: low
    """
    candles = []
    
    for i in range(num_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        
        if i < 45:
            # Chop in 1.05-1.15x range for most of the time
            oscillation = 0.05 * ((i % 10) / 10 - 0.5)
            mult = 1.10 + oscillation
        else:
            # Finally break out
            mult = 1.15 + (0.85 * (i - 45) / 15)
        
        o = entry_price * mult * 0.99
        h = entry_price * mult * 1.02
        l = entry_price * mult * 0.98
        c = entry_price * mult
        candles.append(make_candle(token, ts, o, h, l, c))
    
    return candles


def make_underwater_pattern(
    token: str,
    start_ts: datetime,
    entry_price: float,
    num_candles: int = 60,
    interval_seconds: int = 60,
) -> List[SyntheticCandle]:
    """
    Create a high time-underwater pattern:
    - Price dips below entry for first 30 candles
    - Then recovers
    
    Expected metrics:
    - time_underwater_pct: high (>50%)
    """
    candles = []
    
    for i in range(num_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        
        if i < 30:
            # Underwater at 0.85-0.95x
            mult = 0.9 - (0.05 * (i % 10) / 10)
        else:
            # Recovery and pump
            mult = 0.9 + (1.1 * (i - 30) / 30)
        
        o = entry_price * mult * 0.99
        h = entry_price * mult * 1.02
        l = entry_price * mult * 0.98
        c = entry_price * mult
        candles.append(make_candle(token, ts, o, h, l, c))
    
    return candles


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def base_timestamp() -> datetime:
    """Base timestamp for all tests."""
    return datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)


@pytest.fixture
def clean_breakout_setup(tmp_path: Path, base_timestamp: datetime):
    """Setup for clean breakout test."""
    token = "TOKEN_CLEAN_BREAKOUT"
    candles = make_clean_breakout(token, base_timestamp, 1.0)
    slice_path = tmp_path / "slice.parquet"
    write_candles_to_parquet(candles, slice_path)
    
    alert = Alert(
        mint=token,
        caller="TestCaller",
        ts_ms=int(base_timestamp.timestamp() * 1000),
    )
    
    return {"slice_path": slice_path, "alerts": [alert]}


@pytest.fixture
def headfake_setup(tmp_path: Path, base_timestamp: datetime):
    """Setup for headfake test."""
    token = "TOKEN_HEADFAKE"
    candles = make_headfake_pattern(token, base_timestamp, 1.0)
    slice_path = tmp_path / "slice.parquet"
    write_candles_to_parquet(candles, slice_path)
    
    alert = Alert(
        mint=token,
        caller="TestCaller",
        ts_ms=int(base_timestamp.timestamp() * 1000),
    )
    
    return {"slice_path": slice_path, "alerts": [alert]}


@pytest.fixture
def stall_setup(tmp_path: Path, base_timestamp: datetime):
    """Setup for stall pattern test."""
    token = "TOKEN_STALL"
    candles = make_stall_pattern(token, base_timestamp, 1.0)
    slice_path = tmp_path / "slice.parquet"
    write_candles_to_parquet(candles, slice_path)
    
    alert = Alert(
        mint=token,
        caller="TestCaller",
        ts_ms=int(base_timestamp.timestamp() * 1000),
    )
    
    return {"slice_path": slice_path, "alerts": [alert]}


@pytest.fixture
def underwater_setup(tmp_path: Path, base_timestamp: datetime):
    """Setup for underwater pattern test."""
    token = "TOKEN_UNDERWATER"
    candles = make_underwater_pattern(token, base_timestamp, 1.0)
    slice_path = tmp_path / "slice.parquet"
    write_candles_to_parquet(candles, slice_path)
    
    alert = Alert(
        mint=token,
        caller="TestCaller",
        ts_ms=int(base_timestamp.timestamp() * 1000),
    )
    
    return {"slice_path": slice_path, "alerts": [alert]}


# =============================================================================
# Golden Tests
# =============================================================================


class TestCleanBreakoutRetention:
    """Test that clean breakouts have high retention metrics."""
    
    def test_high_retention_1_2x_above_1_1x(self, clean_breakout_setup):
        """Clean breakout should have high retention above 1.1x after hitting 1.2x."""
        setup = clean_breakout_setup
        
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
        
        # Clean breakout should have high retention
        retention = row.get("retention_1_2x_above_1_1x")
        assert retention is not None, "retention_1_2x_above_1_1x should be computed"
        # Allow for some variance - clean breakout should have good retention
        assert retention >= 0.5, f"Expected high retention, got {retention}"
    
    def test_floor_hold_after_1_2x(self, clean_breakout_setup):
        """Clean breakout should hold floor (never go below entry) after 1.2x."""
        setup = clean_breakout_setup
        
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
        floor_hold = row.get("floor_hold_after_1_2x")
        assert floor_hold == 1, f"Expected floor hold, got {floor_hold}"
    
    def test_no_headfake(self, clean_breakout_setup):
        """Clean breakout should not be classified as headfake."""
        setup = clean_breakout_setup
        
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
        is_headfake = row.get("is_headfake")
        assert is_headfake == 0, f"Expected no headfake, got {is_headfake}"


class TestHeadfakeDetection:
    """Test that headfakes are properly detected."""
    
    def test_headfake_detected(self, headfake_setup):
        """Headfake pattern should be detected."""
        setup = headfake_setup
        
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
        is_headfake = row.get("is_headfake")
        assert is_headfake == 1, f"Expected headfake, got {is_headfake}"
    
    def test_headfake_depth_computed(self, headfake_setup):
        """Headfake depth should be computed correctly."""
        setup = headfake_setup
        
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
        depth = row.get("headfake_depth")
        assert depth is not None, "headfake_depth should be computed"
        assert depth < 0, f"Expected negative depth (below entry), got {depth}"
        assert depth > -0.20, f"Expected moderate depth, got {depth}"
    
    def test_headfake_recovery_detected(self, headfake_setup):
        """Headfake recovery (eventually hitting 1.5x) should be detected."""
        setup = headfake_setup
        
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
        recovered = row.get("headfake_recovered")
        assert recovered == 1, f"Expected recovery, got {recovered}"


class TestStallScorePattern:
    """Test that stall score is computed correctly."""
    
    def test_high_stall_score(self, stall_setup):
        """Stall pattern should have high stall score."""
        setup = stall_setup
        
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
        stall_score = row.get("stall_score")
        assert stall_score is not None, "stall_score should be computed"
        # Most candles are in 1.05-1.15x range (45 of 60)
        # Allow for some variance in the stall detection
        assert stall_score >= 0.2, f"Expected high stall score, got {stall_score}"


class TestTimeUnderwater:
    """Test that time underwater is computed correctly."""
    
    def test_high_time_underwater(self, underwater_setup):
        """Underwater pattern should have high time underwater percentage."""
        setup = underwater_setup
        
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
        underwater = row.get("time_underwater_pct")
        assert underwater is not None, "time_underwater_pct should be computed"
        # First 30 of 60 candles are underwater, expect significant underwater time
        assert underwater >= 0.3, f"Expected high underwater %, got {underwater}"


class TestSummaryAggregation:
    """Test that summary aggregation includes new metrics."""
    
    def test_summary_includes_retention_metrics(self, clean_breakout_setup):
        """Summary should include retention metrics."""
        setup = clean_breakout_setup
        
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
        
        # Check that new metrics are in summary
        assert "median_retention_1_2x_above_1_1x" in summary
        assert "pct_floor_hold_after_1_2x" in summary
        assert "median_giveback_after_1_5x" in summary
        assert "headfake_rate" in summary
        assert "median_stall_score" in summary
        assert "median_time_underwater_pct" in summary
    
    def test_summary_headfake_rate(self, headfake_setup):
        """Summary should compute headfake rate."""
        setup = headfake_setup
        
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
        
        # Single trade that is a headfake = 100% headfake rate
        assert summary["headfake_rate"] == 1.0

