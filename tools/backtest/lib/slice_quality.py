"""
Slice quality validation and metrics.

Provides functions to analyze candle data quality:
- Gap detection
- Coverage calculation
- Duplicate detection
- OHLC distortion detection
- Zero volume analysis
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

UTC = timezone.utc


@dataclass
class QualityMetrics:
    """Quality metrics for a set of candles."""
    
    # Basic counts
    total_candles: int = 0
    expected_candles: int = 0
    
    # Issues
    duplicates: int = 0
    gaps: int = 0  # Number of missing candle slots
    gap_segments: int = 0  # Number of separate gap regions
    distortions: int = 0  # OHLC constraint violations
    zero_volume: int = 0
    negative_values: int = 0
    
    # Derived metrics
    coverage_pct: float = 0.0
    quality_score: float = 0.0
    gap_pct: float = 0.0
    zero_volume_pct: float = 0.0
    
    # Gap details (for debugging)
    gap_details: List[Dict[str, Any]] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "total_candles": self.total_candles,
            "expected_candles": self.expected_candles,
            "duplicates": self.duplicates,
            "gaps": self.gaps,
            "gap_segments": self.gap_segments,
            "distortions": self.distortions,
            "zero_volume": self.zero_volume,
            "negative_values": self.negative_values,
            "coverage_pct": round(self.coverage_pct, 2),
            "quality_score": round(self.quality_score, 2),
            "gap_pct": round(self.gap_pct, 2),
            "zero_volume_pct": round(self.zero_volume_pct, 2),
            "gap_details": self.gap_details[:10],  # Limit for JSON size
        }


def analyze_candles(
    candles: List[Tuple[Any, ...]],
    interval_seconds: int,
    expected_start_ts: Optional[int] = None,
    expected_end_ts: Optional[int] = None,
) -> QualityMetrics:
    """
    Analyze candle data quality.
    
    Args:
        candles: List of tuples (token_address, timestamp, open, high, low, close, volume)
                 timestamp can be datetime or int (unix seconds)
        interval_seconds: Expected interval between candles (e.g., 60 for 1m)
        expected_start_ts: Expected start timestamp (unix seconds)
        expected_end_ts: Expected end timestamp (unix seconds)
    
    Returns:
        QualityMetrics with detailed analysis
    """
    metrics = QualityMetrics()
    
    if not candles:
        return metrics
    
    # Normalize timestamps to unix seconds
    def to_unix(ts: Any) -> int:
        if isinstance(ts, datetime):
            return int(ts.timestamp())
        return int(ts)
    
    # Extract and sort by timestamp
    timestamps: List[int] = []
    for candle in candles:
        ts = to_unix(candle[1])
        timestamps.append(ts)
    
    timestamps.sort()
    metrics.total_candles = len(timestamps)
    
    # Detect duplicates
    seen: set = set()
    duplicates = 0
    unique_timestamps: List[int] = []
    for ts in timestamps:
        if ts in seen:
            duplicates += 1
        else:
            seen.add(ts)
            unique_timestamps.append(ts)
    metrics.duplicates = duplicates
    
    # Calculate expected candles from time range
    if unique_timestamps:
        min_ts = unique_timestamps[0]
        max_ts = unique_timestamps[-1]
        
        # Use provided bounds or infer from data
        start_ts = expected_start_ts if expected_start_ts is not None else min_ts
        end_ts = expected_end_ts if expected_end_ts is not None else max_ts
        
        time_span = max(0, end_ts - start_ts)
        metrics.expected_candles = max(1, (time_span // interval_seconds) + 1)
    
    # Analyze gaps
    gap_details: List[Dict[str, Any]] = []
    total_missing = 0
    gap_segments = 0
    
    for i in range(1, len(unique_timestamps)):
        prev_ts = unique_timestamps[i - 1]
        curr_ts = unique_timestamps[i]
        diff = curr_ts - prev_ts
        
        if diff > interval_seconds * 1.5:  # Allow 50% tolerance
            missing_count = (diff // interval_seconds) - 1
            total_missing += missing_count
            gap_segments += 1
            
            gap_details.append({
                "start": prev_ts,
                "end": curr_ts,
                "missing_candles": missing_count,
                "gap_seconds": diff,
            })
    
    metrics.gaps = total_missing
    metrics.gap_segments = gap_segments
    metrics.gap_details = gap_details
    
    # Analyze OHLC quality
    distortions = 0
    zero_volume = 0
    negative_values = 0
    
    for candle in candles:
        # candle: (token_address, timestamp, open, high, low, close, volume)
        if len(candle) >= 7:
            open_p, high_p, low_p, close_p, vol = candle[2], candle[3], candle[4], candle[5], candle[6]
            
            # Check for negative/zero prices
            if open_p is not None and high_p is not None and low_p is not None and close_p is not None:
                if any(x <= 0 for x in [open_p, high_p, low_p, close_p] if x is not None):
                    negative_values += 1
                
                # Check OHLC constraints
                if high_p < low_p or open_p > high_p or open_p < low_p or close_p > high_p or close_p < low_p:
                    distortions += 1
            
            # Check volume
            if vol is not None and (vol == 0 or vol is None):
                zero_volume += 1
    
    metrics.distortions = distortions
    metrics.zero_volume = zero_volume
    metrics.negative_values = negative_values
    
    # Calculate derived metrics
    if metrics.expected_candles > 0:
        unique_count = len(unique_timestamps)
        metrics.coverage_pct = (unique_count / metrics.expected_candles) * 100
        metrics.gap_pct = (metrics.gaps / metrics.expected_candles) * 100
    
    if metrics.total_candles > 0:
        metrics.zero_volume_pct = (metrics.zero_volume / metrics.total_candles) * 100
    
    # Calculate quality score (0-100)
    score = 100.0
    score -= min(30, metrics.duplicates * 0.5)  # Penalize duplicates
    score -= min(30, metrics.gaps * 0.1)  # Penalize gaps
    score -= min(20, metrics.distortions * 1.0)  # Penalize distortions
    score -= min(10, metrics.zero_volume * 0.05)  # Small penalty for zero volume
    score -= min(10, metrics.negative_values * 2.0)  # Penalize negative values
    
    # Bonus for high coverage
    if metrics.coverage_pct >= 95:
        score = min(100, score + 5)
    elif metrics.coverage_pct < 80:
        score -= (80 - metrics.coverage_pct) * 0.5
    
    metrics.quality_score = max(0, score)
    
    return metrics


def analyze_parquet_quality(
    parquet_path: str,
    interval_seconds: int = 60,
    expected_start_ts: Optional[int] = None,
    expected_end_ts: Optional[int] = None,
) -> QualityMetrics:
    """
    Analyze quality of candles in a parquet file.
    
    Args:
        parquet_path: Path to parquet file
        interval_seconds: Expected interval between candles
        expected_start_ts: Expected start timestamp (unix seconds)
        expected_end_ts: Expected end timestamp (unix seconds)
    
    Returns:
        QualityMetrics for the file
    """
    import duckdb
    
    try:
        conn = duckdb.connect()
        rows = conn.execute(f"""
            SELECT 
                token_address,
                timestamp,
                open,
                high,
                low,
                close,
                volume
            FROM read_parquet('{parquet_path}')
            ORDER BY timestamp
        """).fetchall()
        conn.close()
        
        return analyze_candles(
            rows,
            interval_seconds,
            expected_start_ts,
            expected_end_ts,
        )
    except Exception as e:
        metrics = QualityMetrics()
        metrics.gap_details = [{"error": str(e)}]
        return metrics


def fill_gaps_with_forward_fill(
    candles: List[Tuple[Any, ...]],
    interval_seconds: int,
    max_gap_fill: int = 10,
) -> Tuple[List[Tuple[Any, ...]], int]:
    """
    Fill small gaps in candle data using forward fill.
    
    For gaps smaller than max_gap_fill candles, creates synthetic candles
    using the previous candle's close price for OHLC and 0 for volume.
    
    Args:
        candles: List of tuples (token_address, timestamp, open, high, low, close, volume)
        interval_seconds: Expected interval between candles
        max_gap_fill: Maximum number of candles to fill in a gap
    
    Returns:
        Tuple of (filled_candles, fill_count)
    """
    if not candles:
        return [], 0
    
    def to_unix(ts: Any) -> int:
        if isinstance(ts, datetime):
            return int(ts.timestamp())
        return int(ts)
    
    def from_unix(ts: int) -> datetime:
        return datetime.fromtimestamp(ts, tz=UTC)
    
    # Sort by timestamp
    sorted_candles = sorted(candles, key=lambda c: to_unix(c[1]))
    
    result: List[Tuple[Any, ...]] = []
    fill_count = 0
    
    for i, candle in enumerate(sorted_candles):
        result.append(candle)
        
        if i + 1 < len(sorted_candles):
            curr_ts = to_unix(candle[1])
            next_ts = to_unix(sorted_candles[i + 1][1])
            diff = next_ts - curr_ts
            
            # Check if there's a gap
            if diff > interval_seconds * 1.5:
                missing_count = (diff // interval_seconds) - 1
                
                if missing_count <= max_gap_fill:
                    # Fill the gap with synthetic candles
                    token_addr = candle[0]
                    prev_close = candle[5]  # Use close price
                    
                    for j in range(1, missing_count + 1):
                        fill_ts = curr_ts + (j * interval_seconds)
                        fill_ts_dt = from_unix(fill_ts)
                        
                        # Create synthetic candle: OHLC = prev_close, volume = 0
                        synthetic = (
                            token_addr,
                            fill_ts_dt,
                            prev_close,  # open
                            prev_close,  # high
                            prev_close,  # low
                            prev_close,  # close
                            0.0,         # volume
                        )
                        result.append(synthetic)
                        fill_count += 1
    
    # Re-sort after filling
    result.sort(key=lambda c: to_unix(c[1]))
    
    return result, fill_count


class QualityThresholds:
    """Thresholds for quality validation."""
    
    def __init__(
        self,
        min_coverage_pct: float = 80.0,
        max_gap_pct: float = 20.0,
        max_zero_volume_pct: float = 30.0,
        min_quality_score: float = 60.0,
        max_duplicates: int = 10,
    ):
        self.min_coverage_pct = min_coverage_pct
        self.max_gap_pct = max_gap_pct
        self.max_zero_volume_pct = max_zero_volume_pct
        self.min_quality_score = min_quality_score
        self.max_duplicates = max_duplicates
    
    def validate(self, metrics: QualityMetrics) -> Tuple[bool, List[str]]:
        """
        Validate metrics against thresholds.
        
        Returns:
            Tuple of (passed, list_of_violations)
        """
        violations: List[str] = []
        
        if metrics.coverage_pct < self.min_coverage_pct:
            violations.append(
                f"Low coverage: {metrics.coverage_pct:.1f}% < {self.min_coverage_pct}%"
            )
        
        if metrics.gap_pct > self.max_gap_pct:
            violations.append(
                f"High gap rate: {metrics.gap_pct:.1f}% > {self.max_gap_pct}%"
            )
        
        if metrics.zero_volume_pct > self.max_zero_volume_pct:
            violations.append(
                f"High zero volume: {metrics.zero_volume_pct:.1f}% > {self.max_zero_volume_pct}%"
            )
        
        if metrics.quality_score < self.min_quality_score:
            violations.append(
                f"Low quality score: {metrics.quality_score:.1f} < {self.min_quality_score}"
            )
        
        if metrics.duplicates > self.max_duplicates:
            violations.append(
                f"Too many duplicates: {metrics.duplicates} > {self.max_duplicates}"
            )
        
        return len(violations) == 0, violations


__all__ = [
    "QualityMetrics",
    "QualityThresholds",
    "analyze_candles",
    "analyze_parquet_quality",
    "fill_gaps_with_forward_fill",
]

