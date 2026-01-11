# Pydantic vs TypedDict: When to Use Each

## Quick Summary

| Feature | TypedDict (.pyi stubs) | Pydantic (BaseModel) |
|---------|------------------------|----------------------|
| **Runtime Validation** | ❌ No | ✅ Yes |
| **Type Coercion** | ❌ No | ✅ Yes (`"60"` → `60`) |
| **Error Messages** | ❌ mypy only | ✅ Clear runtime errors |
| **Performance** | ✅ Fast (no overhead) | ⚠️ Validation cost |
| **Dependencies** | ✅ None (stdlib) | ⚠️ Requires pydantic |
| **JSON Serialization** | ❌ Manual | ✅ Built-in |
| **Works with plain dicts** | ✅ Yes | ❌ Need BaseModel |
| **IDE Autocomplete** | ✅ Yes | ✅ Yes |
| **mypy Type Checking** | ✅ Yes | ✅ Yes |

## What is Pydantic?

**Pydantic** is a data validation library that uses Python type hints to:

1. **Validate data at runtime** - Catches errors when data is created
2. **Coerce types** - Automatically converts `"60"` to `60`
3. **Provide clear errors** - Tells you exactly what's wrong
4. **Serialize/deserialize** - Built-in JSON support

## Code Examples

### TypedDict (Static Types Only)

```python
from typing import TypedDict, cast
import json

class Config(TypedDict):
    name: str
    age: int
    active: bool

# ❌ NO runtime validation!
data = json.loads('{"name": "Alice", "age": "not a number"}')
config = cast(Config, data)  # No error at runtime!

# mypy catches this at development time:
# error: Incompatible types (expression has type "str", variable has type "int")
```

### Pydantic (Runtime Validation)

```python
from pydantic import BaseModel
import json

class Config(BaseModel):
    name: str
    age: int
    active: bool = True  # Default value

# ✅ Runtime validation!
try:
    config = Config(name="Alice", age="25")  # Converts "25" to 25
    print(config.age)  # 25 (int)
except ValidationError as e:
    print(e.errors())  # Clear error message

# ❌ Validation error at runtime
try:
    config = Config(name="Alice", age="not a number")
except ValidationError as e:
    print(e.errors())
    # [{'loc': ('age',), 'msg': 'value is not a valid integer', 'type': 'type_error.integer'}]
```

## When to Use TypedDict

✅ **Use TypedDict when:**

1. **Internal functions** - Data is already validated
2. **Performance critical** - No validation overhead
3. **Plain dicts** - Want to work with standard Python dicts
4. **mypy is enough** - Development-time checking is sufficient
5. **Lightweight** - Don't want extra dependencies

**Example:**

```python
from packages.backtest.python.types.baseline_backtest import BaselineBacktestConfig

def process_config(config: BaselineBacktestConfig) -> None:
    # Internal function, config already validated
    duckdb_path = config['duckdb']
    # ... process ...
```

## When to Use Pydantic

✅ **Use Pydantic when:**

1. **Parsing untrusted input** - JSON, CLI args, API requests
2. **Need runtime validation** - Catch errors immediately
3. **Type coercion** - Convert `"60"` to `60` automatically
4. **Clear error messages** - For users/API consumers
5. **JSON serialization** - Need `.model_dump_json()`
6. **Default values** - Elegant handling of defaults

**Example:**

```python
from packages.backtest.python.types.pydantic_models import BaselineBacktestConfig
import json

# Parse JSON from stdin (untrusted input)
json_data = json.loads(sys.stdin.read())

# Validates and coerces types!
config = BaselineBacktestConfig(**json_data)

# Now pass to internal function as plain dict
process_config(config.model_dump())
```

## Best Practice: Use Both

**Recommended pattern:**

1. **Pydantic at boundaries** (API, CLI, file parsing)
2. **TypedDict for internal functions**
3. **Convert Pydantic → dict** for internal use

```python
# Entry point (boundary) - use Pydantic
from packages.backtest.python.types.pydantic_models import BaselineBacktestConfig as PydanticConfig
from packages.backtest.python.types.baseline_backtest import BaselineBacktestConfig as TypedDictConfig

def main():
    # Parse CLI args with Pydantic (validation!)
    config_pydantic = PydanticConfig(**parse_args())
    
    # Convert to dict for internal use
    config_dict = config_pydantic.model_dump()
    
    # Pass to internal function (TypedDict for type hints)
    result = run_baseline(config_dict)

def run_baseline(config: TypedDictConfig) -> BaselineBacktestResult:
    # Internal function uses TypedDict (no validation overhead)
    duckdb_path = config['duckdb']
    # ... process ...
```

## Real-World Example

### Scenario: CLI Command

```python
#!/usr/bin/env python3
"""Baseline backtest CLI command."""

import sys
import json
from pydantic import ValidationError
from packages.backtest.python.types.pydantic_models import (
    BaselineBacktestConfig,
    BaselineBacktestResult,
)

def main():
    try:
        # Parse JSON from stdin (untrusted input)
        json_data = json.loads(sys.stdin.read())
        
        # Validate with Pydantic (catches errors immediately!)
        config = BaselineBacktestConfig(**json_data)
        
        # Run backtest (internal function)
        result = run_baseline_internal(config.model_dump())
        
        # Serialize result with Pydantic
        result_model = BaselineBacktestResult(**result)
        print(result_model.model_dump_json())
        
    except ValidationError as e:
        # Clear error message for user
        print(json.dumps({'error': 'Invalid configuration', 'details': e.errors()}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

def run_baseline_internal(config: dict) -> dict:
    # Internal function (no validation overhead)
    # ... actual backtest logic ...
    return {'success': True, ...}

if __name__ == '__main__':
    main()
```

## Performance Comparison

```python
import timeit

# TypedDict (no validation)
def typeddict_approach():
    config = {'name': 'Alice', 'age': 25, 'active': True}
    return config

# Pydantic (with validation)
def pydantic_approach():
    config = Config(name='Alice', age=25, active=True)
    return config

# TypedDict: ~0.1 µs
# Pydantic: ~10 µs (100x slower, but still very fast!)
```

**Verdict:** Pydantic overhead is negligible for most use cases (~10 microseconds).

## Migration Path

Already using TypedDict? Add Pydantic gradually:

1. Keep existing TypedDict stubs (`.pyi` files)
2. Add Pydantic models for boundaries only
3. Internal functions continue using TypedDict
4. No breaking changes!

## Summary

- **TypedDict**: Lightweight, fast, mypy-only validation
- **Pydantic**: Runtime validation, type coercion, clear errors
- **Best practice**: Pydantic at boundaries, TypedDict internally
- **Performance**: Pydantic overhead is negligible (~10 µs)

Choose based on your needs:

- Need runtime validation? → **Pydantic**
- Internal function? → **TypedDict**
- Parsing user input? → **Pydantic**
- Performance critical? → **TypedDict**
