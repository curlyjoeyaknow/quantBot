"""
Shared utilities for DuckDB storage operations.
"""

import duckdb
from pathlib import Path
import sys

# Import simulation schema
# Path: tools/simulation/duckdb_storage/utils.py -> tools/simulation/sql_functions.py
sys.path.insert(0, str(Path(__file__).parent.parent))
from sql_functions import setup_simulation_schema


def get_connection(duckdb_path: str) -> duckdb.DuckDBPyConnection:
    """
    Get DuckDB connection and ensure schema is set up.
    
    DEPRECATED: Use get_write_connection() from tools.shared.duckdb_adapter instead.
    This function is kept for backward compatibility but now uses the adapter internally.
    """
    from tools.shared.duckdb_adapter import get_connection as adapter_get_connection
    # Use adapter which handles empty/invalid files and sets busy_timeout
    # Note: We manually enter the context manager to return the connection
    # This is not ideal but maintains backward compatibility
    ctx = adapter_get_connection(duckdb_path, read_only=False)
    con = ctx.__enter__()
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
    # Check if table exists and has the correct schema
    try:
        columns = con.execute("PRAGMA table_info('ohlcv_exclusions_d')").fetchall()
        column_names = [col[1] for col in columns] if columns else []
        
        # If table exists but doesn't have the right schema, drop and recreate
        if column_names and 'token_address' not in column_names:
            # Old schema detected - drop and recreate
            con.execute("DROP TABLE IF EXISTS ohlcv_exclusions_d")
            column_names = []
    except Exception:
        # Table doesn't exist or error checking - will create below
        column_names = []
    
    # Create table with correct schema if it doesn't exist
    if not column_names:
        con.execute("""
            CREATE TABLE ohlcv_exclusions_d (
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

