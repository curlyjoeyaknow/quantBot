from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List

try:
    from clickhouse_connect import get_client
    CLICKHOUSE_AVAILABLE = True
except ImportError:
    CLICKHOUSE_AVAILABLE = False

from ..db import conn
from .sim_engine import simulate_token
from .sim_types import Candle

def load_strategy(strategy_id: str) -> Dict[str, Any]:
    row = conn.execute("SELECT json FROM strategies WHERE id = ?", [strategy_id]).fetchone()
    if not row:
        raise ValueError(f"strategy not found: {strategy_id}")
    return json.loads(row[0])

def load_filter(filter_id: str) -> Dict[str, Any]:
    row = conn.execute("SELECT json FROM filters WHERE id = ?", [filter_id]).fetchone()
    if not row:
        raise ValueError(f"filter not found: {filter_id}")
    return json.loads(row[0])

def _interval_seconds_to_string(interval_seconds: int) -> str:
    """Convert interval in seconds to ClickHouse interval string format."""
    interval_map = {
        15: '15s',
        60: '1m',
        300: '5m',
        900: '15m',
        3600: '1h',
        14400: '4h',
        86400: '1d',
    }
    return interval_map.get(interval_seconds, f'{interval_seconds}s')


def load_candles_for_token(token: str, interval_seconds: int, from_ts: str, to_ts: str) -> List[Candle]:
    """
    Load OHLCV candles from ClickHouse for a token.
    
    Uses ClickHouse connection from environment variables:
    - CLICKHOUSE_HOST (default: localhost)
    - CLICKHOUSE_HTTP_PORT or CLICKHOUSE_PORT (default: 18123)
    - CLICKHOUSE_DATABASE (default: quantbot)
    - CLICKHOUSE_USER (default: default)
    - CLICKHOUSE_PASSWORD (default: empty)
    
    Returns: List[Candle] ordered by timestamp ascending
    """
    if not CLICKHOUSE_AVAILABLE:
        raise RuntimeError("clickhouse-connect package not installed. Install with: pip install clickhouse-connect")
    
    # Get ClickHouse connection settings from environment
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    port = int(os.getenv('CLICKHOUSE_HTTP_PORT') or os.getenv('CLICKHOUSE_PORT', '18123'))
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    username = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    
    # Convert interval_seconds to interval string
    interval = _interval_seconds_to_string(interval_seconds)
    
    # Parse timestamps
    try:
        start_time = datetime.fromisoformat(from_ts.replace('Z', '+00:00'))
        end_time = datetime.fromisoformat(to_ts.replace('Z', '+00:00'))
    except ValueError as e:
        raise ValueError(f"Invalid timestamp format: {e}")
    
    # Connect to ClickHouse
    try:
        client = get_client(
            host=host,
            port=port,
            database=database,
            username=username,
            password=password
        )
    except Exception as e:
        raise RuntimeError(f"Failed to connect to ClickHouse: {e}")
    
    try:
        # Query candles (following clickhouse_engine.py pattern)
        query = f"""
            SELECT 
                toUnixTimestamp(timestamp) as timestamp,
                open,
                high,
                low,
                close,
                volume
            FROM {database}.ohlcv_candles
            WHERE token_address = %(token_address)s
              AND chain = %(chain)s
              AND interval = %(interval)s
              AND timestamp >= %(start_time)s
              AND timestamp <= %(end_time)s
            ORDER BY timestamp ASC
        """
        
        result = client.query(
            query,
            parameters={
                'token_address': token,
                'chain': 'solana',  # Default to solana, can be made configurable
                'interval': interval,
                'start_time': start_time,
                'end_time': end_time
            }
        )
        
        # Convert to Candle objects
        candles = []
        for row in result.result_rows:
            # row format: (timestamp (unix int), open, high, low, close, volume)
            ts_unix = int(row[0])
            # Convert unix timestamp to ISO string
            ts_dt = datetime.utcfromtimestamp(ts_unix)
            ts_iso = ts_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
            
            candles.append(Candle(
                ts=ts_iso,
                o=float(row[1]),
                h=float(row[2]),
                l=float(row[3]),
                c=float(row[4]),
                v=float(row[5])
            ))
        
        return candles
    except Exception as e:
        raise RuntimeError(f"Failed to query candles from ClickHouse: {e}")
    finally:
        try:
            client.close()
        except Exception:
            pass

def extract_tokens_from_filter(filter_data: Dict[str, Any]) -> List[str]:
    """
    Extract token list from filter data.
    
    Supports multiple filter formats:
    1. Direct token list: {"tokens": ["addr1", "addr2"]}
    2. FilterPreset format: {"chains": [...], ...} - returns empty (needs token resolution)
    
    TODO: Implement full token resolution for FilterPreset (chain + criteria -> tokens)
    For now, only extracts direct token lists.
    """
    # Try direct token list first
    if "tokens" in filter_data:
        tokens = filter_data["tokens"]
        if isinstance(tokens, list):
            return [str(t) for t in tokens if t]
    
    # FilterPreset format - needs token resolution (placeholder)
    # In the future, this could query ClickHouse/DuckDB to resolve tokens based on:
    # - chains
    # - age_minutes criteria
    # - mcap_usd criteria
    # For now, return empty list
    return []

def execute_run(run_id: str, strategy_id: str, filter_id: str, interval_seconds: int, from_ts: str, to_ts: str, tokens: List[str]) -> None:
    strategy = load_strategy(strategy_id)

    conn.execute("UPDATE runs SET status = ? WHERE run_id = ?", ["running", run_id])

    all_trades = []
    token_summaries = []

    for token in tokens:
        candles = load_candles_for_token(token, interval_seconds, from_ts, to_ts)
        summary, trades, events, frames = simulate_token(token, candles, strategy)

        token_summaries.append(summary)
        all_trades.extend([t.__dict__ for t in trades])

        # Persist replay frames per token (simple JSON blob approach; optimize later)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS run_replay_blobs (
          run_id TEXT,
          token TEXT,
          frames_json TEXT,
          PRIMARY KEY(run_id, token)
        )
        """)
        conn.execute(
            "INSERT OR REPLACE INTO run_replay_blobs VALUES (?, ?, ?)",
            [run_id, token, json.dumps(frames)]
        )

    summary_json = {
        "run_id": run_id,
        "strategy_id": strategy_id,
        "filter_id": filter_id,
        "interval_seconds": interval_seconds,
        "from_ts": from_ts,
        "to_ts": to_ts,
        "token_count": len(tokens),
        "token_summaries": token_summaries,
        "trades": len(all_trades),
    }

    conn.execute("UPDATE runs SET status = ?, summary_json = ? WHERE run_id = ?", ["complete", json.dumps(summary_json), run_id])

    # Persist trades (minimal)
    conn.execute("""
    CREATE TABLE IF NOT EXISTS run_trades (
      run_id TEXT,
      token TEXT,
      trade_id TEXT,
      entry_ts TEXT,
      exit_ts TEXT,
      entry_price DOUBLE,
      exit_price DOUBLE,
      pnl_pct DOUBLE,
      exit_reason TEXT
    )
    """)
    for t in all_trades:
        conn.execute(
            "INSERT INTO run_trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [run_id, t["token"], t["trade_id"], t["entry_ts"], t["exit_ts"], t["entry_price"], t["exit_price"], t["pnl_pct"], t["exit_reason"]]
        )

