#!/usr/bin/env python3
"""
Token-by-token slicer for a big Parquet candle slice.

Two modes:

1) partition (recommended):
   Writes a Hive-partitioned Parquet dataset:
     out_dir/token_address=<MINT>/data_*.parquet
   This is usually the fastest for DuckDB/parquet_scan predicate pushdown.

2) per-token:
   Writes one Parquet file per token:
     out_dir/<MINT>.parquet
   (Can create lots of files; use only if you really want 1 file per token.)

Examples:
  # Recommended: partitioned dataset
  python3 token_slicer.py --in slices/slice_abc.parquet --out slices/slice_abc_part --mode partition

  # One-file-per-token (parallel)
  python3 token_slicer.py --in slices/slice_abc.parquet --out slices/slice_abc_by_token --mode per-token --threads 16

  # Optional time filter
  python3 token_slicer.py --in slices/slice_abc.parquet --out out --mode partition \
    --from-ts "2025-05-01 00:00:00" --to-ts "2025-06-01 00:00:00"
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import duckdb


def _sql_escape(s: str) -> str:
    return s.replace("'", "''")


def _sanitize_filename(s: str) -> str:
    # Keep it filesystem-safe but still readable
    s = s.strip()
    s = re.sub(r"[^A-Za-z0-9._=-]+", "_", s)
    return s[:240] if len(s) > 240 else s


def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class TimeFilter:
    from_ts: Optional[str]  # "YYYY-MM-DD HH:MM:SS"
    to_ts: Optional[str]    # "YYYY-MM-DD HH:MM:SS"


def _build_where(tf: TimeFilter) -> str:
    clauses: List[str] = []
    if tf.from_ts:
        clauses.append(f"timestamp >= TIMESTAMP '{_sql_escape(tf.from_ts)}'")
    if tf.to_ts:
        clauses.append(f"timestamp <  TIMESTAMP '{_sql_escape(tf.to_ts)}'")
    return ("WHERE " + " AND ".join(clauses)) if clauses else ""


def partition_mode(
    con: duckdb.DuckDBPyConnection,
    in_path: Path,
    out_dir: Path,
    compression: str,
    tf: TimeFilter,
) -> None:
    _ensure_dir(out_dir)

    where_sql = _build_where(tf)

    # Note: ORDER BY helps write deterministic-ish files and can improve per-token locality.
    # DuckDB will still partition by token_address.
    sql = f"""
COPY (
  SELECT
    token_address,
    timestamp,
    open,
    high,
    low,
    close,
    volume
  FROM parquet_scan('{_sql_escape(in_path.as_posix())}')
  {where_sql}
  ORDER BY token_address, timestamp
)
TO '{_sql_escape(out_dir.as_posix())}'
(FORMAT PARQUET, PARTITION_BY (token_address), COMPRESSION '{_sql_escape(compression)}');
""".strip()

    con.execute(sql)


def _list_tokens(con: duckdb.DuckDBPyConnection, in_path: Path, tf: TimeFilter) -> List[Tuple[str, int]]:
    where_sql = _build_where(tf)
    sql = f"""
SELECT token_address, count(*)::BIGINT AS n
FROM parquet_scan('{_sql_escape(in_path.as_posix())}')
{where_sql}
GROUP BY token_address
ORDER BY n DESC;
""".strip()
    return [(r[0], int(r[1])) for r in con.execute(sql).fetchall()]


def per_token_mode(
    in_path: Path,
    out_dir: Path,
    threads: int,
    compression: str,
    tf: TimeFilter,
    min_rows: int,
    verbose: bool,
) -> None:
    _ensure_dir(out_dir)

    # Use one "planner" connection to list tokens (fast).
    con = duckdb.connect(":memory:")
    con.execute(f"PRAGMA threads={max(1, threads)}")
    tokens = _list_tokens(con, in_path, tf)
    con.close()

    if verbose:
        total = len(tokens)
        kept = sum(1 for _, n in tokens if n >= min_rows)
        print(f"[slicer] tokens: {total} (writing {kept} with n>={min_rows})", file=sys.stderr)

    where_sql = _build_where(tf)

    def _write_one(token: str, n: int) -> Tuple[str, int, str]:
        if n < min_rows:
            return (token, n, "skipped_small")

        # One connection per worker avoids contention.
        c = duckdb.connect(":memory:")
        c.execute("PRAGMA threads=1")

        safe_token = _sanitize_filename(token)
        out_path = out_dir / f"{safe_token}.parquet"

        sql = f"""
COPY (
  SELECT
    token_address,
    timestamp,
    open,
    high,
    low,
    close,
    volume
  FROM parquet_scan('{_sql_escape(in_path.as_posix())}')
  {where_sql}
  AND token_address = '{_sql_escape(token)}'
  ORDER BY timestamp
)
TO '{_sql_escape(out_path.as_posix())}'
(FORMAT PARQUET, COMPRESSION '{_sql_escape(compression)}');
""".strip()

        # If no where clause, we need WHERE not AND; easiest: patch query safely.
        if "WHERE" not in sql.split("FROM", 1)[1]:
            # Replace the first "\n  AND token_address" with "\n  WHERE token_address"
            sql = sql.replace("\n  AND token_address", "\n  WHERE token_address", 1)

        c.execute(sql)
        c.close()
        return (token, n, "ok")

    # Parallel write
    with cf.ThreadPoolExecutor(max_workers=max(1, threads)) as ex:
        futs = [ex.submit(_write_one, token, n) for token, n in tokens]
        done = 0
        for f in cf.as_completed(futs):
            token, n, status = f.result()
            done += 1
            if verbose and (done % 50 == 0 or done == len(futs)):
                print(f"[slicer] {done}/{len(futs)} done (last: {status} {token} n={n})", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description="Split a Parquet candle slice token-by-token.")
    ap.add_argument("--in", dest="in_path", required=True, help="Input Parquet slice file")
    ap.add_argument("--out", dest="out_path", required=True, help="Output directory")
    ap.add_argument("--mode", choices=["partition", "per-token"], default="partition")
    ap.add_argument("--threads", type=int, default=int(os.getenv("SLICE_THREADS", "8")))
    ap.add_argument("--compression", default=os.getenv("SLICE_COMPRESSION", "zstd"),
                    help="Parquet compression: zstd|snappy|gzip|uncompressed (depends on DuckDB build)")
    ap.add_argument("--from-ts", default=None, help="Optional lower bound timestamp (YYYY-MM-DD HH:MM:SS)")
    ap.add_argument("--to-ts", default=None, help="Optional upper bound timestamp (YYYY-MM-DD HH:MM:SS)")
    ap.add_argument("--min-rows", type=int, default=1, help="per-token mode: skip tokens with fewer rows than this")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    in_path = Path(args.in_path)
    out_dir = Path(args.out_path)

    if not in_path.exists():
        raise SystemExit(f"Input not found: {in_path}")

    tf = TimeFilter(from_ts=args.from_ts, to_ts=args.to_ts)

    if args.mode == "partition":
        con = duckdb.connect(":memory:")
        con.execute(f"PRAGMA threads={max(1, args.threads)}")
        if args.verbose:
            print(f"[slicer] mode=partition in={in_path} out={out_dir} threads={args.threads}", file=sys.stderr)
        partition_mode(con, in_path, out_dir, args.compression, tf)
        con.close()
        if args.verbose:
            print(f"[slicer] done: {out_dir}", file=sys.stderr)
    else:
        if args.verbose:
            print(f"[slicer] mode=per-token in={in_path} out={out_dir} threads={args.threads}", file=sys.stderr)
        per_token_mode(
            in_path=in_path,
            out_dir=out_dir,
            threads=args.threads,
            compression=args.compression,
            tf=tf,
            min_rows=args.min_rows,
            verbose=args.verbose,
        )
        if args.verbose:
            print(f"[slicer] done: {out_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()

