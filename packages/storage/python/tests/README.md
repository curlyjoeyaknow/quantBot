# DuckDB Storage Service Tests

Comprehensive test suite ensuring:
- **Wrapper Quality**: Backward-compatible wrapper maintains high quality
- **Separation of Concerns**: Storage operations don't contain ingestion logic
- **Contract Hygiene**: Each layer produces expected output for next handler

## Test Structure

### Python Tests (pytest)

#### `test_operations_unit.py`
Unit tests for each operation as a pure function:
- Input validation (Pydantic)
- Output validation (Pydantic)
- Correctness of operation
- Error handling

**Coverage**: All 8 operations (store_strategy, store_run, query_calls, update_ohlcv_metadata, query_ohlcv_metadata, add_ohlcv_exclusion, query_ohlcv_exclusions, generate_report)

#### `test_wrapper_compatibility.py`
Tests for backward-compatible wrapper:
- Old `duckdb_storage.py` interface still works
- Produces same output format
- Valid JSON output
- Correct exit codes

#### `test_separation_of_concerns.py`
Tests that ensure separation of concerns:
- No HTTP imports in storage operations
- No Birdeye imports in storage operations
- Storage only uses DuckDB (and standard libraries)
- No ingestion logic keywords in storage code
- Storage operations are pure functions (no side effects beyond DB)

#### `test_contract_hygiene.py`
Tests for contract hygiene:
- Pydantic validation on input/output
- Single JSON object to stdout
- Errors to stderr
- Type safety

#### `test_integration_pipeline.py`
Integration tests for full pipeline:
- TypeScript → Python → TypeScript flow
- Each layer produces expected output for next handler
- Contract maintained across boundaries

### TypeScript Tests (Vitest)

#### `duckdb-storage-bridge.test.ts`
Bridge test that runs real Python tool:
- Validates output schema matches TypeScript expectation
- Tests integration boundary
- Ensures contract is maintained

## Running Tests

### Python Tests

```bash
cd tools/simulation
pytest tests/                    # All tests
pytest tests/test_operations_unit.py  # Unit tests only
pytest tests/test_wrapper_compatibility.py  # Wrapper tests
pytest tests/test_separation_of_concerns.py  # Separation tests
pytest tests/test_contract_hygiene.py  # Contract tests
pytest tests/test_integration_pipeline.py  # Integration tests
```

### TypeScript Tests

```bash
cd packages/utils
npm test -- duckdb-storage-bridge  # Bridge test
```

## Test Coverage

- **Unit Tests**: 8 operations × multiple test cases = ~30+ tests
- **Wrapper Tests**: 6 tests
- **Separation Tests**: 5 tests
- **Contract Tests**: 8 tests
- **Integration Tests**: 3 tests
- **Bridge Test**: 7 tests

**Total**: ~60+ tests ensuring quality, separation, and contract hygiene

## Key Principles Tested

1. **Pure Functions**: Each operation is a pure function with typed input/output
2. **No Side Effects**: Storage operations only interact with DuckDB
3. **Contract Hygiene**: Pydantic validation ensures type safety
4. **Separation**: Storage layer doesn't contain ingestion logic
5. **Backward Compatibility**: Old interface still works
6. **Integration**: Full pipeline works end-to-end

