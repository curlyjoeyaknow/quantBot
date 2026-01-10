#!/usr/bin/env python3
"""
candles_query.py

Query candles from DuckDB (Parquet) or ClickHouse with a consistent interface.

This script provides a unified way to query candles from either:
- DuckDB: Reads Parquet files directly (no import needed)
- ClickHouse: Queries your production database

Assumptions:
- You have separate tables/views for 1s, 15s, 1m, 5m candles (or filter by interval column)
- Each table has: token_address (or mint), timestamp, interval, open, high, low, close, volume
- You want >= 10,000 candles per timeframe by default

Requirements:
  pip install duckdb clickhouse-connect pandas

Env vars for ClickHouse:
  CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE

Usage examples:

# ClickHouse: fetch 10k 1m candles for a mint
python scripts/data-processing/candles_query.py ch \
  --mint So11111111111111111111111111111111111111112 \
  --tf 1m \
  --n 10000 \
  --table ohlcv_candles \
  --interval 1m

# DuckDB: query Parquet files
python scripts/data-processing/candles_query.py duck \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --tf 1m

# Quick check counts for all tfs
python scripts/data-processing/candles_query.py ch \
  --mint So11111111111111111111111111111111111111112 \
  --counts \
  --table ohlcv_candles

# Output as CSV
python scripts/data-processing/candles_query.py ch \
  --mint So11111111111111111111111111111111111111112 \
  --tf 5m \
  --csv > out.csv
"""

from __future__ import annotations

import argparse
import os
import pathlib
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

try:
    import pandas as pd
except ImportError:
    print("[fatal] pandas not installed. pip install pandas", file=sys.stderr)
    sys.exit(1)

# Optional imports (only needed per mode)
try:
    import duckdb
except ImportError:
    duckdb = None

try:
    import clickhouse_connect
except ImportError:
    clickhouse_connect = None


def die(msg: str, code: int = 1) -> None:
    print(f"[fatal] {msg}", file=sys.stderr)
    raise SystemExit(code)


def env(name: str, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if v is None or v == "":
        die(f"Missing env var {name}")
    return v


def normalize_tf(tf: str) -> str:
    tf = tf.lower().strip()
    if tf in ("1s", "15s", "1m", "5m"):
        return tf
    die(f"Unsupported tf: {tf} (expected 1s|15s|1m|5m)")
    return tf


def infer_timecol(time_col: Optional[str]) -> str:
    return time_col or "timestamp"


def build_candles_sql_ch(
    table: str,
    mint_col: str,
    time_col: str,
    interval_col: str,
    mint: str,
    interval: str,
    n: int,
    chain: Optional[str],
    columns: List[str],
) -> Tuple[str, Dict]:
    """Build ClickHouse SQL query."""
    cols = ", ".join(columns)
    
    where_parts = [
        f"{mint_col} = %(mint)s",
        f"{interval_col} = %(interval)s",
    ]
    params: Dict = {"mint": mint, "interval": interval, "n": n}
    
    if chain:
        where_parts.append("chain = %(chain)s")
        params["chain"] = chain
    
    where_sql = " AND ".join(where_parts)
    
    # Get newest N, then reorder ascending
    sql = f"""
    SELECT {cols}
    FROM (
        SELECT {cols}
        FROM {table}
        WHERE {where_sql}
        ORDER BY {time_col} DESC
        LIMIT %(n)s
    )
    ORDER BY {time_col} ASC
    """
    
    return sql, params


def build_counts_sql_ch(
    table: str,
    mint_col: str,
    interval_col: str,
    mint: str,
    interval: str,
    chain: Optional[str],
) -> Tuple[str, Dict]:
    """Build ClickHouse count query."""
    where_parts = [
        f"{mint_col} = %(mint)s",
        f"{interval_col} = %(interval)s",
    ]
    params: Dict = {"mint": mint, "interval": interval}
    
    if chain:
        where_parts.append("chain = %(chain)s")
        params["chain"] = chain
    
    where_sql = " AND ".join(where_parts)
    sql = f"SELECT count() AS c FROM {table} WHERE {where_sql}"
    
    return sql, params


def build_candles_sql_duck(
    table: str,
    mint_col: str,
    time_col: str,
    interval_col: str,
    mint: str,
    interval: str,
    n: int,
    chain: Optional[str],
    columns: List[str],
) -> Tuple[str, List]:
    """Build DuckDB SQL query."""
    cols = ", ".join(columns)
    
    where_parts = [f"{mint_col} = ?", f"{interval_col} = ?"]
    params: List = [mint, interval]
    
    if chain:
        where_parts.append("chain = ?")
        params.append(chain)
    
    where_sql = " AND ".join(where_parts)
    
    sql = f"""
    SELECT {cols}
    FROM (
        SELECT {cols}
        FROM {table}
        WHERE {where_sql}
        ORDER BY {time_col} DESC
        LIMIT ?
    )
    ORDER BY {time_col} ASC
    """
    params.append(n)
    
    return sql, params


def build_counts_sql_duck(
    table: str,
    mint_col: str,
    interval_col: str,
    mint: str,
    interval: str,
    chain: Optional[str],
) -> Tuple[str, List]:
    """Build DuckDB count query."""
    where_parts = [f"{mint_col} = ?", f"{interval_col} = ?"]
    params: List = [mint, interval]
    
    if chain:
        where_parts.append("chain = ?")
        params.append(chain)
    
    where_sql = " AND ".join(where_parts)
    sql = f"SELECT COUNT(*) AS c FROM {table} WHERE {where_sql}"
    
    return sql, params


def require_min(df: pd.DataFrame, n_min: int, tf: str, source: str) -> None:
    got = len(df)
    if got < n_min:
        die(f"Not enough candles for tf={tf} (got {got}, need >= {n_min}) from {source}")


def print_df(df: pd.DataFrame, as_csv: bool) -> None:
    if as_csv:
        sys.stdout.write(df.to_csv(index=False))
    else:
        print(df.to_string(index=False))


def query_duck_parquet(
    slice_dir: str,
    mint: str,
    tf: str,
    n: int,
    n_min: int,
    chain: Optional[str],
    columns: List[str],
    counts_only: bool,
    as_csv: bool,
) -> None:
    """Query Parquet files with DuckDB."""
    if duckdb is None:
        die("duckdb not installed. pip install duckdb")
    
    # Find Parquet file
    base = pathlib.Path(slice_dir)
    if chain:
        parquet_path = base / f"mint={mint}" / f"chain={chain}" / f"tf={tf}.parquet"
    else:
        parquet_path = base / f"mint={mint}" / f"tf={tf}.parquet"
    
    if not parquet_path.exists():
        die(f"Parquet file not found: {parquet_path}")
    
    con = duckdb.connect()
    
    # Create view from Parquet
    view_name = "candles"
    con.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet(?);", [str(parquet_path)])
    
    if counts_only:
        df = con.execute(f"SELECT COUNT(*) AS c FROM {view_name}").fetchdf()
        count = int(df.iloc[0]["c"])
        print(f"tf={tf}: {count} rows")
        return
    
    # Get N rows
    sql = f"""
    SELECT *
    FROM (
        SELECT *
        FROM {view_name}
        ORDER BY timestamp DESC
        LIMIT ?
    )
    ORDER BY timestamp ASC
    """
    df = con.execute(sql, [n]).fetchdf()
    
    # Filter columns if specified
    if columns and set(columns) != set(df.columns):
        df = df[columns]
    
    require_min(df, n_min, tf, f"Parquet {parquet_path}")
    print_df(df, as_csv)


def query_ch(
    table: str,
    mint: str,
    tf: str,
    interval: str,
    n: int,
    n_min: int,
    chain: Optional[str],
    mint_col: str,
    time_col: str,
    interval_col: str,
    columns: List[str],
    counts_only: bool,
    as_csv: bool,
) -> None:
    """Query ClickHouse."""
    if clickhouse_connect is None:
        die("clickhouse-connect not installed. pip install clickhouse-connect")
    
    client = clickhouse_connect.get_client(
        host=env("CLICKHOUSE_HOST"),
        port=int(os.getenv("CLICKHOUSE_PORT", "8123")),
        username=env("CLICKHOUSE_USER"),
        password=os.getenv("CLICKHOUSE_PASSWORD", ""),
        database=env("CLICKHOUSE_DATABASE"),
    )
    
    if counts_only:
        sql, params = build_counts_sql_ch(table, mint_col, interval_col, mint, interval, chain)
        df = client.query_df(sql, parameters=params)
        count = int(df.iloc[0]["c"])
        print(f"tf={tf}: {count} rows")
        return
    
    sql, params = build_candles_sql_ch(
        table, mint_col, time_col, interval_col, mint, interval, n, chain, columns
    )
    df = client.query_df(sql, parameters=params)
    require_min(df, n_min, tf, f"ClickHouse {table}")
    print_df(df, as_csv)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="mode", required=True, help="Query mode: 'ch' for ClickHouse, 'duck' for DuckDB/Parquet")
    
    def add_common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--mint", required=True, help="Token mint address")
        p.add_argument("--tf", default="1m", help="Timeframe: 1s|15s|1m|5m")
        p.add_argument("--n", type=int, default=10_000, help="How many candles to return (exact)")
        p.add_argument("--min", dest="n_min", type=int, default=10_000, help="Minimum required candles (must be <= n)")
        p.add_argument("--mint-col", default="token_address", help="Column name for mint")
        p.add_argument("--time-col", default="timestamp", help="Column name for time")
        p.add_argument("--interval-col", default="interval", help="Column name for interval")
        p.add_argument("--chain", default=None, help="Chain filter (optional)")
        p.add_argument("--csv", action="store_true", help="Output CSV to stdout")
        p.add_argument("--counts", action="store_true", help="Print counts for all tfs instead of candles")
        p.add_argument(
            "--cols",
            default=None,
            help="Comma-separated columns (default: all columns)",
        )
    
    pch = sub.add_parser("ch", help="Query ClickHouse")
    add_common(pch)
    pch.add_argument("--table", required=True, help="ClickHouse table name")
    pch.add_argument("--interval", required=True, help="Interval value (e.g. '1s', '1m', '15s', '5m')")
    
    pduck = sub.add_parser("duck", help="Query DuckDB/Parquet")
    add_common(pduck)
    pduck.add_argument("--slice-dir", required=True, help="Directory containing Parquet slices")
    
    args = ap.parse_args()
    
    tf = normalize_tf(args.tf)
    if args.n_min > args.n:
        die(f"--min ({args.n_min}) cannot be greater than --n ({args.n})")
    
    cols = (
        [c.strip() for c in args.cols.split(",") if c.strip()]
        if args.cols
        else None  # None means all columns
    )
    
    if args.mode == "duck":
        if args.counts:
            # Count all timeframes
            for tfi in ["1s", "15s", "1m", "5m"]:
                try:
                    query_duck_parquet(
                        slice_dir=args.slice_dir,
                        mint=args.mint,
                        tf=tfi,
                        n=args.n,
                        n_min=args.n_min,
                        chain=args.chain,
                        columns=cols or [],
                        counts_only=True,
                        as_csv=args.csv,
                    )
                except SystemExit:
                    continue
                except Exception as e:
                    print(f"[error] tf={tfi}: {e}", file=sys.stderr)
                    continue
        else:
            query_duck_parquet(
                slice_dir=args.slice_dir,
                mint=args.mint,
                tf=tf,
                n=args.n,
                n_min=args.n_min,
                chain=args.chain,
                columns=cols or [],
                counts_only=False,
                as_csv=args.csv,
            )
        return
    
    if args.mode == "ch":
        if args.counts:
            # Count all timeframes
            intervals = {"1s": "1s", "15s": "15s", "1m": "1m", "5m": "5m"}
            for tfi, interval_val in intervals.items():
                try:
                    query_ch(
                        table=args.table,
                        mint=args.mint,
                        tf=tfi,
                        interval=interval_val,
                        n=args.n,
                        n_min=args.n_min,
                        chain=args.chain,
                        mint_col=args.mint_col,
                        time_col=infer_timecol(args.time_col),
                        interval_col=args.interval_col,
                        columns=cols or ["*"],
                        counts_only=True,
                        as_csv=args.csv,
                    )
                except SystemExit:
                    continue
                except Exception as e:
                    print(f"[error] tf={tfi}: {e}", file=sys.stderr)
                    continue
        else:
            query_ch(
                table=args.table,
                mint=args.mint,
                tf=tf,
                interval=args.interval,
                n=args.n,
                n_min=args.n_min,
                chain=args.chain,
                mint_col=args.mint_col,
                time_col=infer_timecol(args.time_col),
                interval_col=args.interval_col,
                columns=cols or ["*"],
                counts_only=False,
                as_csv=args.csv,
            )
        return
    
    die("unreachable")


if __name__ == "__main__":
    main()

