# Package Consolidation Migration Guide

**Date**: 2026-01  
**Status**: ✅ Completed

## Overview

The codebase has been consolidated from **18 packages** down to **7 packages** to reduce duplication, simplify dependencies, and improve maintainability.

## New Package Structure

### Current Packages (7)

1. **@quantbot/core** - Foundation (types, ports, commands, domain)
2. **@quantbot/infra** - Infrastructure (utils, storage, observability, API clients)
3. **@quantbot/data** - Data layer (OHLCV, ingestion, jobs)
4. **@quantbot/simulation** - Simulation engine (engine, backtest, analytics)
5. **@quantbot/lab** - Research layer (lab, catalog, observatory)
6. **@quantbot/workflows** - Orchestration (workflow handlers)
7. **@quantbot/cli** - Application layer (CLI, API, lab-ui)

## Package Mapping

| Old Package(s) | New Package | Migration Path |
|----------------|-------------|----------------|
| `@quantbot/utils` | `@quantbot/infra/utils` | `@quantbot/utils` → `@quantbot/infra/utils` |
| `@quantbot/storage` | `@quantbot/infra/storage` | `@quantbot/storage` → `@quantbot/infra/storage` |
| `@quantbot/observability` | `@quantbot/infra/observability` | `@quantbot/observability` → `@quantbot/infra/observability` |
| `@quantbot/api-clients` | `@quantbot/infra/api-clients` | `@quantbot/api-clients` → `@quantbot/infra/api-clients` |
| `@quantbot/ohlcv` | `@quantbot/data/ohlcv` | `@quantbot/ohlcv` → `@quantbot/data/ohlcv` |
| `@quantbot/ingestion` | `@quantbot/data/ingestion` | `@quantbot/ingestion` → `@quantbot/data/ingestion` |
| `@quantbot/jobs` | `@quantbot/data/jobs` | `@quantbot/jobs` → `@quantbot/data/jobs` |
| `@quantbot/backtest` | `@quantbot/simulation` | `@quantbot/backtest` → `@quantbot/simulation` |
| `@quantbot/analytics` | `@quantbot/simulation` | `@quantbot/analytics` → `@quantbot/simulation` |
| `@quantbot/labcatalog` | `@quantbot/lab/catalog` | `@quantbot/labcatalog` → `@quantbot/lab/catalog` |
| `@quantbot/data-observatory` | `@quantbot/lab/observatory` | `@quantbot/data-observatory` → `@quantbot/lab/observatory` |
| `@quantbot/api` | `@quantbot/cli` | `@quantbot/api` → `@quantbot/cli` (CLI server mode) |
| `@quantbot/lab-ui` | `@quantbot/cli` | `@quantbot/lab-ui` → `@quantbot/cli` (CLI lab-ui command) |

## Backward Compatibility

### Re-export Shims

Old package names are still available as **re-export shims** for backward compatibility:

- ✅ `@quantbot/utils` → Re-exports from `@quantbot/infra/utils`
- ✅ `@quantbot/storage` → Re-exports from `@quantbot/infra/storage` (plus additional exports)
- ✅ `@quantbot/api-clients` → Re-exports from `@quantbot/infra/api-clients`
- ✅ `@quantbot/observability` → Re-exports from `@quantbot/infra/observability`

**Note**: These shims are deprecated but maintained for compatibility. New code should import directly from consolidated packages.

### Migration Strategy

1. **No Breaking Changes**: Existing imports continue to work via shims
2. **Gradual Migration**: Update imports incrementally as code is modified
3. **New Code**: Always use consolidated package names

## Migration Examples

### Before (Old Package Names)

```typescript
import { logger } from '@quantbot/utils';
import { StorageEngine } from '@quantbot/storage';
import { BirdeyeClient } from '@quantbot/api-clients';
import { OhlcvRepository } from '@quantbot/storage';
```

### After (New Package Names)

```typescript
import { logger } from '@quantbot/infra/utils';
import { StorageEngine } from '@quantbot/infra/storage';
import { BirdeyeClient } from '@quantbot/infra/api-clients';
import { OhlcvRepository } from '@quantbot/infra/storage';
```

### Subpath Exports

New packages support subpath exports for granular imports:

```typescript
// Infrastructure
import { logger } from '@quantbot/infra/utils';
import { StorageEngine } from '@quantbot/infra/storage';
import { performHealthCheck } from '@quantbot/infra/observability';
import { BirdeyeClient } from '@quantbot/infra/api-clients';

// Data
import { OhlcvService } from '@quantbot/data/ohlcv';
import { TelegramParser } from '@quantbot/data/ingestion';
import { OhlcvIngestionEngine } from '@quantbot/data/jobs';

// Lab
import { Catalog } from '@quantbot/lab/catalog';
import { DataSnapshotService } from '@quantbot/lab/observatory';
```

## Configuration Updates

### package.json

Build scripts have been updated to reflect the new package structure:

```json
{
  "scripts": {
    "build:ordered": "pnpm --filter @quantbot/core build && pnpm --filter @quantbot/infra build && ..."
  }
}
```

### tsconfig.json

Path mappings updated for new packages:

```json
{
  "compilerOptions": {
    "paths": {
      "@quantbot/infra": ["./packages/infra/src"],
      "@quantbot/data": ["./packages/data/src"],
      "@quantbot/simulation": ["./packages/simulation/src"],
      "@quantbot/lab": ["./packages/lab/src"]
    }
  }
}
```

### vitest.config.ts

Alias configuration updated for test resolution:

```typescript
resolve: {
  alias: {
    '@quantbot/infra': resolveFromRoot('packages/infra/src'),
    '@quantbot/data': resolveFromRoot('packages/data/src'),
    // ... legacy aliases maintained for backward compatibility
  }
}
```

## Benefits

1. **Reduced Duplication**: Eliminated ~7,000 lines of duplicated code (backtest/sim copy)
2. **Simpler Dependencies**: Clearer dependency graph with fewer packages
3. **Better Organization**: Related functionality grouped logically
4. **Easier Maintenance**: Single source of truth for consolidated functionality
5. **Faster Builds**: Fewer packages to build and link

## Breaking Changes

**None** - All old package imports continue to work via backward-compatibility shims.

## Future Work

- [ ] Migrate remaining imports from old package names to consolidated packages
- [ ] Remove backward-compatibility shims after full migration
- [ ] Update documentation references to use new package names

## References

- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - Complete architecture documentation
- [Package Consolidation Plan](../../.cursor/plans/package_consolidation_b2dc7244.plan.md) - Original consolidation plan

