# Architecture Boundaries - Layer Separation

**Status**: 📋 ARCHITECTURE DOCUMENTATION  
**Priority**: P0 (Critical Path)  
**Created**: 2025-01-23

## Overview

This document maps the Quant Research Lab Roadmap layers to existing packages and defines hard boundaries that prevent architectural drift. These boundaries ensure:

1. **Separation of Concerns**: Each layer has a single responsibility
2. **Testability**: Layers can be tested in isolation
3. **Maintainability**: Changes in one layer don't cascade to others
4. **Performance**: Hot paths (simulation) remain I/O-free

## Layer Mapping

### Layer 1: Data Ingestion (What Happened)

**Purpose**: Collect and store raw data from external sources.

**Packages**:
- `@quantbot/ingestion` - Telegram parsing, address extraction, call ingestion
- `@quantbot/api-clients` - Birdeye, Helius API clients
- `@quantbot/jobs` - OHLCV fetch jobs, online data acquisition

**Responsibilities**:
- Parse external data sources (Telegram, APIs)
- Validate and normalize data
- Store raw data (immutable, append-only)
- Extract and validate addresses

**Forbidden**:
- ❌ Feature engineering logic
- ❌ Strategy logic
- ❌ Simulation logic
- ❌ Execution logic

**Allowed Dependencies**:
- ✅ `@quantbot/core` (types, ports)
- ✅ `@quantbot/utils` (address validation, logging)
- ✅ `@quantbot/storage` (repositories)

**Layer Boundary Rules**:
- Cannot import from `@quantbot/simulation`
- Cannot import from `@quantbot/analytics`
- Cannot import from `@quantbot/workflows` (except adapters)

---

### Layer 2: Feature Engineering (What It Meant)

**Purpose**: Transform raw data into features for strategy analysis.

**Packages**:
- `@quantbot/analytics` - Call performance analysis, metrics calculation, ATH/ATL
- `@quantbot/ohlcv` - Candle querying, coverage analysis, offline data services

**Responsibilities**:
- Calculate technical indicators (RSI, moving averages, etc.)
- Compute performance metrics (PnL, win rate, etc.)
- Generate feature vectors for ML/analysis
- Analyze data coverage and quality

**Forbidden**:
- ❌ Strategy logic (how to trade)
- ❌ Simulation logic (when to execute)
- ❌ Execution logic (how to execute trades)
- ❌ Online data fetching (ingestion layer only)

**Allowed Dependencies**:
- ✅ `@quantbot/core` (types)
- ✅ `@quantbot/utils` (utilities)
- ✅ `@quantbot/storage` (read-only queries)
- ✅ `@quantbot/ohlcv` (candle data)

**Layer Boundary Rules**:
- Cannot import from `@quantbot/ingestion` (except for address validation utils)
- Cannot import from `@quantbot/api-clients` (no network in feature engineering)
- Cannot import from `@quantbot/simulation` (features feed simulation, not vice versa)
- Cannot import from `@quantbot/jobs` (no online fetching)

**Special Rule - OHLCV Package**:
- ✅ Can read from storage (ClickHouse, DuckDB)
- ❌ Cannot write to storage (jobs layer does that)
- ❌ Cannot call APIs directly (must go through jobs layer)

---

### Layer 3: Strategy Logic (What We Did)

**Purpose**: Define trading strategies and decision rules.

**Packages**:
- `@quantbot/simulation` - Strategy engine, entry/exit logic, signal evaluation

**Responsibilities**:
- Define entry conditions (immediate, drop, trailing)
- Define exit conditions (profit targets, stop loss)
- Define re-entry rules
- Calculate position sizing
- Evaluate trading signals

**Forbidden** (Critical - Hot Path Performance):
- ❌ Network I/O (HTTP calls)
- ❌ Database I/O (queries, writes)
- ❌ Filesystem I/O (read/write files)
- ❌ `Date.now()` (use clock port)
- ❌ `Math.random()` (use seeded random)
- ❌ Environment variables (`process.env`)
- ❌ Console output (`console.log`)

**Allowed Dependencies**:
- ✅ `@quantbot/core` (types, ports)
- ✅ `@quantbot/utils` (pure utilities - no I/O)
- ✅ `@quantbot/ohlcv` (read candles - via ports, not direct imports)

**Layer Boundary Rules** (Hard Boundaries):
- ❌ Cannot import from `@quantbot/ingestion`
- ❌ Cannot import from `@quantbot/api-clients`
- ❌ Cannot import from `@quantbot/jobs`
- ❌ Cannot import from `@quantbot/workflows`
- ❌ Cannot import from `@quantbot/storage/src/**` (only interfaces from core)
- ✅ Can only use candle data via ports/interfaces
- ✅ Must be deterministic (same inputs → same outputs)

**Why These Boundaries Matter**:
- Simulation is the **hot path** - must be fast and deterministic
- I/O operations would add latency and non-determinism
- Allows testing strategies without network/DB dependencies
- Enables parallel execution and replayability

---

### Layer 4: Execution Logic (How Fast & How Safely)

**Purpose**: Execute trades with realistic latency, slippage, and fee models.

**Packages**:
- `@quantbot/simulation/src/execution/` - Execution models, slippage, latency, fees
- `@quantbot/workflows/src/adapters/executionStubAdapter` - Execution port adapter

**Responsibilities**:
- Model execution latency (network + confirmation)
- Model slippage (based on volume, liquidity)
- Model fees (maker/taker, priority fees)
- Model partial fills
- Model transaction failures

**Note**: Currently execution models are part of `@quantbot/simulation`. They follow the same purity rules (no I/O).

**Future Separation**: Execution models may be extracted to `@quantbot/execution` package for clearer separation.

---

### Layer 5: Evaluation Logic (Did It Work)

**Purpose**: Evaluate strategy performance and generate metrics.

**Packages**:
- `@quantbot/analytics` - Performance analysis, metrics aggregation
- `@quantbot/workflows/src/research/metrics.ts` - Research metrics

**Responsibilities**:
- Calculate PnL statistics (mean, median, min, max)
- Calculate risk metrics (drawdown, Sharpe ratio, etc.)
- Generate performance reports
- Compare strategy variants

**Allowed Dependencies**:
- ✅ `@quantbot/core` (types)
- ✅ `@quantbot/utils` (utilities)
- ✅ `@quantbot/simulation` (read results - simulation output, not simulation code)

**Layer Boundary Rules**:
- ❌ Cannot import simulation internals (only result types)
- ❌ Cannot modify simulation logic
- ✅ Can analyze simulation outputs

---

### Layer 6: Orchestration (Application Layer)

**Purpose**: Coordinate multi-step workflows.

**Packages**:
- `@quantbot/workflows` - Workflow orchestration

**Responsibilities**:
- Coordinate I/O operations
- Call simulation with proper context
- Handle errors and retries
- Persist results
- Return structured outputs

**Allowed Dependencies**:
- ✅ All packages (workflows orchestrate everything)
- ✅ Uses ports/interfaces (not direct implementations)
- ✅ Composes services from multiple layers

**Layer Boundary Rules**:
- ✅ Can import from any package
- ✅ Must use dependency injection (WorkflowContext)
- ✅ Cannot contain business logic (delegates to services)
- ✅ Must return JSON-serializable results

---

### Layer 7: Adapters & Composition Roots

**Purpose**: Wire real implementations to ports, handle I/O concerns.

**Packages**:
- `@quantbot/cli` - CLI adapter, command parsing, output formatting
- `@quantbot/workflows/src/adapters/` - Port adapters
- `@quantbot/workflows/src/context/` - Context factories

**Responsibilities**:
- Read environment variables
- Parse command-line arguments
- Wire real services to ports
- Format output for display
- Handle I/O (filesystem, network setup)

**Allowed Dependencies**:
- ✅ All packages (wires everything together)
- ✅ Can read `process.env`
- ✅ Can access filesystem
- ✅ Can format output

**Layer Boundary Rules**:
- ✅ Can contain I/O code
- ✅ Can contain formatting logic
- ✅ Must wire ports properly (not bypass them)

---

## Package-to-Layer Mapping

| Package | Primary Layer | Allowed Dependencies | Forbidden Dependencies |
|---------|---------------|---------------------|------------------------|
| `@quantbot/core` | Foundation | None (zero dependencies) | N/A |
| `@quantbot/utils` | Foundation | `@quantbot/core` | All others |
| `@quantbot/ingestion` | Data Ingestion | `core`, `utils`, `storage` | `simulation`, `analytics`, `workflows` |
| `@quantbot/api-clients` | Data Ingestion | `core`, `utils`, `observability` | `simulation`, `analytics` |
| `@quantbot/jobs` | Data Ingestion | `api-clients`, `storage`, `ohlcv` | `simulation`, `analytics` |
| `@quantbot/ohlcv` | Feature Engineering | `core`, `utils`, `storage` | `api-clients`, `jobs`, `simulation` |
| `@quantbot/analytics` | Feature Engineering | `core`, `utils`, `storage`, `ohlcv` | `ingestion`, `api-clients`, `simulation` |
| `@quantbot/simulation` | Strategy Logic | `core`, `utils` only | **ALL I/O packages** |
| `@quantbot/workflows` | Orchestration | All packages (via ports) | N/A (but must use ports) |
| `@quantbot/storage` | Infrastructure | `core`, `utils` | `simulation`, `analytics` |
| `@quantbot/observability` | Infrastructure | `core`, `utils` | `simulation`, `analytics` |

## Critical Boundary Rules

### Rule 1: Simulation Must Be Pure (No I/O)

**Enforced For**:
- `@quantbot/simulation`

**Checks**:
- ❌ No `import` from `@quantbot/api-clients`
- ❌ No `import` from `@quantbot/jobs`
- ❌ No `import` from `@quantbot/storage/src/**` (only interfaces from core)
- ❌ No `Date.now()` (use clock port)
- ❌ No `Math.random()` (use seeded random)
- ❌ No `process.env` access
- ❌ No filesystem operations
- ❌ No HTTP/network code

**Why**: Simulation is the hot path. I/O adds latency and non-determinism.

---

### Rule 2: Feature Engineering Cannot Fetch Data

**Enforced For**:
- `@quantbot/analytics`
- `@quantbot/ohlcv`

**Checks**:
- ❌ No `import` from `@quantbot/api-clients`
- ❌ No `import` from `@quantbot/jobs`
- ❌ No direct HTTP calls

**Why**: Feature engineering should work on existing data, not fetch new data.

---

### Rule 3: Workflows Must Use Ports

**Enforced For**:
- `@quantbot/workflows`

**Checks**:
- ❌ No direct `import` from `@quantbot/storage/src/**` (implementations)
- ❌ No direct `import` from `@quantbot/api-clients/src/**` (implementations)
- ✅ Must use `ctx.ports.*` or `ctx.services.*`
- ✅ Must use context factories

**Why**: Workflows should depend on interfaces, not implementations.

---

### Rule 4: Handlers Must Be Pure Functions

**Enforced For**:
- `packages/cli/src/handlers/**`

**Checks**:
- ❌ No `console.log` / `console.error`
- ❌ No `process.exit`
- ❌ No `process.env` access
- ❌ No filesystem operations
- ❌ No Commander.js imports
- ✅ Must return data (not formatted strings)
- ✅ Must use context for services

**Why**: Handlers should be testable and REPL-friendly.

---

## Boundary Violations (To Be Fixed)

### Current Violations

✅ **All violations fixed!**

1. **✅ FIXED**: `packages/ohlcv/src/backfill-service.ts`
   - **Original Violation**: Imports from `@quantbot/jobs` (Data Ingestion layer)
   - **Fix Applied**: Moved `backfill-service.ts` to `packages/jobs/src/ohlcv-backfill-service.ts`
   - **Status**: ✅ Fixed - backfill service now lives in the correct layer (Data Ingestion)

### Violation Detection

Use these commands to detect violations:

```bash
# Check for forbidden imports
pnpm lint

# Verify architecture boundaries
pnpm verify:architecture-boundaries

# Type checking (will catch some import issues)
pnpm typecheck
```

---

## Enforcement Strategy

### Phase 1: Documentation (Current)

✅ **Status**: This document created

- Maps packages to layers
- Documents allowed/forbidden dependencies
- Identifies violations (TBD)

### Phase 2: ESLint Rules (Next)

**Goal**: Prevent violations at write-time

**Rules to Add**:
1. Block `@quantbot/simulation` from importing I/O packages
2. Block `@quantbot/analytics` from importing `@quantbot/api-clients`
3. Block `@quantbot/workflows` from importing storage implementations
4. Block handlers from using `console.log`, `process.exit`, etc.

**Files**: `eslint.config.mjs`

### Phase 3: Architecture Tests (Future)

**Goal**: Prevent regressions in CI

**Test**: `scripts/verify-architecture-boundaries.ts`

**Checks**:
- Parse all package.json files
- Verify no forbidden dependencies
- Verify import paths (no deep imports)
- Run in CI on every commit

### Phase 4: Refactor Violations (Future)

**Goal**: Fix existing violations

- Move code to appropriate layers
- Extract adapters where needed
- Update imports to use ports/interfaces

---

## Migration Strategy

### Step 1: Identify All Violations

1. Run ESLint with boundary rules (once implemented)
2. Parse package.json dependencies
3. Scan import statements
4. Document all violations

### Step 2: Prioritize Violations

- **P0 (Critical)**: Simulation importing I/O packages
- **P1 (High)**: Analytics importing API clients
- **P2 (Medium)**: Workflows importing implementations directly
- **P3 (Low)**: Other violations

### Step 3: Refactor Incrementally

1. Fix P0 violations first (simulation purity)
2. Fix P1 violations (feature engineering boundaries)
3. Fix P2 violations (workflow port usage)
4. Fix P3 violations (cleanup)

---

## Success Criteria

- ✅ All packages mapped to layers
- ✅ Boundary rules documented
- ⏳ ESLint rules block cross-layer imports
- ⏳ Architecture tests pass in CI
- ⏳ Zero violations in existing code

---

## Related Documentation

- `docs/ARCHITECTURE.md` - Overall system architecture
- `docs/OHLCV_ARCHITECTURE.md` - OHLCV-specific boundaries
- `.cursor/rules/packages-workflows.mdc` - Workflow layer rules
- `.cursor/rules/build-ordering.mdc` - Build dependency order
