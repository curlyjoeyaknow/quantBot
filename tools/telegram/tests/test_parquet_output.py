"""
Pytest tests for Parquet output validation.

Tests:
- Parquet file creation
- Schema validation
- Row counts
- Data integrity
"""

import pytest
import duckdb
import tempfile
import os
from pathlib import Path


@pytest.fixture
def test_db_with_data():
    """Create a DuckDB database with test data"""
    # Don't create the file - let DuckDB create it
    db_path = tempfile.mktemp(suffix='.duckdb')
    con = duckdb.connect(db_path)
    
    # Create schema and insert test data
    con.execute("""
        CREATE TABLE IF NOT EXISTS user_calls_d (
            chat_id TEXT,
            message_id BIGINT,
            call_ts_ms BIGINT,
            call_datetime TIMESTAMP,
            caller_name TEXT,
            caller_id TEXT,
            mint TEXT,
            ticker TEXT,
            mcap_usd DOUBLE,
            price_usd DOUBLE,
            first_caller BOOLEAN
        )
    """)
    
    # Insert test data
    test_data = [
        ('test_chat', 1, 1704067200000, '2024-01-01 00:00:00', 'User1', 'user1', 
         'So11111111111111111111111111111111111111112', 'TKN1', 1000000.0, 0.001, True),
        ('test_chat', 2, 1704067201000, '2024-01-01 00:00:01', 'User2', 'user2',
         'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'TKN2', 2000000.0, 0.002, False),
    ]
    
    for row in test_data:
        con.execute("""
            INSERT INTO user_calls_d VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, row)
    
    yield con, db_path
    con.close()
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest.mark.integration
def test_parquet_export_creates_file(test_db_with_data):
    """Test that Parquet export creates a file"""
    con, db_path = test_db_with_data
    
    # Export to Parquet
    parquet_fd, parquet_path = tempfile.mkstemp(suffix='.parquet')
    os.close(parquet_fd)
    
    try:
        con.execute(f"""
            COPY (SELECT * FROM user_calls_d) 
            TO '{parquet_path}' (FORMAT PARQUET)
        """)
        
        # Verify file exists
        assert os.path.exists(parquet_path)
        assert os.path.getsize(parquet_path) > 0
    finally:
        if os.path.exists(parquet_path):
            os.unlink(parquet_path)


@pytest.mark.integration
def test_parquet_schema_validation(test_db_with_data):
    """Test that Parquet file has correct schema"""
    con, db_path = test_db_with_data
    
    parquet_fd, parquet_path = tempfile.mkstemp(suffix='.parquet')
    os.close(parquet_fd)
    
    try:
        # Export to Parquet
        con.execute(f"""
            COPY (SELECT * FROM user_calls_d) 
            TO '{parquet_path}' (FORMAT PARQUET)
        """)
        
        # Read back and verify schema
        result = con.execute(f"""
            DESCRIBE SELECT * FROM read_parquet('{parquet_path}')
        """).fetchall()
        
        # Check that expected columns exist
        column_names = [col[0] for col in result]
        assert 'chat_id' in column_names
        assert 'message_id' in column_names
        assert 'mint' in column_names
        assert 'ticker' in column_names
        assert 'mcap_usd' in column_names
        assert 'first_caller' in column_names
    finally:
        if os.path.exists(parquet_path):
            os.unlink(parquet_path)


@pytest.mark.integration
def test_parquet_row_count(test_db_with_data):
    """Test that Parquet file has correct row count"""
    con, db_path = test_db_with_data
    
    parquet_fd, parquet_path = tempfile.mkstemp(suffix='.parquet')
    os.close(parquet_fd)
    
    try:
        # Get expected count
        expected_count = con.execute("SELECT COUNT(*) FROM user_calls_d").fetchone()[0]
        
        # Export to Parquet
        con.execute(f"""
            COPY (SELECT * FROM user_calls_d) 
            TO '{parquet_path}' (FORMAT PARQUET)
        """)
        
        # Read back and verify count
        actual_count = con.execute(f"""
            SELECT COUNT(*) FROM read_parquet('{parquet_path}')
        """).fetchone()[0]
        
        assert actual_count == expected_count
    finally:
        if os.path.exists(parquet_path):
            os.unlink(parquet_path)


@pytest.mark.integration
def test_parquet_data_integrity(test_db_with_data):
    """Test that Parquet file data matches source"""
    con, db_path = test_db_with_data
    
    parquet_fd, parquet_path = tempfile.mkstemp(suffix='.parquet')
    os.close(parquet_fd)
    
    try:
        # Export to Parquet
        con.execute(f"""
            COPY (SELECT * FROM user_calls_d) 
            TO '{parquet_path}' (FORMAT PARQUET)
        """)
        
        # Read back and compare
        original = con.execute("SELECT * FROM user_calls_d ORDER BY message_id").fetchall()
        exported = con.execute(f"""
            SELECT * FROM read_parquet('{parquet_path}') ORDER BY message_id
        """).fetchall()
        
        assert len(original) == len(exported)
        
        # Compare row by row (excluding timestamp which may have precision differences)
        for orig, exp in zip(original, exported):
            assert orig[0] == exp[0]  # chat_id
            assert orig[1] == exp[1]  # message_id
            assert orig[4] == exp[4]  # caller_name
            assert orig[6] == exp[6]  # mint
            assert orig[7] == exp[7]  # ticker
            assert abs(orig[8] - exp[8]) < 0.01  # mcap_usd (float comparison)
            assert orig[10] == exp[10]  # first_caller
    finally:
        if os.path.exists(parquet_path):
            os.unlink(parquet_path)


@pytest.mark.integration
def test_parquet_export_specific_columns(test_db_with_data):
    """Test exporting only specific columns to Parquet"""
    con, db_path = test_db_with_data
    
    parquet_fd, parquet_path = tempfile.mkstemp(suffix='.parquet')
    os.close(parquet_fd)
    
    try:
        # Export only specific columns
        con.execute(f"""
            COPY (SELECT mint, ticker, mcap_usd FROM user_calls_d) 
            TO '{parquet_path}' (FORMAT PARQUET)
        """)
        
        # Verify only expected columns
        result = con.execute(f"""
            DESCRIBE SELECT * FROM read_parquet('{parquet_path}')
        """).fetchall()
        
        column_names = [col[0] for col in result]
        assert 'mint' in column_names
        assert 'ticker' in column_names
        assert 'mcap_usd' in column_names
        assert 'chat_id' not in column_names  # Should not be in export
    finally:
        if os.path.exists(parquet_path):
            os.unlink(parquet_path)

