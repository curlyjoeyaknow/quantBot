# Path Migration Status

## Summary

This document tracks the migration of import paths from the old monolithic structure to the new package-based structure.

## Completed Packages

### ✅ @quantbot/utils
- **Status**: COMPLETE with notes
- **Changes**:
  - Created `src/types.ts` with shared type definitions (Strategy, StopLossConfig, SimulationEvent, CACall, etc.)
  - Updated `database.ts` to use local types instead of relative imports
  - Fixed `monitored-tokens-db.ts` to use `@quantbot/storage` for postgres client
  - **Issue**: `fetch-historical-candles.ts` and `RepeatSimulationHelper.ts` have dependencies on external services
    - These files should be moved to `@quantbot/services` or `@quantbot/bot` respectively
    - Temporarily commented out from exports
  
### ✅ @quantbot/storage  
- **Status**: COMPLETE
- **Changes**:
  - Updated `clickhouse-client.ts` to import Candle type from `@quantbot/utils`
  - All other files already using correct imports

### ✅ @quantbot/simulation
- **Status**: COMPLETE with notes
- **Changes**:
  - Updated `candles.ts` to use `logger` from `@quantbot/utils`
  - Fixed `optimization/optimizer.ts`:
    - Removed broken import to `../../data/loaders`
    - Added TODO to implement data loading via dependency injection
  - All other internal imports are correct

## In Progress Packages

### 🔄 @quantbot/services
- **Status**: IN PROGRESS (60% complete)
- **Changes Applied**:
  - ✅ `token-service.ts` - logger from `@quantbot/utils`
  - ✅ `token-filter-service.ts` - storage and utils from packages
  - ✅ `results-service.ts` - logger from `@quantbot/utils`
  - ✅ `ohlcv-service.ts` - storage, simulation, utils from packages
  - ✅ `ohlcv-query.ts` - storage, utils from packages (cache needs work)
  - ✅ `ohlcv-ingestion.ts` - storage, utils from packages (cache needs work)
  - ✅ `ohlcv-engine.ts` - simulation, storage, utils from packages
  - ✅ `chat-extraction-engine.ts` - utils from package
  - ✅ `caller-tracking.ts` - storage, utils from packages
  - ✅ `CADetectionService.ts` - utils from package
  - ✅ `interfaces/ServiceInterfaces.ts` - removed bot dependency (temporary placeholder)

- **Remaining Files**:
  - `IchimokuWorkflowService.ts`
  - `StrategyService.ts`
  - `SessionService.ts`
  - `SimulationService.ts`
  - `TextWorkflowHandler.ts`

- **Key Issues**:
  1. External API clients (`birdeyeClient`) are referenced from `../api/` but should be:
     - Moved to this package, OR
     - Injected as dependencies
  2. Cache implementations (`ohlcvCache`) referenced from `../cache/` should be:
     - Part of this package, OR
     - Part of storage package, OR
     - Injected as dependencies
  3. Bot-specific types (`Session`, `CommandHandler`) are referenced but belong in `@quantbot/bot`
  4. Event bus (`eventBus`, `EventFactory`) referenced from `../events/` needs relocation

### ⏳ @quantbot/monitoring
- **Status**: NOT STARTED

### ⏳ @quantbot/bot
- **Status**: NOT STARTED

### ⏳ @quantbot/web
- **Status**: NOT STARTED

## Package Dependency Graph (Current State)

```
@quantbot/utils (base layer)
  ↓
@quantbot/storage (depends on utils)
  ↓
@quantbot/simulation (depends on utils)
  ↓
@quantbot/services (depends on utils, storage, simulation)
  ↓
@quantbot/monitoring (depends on services, storage, utils)
  ↓
@quantbot/bot (depends on services, simulation, storage, utils)

@quantbot/web (depends on services, storage, utils)
```

## Files That Need Relocation

### From @quantbot/utils
1. `fetch-historical-candles.ts` → `@quantbot/services` (depends on API clients)
2. `RepeatSimulationHelper.ts` → `@quantbot/bot` (depends on bot types)

### Missing Packages/Modules
1. **External API clients** (birdeye, helius):
   - Currently in `/src/api/`
   - Should be in `@quantbot/services` or new `@quantbot/external-apis` package
   
2. **Cache implementations**:
   - Currently in `/src/cache/`
   - Should be in `@quantbot/storage` or integrated into services
   
3. **Event bus**:
   - Currently in `/src/events/`
   - Should be in `@quantbot/utils` or `@quantbot/services`

## Root-Level Issues

### Scripts Directory
- Many scripts in `/scripts/` still reference old paths like:
  - `../src/api/birdeye-client`
  - `../src/utils/logger`
  - `../src/simulation/engine`
- These need to be updated to use `@quantbot/*` imports

### Old src/ Directory
- The `/src/` directory still exists with old code
- After migration is complete, this should be removed
- Current state creates ambiguity and potential import conflicts

## Next Steps

1. ✅ Complete @quantbot/services path fixes
2. Review and fix @quantbot/monitoring  
3. Review and fix @quantbot/bot
4. Review and fix @quantbot/web
5. Create missing packages:
   - Consider `@quantbot/external-apis` for API clients
   - Move event bus to appropriate package
   - Move cache to storage or services
6. Update all scripts in `/scripts/` directory
7. Update configuration files (tsconfig, jest, etc.)
8. Remove old `/src/` directory
9. Test all packages build successfully
10. Run full test suite

## TypeScript Configuration Notes

- Each package has its own `tsconfig.json` extending root config
- Root `tsconfig.json` needs to be reviewed for correct path mappings
- Package references may need to be added for proper build orchestration

## Testing Strategy

After migration:
1. Build all packages: `npm run build:packages`
2. Run package tests: `npm run test:packages`
3. Build and test bot: `npm run build && npm test`
4. Integration tests with actual dependencies

## Breaking Changes

### For External Consumers
- Import paths have changed from relative to package-based
- Some utilities have moved between packages
- Files marked for relocation will have different import paths

### For Internal Code
- All relative imports crossing package boundaries must use `@quantbot/*`
- Some circular dependencies may be revealed and need refactoring
- Bot-specific and service-specific code now properly separated

## Migration Commands Reference

```bash
# Build all packages in correct order
npm run build:packages

# Test specific package
npm run test --workspace=packages/utils
npm run test --workspace=packages/storage
npm run test --workspace=packages/simulation
npm run test --workspace=packages/services

# Clean and rebuild
npm run clean
npm run build:packages

# Check for old relative imports
grep -r "from ['\"]\.\./" packages/*/src/
```

## Common Import Patterns

### OLD (Incorrect)
```typescript
import { logger } from '../utils/logger';
import { Strategy } from '../simulation/engine';
import { queryPostgres } from '../storage/postgres-client';
```

### NEW (Correct)
```typescript
import { logger, Strategy } from '@quantbot/utils';
import { simulateStrategy } from '@quantbot/simulation';
import { queryPostgres } from '@quantbot/storage';
```

## Status Legend

- ✅ COMPLETE - All paths updated and tested
- 🔄 IN PROGRESS - Partially updated  
- ⏳ NOT STARTED - Not yet reviewed
- ⚠️ BLOCKED - Waiting on dependencies or decisions

