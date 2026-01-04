"""
Pytest configuration and fixtures for backtest validation.
"""
from __future__ import annotations

import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import List

import pytest

# Add parent directory (tools/backtest) to path for importing run_baseline_all, etc.
_BACKTEST_DIR = Path(__file__).parent.parent
if str(_BACKTEST_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKTEST_DIR))

# Also add tests dir for fixtures module
_TESTS_DIR = Path(__file__).parent
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from fixtures import (
    SyntheticCandle,
    SyntheticAlert,
    make_linear_pump,
    make_precise_multiples,
    make_instant_rug,
    make_sideways,
)

UTC = timezone.utc


@pytest.fixture
def tmp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as td:
        yield Path(td)


@pytest.fixture
def base_timestamp() -> datetime:
    """Base timestamp for all tests: 2025-01-01 00:00:00 UTC"""
    return datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)


@pytest.fixture
def simple_pump_candles(base_timestamp) -> List[SyntheticCandle]:
    """Simple pump to 3x over 30 candles, then decline to 1.5x."""
    return make_linear_pump(
        token="TOKEN_A",
        start_ts=base_timestamp,
        entry_price=1.0,
        peak_mult=3.0,
        candles_to_peak=30,
        candles_after_peak=30,
        end_mult=1.5,
    )


@pytest.fixture
def precise_multiples_candles(base_timestamp) -> List[SyntheticCandle]:
    """Candles with precise 2x, 3x, 4x, 5x hits at known times."""
    return make_precise_multiples(
        token="TOKEN_PRECISE",
        start_ts=base_timestamp,
        entry_price=1.0,
        num_candles=60,
    )


@pytest.fixture
def multi_token_candles(base_timestamp) -> List[SyntheticCandle]:
    """Multiple tokens with different patterns for isolation testing."""
    candles = []
    
    # Token A: pumps to 5x
    candles.extend(make_linear_pump(
        "TOKEN_A", base_timestamp, 1.0, 5.0, 30, 30, end_mult=2.0
    ))
    
    # Token B: rugs immediately
    candles.extend(make_instant_rug(
        "TOKEN_B", base_timestamp, 1.0, 60, rug_mult=0.1
    ))
    
    # Token C: sideways
    candles.extend(make_sideways(
        "TOKEN_C", base_timestamp, 1.0, 60
    ))
    
    return candles


@pytest.fixture
def simple_alert(base_timestamp) -> SyntheticAlert:
    """A simple alert at base timestamp."""
    return SyntheticAlert(
        mint="TOKEN_A",
        ts_ms=int(base_timestamp.timestamp() * 1000),
        caller="TestCaller",
    )


@pytest.fixture
def multi_token_alerts(base_timestamp) -> List[SyntheticAlert]:
    """Alerts for multiple tokens."""
    ts_ms = int(base_timestamp.timestamp() * 1000)
    return [
        SyntheticAlert("TOKEN_A", ts_ms, "Caller1"),
        SyntheticAlert("TOKEN_B", ts_ms, "Caller1"),
        SyntheticAlert("TOKEN_C", ts_ms, "Caller2"),
    ]
