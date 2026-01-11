"""
Common helpers used across backtest modules.
"""

from __future__ import annotations

import csv
import hashlib
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Set

UTC = timezone.utc


def parse_yyyy_mm_dd(s: str) -> datetime:
    """Parse YYYY-MM-DD string to UTC datetime."""
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)


def ceil_ms_to_interval_ts_ms(ts_ms: int, interval_seconds: int) -> int:
    """Round timestamp up to the next interval boundary."""
    step = interval_seconds * 1000
    return ((ts_ms + step - 1) // step) * step


def compute_slice_fingerprint(
    mints: Set[str],
    chain: str,
    date_from: datetime,
    date_to: datetime,
    interval_seconds: int,
) -> str:
    """Compute a short hash fingerprint for a slice based on its parameters."""
    sorted_mints = sorted(mints)
    data = f"{chain}|{date_from.isoformat()}|{date_to.isoformat()}|{interval_seconds}|{','.join(sorted_mints)}"
    return hashlib.sha256(data.encode()).hexdigest()[:16]


def sql_escape(s: str) -> str:
    """Escape single quotes for SQL strings."""
    return s.replace("'", "''")


def dt_to_ch(dt: datetime) -> str:
    """Format datetime for ClickHouse queries."""
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


def batched(xs: List[str], n: int) -> Iterator[List[str]]:
    """Yield successive n-sized chunks from xs."""
    for i in range(0, len(xs), n):
        yield xs[i : i + n]


def parse_utc_ts(s: str) -> datetime:
    """Parse stored output format '%Y-%m-%d %H:%M:%S' as UTC datetime."""
    if not s:
        return datetime(1970, 1, 1, tzinfo=UTC)
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)


def write_csv(path: str, fieldnames: List[str], rows: List[Dict[str, Any]]) -> None:
    """Write rows to CSV file, creating parent directories as needed."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def fmt_value(x: Any, kind: str = "num") -> str:
    """Format a value for display."""
    if x is None:
        return "-"
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return "-"
    if kind == "pct":
        return f"{x:6.2f}%"
    if kind == "x":
        return f"{x:6.2f}x"
    if kind == "int":
        return f"{int(x):6d}"
    if kind == "hrs":
        return f"{x:6.2f}h"
    if kind == "num":
        return f"{x:8.4f}"
    return str(x)


def pct(x: float) -> float:
    """Convert ratio to percentage."""
    return 100.0 * x

