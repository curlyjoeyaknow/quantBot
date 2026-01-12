# Test Environment Setup

This document describes how test environments are automatically set up for integration tests.

## Overview

Integration tests require various environments:

- **Python 3.8+** with dependencies (duckdb, pydantic)
- **DuckDB** (via Python bindings)
- **ClickHouse** (via Docker Compose)

The test suite now automatically sets up these environments when needed.

## Automatic Setup

### Option 1: Auto-setup via Environment Variable

Set `AUTO_SETUP_ENV=1` to automatically set up environments before tests run:

```bash
AUTO_SETUP_ENV=1 pnpm test
```

This will:

1. Check if Python 3 is available
2. Install Python dependencies if missing
3. Start ClickHouse via Docker Compose if not running
4. Verify all environments are ready

### Option 2: Manual Setup Script

Run the setup script manually:

```bash
pnpm test:setup:all
```

This script:

- Checks current environment status
- Sets up missing environments
- Reports final status

### Option 3: Test-Specific Setup

Individual integration tests can set up their required environments:

```typescript
import { setupPythonEnvironment, checkPythonEnvironment } from '@quantbot/utils/test-helpers/test-environment-setup';

describe('My Integration Test', () => {
  let pythonReady = false;

  beforeAll(async () => {
    try {
      await setupPythonEnvironment();
      const env = checkPythonEnvironment();
      pythonReady = env.python3Available && env.dependenciesInstalled;
    } catch (error) {
      console.warn('Python setup failed:', error);
    }
  });

  it('my test', async () => {
    if (!pythonReady) {
      console.warn('Python not ready, skipping');
      return;
    }
    // ... test code
  });
});
```

## Environment Checks

### Python Environment

Checks:

- Python 3.8+ is installed
- Required packages: `duckdb`, `pydantic`

Setup:

- Attempts to install missing packages via `pip3 install duckdb pydantic`

### DuckDB Environment

Checks:

- DuckDB Python bindings are available
- Test directory is writeable

Setup:

- No automatic setup (relies on Python environment)

### ClickHouse Environment

Checks:

- ClickHouse is accessible at configured host/port
- Default: `localhost:18123`

Setup:

- Starts ClickHouse via `docker-compose up -d clickhouse`
- Waits up to 30 seconds for ClickHouse to be ready

## Test Utilities

### Check Environment Status

```typescript
import { checkAllEnvironments } from '@quantbot/utils/test-helpers/test-environment-setup';

const status = checkAllEnvironments();
console.log(status.allReady); // true if all environments ready
```

### Setup All Environments

```typescript
import { setupAllEnvironments } from '@quantbot/utils/test-helpers/test-environment-setup';

const status = await setupAllEnvironments();
if (!status.allReady) {
  console.warn('Some environments not ready');
}
```

### Skip Test if Environment Not Ready

```typescript
import { skipIfEnvironmentNotReady, checkAllEnvironments } from '@quantbot/utils/test-helpers/test-environment-setup';

const status = checkAllEnvironments();
skipIfEnvironmentNotReady(status, 'Python required for this test');
```

## Configuration

### Environment Variables

- `AUTO_SETUP_ENV=1` - Enable automatic environment setup
- `CLICKHOUSE_HOST` - ClickHouse host (default: `localhost`)
- `CLICKHOUSE_PORT` - ClickHouse port (default: `18123`)
- `CLICKHOUSE_DATABASE` - ClickHouse database (default: `quantbot`)
- `DUCKDB_PATH` - DuckDB file path for tests

### Python Dependencies

Required Python packages:

- `duckdb` - DuckDB Python bindings
- `pydantic` - Data validation

Install manually if auto-setup fails:

```bash
pip3 install duckdb pydantic
```

## Troubleshooting

### Python Not Found

**Error**: `Python 3 is not available`

**Solution**: Install Python 3.8+:

```bash
# Ubuntu/Debian
sudo apt-get install python3 python3-pip

# macOS
brew install python3
```

### Python Dependencies Not Installing

**Error**: `Failed to install Python dependencies automatically`

**Solution**: Install manually:

```bash
pip3 install duckdb pydantic
```

### ClickHouse Not Starting

**Error**: `ClickHouse failed to start within 30 seconds`

**Solutions**:

1. Check Docker is running: `docker ps`
2. Check docker-compose.yml exists
3. Start manually: `docker-compose up -d clickhouse`
4. Check logs: `docker-compose logs clickhouse`

### DuckDB Not Writeable

**Error**: `DuckDB test directory is not writeable`

**Solution**: Check permissions:

```bash
ls -la data/
chmod 755 data/
```

## CI/CD Integration

In CI/CD pipelines, set up environments before running tests:

```yaml
# GitHub Actions example
- name: Setup test environments
  run: pnpm test:setup:all

- name: Run tests
  run: pnpm test
```

Or use auto-setup:

```yaml
- name: Run tests with auto-setup
  run: AUTO_SETUP_ENV=1 pnpm test
  env:
    CLICKHOUSE_HOST: localhost
    CLICKHOUSE_PORT: 18123
```

## Best Practices

1. **Use beforeAll hooks** - Set up environments once per test suite
2. **Skip gracefully** - Check environment status and skip tests if not ready
3. **Clean up** - Use afterAll hooks to clean up test data
4. **Document requirements** - Mention required environments in test descriptions

## Related Documentation

- [Test Setup Requirements](./TEST_SETUP_REQUIREMENTS.md) - Detailed test setup guide
- [Test Gating](./test-gating.ts) - Environment variable gating for tests
