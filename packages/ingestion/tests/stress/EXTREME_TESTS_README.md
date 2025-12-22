# OHLCV Ingestion EXTREME Stress Tests

## Overview

These tests use **REAL implementations** and push the system to its **absolute limits**. They are designed to **FAIL** and expose real weaknesses in the codebase.

## ⚠️ WARNING

These tests will:
- Make **real API calls** (if Birdeye API is available)
- Write to **real databases** (ClickHouse, Postgres)
- Consume **significant resources** (memory, CPU, network)
- Take a **long time** to run (minutes to hours)
- May **fail your system** if resources are insufficient

## Running the Tests

```bash
# Enable integration stress tests
export RUN_INTEGRATION_STRESS=1

# Run extreme stress tests
pnpm test packages/ingestion/tests/stress/ohlcv-ingestion-extreme.stress.test.ts

# Run with verbose output
pnpm test packages/ingestion/tests/stress/ohlcv-ingestion-extreme.stress.test.ts --reporter=verbose
```

## Test Categories

### 1. Massive Concurrent Ingestion
- **1000 concurrent token ingestion requests** - Tests system under extreme load
- **10,000 sequential ingestion requests** - Tests for memory leaks over time

### 2. Extreme Data Volumes
- **1 year of historical data** - Tests with maximum reasonable data volumes
- **Maximum window sizes** - Tests with 2-year pre/post windows

### 3. Invalid Data Handling
- **Invalid mint addresses from database** - Tests with corrupted data in DB
- **Missing token data** - Tests with non-existent token IDs

### 4. Network Failure Scenarios
- **Birdeye API rate limiting (429 errors)** - Tests with 100 tokens to trigger rate limits
- **Network timeouts** - Tests timeout handling

### 5. Database Stress
- **ClickHouse connection failures** - Tests graceful failure handling
- **Concurrent database writes** - Tests for data corruption under concurrency

### 6. Edge Cases with Real Data
- **Token with zero calls** - Tests empty result handling
- **Future timestamps** - Tests with invalid time ranges
- **Very old timestamps (10 years)** - Tests with extreme historical data

### 7. Resource Exhaustion
- **Memory pressure from large result sets** - Tests with 500 tokens and 1 week of data
- **CPU pressure from complex calculations** - Tests ATH/ATL calculations for 100 tokens

### 8. Data Corruption Scenarios
- **Corrupted token addresses** - Tests with null bytes and special characters
- **Missing required fields** - Tests with NULL values in database

### 9. Extreme Concurrency Edge Cases
- **100 simultaneous requests for SAME token** - Tests deduplication and race conditions
- **Token deleted during ingestion** - Tests race condition handling

### 10. API Abuse Scenarios
- **Rapid-fire API requests** - Tests with 200 tokens to trigger rate limiting
- **API timeout with large date ranges** - Tests with 2 years of data

### 11. Memory Exhaustion
- **Millions of candles** - Tests with 1 year of 1-minute candles (525,600+ candles)

### 12. Database Connection Pool Exhaustion
- **500 concurrent requests** - Tests exceeding connection pool size

## Expected Behavior

### What Should Happen
- Tests should **expose real weaknesses** in the implementation
- System should **fail gracefully** with structured errors
- Memory should **not leak** over time
- Database connections should **not be exhausted**
- Rate limiting should be **handled gracefully**

### What Should NOT Happen
- **System crashes** - Should fail with errors, not crash
- **Memory leaks** - Memory should not grow unbounded
- **Data corruption** - Concurrent writes should not corrupt data
- **Silent failures** - All failures should be tracked and reported
- **Resource exhaustion** - System should handle limits gracefully

## Test Results Interpretation

### Passing Tests
- ✅ System handles extreme scenarios gracefully
- ✅ Errors are tracked and reported
- ✅ No memory leaks detected
- ✅ No data corruption

### Failing Tests (Expected)
- ❌ System crashes under load
- ❌ Memory leaks detected
- ❌ Data corruption under concurrency
- ❌ Silent failures (errors not tracked)
- ❌ Resource exhaustion (connections, memory)

## Fixing Issues

When tests fail:

1. **Don't disable the test** - Fix the implementation
2. **Add proper error handling** - Fail loudly with structured errors
3. **Add resource limits** - Prevent unbounded growth
4. **Add connection pooling** - Handle concurrent requests
5. **Add rate limiting** - Handle API rate limits gracefully
6. **Add data validation** - Reject invalid data early
7. **Add monitoring** - Track all errors and resource usage

## Performance Benchmarks

Expected performance (may vary):

- **1000 concurrent requests**: < 5 minutes
- **10,000 sequential requests**: < 10 minutes
- **1 year historical data**: < 5 minutes
- **500 concurrent requests**: < 15 minutes
- **Memory usage**: < 5GB for large datasets

## Prerequisites

**REQUIRED:**
- ✅ **PostgreSQL** running and accessible on `localhost:5432`
- ✅ **ClickHouse** running and accessible (configured via environment variables)
- ✅ **Sufficient system resources** (RAM, CPU, disk)

**OPTIONAL:**
- Birdeye API key (tests will fail gracefully if unavailable, but some tests require it)

## Setup

Before running these tests, ensure databases are running:

```bash
# Start PostgreSQL (if using Docker)
docker run -d --name postgres -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15

# Start ClickHouse (if using Docker)
docker run -d --name clickhouse -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server

# Or use your existing database instances
```

**Note:** If databases are not available, all tests will be skipped with a clear error message.

## Notes

- Tests use real database connections (not mocks)
- Tests create real data in databases (cleanup may be needed)
- Tests may take hours to complete all scenarios
- Tests are designed to be run in CI/CD with proper resource allocation

