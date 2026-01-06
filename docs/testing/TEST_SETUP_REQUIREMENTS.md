# Test Setup Requirements

This document describes the specific setup required to run all tests, including integration tests that require external services.

## Quick Summary

**For basic unit tests**: No setup required - just run `pnpm test`

**For full test suite with integration tests**: 
- ClickHouse will be automatically started via Docker Compose
- Test data will be automatically created in ClickHouse
- **Just run**: `pnpm test:all` or `pnpm test:coverage:with-db`
- Or manually: `RUN_DB_STRESS=1 pnpm test:coverage` (after running `pnpm test:setup`)

**What test data is created?**
- `candles_1m`: 1440 records (24 hours) for `2025-12-01`
- `candles_1s`: 3600 records (1 hour) for `2025-12-01`  
- `candles_15s`: 5760 records (24 hours) for `2025-12-01`
- Test token: `So11111111111111111111111111111111111111112` (SOL)
- Chain: `sol`

## Test Categories

### 1. Unit Tests (No Setup Required)
- **Location**: `packages/**/tests/unit/**/*.test.ts`
- **Requirements**: None
- **Run**: `pnpm test` (unit tests run by default)

### 2. Integration Tests (Requires Services)

#### ClickHouse Integration Tests
- **Location**: 
  - `packages/workflows/tests/integration/slice-export*.test.ts`
  - `packages/cli/tests/integration/handlers/ingest-ohlcv.integration.test.ts`
  - `packages/data-observatory/tests/integration/snapshot-integration.test.ts`
- **Requirements**:
  - ClickHouse will be automatically started via Docker Compose
  - Schema and test data are automatically created
  - Test data includes: `candles_1m`, `candles_1s`, `candles_15s` for date `2025-12-01`
- **Environment Variables**:
  ```bash
  RUN_DB_STRESS=1  # Required to enable these tests (auto-starts ClickHouse)
  # Optional overrides:
  CLICKHOUSE_HOST=localhost
  CLICKHOUSE_PORT=18123  # or 8123 if using default port
  CLICKHOUSE_USER=default
  CLICKHOUSE_PASSWORD=  # empty for default
  CLICKHOUSE_DATABASE=quantbot
  ```

#### DuckDB Integration Tests
- **Location**: Various integration tests
- **Requirements**:
  - DuckDB file path (defaults to `data/tele.duckdb`)
  - Test data in DuckDB tables
  - Python dependencies installed (see [Python Setup](#python-setup) below)
- **Environment Variables**:
  ```bash
  DUCKDB_PATH=data/tele.duckdb  # or path to test database
  ```

#### Python Bridge Integration Tests
- **Location**: 
  - `packages/utils/tests/integration/python-bridge.test.ts`
  - `packages/utils/tests/integration/duckdb-storage-bridge.test.ts`
- **Requirements**:
  - Python 3.8+ with dependencies installed (see [Python Setup](#python-setup) below)
  - These tests run Python scripts via PythonEngine and validate JSON output contracts

### 3. Property Tests (May Require Services)
- **Location**: `packages/**/tests/properties/**/*.test.ts`
- **Requirements**: Usually none (pure property-based tests)
- **Note**: Some property tests may fail due to edge cases or flakiness

### 4. Stress Tests (Requires Services + Flags)
- **Location**: `packages/**/tests/stress/**/*.test.ts`
- **Requirements**: 
  - ClickHouse, DuckDB, Postgres (depending on test)
  - Environment flags to enable
- **Environment Variables**:
  ```bash
  RUN_DB_STRESS=1           # Enable database stress tests
  RUN_CHAOS_TESTS=1         # Enable chaos engineering tests
  RUN_INTEGRATION_STRESS=1  # Enable integration stress tests
  ```

## Setup Instructions

### Automatic Setup (Recommended)

**ClickHouse is automatically started when running tests with `RUN_DB_STRESS=1`**

The test setup script (`scripts/test/setup-clickhouse.ts`) will:
1. Check if ClickHouse is already running
2. Start ClickHouse via Docker Compose if needed
3. Wait for ClickHouse to be ready
4. Initialize the database schema
5. Create test data (candles for 2025-12-01)

**No manual setup required!** Just run:
```bash
RUN_DB_STRESS=1 pnpm test:coverage
```

### Manual Setup (Optional)

If you want to manually control ClickHouse:

```bash
# Start ClickHouse only
docker-compose up -d clickhouse

# Verify ClickHouse is running
curl http://localhost:18123/ping

# Run setup script manually
pnpm test:setup

# Stop ClickHouse
docker-compose stop clickhouse
```

**Services provided**:
- ClickHouse on port `18123` (HTTP) and `19000` (native)
- InfluxDB on port `8086` (optional, for metrics)

### Option 2: Manual Setup

#### ClickHouse Setup

1. **Install ClickHouse**:
   ```bash
   # macOS
   brew install clickhouse
   
   # Linux
   # See: https://clickhouse.com/docs/en/install
   ```

2. **Start ClickHouse**:
   ```bash
   clickhouse-server
   # or with systemd
   sudo systemctl start clickhouse-server
   ```

3. **Initialize Schema**:
   ```bash
   # Connect to ClickHouse
   clickhouse-client
   
   # Create database
   CREATE DATABASE IF NOT EXISTS quantbot;
   
   # Create tables (see packages/storage/src/clickhouse/schema.sql)
   # Or run migration scripts
   ```

4. **Verify Connection**:
   ```bash
   curl http://localhost:8123/ping
   # Should return: Ok
   ```

#### DuckDB Setup

DuckDB is file-based, so no server setup is needed. Just ensure:
- Write permissions to the `data/` directory
- Test database file path is accessible

```bash
# Create data directory if it doesn't exist
mkdir -p data

# Set DuckDB path
export DUCKDB_PATH=data/tele.duckdb
```

#### Python Setup

Integration tests that use Python scripts require Python dependencies:

```bash
# Create virtual environment (if not already created)
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate  # On Linux/macOS
# or
.venv\Scripts\activate  # On Windows

# Install Python dependencies for telegram tools
cd tools/telegram
pip install -r requirements.txt

# Install Python dependencies for simulation tools
cd ../simulation
pip install -r requirements.txt

# Return to project root
cd ../..
```

**Required Python packages**:

For Telegram ingestion (`tools/telegram/requirements.txt`):
- `ijson>=3.2.3` (for JSON streaming)
- `duckdb>=0.9.0` (for DuckDB operations)
- `numpy>=1.24.0`, `pandas>=2.0.0` (for data processing)
- `scipy>=1.10.0`, `scikit-learn>=1.3.0` (for ML features, optional)

For Simulation tools (`tools/simulation/requirements.txt`):
- `pydantic>=2.0.0` (for data validation)
- `duckdb>=0.9.0` (for DuckDB operations)

**Note**: If Python dependencies are not installed, Python bridge integration tests will fail with `ModuleNotFoundError`. These tests can be skipped by not running the integration test suite.

## Environment Variables

Create a `.env` file (or export variables) with:

```bash
# ClickHouse Configuration
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=18123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=quantbot

# DuckDB Configuration
DUCKDB_PATH=data/tele.duckdb

# Test Gating Flags
RUN_DB_STRESS=1              # Enable database integration tests
RUN_CHAOS_TESTS=0            # Disable chaos tests (optional)
RUN_INTEGRATION_STRESS=0     # Disable integration stress tests (optional)

# Note: Postgres has been removed - no longer required
```

## Running Tests

### Run All Tests (Unit + Integration)
```bash
# Easiest way - setup and tests in one command
pnpm test:all

# Or manually:
pnpm test:setup && RUN_DB_STRESS=1 pnpm test:coverage
```

**What happens automatically**:
1. `pnpm test:setup` runs first:
   - Starts ClickHouse via Docker Compose (if not running)
   - Waits for ClickHouse to be ready
   - Initializes database schema
   - Creates test data (candles_1m, candles_1s, candles_15s for 2025-12-01)
2. Tests run with `RUN_DB_STRESS=1` to enable integration tests

### Run Only Unit Tests (No Setup Required)
```bash
pnpm test
```

### Run Integration Tests Only
```bash
RUN_DB_STRESS=1 pnpm test:integration
```

### Run Stress Tests
```bash
RUN_DB_STRESS=1 RUN_CHAOS_TESTS=1 RUN_INTEGRATION_STRESS=1 pnpm test:stress
```

### Run Specific Test Categories
```bash
# Unit tests only
pnpm test:unit

# Integration tests only
RUN_DB_STRESS=1 pnpm test:integration

# Property tests only
pnpm test:properties

# Fuzzing tests only
pnpm test:fuzzing
```

## Test Data Requirements

### ClickHouse Test Data

**Test data is automatically created by the setup script!**

The setup script creates test data in the `ohlcv_candles` table:
- **candles_1m**: 1440 records (24 hours of 1-minute candles) for `2025-12-01`
- **candles_1s**: 3600 records (1 hour of 1-second candles) for `2025-12-01`
- **candles_15s**: 5760 records (24 hours of 15-second candles) for `2025-12-01`

**Test token**: `So11111111111111111111111111111111111111112` (SOL)
**Test date**: `2025-12-01`
**Chain**: `sol`

**No manual data population needed!** The setup script handles everything.

**To skip test data creation** (if you have your own data):
```bash
SKIP_TEST_DATA=1 RUN_DB_STRESS=1 pnpm test:coverage
```

### DuckDB Test Data

Integration tests create temporary DuckDB files with test data. No manual setup required, but ensure:
- Write permissions to temp directory
- Sufficient disk space

## Troubleshooting

### ClickHouse Connection Failures

**Error**: `Connection refused` or `ECONNREFUSED`

**Solutions**:
1. Verify ClickHouse is running:
   ```bash
   curl http://localhost:18123/ping
   ```

2. Check port mapping (Docker uses `18123`, default is `8123`):
   ```bash
   # If using Docker
   CLICKHOUSE_PORT=18123
   
   # If using local ClickHouse
   CLICKHOUSE_PORT=8123
   ```

3. Check firewall/network settings

### DuckDB Permission Errors

**Error**: `EACCES` or permission denied

**Solutions**:
1. Check write permissions:
   ```bash
   ls -la data/
   chmod 755 data/
   ```

2. Use a different path:
   ```bash
   export DUCKDB_PATH=/tmp/test.duckdb
   ```

### Tests Skipped When They Should Run

**Issue**: Tests are skipped even with services running

**Solutions**:
1. Verify environment variables are set:
   ```bash
   echo $RUN_DB_STRESS
   # Should output: 1
   ```

2. Check test gating logic:
   - Tests use `shouldRunDbStress()` which checks `RUN_DB_STRESS=1`
   - Must be exactly `1`, `true`, or `yes` (case-sensitive)

3. Run with explicit environment:
   ```bash
   RUN_DB_STRESS=1 pnpm test:coverage
   ```

### Missing Test Data

**Error**: Tests fail with "no data" or "empty result"

**Solutions**:
1. Populate ClickHouse with test data (see "Test Data Requirements" above)
2. Check date ranges in tests match your data
3. Verify table schemas match expected structure

## CI/CD Setup

For CI/CD pipelines, use Docker Compose:

```yaml
# Example GitHub Actions
- name: Start services
  run: docker-compose up -d

- name: Wait for ClickHouse
  run: |
    until curl -f http://localhost:18123/ping; do
      sleep 1
    done

- name: Run tests
  run: RUN_DB_STRESS=1 pnpm test:coverage
  env:
    CLICKHOUSE_HOST: localhost
    CLICKHOUSE_PORT: 18123
    CLICKHOUSE_DATABASE: quantbot
```

## Current Test Status

As of the latest run:
- **Unit Tests**: ✅ 2,696 passing (97.2% pass rate)
- **Integration Tests**: ⚠️ 76 failing (mostly due to missing services/data)
- **Total**: 2,839 tests (2,696 passing, 76 failing, 67 skipped)

**Most common failure reasons**:
1. ClickHouse not running or not accessible
2. Missing test data in ClickHouse
3. Environment variables not set (`RUN_DB_STRESS=1`)
4. Property tests hitting edge cases (may be flaky)

## Next Steps

To get all tests passing:

**That's it!** Just run:
```bash
pnpm test:all
```

Or if you prefer step-by-step:
```bash
# 1. Setup ClickHouse and test data
pnpm test:setup

# 2. Run tests with integration tests enabled
RUN_DB_STRESS=1 pnpm test:coverage
```

The test suite will automatically:
1. ✅ Start ClickHouse via Docker Compose (if not running)
2. ✅ Initialize database schema
3. ✅ Create test data (candles for 2025-12-01)
4. ✅ Run all tests

**No manual setup required!**

## Test Data Details

The setup script creates test data in ClickHouse's `ohlcv_candles` table:

- **candles_1m**: 1440 records (24 hours of 1-minute candles)
- **candles_1s**: 3600 records (1 hour of 1-second candles)  
- **candles_15s**: 5760 records (24 hours of 15-second candles)

**Test token**: `So11111111111111111111111111111111111111112` (SOL)
**Test date**: `2025-12-01`
**Chain**: `sol`

This data is sufficient for all integration tests that query candles for date ranges around `2025-12-01`.

