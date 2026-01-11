#!/usr/bin/env python3
"""
Export per-token candle slices from ClickHouse to Parquet.

For each alert in the date range, exports candles for that token from
alert_time to alert_time + horizon. Each token gets its own Parquet file.

Usage:
  # Export per-token slices for alerts in a date range (48h horizon)
  python3 export_per_token_slices.py --from 2025-12-01 --to 2025-12-03

  # Custom horizon (24 hours)
  python3 export_per_token_slices.py --from 2025-12-01 --to 2025-12-03 --horizon 24

  # Include pre-window (30 min before alert)
  python3 export_per_token_slices.py --from 2025-12-01 --to 2025-12-03 --pre-window 30

  # Custom output directory
  python3 export_per_token_slices.py --from 2025-12-01 --to 2025-12-03 --out-dir slices/dec
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, NamedTuple, Optional

import duckdb

try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)

UTC = timezone.utc


# =============================================================================
# Types
# =============================================================================

class AlertInfo(NamedTuple):
    """Info about an alert for a token."""
    mint: str
    trigger_ts_ms: int
    caller_name: Optional[str]
    chat_id: Optional[int]


# =============================================================================
# Helpers
# =============================================================================

def parse_yyyy_mm_dd(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)


def ms_to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000.0, tz=UTC)


def dt_to_ch(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


def _sql_escape(s: str) -> str:
    return s.replace("'", "''")


def safe_filename(mint: str) -> str:
    """Make a safe filename from a mint address."""
    # Keep first 8 and last 4 chars for readability
    if len(mint) > 16:
        return f"{mint[:8]}_{mint[-4:]}"
    return mint


# =============================================================================
# ClickHouse
# =============================================================================

@dataclass(frozen=True)
class ClickHouseCfg:
    host: str
    port: int
    database: str
    table: str
    user: str
    password: str
    connect_timeout: int
    send_receive_timeout: int

    def get_client(self) -> ClickHouseClient:
        return ClickHouseClient(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            connect_timeout=self.connect_timeout,
            send_receive_timeout=self.send_receive_timeout,
        )


@dataclass
class TokenExportResult:
    """Result of exporting candles for a single token."""
    
    count: int
    gaps: int = 0
    duplicates: int = 0
    coverage_pct: float = 0.0
    quality_score: float = 100.0
    zero_volume: int = 0
    
    @property
    def has_gaps(self) -> bool:
        return self.gaps > 0
    
    @property
    def is_low_coverage(self) -> bool:
        return self.coverage_pct < 80.0
    
    @property
    def is_high_zero_volume(self) -> bool:
        return self.count > 0 and (self.zero_volume / self.count) * 100 > 20.0


def analyze_token_candles(
    rows: List[Any],
    interval_seconds: int,
    expected_start_ts: int,
    expected_end_ts: int,
) -> TokenExportResult:
    """
    Analyze quality of candles for a single token.
    
    Returns TokenExportResult with quality metrics.
    """
    if not rows:
        return TokenExportResult(count=0)
    
    count = len(rows)
    
    # Extract timestamps
    timestamps: List[int] = []
    for row in rows:
        ts = row[1]
        if isinstance(ts, datetime):
            timestamps.append(int(ts.timestamp()))
        else:
            timestamps.append(int(ts))
    
    timestamps.sort()
    
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
    
    # Calculate expected candles
    time_span = max(0, expected_end_ts - expected_start_ts)
    expected_candles = max(1, time_span // interval_seconds)
    
    # Detect gaps
    gaps = 0
    for i in range(1, len(unique_ts)):
        diff = unique_ts[i] - unique_ts[i - 1]
        if diff > interval_seconds * 1.5:
            missing = (diff // interval_seconds) - 1
            gaps += missing
    
    # Also check for gaps at start and end
    if unique_ts:
        # Gap at start
        start_gap = (unique_ts[0] - expected_start_ts) // interval_seconds
        if start_gap > 0:
            gaps += start_gap
        
        # Gap at end
        end_gap = (expected_end_ts - unique_ts[-1]) // interval_seconds
        if end_gap > 1:  # Allow 1 candle margin
            gaps += end_gap - 1
    
    # Calculate coverage
    unique_count = len(unique_ts)
    coverage_pct = (unique_count / expected_candles) * 100 if expected_candles > 0 else 0
    
    # Count zero volume
    zero_volume = 0
    for row in rows:
        if len(row) >= 7 and (row[6] is None or row[6] == 0):
            zero_volume += 1
    
    # Calculate quality score
    score = 100.0
    score -= min(30, duplicates * 0.5)
    score -= min(30, gaps * 0.1)
    score -= min(10, zero_volume * 0.05)
    if coverage_pct < 80:
        score -= (80 - coverage_pct) * 0.5
    
    return TokenExportResult(
        count=count,
        gaps=gaps,
        duplicates=duplicates,
        coverage_pct=coverage_pct,
        quality_score=max(0, score),
        zero_volume=zero_volume,
    )


def export_token_candles(
    cfg: ClickHouseCfg,
    chain: str,
    mint: str,
    interval_seconds: int,
    start_time: datetime,
    end_time: datetime,
    output_path: Path,
    validate: bool = True,
) -> TokenExportResult:
    """
    Export candles for a single token to a Parquet file.
    
    Returns TokenExportResult with count and quality metrics.
    Deduplicates by timestamp (takes any row per timestamp).
    
    Improvements:
    - Uses argmax(volume) instead of any() to prefer candles with higher volume
    - Returns quality metrics for gap/coverage tracking
    - Validates data before writing
    """
    chain_q = _sql_escape(chain)
    mint_q = _sql_escape(mint)

    # Use GROUP BY to deduplicate - prefer candle with highest volume
    # This is better than any() because it picks the "most complete" candle
    sql = f"""
SELECT
  token_address,
  timestamp,
  argMax(open, volume) as open,
  argMax(high, volume) as high,
  argMax(low, volume) as low,
  argMax(close, volume) as close,
  max(volume) as volume
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address = '{mint_q}'
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(start_time)}')
  AND timestamp < toDateTime('{dt_to_ch(end_time)}')
GROUP BY token_address, timestamp
ORDER BY timestamp
""".strip()

    client = cfg.get_client()
    result = client.execute(sql, with_column_types=True)
    rows_data, columns = result

    if not rows_data:
        return TokenExportResult(count=0)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Analyze quality before writing
    expected_start_ts = int(start_time.timestamp())
    expected_end_ts = int(end_time.timestamp())
    
    quality = analyze_token_candles(
        rows_data, interval_seconds, expected_start_ts, expected_end_ts
    )

    # Write to Parquet using DuckDB
    conn = duckdb.connect(":memory:")
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
    conn.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", rows_data)
    conn.execute(f"COPY candles TO '{output_path}' (FORMAT PARQUET, COMPRESSION 'zstd')")
    count = conn.execute("SELECT count(*) FROM candles").fetchone()[0]
    conn.close()

    quality.count = count
    return quality


# =============================================================================
# Alert Loading
# =============================================================================

def duckdb_table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    q = "SELECT COUNT(*)::INT FROM information_schema.tables WHERE table_name = ?"
    return conn.execute(q, [table_name]).fetchone()[0] > 0


def load_alerts_with_timestamps(
    duckdb_path: str,
    chain: str,
    date_from: datetime,
    date_to: datetime,
) -> List[AlertInfo]:
    """Load alerts with their timestamps from DuckDB."""
    conn = duckdb.connect(duckdb_path, read_only=True)
    from_ms = int(date_from.timestamp() * 1000)
    to_ms_excl = int((date_to + timedelta(days=1)).timestamp() * 1000)

    alerts: List[AlertInfo] = []

    # Try caller_links_d first
    if duckdb_table_exists(conn, "caller_links_d"):
        cols = [r[1].lower() for r in conn.execute("PRAGMA table_info('caller_links_d')").fetchall()]
        has_chain = "chain" in cols
        has_caller = "caller_name" in cols
        has_chat = "chat_id" in cols

        select_parts = ["mint::TEXT as mint", "trigger_ts_ms"]
        if has_caller:
            select_parts.append("caller_name")
        if has_chat:
            select_parts.append("chat_id::BIGINT as chat_id")

        sql = f"""
        SELECT {', '.join(select_parts)}
        FROM caller_links_d
        WHERE mint IS NOT NULL
          AND trigger_ts_ms >= ?
          AND trigger_ts_ms < ?
        """
        params: List[Any] = [from_ms, to_ms_excl]
        if has_chain:
            sql += " AND lower(chain) = lower(?)"
            params.append(chain)
        sql += " ORDER BY trigger_ts_ms"

        for row in conn.execute(sql, params).fetchall():
            mint = row[0]
            ts = row[1]
            caller = row[2] if has_caller and len(row) > 2 else None
            chat = row[3] if has_chat and len(row) > 3 else None
            if mint and ts:
                alerts.append(AlertInfo(mint=mint, trigger_ts_ms=ts, caller_name=caller, chat_id=chat))

    # Fallback to user_calls_d
    if not alerts and duckdb_table_exists(conn, "user_calls_d"):
        cols = [r[1].lower() for r in conn.execute("PRAGMA table_info('user_calls_d')").fetchall()]
        has_chain = "chain" in cols
        ts_col = "call_ts_ms" if "call_ts_ms" in cols else ("trigger_ts_ms" if "trigger_ts_ms" in cols else None)

        if ts_col:
            sql = f"""
            SELECT mint::TEXT as mint, {ts_col} as trigger_ts_ms
            FROM user_calls_d
            WHERE mint IS NOT NULL
              AND {ts_col} >= ?
              AND {ts_col} < ?
            """
            params = [from_ms, to_ms_excl]
            if has_chain:
                sql += " AND lower(chain) = lower(?)"
                params.append(chain)
            sql += f" ORDER BY {ts_col}"

            for row in conn.execute(sql, params).fetchall():
                if row[0] and row[1]:
                    alerts.append(AlertInfo(mint=row[0], trigger_ts_ms=row[1], caller_name=None, chat_id=None))

    conn.close()
    return alerts


# =============================================================================
# Main
# =============================================================================

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Export per-token candle slices from ClickHouse to Parquet",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Export 48h slices for all alerts Dec 1-3
  python3 export_per_token_slices.py --from 2025-12-01 --to 2025-12-03

  # 24h horizon with 30min pre-window
  python3 export_per_token_slices.py --from 2025-12-01 --to 2025-12-03 --horizon 24 --pre-window 30
        """,
    )

    # Date range
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")

    # Alert source
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "../../data/alerts.duckdb"),
                    help="DuckDB path for alerts")
    ap.add_argument("--chain", default="solana", help="Chain to filter by")

    # Time windows
    ap.add_argument("--horizon", type=int, default=48,
                    help="Hours of candle data after each alert (default: 48)")
    ap.add_argument("--pre-window", type=int, default=0,
                    help="Minutes of candle data before each alert (default: 0)")

    # Candle settings
    ap.add_argument("--interval-seconds", type=int, choices=[60, 300], default=60,
                    help="Candle interval (default: 60 = 1m)")

    # Output
    ap.add_argument("--out-dir", default="slices/per_token",
                    help="Output directory for per-token Parquet files")
    ap.add_argument("--skip-existing", action="store_true",
                    help="Skip tokens that already have a slice file")

    # ClickHouse connection
    ap.add_argument("--ch-host", default=os.getenv("CLICKHOUSE_HOST", os.getenv("CH_HOST", "localhost")))
    ap.add_argument("--ch-port", type=int, default=int(os.getenv("CLICKHOUSE_PORT", os.getenv("CH_PORT", "19000"))))
    ap.add_argument("--ch-db", default=os.getenv("CLICKHOUSE_DATABASE", os.getenv("CH_DB", "quantbot")))
    ap.add_argument("--ch-table", default=os.getenv("CH_TABLE", "ohlcv_candles"))
    ap.add_argument("--ch-user", default=os.getenv("CLICKHOUSE_USER", os.getenv("CH_USER", "default")))
    ap.add_argument("--ch-pass", default=os.getenv("CLICKHOUSE_PASSWORD", os.getenv("CH_PASS", "")))
    ap.add_argument("--ch-connect-timeout", type=int, default=10)
    ap.add_argument("--ch-timeout-s", type=int, default=120)

    # Other
    ap.add_argument("--verbose", "-v", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="Show what would be exported without doing it")

    args = ap.parse_args()

    date_from = parse_yyyy_mm_dd(args.date_from)
    date_to = parse_yyyy_mm_dd(args.date_to)
    verbose = args.verbose
    out_dir = Path(args.out_dir)

    # Step 1: Load alerts
    if verbose:
        print(f"[1/3] Loading alerts from {args.duckdb}...", file=sys.stderr)

    alerts = load_alerts_with_timestamps(args.duckdb, args.chain, date_from, date_to)

    if not alerts:
        raise SystemExit("No alerts found. Check your date range.")

    # Deduplicate by mint (use earliest alert per token)
    mint_to_alert: Dict[str, AlertInfo] = {}
    for alert in alerts:
        if alert.mint not in mint_to_alert:
            mint_to_alert[alert.mint] = alert
        elif alert.trigger_ts_ms < mint_to_alert[alert.mint].trigger_ts_ms:
            mint_to_alert[alert.mint] = alert

    unique_alerts = list(mint_to_alert.values())

    if verbose:
        print(f"      Found {len(alerts)} total alerts, {len(unique_alerts)} unique tokens", file=sys.stderr)

    # Step 2: Build ClickHouse config
    ch_cfg = ClickHouseCfg(
        host=args.ch_host,
        port=args.ch_port,
        database=args.ch_db,
        table=args.ch_table,
        user=args.ch_user,
        password=args.ch_pass,
        connect_timeout=args.ch_connect_timeout,
        send_receive_timeout=args.ch_timeout_s,
    )

    # Prepare export
    horizon_td = timedelta(hours=args.horizon)
    pre_window_td = timedelta(minutes=args.pre_window)

    if verbose:
        print("[2/3] Export settings:", file=sys.stderr)
        print(f"      Horizon: {args.horizon}h after alert", file=sys.stderr)
        if args.pre_window > 0:
            print(f"      Pre-window: {args.pre_window}m before alert", file=sys.stderr)
        print(f"      Interval: {args.interval_seconds}s candles", file=sys.stderr)
        print(f"      Output: {out_dir}/", file=sys.stderr)

    if args.dry_run:
        print("\n[DRY RUN] Would export the following tokens:", file=sys.stderr)
        for alert in unique_alerts[:20]:
            alert_dt = ms_to_dt(alert.trigger_ts_ms)
            start = alert_dt - pre_window_td
            end = alert_dt + horizon_td
            print(f"  {alert.mint[:12]}... | {alert_dt.strftime('%Y-%m-%d %H:%M')} | {start.strftime('%H:%M')} -> {end.strftime('%Y-%m-%d %H:%M')}", file=sys.stderr)
        if len(unique_alerts) > 20:
            print(f"  ... and {len(unique_alerts) - 20} more", file=sys.stderr)
        return

    # Step 3: Export each token
    out_dir.mkdir(parents=True, exist_ok=True)

    if verbose:
        print(f"[3/3] Exporting {len(unique_alerts)} token slices...", file=sys.stderr)

    exported = 0
    skipped = 0
    no_data = 0
    total_candles = 0
    
    # Quality tracking
    quality_results: List[Dict[str, Any]] = []
    tokens_with_gaps = 0
    tokens_low_coverage = 0
    tokens_high_zero_volume = 0
    total_gaps = 0

    for i, alert in enumerate(unique_alerts):
        alert_dt = ms_to_dt(alert.trigger_ts_ms)
        start_time = alert_dt - pre_window_td
        end_time = alert_dt + horizon_td

        # Output filename: includes date and short mint
        date_str = alert_dt.strftime("%Y%m%d_%H%M")
        filename = f"{date_str}_{safe_filename(alert.mint)}.parquet"
        output_path = out_dir / filename

        if args.skip_existing and output_path.exists():
            skipped += 1
            continue

        result = export_token_candles(
            cfg=ch_cfg,
            chain=args.chain,
            mint=alert.mint,
            interval_seconds=args.interval_seconds,
            start_time=start_time,
            end_time=end_time,
            output_path=output_path,
            validate=True,
        )

        if result.count > 0:
            exported += 1
            total_candles += result.count
            total_gaps += result.gaps
            
            # Track quality issues
            if result.has_gaps:
                tokens_with_gaps += 1
            if result.is_low_coverage:
                tokens_low_coverage += 1
            if result.is_high_zero_volume:
                tokens_high_zero_volume += 1
            
            # Record for quality report
            quality_results.append({
                "mint": alert.mint,
                "filename": filename,
                "alert_ts": alert_dt.isoformat(),
                "caller": alert.caller_name or "unknown",
                "count": result.count,
                "gaps": result.gaps,
                "duplicates": result.duplicates,
                "coverage_pct": round(result.coverage_pct, 1),
                "quality_score": round(result.quality_score, 1),
                "zero_volume": result.zero_volume,
            })
            
            if verbose:
                progress = f"[{i+1}/{len(unique_alerts)}]"
                quality_indicator = ""
                if result.has_gaps:
                    quality_indicator = f" ⚠️ gaps={result.gaps}"
                elif result.is_low_coverage:
                    quality_indicator = f" ⚠️ cov={result.coverage_pct:.0f}%"
                print(f"  {progress} {alert.mint[:12]}... -> {result.count:,} candles{quality_indicator}", file=sys.stderr)
        else:
            no_data += 1
            quality_results.append({
                "mint": alert.mint,
                "filename": filename,
                "alert_ts": alert_dt.isoformat(),
                "caller": alert.caller_name or "unknown",
                "count": 0,
                "gaps": 0,
                "duplicates": 0,
                "coverage_pct": 0,
                "quality_score": 0,
                "zero_volume": 0,
                "error": "no_data",
            })
            if verbose:
                progress = f"[{i+1}/{len(unique_alerts)}]"
                print(f"  {progress} {alert.mint[:12]}... -> NO DATA", file=sys.stderr)

    # Summary
    print()
    print("=" * 60)
    print("PER-TOKEN SLICE EXPORT COMPLETE")
    print("=" * 60)
    print(f"Date range:     {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}")
    print(f"Horizon:        {args.horizon}h (+ {args.pre_window}m pre-window)")
    print(f"Tokens:         {len(unique_alerts)} unique")
    print(f"Exported:       {exported} tokens, {total_candles:,} total candles")
    if skipped:
        print(f"Skipped:        {skipped} (already exist)")
    if no_data:
        print(f"No data:        {no_data} tokens (missing in ClickHouse)")
    print(f"Output dir:     {out_dir.absolute()}")
    
    # Quality summary
    print()
    print("-" * 40)
    print("QUALITY SUMMARY")
    print("-" * 40)
    if exported > 0:
        print(f"Tokens with GAPS:        {tokens_with_gaps:3} / {exported} ({tokens_with_gaps / exported * 100:.1f}%)")
        print(f"Tokens low coverage:     {tokens_low_coverage:3} / {exported} ({tokens_low_coverage / exported * 100:.1f}%)")
        print(f"Tokens high zero volume: {tokens_high_zero_volume:3} / {exported} ({tokens_high_zero_volume / exported * 100:.1f}%)")
        print(f"Total gaps:              {total_gaps:,}")
        
        # Quality assessment
        gap_rate = tokens_with_gaps / exported * 100
        if gap_rate > 50:
            print(f"\n⚠️  HIGH GAP RATE ({gap_rate:.1f}%) - check ClickHouse data quality")
        elif gap_rate > 20:
            print(f"\n⚠️  MODERATE GAP RATE ({gap_rate:.1f}%) - some tokens may need re-ingestion")
        else:
            print(f"\n✅ LOW GAP RATE ({gap_rate:.1f}%) - data quality is acceptable")
    print()

    # Write manifest
    manifest_path = out_dir / "manifest.txt"
    with open(manifest_path, "w") as f:
        f.write(f"# Per-token slices exported {datetime.now(UTC).isoformat()}\n")
        f.write(f"# Date range: {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}\n")
        f.write(f"# Horizon: {args.horizon}h, Pre-window: {args.pre_window}m\n")
        f.write(f"# Interval: {args.interval_seconds}s\n")
        f.write(f"# Tokens: {exported}\n")
        f.write(f"# Quality: gaps={tokens_with_gaps}, low_coverage={tokens_low_coverage}\n")
        f.write("#\n")
        for alert in sorted(unique_alerts, key=lambda a: a.trigger_ts_ms):
            alert_dt = ms_to_dt(alert.trigger_ts_ms)
            date_str = alert_dt.strftime("%Y%m%d_%H%M")
            filename = f"{date_str}_{safe_filename(alert.mint)}.parquet"
            caller = alert.caller_name or "unknown"
            f.write(f"{alert.mint}\t{alert_dt.isoformat()}\t{caller}\t{filename}\n")

    print(f"Manifest:       {manifest_path}")
    
    # Write quality report
    quality_report_path = out_dir / "quality_report.json"
    quality_report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "parameters": {
            "date_from": date_from.strftime('%Y-%m-%d'),
            "date_to": date_to.strftime('%Y-%m-%d'),
            "horizon_hours": args.horizon,
            "pre_window_minutes": args.pre_window,
            "interval_seconds": args.interval_seconds,
        },
        "summary": {
            "total_alerts": len(unique_alerts),
            "exported": exported,
            "skipped": skipped,
            "no_data": no_data,
            "total_candles": total_candles,
            "total_gaps": total_gaps,
            "tokens_with_gaps": tokens_with_gaps,
            "tokens_low_coverage": tokens_low_coverage,
            "tokens_high_zero_volume": tokens_high_zero_volume,
            "gap_rate_pct": round(tokens_with_gaps / exported * 100, 1) if exported > 0 else 0,
            "low_coverage_rate_pct": round(tokens_low_coverage / exported * 100, 1) if exported > 0 else 0,
        },
        "tokens": quality_results,
    }
    with open(quality_report_path, "w") as f:
        json.dump(quality_report, f, indent=2)
    
    print(f"Quality report: {quality_report_path}")


if __name__ == "__main__":
    main()

