# Birdeye Ingestion Tests

## Overview

Tests for Birdeye API ingestion scenarios covering:
- API response handling
- Data format conversion
- Error handling
- Time range filtering

## Test Files

### `birdeye-ingestion-simple.test.ts`
**Purpose**: Tests Birdeye API client behavior and data transformation

**Coverage**:
- ✅ Valid API responses
- ✅ Empty responses
- ✅ Null responses (invalid tokens)
- ✅ Data format conversion (Birdeye → Candle)
- ✅ Missing fields handling
- ✅ Non-numeric values
- ✅ Error scenarios (400, 404, 429, 500, timeout)
- ✅ Time range filtering
- ✅ Chronological sorting

**Note**: These tests focus on the Birdeye client layer and data transformation.
Full integration tests with the ingestion engine are in `ohlcv-ingestion-engine.test.ts`.

## Running Tests

```bash
cd packages/ohlcv
npm test -- birdeye-ingestion-simple
```

## Key Test Scenarios

### 1. API Response Handling
- Valid response with items
- Empty items array
- Null response (invalid token)

### 2. Data Format Conversion
- Birdeye format → Candle format
- Missing fields (null/undefined)
- Non-numeric string values

### 3. Error Handling
- 400 Bad Request
- 404 Not Found
- 429 Too Many Requests
- 500 Internal Server Error
- Network timeout
- Connection errors

### 4. Time Range Filtering
- Filter candles to requested range
- Sort chronologically

## Integration with Existing Tests

These tests complement:
- `ohlcv-ingestion-engine.test.ts` - Full engine integration
- `ohlcv-service.test.ts` - Service layer tests
- `candle-transformations.test.ts` - Data transformation tests

