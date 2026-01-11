# Testing Strategy: TypeScript + Python

## Overview

This codebase uses a **hybrid testing approach**:
- **TypeScript (Vitest)**: Pipeline behavior, contracts, integration
- **Python (pytest)**: Data plane correctness (parsing, validation, transforms)

## Test Layers

### TypeScript Tests (Vitest) - What Stays

**Purpose**: Verify pipeline behavior, not parsing/math correctness

#### Handler Tests
- Assert correct JSON payload sent to Python (paths/options/check flags)
- Zod output validation happens
- Failure modes are handled (timeout, non-JSON, invalid schema, nonzero exit)
- Mock PythonEngine - don't test Python logic here

#### Contract Tests (Bridge Tests)
- **1-2 tests** that run the real Python tool on a tiny fixture
- Assert returned JSON matches Zod schema
- Verify output files exist (if applicable)
- This is your "integration confidence" test

**Location**: `packages/utils/tests/integration/python-bridge.test.ts`

### Python Tests (pytest) - What Moves Here

**Purpose**: Validate correctness of actual logic

#### Address Extraction & Validation
- Telegram parsing edge cases
- Mint/address validation rules (Solana base58, EVM checksum)
- Punctuation stripping, deduplication
- Case preservation

**Location**: `tools/telegram/tests/test_address_extraction.py`

#### DuckDB Transforms
- SQL correctness
- Dedupe rules
- Joins and aggregations
- Output table contents

**Location**: `tools/telegram/tests/test_duckdb_*.py` (to be created)

#### Parquet Output
- Schema validation
- Row counts
- Data integrity

## Shared Fixtures

**Location**: `tools/telegram/tests/fixtures/`

- `telegram_cases.json` - Address extraction test cases (used by both TS and Python)
- `sample_telegram.json` - Minimal Telegram export for integration tests

## Migration Strategy

### Step 1: Extract Logic to Testable Modules ✅
- Created `address_validation.py` module
- Functions are now importable and testable

### Step 2: Create Shared Fixtures ✅
- `fixtures/telegram_cases.json` with test cases
- Both Python and TypeScript can read this

### Step 3: Data-Driven Python Tests ✅
- `test_address_extraction.py` uses fixtures
- Parametrized tests for easy expansion

### Step 4: Bridge Test in TypeScript ✅
- `python-bridge.test.ts` runs real Python tool
- Validates output schema

### Step 5: Refactor TypeScript Tests (TODO)
- Remove address validation correctness tests from TS
- Keep only pipeline/integration tests
- Focus on "does the pipeline call the right thing?"

## Running Tests

### Python Tests
```bash
cd tools/telegram
pytest                    # All tests
pytest -m unit           # Fast unit tests only
pytest -v                # Verbose output
```

### TypeScript Tests
```bash
cd packages/utils
npm test                 # All tests
npm test -- address      # Address-related tests
npm test -- python-bridge # Bridge tests only
```

## Why This Split?

### Before (All in TypeScript)
- TS tests were testing what we *wish* were true
- Python logic wasn't directly testable
- Duplication between TS mocks and Python reality

### After (Split)
- **pytest tests** tell you what is *actually* true in Python
- **Vitest tests** tell you the pipeline stays wired correctly
- No duplication - each layer tests what it owns

## Key Principles

1. **Don't test Python logic in TypeScript** - Use mocks for handlers, real Python for bridge tests
2. **Don't test TypeScript pipeline in Python** - Python tests focus on data correctness
3. **Shared fixtures** - Single source of truth for test cases
4. **Bridge test is critical** - It's your integration confidence check

## Next Steps

- [ ] Add DuckDB transform tests (pytest)
- [ ] Add Parquet output validation tests (pytest)
- [ ] Refactor TypeScript tests to remove address validation correctness tests
- [ ] Add more fixture cases as edge cases are discovered

