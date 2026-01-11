"""
Golden tests for slice quality analysis.

These tests use synthetic candle patterns with KNOWN quality issues
to verify that the quality analysis correctly identifies them.

Each test has a specific pattern and expected quality metrics.
If these tests fail, it indicates a regression in quality detection.
"""
from __future__ import annotations

import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Tuple, Any

import duckdb
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
    analyze_candles,
    analyze_parquet_quality,
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


def write_candles_to_parquet(
    candles: List[Tuple[Any, ...]],
    output_path: Path,
) -> None:
    """Write candle tuples to a parquet file."""
    conn = duckdb.connect()
    conn.execute("""
        CREATE TABLE candles (
            token_address VARCHAR,
            timestamp TIMESTAMP,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume DOUBLE
        )
    """)
    conn.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", candles)
    conn.execute(f"COPY candles TO '{output_path}' (FORMAT PARQUET, COMPRESSION 'zstd')")
    conn.close()


# =============================================================================
# Pattern Generators
# =============================================================================


def make_perfect_24h_data(
    token: str = "TOKEN_PERFECT",
    start_ts: datetime = None,
    interval_seconds: int = 60,
) -> List[Tuple[Any, ...]]:
    """
    Create perfect 24-hour candle data with no issues.
    
    Expected metrics:
    - coverage: 100%
    - gaps: 0
    - duplicates: 0
    - distortions: 0
    - quality_score: 100 (or close)
    """
    if start_ts is None:
        start_ts = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
    
    candles = []
    num_candles = (24 * 60 * 60) // interval_seconds  # 1440 for 1m interval
    
    for i in range(num_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        price = 1.0 + 0.001 * i  # Slight uptrend
        candles.append(make_candle_tuple(
            token, ts, 
            o=price * 0.999, h=price * 1.01, l=price * 0.99, c=price,
            v=1000 + i  # Increasing volume
        ))
    
    return candles


def make_gappy_data(
    token: str = "TOKEN_GAPPY",
    start_ts: datetime = None,
    total_candles: int = 1440,
    gap_count: int = 10,
    gap_size: int = 5,
    interval_seconds: int = 60,
) -> Tuple[List[Tuple[Any, ...]], int]:
    """
    Create candle data with regular gaps.
    
    Args:
        gap_count: Number of gap regions
        gap_size: Candles missing per gap
    
    Returns:
        Tuple of (candles, expected_total_gaps)
    
    Expected metrics:
    - gaps: gap_count * gap_size
    - coverage: < 100%
    """
    if start_ts is None:
        start_ts = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
    
    candles = []
    gap_interval = total_candles // (gap_count + 1)  # Space gaps evenly
    
    current_idx = 0
    gaps_created = 0
    
    for i in range(total_candles):
        # Check if we're at a gap position
        if gaps_created < gap_count and i > 0 and i % gap_interval == 0:
            # Skip gap_size candles
            current_idx += gap_size
            gaps_created += 1
        
        ts = start_ts + timedelta(seconds=current_idx * interval_seconds)
        price = 1.0
        candles.append(make_candle_tuple(token, ts, o=price, h=price*1.01, l=price*0.99, c=price))
        current_idx += 1
    
    expected_gaps = gap_count * gap_size
    return candles, expected_gaps


def make_duplicated_data(
    token: str = "TOKEN_DUPS",
    start_ts: datetime = None,
    total_candles: int = 100,
    duplicate_count: int = 20,
    interval_seconds: int = 60,
) -> Tuple[List[Tuple[Any, ...]], int]:
    """
    Create candle data with duplicate timestamps.
    
    Returns:
        Tuple of (candles, expected_duplicates)
    """
    if start_ts is None:
        start_ts = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
    
    candles = []
    
    # First create normal candles
    for i in range(total_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        price = 1.0
        candles.append(make_candle_tuple(token, ts, o=price, h=price*1.01, l=price*0.99, c=price))
    
    # Then add duplicates of random candles
    for i in range(duplicate_count):
        dup_idx = (i * 3) % total_candles  # Spread duplicates
        ts = start_ts + timedelta(seconds=dup_idx * interval_seconds)
        price = 1.0
        candles.append(make_candle_tuple(token, ts, o=price, h=price*1.01, l=price*0.99, c=price))
    
    return candles, duplicate_count


def make_distorted_data(
    token: str = "TOKEN_DISTORTED",
    start_ts: datetime = None,
    total_candles: int = 100,
    distortion_count: int = 10,
    interval_seconds: int = 60,
) -> Tuple[List[Tuple[Any, ...]], int]:
    """
    Create candle data with OHLC distortions.
    
    Returns:
        Tuple of (candles, expected_distortions)
    """
    if start_ts is None:
        start_ts = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
    
    candles = []
    distortion_interval = total_candles // distortion_count
    
    for i in range(total_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        price = 1.0
        
        if i % distortion_interval == 0 and i > 0:
            # Create distortion: high < low
            candles.append(make_candle_tuple(
                token, ts, o=price, h=price*0.95, l=price*1.05, c=price  # Invalid!
            ))
        else:
            candles.append(make_candle_tuple(
                token, ts, o=price, h=price*1.01, l=price*0.99, c=price
            ))
    
    return candles, distortion_count


def make_zero_volume_data(
    token: str = "TOKEN_ZEROVO",
    start_ts: datetime = None,
    total_candles: int = 100,
    zero_volume_pct: float = 30.0,
    interval_seconds: int = 60,
) -> Tuple[List[Tuple[Any, ...]], int]:
    """
    Create candle data with zero volume candles.
    
    Returns:
        Tuple of (candles, expected_zero_volume_count)
    """
    if start_ts is None:
        start_ts = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
    
    candles = []
    zero_interval = int(100 / zero_volume_pct)  # e.g., every 3rd if 30%
    zero_count = 0
    
    for i in range(total_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        price = 1.0
        
        if i % zero_interval == 0:
            candles.append(make_candle_tuple(
                token, ts, o=price, h=price*1.01, l=price*0.99, c=price, v=0
            ))
            zero_count += 1
        else:
            candles.append(make_candle_tuple(
                token, ts, o=price, h=price*1.01, l=price*0.99, c=price, v=1000
            ))
    
    return candles, zero_count


def make_realistic_degraded_data(
    token: str = "TOKEN_DEGRADED",
    start_ts: datetime = None,
    total_hours: int = 24,
    interval_seconds: int = 60,
) -> List[Tuple[Any, ...]]:
    """
    Create realistic degraded data similar to what was observed:
    - 86% of tokens have gaps
    - 43% have low coverage
    - 26% have high zero volume
    
    This simulates the quality issues in the original parquet exports.
    """
    if start_ts is None:
        start_ts = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
    
    candles = []
    expected_candles = (total_hours * 60 * 60) // interval_seconds
    
    # Create data with ~20% gaps (random skips)
    current_ts = start_ts
    candles_created = 0
    
    while candles_created < expected_candles * 0.7:  # Only 70% coverage
        # Randomly skip some candles (simulate gaps)
        if candles_created > 0 and candles_created % 20 == 0:
            # Skip 3-10 candles
            skip = 5
            current_ts += timedelta(seconds=skip * interval_seconds)
        
        price = 1.0
        # Some zero volume
        v = 0 if candles_created % 4 == 0 else 1000
        
        candles.append(make_candle_tuple(
            token, current_ts, o=price, h=price*1.01, l=price*0.99, c=price, v=v
        ))
        
        current_ts += timedelta(seconds=interval_seconds)
        candles_created += 1
    
    return candles


# =============================================================================
# Golden Tests
# =============================================================================


class TestPerfectDataGolden:
    """Golden tests for perfect quality data."""
    
    def test_perfect_24h_analysis(self):
        """Perfect 24h data should have excellent quality metrics."""
        candles = make_perfect_24h_data()
        
        start_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp())
        end_ts = start_ts + 24 * 3600
        
        metrics = analyze_candles(
            candles, interval_seconds=60,
            expected_start_ts=start_ts,
            expected_end_ts=end_ts
        )
        
        # GOLDEN ASSERTIONS
        assert metrics.total_candles == 1440, f"Expected 1440 candles, got {metrics.total_candles}"
        assert metrics.gaps == 0, f"Expected 0 gaps, got {metrics.gaps}"
        assert metrics.duplicates == 0, f"Expected 0 duplicates, got {metrics.duplicates}"
        assert metrics.distortions == 0, f"Expected 0 distortions, got {metrics.distortions}"
        assert metrics.coverage_pct >= 99.0, f"Expected >=99% coverage, got {metrics.coverage_pct}"
        assert metrics.quality_score >= 95.0, f"Expected >=95 quality score, got {metrics.quality_score}"
    
    def test_perfect_data_parquet_roundtrip(self, tmp_path):
        """Perfect data should maintain quality through parquet write/read."""
        candles = make_perfect_24h_data()
        parquet_path = tmp_path / "perfect.parquet"
        
        write_candles_to_parquet(candles, parquet_path)
        
        metrics = analyze_parquet_quality(str(parquet_path), interval_seconds=60)
        
        # GOLDEN ASSERTIONS
        assert metrics.gaps == 0, "Parquet roundtrip should preserve no gaps"
        assert metrics.duplicates == 0, "Parquet roundtrip should preserve no duplicates"
        assert metrics.quality_score >= 95.0, "Parquet roundtrip should preserve quality"


class TestGappyDataGolden:
    """Golden tests for data with gaps."""
    
    def test_gappy_data_gaps_detected(self):
        """Gaps should be detected accurately."""
        candles, expected_gaps = make_gappy_data(
            total_candles=1000, gap_count=10, gap_size=5
        )
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        # GOLDEN ASSERTIONS - gaps should be detected
        # Note: Due to how gaps work, detected gaps may be slightly different
        assert metrics.gaps >= expected_gaps - 5, f"Expected ~{expected_gaps} gaps, got {metrics.gaps}"
        assert metrics.gap_segments >= 5, f"Expected >=5 gap segments, got {metrics.gap_segments}"
        assert metrics.coverage_pct < 100, "Coverage should be < 100% with gaps"
    
    def test_large_gaps_detected(self):
        """Large gaps (hour-sized) should be detected."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        candles = []
        
        # 60 candles, then 60-minute gap, then 60 more candles
        for i in range(60):
            ts = start + timedelta(minutes=i)
            candles.append(make_candle_tuple("TOKEN_A", ts))
        
        # Gap of 60 minutes
        for i in range(60):
            ts = start + timedelta(minutes=120 + i)  # Skip 60 minutes
            candles.append(make_candle_tuple("TOKEN_A", ts))
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        # GOLDEN ASSERTIONS
        assert metrics.gaps >= 55, f"Expected ~60 gap candles, got {metrics.gaps}"
        assert metrics.gap_segments == 1, f"Expected 1 gap segment, got {metrics.gap_segments}"


class TestDuplicatedDataGolden:
    """Golden tests for data with duplicates."""
    
    def test_duplicates_detected(self):
        """Duplicates should be counted accurately."""
        candles, expected_dups = make_duplicated_data(
            total_candles=100, duplicate_count=20
        )
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        # GOLDEN ASSERTIONS
        assert metrics.duplicates == expected_dups, f"Expected {expected_dups} duplicates, got {metrics.duplicates}"
        assert metrics.total_candles == 120, f"Expected 120 total candles (100 + 20 dups)"
    
    def test_duplicates_reduce_quality(self):
        """Duplicates should reduce quality score."""
        candles_clean = make_perfect_24h_data("TOKEN_CLEAN")[:100]
        candles_dups, _ = make_duplicated_data("TOKEN_DUPS", duplicate_count=50)
        
        metrics_clean = analyze_candles(candles_clean, interval_seconds=60)
        metrics_dups = analyze_candles(candles_dups, interval_seconds=60)
        
        # GOLDEN ASSERTIONS
        assert metrics_dups.quality_score < metrics_clean.quality_score, \
            "Duplicates should reduce quality score"


class TestDistortedDataGolden:
    """Golden tests for data with OHLC distortions."""
    
    def test_distortions_detected(self):
        """OHLC distortions should be detected."""
        candles, expected_distortions = make_distorted_data(
            total_candles=100, distortion_count=10
        )
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        # GOLDEN ASSERTIONS
        assert metrics.distortions >= expected_distortions - 1, \
            f"Expected ~{expected_distortions} distortions, got {metrics.distortions}"
    
    def test_distortions_reduce_quality(self):
        """Distortions should significantly reduce quality score."""
        candles_clean = make_perfect_24h_data("TOKEN_CLEAN")[:100]
        candles_distorted, _ = make_distorted_data("TOKEN_DISTORTED", distortion_count=20)
        
        metrics_clean = analyze_candles(candles_clean, interval_seconds=60)
        metrics_distorted = analyze_candles(candles_distorted, interval_seconds=60)
        
        # GOLDEN ASSERTIONS
        assert metrics_distorted.quality_score < metrics_clean.quality_score - 10, \
            "Distortions should significantly reduce quality score"


class TestZeroVolumeGolden:
    """Golden tests for data with zero volume."""
    
    def test_zero_volume_detected(self):
        """Zero volume candles should be counted."""
        candles, expected_zero = make_zero_volume_data(
            total_candles=100, zero_volume_pct=30.0
        )
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        # GOLDEN ASSERTIONS
        assert abs(metrics.zero_volume - expected_zero) <= 2, \
            f"Expected ~{expected_zero} zero volume, got {metrics.zero_volume}"
        assert 25 <= metrics.zero_volume_pct <= 35, \
            f"Expected ~30% zero volume, got {metrics.zero_volume_pct}%"


class TestRealisticDegradedGolden:
    """
    Golden tests for realistic degraded data.
    
    These tests simulate the quality issues observed in the original problem:
    - 86% tokens with gaps
    - 43% low coverage
    - 26% high zero volume
    """
    
    def test_degraded_data_detected(self):
        """Degraded data should be detected with appropriate metrics."""
        candles = make_realistic_degraded_data(total_hours=24)
        
        start_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp())
        end_ts = start_ts + 24 * 3600
        
        metrics = analyze_candles(
            candles, interval_seconds=60,
            expected_start_ts=start_ts,
            expected_end_ts=end_ts
        )
        
        # GOLDEN ASSERTIONS - should detect issues
        assert metrics.gaps > 0, "Degraded data should have gaps"
        assert metrics.coverage_pct < 80, "Degraded data should have <80% coverage"
        assert metrics.zero_volume > 0, "Degraded data should have zero volume candles"
        assert metrics.quality_score < 90, "Degraded data should have reduced quality score"
    
    def test_degraded_data_quality_thresholds(self):
        """Degraded data should fail quality thresholds."""
        from lib.slice_quality import QualityThresholds
        
        candles = make_realistic_degraded_data(total_hours=24)
        
        start_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp())
        end_ts = start_ts + 24 * 3600
        
        metrics = analyze_candles(
            candles, interval_seconds=60,
            expected_start_ts=start_ts,
            expected_end_ts=end_ts
        )
        
        thresholds = QualityThresholds(min_coverage_pct=80.0)
        passed, violations = thresholds.validate(metrics)
        
        # GOLDEN ASSERTIONS
        assert not passed, "Degraded data should fail quality thresholds"
        assert len(violations) >= 1, "Should have at least one violation"


class TestQualityMetricsPrecision:
    """
    Precision tests to ensure metrics are calculated correctly.
    
    These are regression guards for the exact formulas.
    """
    
    def test_coverage_formula(self):
        """Coverage should be (unique_candles / expected_candles) * 100."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        
        # Create exactly 50 candles for a 100-candle window
        candles = []
        for i in range(50):
            ts = start + timedelta(minutes=i * 2)  # Every other minute
            candles.append(make_candle_tuple("TOKEN_A", ts))
        
        # Expected window: 100 minutes = 100 candles at 1m interval
        expected_start = int(start.timestamp())
        expected_end = int((start + timedelta(minutes=99)).timestamp())
        
        metrics = analyze_candles(
            candles, interval_seconds=60,
            expected_start_ts=expected_start,
            expected_end_ts=expected_end
        )
        
        # GOLDEN ASSERTION - 50/100 = 50%
        assert 48 <= metrics.coverage_pct <= 52, f"Expected ~50% coverage, got {metrics.coverage_pct}"
    
    def test_gap_calculation_formula(self):
        """Gaps should be (diff // interval) - 1 for each gap segment."""
        start = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
        
        candles = [
            make_candle_tuple("TOKEN_A", start),
            make_candle_tuple("TOKEN_A", start + timedelta(minutes=6)),  # 5-candle gap
        ]
        
        metrics = analyze_candles(candles, interval_seconds=60)
        
        # GOLDEN ASSERTION - 6 minute gap = 5 missing candles
        assert metrics.gaps == 5, f"Expected 5 gaps for 6-minute diff, got {metrics.gaps}"
        assert metrics.gap_segments == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

