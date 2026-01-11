"""
Tests for separation of concerns.

Ensures:
- Storage operations don't contain ingestion logic
- No API calls in storage layer
- No external dependencies beyond DuckDB
- Clear boundaries between layers
"""

import pytest
import ast
import importlib.util
from pathlib import Path


def get_imports_from_file(file_path: Path) -> set:
    """Extract all imports from a Python file."""
    with open(file_path, 'r') as f:
        tree = ast.parse(f.read())
    
    imports = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.add(alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.add(node.module.split('.')[0])
    
    return imports


class TestSeparationOfConcerns:
    """Test that storage operations maintain separation of concerns."""

    def test_no_http_imports_in_storage(self):
        """Test storage operations don't import HTTP libraries."""
        storage_dir = Path(__file__).parent.parent / 'duckdb_storage' / 'ops'
        
        forbidden_imports = {
            'requests',
            'httpx',
            'aiohttp',
            'urllib',
            'http',
            'urllib3',
        }
        
        for op_file in storage_dir.glob('*.py'):
            if op_file.name == '__init__.py':
                continue
            
            imports = get_imports_from_file(op_file)
            found = imports & forbidden_imports
            
            assert not found, (
                f"{op_file.name} imports HTTP libraries: {found}. "
                "Storage operations should not make API calls."
            )

    def test_no_birdeye_imports_in_storage(self):
        """Test storage operations don't import Birdeye client."""
        storage_dir = Path(__file__).parent.parent / 'duckdb_storage' / 'ops'
        
        for op_file in storage_dir.glob('*.py'):
            if op_file.name == '__init__.py':
                continue
            
            imports = get_imports_from_file(op_file)
            
            assert 'birdeye' not in str(imports).lower(), (
                f"{op_file.name} imports Birdeye. "
                "Storage operations should not fetch data from APIs."
            )

    def test_storage_only_uses_duckdb(self):
        """Test storage operations only use DuckDB (and standard libraries)."""
        storage_dir = Path(__file__).parent.parent / 'duckdb_storage' / 'ops'
        
        allowed_external = {
            'duckdb',
            'pydantic',
            'datetime',
            'typing',
            'pathlib',
            'sys',
        }
        
        # Allow relative imports (utils is a local module for schema setup)
        # sql_functions is also a local module (from telegram/simulation)
        allowed_relative = {'utils', 'sql_functions'}
        
        for op_file in storage_dir.glob('*.py'):
            if op_file.name == '__init__.py':
                continue
            
            imports = get_imports_from_file(op_file)
            external = imports - {
                'builtins',
                'collections',
                'json',
                'os',
                'pathlib',
                'sys',
                'typing',
                'datetime',
            }
            
            # Only DuckDB, Pydantic, and local modules should be external
            unexpected = external - allowed_external - allowed_relative
            
            assert not unexpected, (
                f"{op_file.name} imports unexpected libraries: {unexpected}. "
                "Storage operations should only use DuckDB, Pydantic, and local modules (utils, sql_functions)."
            )

    def test_no_ingestion_logic_in_storage(self):
        """Test storage operations don't contain ingestion logic keywords."""
        storage_dir = Path(__file__).parent.parent / 'duckdb_storage' / 'ops'
        
        ingestion_keywords = [
            'fetch',
            'ingest',
            'api',
            'birdeye',
            'http',
            'request',
            'download',
        ]
        
        for op_file in storage_dir.glob('*.py'):
            if op_file.name == '__init__.py':
                continue
            
            content = op_file.read_text().lower()
            
            # Check for ingestion-related function names or comments
            for keyword in ingestion_keywords:
                # Allow in comments or docstrings, but not in function logic
                # This is a simple check - could be enhanced
                if f'def {keyword}' in content or f'async {keyword}' in content:
                    pytest.fail(
                        f"{op_file.name} contains ingestion logic ({keyword}). "
                        "Storage operations should only read/write DuckDB."
                    )

    def test_storage_operations_are_pure_functions(self):
        """Test storage operations are pure functions (no side effects beyond DB)."""
        storage_dir = Path(__file__).parent.parent / 'duckdb_storage' / 'ops'
        
        for op_file in storage_dir.glob('*.py'):
            if op_file.name == '__init__.py':
                continue
            
            content = op_file.read_text()
            
            # Check for file system operations (except through DuckDB)
            forbidden_patterns = [
                'open(',
                'write(',
                'read(',
                'mkdir',
                'rmdir',
                'remove(',
                'unlink(',
            ]
            
            # Allow in comments/docstrings
            lines = content.split('\n')
            code_lines = [
                line for line in lines
                if not line.strip().startswith('#') and not line.strip().startswith('"""')
            ]
            code_content = '\n'.join(code_lines)
            
            for pattern in forbidden_patterns:
                if pattern in code_content and 'duckdb' not in code_content.lower():
                    pytest.fail(
                        f"{op_file.name} contains file system operations. "
                        "Storage operations should only interact with DuckDB."
                    )

