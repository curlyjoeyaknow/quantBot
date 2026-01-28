from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional, Tuple

import duckdb

from .spec import ArtifactTypeSpec

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()

def _build_select_sql(spec: ArtifactTypeSpec, parquet_path: Path) -> str:
    cols = []
    for c in spec.canonical_cols:
        if c in spec.casts:
            cols.append(f"{spec.casts[c].format(col=c)} AS {c}")
        else:
            cols.append(c)
    order = ", ".join(spec.sort_keys)
    proj = ", ".join(cols)
    return f"SELECT {proj} FROM read_parquet('{parquet_path.as_posix()}') ORDER BY {order}"

def content_hash_from_parquet(
    *,
    parquet_path: Path,
    spec: ArtifactTypeSpec,
    fetch_batch: int = 10_000,
    null_token: str = "\\N",
    delim: str = "|",
) -> Tuple[str, int, Optional[str], Optional[str]]:
    """
    Returns (content_hash, row_count, min_ts, max_ts).

    min_ts/max_ts are computed for the first matching time column in canonical_cols.
    For ISO-8601 strings, lexicographic order matches time order.
    """
    con = duckdb.connect(database=":memory:")
    sql = _build_select_sql(spec, parquet_path)
    cur = con.execute(sql)

    h = hashlib.sha256()
    row_count = 0
    min_ts = None
    max_ts = None

    # Prefer explicit event time columns first
    time_col = None
    for candidate in ("event_ts_utc", "alert_ts_utc", "alert_ts", "ts", "timestamp"):
        if candidate in spec.canonical_cols:
            time_col = candidate
            break

    time_idx = spec.canonical_cols.index(time_col) if time_col is not None else None

    while True:
        rows = cur.fetchmany(fetch_batch)
        if not rows:
            break
        for r in rows:
            row_count += 1

            if time_idx is not None:
                t = r[time_idx]
                if t is not None:
                    # Works for TIMESTAMP values or ISO strings
                    if min_ts is None or t < min_ts:
                        min_ts = t
                    if max_ts is None or t > max_ts:
                        max_ts = t

            parts = []
            for v in r:
                parts.append(null_token if v is None else str(v))
            h.update((delim.join(parts) + "\n").encode("utf-8"))

    con.close()
    return ("sha256:" + h.hexdigest(), row_count, min_ts, max_ts)
