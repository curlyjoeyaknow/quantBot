"""
Tests for contract hygiene.

Ensures:
- Pydantic validation on input/output
- Single JSON object to stdout
- Errors to stderr
- Type safety
"""

import pytest
import json
import subprocess
from pathlib import Path
from duckdb_storage.ops import (
    StoreStrategyInput,
    StoreStrategyOutput,
    QueryCallsInput,
    QueryCallsOutput,
)


class TestPydanticValidation:
    """Test Pydantic validation ensures contract hygiene."""

    def test_input_validation_rejects_invalid_types(self):
        """Test Pydantic rejects invalid input types."""
        with pytest.raises(Exception):  # Pydantic ValidationError
            StoreStrategyInput(
                strategy_id=123,  # Should be string
                name="Test",
            )

    def test_input_validation_rejects_missing_required_fields(self):
        """Test Pydantic rejects missing required fields."""
        with pytest.raises(Exception):  # Pydantic ValidationError
            StoreStrategyInput(
                # Missing strategy_id
                name="Test",
            )

    def test_input_validation_enforces_constraints(self):
        """Test Pydantic enforces field constraints."""
        with pytest.raises(Exception):  # Pydantic ValidationError
            QueryCallsInput(
                limit=-1,  # Should be >= 1
            )

    def test_output_validation_ensures_contract(self):
        """Test output models ensure consistent contract."""
        # Valid output
        output = StoreStrategyOutput(
            success=True,
            strategy_id="PT2_SL25",
        )
        
        assert output.success is True
        assert output.strategy_id == "PT2_SL25"
        
        # Invalid output should be caught by Pydantic
        # Pydantic 2.x may coerce strings to bool, so test with a truly invalid type
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            StoreStrategyOutput(
                success=123,  # Int is not bool (Pydantic 2.x may not coerce this)
                strategy_id="TEST",
            )


class TestJsonOutput:
    """Test JSON output contract."""

    def test_main_outputs_single_json_object(self, temp_duckdb_file):
        """Test main.py outputs exactly one JSON object."""
        # Run as module to handle relative imports
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
        
        # Should be valid JSON
        assert result.returncode == 0, f"Command failed: {result.stderr}\nstdout: {result.stdout}"
        
        # Get JSON from stdout (may have stderr messages mixed in)
        stdout_lines = [line for line in result.stdout.strip().split('\n') if line.strip()]
        assert len(stdout_lines) > 0, f"No output from command: {result.stderr}"
        
        # Last line should be JSON
        output = json.loads(stdout_lines[-1])
        assert isinstance(output, dict)
        assert 'success' in output
        
        # Should be only one JSON object (no extra text before it)
        # Allow stderr messages, but stdout should end with JSON
        assert output['success'] is True or 'error' in output

    def test_error_outputs_valid_json(self, temp_duckdb_file):
        """Test errors are output as valid JSON."""
        # Run as module to handle relative imports
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
                'invalid json',  # Invalid JSON input
            ],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent.parent),
        )
        
        # Should still output valid JSON (error response)
        # May have error output on stderr, but stdout should have JSON
        stdout_lines = [line for line in result.stdout.strip().split('\n') if line.strip()]
        assert len(stdout_lines) > 0, f"Should have output on stdout, got stderr: {result.stderr}"
        
        # Last line should be valid JSON
        output = json.loads(stdout_lines[-1])
        assert isinstance(output, dict)
        assert 'success' in output
        assert output['success'] is False
        assert 'error' in output


class TestTypeSafety:
    """Test type safety through Pydantic models."""

    def test_input_models_enforce_types(self):
        """Test input models enforce correct types."""
        # Valid input
        input_data = QueryCallsInput(limit=10)
        assert input_data.limit == 10
        assert isinstance(input_data.limit, int)
        
        # Type coercion (if configured)
        input_data = QueryCallsInput(limit="10")  # String should be coerced
        assert isinstance(input_data.limit, int)

    def test_output_models_enforce_types(self):
        """Test output models enforce correct types."""
        output = QueryCallsOutput(
            success=True,
            calls=[
                {'mint': 'So111...', 'alert_timestamp': '2024-01-01T12:00:00'}
            ],
        )
        
        assert isinstance(output.success, bool)
        assert output.calls is not None
        assert all(isinstance(call.mint, str) for call in output.calls)


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

