# Integration Test Setup Guide

## Quick Start

To run integration tests that require ClickHouse:

```bash
# Option 1: Automatic setup (recommended)
pnpm test:all

# Option 2: Manual setup
pnpm test:setup
RUN_DB_STRESS=1 pnpm test
```

## What Gets Set Up

The `pnpm test:setup` command:
1. **Starts ClickHouse** via Docker Compose (if not already running)
2. **Waits for ClickHouse** to be ready (health check)
3. **Initializes database schema** (creates tables)
4. **Creates test data**:
   - `candles_1m`: 1440 records for `2025-12-01`
   - `candles_1s`: 3600 records (1 hour) for `2025-12-01`
   - `candles_15s`: 5760 records for `2025-12-01`
   - Test token: `So11111111111111111111111111111111111111112` (SOL)

## ClickHouse Configuration

### Docker Compose Setup

ClickHouse runs via Docker Compose with these ports:
- **HTTP interface**: `18123` (mapped from container's `8123`)
- **Native protocol**: `19000` (mapped from container's `9000`)

### Default Credentials

- **Host**: `127.0.0.1` (localhost)
- **HTTP Port**: `18123`
- **User**: `default`
- **Password**: `UxdtDJVj` (from docker-compose.yml)
- **Database**: `quantbot`

### Environment Variables

You can override defaults via environment variables:

```bash
export CLICKHOUSE_HOST=127.0.0.1
export CLICKHOUSE_HTTP_PORT=18123
export CLICKHOUSE_USER=default
export CLICKHOUSE_PASSWORD=UxdtDJVj
export CLICKHOUSE_DATABASE=quantbot
```

## Test Behavior

### Integration Tests

Integration tests that require ClickHouse:
- **Location**: `packages/workflows/tests/integration/slice-export-e2e.test.ts`
- **Behavior**: Tests are automatically skipped if ClickHouse is not available
- **Gate**: Tests use `it.skipIf(!clickHouseAvailable)` to skip gracefully

### Running Tests

```bash
# Run all tests (unit + integration)
RUN_DB_STRESS=1 pnpm test

# Run only integration tests
RUN_DB_STRESS=1 pnpm test:integration

# Run specific test file
RUN_DB_STRESS=1 pnpm --filter @quantbot/workflows test slice-export-e2e.test.ts
```

## Troubleshooting

### ClickHouse Not Starting

```bash
# Check if Docker is running
docker ps

# Check ClickHouse container status
docker-compose ps clickhouse

# View ClickHouse logs
docker-compose logs clickhouse

# Restart ClickHouse
docker-compose restart clickhouse
```

### Connection Errors

If tests fail with connection errors:

1. **Verify ClickHouse is running**:
   ```bash
   curl http://localhost:18123/ping
   # Should return: Ok
   ```

2. **Check port configuration**:
   - Ensure `CLICKHOUSE_HTTP_PORT=18123` is set
   - Or use `CLICKHOUSE_PORT=18123` (both work)

3. **Verify credentials**:
   - Default user: `default`
   - Default password: `UxdtDJVj` (from docker-compose.yml)

### Test Data Issues

If tests fail because data doesn't exist:

```bash
# Re-run setup to create test data
pnpm test:setup

# Or skip test data creation if it already exists
SKIP_TEST_DATA=1 pnpm test:setup
```

## Manual ClickHouse Setup

If you prefer to run ClickHouse manually (not via Docker):

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
   ```

3. **Initialize schema**:
   ```bash
   # Connect
   clickhouse-client
   
   # Create database
   CREATE DATABASE IF NOT EXISTS quantbot;
   
   # Run schema initialization
   # (see packages/storage/src/clickhouse/schema.sql)
   ```

4. **Set environment variables**:
   ```bash
   export CLICKHOUSE_HOST=127.0.0.1
   export CLICKHOUSE_HTTP_PORT=8123  # Default ClickHouse port
   export CLICKHOUSE_USER=default
   export CLICKHOUSE_PASSWORD=  # Empty for default
   export CLICKHOUSE_DATABASE=quantbot
   ```

## CI/CD Setup

For CI/CD pipelines, ensure:

1. **Docker is available** in the CI environment
2. **Run setup before tests**:
   ```bash
   pnpm test:setup
   RUN_DB_STRESS=1 pnpm test
   ```
3. **Tests gracefully skip** if ClickHouse is unavailable (no CI failures)

## Next Steps

- See [TEST_SETUP_REQUIREMENTS.md](./TEST_SETUP_REQUIREMENTS.md) for full test setup documentation
- See [docker-compose.yml](../../docker-compose.yml) for service configuration

