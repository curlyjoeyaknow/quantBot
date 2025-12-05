# Package Migration Guide

This guide helps update existing code to use the new package structure.

## Import Path Updates

### Old → New Import Mappings

| Old Path | New Package Import |
|----------|-------------------|
| `../src/utils/logger` | `@quantbot/utils` |
| `../src/utils/database` | `@quantbot/utils` |
| `../src/utils/errors` | `@quantbot/utils` |
| `../src/utils/pumpfun` | `@quantbot/utils` |
| `../src/utils/credit-monitor` | `@quantbot/utils` |
| `../src/storage/clickhouse-client` | `@quantbot/storage` |
| `../src/storage/postgres-client` | `@quantbot/storage` |
| `../src/storage/influxdb-client` | `@quantbot/storage` |
| `../src/storage/repository` | `@quantbot/storage` |
| `../src/simulation/engine` | `@quantbot/simulation` |
| `../src/simulation/candles` | `@quantbot/simulation` |
| `../src/simulation/config` | `@quantbot/simulation` |
| `../src/simulation/indicators` | `@quantbot/simulation` |
| `../src/simulation/ichimoku` | `@quantbot/simulation` |
| `../src/simulation/signals` | `@quantbot/simulation` |
| `../src/simulation/strategies/*` | `@quantbot/simulation` |
| `../src/services/SessionService` | `@quantbot/services` |
| `../src/services/SimulationService` | `@quantbot/services` |
| `../src/services/StrategyService` | `@quantbot/services` |
| `../src/services/ohlcv-*` | `@quantbot/services` |
| `../src/services/token-*` | `@quantbot/services` |
| `../src/monitoring/*` | `@quantbot/monitoring` |
| `../src/helius-monitor` | `@quantbot/monitoring` |
| `../src/bot/bot` | `@quantbot/bot` |
| `../src/commands/*` | `@quantbot/bot` |
| `../src/container/*` | `@quantbot/bot` |

## Database File Paths

Database files remain at the root level:
- `simulations.db` - SQLite database for simulations
- `quantbot.db` - Main SQLite database
- `data/` - Data directory (cache, exports, raw data)

These paths are referenced in:
- `packages/utils/src/database.ts` - Uses `process.cwd()` to find DB files
- Scripts that read/write database files

## Script Updates

Scripts in `scripts/` directory should be updated to use package imports:

```typescript
// ❌ Old
import { logger } from '../src/utils/logger';
import { getClickHouseClient } from '../src/storage/clickhouse-client';

// ✅ New
import { logger } from '@quantbot/utils';
import { getClickHouseClient } from '@quantbot/storage';
```

## Test Updates

Tests should be moved to their respective packages:
- `tests/unit/logger.test.ts` → `packages/utils/tests/logger.test.ts`
- `tests/unit/engine.test.ts` → `packages/simulation/tests/engine.test.ts`
- etc.

Update test imports to use package imports.

## Web Package

The web package (`packages/web/`) should import from other packages:

```typescript
// ✅ Good
import { logger } from '@quantbot/utils';
import { simulateStrategy } from '@quantbot/simulation';
import { getClickHouseClient } from '@quantbot/storage';
```

## Remaining Files in `src/`

Some files remain in `src/` for backward compatibility:
- `src/api/` - API clients (can be moved to `@quantbot/api` package later)
- `src/analysis/` - Analysis modules (can be moved to `@quantbot/analysis` package later)
- `src/reporting/` - Reporting modules (can be moved to `@quantbot/reporting` package later)
- `src/data/loaders/` - Data loaders (can be moved to `@quantbot/data` package later)
- `src/types/` - Shared types (can be moved to `@quantbot/types` package later)

These can be migrated incrementally as needed.

## TypeScript Configuration

Ensure `tsconfig.json` includes path mappings:

```json
{
  "compilerOptions": {
    "paths": {
      "@quantbot/utils": ["./packages/utils/src"],
      "@quantbot/storage": ["./packages/storage/src"],
      "@quantbot/simulation": ["./packages/simulation/src"],
      "@quantbot/services": ["./packages/services/src"],
      "@quantbot/monitoring": ["./packages/monitoring/src"],
      "@quantbot/bot": ["./packages/bot/src"]
    }
  }
}
```

## Automated Migration

To find files that need updating:

```bash
# Find files with old import patterns
grep -r "from.*['\"]\.\./src/" scripts/ tests/ --include="*.ts" --include="*.tsx"

# Find files with old relative paths
grep -r "src/(utils|storage|simulation|services|monitoring|bot)/" . --include="*.ts" --include="*.tsx"
```

## Checklist

- [ ] Update all imports in `scripts/` directory
- [ ] Update all imports in test files
- [ ] Update imports in `packages/web/` if any
- [ ] Update database path references if needed
- [ ] Update `.cursorrules` (already done)
- [ ] Update documentation references
- [ ] Verify all packages build successfully
- [ ] Run tests to ensure nothing broke

