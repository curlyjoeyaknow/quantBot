# Modular Architecture

This document describes the modular structure of the QuantBot codebase after the incremental migration to a monorepo-style workspace.

## Package Structure

The codebase is organized into the following packages:

### `@quantbot/utils`
**Location:** `packages/utils/`

Shared utilities and helper functions used across all packages.

**Exports:**
- Logger and logging utilities
- Database utilities
- Error handling classes
- Pump.fun utilities
- Credit monitoring
- Caller database utilities
- Live trade utilities
- Monitored tokens
- Historical candles fetcher
- Repeat simulation helper

**Dependencies:** 
- External: `dotenv`, `luxon`, `winston`, `zod`
- Internal: None (base package)

### `@quantbot/storage`
**Location:** `packages/storage/`

Storage layer for all database interactions (ClickHouse, Postgres, InfluxDB, SQLite).

**Exports:**
- ClickHouse client
- Postgres client
- InfluxDB client
- Caller database
- Repository pattern

**Dependencies:**
- External: `@clickhouse/client`, `pg`, `sqlite3`, `@influxdata/influxdb-client`
- Internal: `@quantbot/utils`

### `@quantbot/simulation`
**Location:** `packages/simulation/`

Trading simulation engine with strategy definitions and optimization.

**Exports:**
- Simulation engine
- Candle utilities
- Configuration schemas
- Technical indicators
- Ichimoku calculations
- Signals
- Sinks
- Target resolver
- Strategy builder
- Optimization tools

**Dependencies:**
- External: `luxon`, `zod`
- Internal: `@quantbot/utils`, `@quantbot/storage`

### `@quantbot/monitoring`
**Location:** `packages/monitoring/`

Real-time monitoring and stream services for Solana blockchain data.

**Exports:**
- Helius monitor
- Stream recorder
- Backfill service
- Pump.fun lifecycle tracker
- OHLCV aggregator
- Monitoring services (Brook, CurlyJoe, CA monitoring, live trade alerts, Tenkan-Kijun alerts)

**Dependencies:**
- External: `@solana/web3.js`, `@triton-one/yellowstone-grpc`, `axios`, `telegraf`, `ws`
- Internal: `@quantbot/utils`, `@quantbot/storage`

### `@quantbot/services`
**Location:** `packages/services/`

Business logic services for the application.

**Exports:**
- Session service
- Simulation service
- Strategy service
- Ichimoku workflow service
- CA detection service
- Text workflow handler
- OHLCV services (engine, query, ingestion, service)
- Token services (service, filter)
- Results service
- Caller tracking
- Chat extraction engine

**Dependencies:**
- External: `axios`, `cheerio`, `luxon`, `telegraf`
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/simulation`

### `@quantbot/bot`
**Location:** `packages/bot/`

Telegram bot implementation with command handlers and event system.

**Exports:**
- Bot instance
- Service container
- Command registry
- Command handlers
- Event bus and handlers
- Health check
- Configuration

**Dependencies:**
- External: `telegraf`, `dotenv`
- Internal: All other packages

## Workspace Configuration

The project uses npm workspaces for package management:

```json
{
  "workspaces": ["packages/*"]
}
```

Each package has its own:
- `package.json` with dependencies
- `tsconfig.json` extending the root config
- `src/` directory with source code
- `dist/` directory for compiled output (generated)

## TypeScript Configuration

The root `tsconfig.json` includes path mappings for all packages:

```json
{
  "paths": {
    "@quantbot/utils": ["./packages/utils/src"],
    "@quantbot/storage": ["./packages/storage/src"],
    "@quantbot/monitoring": ["./packages/monitoring/src"],
    "@quantbot/simulation": ["./packages/simulation/src"],
    "@quantbot/services": ["./packages/services/src"],
    "@quantbot/bot": ["./packages/bot/src"]
  }
}
```

Packages use TypeScript project references for incremental compilation:

```json
{
  "references": [
    { "path": "../utils" },
    { "path": "../storage" }
  ]
}
```

## Building and Testing

### Build all packages:
```bash
npm run build:packages
```

### Test all packages:
```bash
npm run test:packages
```

### Build/test individual package:
```bash
npm run build --workspace=packages/utils
npm run test --workspace=packages/utils
```

## Migration Status

The migration is complete for:
- ✅ Utilities package
- ✅ Storage package
- ✅ Simulation package
- ✅ Services package
- ✅ Monitoring package
- ✅ Bot package

### Remaining Work

Some files in `src/` still exist for backward compatibility and will be gradually migrated:
- API clients (`src/api/`) - Can be moved to `@quantbot/api` package
- Analysis modules (`src/analysis/`) - Can be moved to `@quantbot/analysis` package
- Reporting modules (`src/reporting/`) - Can be moved to `@quantbot/reporting` package
- Data loaders (`src/data/`) - Can be moved to `@quantbot/data` package
- Types (`src/types/`) - Can be moved to `@quantbot/types` package
- WebSocket utilities (`src/websocket/`) - Can be moved to `@quantbot/monitoring` or separate package

## Import Guidelines

### Use package imports:
```typescript
import { logger } from '@quantbot/utils';
import { getClickHouseClient } from '@quantbot/storage';
import { simulateStrategy } from '@quantbot/simulation';
```

### Avoid relative imports across packages:
```typescript
// ❌ Bad
import { logger } from '../../../utils/logger';

// ✅ Good
import { logger } from '@quantbot/utils';
```

### Internal package imports (within same package):
```typescript
// ✅ OK - relative imports within same package
import { helper } from './helper';
```

## Benefits

1. **Clear Boundaries**: Each package has a well-defined responsibility
2. **Independent Testing**: Packages can be tested in isolation
3. **Incremental Compilation**: TypeScript project references enable faster builds
4. **Dependency Management**: Clear dependency graph prevents circular dependencies
5. **Code Reusability**: Packages can be used independently or in other projects
6. **Better Organization**: Related code is grouped together logically

## Next Steps

1. Complete migration of remaining `src/` modules to appropriate packages
2. Set up CI/CD to build and test packages independently
3. Add package-level documentation
4. Consider publishing packages to npm (if needed)
5. Add integration tests that verify cross-package interactions

