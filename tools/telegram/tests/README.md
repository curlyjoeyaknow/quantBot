# Python Tests for Telegram Ingestion Pipeline

## Structure

- `tests/test_address_extraction.py` - Address extraction and validation tests (data-driven from fixtures)
- `tests/fixtures/telegram_cases.json` - Shared test fixtures for address extraction
- `tests/conftest.py` - Pytest configuration and shared fixtures

## Running Tests

```bash
# All tests
pytest

# Unit tests only (fast)
pytest -m unit

# Integration tests
pytest -m integration

# Specific test file
pytest tests/test_address_extraction.py

# With verbose output
pytest -v
```

## Test Strategy

### What's Tested in Python (pytest)

- **Address extraction correctness**: Telegram parsing edge cases, mint/address validation rules
- **DuckDB transforms**: SQL correctness, dedupe rules, joins, output table contents
- **Parquet output**: Schema validation, row counts

### What's Tested in TypeScript (Vitest)

- **Pipeline behavior**: Handler tests that assert correct JSON payloads, Zod validation, failure modes
- **Contract tests**: Bridge tests that run real Python tool and validate output schema
- **Integration**: End-to-end pipeline wiring

## Fixtures

Fixtures are stored in `tests/fixtures/` and shared between Python and TypeScript tests:

- `telegram_cases.json` - Address extraction test cases
- `sample_telegram.json` - Minimal Telegram export for integration tests

## Adding New Tests

1. **Address extraction**: Add cases to `fixtures/telegram_cases.json`
2. **DuckDB transforms**: Create new test file `tests/test_duckdb_*.py`
3. **Integration**: Add to `tests/test_integration_*.py`

