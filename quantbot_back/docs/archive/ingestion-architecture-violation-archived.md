# Ingestion Package Architecture Violation

**Status**: ⚠️ VIOLATION IDENTIFIED  
**Priority**: High  
**Created**: 2025-01-19

## Issue

The `@quantbot/ingestion` package is **supposed to be offline-only** (process existing data, parse files, store to database), but it's currently making **live API calls** which violates the architectural principle.

## Violations Found

### 1. Direct API Client Usage

The following services in `packages/ingestion/src/` are making API calls:

1. **`TelegramAlertIngestionService.ts`**
   - Uses `fetchMultiChainMetadata` from `@quantbot/api-clients` (line 27, 369)
   - Uses `getBirdeyeClient` from `@quantbot/api-clients` (line 25, 236)
   - **Purpose**: Validates contract addresses during Telegram export ingestion

2. **`TelegramCallIngestionService.ts`**
   - Uses `fetchMultiChainMetadata` from `@quantbot/api-clients` (line 29, 203)
   - **Purpose**: Validates contract addresses and resolves chain information

3. **`OhlcvIngestionService.ts`**
   - Uses `fetchMultiChainMetadata` from `@quantbot/api-clients` (line 17, 268)
   - Uses `getBirdeyeClient` from `@quantbot/api-clients` (line 14, 563)
   - **Purpose**: Validates chain information for EVM addresses in resume mode

### 2. Re-exporting API Functions

`packages/ingestion/src/index.ts` re-exports API client functions:
- `fetchMultiChainMetadata` (line 35)
- `batchFetchMultiChainMetadata` (line 36)
- `MultiChainMetadataCache`, `getMetadataCache` (line 43)

This creates an unnecessary dependency on `@quantbot/api-clients` for consumers of the ingestion package.

### 3. Package Dependency

`packages/ingestion/package.json` declares dependency on `@quantbot/api-clients` (line 13), which violates the offline-only principle.

## Why This Is a Problem

1. **Architectural Violation**: `ingestion` should process offline data (Telegram exports, files), not make live API calls
2. **Tight Coupling**: Creates unnecessary dependency on external services
3. **Testability**: Makes it harder to test ingestion in isolation
4. **Reliability**: Ingestion can fail due to API outages, even when processing offline data
5. **Separation of Concerns**: Mixes data processing with data fetching

## Current Usage Patterns

### Telegram Ingestion Services

```typescript
// ❌ VIOLATION: Making API calls during offline data processing
const multiChainResult = await fetchMultiChainMetadata(botData.caAddress, detectedChain);
if (multiChainResult.primaryMetadata) {
  detectedChain = multiChainResult.primaryMetadata.chain;
  // ...
}
```

**Problem**: Validating addresses via API during Telegram export parsing means:
- Ingestion fails if API is down
- Ingestion is slower (network latency)
- Ingestion can't work completely offline

### OHLCV Ingestion Service

```typescript
// ❌ VIOLATION: Fetching OHLCV data (this might be acceptable, but needs review)
const birdeye = getBirdeyeClient();
// ... fetches candles from API
```

**Note**: `OhlcvIngestionService` fetching OHLCV data might be acceptable if it's considered "data acquisition" rather than "offline processing". However, it's in the `ingestion` package which should be offline-only.

## Resolution Options

### Option A: Remove API Calls from Telegram Ingestion (Recommended)

**For `TelegramAlertIngestionService` and `TelegramCallIngestionService`:**

1. **Remove address validation via API**
   - Trust the chain hint from bot messages
   - Use offline address format validation only (isEvmAddress, isSolanaAddress)
   - Skip invalid addresses without API validation

2. **Make validation optional/pluggable**
   - Add optional `validator` callback parameter
   - Default to offline validation only
   - Allow callers to inject API-based validation if needed

3. **Remove `@quantbot/api-clients` dependency**
   - Remove from `package.json`
   - Remove re-exports from `index.ts`
   - Update all imports

### Option B: Move OHLCV Ingestion to Separate Package

**For `OhlcvIngestionService`:**

1. Move to `@quantbot/ohlcv` package (where `OhlcvIngestionEngine` already lives)
2. Rename to avoid confusion (it's already using `OhlcvIngestionEngine`)
3. Keep `ingestion` package purely for offline Telegram parsing

### Option C: Make API Calls Optional/Pluggable

1. Inject API clients via dependency injection
2. Default to offline-only mode
3. Allow optional API validation via configuration

## Recommended Resolution

**Combine Option A + Option B:**

1. **Remove API calls from Telegram ingestion services**
   - Remove `fetchMultiChainMetadata` and `getBirdeyeClient` usage
   - Use offline validation only
   - Remove `@quantbot/api-clients` dependency

2. **Move `OhlcvIngestionService` to `@quantbot/ohlcv`**
   - It's already using `OhlcvIngestionEngine` from `ohlcv`
   - OHLCV fetching is inherently online, so it belongs in `ohlcv` package
   - Keep `ingestion` package for offline Telegram parsing only

3. **Update package boundaries**
   - `@quantbot/ingestion`: Offline-only Telegram export parsing
   - `@quantbot/ohlcv`: OHLCV data fetching and management (can be online)

## Files to Modify

### Phase 1: Remove API Calls from Telegram Services

- `packages/ingestion/src/TelegramAlertIngestionService.ts`
  - Remove `fetchMultiChainMetadata` import and usage
  - Remove `getBirdeyeClient` import and usage
  - Use offline validation only

- `packages/ingestion/src/TelegramCallIngestionService.ts`
  - Remove `fetchMultiChainMetadata` import and usage
  - Use offline validation only

- `packages/ingestion/src/index.ts`
  - Remove re-exports of API client functions

- `packages/ingestion/package.json`
  - Remove `@quantbot/api-clients` dependency

### Phase 2: Move OHLCV Ingestion Service

- Move `packages/ingestion/src/OhlcvIngestionService.ts` to `packages/ohlcv/src/`
- Update imports in CLI/workflows that use it
- Update `packages/ingestion/src/index.ts` to remove export

## Impact Assessment

### Breaking Changes

- **CLI commands**: May need to update import paths if `OhlcvIngestionService` moves
- **Workflows**: May need to update import paths
- **Tests**: Will need to update mocks and imports

### Benefits

- ✅ Clear separation of concerns
- ✅ `ingestion` package truly offline-only
- ✅ Better testability (no API dependencies)
- ✅ More reliable (no API failures during offline processing)
- ✅ Cleaner architecture

## Related Issues

- Circular dependency resolution (already fixed `ohlcv ↔ ingestion`)
- Build order violations (will be resolved after this fix)

## Next Steps

1. Confirm architectural decision: Should `ingestion` be offline-only?
2. Decide on resolution approach (Option A, B, or C)
3. Create implementation plan
4. Execute changes
5. Update tests
6. Update documentation

