"""
Tests for Validation Pipeline

Tests:
- Telegram ingestion validation
- OHLCV coverage validation
- Simulation data validation
"""

import pytest
import duckdb
import tempfile
import os
from datetime import datetime

# Import validation functions
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../'))
from validation_pipeline import (
    validate_telegram_ingestion,
    validate_ohlcv_coverage,
    validate_simulation_data,
    validate_all_stages,
)


@pytest.fixture
def test_db():
    """Create a test DuckDB database"""
    db_path = tempfile.mktemp(suffix='.duckdb')
    con = duckdb.connect(db_path)
    
    # Create schema
    con.execute("""
        CREATE TABLE IF NOT EXISTS user_calls_d (
            chat_id TEXT,
            message_id BIGINT,
            call_ts_ms BIGINT,
            caller_id TEXT,
            mint TEXT,
            ticker TEXT
        )
    """)
    
    con.execute("""
        CREATE TABLE IF NOT EXISTS caller_links_d (
            trigger_chat_id TEXT,
            bot_message_id BIGINT,
            bot_ts_ms BIGINT
        )
    """)
    
    con.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_candles_d (
            mint TEXT,
            timestamp INTEGER,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume DOUBLE,
            interval_seconds INTEGER
        )
    """)
    
    con.execute("""
        CREATE TABLE IF NOT EXISTS simulation_runs (
            run_id TEXT PRIMARY KEY,
            strategy_id TEXT,
            mint TEXT,
            alert_timestamp TIMESTAMP,
            initial_capital DOUBLE,
            final_capital DOUBLE,
            total_return_pct DOUBLE
        )
    """)
    
    con.execute("""
        CREATE TABLE IF NOT EXISTS simulation_events (
            event_id TEXT PRIMARY KEY,
            run_id TEXT,
            event_type TEXT,
            timestamp TIMESTAMP,
            price DOUBLE,
            quantity DOUBLE
        )
    """)
    
    yield con, db_path
    con.close()
    if os.path.exists(db_path):
        os.unlink(db_path)


def test_validate_telegram_ingestion_clean_data(test_db):
    """Test validation with clean data"""
    con, _ = test_db
    
    # Insert clean data
    con.execute("""
        INSERT INTO user_calls_d VALUES
        ('chat1', 1, 1704067200000, 'user1', 'So11111111111111111111111111111111111111112', 'TKN1'),
        ('chat1', 2, 1704067201000, 'user2', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'TKN2')
    """)
    
    result = validate_telegram_ingestion(con, 'chat1')
    assert result.passed is True
    assert len(result.errors) == 0


def test_validate_telegram_ingestion_missing_mints(test_db):
    """Test validation detects missing mints"""
    con, _ = test_db
    
    # Insert data with missing mints
    con.execute("""
        INSERT INTO user_calls_d VALUES
        ('chat1', 1, 1704067200000, 'user1', NULL, 'TKN1'),
        ('chat1', 2, 1704067201000, 'user2', '', 'TKN2')
    """)
    
    result = validate_telegram_ingestion(con, 'chat1')
    assert result.passed is False
    assert len(result.errors) > 0
    assert any('missing mint' in error.lower() for error in result.errors)


def test_validate_telegram_ingestion_duplicates(test_db):
    """Test validation detects duplicates"""
    con, _ = test_db
    
    # Insert duplicate data
    con.execute("""
        INSERT INTO user_calls_d VALUES
        ('chat1', 1, 1704067200000, 'user1', 'So11111111111111111111111111111111111111112', 'TKN1'),
        ('chat1', 2, 1704067200000, 'user1', 'So11111111111111111111111111111111111111112', 'TKN1')
    """)
    
    result = validate_telegram_ingestion(con, 'chat1')
    assert result.passed is True  # Duplicates are warnings, not errors
    assert len(result.warnings) > 0
    assert any('duplicate' in warning.lower() for warning in result.warnings)


def test_validate_ohlcv_coverage_has_data(test_db):
    """Test OHLCV coverage validation with data"""
    con, _ = test_db
    
    mint = 'So11111111111111111111111111111111111111112'
    start_ts = 1704067200
    end_ts = 1704070800
    
    # Insert candles
    con.execute("""
        INSERT INTO ohlcv_candles_d VALUES
        (?, ?, 1.0, 1.1, 0.9, 1.05, 1000.0, 300),
        (?, ?, 1.05, 1.15, 1.0, 1.1, 1200.0, 300)
    """, [mint, start_ts, mint, start_ts + 300])
    
    result = validate_ohlcv_coverage(con, mint, start_ts, end_ts)
    assert result.passed is True
    assert len(result.errors) == 0


def test_validate_ohlcv_coverage_no_data(test_db):
    """Test OHLCV coverage validation with no data"""
    con, _ = test_db
    
    mint = 'So11111111111111111111111111111111111111112'
    start_ts = 1704067200
    end_ts = 1704070800
    
    result = validate_ohlcv_coverage(con, mint, start_ts, end_ts)
    assert result.passed is False
    assert len(result.errors) > 0
    assert any('no ohlcv candles' in error.lower() for error in result.errors)


def test_validate_ohlcv_coverage_invalid_values(test_db):
    """Test OHLCV coverage validation detects invalid values"""
    con, _ = test_db
    
    mint = 'So11111111111111111111111111111111111111112'
    start_ts = 1704067200
    end_ts = 1704070800
    
    # Insert invalid candle (high < low)
    con.execute("""
        INSERT INTO ohlcv_candles_d VALUES
        (?, ?, 1.0, 0.9, 1.1, 1.05, 1000.0, 300)
    """, [mint, start_ts])
    
    result = validate_ohlcv_coverage(con, mint, start_ts, end_ts)
    assert result.passed is False
    assert len(result.errors) > 0
    assert any('invalid ohlcv' in error.lower() for error in result.errors)


def test_validate_simulation_data_exists(test_db):
    """Test simulation data validation with existing run"""
    con, _ = test_db
    
    run_id = 'test_run_123'
    
    # Insert run and events
    con.execute("""
        INSERT INTO simulation_runs VALUES
        (?, 'PT2_SL25', 'So11111111111111111111111111111111111111112', 
         '2024-01-01 12:00:00', 1000.0, 1200.0, 20.0)
    """, [run_id])
    
    con.execute("""
        INSERT INTO simulation_events VALUES
        ('event1', ?, 'entry', '2024-01-01 12:00:00', 1.0, 1.0),
        ('event2', ?, 'exit', '2024-01-01 13:00:00', 1.2, 1.0)
    """, [run_id, run_id])
    
    result = validate_simulation_data(con, run_id)
    assert result.passed is True
    assert len(result.errors) == 0


def test_validate_simulation_data_not_found(test_db):
    """Test simulation data validation with non-existent run"""
    con, _ = test_db
    
    result = validate_simulation_data(con, 'nonexistent_run')
    assert result.passed is False
    assert len(result.errors) > 0
    assert any('not found' in error.lower() for error in result.errors)


def test_validate_simulation_data_negative_capital(test_db):
    """Test simulation data validation detects negative capital"""
    con, _ = test_db
    
    run_id = 'test_run_123'
    
    # Insert run with negative final capital
    con.execute("""
        INSERT INTO simulation_runs VALUES
        (?, 'PT2_SL25', 'So11111111111111111111111111111111111111112', 
         '2024-01-01 12:00:00', 1000.0, -100.0, -10.0)
    """, [run_id])
    
    result = validate_simulation_data(con, run_id)
    assert result.passed is False
    assert len(result.errors) > 0
    assert any('negative' in error.lower() for error in result.errors)


def test_validate_all_stages(test_db):
    """Test validate_all_stages function"""
    con, _ = test_db
    
    # Insert test data
    con.execute("""
        INSERT INTO user_calls_d VALUES
        ('chat1', 1, 1704067200000, 'user1', 'So11111111111111111111111111111111111111112', 'TKN1')
    """)
    
    results = validate_all_stages(
        con,
        'chat1',
        mint='So11111111111111111111111111111111111111112',
        start_timestamp=1704067200,
        end_timestamp=1704070800
    )
    
    assert len(results) >= 1  # At least telegram ingestion
    assert results[0].stage == 'telegram_ingestion'
    
    # Should have OHLCV validation too
    if len(results) > 1:
        assert results[1].stage == 'ohlcv_coverage'

