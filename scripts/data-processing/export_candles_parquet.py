#!/usr/bin/env python3
"""
export_candles_parquet.py

Export candles from ClickHouse to Parquet files for local analysis with DuckDB.

Why this exists:
- ClickHouse is your source of truth for candles at scale
- Parquet is a portable, columnar, compressed snapshot format
- DuckDB can query Parquet directly without importing into a database
- Perfect for simulation slices: export once, query many times locally

Requirements:
  pip install clickhouse-connect pyarrow pandas

Env vars:
  CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE

Usage examples:

# Export 10k candles for a single mint, all timeframes
python scripts/data-processing/export_candles_parquet.py \
  --mint So11111111111111111111111111111111111111112 \
  --n 10000 \
  --table-1s ohlcv_candles \
  --table-15s ohlcv_candles \
  --table-1m ohlcv_candles \
  --table-5m ohlcv_candles \
  --interval-1s 1s \
  --interval-15s 15s \
  --interval-1m 1m \
  --interval-5m 5m \
  --out-dir ./slices/candles

# Export with chain filter
python scripts/data-processing/export_candles_parquet.py \
  --mint So11111111111111111111111111111111111111112 \
  --chain solana \
  --n 10000 \
  --out-dir ./slices/candles
"""

from __future__ import annotations

import argparse
import os
import pathlib
import sys
from typing import List, Optional

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

try:
    import clickhouse_connect
except ImportError:
    print("[fatal] clickhouse-connect not installed. pip install clickhouse-connect", file=sys.stderr)
    sys.exit(1)


def die(msg: str, code: int = 1) -> None:
    print(f"[fatal] {msg}", file=sys.stderr)
    raise SystemExit(code)


def env(name: str, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if not v:
        die(f"Missing env var {name}")
    return v


def ensure_dir(path: str) -> None:
    pathlib.Path(path).mkdir(parents=True, exist_ok=True)


def get_ch_client():
    """Create ClickHouse client from environment variables."""
    return clickhouse_connect.get_client(
        host=env("CLICKHOUSE_HOST"),
        port=int(os.getenv("CLICKHOUSE_PORT", "8123")),
        username=env("CLICKHOUSE_USER"),
        password=os.getenv("CLICKHOUSE_PASSWORD", ""),
        database=env("CLICKHOUSE_DATABASE"),
        # secure=True,  # enable if you're using TLS
    )


def export_candles_for_tf(
    client,
    table: str,
    mint: str,
    interval: str,
    n: int,
    chain: Optional[str],
    mint_col: str,
    time_col: str,
    out_path: pathlib.Path,
) -> int:
    """
    Export N candles for a specific timeframe, ordered oldest→newest.
    
    Strategy: Get newest N rows, then reorder ascending for sim consumption.
    """
    # Build WHERE clause
    where_parts = [f"{mint_col} = %(mint)s", f"interval = %(interval)s"]
    params: dict = {"mint": mint, "interval": interval}
    
    if chain:
        where_parts.append("chain = %(chain)s")
        params["chain"] = chain
    
    where_sql = " AND ".join(where_parts)
    
    # Get newest N, then reorder ascending
    sql = f"""
    SELECT *
    FROM (
        SELECT *
        FROM {table}
        WHERE {where_sql}
        ORDER BY {time_col} DESC
        LIMIT %(n)s
    )
    ORDER BY {time_col} ASC
    """
    params["n"] = n
    
    df = client.query_df(sql, parameters=params)
    
    if len(df) < n:
        print(f"[warn] tf={interval} got {len(df)} rows, requested {n} (table={table})", file=sys.stderr)
    
    if len(df) == 0:
        print(f"[warn] No candles found for tf={interval} (table={table})", file=sys.stderr)
        return 0
    
    # Write to Parquet
    table_arrow = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table_arrow, out_path, compression="zstd")
    
    return len(df)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Export candles from ClickHouse to Parquet files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--mint", required=True, help="Token mint address")
    ap.add_argument("--chain", default=None, help="Chain filter (optional, e.g. 'solana')")
    ap.add_argument("--n", type=int, default=10_000, help="Number of candles to export per timeframe (default: 10000)")
    ap.add_argument("--out-dir", default="./slices/candles", help="Output directory for Parquet files")
    ap.add_argument("--mint-col", default="token_address", help="Column name for mint (default: token_address)")
    ap.add_argument("--time-col", default="timestamp", help="Column name for time (default: timestamp)")
    ap.add_argument("--table-1s", default="ohlcv_candles", help="Table name for 1s candles (default: ohlcv_candles)")
    ap.add_argument("--table-15s", default="ohlcv_candles", help="Table name for 15s candles (default: ohlcv_candles)")
    ap.add_argument("--table-1m", default="ohlcv_candles", help="Table name for 1m candles (default: ohlcv_candles)")
    ap.add_argument("--table-5m", default="ohlcv_candles", help="Table name for 5m candles (default: ohlcv_candles)")
    ap.add_argument("--interval-1s", default="1s", help="Interval value for 1s candles (default: 1s)")
    ap.add_argument("--interval-15s", default="15s", help="Interval value for 15s candles (default: 15s)")
    ap.add_argument("--interval-1m", default="1m", help="Interval value for 1m candles (default: 1m)")
    ap.add_argument("--interval-5m", default="5m", help="Interval value for 5m candles (default: 5m)")
    
    args = ap.parse_args()
    
    # Setup output directory
    out_base = pathlib.Path(args.out_dir) / f"mint={args.mint}"
    if args.chain:
        out_base = out_base / f"chain={args.chain}"
    ensure_dir(str(out_base))
    
    # Connect to ClickHouse
    client = get_ch_client()
    
    # Export each timeframe
    tfs = [
        ("1s", args.table_1s, args.interval_1s),
        ("15s", args.table_15s, args.interval_15s),
        ("1m", args.table_1m, args.interval_1m),
        ("5m", args.table_5m, args.interval_5m),
    ]
    
    total_exported = 0
    for tf, table, interval in tfs:
        out_path = out_base / f"tf={tf}.parquet"
        
        try:
            count = export_candles_for_tf(
                client=client,
                table=table,
                mint=args.mint,
                interval=interval,
                n=args.n,
                chain=args.chain,
                mint_col=args.mint_col,
                time_col=args.time_col,
                out_path=out_path,
            )
            if count > 0:
                print(f"[ok] tf={tf}: {count} rows -> {out_path}")
                total_exported += count
            else:
                print(f"[skip] tf={tf}: no data (table={table}, interval={interval})")
        except Exception as e:
            print(f"[error] tf={tf}: {e}", file=sys.stderr)
            continue
    
    # Write metadata
    meta = out_base / "_export_meta.txt"
    meta.write_text(
        "\n".join(
            [
                f"mint={args.mint}",
                f"chain={args.chain or 'all'}",
                f"n_per_tf={args.n}",
                f"total_exported={total_exported}",
                f"table_1s={args.table_1s}",
                f"table_15s={args.table_15s}",
                f"table_1m={args.table_1m}",
                f"table_5m={args.table_5m}",
                f"interval_1s={args.interval_1s}",
                f"interval_15s={args.interval_15s}",
                f"interval_1m={args.interval_1m}",
                f"interval_5m={args.interval_5m}",
            ]
        )
        + "\n"
    )
    
    print(f"\n[done] Exported {total_exported} total candles to {out_base}")


if __name__ == "__main__":
    main()

