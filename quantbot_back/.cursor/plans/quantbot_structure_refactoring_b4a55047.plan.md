---
name: QuantBot Structure Refactoring
overview: Refactor packages/core/src to add domain/ and utils/ folders, move chain-utils.ts and observability types, delete empty events package, and review jobs/workflows structure to match the ideal architecture.
todos:
  - id: phase-a-1
    content: Create domain/ and utils/ folder structure in packages/core/src/
    status: completed
  - id: phase-a-2
    content: Move chain-utils.ts to domain/chain/index.ts
    status: completed
    dependencies:
      - phase-a-1
  - id: phase-a-3
    content: Move observability/errorsObservability.ts to domain/telemetry/errors.ts
    status: completed
    dependencies:
      - phase-a-1
  - id: phase-a-4
    content: Create domain/index.ts and telemetry/index.ts with re-exports
    status: completed
    dependencies:
      - phase-a-2
      - phase-a-3
  - id: phase-a-5
    content: Update core/src/index.ts to re-export from domain/
    status: completed
    dependencies:
      - phase-a-4
  - id: phase-a-6
    content: Update all imports across monorepo for moved files
    status: completed
    dependencies:
      - phase-a-2
      - phase-a-3
  - id: phase-b-1
    content: "Document jobs package identity (Option A: worker/scheduler app layer) in README"
    status: completed
  - id: phase-c-1
    content: Delete packages/events/ directory (empty placeholder)
    status: completed
  - id: phase-c-2
    content: Review and move queryCallsDuckdb.ts logic to packages/storage as repository
    status: completed
---

# QuantBot Structure Refactoring Plan

## Overview

Refactor the codebase to match the ideal structure with clear boundaries:

- Add `domain/` and `utils/` folders to `packages/core/src/`
- Move domain types and chain utilities to proper locations
- Delete empty `packages/events/` package
- Review and document `packages/jobs/` identity
- Review `workflows/src/calls/` placement

## Phase A: Core Structure Cleanup

### Step 1: Create Domain Structure

Create new folders:

- `packages/core/src/domain/`
- `packages/core/src/domain/chain/`
- `packages/core/src/domain/telemetry/`
- `packages/core/src/utils/`

### Step 2: Move Chain Utilities

**Move:** `packages/core/src/chain-utils.ts` → `packages/core/src/domain/chain/index.ts`

**Reason:** Chain normalization is domain logic (chain semantics), not general utility.

**Update imports:** Search and replace across monorepo:

- `from '@quantbot/core/src/chain-utils'` → `from '@quantbot/core/src/domain/chain'`
- `from '@quantbot/core'` (if re-exported) → keep as-is (will re-export from domain)

**Create:** `packages/core/src/domain/chain/index.ts` with:

```typescript
export type { NormalizedChain } from './index.js';
export { normalizeChain, isNormalizedChain, getChainDisplayName } from './index.js';
```

### Step 3: Move Observability Types

**Move:** `packages/core/src/observability/errorsObservability.ts` → `packages/core/src/domain/telemetry/errors.ts`

**Reason:** `toErrorEvent()` is a pure utility that converts errors to structured events (telemetry schema). It belongs in domain/telemetry, not observability (which is for implementations).

**Update imports:** Search and replace:

- `from '@quantbot/core/src/observability/errorsObservability'` → `from '@quantbot/core/src/domain/telemetry/errors'`
- `from '@quantbot/core'` (if re-exported) → keep as-is

**Create:** `packages/core/src/domain/telemetry/index.ts` to export error utilities.

### Step 4: Organize Domain Types

**Current:** All domain types are in `packages/core/src/index.ts` (lines 34-565)

**Action:** Keep domain types in `index.ts` for now, but add comments organizing them by domain area:

- Chain types (already moved to `domain/chain/`)
- Token types (TokenAddress, Token, TokenMetadata, etc.)
- Caller types (Caller, CallerInfo)
- Alert/Call types (Alert, Call, CACall, ActiveCA)
- Strategy types (StrategyConfig, StrategyLeg, StopLossConfig, EntryConfig, ReEntryConfig, CostConfig)
- Simulation types (Candle, Trade, Position, SimulationEvent variants, SimulationResult, etc.)

**Future work:** Split into `domain/tokens/`, `domain/callers/`, `domain/strategies/`, `domain/simulation/` if they grow large.

**For now:** Keep in `index.ts` but add domain organization comments.

### Step 5: Create Domain Index

**Create:** `packages/core/src/domain/index.ts`:

```typescript
// Re-export chain utilities
export * from './chain/index.js';

// Re-export telemetry utilities
export * from './telemetry/index.js';

// Future: Re-export other domain areas as they're organized
```

### Step 6: Update Core Index

**Update:** `packages/core/src/index.ts` to re-export from domain:

```typescript
// Domain types and utilities
export * from './domain/index.js';

// Keep existing domain type exports (for backward compatibility)
// ... (all existing type exports)
```

**Note:** Keep all existing exports for backward compatibility. The domain/ folder is organizational, not a breaking change.

### Step 7: Create Utils Folder (Placeholder)

**Create:** `packages/core/src/utils/index.ts` (empty for now)

**Purpose:** Future home for pure helpers (time utilities, validation, math) that don't belong in domain/.

## Phase B: Jobs Package Identity

### Step 1: Document Jobs Identity

**Decision:** `packages/jobs/` = **Option A: Worker/Scheduler App Layer**

**Current contents:**

- `ohlcv-birdeye-fetch.ts` - Concrete fetch implementation (allowed)
- `ohlcv-fetch-job.ts` - Job orchestration (allowed)
- `ohlcv-ingestion-engine.ts` - Ingestion engine (allowed)

**Action:** Add README section documenting:

- Jobs package is for runtime scheduling/worker runners
- It can contain queue consumers, cron runners, retry/backoff, concurrency limits
- It should NOT contain business logic
- It calls workflows/handlers (future: via ports)

**Future work:** Migrate jobs to call workflows via `ctx.ports.*` instead of direct imports.

### Step 2: Review Jobs Usage

**Current usage:** Jobs are imported by:

- `packages/workflows/src/adapters/ohlcvIngestionWorkflowAdapter.ts` - Uses `OhlcvFetchJob`
- `packages/cli/src/commands/ingestion/*.ts` - Uses `OhlcvFetchJob`
- `packages/ohlcv/src/backfill-service.ts` - Uses `OhlcvIngestionEngine`

**Action:** Document that these are temporary. Future: workflows should use ports, CLI should call workflows.

## Phase C: Events & Workflows Cleanup

### Step 1: Delete Events Package

**Action:** Delete `packages/events/` directory entirely.

**Reason:** Only contains `tsconfig.json`, no source files, no imports found.

**Steps:**

1. Delete `packages/events/` directory
2. Remove from `pnpm-workspace.yaml` if present
3. Remove from root `tsconfig.json` references if present

### Step 2: Review Workflows Calls

**File:** `packages/workflows/src/calls/queryCallsDuckdb.ts`

**Issue:** Uses `ctx.services.duckdbStorage.queryCalls()` which is not a port.

**Options:**

- **Option 1:** Move to `packages/storage/src/duckdb/repositories/CallsRepository.ts` as a repository interface
- **Option 2:** Move to `packages/workflows/src/adapters/` if it's adapter logic
- **Option 3:** Keep as workflow but add a `CallsPort` to `@quantbot/core/src/ports/`

**Decision:** **Option 1** - This is storage query logic, should be in storage package.

**Action:**

1. Create `packages/storage/src/duckdb/repositories/CallsRepository.ts` with `queryCalls()` method
2. Move query logic from `queryCallsDuckdb.ts` to repository
3. Update workflow to use repository via port (future) or keep direct import for now
4. Delete `packages/workflows/src/calls/` directory

**Future work:** Add `CallsPort` to core ports if calls querying becomes a first-class port.

## File Move Summary

### Moves:

1. `packages/core/src/chain-utils.ts` → `packages/core/src/domain/chain/index.ts`
2. `packages/core/src/observability/errorsObservability.ts` → `packages/core/src/domain/telemetry/errors.ts`

### Deletions:

1. `packages/events/` (entire directory)
2. `packages/workflows/src/calls/queryCallsDuckdb.ts` (move logic to storage first)

### New Files:

1. `packages/core/src/domain/index.ts`
2. `packages/core/src/domain/chain/index.ts` (from chain-utils.ts)
3. `packages/core/src/domain/telemetry/index.ts`
4. `packages/core/src/domain/telemetry/errors.ts` (from observability/errorsObservability.ts)
5. `packages/core/src/utils/index.ts` (placeholder)

## Import Updates Required

After moves, update imports in:

- All packages importing from `@quantbot/core/src/chain-utils`
- All packages importing from `@quantbot/core/src/observability/errorsObservability`
- `packages/core/src/index.ts` (add domain re-exports)

## Verification Checklist

- [ ] `packages/core/src/domain/` exists with `chain/` and `telemetry/` subfolders
- [ ] `packages/core/src/utils/` exists (placeholder)
- [ ] `chain-utils.ts` moved to `domain/chain/index.ts`
- [ ] `errorsObservability.ts` moved to `domain/telemetry/errors.ts`
- [ ] All imports updated across monorepo
- [ ] `packages/core/src/index.ts` re-exports from `domain/`
- [ ] `packages/events/` deleted
- [ ] `packages/jobs/README.md` documents identity (Option A)
- [ ] `packages/workflows/src/calls/` reviewed and moved to storage (or kept with port)

## Breaking Changes

**None** - All moves maintain backward compatibility via re-exports in `core/src/index.ts`.

## Future Work (Not in This Plan)

1. Split domain types in `index.ts` into domain subfolders (tokens/, callers/, strategies/, simulation/)
2. Migrate jobs to call workflows via ports
3. Add `CallsPort` to core ports if needed
4. Move pure helpers to `core/src/utils/` as they're identified