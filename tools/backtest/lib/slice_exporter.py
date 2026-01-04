"""
ClickHouse slice exporter.

Streams candle data from ClickHouse to Parquet with:
- Batched IN() queries to avoid query string explosions
- Streaming row iteration to avoid RAM exhaustion
- Batched DuckDB inserts for speed
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

import duckdb

from .helpers import batched, dt_to_ch, sql_escape

UTC = timezone.utc

# Optional import - may not be installed
try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    ClickHouseClient = None  # type: ignore


@dataclass(frozen=True)
class ClickHouseCfg:
    """ClickHouse connection configuration."""

    host: str
    port: int
    database: str
    table: str
    user: str
    password: str
    connect_timeout: int = 10
    send_receive_timeout: int = 300

    def get_client(self):
        """Create a ClickHouse client from this configuration."""
        if ClickHouseClient is None:
            raise SystemExit("clickhouse-driver not installed. Run: pip install clickhouse-driver")
        return ClickHouseClient(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            connect_timeout=self.connect_timeout,
            send_receive_timeout=self.send_receive_timeout,
        )


def query_coverage_batched(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    ch_batch: int = 1000,
) -> Dict[str, int]:
    """
    Query candle counts per token from ClickHouse.

    Uses batched IN() lists to avoid query string explosions.

    Args:
        cfg: ClickHouse configuration
        chain: Chain name
        mints: Set of mint addresses to check
        interval_seconds: Candle interval
        date_from: Start date
        date_to: End date (exclusive of next day)
        ch_batch: Max mints per IN() clause

    Returns:
        Dict mapping mint address to candle count
    """
    if not mints:
        return {}

    chain_q = sql_escape(chain)
    mints_list = sorted(mints)
    out: Dict[str, int] = {}

    client = cfg.get_client()
    for chunk in batched(mints_list, ch_batch):
        mint_list = ", ".join(f"'{sql_escape(m)}'" for m in chunk)
        sql = f"""
SELECT
  token_address,
  count() as candle_count
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(date_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(date_to + timedelta(days=1))}')
GROUP BY token_address
""".strip()
        rows = client.execute(sql)
        for token_address, candle_count in rows:
            out[str(token_address)] = int(candle_count)

    return out


def export_slice_streaming(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    output_path: Path,
    ch_batch: int = 1000,
    pre_window_minutes: int = 60,
    post_window_hours: int = 72,
    verbose: bool = False,
) -> int:
    """
    Stream candles from ClickHouse to a Parquet file.

    Uses streaming iteration and batched DuckDB inserts to avoid RAM exhaustion.

    IMPORTANT: date_to is treated as the start of that day (midnight).
    To include the full end day, we add 1 day before adding post_window_hours.

    Args:
        cfg: ClickHouse configuration
        chain: Chain name
        mints: Set of mint addresses to export
        interval_seconds: Candle interval
        date_from: Start date
        date_to: End date (inclusive - full day included)
        output_path: Path to output Parquet file
        ch_batch: Max mints per query
        pre_window_minutes: Minutes before date_from to include
        post_window_hours: Hours after date_to to include
        verbose: Print progress

    Returns:
        Number of rows exported
    """
    if not mints:
        return 0

    chain_q = sql_escape(chain)

    # Calculate time range
    expanded_from = date_from - timedelta(minutes=pre_window_minutes)
    # IMPORTANT: date_to is midnight-start; include the whole end day, then post window
    expanded_to = (date_to + timedelta(days=1)) + timedelta(hours=post_window_hours)

    client = cfg.get_client()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(":memory:")
    try:
        con.execute("""
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

        inserted = 0
        row_batch: List[Tuple[Any, ...]] = []
        row_batch_size = 50_000

        mints_list = sorted(mints)
        for chunk in batched(mints_list, ch_batch):
            mint_list = ", ".join(f"'{sql_escape(m)}'" for m in chunk)
            sql = f"""
SELECT
  token_address,
  timestamp,
  open,
  high,
  low,
  close,
  volume
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(expanded_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(expanded_to)}')
ORDER BY token_address, timestamp
""".strip()

            if verbose:
                print(f"[clickhouse] stream chunk tokens={len(chunk)} ...", file=sys.stderr)

            # execute_iter streams rows without collecting everything in memory
            for row in client.execute_iter(sql):
                row_batch.append(row)
                if len(row_batch) >= row_batch_size:
                    con.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", row_batch)
                    inserted += len(row_batch)
                    row_batch.clear()

        if row_batch:
            con.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", row_batch)
            inserted += len(row_batch)
            row_batch.clear()

        con.execute(f"COPY candles TO '{sql_escape(str(output_path))}' (FORMAT PARQUET, COMPRESSION 'zstd')")
        count = int(con.execute("SELECT count(*) FROM candles").fetchone()[0])

        if verbose:
            print(f"[clickhouse] inserted={inserted:,} parquet_rows={count:,} -> {output_path}", file=sys.stderr)

        return count
    finally:
        con.close()

