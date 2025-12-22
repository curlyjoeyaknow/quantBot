# Test Refactoring Plan: Real Implementations

## Problem
Current tests mock too much, violating the testing rule: **"Use Real Implementations: Tests must use the actual production code, not simplified mocks or stubs"**

## Solution: Three-Tier Testing Strategy

### Tier 1: Unit Tests (`*.test.ts`)
**Purpose**: Fast, isolated testing of specific logic
**Allowed**: Mocks for external dependencies (APIs, databases)
**Location**: `tests/unit/` or `tests/*.test.ts`

**Current Status**: ✅ OK - These can use mocks

### Tier 2: Integration Tests (`*.integration.test.ts`)
**Purpose**: Test real system behavior with real implementations
**Required**: 
- Real `PythonEngine` (calls actual Python scripts)
- Real DuckDB files (created with test data)
- Real `OhlcvIngestionEngine` (can mock API calls but use real engine logic)
- Real `StorageEngine` (can use in-memory ClickHouse or test ClickHouse instance)

**Location**: `tests/*.integration.test.ts`

**Refactoring Needed**: 
- `OhlcvIngestionService.integration.test.ts` - Use real PythonEngine, real DuckDB
- Create test DuckDB files with actual schema and data
- Use real `getOhlcvIngestionEngine()` but mock API responses

### Tier 3: Stress Tests (`*.stress.test.ts`)
**Purpose**: Push system to absolute limits, test failure modes
**Required**: 
- **ALL real implementations** - no mocks except for external APIs (Birdeye)
- Real DuckDB with realistic data volumes
- Real ClickHouse (or test instance)
- Real PythonEngine
- Test actual error recovery, resilience, resource constraints

**Location**: `tests/stress/`

**Refactoring Needed**:
- `ohlcv-ingestion.stress.test.ts` - Use real implementations
- Use `createTestDuckDB()` helper (already exists in `ohlcv-ingestion-extreme.stress.test.ts`)
- Mock only external API calls (Birdeye), not internal services

## Implementation Steps

1. **Create Test Helpers** (`tests/helpers/`)
   - `createTestDuckDB()` - Create DuckDB with test schema and data
   - `createTestOhlcvIngestionEngine()` - Real engine with mocked API client
   - `createTestPythonEngine()` - Real PythonEngine instance

2. **Refactor Integration Tests**
   - Use real `PythonEngine.runOhlcvWorklist()` with real DuckDB
   - Use real `OhlcvIngestionEngine` (mock only Birdeye API)
   - Test actual worklist generation, candle fetching, storage

3. **Refactor Stress Tests**
   - Use real implementations throughout
   - Test with realistic data volumes
   - Test error recovery with real failures

## Benefits

- **Tests actually validate system behavior** - Not just that mocks work
- **Catches integration bugs** - Real Python scripts, real DuckDB queries
- **Validates error handling** - Real error paths, not mocked errors
- **Confidence in production** - If tests pass, system works

## Migration Strategy

1. Keep existing unit tests with mocks (they're fine)
2. Refactor integration tests first (smaller scope)
3. Refactor stress tests last (most complex)
4. Add new integration tests for critical paths

