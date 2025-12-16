# Address Tests - Migration Notice

## ⚠️ These tests have been migrated to Python (pytest)

The address validation **correctness** tests have been moved to Python where the actual logic lives:

- **Python tests**: `tools/telegram/tests/test_address_extraction.py`
- **Fixtures**: `tools/telegram/tests/fixtures/telegram_cases.json`

## What Remains in TypeScript

TypeScript tests now focus on **pipeline behavior**, not correctness:

- **Pipeline integration**: `tests/integration/address-pipeline-integration.test.ts`
- **Bridge/contract tests**: `tests/integration/python-bridge.test.ts`
- **Semantic verification**: `tests/integration/address-semantic.test.ts` (mocked OHLCV provider)

## Why This Split?

- **Python (pytest)**: Tests what is *actually* true in the data plane
- **TypeScript (Vitest)**: Tests that the pipeline stays wired correctly

This avoids duplication and ensures each layer tests what it owns.

## Running Tests

```bash
# Python correctness tests
cd tools/telegram
pytest tests/test_address_extraction.py

# TypeScript pipeline tests
cd packages/utils
npm test -- address-pipeline-integration
npm test -- python-bridge
```

