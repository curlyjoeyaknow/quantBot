#!/usr/bin/env python3
"""
Re-export slices with improved quality (argMax deduplication + validation).

Reads tokens from existing slices and re-exports from ClickHouse with:
- argMax(volume) deduplication
- Quality validation
- Race condition fixes

Usage:
  python reexport_slices.py --from 2025-05-01 --to 2025-12-30 --horizon 48
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Set

# Add tools directory to path for shared imports
tools_dir = Path(__file__).resolve().parent.parent.parent
if str(tools_dir) not in sys.path:
    sys.path.insert(0, str(tools_dir))

# Load .env file for environment variables
try:
    from dotenv import load_dotenv
    env_path = tools_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv()
except ImportError:
    pass

import duckdb

from lib.slice_exporter import (
    ClickHouseCfg,
    export_slice_streaming_with_quality,
)
from lib.slice_quality import QualityMetrics

UTC = timezone.utc


def parse_date(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)


def get_tokens_from_existing_slices(slice_dir: Path) -> Set[str]:
    """Read unique tokens from existing parquet slices."""
    con = duckdb.connect(":memory:")
    pattern = str(slice_dir / "*.parquet")
    result = con.execute(f'''
        SELECT DISTINCT token_address
        FROM read_parquet("{pattern}")
    ''').fetchall()
    return {r[0] for r in result}


def main():
    ap = argparse.ArgumentParser(
        description="Re-export slices with improved quality"
    )
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")
    ap.add_argument("--horizon", type=int, default=48, help="Hours of data (default: 48)")
    ap.add_argument("--pre-window", type=int, default=60, help="Minutes before (default: 60)")
    ap.add_argument("--existing-dir", default="slices/per_token", help="Directory with existing slices")
    ap.add_argument("--out-dir", default="slices/per_token_v2", help="Output directory")
    ap.add_argument("--interval", type=int, default=60, help="Candle interval seconds (default: 60)")
    ap.add_argument("--chain", default="solana")
    
    # ClickHouse connection
    ap.add_argument("--ch-host", default=os.getenv("CH_HOST", os.getenv("CLICKHOUSE_HOST", "localhost")))
    ap.add_argument("--ch-port", type=int, default=int(os.getenv("CH_PORT", os.getenv("CLICKHOUSE_PORT", "19000"))))
    ap.add_argument("--ch-db", default=os.getenv("CH_DATABASE", os.getenv("CLICKHOUSE_DATABASE", "quantbot")))
    ap.add_argument("--ch-table", default=os.getenv("CH_TABLE", "ohlcv_candles"))
    ap.add_argument("--ch-user", default=os.getenv("CH_USER", os.getenv("CLICKHOUSE_USER", "default")))
    ap.add_argument("--ch-pass", default=os.getenv("CH_PASSWORD", os.getenv("CLICKHOUSE_PASSWORD", "")))
    
    ap.add_argument("--verbose", "-v", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    
    args = ap.parse_args()
    
    date_from = parse_date(args.date_from)
    date_to = parse_date(args.date_to)
    existing_dir = Path(args.existing_dir)
    out_dir = Path(args.out_dir)
    
    print(f"[1/4] Loading tokens from existing slices: {existing_dir}")
    tokens = get_tokens_from_existing_slices(existing_dir)
    print(f"      Found {len(tokens):,} unique tokens")
    
    if args.dry_run:
        print(f"\n[DRY RUN] Would export {len(tokens)} tokens to {out_dir}")
        print(f"  Date range: {date_from.date()} to {date_to.date()}")
        print(f"  Horizon: {args.horizon}h, Pre-window: {args.pre_window}m")
        return
    
    # Create ClickHouse config
    ch_cfg = ClickHouseCfg(
        host=args.ch_host,
        port=args.ch_port,
        database=args.ch_db,
        table=args.ch_table,
        user=args.ch_user,
        password=args.ch_pass,
    )
    
    print(f"\n[2/4] Connecting to ClickHouse: {args.ch_host}:{args.ch_port}")
    try:
        client = ch_cfg.get_client()
        result = client.execute("SELECT 1")
        print("      Connection: OK")
    except Exception as e:
        print(f"      Connection FAILED: {e}")
        sys.exit(1)
    
    # Export in one big slice with all tokens
    out_dir.mkdir(parents=True, exist_ok=True)
    slice_name = f"slice_{date_from.strftime('%Y%m%d')}_{date_to.strftime('%Y%m%d')}_v2.parquet"
    output_path = out_dir / slice_name
    
    print(f"\n[3/4] Exporting {len(tokens):,} tokens to {output_path}")
    print(f"      Date range: {date_from.date()} to {date_to.date()}")
    print(f"      Pre-window: {args.pre_window}min, Post-window: {args.horizon}h")
    print(f"      Using argMax(volume) deduplication + quality validation")
    
    result = export_slice_streaming_with_quality(
        cfg=ch_cfg,
        chain=args.chain,
        mints=tokens,
        interval_seconds=args.interval,
        date_from=date_from,
        date_to=date_to,
        output_path=output_path,
        pre_window_minutes=args.pre_window,
        post_window_hours=args.horizon,
        verbose=args.verbose,
        validate=True,
        deduplicate=True,
    )
    
    print(f"\n[4/4] Export complete!")
    print(f"      Rows: {result.row_count:,}")
    print(f"      Output: {result.output_path}")
    
    if result.quality:
        q = result.quality
        print(f"\n      Quality Report:")
        print(f"        Coverage: {q.coverage_pct:.1f}%")
        print(f"        Gaps: {q.gaps}")
        print(f"        Duplicates: {q.duplicates}")
        print(f"        Score: {q.quality_score:.1f}/100")
    
    # Save quality report
    report_path = out_dir / "quality_report.json"
    with open(report_path, "w") as f:
        json.dump({
            "output_path": str(output_path),
            "row_count": result.row_count,
            "tokens": len(tokens),
            "date_from": str(date_from.date()),
            "date_to": str(date_to.date()),
            "quality": result.quality.to_dict() if result.quality else None,
        }, f, indent=2)
    print(f"\n      Quality report: {report_path}")


if __name__ == "__main__":
    main()

