# Python Type Stubs from Zod Schemas

## Overview

This project automatically generates Python type stubs (`.pyi` files) from TypeScript Zod schemas. This ensures type consistency between TypeScript and Python codebases and provides better developer experience with IDE autocomplete and type checking.

## Benefits

1. **Single Source of Truth**: Zod schemas define types for both TypeScript and Python
2. **No Type Drift**: Python types always match TypeScript types
3. **Better DX**: IDE autocomplete and type hints in Python
4. **Early Error Detection**: `mypy` catches type mismatches before runtime
5. **Documentation**: Types serve as inline documentation

## Usage

### 1. Generate Type Stubs

After updating Zod schemas in TypeScript services:

```bash
pnpm run generate-python-stubs
```

This generates `.pyi` files in `packages/*/python/types/`.

### 2. Use Types in Python

```python
from packages.backtest.python.types.baseline_backtest import (
    BaselineBacktestConfig,
    BaselineBacktestResult,
)

def run_baseline(config: BaselineBacktestConfig) -> BaselineBacktestResult:
    # IDE has autocomplete for config fields!
    duckdb_path = config['duckdb']
    from_date = config['from_']  # Note: 'from' → 'from_' in Python
    
    # Type-safe result construction
    result: BaselineBacktestResult = {
        'success': True,
        'run_id': 'test-123',
        'stored': False,
        'out_alerts': '/path/to/alerts.parquet',
        'out_callers': '/path/to/callers.parquet',
        'summary': {...},
        'callers_count': 10,
    }
    
    return result
```

### 3. Type Check with mypy

```bash
pnpm run typecheck:python
```

This runs `mypy` to check Python code for type errors.

## Generated Files

Current generated stubs:

- `packages/backtest/python/types/baseline_backtest.pyi`
  - `BaselineBacktestConfig`
  - `TokenResult`
  - `BaselineBacktestSummary`
  - `BaselineBacktestResult`

## Type Mapping

| Zod Type | Python Type |
|----------|-------------|
| `z.string()` | `str` |
| `z.number()` | `float` |
| `z.number().int()` | `int` |
| `z.boolean()` | `bool` |
| `z.array(T)` | `List[T]` |
| `z.object({...})` | `TypedDict` |
| `z.enum(['a', 'b'])` | `Literal['a', 'b']` |
| `z.optional(T)` | `Optional[T]` |
| `z.union([A, B])` | `Union[A, B]` |

## Keyword Handling

Python keywords are automatically renamed:

- `from` → `from_`
- `class` → `class_`
- `import` → `import_`

## Adding New Types

1. Define Zod schema in TypeScript service:

```typescript
export const MyConfigSchema = z.object({
  field1: z.string(),
  field2: z.number(),
});
```

2. Add to `scripts/generate-python-stubs-simple.ts`:

```typescript
{
  name: 'MyConfig',
  fields: [
    { name: 'field1', type: 'str', required: true },
    { name: 'field2', type: 'float', required: true },
  ],
}
```

3. Run generator:

```bash
pnpm run generate-python-stubs
```

## IDE Setup

### VS Code

Install Python extension and configure:

```json
{
  "python.linting.mypyEnabled": true,
  "python.linting.enabled": true
}
```

### PyCharm

PyCharm automatically recognizes `.pyi` files and provides type hints.

## CI Integration

Add to CI pipeline:

```yaml
- name: Type check Python
  run: pnpm run typecheck:python
```

## Limitations

1. **Manual Schema Definitions**: Currently requires manual definition in generator script
2. **No Runtime Validation**: Type stubs only provide static type hints, not runtime validation
3. **Complex Types**: Some complex Zod types may need manual mapping

## Future Improvements

1. **Automatic Extraction**: Parse TypeScript files to extract Zod schemas automatically
2. **Runtime Validation**: Generate Pydantic models for runtime validation
3. **Bidirectional Sync**: Generate Zod schemas from Python types

## Examples

See `packages/backtest/python/scripts/run_baseline_typed.py` for a complete example.

