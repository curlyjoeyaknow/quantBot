"""
Unit tests for slice_quality.py module.

Tests gap detection, coverage calculation, duplicate detection, and quality scoring.
These tests use synthetic candle data with known issues to verify detection accuracy.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Tuple

import pytest

# Add parent directory for imports
_BACKTEST_DIR = Path(__file__).parent.parent
if str(_BACKTEST_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKTEST_DIR))

_TESTS_DIR = Path(__file__).parent
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from lib.slice_quality import (
    QualityMetrics,
    QualityThresholds,
    analyze_candles,
    fill_gaps_with_forward_fill,
)

UTC = timezone.utc


# =============================================================================
# Test Helpers
# =============================================================================


def make_candle_tuple(
    token: str,
    ts: datetime,
    o: float = 1.0,
    h: float = 1.02,
    l: float = 0.98,
    c: float = 1.0,
    v: float = 1000.0,
) -> Tuple[str, datetime, float, float, float, float, float]:
    """Create a candle tuple in the expected format."""
    return (token, ts, o, h, l, c, v)


def make_continuous_candles(
    token: str,
    start_ts: datetime,
    num_candles: int,
    interval_seconds: int = 60,
    base_price: float = 1.0,
) -> List[Tuple[Any, ...]]:
    """Create continuous candles with no gaps."""
    candles = []
    for i in range(num_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        candles.append(make_candle_tuple(
            token, ts, base_price, base_price * 1.02, base_price * 0.98, base_price
        ))
    return candles


def make_gapped_candles(
    token: str,
    start_ts: datetime,
    num_candles: int,
    gap_positions: List[int],  # indices where gaps occur
    gap_sizes: List[int],  # number of candles missing at each gap
    interval_seconds: int = 60,
    base_price: float = 1.0,
) -> Tuple[List[Tuple[Any, ...]], int]:
    """
    Create candles with specific gaps.
    
    Returns:
        Tuple of (candles, total_missing_count)
    """
    candles = []
    current_ts = start_ts
    total_missing = 0
    
    for i in range(num_candles):
        # Check if this is a gap position
        if i in gap_positions:
            gap_idx = gap_positions.index(i)
            gap_size = gap_sizes[gap_idx]
            # Skip ahead by gap_size candles
            current_ts += timedelta(seconds=gap_size * interval_seconds)
            total_missing += gap_size
        
        candles.append(make_candle_tuple(
            token, current_ts, base_price, base_price * 1.02, base_price * 0.98, base_price
        ))
        current_ts += timedelta(seconds=interval_seconds)
    
    return candles, total_missing


# =============================================================================
# Unit Tests: Gap Detection
# =============================================================================


class TestGapDetection:
    """Tests for gap detection in analyze_candles."""
    
    def test_no_gaps_continuous_candles(self):
        """Continuous candles should have zero gaps."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=100)
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.gaps == 0, f"Expected 0 gaps, got {metrics.gaps}"
        assert metrics.gap_segments == 0, f"Expected 0 gap segments, got {metrics.gap_segments}"
        assert len(metrics.gap_details) == 0
    
    def test_single_gap_detected(self):
        """A single gap should be detected correctly."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        # Create candles with a 5-candle gap at position 50
        candles, expected_missing = make_gapped_candles(
            "TOKEN_A", start, num_candles=100,
            gap_positions=[50], gap_sizes=[5]
        )
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.gaps == 5, f"Expected 5 gaps, got {metrics.gaps}"
        assert metrics.gap_segments == 1, f"Expected 1 gap segment, got {metrics.gap_segments}"
        assert len(metrics.gap_details) == 1
    
    def test_multiple_gaps_detected(self):
        """Multiple gaps should be detected correctly."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        # Create candles with gaps at positions 20, 50, 80
        candles, _ = make_gapped_candles(
            "TOKEN_A", start, num_candles=100,
            gap_positions=[20, 50, 80], gap_sizes=[3, 10, 5]
        )
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.gaps == 18, f"Expected 18 total gaps (3+10+5), got {metrics.gaps}"
        assert metrics.gap_segments == 3, f"Expected 3 gap segments, got {metrics.gap_segments}"
    
    def test_large_gap_detection(self):
        """Large gaps (like missing hours) should be detected."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = []
        
        # 10 candles, then 2-hour gap (120 minutes = 120 candles at 1m), then 10 more candles
        for i in range(10):
            ts = start + timedelta(seconds=i * 60)
            candles.append(make_candle_tuple("TOKEN_A", ts))
        
        gap_ts = start + timedelta(minutes=130)  # 120 minute gap
        for i in range(10):
            ts = gap_ts + timedelta(seconds=i * 60)
            candles.append(make_candle_tuple("TOKEN_A", ts))
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        # Gap should be 120 candles (2 hours)
        assert metrics.gaps >= 119, f"Expected ~120 gap candles, got {metrics.gaps}"
        assert metrics.gap_segments == 1
    
    def test_gap_tolerance_threshold(self):
        """Small delays (< 1.5x interval) should not be counted as gaps."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = []
        
        # Candles at 0, 60, 125 seconds (slightly delayed but not a gap)
        candles.append(make_candle_tuple("TOKEN_A", start))
        candles.append(make_candle_tuple("TOKEN_A", start + timedelta(seconds=60)))
        candles.append(make_candle_tuple("TOKEN_A", start + timedelta(seconds=125)))  # 65s after, < 90s threshold
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.gaps == 0, f"Expected 0 gaps for small delays, got {metrics.gaps}"


# =============================================================================
# Unit Tests: Duplicate Detection
# =============================================================================


class TestDuplicateDetection:
    """Tests for duplicate timestamp detection."""
    
    def test_no_duplicates(self):
        """Unique timestamps should have zero duplicates."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=50)
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.duplicates == 0
    
    def test_single_duplicate_detected(self):
        """A single duplicate should be detected."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=50)
        
        # Add a duplicate of the 10th candle
        dup_ts = start + timedelta(seconds=10 * 60)
        candles.append(make_candle_tuple("TOKEN_A", dup_ts))
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.duplicates == 1, f"Expected 1 duplicate, got {metrics.duplicates}"
    
    def test_multiple_duplicates_detected(self):
        """Multiple duplicates should be counted correctly."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=50)
        
        # Add 5 duplicates of the 10th candle
        dup_ts = start + timedelta(seconds=10 * 60)
        for _ in range(5):
            candles.append(make_candle_tuple("TOKEN_A", dup_ts))
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.duplicates == 5, f"Expected 5 duplicates, got {metrics.duplicates}"


# =============================================================================
# Unit Tests: Coverage Calculation
# =============================================================================


class TestCoverageCalculation:
    """Tests for coverage percentage calculation."""
    
    def test_full_coverage(self):
        """Complete data should have ~100% coverage."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=60)
        
        expected_start = int(start.timestamp())
        expected_end = int((start + timedelta(minutes=59)).timestamp())
        
        metrics = analyze_candles(
            candles, interval_seconds=60,
            expected_start_ts=expected_start,
            expected_end_ts=expected_end
        )
        
        assert metrics.coverage_pct >= 95, f"Expected ~100% coverage, got {metrics.coverage_pct}"
    
    def test_half_coverage(self):
        """Half the expected candles should have ~50% coverage."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=30)
        
        # Expected: 60 candles for 1 hour
        expected_start = int(start.timestamp())
        expected_end = int((start + timedelta(minutes=59)).timestamp())
        
        metrics = analyze_candles(
            candles, interval_seconds=60,
            expected_start_ts=expected_start,
            expected_end_ts=expected_end
        )
        
        assert 45 <= metrics.coverage_pct <= 55, f"Expected ~50% coverage, got {metrics.coverage_pct}"
    
    def test_low_coverage_detected(self):
        """Very low coverage should be detected."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=10)
        
        # Expected: 1440 candles for 24 hours
        expected_start = int(start.timestamp())
        expected_end = int((start + timedelta(hours=24)).timestamp())
        
        metrics = analyze_candles(
            candles, interval_seconds=60,
            expected_start_ts=expected_start,
            expected_end_ts=expected_end
        )
        
        assert metrics.coverage_pct < 5, f"Expected <5% coverage, got {metrics.coverage_pct}"


# =============================================================================
# Unit Tests: OHLC Distortion Detection
# =============================================================================


class TestOHLCDistortionDetection:
    """Tests for OHLC constraint violation detection."""
    
    def test_no_distortions_valid_ohlc(self):
        """Valid OHLC data should have zero distortions."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=50)
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.distortions == 0
    
    def test_high_less_than_low_detected(self):
        """High < Low should be detected as distortion."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = [
            make_candle_tuple("TOKEN_A", start, o=1.0, h=0.9, l=1.1, c=1.0),  # Invalid: h < l
        ]
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.distortions == 1, f"Expected 1 distortion for h<l, got {metrics.distortions}"
    
    def test_open_above_high_detected(self):
        """Open > High should be detected as distortion."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = [
            make_candle_tuple("TOKEN_A", start, o=1.5, h=1.2, l=0.9, c=1.0),  # Invalid: o > h
        ]
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.distortions == 1
    
    def test_negative_values_detected(self):
        """Negative prices should be detected."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = [
            make_candle_tuple("TOKEN_A", start, o=-1.0, h=1.2, l=0.9, c=1.0),  # Negative open
        ]
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.negative_values == 1


# =============================================================================
# Unit Tests: Zero Volume Detection
# =============================================================================


class TestZeroVolumeDetection:
    """Tests for zero volume candle detection."""
    
    def test_no_zero_volume(self):
        """Normal candles should have no zero volume."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=50)
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.zero_volume == 0
    
    def test_zero_volume_detected(self):
        """Zero volume candles should be counted."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = [
            make_candle_tuple("TOKEN_A", start, v=0),  # Zero volume
            make_candle_tuple("TOKEN_A", start + timedelta(minutes=1), v=1000),
            make_candle_tuple("TOKEN_A", start + timedelta(minutes=2), v=0),  # Zero volume
        ]
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.zero_volume == 2
    
    def test_zero_volume_percentage(self):
        """Zero volume percentage should be calculated correctly."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = []
        
        # 10 candles, 5 with zero volume
        for i in range(10):
            ts = start + timedelta(seconds=i * 60)
            v = 0 if i % 2 == 0 else 1000
            candles.append(make_candle_tuple("TOKEN_A", ts, v=v))
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.zero_volume == 5
        assert metrics.zero_volume_pct == 50.0


# =============================================================================
# Unit Tests: Quality Score Calculation
# =============================================================================


class TestQualityScoreCalculation:
    """Tests for quality score calculation."""
    
    def test_perfect_data_high_score(self):
        """Perfect data should have a high quality score."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=100)
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.quality_score >= 95, f"Perfect data should score >= 95, got {metrics.quality_score}"
    
    def test_gaps_reduce_score(self):
        """Gaps should reduce the quality score."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles, _ = make_gapped_candles(
            "TOKEN_A", start, num_candles=100,
            gap_positions=[50], gap_sizes=[50]  # Large gap
        )
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.quality_score < 95, f"Gapped data should score < 95, got {metrics.quality_score}"
    
    def test_low_coverage_reduces_score(self):
        """Low coverage should reduce the quality score."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=10)
        
        # Expected: 1440 candles for 24 hours
        expected_start = int(start.timestamp())
        expected_end = int((start + timedelta(hours=24)).timestamp())
        
        metrics = analyze_candles(
            candles, interval_seconds=60,
            expected_start_ts=expected_start,
            expected_end_ts=expected_end
        )
        
        assert metrics.quality_score < 80, f"Low coverage should reduce score, got {metrics.quality_score}"


# =============================================================================
# Unit Tests: Quality Thresholds
# =============================================================================


class TestQualityThresholds:
    """Tests for quality threshold validation."""
    
    def test_good_data_passes_thresholds(self):
        """Good quality data should pass default thresholds."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=100)
        
        metrics = analyze_candles(candles, interval_seconds=60)
        thresholds = QualityThresholds()
        
        passed, violations = thresholds.validate(metrics)
        
        assert passed, f"Good data should pass, violations: {violations}"
        assert len(violations) == 0
    
    def test_low_coverage_fails_threshold(self):
        """Low coverage data should fail the coverage threshold."""
        metrics = QualityMetrics()
        metrics.coverage_pct = 50.0  # Below default 80%
        metrics.gap_pct = 5.0
        metrics.zero_volume_pct = 10.0
        metrics.quality_score = 70.0
        metrics.duplicates = 0
        
        thresholds = QualityThresholds(min_coverage_pct=80.0)
        passed, violations = thresholds.validate(metrics)
        
        assert not passed
        assert any("coverage" in v.lower() for v in violations)
    
    def test_high_gaps_fails_threshold(self):
        """High gap percentage should fail the gap threshold."""
        metrics = QualityMetrics()
        metrics.coverage_pct = 90.0
        metrics.gap_pct = 30.0  # Above default 20%
        metrics.zero_volume_pct = 10.0
        metrics.quality_score = 70.0
        metrics.duplicates = 0
        
        thresholds = QualityThresholds(max_gap_pct=20.0)
        passed, violations = thresholds.validate(metrics)
        
        assert not passed
        assert any("gap" in v.lower() for v in violations)
    
    def test_custom_thresholds(self):
        """Custom thresholds should be respected."""
        metrics = QualityMetrics()
        metrics.coverage_pct = 70.0
        metrics.gap_pct = 5.0
        metrics.zero_volume_pct = 10.0
        metrics.quality_score = 80.0
        metrics.duplicates = 0
        
        # Strict thresholds
        strict = QualityThresholds(min_coverage_pct=90.0)
        passed, _ = strict.validate(metrics)
        assert not passed
        
        # Lenient thresholds
        lenient = QualityThresholds(min_coverage_pct=60.0)
        passed, _ = lenient.validate(metrics)
        assert passed


# =============================================================================
# Unit Tests: Gap Filling
# =============================================================================


class TestGapFilling:
    """Tests for gap filling with forward fill."""
    
    def test_no_gaps_unchanged(self):
        """Data with no gaps should be unchanged."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = make_continuous_candles("TOKEN_A", start, num_candles=10)
        
        filled, fill_count = fill_gaps_with_forward_fill(candles, interval_seconds=60)
        
        assert fill_count == 0
        assert len(filled) == len(candles)
    
    def test_small_gap_filled(self):
        """Small gaps should be filled."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = [
            make_candle_tuple("TOKEN_A", start, c=1.0),
            make_candle_tuple("TOKEN_A", start + timedelta(minutes=5), c=1.1),  # 4-candle gap
        ]
        
        filled, fill_count = fill_gaps_with_forward_fill(candles, interval_seconds=60, max_gap_fill=10)
        
        assert fill_count == 4, f"Expected 4 fills, got {fill_count}"
        assert len(filled) == 6  # 2 original + 4 filled
    
    def test_large_gap_not_filled(self):
        """Gaps larger than max_gap_fill should not be filled."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = [
            make_candle_tuple("TOKEN_A", start, c=1.0),
            make_candle_tuple("TOKEN_A", start + timedelta(minutes=20), c=1.1),  # 19-candle gap
        ]
        
        filled, fill_count = fill_gaps_with_forward_fill(candles, interval_seconds=60, max_gap_fill=10)
        
        assert fill_count == 0, f"Large gap should not be filled, got {fill_count} fills"
        assert len(filled) == 2
    
    def test_filled_candles_use_forward_fill(self):
        """Filled candles should use previous close price."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        prev_close = 1.5
        candles = [
            make_candle_tuple("TOKEN_A", start, c=prev_close),
            make_candle_tuple("TOKEN_A", start + timedelta(minutes=3), c=2.0),  # 2-candle gap
        ]
        
        filled, fill_count = fill_gaps_with_forward_fill(candles, interval_seconds=60, max_gap_fill=10)
        
        assert fill_count == 2
        
        # Check that filled candles have prev_close as OHLC
        for candle in filled[1:3]:  # The 2 filled candles
            assert candle[2] == prev_close  # open
            assert candle[3] == prev_close  # high
            assert candle[4] == prev_close  # low
            assert candle[5] == prev_close  # close
            assert candle[6] == 0.0  # volume


# =============================================================================
# Regression Tests
# =============================================================================


class TestQualityRegressions:
    """Regression tests to prevent quality detection bugs."""
    
    def test_empty_candles_handled(self):
        """Empty candle list should not crash."""
        metrics = analyze_candles([], interval_seconds=60)
        
        assert metrics.total_candles == 0
        assert metrics.gaps == 0
        assert metrics.quality_score == 0
    
    def test_single_candle_handled(self):
        """Single candle should not crash."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = [make_candle_tuple("TOKEN_A", start)]
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        assert metrics.total_candles == 1
        assert metrics.gaps == 0
    
    def test_datetime_and_int_timestamps_handled(self):
        """Both datetime and int timestamps should work."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        start_int = int(start.timestamp())
        
        # Datetime timestamps
        candles_dt = [
            ("TOKEN_A", start, 1.0, 1.02, 0.98, 1.0, 1000),
            ("TOKEN_A", start + timedelta(minutes=1), 1.0, 1.02, 0.98, 1.0, 1000),
        ]
        
        # Integer timestamps
        candles_int = [
            ("TOKEN_A", start_int, 1.0, 1.02, 0.98, 1.0, 1000),
            ("TOKEN_A", start_int + 60, 1.0, 1.02, 0.98, 1.0, 1000),
        ]
        
        metrics_dt = analyze_candles(candles_dt, interval_seconds=60)
        metrics_int = analyze_candles(candles_int, interval_seconds=60)
        
        assert metrics_dt.gaps == metrics_int.gaps == 0
        assert metrics_dt.total_candles == metrics_int.total_candles == 2
    
    def test_metrics_to_dict_serializable(self):
        """QualityMetrics.to_dict() should be JSON-serializable."""
        import json
        
        metrics = QualityMetrics()
        metrics.total_candles = 100
        metrics.gaps = 5
        metrics.coverage_pct = 95.0
        metrics.gap_details = [{"start": 123, "end": 456}]
        
        # Should not raise
        json_str = json.dumps(metrics.to_dict())
        assert len(json_str) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

