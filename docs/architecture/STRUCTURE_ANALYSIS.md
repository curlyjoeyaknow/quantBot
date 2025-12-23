# QuantBot Structure Analysis

## Current vs Ideal Structure Comparison

### Current Packages (15 total)

```
packages/
├── analytics/          # ✅ Domain service (metrics, period analysis)
├── api-clients/        # ✅ Concrete SDK clients (Birdeye/Helius)
├── cli/                # ✅ Composition roots
├── core/               # ✅ Pure domain + ports + handlers
├── events/             # ⚠️  Empty/placeholder?
├── ingestion/          # ✅ Domain service (Telegram parsing, address extraction)
├── jobs/               # ⚠️  Needs review (OHLCV fetch jobs)
├── observability/      # ✅ Infrastructure (logging, metrics, health)
├── ohlcv/              # ✅ Domain service (OHLCV data management)
├── simulation/         # ✅ Pure compute (trading simulation engine)
├── storage/            # ✅ Concrete storage implementations
├── tui/                # ✅ App boundary (like CLI)
├── utils/              # ✅ Shared utilities
└── workflows/          # ✅ App orchestration using ctx.ports.*
```

### Structure Mismatches

#### 1. `packages/core/src/` Structure

**Current:**

```
core/src/
├── chain-utils.ts          # ⚠️  Should be in domain/ or utils/
├── commands/               # ✅ Correct
├── handlers/               # ✅ Correct (sacred zone)
├── index.ts                # ✅ Correct
├── observability/          # ⚠️  Should be in domain/ or separate?
└── ports/                  # ✅ Correct
```

**Ideal:**

```
core/src/
├── index.ts
├── domain/                 # ❌ Missing - pure types + domain logic
├── commands/               # ✅ Present
├── ports/                  # ✅ Present
├── handlers/               # ✅ Present
└── utils/                 # ⚠️  Missing - pure helpers (no IO)
```

**Action Items:**

- Create `packages/core/src/domain/` for pure domain types and logic
- Move `chain-utils.ts` to `domain/` or `utils/`
- Move `observability/errorsObservability.ts` to `domain/` or keep as-is if it's a handler
- Create `packages/core/src/utils/` for pure helpers

#### 2. `packages/workflows/src/` Structure

**Current:** ✅ Mostly correct

```
workflows/src/
├── adapters/               # ✅ Correct (IO allowed)
├── context/                # ✅ Correct (composition roots)
├── ohlcv/                  # ✅ Correct
├── metadata/               # ✅ Correct
├── telegram/               # ✅ Correct
├── simulation/             # ✅ Correct
├── storage/                # ✅ Correct
├── calls/                  # ⚠️  Should this be in a domain folder?
└── dev/                    # ✅ Correct (smoke tests)
```

**Ideal:** ✅ Matches closely

- All workflows use `ctx.ports.*` (enforced by ESLint)
- Adapters are separate
- Context creation is separate

**Action Items:**

- Review `calls/queryCallsDuckdb.ts` - should it be a workflow or domain service?

#### 3. `packages/cli/src/` Structure

**Current:** ✅ Mostly correct

```
cli/src/
├── commands/               # ✅ Correct (composition roots)
├── core/                   # ✅ Correct (CLI infrastructure)
├── pure/                   # ✅ Correct (staging area)
└── types/                  # ✅ Correct
```

**Ideal:** ✅ Matches

- Commands are composition roots
- Pure folder exists for staging
- Should shrink over time

**Action Items:**

- Review `pure/` folder - migrate truly pure functions to `@quantbot/core/src/handlers/`
- Keep CLI-specific helpers in `commands/` or `core/`

#### 4. Missing/Extra Packages

**Extra packages not in ideal:**

- `analytics/` - ✅ Keep (domain service)
- `events/` - ⚠️  Review (appears empty/placeholder)
- `ingestion/` - ✅ Keep (domain service)
- `jobs/` - ⚠️  Review (OHLCV fetch jobs - might belong in workflows or ohlcv)
- `observability/` - ✅ Keep (infrastructure)
- `ohlcv/` - ✅ Keep (domain service)
- `simulation/` - ✅ Keep (pure compute)
- `utils/` - ✅ Keep (shared utilities)

**Action Items:**

- Check if `events/` is used or can be removed
- Review `jobs/` - should OHLCV fetch jobs be in `workflows/` or `ohlcv/`?

#### 5. `.cursor/rules/` Structure

**Current:** Need to check
**Ideal:**

```
.cursor/rules/
├── 00-architecture.mdc
├── 10-handler-purity.mdc
├── 20-ports-adapters.mdc
├── 30-import-boundaries.mdc
└── 40-testing-replay.mdc
```

**Action Items:**

- Consolidate existing rules into this structure
- Ensure all architectural principles are documented

### Recommended Refactoring Steps

#### Phase 1: Core Structure Cleanup

1. Create `packages/core/src/domain/` folder
2. Move `chain-utils.ts` to `domain/` or `utils/`
3. Create `packages/core/src/utils/` for pure helpers
4. Review `observability/errorsObservability.ts` placement

#### Phase 2: Package Review

1. Check `events/` package - remove if unused
2. Review `jobs/` package - determine if it belongs elsewhere
3. Ensure all packages have proper `src/index.ts` public API

#### Phase 3: CLI Pure Migration

1. Review `packages/cli/src/pure/` functions
2. Move truly pure, non-CLI-dependent functions to `@quantbot/core/src/handlers/`
3. Keep CLI-specific helpers in commands

#### Phase 4: Rules Consolidation

1. Consolidate `.cursor/rules/` into the ideal structure
2. Ensure all architectural principles are documented

### Invariants to Enforce

1. ✅ **Only `packages/core/src/handlers/**` are called "handlers" and are pure**
2. ✅ **`packages/cli/src/commands/**` are composition roots: env/fs/logging OK**
3. ✅ **`packages/workflows/src/**` (excluding `adapters/**` + `context/**`) must be ports-only**
4. ⚠️  **All packages expose a public API via `src/index.ts`** - need to verify
5. ✅ **Deep imports are banned** - enforced by ESLint

### Next Steps

1. Create the missing `domain/` and `utils/` folders in `core/`
2. Review and migrate `pure/` functions from CLI to core handlers
3. Consolidate rules structure
4. Verify all packages have proper public APIs
