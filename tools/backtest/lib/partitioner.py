"""
Parquet slice partitioning.

Converts a single Parquet file to a Hive-partitioned dataset by token_address.
DuckDB can then use predicate pushdown to skip irrelevant partitions.
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb

from .helpers import sql_escape


def is_hive_partitioned(path: Path) -> bool:
    """
    Check if a path is a Hive-partitioned dataset.

    A Hive-partitioned directory contains subdirectories named like:
    token_address=<value>/

    Args:
        path: Path to check

    Returns:
        True if path is a Hive-partitioned directory
    """
    if not path.exists():
        return False

    if not path.is_dir():
        return False

    # Check for at least one partition directory
    for child in path.iterdir():
        if child.is_dir() and "=" in child.name:
            return True

    return False


def partition_slice(
    in_path: Path,
    out_dir: Path,
    threads: int = 8,
    compression: str = "zstd",
    verbose: bool = False,
) -> None:
    """
    Partition a Parquet file by token_address.

    Creates a Hive-partitioned dataset:
    out_dir/token_address=<mint>/data_0.parquet

    Args:
        in_path: Input Parquet file
        out_dir: Output directory for partitioned data
        threads: Number of DuckDB threads
        compression: Parquet compression (zstd, snappy, etc.)
        verbose: Print progress
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(":memory:")
    con.execute(f"PRAGMA threads={max(1, int(threads))}")

    sql = f"""
COPY (
  SELECT token_address, timestamp, open, high, low, close, volume
  FROM parquet_scan('{sql_escape(in_path.as_posix())}')
  ORDER BY token_address, timestamp
)
TO '{sql_escape(out_dir.as_posix())}'
(FORMAT PARQUET, PARTITION_BY (token_address), COMPRESSION '{sql_escape(compression)}');
""".strip()

    if verbose:
        print(f"[partition] {in_path} -> {out_dir}", file=sys.stderr)

    con.execute(sql)
    con.close()

    if verbose:
        num_dirs = len([d for d in out_dir.iterdir() if d.is_dir()])
        print(f"[partition] done: {num_dirs} token partitions", file=sys.stderr)


def ensure_partitioned(
    slice_path: Path,
    threads: int = 8,
    verbose: bool = False,
) -> tuple[Path, bool]:
    """
    Ensure a slice is partitioned.

    If the path is already a partitioned directory, returns it as-is.
    If it's a single file, partitions it and returns the new path.

    Args:
        slice_path: Path to slice (file or directory)
        threads: Number of threads for partitioning
        verbose: Print progress

    Returns:
        Tuple of (path, is_partitioned)
    """
    if is_hive_partitioned(slice_path):
        return slice_path, True

    if slice_path.is_dir():
        # Directory but not Hive partitioned - use as-is
        return slice_path, False

    if not slice_path.exists():
        raise FileNotFoundError(f"Slice not found: {slice_path}")

    # Single file - partition it
    part_path = slice_path.parent / f"{slice_path.stem}_part"

    if is_hive_partitioned(part_path):
        if verbose:
            print(f"[partition] reusing existing: {part_path}", file=sys.stderr)
        return part_path, True

    partition_slice(slice_path, part_path, threads=threads, verbose=verbose)
    return part_path, True

