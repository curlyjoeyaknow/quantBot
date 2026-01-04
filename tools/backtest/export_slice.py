#!/usr/bin/env python3
"""
Export candle slice from ClickHouse to Parquet.

This creates the Parquet slice needed by the fast backtest scripts.
Can export for specific mints or all mints in a date range.

Usage:
  # Export slice for mints that have alerts in a date range
  python3 export_slice.py --from 2025-12-01 --to 2025-12-24 --duckdb data/alerts.duckdb

  # Export with custom output path
  python3 export_slice.py --from 2025-12-01 --to 2025-12-24 --out slices/my_slice.parquet

  # Export for specific mints from a file
  python3 export_slice.py --from 2025-12-01 --to 2025-12-24 --mints-file mints.txt

  # Export and partition in one step
  python3 export_slice.py --from 2025-12-01 --to 2025-12-24 --partition

  # With custom ClickHouse settings
  python3 export_slice.py --from 2025-12-01 --to 2025-12-24 \
    --ch-host clickhouse.example.com --ch-port 9000 --ch-pass secret
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import duckdb

try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)

UTC = timezone.utc


# =============================================================================
# Helpers
# =============================================================================

def parse_yyyy_mm_dd(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)


def dt_to_ch(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


def _sql_escape(s: str) -> str:
    return s.replace("'", "''")


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


def query_available_mints(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
) -> Dict[str, int]:
    """
    Query ClickHouse to get candle counts per token.
    Returns {mint: candle_count} for tokens with ANY candles.
    """
    if not mints:
        return {}

    chain_q = _sql_escape(chain)
    mint_list = ", ".join(f"'{_sql_escape(m)}'" for m in mints)

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

    client = cfg.get_client()
    result = client.execute(sql, with_column_types=True)
    rows_data, columns = result
    return {row[0]: int(row[1]) for row in rows_data}


def export_candles_to_parquet(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    output_path: Path,
    verbose: bool = False,
) -> int:
    """
    Export candles from ClickHouse to Parquet file.
    Returns number of rows exported.
    """
    if not mints:
        return 0

    chain_q = _sql_escape(chain)
    mint_list = ", ".join(f"'{_sql_escape(m)}'" for m in mints)

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
  AND timestamp >= toDateTime('{dt_to_ch(date_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(date_to + timedelta(days=1))}')
ORDER BY token_address, timestamp
""".strip()

    if verbose:
        print(f"[export] Querying ClickHouse for {len(mints)} mints...", file=sys.stderr)

    client = cfg.get_client()
    result = client.execute(sql, with_column_types=True)
    rows_data, columns = result

    if not rows_data:
        if verbose:
            print(f"[export] No candles found", file=sys.stderr)
        return 0

    if verbose:
        print(f"[export] Got {len(rows_data):,} candles, writing to Parquet...", file=sys.stderr)

    output_path.parent.mkdir(parents=True, exist_ok=True)

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

    # Insert data in batches
    batch_size = 50000
    for i in range(0, len(rows_data), batch_size):
        batch = rows_data[i:i + batch_size]
        conn.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", batch)
        if verbose and (i + batch_size) % 200000 == 0:
            print(f"[export] Inserted {min(i + batch_size, len(rows_data)):,} / {len(rows_data):,} rows", file=sys.stderr)

    conn.execute(f"COPY candles TO '{output_path}' (FORMAT PARQUET, COMPRESSION 'zstd')")
    count = conn.execute("SELECT count(*) FROM candles").fetchone()[0]
    conn.close()

    if verbose:
        size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"[export] Written {count:,} candles to {output_path} ({size_mb:.1f} MB)", file=sys.stderr)

    return count


def partition_slice(
    in_path: Path,
    out_dir: Path,
    threads: int = 8,
    verbose: bool = False,
) -> None:
    """Partition a Parquet slice by token_address."""
    out_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect(":memory:")
    con.execute(f"PRAGMA threads={threads}")

    sql = f"""
COPY (
  SELECT token_address, timestamp, open, high, low, close, volume
  FROM parquet_scan('{_sql_escape(in_path.as_posix())}')
  ORDER BY token_address, timestamp
)
TO '{_sql_escape(out_dir.as_posix())}'
(FORMAT PARQUET, PARTITION_BY (token_address), COMPRESSION 'zstd');
""".strip()

    if verbose:
        print(f"[partition] {in_path} -> {out_dir}", file=sys.stderr)

    con.execute(sql)
    con.close()

    if verbose:
        num_dirs = len([d for d in out_dir.iterdir() if d.is_dir()])
        print(f"[partition] Done: {num_dirs} token partitions", file=sys.stderr)


# =============================================================================
# Alert Loading (to get mints)
# =============================================================================

def duckdb_table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    q = "SELECT COUNT(*)::INT FROM information_schema.tables WHERE table_name = ?"
    return conn.execute(q, [table_name]).fetchone()[0] > 0


def load_mints_from_alerts(
    duckdb_path: str,
    chain: str,
    date_from: datetime,
    date_to: datetime,
) -> Set[str]:
    """Load unique mints from alerts in the date range."""
    conn = duckdb.connect(duckdb_path, read_only=True)
    from_ms = int(date_from.timestamp() * 1000)
    to_ms_excl = int((date_to + timedelta(days=1)).timestamp() * 1000)

    mints: Set[str] = set()

    # Try caller_links_d
    if duckdb_table_exists(conn, "caller_links_d"):
        cols = [r[1].lower() for r in conn.execute("PRAGMA table_info('caller_links_d')").fetchall()]
        has_chain = "chain" in cols

        sql = """
        SELECT DISTINCT mint::TEXT
        FROM caller_links_d
        WHERE mint IS NOT NULL
          AND trigger_ts_ms >= ?
          AND trigger_ts_ms < ?
        """
        params: List[Any] = [from_ms, to_ms_excl]
        if has_chain:
            sql += " AND lower(chain) = lower(?)"
            params.append(chain)

        for (mint,) in conn.execute(sql, params).fetchall():
            if mint:
                mints.add(mint)

    # Fallback to user_calls_d
    if not mints and duckdb_table_exists(conn, "user_calls_d"):
        cols = [r[1].lower() for r in conn.execute("PRAGMA table_info('user_calls_d')").fetchall()]
        has_chain = "chain" in cols
        ts_col = "call_ts_ms" if "call_ts_ms" in cols else ("trigger_ts_ms" if "trigger_ts_ms" in cols else None)

        if ts_col:
            sql = f"""
            SELECT DISTINCT mint::TEXT
            FROM user_calls_d
            WHERE mint IS NOT NULL
              AND {ts_col} >= ?
              AND {ts_col} < ?
            """
            params = [from_ms, to_ms_excl]
            if has_chain:
                sql += " AND lower(chain) = lower(?)"
                params.append(chain)

            for (mint,) in conn.execute(sql, params).fetchall():
                if mint:
                    mints.add(mint)

    # Fallback to core schema
    if not mints:
        try:
            sql = """
            SELECT DISTINCT am.mint::TEXT
            FROM core.alert_mints_f am
            JOIN core.alerts_d a USING (source_system, chat_id, message_id)
            WHERE am.mint IS NOT NULL
              AND a.alert_ts_ms >= ?
              AND a.alert_ts_ms < ?
            """
            for (mint,) in conn.execute(sql, [from_ms, to_ms_excl]).fetchall():
                if mint:
                    mints.add(mint)
        except Exception:
            pass

    conn.close()
    return mints


def load_mints_from_file(path: str) -> Set[str]:
    """Load mints from a text file (one per line)."""
    mints = set()
    with open(path) as f:
        for line in f:
            mint = line.strip()
            if mint and not mint.startswith("#"):
                mints.add(mint)
    return mints


# =============================================================================
# Main
# =============================================================================

def main() -> None:
    ap = argparse.ArgumentParser(description="Export candle slice from ClickHouse to Parquet")

    # Date range
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")

    # Mint sources
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "../../data/alerts.duckdb"),
                    help="DuckDB path to load alert mints from (relative to script dir or absolute)")
    ap.add_argument("--mints-file", help="File with mints (one per line), overrides --duckdb")
    ap.add_argument("--chain", default="solana", help="Chain to filter by")

    # Candle settings
    ap.add_argument("--interval-seconds", type=int, choices=[60, 300], default=60)
    ap.add_argument("--horizon-hours", type=int, default=48,
                    help="Hours of data to fetch after each alert time")

    # Output
    ap.add_argument("--out", help="Output Parquet file path (auto-generated if not specified)")
    ap.add_argument("--out-dir", default="slices", help="Directory for auto-generated output")
    ap.add_argument("--partition", action="store_true",
                    help="Also create partitioned version of the slice")

    # ClickHouse connection
    ap.add_argument("--ch-host", default=os.getenv("CLICKHOUSE_HOST", os.getenv("CH_HOST", "localhost")))
    ap.add_argument("--ch-port", type=int, default=int(os.getenv("CLICKHOUSE_PORT", os.getenv("CH_PORT", "19000"))))
    ap.add_argument("--ch-db", default=os.getenv("CLICKHOUSE_DATABASE", os.getenv("CH_DB", "quantbot")))
    ap.add_argument("--ch-table", default=os.getenv("CH_TABLE", "ohlcv_candles"))
    ap.add_argument("--ch-user", default=os.getenv("CLICKHOUSE_USER", os.getenv("CH_USER", "default")))
    ap.add_argument("--ch-pass", default=os.getenv("CLICKHOUSE_PASSWORD", os.getenv("CH_PASS", "")))
    ap.add_argument("--ch-connect-timeout", type=int, default=10)
    ap.add_argument("--ch-timeout-s", type=int, default=300)

    # Other
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--verbose", "-v", action="store_true")

    args = ap.parse_args()

    date_from = parse_yyyy_mm_dd(args.date_from)
    date_to = parse_yyyy_mm_dd(args.date_to)
    verbose = args.verbose

    # Step 1: Get mints
    if args.mints_file:
        if verbose:
            print(f"[1/3] Loading mints from {args.mints_file}...", file=sys.stderr)
        mints = load_mints_from_file(args.mints_file)
    else:
        if verbose:
            print(f"[1/3] Loading mints from alerts in {args.duckdb}...", file=sys.stderr)
        mints = load_mints_from_alerts(args.duckdb, args.chain, date_from, date_to)

    if not mints:
        raise SystemExit("No mints found. Check your date range or provide --mints-file.")

    if verbose:
        print(f"      Found {len(mints)} unique mints", file=sys.stderr)

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

    # Check coverage
    if verbose:
        print(f"[2/3] Checking ClickHouse coverage...", file=sys.stderr)

    coverage = query_available_mints(
        ch_cfg, args.chain, mints, args.interval_seconds, date_from, date_to
    )

    covered_mints = set(coverage.keys())
    missing_mints = mints - covered_mints

    if verbose:
        total_candles = sum(coverage.values())
        print(f"      Covered: {len(covered_mints)} mints, {total_candles:,} total candles", file=sys.stderr)
        if missing_mints:
            print(f"      Missing: {len(missing_mints)} mints (no candles in ClickHouse)", file=sys.stderr)

    if not covered_mints:
        raise SystemExit("No mints have candle data in ClickHouse for this date range.")

    # Step 3: Export to Parquet
    if args.out:
        output_path = Path(args.out)
    else:
        # Generate filename based on params
        slice_hash = hashlib.md5(
            f"{args.chain}:{date_from}:{date_to}:{args.interval_seconds}:{sorted(covered_mints)}".encode()
        ).hexdigest()[:12]
        output_path = Path(args.out_dir) / f"slice_{slice_hash}.parquet"

    if verbose:
        print(f"[3/3] Exporting candles to {output_path}...", file=sys.stderr)

    count = export_candles_to_parquet(
        cfg=ch_cfg,
        chain=args.chain,
        mints=covered_mints,
        interval_seconds=args.interval_seconds,
        date_from=date_from,
        date_to=date_to,
        output_path=output_path,
        verbose=verbose,
    )

    if count == 0:
        raise SystemExit("No candles exported. Check your ClickHouse connection and data.")

    # Optional: Partition
    if args.partition:
        partition_dir = output_path.parent / f"{output_path.stem}_part"
        if verbose:
            print(f"[bonus] Partitioning slice...", file=sys.stderr)
        partition_slice(output_path, partition_dir, args.threads, verbose=verbose)

    # Summary
    print()
    print("=" * 60)
    print("SLICE EXPORT COMPLETE")
    print("=" * 60)
    print(f"Date range:    {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}")
    print(f"Mints:         {len(covered_mints)} (of {len(mints)} requested)")
    print(f"Candles:       {count:,}")
    print(f"Output:        {output_path}")
    if args.partition:
        print(f"Partitioned:   {partition_dir}")
    print()
    print("Next step: Run the fast backtest:")
    print(f"  python3 tools/backtest/run_fast_backtest.py \\")
    print(f"    --from {args.date_from} --to {args.date_to} \\")
    if args.partition:
        print(f"    --slice {partition_dir}/ --no-partition")
    else:
        print(f"    --slice {output_path}")


if __name__ == "__main__":
    main()

