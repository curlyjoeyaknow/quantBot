# DuckDB Storage Service

Modular storage operations for DuckDB with strict separation of concerns.

## Architecture

Each operation is a **pure function** with:
- **Input model**: Pydantic schema defining required/optional fields
- **Output model**: Pydantic schema defining response structure
- **`run()` function**: Pure DuckDB logic, no side effects

### Structure

```
duckdb_storage/
├── main.py              # Thin CLI dispatcher (OP_MAP)
├── utils.py             # Shared utilities (schema setup, connection)
└── ops/                 # Operation modules
    ├── store_strategy.py
    ├── store_run.py
    ├── query_calls.py
    ├── update_ohlcv_metadata.py
    ├── query_ohlcv_metadata.py
    ├── add_ohlcv_exclusion.py
    ├── query_ohlcv_exclusions.py
    └── generate_report.py
```

### Operation Pattern

Each operation follows this pattern:

```python
# ops/query_calls.py
from pydantic import BaseModel
import duckdb

class QueryCallsInput(BaseModel):
    limit: int = 1000
    exclude_unrecoverable: bool = True

class QueryCallsOutput(BaseModel):
    success: bool
    calls: list[CallItem] | None
    error: str | None

def run(con: duckdb.DuckDBPyConnection, input: QueryCallsInput) -> QueryCallsOutput:
    # Pure DuckDB logic
    ...
```

### Dispatcher

The dispatcher is intentionally boring:

```python
OP_MAP = {
    "query_calls": (QueryCallsInput, QueryCallsOutput, run),
    ...
}
```

**This boredom is a feature** - it keeps the dispatcher simple and maintainable.

## Guardrails

### 1. No Cross-Operation Imports

Operations don't call each other. Each operation is independent.

**Enforced by**: Tests in `test_separation_of_concerns.py`

### 2. No Side Effects Outside DuckDB

Operations only interact with DuckDB. No network calls, no filesystem (except declared outputs).

**Enforced by**: 
- Tests check for HTTP/Birdeye imports
- Tests verify no filesystem operations
- Architecture review

### 3. Contract Hygiene

- **Pydantic validation** on all inputs/outputs
- **Single JSON object** to stdout
- **Errors to stderr** only
- **Type safety** through Pydantic models

**Enforced by**: Tests in `test_contract_hygiene.py`

## Usage

### CLI

```bash
python3 -m duckdb_storage.main \
  --duckdb path/to/db.duckdb \
  --operation query_calls \
  --data '{"limit": 100}'
```

### From TypeScript

```typescript
const result = await pythonEngine.runDuckDBStorage({
  duckdbPath: 'path/to/db.duckdb',
  operation: 'query_calls',
  data: { limit: 100 },
});
```

## Testing

See `tests/README.md` for comprehensive test coverage:

- **Unit tests**: Each operation as pure function
- **Wrapper tests**: Backward compatibility
- **Separation tests**: Architecture boundaries
- **Contract tests**: Type safety, JSON output
- **Integration tests**: Full pipeline
- **Bridge tests**: TypeScript/Python boundary

## Future Enhancements

When ready, consider adding:

- **OperationResult envelope**: `{ ok, result, warnings }` for partial issues without exceptions
- **Subcommands**: `duckdb_storage query_calls ...` instead of `--operation query_calls`

But for now: **this is clean, calm, and correct.**

