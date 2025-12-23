# QuantBot Structure Migration Plan

## Current → Ideal Mapping

### Package Inventory

**Current (15 packages):**
1. `analytics/` - ✅ Keep (domain service)
2. `api-clients/` - ✅ Keep (concrete SDK clients)
3. `cli/` - ✅ Keep (composition roots)
4. `core/` - ✅ Keep (pure domain + ports + handlers)
5. `events/` - ⚠️  Review (appears empty/placeholder)
6. `ingestion/` - ✅ Keep (domain service)
7. `jobs/` - ⚠️  Review (OHLCV fetch jobs)
8. `observability/` - ✅ Keep (infrastructure)
9. `ohlcv/` - ✅ Keep (domain service)
10. `simulation/` - ✅ Keep (pure compute)
11. `storage/` - ✅ Keep (concrete storage implementations)
12. `tui/` - ✅ Keep (app boundary)
13. `utils/` - ✅ Keep (shared utilities)
14. `workflows/` - ✅ Keep (app orchestration)

### Critical Mismatches

#### 1. `packages/core/src/` - Missing Domain Structure

**Current:**
```
core/src/
├── chain-utils.ts          # ⚠️  Should be in domain/ or utils/
├── commands/               # ✅ Correct
├── handlers/               # ✅ Correct
├── index.ts                # ✅ Correct (but exports domain types directly)
├── observability/          # ⚠️  Should be in domain/ or handlers/
└── ports/                  # ✅ Correct
```

**Ideal:**
```
core/src/
├── index.ts
├── domain/                 # ❌ Missing
│  ├── types.ts            # Move all domain interfaces here
│  ├── chain.ts            # Move chain-utils.ts here
│  └── index.ts
├── commands/               # ✅ Present
├── ports/                  # ✅ Present
├── handlers/               # ✅ Present
└── utils/                 # ❌ Missing (pure helpers)
```

**Action Plan:**
1. Create `packages/core/src/domain/` folder
2. Move domain types from `index.ts` to `domain/types.ts`:
   - `Chain`, `TokenAddress`, `Caller`, `Token`, `Alert`, `Call`
   - `StrategyConfig`, `CallSelection`, `DateRange`
   - `Candle`, `StrategyLeg`, `StopLossConfig`, `EntryConfig`, `ReEntryConfig`, `CostConfig`
   - `Trade`, `Position`, `SimulationEvent` (all variants)
   - `SimulationResult`, `SimulationAggregate`, `SimulationTrace`
   - `SimulationTarget`, `SimulationRunData`, `UserStrategy`
   - `TokenMetadata`, `CallerInfo`, `CACall`, `ActiveCA`, `LastSimulation`
3. Move `chain-utils.ts` to `domain/chain.ts` (or keep as `chain-utils.ts` in domain/)
4. Move `createTokenAddress()` to `domain/token.ts` or keep in `domain/types.ts`
5. Create `domain/index.ts` to export all domain types
6. Update `core/src/index.ts` to re-export from `domain/`
7. Create `packages/core/src/utils/` for pure helpers (if needed)
8. Review `observability/errorsObservability.ts` - if it's a handler, move to `handlers/`, otherwise keep in `observability/` or move to `domain/`

#### 2. `packages/workflows/src/` - Minor Cleanup

**Current:** ✅ Mostly correct, but:
- `calls/queryCallsDuckdb.ts` - Review if this should be a workflow or domain service

**Action Plan:**
1. Review `calls/queryCallsDuckdb.ts`:
   - If it's a workflow (uses `ctx.ports.*`), keep it
   - If it's a domain service (pure logic), consider moving to `@quantbot/core/src/domain/` or `@quantbot/ingestion/`

#### 3. `packages/cli/src/pure/` - Migration Target

**Current:**
```
cli/src/pure/
├── ingestion/
│  └── validate-addresses.ts
└── simulation/
   └── run-simulation-duckdb.ts
```

**Action Plan:**
1. Review `validate-addresses.ts`:
   - If truly pure and not CLI-dependent → move to `@quantbot/core/src/handlers/validateAddressesHandler.ts`
   - If CLI-specific → keep in `commands/ingestion/validate-addresses.ts` as a helper
2. Review `run-simulation-duckdb.ts`:
   - If truly pure and not CLI-dependent → move to `@quantbot/core/src/handlers/runSimulationHandler.ts`
   - If CLI-specific → keep in `commands/simulation/run-simulation-duckdb.ts` as a helper

#### 4. `packages/events/` - Review

**Current:** Appears to be empty/placeholder (only has `tsconfig.json`)

**Action Plan:**
1. Check if `events/` is used anywhere
2. If unused, remove it
3. If used, determine if it should be:
   - Merged into `@quantbot/utils/src/events/` (already exists)
   - Kept as separate package (if it's domain-specific)

#### 5. `packages/jobs/` - Review

**Current:** Contains OHLCV fetch jobs

**Action Plan:**
1. Review `jobs/src/` contents
2. Determine if jobs should be:
   - Moved to `@quantbot/workflows/src/ohlcv/` (if they're workflows)
   - Moved to `@quantbot/ohlcv/src/` (if they're domain services)
   - Kept as separate package (if they're infrastructure/background jobs)

#### 6. `.cursor/rules/` - Consolidation

**Current:** 30+ rule files with various naming conventions

**Ideal:**
```
.cursor/rules/
├── 00-architecture.mdc          # Core architecture principles
├── 10-handler-purity.mdc        # Handler purity rules
├── 20-ports-adapters.mdc        # Ports & adapters pattern
├── 30-import-boundaries.mdc     # Import restrictions
└── 40-testing-replay.mdc        # Testing & replay harness
```

**Action Plan:**
1. Consolidate existing rules:
   - `00-repo-shape.mdc` + `50-no-root-trophies.mdc` → `00-architecture.mdc`
   - `20-command-handler-contract.mdc` → `10-handler-purity.mdc`
   - `10-architecture-ports-adapters.mdc` → `20-ports-adapters.mdc`
   - `packages-workflows.mdc` + ESLint rules → `30-import-boundaries.mdc`
   - `40-testing-contracts.mdc` + `testing-workflows.mdc` → `40-testing-replay.mdc`
2. Keep package-specific rules as separate files:
   - `packages-cli-handlers.mdc`
   - `packages-api-clients.mdc`
   - `packages-ingestion.mdc`
   - etc.
3. Archive or remove deprecated rules:
   - `root.mdc` (marked DEPRECATED)
   - `60-quantbot-conventions.mdc` (merge into architecture)

### Migration Priority

#### Phase 1: Core Structure (High Priority)
1. ✅ Create `packages/core/src/domain/` folder
2. ✅ Move domain types to `domain/types.ts`
3. ✅ Move `chain-utils.ts` to `domain/chain.ts`
4. ✅ Create `domain/index.ts`
5. ✅ Update `core/src/index.ts` to re-export from `domain/`
6. ✅ Create `packages/core/src/utils/` if needed

**Impact:** High - affects all packages that import from `@quantbot/core`

#### Phase 2: CLI Pure Migration (Medium Priority)
1. ✅ Review `cli/src/pure/` functions
2. ✅ Migrate truly pure functions to `@quantbot/core/src/handlers/`
3. ✅ Update CLI commands to use handlers from core

**Impact:** Medium - affects CLI package only

#### Phase 3: Package Review (Low Priority)
1. ✅ Review `events/` package
2. ✅ Review `jobs/` package
3. ✅ Review `workflows/src/calls/`

**Impact:** Low - affects specific packages only

#### Phase 4: Rules Consolidation (Low Priority)
1. ✅ Consolidate `.cursor/rules/` structure
2. ✅ Archive deprecated rules

**Impact:** Low - documentation only

### Verification Checklist

After migration, verify:

- [ ] `packages/core/src/domain/` exists and contains all domain types
- [ ] `packages/core/src/index.ts` re-exports from `domain/`
- [ ] All imports from `@quantbot/core` still work
- [ ] `packages/cli/src/pure/` is empty or contains only CLI-specific helpers
- [ ] `packages/workflows/src/**` (excluding `adapters/**` + `context/**`) uses only `ctx.ports.*`
- [ ] ESLint rules enforce import boundaries
- [ ] All packages have proper `src/index.ts` public API
- [ ] Deep imports are banned (enforced by ESLint)

### Breaking Changes

**Phase 1 will cause breaking changes:**
- Domain types will move from `@quantbot/core` to `@quantbot/core/domain`
- Need to update all imports across the monorepo

**Mitigation:**
- Keep re-exports in `core/src/index.ts` for backward compatibility
- Update imports gradually
- Add deprecation warnings for old import paths

