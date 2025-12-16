# OHLCV Testing Strategy

## Overview

OHLCV functionality is **entirely TypeScript-based** (no Python code). All tests use Vitest.

## Test Organization

### 1. Handler Tests (Pipeline Behavior)

**Location**: `packages/cli/tests/unit/handlers/ingestion/ingest-ohlcv.test.ts`

**Purpose**: Test that handlers are pure use-case functions

- ✅ No Commander.js
- ✅ No console.log/error
- ✅ No process.exit
- ✅ Parameter conversion (string dates → Date objects)
- ✅ Error propagation (no try/catch)
- ✅ Service method calls with correct parameters

**Example**: `ingestOhlcvHandler` tests verify:

- Date string conversion to Date objects
- Window parameters passed correctly
- Errors bubble up (no catching)

### 2. Service Tests (Business Logic)

**Location**: `packages/ohlcv/tests/ohlcv-ingestion-engine.test.ts`

**Purpose**: Test OHLCV ingestion engine correctness

- ✅ Metadata fetching and storage
- ✅ 1m and 5m candle fetching strategies
- ✅ Multi-layer caching (in-memory, ClickHouse)
- ✅ Incremental storage
- ✅ Error handling
- ✅ Mint address preservation (CRITICAL)

### 3. Data Transformation Tests (Correctness)

**Location**: `packages/ohlcv/tests/` (various)

**Purpose**: Test data transformations and calculations

- ✅ Birdeye format → Candle format conversion
- ✅ Candle merging (5m + 1m)
- ✅ Aggregation (lower timeframe → higher timeframe)
- ✅ Time range filtering
- ✅ Deduplication

**Key Functions to Test**:

- `mergeCandles()` - Merges 5m and 1m candles
- `aggregateCandles()` - Aggregates lower-timeframe candles
- Birdeye API response → Candle format conversion

### 4. Integration Tests

**Location**: `packages/ohlcv/tests/ohlcv-ingestion-engine.integration.test.ts`

**Purpose**: Test end-to-end flows

- ✅ Full ingestion pipeline
- ✅ ClickHouse storage
- ✅ Cache behavior
- ✅ API error handling

## Test Patterns

### Handler Test Pattern

```typescript
describe('ingestOhlcvHandler', () => {
  it('calls service with converted dates', async () => {
    const mockService = { ingestForCalls: vi.fn() };
    const ctx = { services: { ohlcvIngestion: () => mockService } };
    
    await ingestOhlcvHandler(args, ctx);
    
    expect(mockService.ingestForCalls).toHaveBeenCalledWith({
      from: expect.any(Date),
      to: expect.any(Date),
      preWindowMinutes: 260,
      // ...
    });
  });
});
```

### Data Transformation Test Pattern

```typescript
describe('mergeCandles', () => {
  it('replaces 5m candles with 1m candles in alert window', () => {
    const candles5m = [/* ... */];
    const candles1m = [/* ... */];
    const merged = mergeCandles(candles5m, candles1m, alertTime);
    
    // Assert 1m candles take precedence
    expect(merged).toHaveLength(expectedLength);
  });
});
```

## Key Testing Principles

### 1. Mint Address Preservation

**CRITICAL**: All tests must preserve mint addresses exactly as provided

- No truncation
- Case preserved
- Full 32-44 character addresses

### 2. Time Range Correctness

- Verify candles are within requested time range
- Check chronological ordering
- Validate timestamp filtering

### 3. Caching Behavior

- Test in-memory cache hits
- Test ClickHouse cache hits
- Test cache misses trigger API calls
- Test cache invalidation

### 4. Error Handling

- API failures (400, 404, 500)
- Network timeouts
- Invalid mint addresses
- Missing data scenarios

## Test Coverage Goals

- **Handlers**: 100% (pipeline behavior)
- **Services**: 90%+ (business logic)
- **Transformations**: 100% (data correctness)
- **Integration**: Critical paths only

## Running Tests

```bash
# All OHLCV tests
cd packages/ohlcv
npm test

# Handler tests only
cd packages/cli
npm test -- ingest-ohlcv

# Integration tests
cd packages/ohlcv
npm test -- integration
```

## Future Enhancements

- Property tests for candle merging (fast-check)
- Property tests for aggregation (fast-check)
- Performance benchmarks for large candle arrays
- Fuzzing tests for Birdeye API response parsing
