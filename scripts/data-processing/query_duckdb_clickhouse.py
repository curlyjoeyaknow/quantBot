#!/usr/bin/env python3
"""
query_duckdb_clickhouse.py

Unified query interface for DuckDB and ClickHouse.

This script allows you to:
- Query both DuckDB and ClickHouse with the same interface
- Compare results between the two databases
- Sync data from ClickHouse to DuckDB
- Join data across both databases

Requirements:
  pip install duckdb clickhouse-connect pandas pyarrow

Env vars for ClickHouse:
  CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE

Usage examples:

# Query both and compare
python scripts/data-processing/query_duckdb_clickhouse.py compare \
  --mint So11111111111111111111111111111111111111112 \
  --tf 1m \
  --duckdb ./data/tele.duckdb \
  --ch-table ohlcv_candles \
  --ch-interval 1m

# Query DuckDB only
python scripts/data-processing/query_duckdb_clickhouse.py duck \
  --duckdb ./data/tele.duckdb \
  --query "SELECT COUNT(*) FROM ohlcv_candles_d"

# Query ClickHouse only
python scripts/data-processing/query_duckdb_clickhouse.py ch \
  --query "SELECT count() FROM ohlcv_candles WHERE interval = '1m'"

# Sync candles from ClickHouse to DuckDB
python scripts/data-processing/query_duckdb_clickhouse.py sync \
  --mint So11111111111111111111111111111111111111112 \
  --tf 1m \
  --duckdb ./data/tele.duckdb \
  --ch-table ohlcv_candles \
  --ch-interval 1m \
  --n 10000

# Join data across both (export from CH, query with DuckDB)
python scripts/data-processing/query_duckdb_clickhouse.py join \
  --mint So11111111111111111111111111111111111111112 \
  --duckdb ./data/tele.duckdb \
  --ch-table ohlcv_candles \
  --query "SELECT * FROM ch_candles JOIN duck_calls ON ch_candles.mint = duck_calls.mint"
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, List, Optional, Tuple

try:
    import pandas as pd
except ImportError:
    print("[fatal] pandas not installed. pip install pandas", file=sys.stderr)
    sys.exit(1)

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


def get_ch_client():
    """Create ClickHouse client from environment variables."""
    if clickhouse_connect is None:
        die("clickhouse-connect not installed. pip install clickhouse-connect")
    
    return clickhouse_connect.get_client(
        host=env("CLICKHOUSE_HOST"),
        port=int(os.getenv("CLICKHOUSE_PORT", "8123")),
        username=env("CLICKHOUSE_USER"),
        password=os.getenv("CLICKHOUSE_PASSWORD", ""),
        database=env("CLICKHOUSE_DATABASE"),
    )


def query_duckdb(duckdb_path: str, query: str) -> pd.DataFrame:
    """Execute a query on DuckDB."""
    if duckdb is None:
        die("duckdb not installed. pip install duckdb")
    
    con = duckdb.connect(duckdb_path)
    return con.execute(query).fetchdf()


def query_clickhouse(query: str, params: Optional[Dict] = None) -> pd.DataFrame:
    """Execute a query on ClickHouse."""
    client = get_ch_client()
    return client.query_df(query, parameters=params or {})


def compare_results(
    duckdb_path: str,
    duckdb_query: str,
    ch_query: str,
    ch_params: Optional[Dict] = None,
) -> None:
    """Compare results from DuckDB and ClickHouse."""
    print("[info] Querying DuckDB...")
    try:
        duck_df = query_duckdb(duckdb_path, duckdb_query)
        print(f"[ok] DuckDB: {len(duck_df)} rows")
    except Exception as e:
        print(f"[error] DuckDB query failed: {e}", file=sys.stderr)
        duck_df = None
    
    print("[info] Querying ClickHouse...")
    try:
        ch_df = query_clickhouse(ch_query, ch_params)
        print(f"[ok] ClickHouse: {len(ch_df)} rows")
    except Exception as e:
        print(f"[error] ClickHouse query failed: {e}", file=sys.stderr)
        ch_df = None
    
    if duck_df is None or ch_df is None:
        die("One or both queries failed")
    
    # Compare row counts
    print(f"\n[compare] Row counts:")
    print(f"  DuckDB:    {len(duck_df):,}")
    print(f"  ClickHouse: {len(ch_df):,}")
    print(f"  Difference: {abs(len(duck_df) - len(ch_df)):,}")
    
    # Compare schemas
    duck_cols = set(duck_df.columns)
    ch_cols = set(ch_df.columns)
    
    print(f"\n[compare] Columns:")
    print(f"  DuckDB:    {sorted(duck_cols)}")
    print(f"  ClickHouse: {sorted(ch_cols)}")
    
    common_cols = duck_cols & ch_cols
    if common_cols:
        print(f"  Common:    {sorted(common_cols)}")
    
    # Compare sample data if same columns
    if len(duck_df) > 0 and len(ch_df) > 0 and common_cols:
        print(f"\n[compare] Sample data (first row):")
        print(f"  DuckDB:")
        print(duck_df[list(common_cols)].head(1).to_string(index=False))
        print(f"  ClickHouse:")
        print(ch_df[list(common_cols)].head(1).to_string(index=False))


def sync_candles(
    duckdb_path: str,
    mint: str,
    tf: str,
    interval: str,
    ch_table: str,
    n: int,
    mint_col: str = "token_address",
    time_col: str = "timestamp",
    interval_col: str = "interval",
) -> None:
    """Sync candles from ClickHouse to DuckDB."""
    if duckdb is None:
        die("duckdb not installed. pip install duckdb")
    
    print(f"[info] Fetching {n} candles from ClickHouse...")
    
    # Query ClickHouse
    ch_query = f"""
    SELECT *
    FROM (
        SELECT *
        FROM {ch_table}
        WHERE {mint_col} = %(mint)s
          AND {interval_col} = %(interval)s
        ORDER BY {time_col} DESC
        LIMIT %(n)s
    )
    ORDER BY {time_col} ASC
    """
    
    ch_df = query_clickhouse(ch_query, {"mint": mint, "interval": interval, "n": n})
    
    if len(ch_df) == 0:
        die(f"No candles found for mint={mint}, interval={interval}")
    
    print(f"[ok] Fetched {len(ch_df)} candles from ClickHouse")
    
    # Insert into DuckDB
    con = duckdb.connect(duckdb_path)
    
    # Ensure table exists
    con.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_candles_d (
            mint TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            open DOUBLE NOT NULL,
            high DOUBLE NOT NULL,
            low DOUBLE NOT NULL,
            close DOUBLE NOT NULL,
            volume DOUBLE NOT NULL,
            interval_seconds INTEGER NOT NULL,
            source TEXT,
            PRIMARY KEY (mint, timestamp, interval_seconds)
        )
    """)
    
    # Convert timestamp if needed (ClickHouse DateTime -> Unix timestamp)
    if 'timestamp' in ch_df.columns and ch_df['timestamp'].dtype == 'object':
        # Assume it's a datetime string, convert to unix timestamp
        ch_df['timestamp_unix'] = pd.to_datetime(ch_df['timestamp']).astype('int64') // 10**9
    else:
        ch_df['timestamp_unix'] = ch_df[time_col] if time_col in ch_df.columns else ch_df['timestamp']
    
    # Map interval to seconds
    interval_map = {"1s": 1, "15s": 15, "1m": 60, "5m": 300}
    interval_seconds = interval_map.get(interval, 60)
    
    # Prepare data for insert
    insert_df = pd.DataFrame({
        'mint': [mint] * len(ch_df),
        'timestamp': ch_df['timestamp_unix'].astype(int),
        'open': ch_df['open'].astype(float),
        'high': ch_df['high'].astype(float),
        'low': ch_df['low'].astype(float),
        'close': ch_df['close'].astype(float),
        'volume': ch_df['volume'].astype(float),
        'interval_seconds': [interval_seconds] * len(ch_df),
        'source': ['clickhouse'] * len(ch_df),
    })
    
    # Register DataFrame and insert (upsert: delete existing, then insert)
    con.register("insert_df", insert_df)
    
    # DuckDB upsert pattern: delete existing rows, then insert new ones
    con.execute("""
        DELETE FROM ohlcv_candles_d
        WHERE EXISTS (
            SELECT 1 FROM insert_df
            WHERE ohlcv_candles_d.mint = insert_df.mint
              AND ohlcv_candles_d.timestamp = insert_df.timestamp
              AND ohlcv_candles_d.interval_seconds = insert_df.interval_seconds
        )
    """)
    
    con.execute("""
        INSERT INTO ohlcv_candles_d (mint, timestamp, open, high, low, close, volume, interval_seconds, source)
        SELECT mint, timestamp, open, high, low, close, volume, interval_seconds, source
        FROM insert_df
    """)
    
    print(f"[ok] Synced {len(ch_df)} candles to DuckDB")


def join_query(
    duckdb_path: str,
    mint: str,
    ch_table: str,
    ch_interval: str,
    query: str,
    n: int = 10000,
) -> None:
    """Join data from ClickHouse and DuckDB."""
    if duckdb is None:
        die("duckdb not installed. pip install duckdb")
    
    print(f"[info] Fetching data from ClickHouse...")
    
    # Fetch from ClickHouse
    ch_query = f"""
    SELECT *
    FROM (
        SELECT *
        FROM {ch_table}
        WHERE token_address = %(mint)s
          AND interval = %(interval)s
        ORDER BY timestamp DESC
        LIMIT %(n)s
    )
    ORDER BY timestamp ASC
    """
    
    ch_df = query_clickhouse(ch_query, {"mint": mint, "interval": ch_interval, "n": n})
    print(f"[ok] Fetched {len(ch_df)} rows from ClickHouse")
    
    # Create DuckDB connection and register ClickHouse data as view
    con = duckdb.connect(duckdb_path)
    con.register("ch_candles", ch_df)
    
    # Execute join query
    print(f"[info] Executing join query...")
    result = con.execute(query).fetchdf()
    
    print(f"\n[result] {len(result)} rows:")
    print(result.to_string(index=False))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="mode", required=True)
    
    # Compare mode
    p_compare = sub.add_parser("compare", help="Compare results from DuckDB and ClickHouse")
    p_compare.add_argument("--duckdb", required=True, help="DuckDB database path")
    p_compare.add_argument("--mint", required=True, help="Token mint address")
    p_compare.add_argument("--tf", default="1m", help="Timeframe: 1s|15s|1m|5m")
    p_compare.add_argument("--ch-table", default="ohlcv_candles", help="ClickHouse table name")
    p_compare.add_argument("--ch-interval", required=True, help="ClickHouse interval value")
    p_compare.add_argument("--n", type=int, default=10000, help="Number of rows to compare")
    
    # DuckDB query mode
    p_duck = sub.add_parser("duck", help="Query DuckDB only")
    p_duck.add_argument("--duckdb", required=True, help="DuckDB database path")
    p_duck.add_argument("--query", required=True, help="SQL query")
    p_duck.add_argument("--csv", action="store_true", help="Output as CSV")
    
    # ClickHouse query mode
    p_ch = sub.add_parser("ch", help="Query ClickHouse only")
    p_ch.add_argument("--query", required=True, help="SQL query")
    p_ch.add_argument("--csv", action="store_true", help="Output as CSV")
    
    # Sync mode
    p_sync = sub.add_parser("sync", help="Sync candles from ClickHouse to DuckDB")
    p_sync.add_argument("--duckdb", required=True, help="DuckDB database path")
    p_sync.add_argument("--mint", required=True, help="Token mint address")
    p_sync.add_argument("--tf", default="1m", help="Timeframe: 1s|15s|1m|5m")
    p_sync.add_argument("--ch-table", default="ohlcv_candles", help="ClickHouse table name")
    p_sync.add_argument("--ch-interval", required=True, help="ClickHouse interval value")
    p_sync.add_argument("--n", type=int, default=10000, help="Number of candles to sync")
    
    # Join mode
    p_join = sub.add_parser("join", help="Join data from ClickHouse and DuckDB")
    p_join.add_argument("--duckdb", required=True, help="DuckDB database path")
    p_join.add_argument("--mint", required=True, help="Token mint address")
    p_join.add_argument("--ch-table", default="ohlcv_candles", help="ClickHouse table name")
    p_join.add_argument("--ch-interval", required=True, help="ClickHouse interval value")
    p_join.add_argument("--query", required=True, help="Join SQL query (use ch_candles and duck tables)")
    p_join.add_argument("--n", type=int, default=10000, help="Number of rows from ClickHouse")
    
    args = ap.parse_args()
    
    if args.mode == "compare":
        # Build queries
        interval_map = {"1s": 1, "15s": 15, "1m": 60, "5m": 300}
        interval_seconds = interval_map.get(args.tf, 60)
        
        duckdb_query = f"""
        SELECT *
        FROM ohlcv_candles_d
        WHERE mint = '{args.mint}'
          AND interval_seconds = {interval_seconds}
        ORDER BY timestamp DESC
        LIMIT {args.n}
        """
        
        ch_query = f"""
        SELECT *
        FROM (
            SELECT *
            FROM {args.ch_table}
            WHERE token_address = %(mint)s
              AND interval = %(interval)s
            ORDER BY timestamp DESC
            LIMIT %(n)s
        )
        ORDER BY timestamp ASC
        """
        
        compare_results(
            duckdb_path=args.duckdb,
            duckdb_query=duckdb_query,
            ch_query=ch_query,
            ch_params={"mint": args.mint, "interval": args.ch_interval, "n": args.n},
        )
    
    elif args.mode == "duck":
        df = query_duckdb(args.duckdb, args.query)
        if args.csv:
            sys.stdout.write(df.to_csv(index=False))
        else:
            print(df.to_string(index=False))
    
    elif args.mode == "ch":
        df = query_clickhouse(args.query)
        if args.csv:
            sys.stdout.write(df.to_csv(index=False))
        else:
            print(df.to_string(index=False))
    
    elif args.mode == "sync":
        sync_candles(
            duckdb_path=args.duckdb,
            mint=args.mint,
            tf=args.tf,
            interval=args.ch_interval,
            ch_table=args.ch_table,
            n=args.n,
        )
    
    elif args.mode == "join":
        join_query(
            duckdb_path=args.duckdb,
            mint=args.mint,
            ch_table=args.ch_table,
            ch_interval=args.ch_interval,
            query=args.query,
            n=args.n,
        )
    
    else:
        die(f"Unknown mode: {args.mode}")


if __name__ == "__main__":
    main()

