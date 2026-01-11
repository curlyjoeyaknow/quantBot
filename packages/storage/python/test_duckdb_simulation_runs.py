#!/usr/bin/env python3
"""
Tests for duckdb_simulation_runs.py

Tests edge cases and error handling.
"""

import json
import os
import tempfile
import unittest
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("Skipping tests: duckdb not installed")
    exit(0)

# Import the module under test
import sys
sys.path.insert(0, str(Path(__file__).parent))

from duckdb_simulation_runs import (
    safe_connect,
    ensure_schema,
    table_exists,
    get_strategy_name,
    get_strategy_config,
    list_runs,
    get_run,
)


class TestDuckDBSimulationRuns(unittest.TestCase):
    """Test suite for duckdb_simulation_runs module."""
    
    def setUp(self):
        """Set up test database."""
        self.temp_db = tempfile.NamedTemporaryFile(delete=False, suffix='.duckdb')
        self.temp_db.close()
        self.db_path = self.temp_db.name
        
        # Create connection and schema
        self.conn = safe_connect(self.db_path)
        ensure_schema(self.conn)
    
    def tearDown(self):
        """Clean up test database."""
        if self.conn:
            self.conn.close()
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)
    
    def test_empty_database(self):
        """Test listing runs from empty database."""
        runs = list_runs(self.db_path)
        self.assertEqual(runs, [])
    
    def test_get_nonexistent_run(self):
        """Test getting a run that doesn't exist."""
        run = get_run(self.db_path, 'nonexistent-run-id')
        self.assertIsNone(run)
    
    def test_insert_and_list_run(self):
        """Test inserting and listing a run."""
        # Insert a test run
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital, final_capital, total_return_pct, total_trades, caller_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'test-run-1',
            'strategy-1',
            'mint123',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0,
            1100.0,
            0.1,
            5,
            'test-caller'
        ))
        self.conn.commit()
        
        # List runs
        runs = list_runs(self.db_path)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]['run_id'], 'test-run-1')
        self.assertEqual(runs[0]['strategy_id'], 'strategy-1')
        self.assertEqual(runs[0]['caller_name'], 'test-caller')
        self.assertEqual(runs[0]['total_trades'], 5)
        self.assertEqual(runs[0]['pnl_mean'], 0.1)
    
    def test_get_existing_run(self):
        """Test getting an existing run."""
        # Insert a test run
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital, final_capital, total_return_pct, total_trades
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'test-run-2',
            'strategy-2',
            'mint456',
            '2024-01-02 12:00:00',
            '2024-01-02 11:00:00',
            '2024-01-02 13:00:00',
            1000.0,
            1200.0,
            0.2,
            10
        ))
        self.conn.commit()
        
        # Get run
        run = get_run(self.db_path, 'test-run-2')
        self.assertIsNotNone(run)
        self.assertEqual(run['run_id'], 'test-run-2')
        self.assertEqual(run['strategy_id'], 'strategy-2')
        self.assertEqual(run['total_trades'], 10)
        self.assertEqual(run['pnl_mean'], 0.2)
        self.assertIsInstance(run['strategy_config'], dict)
    
    def test_filter_by_caller(self):
        """Test filtering runs by caller name."""
        # Insert multiple runs
        for i in range(3):
            self.conn.execute("""
                INSERT INTO simulation_runs (
                    run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                    initial_capital, caller_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                f'run-{i}',
                f'strategy-{i}',
                f'mint{i}',
                '2024-01-01 12:00:00',
                '2024-01-01 11:00:00',
                '2024-01-01 13:00:00',
                1000.0,
                'caller-1' if i < 2 else 'caller-2'
            ))
        self.conn.commit()
        
        # Filter by caller
        runs = list_runs(self.db_path, caller_name='caller-1')
        self.assertEqual(len(runs), 2)
        for run in runs:
            self.assertEqual(run['caller_name'], 'caller-1')
    
    def test_filter_by_date_range(self):
        """Test filtering runs by date range."""
        # Insert runs with different dates
        dates = [
            ('2024-01-01 12:00:00', 'run-1'),
            ('2024-01-15 12:00:00', 'run-2'),
            ('2024-02-01 12:00:00', 'run-3'),
        ]
        
        for alert_ts, run_id in dates:
            self.conn.execute("""
                INSERT INTO simulation_runs (
                    run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                    initial_capital
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                run_id,
                'strategy-1',
                'mint1',
                alert_ts,
                '2024-01-01 11:00:00',
                '2024-01-01 13:00:00',
                1000.0
            ))
        self.conn.commit()
        
        # Filter by date range
        runs = list_runs(
            self.db_path,
            from_iso='2024-01-10T00:00:00',
            to_iso='2024-01-20T00:00:00'
        )
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]['run_id'], 'run-2')
    
    def test_null_handling(self):
        """Test handling of NULL values."""
        # Insert run with NULL values
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital, caller_name, total_trades, total_return_pct
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'null-test-run',
            'strategy-1',
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0,
            None,
            None,
            None
        ))
        self.conn.commit()
        
        # Get run
        run = get_run(self.db_path, 'null-test-run')
        self.assertIsNotNone(run)
        self.assertIsNone(run['caller_name'])
        self.assertIsNone(run['total_trades'])
        self.assertIsNone(run['pnl_mean'])
    
    def test_limit_and_offset(self):
        """Test pagination with limit and offset."""
        # Insert multiple runs
        for i in range(10):
            self.conn.execute("""
                INSERT INTO simulation_runs (
                    run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                    initial_capital
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                f'run-{i}',
                'strategy-1',
                'mint1',
                '2024-01-01 12:00:00',
                '2024-01-01 11:00:00',
                '2024-01-01 13:00:00',
                1000.0
            ))
        self.conn.commit()
        
        # Test limit
        runs = list_runs(self.db_path, limit=5)
        self.assertEqual(len(runs), 5)
        
        # Test offset
        runs = list_runs(self.db_path, limit=5, offset=5)
        self.assertEqual(len(runs), 5)
        self.assertEqual(runs[0]['run_id'], 'run-4')  # Should be 5th run (0-indexed)
    
    def test_invalid_date_filter(self):
        """Test handling of invalid date filters."""
        # Insert a run
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            'test-run',
            'strategy-1',
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0
        ))
        self.conn.commit()
        
        # Try invalid date format
        runs = list_runs(self.db_path, from_iso='invalid-date')
        # Should not crash, just ignore invalid filter
        self.assertGreaterEqual(len(runs), 0)
    
    def test_strategy_name_lookup(self):
        """Test strategy name lookup from different tables."""
        # Test with strategy_config table
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS strategy_config (
                strategy_config_id TEXT PRIMARY KEY,
                strategy_id TEXT NOT NULL,
                strategy_name TEXT NOT NULL
            )
        """)
        self.conn.execute("""
            INSERT INTO strategy_config (strategy_config_id, strategy_id, strategy_name)
            VALUES ('config-1', 'strategy-1', 'Test Strategy')
        """)
        
        # Insert run
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            'test-run',
            'strategy-1',
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0
        ))
        self.conn.commit()
        
        # Get run and check strategy name
        run = get_run(self.db_path, 'test-run')
        self.assertIsNotNone(run)
        self.assertEqual(run['strategy_name'], 'Test Strategy')
    
    def test_table_exists(self):
        """Test table_exists function."""
        self.assertTrue(table_exists(self.conn, 'simulation_runs'))
        self.assertFalse(table_exists(self.conn, 'nonexistent_table'))
    
    def test_empty_strategy_config(self):
        """Test handling when strategy config doesn't exist."""
        # Insert run without strategy config
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            'test-run',
            'unknown-strategy',
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0
        ))
        self.conn.commit()
        
        # Get run - should have empty strategy_config
        run = get_run(self.db_path, 'test-run')
        self.assertIsNotNone(run)
        self.assertIsInstance(run['strategy_config'], dict)
        self.assertEqual(len(run['strategy_config']), 0)
    
    def test_large_limit(self):
        """Test handling of large limit values."""
        # Should handle large limits gracefully
        runs = list_runs(self.db_path, limit=10000)
        self.assertIsInstance(runs, list)
    
    def test_negative_offset(self):
        """Test handling of negative offset."""
        # Should handle gracefully (will be caught in main, but function should handle)
        runs = list_runs(self.db_path, offset=-1)
        # Should return empty or handle gracefully
        self.assertIsInstance(runs, list)
    
    def test_special_characters_in_run_id(self):
        """Test handling of special characters in run_id."""
        # Insert run with special characters
        special_id = "run-with-special-chars-!@#$%^&*()"
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            special_id,
            'strategy-1',
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0
        ))
        self.conn.commit()
        
        # Get run
        run = get_run(self.db_path, special_id)
        self.assertIsNotNone(run)
        self.assertEqual(run['run_id'], special_id)
    
    def test_unicode_in_caller_name(self):
        """Test handling of unicode characters."""
        unicode_caller = "测试调用者-émoji🚀"
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital, caller_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'unicode-test',
            'strategy-1',
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0,
            unicode_caller
        ))
        self.conn.commit()
        
        # Get run
        run = get_run(self.db_path, 'unicode-test')
        self.assertIsNotNone(run)
        self.assertEqual(run['caller_name'], unicode_caller)
    
    def test_very_long_strategy_id(self):
        """Test handling of very long strategy IDs."""
        long_id = 'a' * 500  # Very long ID
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            'long-id-test',
            long_id,
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0
        ))
        self.conn.commit()
        
        # Get run
        run = get_run(self.db_path, 'long-id-test')
        self.assertIsNotNone(run)
        self.assertEqual(run['strategy_id'], long_id)
    
    def test_json_serialization(self):
        """Test that results can be JSON serialized."""
        # Insert run
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital, total_return_pct
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'json-test',
            'strategy-1',
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0,
            0.12345678901234567890  # High precision number
        ))
        self.conn.commit()
        
        # Get run and serialize to JSON
        run = get_run(self.db_path, 'json-test')
        self.assertIsNotNone(run)
        
        # Should serialize without errors
        json_str = json.dumps(run, default=str)
        self.assertIsInstance(json_str, str)
        
        # Should be able to parse back
        parsed = json.loads(json_str)
        self.assertEqual(parsed['run_id'], 'json-test')
    
    def test_cli_list_operation(self):
        """Test CLI list operation via subprocess."""
        import subprocess
        
        # Insert test data
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            'cli-test',
            'strategy-1',
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0
        ))
        self.conn.commit()
        self.conn.close()
        
        # Run CLI command
        script_path = Path(__file__).parent / 'duckdb_simulation_runs.py'
        result = subprocess.run(
            [
                'python3',
                str(script_path),
                '--operation', 'list',
                '--db-path', self.db_path,
                '--limit', '10'
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        self.assertEqual(result.returncode, 0, f"CLI failed: {result.stderr}")
        
        # Parse JSON output
        output = json.loads(result.stdout)
        self.assertIsInstance(output, list)
        self.assertGreater(len(output), 0)
    
    def test_cli_get_operation(self):
        """Test CLI get operation via subprocess."""
        import subprocess
        
        # Insert test data
        self.conn.execute("""
            INSERT INTO simulation_runs (
                run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                initial_capital
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            'cli-get-test',
            'strategy-1',
            'mint1',
            '2024-01-01 12:00:00',
            '2024-01-01 11:00:00',
            '2024-01-01 13:00:00',
            1000.0
        ))
        self.conn.commit()
        self.conn.close()
        
        # Run CLI command
        script_path = Path(__file__).parent / 'duckdb_simulation_runs.py'
        result = subprocess.run(
            [
                'python3',
                str(script_path),
                '--operation', 'get',
                '--db-path', self.db_path,
                '--run-id', 'cli-get-test'
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        self.assertEqual(result.returncode, 0, f"CLI failed: {result.stderr}")
        
        # Parse JSON output (should be array with one element)
        output = json.loads(result.stdout)
        self.assertIsInstance(output, list)
        self.assertEqual(len(output), 1)
        self.assertEqual(output[0]['run_id'], 'cli-get-test')
    
    def test_cli_get_nonexistent(self):
        """Test CLI get operation with nonexistent run_id."""
        import subprocess
        
        self.conn.close()
        
        # Run CLI command
        script_path = Path(__file__).parent / 'duckdb_simulation_runs.py'
        result = subprocess.run(
            [
                'python3',
                str(script_path),
                '--operation', 'get',
                '--db-path', self.db_path,
                '--run-id', 'nonexistent-run-id'
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        self.assertEqual(result.returncode, 0, f"CLI failed: {result.stderr}")
        
        # Should return empty array
        output = json.loads(result.stdout)
        self.assertIsInstance(output, list)
        self.assertEqual(len(output), 0)
    
    def test_cli_validation_errors(self):
        """Test CLI validation error handling."""
        import subprocess
        
        self.conn.close()
        
        # Test missing run-id for get operation
        script_path = Path(__file__).parent / 'duckdb_simulation_runs.py'
        result = subprocess.run(
            [
                'python3',
                str(script_path),
                '--operation', 'get',
                '--db-path', self.db_path
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--run-id is required', result.stderr)
        
        # Test invalid limit
        result = subprocess.run(
            [
                'python3',
                str(script_path),
                '--operation', 'list',
                '--db-path', self.db_path,
                '--limit', '0'
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--limit must be between', result.stderr)
    
    def test_database_file_not_exists(self):
        """Test handling when database file doesn't exist."""
        # Should create new database
        non_existent_db = self.db_path + '.new'
        if os.path.exists(non_existent_db):
            os.unlink(non_existent_db)
        
        runs = list_runs(non_existent_db)
        # Should return empty list, not crash
        self.assertIsInstance(runs, list)
        self.assertEqual(len(runs), 0)
        
        # Clean up
        if os.path.exists(non_existent_db):
            os.unlink(non_existent_db)
    
    def test_concurrent_access(self):
        """Test that multiple concurrent queries don't interfere."""
        import threading
        
        # Insert multiple runs
        for i in range(10):
            self.conn.execute("""
                INSERT INTO simulation_runs (
                    run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
                    initial_capital
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                f'concurrent-{i}',
                'strategy-1',
                'mint1',
                '2024-01-01 12:00:00',
                '2024-01-01 11:00:00',
                '2024-01-01 13:00:00',
                1000.0
            ))
        self.conn.commit()
        self.conn.close()
        
        results = []
        errors = []
        
        def query_runs():
            try:
                runs = list_runs(self.db_path, limit=5)
                results.append(runs)
            except Exception as e:
                errors.append(e)
        
        # Run 5 concurrent queries
        threads = [threading.Thread(target=query_runs) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        # All should succeed
        self.assertEqual(len(errors), 0)
        self.assertEqual(len(results), 5)
        for result in results:
            self.assertIsInstance(result, list)


if __name__ == '__main__':
    unittest.main()

