"""
Pytest configuration and fixtures for DuckDB storage tests.
"""

import pytest
import duckdb
import tempfile
import os
import sys
from pathlib import Path


@pytest.fixture
def temp_duckdb():
    """Create a temporary DuckDB file for testing."""
    # Create temp file path
    fd, path = tempfile.mkstemp(suffix='.duckdb')
    os.close(fd)
    
    # Remove the empty file - DuckDB will create it
    if os.path.exists(path):
        os.unlink(path)
    
    # Initialize with basic schema
    con = duckdb.connect(path)
    
    # Setup simulation schema
    sys_path = Path(__file__).parent.parent.parent / 'telegram' / 'simulation'
    sys.path.insert(0, str(sys_path))
    from sql_functions import setup_simulation_schema
    setup_simulation_schema(con)
    
    # Setup test data
    con.execute("""
        CREATE TABLE IF NOT EXISTS user_calls_d (
            mint VARCHAR,
            call_datetime TIMESTAMP
        )
    """)
    
    # Insert test calls
    con.execute("""
        INSERT INTO user_calls_d (mint, call_datetime)
        VALUES 
            ('So11111111111111111111111111111111111111112', '2024-01-01 12:00:00'),
            ('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '2024-01-02 12:00:00'),
            ('So11111111111111111111111111111111111111112', '2024-01-03 12:00:00')
    """)
    
    con.close()
    
    yield path
    
    # Cleanup
    if os.path.exists(path):
        os.unlink(path)


@pytest.fixture
def duckdb_connection(temp_duckdb):
    """Get a connection to the temporary DuckDB."""
    con = duckdb.connect(temp_duckdb)
    yield con
    con.close()

