#!/usr/bin/env python3
"""
TypedDict vs Pydantic Comparison

This example shows the differences between TypedDict (static types only)
and Pydantic (runtime validation).
"""

import json
from typing import cast

# Add parent directory to path for imports
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

# TypedDict approach (static types only)
from typedefs import BaselineBacktestConfig as TypedDictConfig

# Pydantic approach (runtime validation)
from typedefs.pydantic_models import BaselineBacktestConfig as PydanticConfig


def example_typeddict():
    """TypedDict: Static types only, no runtime validation."""
    
    print("=" * 60)
    print("TypedDict Example (Static Types Only)")
    print("=" * 60)
    
    # ✅ Valid data - works fine
    config_dict = {
        'duckdb': 'data/backtest.duckdb',
        'from': '2024-01-01',
        'to': '2024-02-01',
    }
    config: TypedDictConfig = cast(TypedDictConfig, config_dict)
    print(f"✅ Valid config: {config['duckdb']}")
    
    # ❌ Invalid data - NO RUNTIME ERROR! (mypy would catch this)
    bad_config_dict = {
        'duckdb': 123,  # Should be string!
        'from': '2024-01-01',
        'to': '2024-02-01',
    }
    bad_config: TypedDictConfig = cast(TypedDictConfig, bad_config_dict)
    print(f"❌ Bad config (no error!): {bad_config['duckdb']} (type: {type(bad_config['duckdb'])})")
    
    # ❌ Missing required field - NO RUNTIME ERROR!
    incomplete_dict = {'duckdb': 'data/backtest.duckdb'}
    incomplete_config: TypedDictConfig = cast(TypedDictConfig, incomplete_dict)
    print(f"❌ Incomplete config (no error!): {incomplete_config.get('from', 'MISSING')}")
    
    print("\n💡 TypedDict Pros:")
    print("   - Lightweight (just type hints)")
    print("   - Works with plain dicts")
    print("   - mypy catches errors at development time")
    print("\n⚠️  TypedDict Cons:")
    print("   - NO runtime validation")
    print("   - Errors only caught by mypy, not at runtime")
    print("   - No type coercion")
    print()


def example_pydantic():
    """Pydantic: Runtime validation + type coercion."""
    
    print("=" * 60)
    print("Pydantic Example (Runtime Validation)")
    print("=" * 60)
    
    # ✅ Valid data - works fine
    try:
        config = PydanticConfig(
            duckdb='data/backtest.duckdb',
            **{'from': '2024-01-01'},  # Use dict unpacking for 'from' keyword
            to='2024-02-01',
        )
        print(f"✅ Valid config: {config.duckdb}")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    # ✅ Type coercion - converts types automatically!
    try:
        config = PydanticConfig(
            duckdb='data/backtest.duckdb',
            **{'from': '2024-01-01'},
            to='2024-02-01',
            interval_seconds='60',  # String → int (automatic!)
            threads='16',  # String → int (automatic!)
        )
        print(f"✅ Type coercion: interval_seconds={config.interval_seconds} (type: {type(config.interval_seconds).__name__})")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    # ❌ Invalid type - RUNTIME ERROR (caught immediately!)
    try:
        bad_config = PydanticConfig(
            duckdb=123,  # Wrong type!
            **{'from': '2024-01-01'},
            to='2024-02-01',
        )
        print(f"This won't print: {bad_config.duckdb}")
    except Exception as e:
        print(f"❌ Validation error caught: {type(e).__name__}")
        print(f"   Message: {str(e)[:100]}...")
    
    # ❌ Missing required field - RUNTIME ERROR (caught immediately!)
    try:
        incomplete_config = PydanticConfig(duckdb='data/backtest.duckdb')
        print(f"This won't print: {incomplete_config.duckdb}")
    except Exception as e:
        print(f"❌ Validation error caught: {type(e).__name__}")
        print(f"   Message: {str(e)[:100]}...")
    
    # ✅ JSON parsing with validation
    json_str = '''
    {
        "duckdb": "data/backtest.duckdb",
        "from": "2024-01-01",
        "to": "2024-02-01",
        "interval_seconds": "60",
        "threads": "16"
    }
    '''
    try:
        config = PydanticConfig(**json.loads(json_str))
        print(f"✅ JSON parsing: {config.duckdb}, interval={config.interval_seconds} (type: {type(config.interval_seconds).__name__})")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    # ✅ JSON export
    config = PydanticConfig(
        duckdb='data/backtest.duckdb',
        **{'from': '2024-01-01'},
        to='2024-02-01',
    )
    json_output = config.model_dump_json(indent=2)
    print(f"✅ JSON export: {json_output[:100]}...")
    
    print("\n💡 Pydantic Pros:")
    print("   - Runtime validation (catches errors immediately)")
    print("   - Type coercion (converts '60' to 60)")
    print("   - Clear error messages")
    print("   - JSON serialization built-in")
    print("   - Default values handled elegantly")
    print("\n⚠️  Pydantic Cons:")
    print("   - Requires pydantic dependency")
    print("   - Slightly more overhead (validation cost)")
    print("   - Need to use BaseModel instead of plain dicts")
    print()


def when_to_use_each():
    """When to use TypedDict vs Pydantic."""
    
    print("=" * 60)
    print("When to Use Each")
    print("=" * 60)
    
    print("\n📋 Use TypedDict when:")
    print("   ✅ Working with trusted internal data")
    print("   ✅ Performance is critical (no validation overhead)")
    print("   ✅ You want to work with plain dicts")
    print("   ✅ mypy is enough (development-time checking)")
    
    print("\n🛡️  Use Pydantic when:")
    print("   ✅ Parsing untrusted input (JSON, CLI args, API)")
    print("   ✅ Need runtime validation")
    print("   ✅ Want type coercion (convert '60' to 60)")
    print("   ✅ Need clear error messages for users")
    print("   ✅ Want JSON serialization")
    
    print("\n💡 Best Practice:")
    print("   - Use Pydantic at boundaries (API, CLI, file parsing)")
    print("   - Use TypedDict for internal functions")
    print("   - Convert Pydantic → dict for internal use if needed")
    print()


if __name__ == '__main__':
    example_typeddict()
    print()
    example_pydantic()
    print()
    when_to_use_each()

