"""
REGRESSION TEST: Variable scope bug in alerts.py

Bug: _load_from_caller_links and _load_from_user_calls referenced
     'has_canon_alerts_final' instead of 'has_mcap' parameter.

Impact: NameError crashed random search optimizer after 2,398+ iterations.

Root cause: Partial refactor renamed parameter from has_canon_alerts_final
           to has_mcap but didn't update all references inside functions.

This test would have FAILED before the fix.
"""

import pytest
import duckdb
from pathlib import Path
import tempfile
import sys
import shutil
from datetime import date

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from alerts import load_alerts, Alert


def test_load_alerts_with_mcap_parameter_regression():
    """
    CRITICAL REGRESSION TEST
    
    This test ensures that _load_from_caller_links and _load_from_user_calls
    correctly reference the 'has_mcap' parameter, not 'has_canon_alerts_final'.
    
    Before fix: NameError: name 'has_canon_alerts_final' is not defined
    After fix: Function executes successfully
    """
    # Create temp directory and database path
    tmpdir = tempfile.mkdtemp()
    duckdb_path = str(Path(tmpdir) / "test.duckdb")
    
    try:
        # Create minimal test database with caller_links_d table
        conn = duckdb.connect(duckdb_path)
        
        # Create caller_links_d with chain column (triggers the buggy code path)
        conn.execute("""
            CREATE TABLE caller_links_d (
                mint TEXT,
                trigger_ts_ms BIGINT,
                caller_name TEXT,
                chain TEXT
            )
        """)
        
        # Insert test data
        conn.execute("""
            INSERT INTO caller_links_d VALUES
            ('test_mint_123', 1704067200000, 'TestCaller', 'solana')
        """)
        
        conn.close()
        
        # This call would crash with NameError before the fix
        # because has_chain=True triggers the line:
        #   sql += " AND lower(c.chain) = lower(?)" if has_canon_alerts_final else ...
        # but has_canon_alerts_final doesn't exist in that scope
        alerts = load_alerts(
            duckdb_path=duckdb_path,
            chain='solana',
            date_from=date(2024, 1, 1),
            date_to=date(2024, 12, 31)
        )
        
        # If we got here, the bug is fixed
        assert len(alerts) >= 0  # May be 0 or more depending on filtering
        
    finally:
        # Cleanup
        shutil.rmtree(Path(duckdb_path).parent, ignore_errors=True)


def test_load_from_user_calls_with_mcap_parameter_regression():
    """
    CRITICAL REGRESSION TEST
    
    This test ensures that _load_from_user_calls correctly references
    the 'has_mcap' parameter, not 'has_canon_alerts_final'.
    
    Before fix: NameError: name 'has_canon_alerts_final' is not defined
    After fix: Function executes successfully
    """
    # Create temp directory and database path
    tmpdir = tempfile.mkdtemp()
    duckdb_path = str(Path(tmpdir) / "test2.duckdb")
    
    try:
        # Create minimal test database with user_calls_d table
        conn = duckdb.connect(duckdb_path)
        
        # Create user_calls_d with chain column (triggers the buggy code path)
        conn.execute("""
            CREATE TABLE user_calls_d (
                mint TEXT,
                call_ts_ms BIGINT,
                caller_name TEXT,
                chain TEXT
            )
        """)
        
        # Insert test data
        conn.execute("""
            INSERT INTO user_calls_d VALUES
            ('test_mint_456', 1704067200000, 'AnotherCaller', 'solana')
        """)
        
        conn.close()
        
        # This call would crash with NameError before the fix
        alerts = load_alerts(
            duckdb_path=duckdb_path,
            chain='solana',
            date_from=date(2024, 1, 1),
            date_to=date(2024, 12, 31)
        )
        
        # If we got here, the bug is fixed
        assert len(alerts) >= 0
        
    finally:
        # Cleanup
        shutil.rmtree(Path(duckdb_path).parent, ignore_errors=True)


if __name__ == "__main__":
    # Quick smoke test
    print("Running regression tests for alerts.py variable scope bug...")
    test_load_alerts_with_mcap_parameter_regression()
    print("✅ Test 1 passed: _load_from_caller_links fixed")
    test_load_from_user_calls_with_mcap_parameter_regression()
    print("✅ Test 2 passed: _load_from_user_calls fixed")
    print("\nAll regression tests passed! Bug is fixed.")

