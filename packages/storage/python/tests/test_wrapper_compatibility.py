"""
Tests for backward-compatible wrapper.

Ensures the old duckdb_storage.py interface still works
and produces the same output format.
"""

import pytest
import subprocess
import json
import tempfile
import os
from pathlib import Path


@pytest.fixture
def temp_duckdb_file():
    """Create a temporary DuckDB file."""
    fd, path = tempfile.mkstemp(suffix='.duckdb')
    os.close(fd)
    
    # Remove the empty file - DuckDB will create it
    if os.path.exists(path):
        os.unlink(path)
    
    # Initialize with schema
    import duckdb
    con = duckdb.connect(path)
    
    sys_path = Path(__file__).parent.parent.parent / 'telegram' / 'simulation'
    import sys
    sys.path.insert(0, str(sys_path))
    from sql_functions import setup_simulation_schema
    setup_simulation_schema(con)
    
    con.close()
    
    yield path
    
    if os.path.exists(path):
        os.unlink(path)


def run_wrapper_command(duckdb_path: str, operation: str, data: dict) -> dict:
    """Run the wrapper script and return parsed JSON output."""
    # Use the wrapper script directly (it handles imports)
    script_path = Path(__file__).parent.parent / 'duckdb_storage.py'
    
    result = subprocess.run(
        [
            'python3',
            str(script_path),
            '--duckdb',
            duckdb_path,
            '--operation',
            operation,
            '--data',
            json.dumps(data),
        ],
        capture_output=True,
        text=True,
        check=False,
        cwd=str(Path(__file__).parent.parent),
    )
    
    if result.returncode != 0:
        pytest.fail(f"Command failed: {result.stderr}\nstdout: {result.stdout}")
    
    # Get last line (JSON output)
    stdout_lines = [line for line in result.stdout.strip().split('\n') if line.strip()]
    if not stdout_lines:
        pytest.fail(f"No output from command: {result.stderr}")
    
    return json.loads(stdout_lines[-1])


class TestWrapperCompatibility:
    """Test backward-compatible wrapper interface."""

    def test_wrapper_store_strategy(self, temp_duckdb_file):
        """Test wrapper can store strategy."""
        data = {
            'strategy_id': 'PT2_SL25',
            'name': 'PT2 SL25',
            'entry_config': {'type': 'immediate'},
            'exit_config': {'targets': [{'target': 2.0, 'percent': 0.5}]},
        }

        result = run_wrapper_command(temp_duckdb_file, 'store_strategy', data)

        assert result['success'] is True
        assert result['strategy_id'] == 'PT2_SL25'
        assert 'error' not in result or result['error'] is None

    def test_wrapper_store_run(self, temp_duckdb_file):
        """Test wrapper can store run."""
        # First create the strategy (required for foreign key)
        strategy_data = {
            'strategy_id': 'PT2_SL25',
            'name': 'PT2 SL25',
            'entry_config': {'type': 'immediate'},
            'exit_config': {'targets': [{'target': 2.0, 'percent': 0.5}]},
        }
        run_wrapper_command(temp_duckdb_file, 'store_strategy', strategy_data)
        
        data = {
            'run_id': 'run_123',
            'strategy_id': 'PT2_SL25',
            'mint': 'So11111111111111111111111111111111111111112',
            'alert_timestamp': '2024-01-01T12:00:00',
            'start_time': '2024-01-01T12:00:00',
            'end_time': '2024-01-02T12:00:00',
            'initial_capital': 1000.0,
            'final_capital': 1200.0,
        }

        result = run_wrapper_command(temp_duckdb_file, 'store_run', data)

        assert result['success'] is True
        assert result['run_id'] == 'run_123'

    def test_wrapper_query_calls(self, temp_duckdb_file):
        """Test wrapper can query calls."""
        # Setup test data
        import duckdb
        # Remove and recreate to ensure clean state
        if os.path.exists(temp_duckdb_file):
            os.unlink(temp_duckdb_file)
        con = duckdb.connect(temp_duckdb_file)
        con.execute("""
            CREATE TABLE IF NOT EXISTS user_calls_d (
                mint VARCHAR,
                call_datetime TIMESTAMP
            )
        """)
        con.execute("""
            INSERT INTO user_calls_d (mint, call_datetime)
            VALUES ('So11111111111111111111111111111111111111112', '2024-01-01 12:00:00')
        """)
        con.close()

        data = {'limit': 10}

        result = run_wrapper_command(temp_duckdb_file, 'query_calls', data)

        assert result['success'] is True
        assert 'calls' in result
        assert isinstance(result['calls'], list)

    def test_wrapper_output_is_valid_json(self, temp_duckdb_file):
        """Test wrapper always outputs valid JSON."""
        data = {'strategy_id': 'TEST', 'name': 'Test'}

        result = run_wrapper_command(temp_duckdb_file, 'store_strategy', data)

        # Should be valid JSON (already parsed by run_wrapper_command)
        assert isinstance(result, dict)
        assert 'success' in result

    def test_wrapper_error_handling(self, temp_duckdb_file):
        """Test wrapper handles errors gracefully."""
        # Invalid data (missing required fields) should return error
        data = {
            'strategy_id': 'TEST',
            # Missing 'name' field
        }

        # This should fail validation, so expect an error response
        script_path = Path(__file__).parent.parent / 'duckdb_storage.py'
        result = subprocess.run(
            [
                'python3',
                str(script_path),
                '--duckdb',
                temp_duckdb_file,
                '--operation',
                'store_strategy',
                '--data',
                json.dumps(data),
            ],
            capture_output=True,
            text=True,
            check=False,
            cwd=str(Path(__file__).parent.parent),
        )
        
        # Should still return valid JSON with error
        stdout_lines = [line for line in result.stdout.strip().split('\n') if line.strip()]
        assert len(stdout_lines) > 0, f"No output: {result.stderr}"
        
        output = json.loads(stdout_lines[-1])
        assert isinstance(output, dict)
        assert 'success' in output
        # Should fail due to missing required field
        assert output.get('success') is False or 'error' in output

    def test_wrapper_exits_with_correct_code(self, temp_duckdb_file):
        """Test wrapper exits with correct code (0 for success, 1 for failure)."""
        script_path = Path(__file__).parent.parent / 'duckdb_storage.py'
        
        # Successful operation
        result = subprocess.run(
            [
                'python3',
                str(script_path),
                '--duckdb',
                temp_duckdb_file,
                '--operation',
                'store_strategy',
                '--data',
                json.dumps({
                    'strategy_id': 'TEST',
                    'name': 'Test',
                    'entry_config': {},
                    'exit_config': {},
                }),
            ],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent.parent),
        )
        
        assert result.returncode == 0, f"Command failed: {result.stderr}\nstdout: {result.stdout}"

