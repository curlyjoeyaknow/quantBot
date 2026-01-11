"""
Integration tests for full pipeline.

Tests that verify:
- TypeScript → Python → TypeScript flow works
- Each layer produces expected output for next handler
- Contract is maintained across boundaries
"""

import pytest
import json
import subprocess
import os
from pathlib import Path


class TestTypeScriptPythonContract:
    """Test contract between TypeScript and Python layers."""

    def test_python_output_matches_typescript_expectation(self, temp_duckdb_file):
        """Test Python output matches what TypeScript expects."""
        # Simulate TypeScript call
        data = {
            'strategy_id': 'PT2_SL25',
            'name': 'PT2 SL25',
            'entry_config': {'type': 'immediate'},
            'exit_config': {'targets': [{'target': 2.0, 'percent': 0.5}]},
        }
        
        result = subprocess.run(
            [
                'python3',
                '-m',
                'duckdb_storage.main',
                '--duckdb',
                temp_duckdb_file,
                '--operation',
                'store_strategy',
                '--data',
                json.dumps(data),
            ],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent.parent),
        )
        
        assert result.returncode == 0, f"Command failed: {result.stderr}\nstdout: {result.stdout}"
        stdout_lines = [line for line in result.stdout.strip().split('\n') if line.strip()]
        output = json.loads(stdout_lines[-1])
        
        # TypeScript expects this structure (from DuckDBStorageService)
        assert 'success' in output
        assert isinstance(output['success'], bool)
        if output['success']:
            assert 'strategy_id' in output
        else:
            assert 'error' in output

    def test_query_calls_output_structure(self, temp_duckdb_file):
        """Test query_calls output matches TypeScript expectation."""
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
        
        script_path = Path(__file__).parent.parent / 'duckdb_storage' / 'main.py'
        
        result = subprocess.run(
            [
                'python3',
                '-m',
                'duckdb_storage.main',
                '--duckdb',
                temp_duckdb_file,
                '--operation',
                'query_calls',
                '--data',
                json.dumps({'limit': 10}),
            ],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent.parent),
        )
        
        assert result.returncode == 0, f"Command failed: {result.stderr}"
        output = json.loads(result.stdout)
        
        # TypeScript expects this structure (CallsQueryResultSchema)
        assert output['success'] is True
        assert 'calls' in output
        assert isinstance(output['calls'], list)
        if output['calls']:
            call = output['calls'][0]
            assert 'mint' in call
            assert 'alert_timestamp' in call
            assert isinstance(call['mint'], str)
            assert isinstance(call['alert_timestamp'], str)

    def test_metadata_output_structure(self, temp_duckdb_file):
        """Test metadata operations output matches TypeScript expectation."""
        # Update metadata
        update_data = {
            'mint': 'So11111111111111111111111111111111111111112',
            'alert_timestamp': '2024-01-01T12:00:00',
            'interval_seconds': 300,
            'time_range_start': '2024-01-01T07:00:00',
            'time_range_end': '2024-01-02T12:00:00',
            'candle_count': 100,
        }
        
        result = subprocess.run(
            [
                'python3',
                '-m',
                'duckdb_storage.main',
                '--duckdb',
                temp_duckdb_file,
                '--operation',
                'update_ohlcv_metadata',
                '--data',
                json.dumps(update_data),
            ],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent.parent),
        )
        
        assert result.returncode == 0, f"Command failed: {result.stderr}"
        output = json.loads(result.stdout)
        
        # TypeScript expects this structure (OhlcvMetadataResultSchema)
        assert 'success' in output
        assert isinstance(output['success'], bool)
        
        # Query metadata
        query_data = {
            'mint': 'So11111111111111111111111111111111111111112',
            'alert_timestamp': '2024-01-01T12:00:00',
            'interval_seconds': 300,
        }
        
        result = subprocess.run(
            [
                'python3',
                '-m',
                'duckdb_storage.main',
                '--duckdb',
                temp_duckdb_file,
                '--operation',
                'query_ohlcv_metadata',
                '--data',
                json.dumps(query_data),
            ],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent.parent),
        )
        
        assert result.returncode == 0, f"Command failed: {result.stderr}"
        output = json.loads(result.stdout)
        
        # TypeScript expects this structure
        assert output['success'] is True
        assert 'available' in output
        assert isinstance(output['available'], bool)
        if output['available']:
            assert 'time_range_start' in output
            assert 'time_range_end' in output
            assert 'candle_count' in output


@pytest.fixture
def temp_duckdb_file():
    """Create a temporary DuckDB file."""
    import tempfile
    import os
    import duckdb
    from pathlib import Path
    import sys
    
    fd, path = tempfile.mkstemp(suffix='.duckdb')
    os.close(fd)
    
    # Remove the empty file - DuckDB will create it
    if os.path.exists(path):
        os.unlink(path)
    
    con = duckdb.connect(path)
    sys_path = Path(__file__).parent.parent.parent / 'telegram' / 'simulation'
    sys.path.insert(0, str(sys_path))
    from sql_functions import setup_simulation_schema
    setup_simulation_schema(con)
    con.close()
    
    yield path
    
    if os.path.exists(path):
        os.unlink(path)

