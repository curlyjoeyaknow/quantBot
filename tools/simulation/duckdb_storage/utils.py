"""
Shared utilities for DuckDB storage operations.
"""

import duckdb
from pathlib import Path
import sys

# Import simulation schema
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'telegram' / 'simulation'))
from sql_functions import setup_simulation_schema


def get_connection(duckdb_path: str) -> duckdb.DuckDBPyConnection:
    """Get DuckDB connection and ensure schema is set up."""
    con = duckdb.connect(duckdb_path)
    setup_simulation_schema(con)
    return con


def setup_ohlcv_metadata_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Setup OHLCV metadata table schema."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_metadata_d (
            mint VARCHAR NOT NULL,
            alert_timestamp TIMESTAMP NOT NULL,
            interval_seconds INTEGER NOT NULL,
            time_range_start TIMESTAMP NOT NULL,
            time_range_end TIMESTAMP NOT NULL,
            candle_count INTEGER NOT NULL,
            last_updated TIMESTAMP NOT NULL,
            PRIMARY KEY (mint, alert_timestamp, interval_seconds)
        )
    """)


def setup_ohlcv_exclusions_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Setup OHLCV exclusions table schema - matches ClickHouse ohlcv_candles structure."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_exclusions_d (
            token_address VARCHAR NOT NULL,
            chain VARCHAR NOT NULL,
            interval VARCHAR NOT NULL,
            excluded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reason VARCHAR NOT NULL,
            PRIMARY KEY (token_address, chain, interval)
        )
    """)
    
    # Create indexes for efficient queries
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_exclusions_token_address 
        ON ohlcv_exclusions_d(token_address)
    """)
    
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_exclusions_chain 
        ON ohlcv_exclusions_d(chain)
    """)
    
    con.execute("""
        CREATE INDEX IF NOT EXISTS idx_ohlcv_exclusions_interval 
        ON ohlcv_exclusions_d(interval)
    """)

