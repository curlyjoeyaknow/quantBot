# Testing Strategy

## Test Organization

Tests are organized by package, with each package having its own test directory:

```
packages/
├── utils/
│   ├── src/
│   └── tests/          # Tests for utils package
├── storage/
│   ├── src/
│   └── tests/          # Tests for storage package
├── simulation/
│   ├── src/
│   └── tests/          # Tests for simulation package
├── services/
│   ├── src/
│   └── tests/          # Tests for services package
├── monitoring/
│   ├── src/
│   └── tests/          # Tests for monitoring package
└── bot/
    ├── src/
    └── tests/          # Tests for bot package
```

## Running Tests

### Run tests for a specific package:
```bash
npm run test --workspace=packages/utils
npm run test --workspace=packages/storage
npm run test --workspace=packages/simulation
npm run test --workspace=packages/services
npm run test --workspace=packages/monitoring
npm run test --workspace=packages/bot
```

### Run all package tests:
```bash
npm run test:packages
```

### Run tests with coverage:
```bash
npm run test:coverage --workspace=packages/utils
```

### Watch mode:
```bash
npm run test:watch --workspace=packages/utils
```

## Test Imports

Tests should use package imports, not relative paths:

```typescript
// ✅ Good - Package imports
import { logger } from '@quantbot/utils';
import { getClickHouseClient } from '@quantbot/storage';
import { simulateStrategy } from '@quantbot/simulation';

// ❌ Bad - Relative paths
import { logger } from '../../src/utils/logger';
import { getClickHouseClient } from '../../../storage/src/clickhouse-client';
```

## Mocking

When mocking dependencies, use package imports:

```typescript
import { vi } from 'vitest';
import { logger } from '@quantbot/utils';

vi.mock('@quantbot/utils', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));
```

## Test File Naming

Test files should follow the pattern:
- `*.test.ts` - Unit tests
- `*.spec.ts` - Specification tests (alternative naming)

## Package-Specific Test Configs

Each package has its own `vitest.config.ts` that:
- Includes tests from `tests/` and `src/` directories
- Sets up path aliases for package imports
- Configures coverage to include only the package's source code
- References shared setup files from the root `tests/` directory

## Migration Status

Tests have been moved to their respective packages. Some tests may still need import updates:

1. ✅ Test files copied to packages
2. ✅ Vitest configs created for each package
3. ⚠️ Import statements need updating (in progress)
4. ⚠️ Some tests may need dependency updates

## Updating Test Imports

To update test imports, follow this pattern:

1. Identify the package the test belongs to
2. Replace relative imports with package imports:
   - `../../src/utils/logger` → `@quantbot/utils`
   - `../../src/storage/clickhouse-client` → `@quantbot/storage`
   - `../../src/simulation/engine` → `@quantbot/simulation`
   - `../../src/services/SessionService` → `@quantbot/services`
   - `../../src/monitoring/helius-monitor` → `@quantbot/monitoring`
   - `../../src/bot/bot` → `@quantbot/bot`

3. Update mocks to use package imports
4. Ensure all dependencies are available in the package's `package.json`

## Integration Tests

Integration tests that span multiple packages should remain in the root `tests/integration/` directory and can import from multiple packages.

## Benefits

1. **Isolation**: Each package can be tested independently
2. **Clarity**: Tests are co-located with the code they test
3. **Maintainability**: Easier to find and update tests
4. **CI/CD**: Can run tests in parallel per package
5. **Coverage**: Package-level coverage reports

