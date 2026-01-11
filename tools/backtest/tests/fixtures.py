"""
Test fixtures and helpers for backtest validation.

Provides synthetic candle data and alerts for deterministic testing.
This module can be imported directly by test files.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import duckdb

# Add parent directory (tools/backtest) to path for importing run_baseline_all, etc.
_BACKTEST_DIR = Path(__file__).parent.parent
if str(_BACKTEST_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKTEST_DIR))

UTC = timezone.utc


@dataclass(frozen=True)
class SyntheticCandle:
    """A synthetic candle for testing."""
    token_address: str
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 1000.0


@dataclass(frozen=True)
class SyntheticAlert:
    """A synthetic alert for testing."""
    mint: str
    ts_ms: int
    caller: str


def make_candle(
    token: str,
    ts: datetime,
    o: float,
    h: float,
    l: float,
    c: float,
    v: float = 1000.0,
) -> SyntheticCandle:
    return SyntheticCandle(token, ts, o, h, l, c, v)


def make_linear_pump(
    token: str,
    start_ts: datetime,
    entry_price: float,
    peak_mult: float,
    candles_to_peak: int,
    candles_after_peak: int,
    interval_seconds: int = 60,
    end_mult: float = 0.5,
) -> List[SyntheticCandle]:
    """
    Create a linear pump pattern:
    - Price rises linearly from entry_price to entry_price * peak_mult
    - Then falls linearly to entry_price * end_mult
    """
    candles = []
    
    # Rising phase
    for i in range(candles_to_peak):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        progress = i / max(1, candles_to_peak - 1)
        price = entry_price * (1 + (peak_mult - 1) * progress)
        # Small variation for OHLC
        o = price * 0.99
        h = price * 1.01
        l = price * 0.98
        c = price
        candles.append(make_candle(token, ts, o, h, l, c))
    
    # Falling phase
    for i in range(candles_after_peak):
        ts = start_ts + timedelta(seconds=(candles_to_peak + i) * interval_seconds)
        progress = i / max(1, candles_after_peak - 1)
        price = entry_price * peak_mult * (1 - (1 - end_mult / peak_mult) * progress)
        o = price * 1.01
        h = price * 1.02
        l = price * 0.98
        c = price
        candles.append(make_candle(token, ts, o, h, l, c))
    
    return candles


def make_instant_rug(
    token: str,
    start_ts: datetime,
    entry_price: float,
    num_candles: int,
    interval_seconds: int = 60,
    rug_mult: float = 0.1,
) -> List[SyntheticCandle]:
    """
    Create an instant rug pattern:
    - First candle at entry_price
    - All subsequent candles at entry_price * rug_mult
    """
    candles = []
    
    # First candle at entry
    candles.append(make_candle(
        token, start_ts,
        entry_price, entry_price * 1.01, entry_price * 0.99, entry_price
    ))
    
    # Rest at rug level
    for i in range(1, num_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        price = entry_price * rug_mult
        candles.append(make_candle(token, ts, price, price * 1.01, price * 0.98, price))
    
    return candles


def make_sideways(
    token: str,
    start_ts: datetime,
    price: float,
    num_candles: int,
    interval_seconds: int = 60,
    variance: float = 0.02,
) -> List[SyntheticCandle]:
    """Create sideways price action."""
    candles = []
    for i in range(num_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        o = price * (1 - variance / 2)
        h = price * (1 + variance)
        l = price * (1 - variance)
        c = price * (1 + variance / 2)
        candles.append(make_candle(token, ts, o, h, l, c))
    return candles


def make_precise_multiples(
    token: str,
    start_ts: datetime,
    entry_price: float,
    num_candles: int,
    interval_seconds: int = 60,
) -> List[SyntheticCandle]:
    """
    Create candles that hit exactly 2x, 3x, 4x at specific times.
    
    Candle 10: hits exactly 2x (high = entry_price * 2.0)
    Candle 20: hits exactly 3x
    Candle 30: hits exactly 4x
    Candle 40: ATH at 5x
    Then declines
    """
    candles = []
    
    for i in range(num_candles):
        ts = start_ts + timedelta(seconds=i * interval_seconds)
        
        if i == 0:
            # Entry candle
            o, h, l, c = entry_price, entry_price * 1.05, entry_price * 0.95, entry_price
        elif i < 10:
            # Pre-2x: gradual rise
            mult = 1.0 + (1.0 * i / 10)
            o, h, l, c = entry_price * mult, entry_price * mult * 1.02, entry_price * mult * 0.98, entry_price * mult
        elif i == 10:
            # Exactly 2x
            o, h, l, c = entry_price * 1.9, entry_price * 2.0, entry_price * 1.85, entry_price * 1.95
        elif i < 20:
            # Between 2x and 3x
            progress = (i - 10) / 10
            mult = 2.0 + progress
            o, h, l, c = entry_price * mult, entry_price * mult * 1.02, entry_price * mult * 0.98, entry_price * mult
        elif i == 20:
            # Exactly 3x
            o, h, l, c = entry_price * 2.9, entry_price * 3.0, entry_price * 2.85, entry_price * 2.95
        elif i < 30:
            progress = (i - 20) / 10
            mult = 3.0 + progress
            o, h, l, c = entry_price * mult, entry_price * mult * 1.02, entry_price * mult * 0.98, entry_price * mult
        elif i == 30:
            # Exactly 4x
            o, h, l, c = entry_price * 3.9, entry_price * 4.0, entry_price * 3.85, entry_price * 3.95
        elif i < 40:
            progress = (i - 30) / 10
            mult = 4.0 + progress
            o, h, l, c = entry_price * mult, entry_price * mult * 1.02, entry_price * mult * 0.98, entry_price * mult
        elif i == 40:
            # ATH at 5x
            o, h, l, c = entry_price * 4.9, entry_price * 5.0, entry_price * 4.85, entry_price * 4.9
        else:
            # Decline after ATH
            mult = 5.0 - 0.1 * (i - 40)
            mult = max(0.5, mult)
            o, h, l, c = entry_price * mult, entry_price * mult * 1.02, entry_price * mult * 0.98, entry_price * mult
        
        candles.append(make_candle(token, ts, o, h, l, c))
    
    return candles


def write_candles_to_parquet(candles: List[SyntheticCandle], path: Path) -> None:
    """Write synthetic candles to a Parquet file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    
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
    
    rows = [
        (c.token_address, c.timestamp, c.open, c.high, c.low, c.close, c.volume)
        for c in candles
    ]
    conn.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    conn.execute(f"COPY candles TO '{path}' (FORMAT PARQUET)")
    conn.close()


def write_candles_to_partitioned(candles: List[SyntheticCandle], out_dir: Path) -> None:
    """Write synthetic candles to a partitioned Parquet dataset."""
    out_dir.mkdir(parents=True, exist_ok=True)
    
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
    
    rows = [
        (c.token_address, c.timestamp, c.open, c.high, c.low, c.close, c.volume)
        for c in candles
    ]
    conn.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    
    conn.execute(f"""
        COPY candles TO '{out_dir}'
        (FORMAT PARQUET, PARTITION_BY (token_address), COMPRESSION 'zstd')
    """)
    conn.close()


def create_alerts_duckdb(alerts: List[SyntheticAlert], path: Path) -> None:
    """Create a DuckDB file with alerts in caller_links_d table."""
    path.parent.mkdir(parents=True, exist_ok=True)
    
    conn = duckdb.connect(str(path))
    conn.execute("""
        CREATE TABLE caller_links_d (
            mint VARCHAR,
            trigger_ts_ms BIGINT,
            caller_name VARCHAR,
            trigger_from_name VARCHAR,
            chain VARCHAR DEFAULT 'solana'
        )
    """)
    
    rows = [(a.mint, a.ts_ms, a.caller, a.caller, "solana") for a in alerts]
    conn.executemany("INSERT INTO caller_links_d VALUES (?, ?, ?, ?, ?)", rows)
    conn.close()

