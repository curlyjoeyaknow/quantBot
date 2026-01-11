#!/usr/bin/env python3
"""
Validate parquet slice quality.

Analyzes parquet slice files to detect:
1. Gaps in candle data (missing timestamps)
2. Low coverage (fewer candles than expected)
3. Duplicates
4. OHLC distortions
5. Zero volume anomalies

Can run standalone or compare against ClickHouse source data.

Usage:
  # Validate all slices in a directory
  python validate_slices.py --dir slices/per_token

  # Validate with ClickHouse comparison
  python validate_slices.py --dir slices/per_token --compare-clickhouse

  # Validate specific file
  python validate_slices.py --file slices/per_token/20251201_0007_BL22Me3x.parquet

  # Generate worklist of tokens to re-ingest
  python validate_slices.py --dir slices/per_token --output-worklist worklist.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import duckdb

UTC = timezone.utc

# Optional ClickHouse import
try:
    from clickhouse_driver import Client as ClickHouseClient
    HAS_CLICKHOUSE = True
except ImportError:
    ClickHouseClient = None  # type: ignore
    HAS_CLICKHOUSE = False


# =============================================================================
# Types
# =============================================================================

@dataclass
class SliceQuality:
    """Quality metrics for a parquet slice."""
    
    filepath: str
    token_address: Optional[str] = None
    
    # Basic counts
    total_candles: int = 0
    expected_candles: int = 0
    unique_candles: int = 0
    
    # Time range
    min_ts: Optional[datetime] = None
    max_ts: Optional[datetime] = None
    
    # Issues
    duplicates: int = 0
    gaps: int = 0
    gap_segments: int = 0
    distortions: int = 0
    zero_volume: int = 0
    negative_values: int = 0
    
    # Derived
    coverage_pct: float = 0.0
    quality_score: float = 0.0
    gap_pct: float = 0.0
    zero_volume_pct: float = 0.0
    
    # Comparison with ClickHouse
    ch_candles: int = 0
    missing_from_parquet: int = 0
    extra_in_parquet: int = 0
    
    # Gap details
    gap_details: List[Dict[str, Any]] = field(default_factory=list)
    
    @property
    def has_issues(self) -> bool:
        return (
            self.gaps > 0 or 
            self.coverage_pct < 80 or 
            self.duplicates > 5 or
            self.distortions > 0
        )
    
    @property
    def severity(self) -> str:
        if self.coverage_pct < 50 or self.gaps > 100:
            return "critical"
        elif self.coverage_pct < 80 or self.gaps > 20:
            return "warning"
        elif self.gaps > 0:
            return "minor"
        return "ok"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "filepath": self.filepath,
            "token_address": self.token_address,
            "total_candles": self.total_candles,
            "expected_candles": self.expected_candles,
            "unique_candles": self.unique_candles,
            "min_ts": self.min_ts.isoformat() if self.min_ts else None,
            "max_ts": self.max_ts.isoformat() if self.max_ts else None,
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
            "ch_candles": self.ch_candles,
            "missing_from_parquet": self.missing_from_parquet,
            "severity": self.severity,
            "gap_details": self.gap_details[:5],  # Limit for output
        }


# =============================================================================
# Analysis Functions
# =============================================================================

def analyze_parquet_slice(
    filepath: Path,
    interval_seconds: int = 60,
    expected_hours: Optional[float] = None,
) -> SliceQuality:
    """
    Analyze quality of a parquet slice file.
    
    Args:
        filepath: Path to parquet file
        interval_seconds: Expected interval between candles
        expected_hours: Expected time span in hours (for coverage calculation)
    
    Returns:
        SliceQuality with detailed metrics
    """
    quality = SliceQuality(filepath=str(filepath))
    
    try:
        conn = duckdb.connect()
        rows = conn.execute(f"""
            SELECT 
                token_address,
                CAST(EXTRACT(EPOCH FROM timestamp) AS INTEGER) as ts,
                open,
                high,
                low,
                close,
                volume
            FROM read_parquet('{filepath}')
            ORDER BY timestamp
        """).fetchall()
        conn.close()
    except Exception as e:
        quality.gap_details = [{"error": str(e)}]
        return quality
    
    if not rows:
        return quality
    
    # Extract token address (assuming single token per file)
    quality.token_address = rows[0][0] if rows else None
    quality.total_candles = len(rows)
    
    # Collect timestamps
    timestamps: List[int] = []
    for row in rows:
        ts = row[1]
        timestamps.append(int(ts))
    
    timestamps.sort()
    
    # Time range
    if timestamps:
        quality.min_ts = datetime.fromtimestamp(timestamps[0], tz=UTC)
        quality.max_ts = datetime.fromtimestamp(timestamps[-1], tz=UTC)
    
    # Detect duplicates
    seen: set = set()
    duplicates = 0
    unique_ts: List[int] = []
    for ts in timestamps:
        if ts in seen:
            duplicates += 1
        else:
            seen.add(ts)
            unique_ts.append(ts)
    
    quality.duplicates = duplicates
    quality.unique_candles = len(unique_ts)
    
    # Calculate expected candles
    # WARNING: If expected_hours is not provided, we use the data's actual time span
    # This can OVERESTIMATE coverage if there are gaps at the start/end of the data!
    if expected_hours:
        quality.expected_candles = int((expected_hours * 3600) // interval_seconds)
    elif unique_ts:
        # Fallback: use actual data span (may overestimate coverage!)
        time_span = unique_ts[-1] - unique_ts[0]
        quality.expected_candles = max(1, (time_span // interval_seconds) + 1)
    
    # Detect gaps
    gap_details: List[Dict[str, Any]] = []
    total_missing = 0
    gap_segments = 0
    
    for i in range(1, len(unique_ts)):
        prev_ts = unique_ts[i - 1]
        curr_ts = unique_ts[i]
        diff = curr_ts - prev_ts
        
        if diff > interval_seconds * 1.5:
            missing = (diff // interval_seconds) - 1
            total_missing += missing
            gap_segments += 1
            
            gap_details.append({
                "start": datetime.fromtimestamp(prev_ts, tz=UTC).isoformat(),
                "end": datetime.fromtimestamp(curr_ts, tz=UTC).isoformat(),
                "missing_candles": int(missing),
                "gap_seconds": int(diff),
            })
    
    quality.gaps = total_missing
    quality.gap_segments = gap_segments
    quality.gap_details = gap_details
    
    # Analyze OHLC quality
    distortions = 0
    zero_volume = 0
    negative_values = 0
    
    for row in rows:
        open_p, high_p, low_p, close_p, vol = row[2], row[3], row[4], row[5], row[6]
        
        # Check for negative/zero prices
        if open_p is not None and high_p is not None and low_p is not None and close_p is not None:
            if any(x is not None and x <= 0 for x in [open_p, high_p, low_p, close_p]):
                negative_values += 1
            
            # Check OHLC constraints
            if high_p < low_p or open_p > high_p or open_p < low_p or close_p > high_p or close_p < low_p:
                distortions += 1
        
        # Check volume
        if vol is None or vol == 0:
            zero_volume += 1
    
    quality.distortions = distortions
    quality.zero_volume = zero_volume
    quality.negative_values = negative_values
    
    # Calculate derived metrics
    if quality.expected_candles > 0:
        quality.coverage_pct = (quality.unique_candles / quality.expected_candles) * 100
        quality.gap_pct = (quality.gaps / quality.expected_candles) * 100
    
    if quality.total_candles > 0:
        quality.zero_volume_pct = (quality.zero_volume / quality.total_candles) * 100
    
    # Calculate quality score
    score = 100.0
    score -= min(30, quality.duplicates * 0.5)
    score -= min(30, quality.gaps * 0.1)
    score -= min(20, quality.distortions * 1.0)
    score -= min(10, quality.zero_volume * 0.05)
    score -= min(10, quality.negative_values * 2.0)
    
    if quality.coverage_pct >= 95:
        score = min(100, score + 5)
    elif quality.coverage_pct < 80:
        score -= (80 - quality.coverage_pct) * 0.5
    
    quality.quality_score = max(0, score)
    
    return quality


def compare_with_clickhouse(
    quality: SliceQuality,
    ch_client: 'ClickHouseClient',
    database: str,
    chain: str,
    interval_seconds: int,
) -> SliceQuality:
    """
    Compare parquet slice with ClickHouse source data.
    
    Updates quality object with comparison metrics.
    """
    if not quality.token_address or not quality.min_ts or not quality.max_ts:
        return quality
    
    try:
        query = f"""
            SELECT 
                toUnixTimestamp(timestamp) as ts
            FROM {database}.ohlcv_candles
            WHERE token_address = %(token)s
              AND lower(chain) = lower(%(chain)s)
              AND interval_seconds = %(interval)s
              AND timestamp >= toDateTime(%(from_ts)s)
              AND timestamp <= toDateTime(%(to_ts)s)
            ORDER BY timestamp
        """
        
        rows = ch_client.execute(query, {
            'token': quality.token_address,
            'chain': chain,
            'interval': interval_seconds,
            'from_ts': int(quality.min_ts.timestamp()),
            'to_ts': int(quality.max_ts.timestamp()),
        })
        
        ch_timestamps = set(int(r[0]) for r in rows)
        quality.ch_candles = len(ch_timestamps)
        
        # Get parquet timestamps
        conn = duckdb.connect()
        pq_rows = conn.execute(f"""
            SELECT DISTINCT CAST(EXTRACT(EPOCH FROM timestamp) AS INTEGER) as ts
            FROM read_parquet('{quality.filepath}')
        """).fetchall()
        conn.close()
        
        pq_timestamps = set(int(r[0]) for r in pq_rows)
        
        # Compare
        quality.missing_from_parquet = len(ch_timestamps - pq_timestamps)
        quality.extra_in_parquet = len(pq_timestamps - ch_timestamps)
        
    except Exception as e:
        quality.gap_details.append({"ch_error": str(e)})
    
    return quality


def validate_directory(
    directory: Path,
    interval_seconds: int = 60,
    expected_hours: Optional[float] = None,
    compare_ch: bool = False,
    ch_client: Optional['ClickHouseClient'] = None,
    ch_database: str = "quantbot",
    chain: str = "solana",
    verbose: bool = False,
) -> List[SliceQuality]:
    """
    Validate all parquet files in a directory.
    
    Returns list of SliceQuality objects.
    """
    parquet_files = list(directory.glob("*.parquet"))
    
    if verbose:
        print(f"Found {len(parquet_files)} parquet files in {directory}", file=sys.stderr)
    
    results: List[SliceQuality] = []
    
    for i, filepath in enumerate(parquet_files):
        if verbose and i % 50 == 0:
            print(f"  Progress: {i}/{len(parquet_files)}...", file=sys.stderr)
        
        quality = analyze_parquet_slice(filepath, interval_seconds, expected_hours)
        
        if compare_ch and ch_client:
            quality = compare_with_clickhouse(
                quality, ch_client, ch_database, chain, interval_seconds
            )
        
        results.append(quality)
    
    return results


def generate_summary(results: List[SliceQuality]) -> Dict[str, Any]:
    """Generate summary statistics from validation results."""
    if not results:
        return {"error": "No results"}
    
    total = len(results)
    
    # Count issues
    with_gaps = sum(1 for r in results if r.gaps > 0)
    low_coverage = sum(1 for r in results if r.coverage_pct < 80)
    high_zero_volume = sum(1 for r in results if r.zero_volume_pct > 20)
    with_duplicates = sum(1 for r in results if r.duplicates > 0)
    with_distortions = sum(1 for r in results if r.distortions > 0)
    
    # Severity counts
    critical = sum(1 for r in results if r.severity == "critical")
    warning = sum(1 for r in results if r.severity == "warning")
    minor = sum(1 for r in results if r.severity == "minor")
    ok = sum(1 for r in results if r.severity == "ok")
    
    # Averages
    avg_coverage = sum(r.coverage_pct for r in results) / total if total > 0 else 0
    avg_quality_score = sum(r.quality_score for r in results) / total if total > 0 else 0
    total_gaps = sum(r.gaps for r in results)
    total_candles = sum(r.total_candles for r in results)
    
    return {
        "total_files": total,
        "total_candles": total_candles,
        "total_gaps": total_gaps,
        "issue_breakdown": {
            "with_gaps": {"count": with_gaps, "pct": round(with_gaps / total * 100, 1)},
            "low_coverage": {"count": low_coverage, "pct": round(low_coverage / total * 100, 1)},
            "high_zero_volume": {"count": high_zero_volume, "pct": round(high_zero_volume / total * 100, 1)},
            "with_duplicates": {"count": with_duplicates, "pct": round(with_duplicates / total * 100, 1)},
            "with_distortions": {"count": with_distortions, "pct": round(with_distortions / total * 100, 1)},
        },
        "severity_breakdown": {
            "critical": {"count": critical, "pct": round(critical / total * 100, 1)},
            "warning": {"count": warning, "pct": round(warning / total * 100, 1)},
            "minor": {"count": minor, "pct": round(minor / total * 100, 1)},
            "ok": {"count": ok, "pct": round(ok / total * 100, 1)},
        },
        "averages": {
            "coverage_pct": round(avg_coverage, 1),
            "quality_score": round(avg_quality_score, 1),
        },
    }


def generate_worklist(
    results: List[SliceQuality],
    min_severity: str = "warning",
) -> List[Dict[str, Any]]:
    """
    Generate worklist of tokens that need re-ingestion.
    
    Args:
        results: Validation results
        min_severity: Minimum severity to include ("minor", "warning", "critical")
    
    Returns:
        List of tokens to re-ingest with details
    """
    severity_order = {"ok": 0, "minor": 1, "warning": 2, "critical": 3}
    min_level = severity_order.get(min_severity, 1)
    
    worklist: List[Dict[str, Any]] = []
    
    for r in results:
        if severity_order.get(r.severity, 0) >= min_level:
            worklist.append({
                "token_address": r.token_address,
                "filepath": r.filepath,
                "severity": r.severity,
                "gaps": r.gaps,
                "coverage_pct": round(r.coverage_pct, 1),
                "quality_score": round(r.quality_score, 1),
                "time_range": {
                    "start": r.min_ts.isoformat() if r.min_ts else None,
                    "end": r.max_ts.isoformat() if r.max_ts else None,
                },
                "reasons": _get_issue_reasons(r),
            })
    
    # Sort by severity (critical first) then by coverage (lowest first)
    worklist.sort(
        key=lambda x: (-severity_order.get(x["severity"], 0), x["coverage_pct"])
    )
    
    return worklist


def _get_issue_reasons(r: SliceQuality) -> List[str]:
    """Get list of issue reasons for a result."""
    reasons = []
    if r.gaps > 0:
        reasons.append(f"{r.gaps} gaps")
    if r.coverage_pct < 80:
        reasons.append(f"low coverage ({r.coverage_pct:.0f}%)")
    if r.duplicates > 5:
        reasons.append(f"{r.duplicates} duplicates")
    if r.distortions > 0:
        reasons.append(f"{r.distortions} OHLC distortions")
    if r.zero_volume_pct > 20:
        reasons.append(f"high zero volume ({r.zero_volume_pct:.0f}%)")
    return reasons


def print_summary(
    summary: Dict[str, Any], 
    results: List[SliceQuality],
    expected_hours_provided: bool = True,
) -> None:
    """Print human-readable summary."""
    print()
    print("=" * 70)
    print("SLICE VALIDATION SUMMARY")
    print("=" * 70)
    
    # WARNING if expected_hours not provided
    if not expected_hours_provided:
        yellow = "\033[33m"
        reset = "\033[0m"
        print(f"\n{yellow}⚠️  WARNING: --expected-hours not provided!{reset}")
        print(f"{yellow}   Coverage is calculated from data's actual time range,{reset}")
        print(f"{yellow}   which may OVERESTIMATE coverage if gaps exist at start/end.{reset}")
        print(f"{yellow}   For accurate coverage, run with: --expected-hours 24 (or 48){reset}")
    
    print(f"\nTotal files:    {summary['total_files']}")
    print(f"Total candles:  {summary['total_candles']:,}")
    print(f"Total gaps:     {summary['total_gaps']:,}")
    
    print("\n" + "-" * 40)
    print("ISSUE BREAKDOWN")
    print("-" * 40)
    
    issues = summary["issue_breakdown"]
    print(f"  With GAPS:          {issues['with_gaps']['count']:4} ({issues['with_gaps']['pct']:5.1f}%)")
    print(f"  Low coverage:       {issues['low_coverage']['count']:4} ({issues['low_coverage']['pct']:5.1f}%)")
    print(f"  High zero volume:   {issues['high_zero_volume']['count']:4} ({issues['high_zero_volume']['pct']:5.1f}%)")
    print(f"  With duplicates:    {issues['with_duplicates']['count']:4} ({issues['with_duplicates']['pct']:5.1f}%)")
    print(f"  With distortions:   {issues['with_distortions']['count']:4} ({issues['with_distortions']['pct']:5.1f}%)")
    
    print("\n" + "-" * 40)
    print("SEVERITY BREAKDOWN")
    print("-" * 40)
    
    sev = summary["severity_breakdown"]
    
    # Color codes
    red = "\033[31m"
    yellow = "\033[33m"
    blue = "\033[34m"
    green = "\033[32m"
    reset = "\033[0m"
    
    print(f"  {red}Critical:{reset}  {sev['critical']['count']:4} ({sev['critical']['pct']:5.1f}%)")
    print(f"  {yellow}Warning:{reset}   {sev['warning']['count']:4} ({sev['warning']['pct']:5.1f}%)")
    print(f"  {blue}Minor:{reset}     {sev['minor']['count']:4} ({sev['minor']['pct']:5.1f}%)")
    print(f"  {green}OK:{reset}        {sev['ok']['count']:4} ({sev['ok']['pct']:5.1f}%)")
    
    print("\n" + "-" * 40)
    print("AVERAGES")
    print("-" * 40)
    
    avgs = summary["averages"]
    print(f"  Coverage:       {avgs['coverage_pct']:5.1f}%")
    print(f"  Quality score:  {avgs['quality_score']:5.1f}/100")
    
    # Worst files
    worst = sorted(results, key=lambda r: r.coverage_pct)[:10]
    if worst:
        print("\n" + "-" * 40)
        print("WORST 10 FILES (by coverage)")
        print("-" * 40)
        for r in worst:
            name = Path(r.filepath).name[:40]
            print(f"  {name:40} cov={r.coverage_pct:5.1f}% gaps={r.gaps:4}")
    
    print("\n" + "=" * 70)


# =============================================================================
# Main
# =============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate parquet slice quality",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    
    # Input
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dir", type=Path, help="Directory containing parquet files")
    group.add_argument("--file", type=Path, help="Single parquet file to validate")
    
    # Candle settings
    parser.add_argument("--interval-seconds", type=int, default=60,
                        help="Expected candle interval (default: 60)")
    parser.add_argument("--expected-hours", type=float, default=None,
                        help="Expected time span in hours (REQUIRED for accurate coverage! "
                             "e.g., 24 or 48 for horizon-based exports)")
    
    # ClickHouse comparison
    parser.add_argument("--compare-clickhouse", action="store_true",
                        help="Compare with ClickHouse source data")
    parser.add_argument("--ch-host", default=os.getenv("CLICKHOUSE_HOST", "localhost"))
    parser.add_argument("--ch-port", type=int, 
                        default=int(os.getenv("CLICKHOUSE_PORT", "19000")))
    parser.add_argument("--ch-db", default=os.getenv("CLICKHOUSE_DATABASE", "quantbot"))
    parser.add_argument("--chain", default="solana")
    
    # Output
    parser.add_argument("--output", type=Path, help="Output JSON report path")
    parser.add_argument("--output-worklist", type=Path, 
                        help="Output worklist of tokens to re-ingest")
    parser.add_argument("--min-severity", 
                        choices=["minor", "warning", "critical"],
                        default="warning",
                        help="Minimum severity for worklist (default: warning)")
    
    parser.add_argument("-v", "--verbose", action="store_true")
    
    args = parser.parse_args()
    
    # ClickHouse connection
    ch_client = None
    if args.compare_clickhouse:
        if not HAS_CLICKHOUSE:
            print("ERROR: clickhouse-driver not installed", file=sys.stderr)
            sys.exit(1)
        
        ch_client = ClickHouseClient(
            host=args.ch_host,
            port=args.ch_port,
            database=args.ch_db,
        )
    
    # Validate
    if args.file:
        results = [analyze_parquet_slice(
            args.file, args.interval_seconds, args.expected_hours
        )]
        if ch_client:
            results[0] = compare_with_clickhouse(
                results[0], ch_client, args.ch_db, args.chain, args.interval_seconds
            )
    else:
        results = validate_directory(
            args.dir,
            interval_seconds=args.interval_seconds,
            expected_hours=args.expected_hours,
            compare_ch=args.compare_clickhouse,
            ch_client=ch_client,
            ch_database=args.ch_db,
            chain=args.chain,
            verbose=args.verbose,
        )
    
    # Generate summary
    summary = generate_summary(results)
    
    # Print summary - warn if expected-hours not provided
    expected_hours_provided = args.expected_hours is not None
    print_summary(summary, results, expected_hours_provided=expected_hours_provided)
    
    # Write outputs
    if args.output:
        report = {
            "generated_at": datetime.now(UTC).isoformat(),
            "summary": summary,
            "files": [r.to_dict() for r in results],
        }
        with open(args.output, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nReport saved: {args.output}")
    
    if args.output_worklist:
        worklist = generate_worklist(results, args.min_severity)
        with open(args.output_worklist, "w") as f:
            json.dump({
                "generated_at": datetime.now(UTC).isoformat(),
                "min_severity": args.min_severity,
                "count": len(worklist),
                "tokens": worklist,
            }, f, indent=2)
        print(f"Worklist saved: {args.output_worklist} ({len(worklist)} tokens)")


if __name__ == "__main__":
    main()

