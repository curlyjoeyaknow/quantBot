# Architecture Boundaries - Research Lab Layers

**Status**: 📋 ARCHITECTURE  
**Created**: 2025-01-23  
**Related**: `.cursor/rules/packages-workflows.mdc`, `docs/ARCHITECTURE.md`

## Overview

This document maps the Quant Research Lab roadmap layers to existing QuantBot packages and defines hard boundaries that must not be crossed. These boundaries ensure clean separation of concerns and enable the research lab's core principles: determinism, replayability, and automated optimization.

## Layer Mapping

### Layer 1: Data Ingestion (What Happened)

**Purpose**: Capture raw market data and trading signals from external sources.

**Packages**:
- `@quantbot/ingestion` - Telegram parsing, alert extraction
- `@quantbot/api-clients` - External API clients (Birdeye, Helius)
- `@quantbot/jobs` - Background job processing (OHLCV fetch jobs)

**Responsibilities**:
- Parse raw inputs (Telegram exports, API responses)
- Extract structured data (calls, alerts, tokens)
- Store raw data immutably (append-only)
- Track data provenance (source, timestamp, hash)

**Boundaries**:
- ✅ Can read from external APIs
- ✅ Can write to storage (raw data only)
- ❌ Cannot read from simulation results
- ❌ Cannot import from `@quantbot/simulation`
- ❌ Cannot make decisions based on strategy results

**Example Violations**:
- `@quantbot/ingestion` importing from `@quantbot/simulation` ❌
- Ingestion logic checking simulation results ❌

---

### Layer 2: Feature Engineering (What It Meant)

**Purpose**: Transform raw/canonical data into features for strategies.

**Packages**:
- `@quantbot/analytics` - Feature computation, metrics calculation
- `@quantbot/ohlcv` - OHLCV data services (candle fetching, resampling)

**Responsibilities**:
- Compute technical indicators (Ichimoku, RSI, moving averages)
- Normalize data (timestamp alignment, chain-agnostic addresses)
- Create feature vectors for strategy evaluation
- Cache expensive computations

**Boundaries**:
- ✅ Can read from ingestion layer (via storage)
- ✅ Can read from canonical data layer
- ✅ Can compute features from raw/canonical data
- ❌ Cannot import from `@quantbot/simulation`
- ❌ Cannot depend on strategy definitions
- ❌ Cannot make trading decisions

**Example Violations**:
- `@quantbot/analytics` importing strategy types from `@quantbot/simulation` ❌
- Feature computation logic depending on specific strategy parameters ❌

---

### Layer 3: Strategy Logic (What We Did)

**Purpose**: Define trading strategies as data (not code).

**Packages**:
- `@quantbot/core` - Strategy DSL, types, interfaces
- `@quantbot/simulation` - Strategy evaluation engine (pure compute)

**Responsibilities**:
- Define strategy DSL (entry/exit conditions, position sizing)
- Evaluate strategies on historical data
- Generate strategy mutations for optimization
- Compare strategies (similarity, diff)

**Boundaries**:
- ✅ Can read from feature engineering layer (via canonical data)
- ✅ Can import from `@quantbot/core` (types, DSL)
- ✅ Must be pure compute (no I/O, no clocks, no global state)
- ❌ Cannot import from `@quantbot/ingestion`
- ❌ Cannot import from `@quantbot/workflows` (orchestration)
- ❌ Cannot make network calls
- ❌ Cannot write to storage

**Example Violations**:
- `@quantbot/simulation` importing from `@quantbot/ingestion` ❌
- Simulation code making HTTP calls ❌
- Simulation code writing to database ❌
- Simulation code using `Date.now()` or `Math.random()` ❌

**Current State**:
- ✅ Simulation is already pure (no I/O)
- ✅ ESLint rules enforce these boundaries
- ✅ See `eslint.config.mjs` for enforcement

---

### Layer 4: Execution Logic (How Fast & How Safely)

**Purpose**: Execute trades (simulated or live) with execution models.

**Packages**:
- `@quantbot/workflows` - Orchestration layer (coordinates I/O)
- `packages/workflows/src/adapters/` - Execution adapters

**Responsibilities**:
- Apply execution models (slippage, latency, partial fills)
- Handle order submission (paper or live)
- Track positions and PnL
- Implement safety guards (circuit breakers, kill switches)

**Boundaries**:
- ✅ Can coordinate between layers (ingestion → feature → strategy → execution)
- ✅ Can import from all layers (as coordinator)
- ✅ Can make I/O operations (network, storage)
- ❌ Should not contain business logic (delegate to other layers)
- ❌ Should not make trading decisions (use strategy layer)

**Example Violations**:
- Workflow logic implementing strategy rules directly ❌
- Execution logic bypassing strategy layer ❌

**Current State**:
- ✅ Workflows use ports pattern for I/O
- ✅ Business logic delegated to appropriate layers
- ✅ See `.cursor/rules/packages-workflows.mdc` for patterns

---

### Layer 5: Evaluation Logic (Did It Work)

**Purpose**: Evaluate strategy performance and generate metrics.

**Packages**:
- `@quantbot/analytics` - Performance metrics, risk calculations
- `@quantbot/workflows` - Experiment tracking, run orchestration

**Responsibilities**:
- Calculate performance metrics (PnL, Sharpe ratio, max drawdown)
- Generate experiment reports
- Compare strategy variants
- Track experiment metadata (git commit, data snapshot hash)

**Boundaries**:
- ✅ Can read from execution layer (simulation results)
- ✅ Can read from strategy layer (strategy definitions)
- ✅ Can compute metrics from results
- ❌ Cannot modify strategy definitions
- ❌ Cannot modify execution results

**Example Violations**:
- Evaluation logic modifying simulation results ❌
- Metrics calculation changing strategy parameters ❌

---

### Layer 6: Optimization Logic (How to Do Better)

**Purpose**: Automatically search strategy space for better variants.

**Packages**:
- `@quantbot/analytics` - Optimization algorithms (grid search, Bayesian, etc.)
- `@quantbot/workflows` - Optimization job orchestration

**Responsibilities**:
- Generate strategy parameter combinations
- Run optimization jobs (coordinate simulation + evaluation)
- Prune bad strategies early
- Select Pareto-optimal strategies

**Boundaries**:
- ✅ Can use all layers (coordinates ingestion → feature → strategy → execution → evaluation)
- ✅ Can mutate strategy definitions (generate variants)
- ✅ Can read evaluation results
- ❌ Should not contain strategy logic (use strategy layer)
- ❌ Should not contain evaluation logic (use evaluation layer)

**Example Violations**:
- Optimization logic implementing strategy rules directly ❌
- Optimization logic computing metrics directly (should use evaluation layer) ❌

---

## Cross-Layer Dependencies

### Allowed Flow

```
Ingestion → Storage (Raw Data)
    ↓
Canonical Data Layer (transforms raw → canonical)
    ↓
Feature Engineering (transforms canonical → features)
    ↓
Strategy Logic (evaluates features → decisions)
    ↓
Execution Logic (applies decisions → trades)
    ↓
Evaluation Logic (analyzes trades → metrics)
    ↓
Optimization Logic (uses metrics → better strategies)
```

### Forbidden Patterns

1. **Circular Dependencies**: No layer can depend on a layer that depends on it
   - ❌ Strategy → Ingestion → Strategy
   - ❌ Feature → Strategy → Feature

2. **Skip Layer Access**: Layers should not skip adjacent layers
   - ❌ Strategy directly accessing Ingestion (should use canonical data)
   - ❌ Optimization directly accessing Ingestion (should use workflows)

3. **Bidirectional Dependencies**: Layers should not import from each other
   - ❌ Feature ↔ Strategy
   - ❌ Strategy ↔ Execution

---

## Package-to-Layer Mapping

| Package | Primary Layer | Secondary Layers | Restrictions |
|---------|--------------|------------------|--------------|
| `@quantbot/ingestion` | Layer 1: Ingestion | - | No simulation imports |
| `@quantbot/api-clients` | Layer 1: Ingestion | - | No simulation imports |
| `@quantbot/jobs` | Layer 1: Ingestion | - | No simulation imports |
| `@quantbot/ohlcv` | Layer 2: Features | - | No simulation imports |
| `@quantbot/analytics` | Layer 2: Features<br>Layer 5: Evaluation<br>Layer 6: Optimization | - | No ingestion imports |
| `@quantbot/core` | Layer 3: Strategy (DSL) | All (types/interfaces) | Pure types only |
| `@quantbot/simulation` | Layer 3: Strategy | - | Pure compute only (no I/O) |
| `@quantbot/workflows` | Layer 4: Execution<br>Layer 5: Evaluation | All (orchestration) | No business logic |
| `@quantbot/storage` | Infrastructure | All (via ports) | Ports/adapters only |
| `@quantbot/cli` | Adapter Layer | All (orchestration) | Thin adapter only |

---

## Current Violations

### Known Violations (To Fix)

*None identified yet - run `scripts/verify-architecture-boundaries.ts` to check*

### ESLint Enforcement

ESLint rules in `eslint.config.mjs` enforce:
- ✅ No deep imports from `@quantbot/*/src/**`
- ✅ `@quantbot/simulation` cannot import from ingestion/storage/api-clients/ohlcv
- ✅ `@quantbot/workflows` must use ports, not direct client imports
- ✅ Handler purity (no env, no Date.now, no Math.random)

Run `pnpm lint` to verify boundaries.

### Architecture Tests

Run `scripts/verify-architecture-boundaries.ts` to validate:
- Handlers only import from `@quantbot/core`
- No deep imports from `@quantbot/*/src/**`

---

## Migration Path

As we implement the research lab roadmap:

1. **Phase I Task 1.1**: Formalize these boundaries (this document) ✅
2. **Phase I Task 1.1**: Add/enhance ESLint rules ✅ (already exists)
3. **Phase I Task 1.1**: Fix any violations found
4. **Phase I Task 1.1**: Add CI checks to prevent regressions

---

## References

- `.cursor/rules/packages-workflows.mdc` - Workflow orchestration patterns
- `.cursor/rules/packages-simulation.mdc` - Simulation purity rules
- `docs/ARCHITECTURE.md` - Overall system architecture
- `eslint.config.mjs` - Boundary enforcement rules
- `scripts/verify-architecture-boundaries.ts` - Architecture tests

