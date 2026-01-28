# PRD: Quant Research Lab Roadmap - Implementation Plan

## Introduction

This document defines the Product Requirements Document (PRD) for transforming the existing QuantBot codebase into a comprehensive research lab system through incremental refactoring. The roadmap is organized into 10 phases, with Phase I (Foundations) as the critical path that unlocks all subsequent work.

### Context

The QuantBot project has evolved into a complex system with multiple concerns including data ingestion, real-time monitoring, backtesting, and analytics. This PRD defines a systematic transformation that:

- **Establishes** architectural invariants (separation of concerns, determinism)
- **Creates** a clean data pipeline (raw → canonical → features)
- **Formalizes** the simulation contract as the single source of truth
- **Enables** experiment tracking and optimization
- **Provides** strategy DSL for automated discovery
- **Connects** research to live markets through execution bridge

### Problem Statement

Researchers and traders need a reliable, auditable research lab platform that:

- Produces deterministic, byte-identical results on re-runs
- Enables easy comparison of different experiments
- Provides full provenance and reproducibility
- Allows automated strategy discovery through optimization
- Connects research findings to live trading execution
- Maintains clear architectural boundaries to prevent drift

### Research Lab Philosophy

This platform is designed as a **research lab, not just a bot**. Research labs require:

- **Provenance**: Complete traceability of inputs, outputs, and execution parameters
- **Determinism**: Byte-identical results from identical inputs (within fixed tolerance)
- **Repeatability**: Ability to reproduce any historical result exactly
- **Easy Comparison**: Simple diffing and comparison of runs based purely on specification changes
- **Automation**: Automated strategy discovery through optimization algorithms
- **Governance**: Safety guards and risk controls for live execution

The platform lives or dies by its **contracts, not code**. Contracts define:

- Input formats (SimInput with versioning, seeds, data snapshots)
- Output formats (SimResult with metrics, events, artifacts)
- Experiment metadata (git commit, parameter vectors, data hashes)

---

## Goals

### Primary Objectives

1. **Architectural Invariants**: Lock in separation of concerns and determinism requirements as the foundation for all work

2. **Data Pipeline**: Establish clean data flow with immutable raw data, opinionated canonical format, and disposable feature stores

3. **Simulation Contract**: Formalize the immutable simulation contract as the single source of truth for all experiments

4. **Experiment Tracking**: Every experiment gets unique ID, git commit, data snapshot hash, parameter vector, random seed, timestamp, outcome metrics

5. **Strategy DSL**: Strategies are data, not code. Enable automated mutation, parameter sweeps, cross-strategy comparison

6. **Optimization Engine**: Multi-layer optimization (grid, random, Bayesian, evolutionary, pruning, ensemble) for automated strategy discovery

7. **Execution Bridge**: Paper → Live gradient. Same logic, different adapters. Connects research to live markets.

8. **Reports & UI**: Rich reporting and visualization for experiment analysis and comparison

9. **Governance**: Safety guards, risk controls, and audit trails for live execution

10. **Knowledge Retention**: Capture learnings, document patterns, enable knowledge sharing

### Business Value

- **Reduced Complexity**: Clear architectural boundaries prevent technical debt accumulation
- **Auditability**: Byte-identical results enable regulatory compliance and result verification
- **Reproducibility**: Contract-based design ensures any historical result can be reproduced with zero guesswork
- **Reliability**: Deterministic execution ensures consistent results across runs
- **Innovation**: Automated optimization enables discovery of strategies humans might miss
- **Risk Management**: Governance layer ensures safe transition from research to live trading

### User Value

- **Fast Iteration**: Quick experiment cycles with materialized inputs (no repeated database queries)
- **Easy Comparison**: Simple diffing of runs based purely on specification changes
- **Reproducibility**: Confidence that results can be reproduced and audited months later
- **Provenance**: Complete traceability of all inputs, outputs, and execution parameters
- **Automation**: Automated strategy discovery frees researchers to focus on insights
- **Safety**: Governance layer provides confidence when moving from research to live trading

---

## Package Recommendation

### Recommendation: Use `@quantbot/simulation` Package

**Analysis:**

1. **Current State**: The `@quantbot/backtest` package has been merged into `@quantbot/simulation/backtest`. The `backtest` package is now a backward compatibility shim that re-exports from `@quantbot/simulation/backtest`.

2. **Determinism Implementation**: ✅ **Correctly Implemented**
   - Uses `@quantbot/core`'s `DeterministicRNG` and `createDeterministicRNG` functions
   - Has seed management in contracts (`SimInputSchema` includes `seed` field)
   - Uses deterministic ID generation from run IDs
   - Execution models use deterministic RNGs for slippage, latency, failures
   - Clock abstraction supports deterministic time progression

3. **Simulation Contract**: ✅ **Already Formalized**
   - `SimInputSchema` includes versioning (`contractVersion`, `dataVersion`, `strategyVersion`)
   - Includes seed for determinism
   - Includes data snapshot hash for reproducibility
   - Includes execution model and risk model schemas
   - Clock resolution support (`ms`, `s`, `m`, `h`)

4. **Execution Models**: ✅ **Already Implemented**
   - Multiple execution models (PerfectFill, FixedSlippage, Pumpfun, Pumpswap)
   - Latency sampling with deterministic RNG
   - Partial fills, transaction failures
   - Fee regimes

5. **Architecture**: ✅ **Well-Structured**
   - Clear separation: `types/`, `core/`, `execution/`, `indicators/`, `position/`
   - Contract adapter pattern (`contract-adapter.ts`)
   - Contract validator (`contract-validator.ts`)

**Conclusion**: The `@quantbot/simulation` package is the correct foundation for the research lab roadmap. It already has:

- Determinism correctly implemented
- Simulation contract formalized
- Execution models (no perfect fills)
- Clock resolution support
- Clean architecture

**Action Items:**

- Use `@quantbot/simulation` as the base package
- Extend existing contracts rather than creating new ones
- Build on existing determinism infrastructure
- Add missing pieces (experiment tracking, optimization, DSL) incrementally

---

## User Stories

### US-1: Run a Deterministic Experiment

**As a** researcher  
**I want to** run an experiment with explicit seed and versioning  
**So that** I can reproduce results exactly later

**Acceptance Criteria:**

- Can specify random seed for deterministic execution
- Can specify contract version, data version, strategy version
- Same inputs + same seed → byte-identical outputs
- Experiment gets unique ID with full provenance
- Results include all metadata needed for reproduction

### US-2: Track Experiment Metadata

**As a** researcher  
**I want to** automatically track experiment metadata  
**So that** I can understand what code and data produced each result

**Acceptance Criteria:**

- Git commit hash automatically captured
- Data snapshot hash automatically calculated
- Parameter vector serialized and hashed
- Random seed stored with experiment
- All metadata queryable via repository interface

### US-3: Compare Experiments

**As a** researcher  
**I want to** compare two experiments  
**So that** I can understand what changes caused performance differences

**Acceptance Criteria:**

- Can diff two RunSpecs and identify all differences
- Can explain result differences purely from specification changes
- Comparison shows which parameter changes caused which metric changes
- Comparison works even for experiments from 30+ days ago

### US-4: Optimize Strategy Parameters

**As a** researcher  
**I want to** automatically search for optimal strategy parameters  
**So that** I can discover strategies I might not have considered

**Acceptance Criteria:**

- Can specify parameter space (ranges, distributions)
- Can choose optimization algorithm (grid, random, Bayesian)
- Can specify objective metrics (return, Sharpe, drawdown)
- Can specify constraints (max drawdown, win rate)
- Optimization produces ranked results with full provenance

### US-5: Define Strategy as Data

**As a** researcher  
**I want to** define strategies as structured data (not code)  
**So that** I can automate mutation and comparison

**Acceptance Criteria:**

- Strategy defined as JSON/YAML with schema validation
- Can instantiate strategies from templates
- Can mutate strategies deterministically
- Can compare strategies for similarity
- Strategy DSL supports all strategy types (momentum, mean reversion, etc.)

### US-6: Execute Paper Trading

**As a** researcher  
**I want to** execute strategies in paper trading mode  
**So that** I can validate strategies before live trading

**Acceptance Criteria:**

- Paper execution uses same simulation logic as backtesting
- Paper execution tracks positions and PnL
- Paper execution logs all trades
- Can switch between paper and backtest modes seamlessly
- Paper results comparable to backtest results

---

## Functional Requirements

## PHASE I: CORE ARCHITECTURAL INVARIANTS (Critical Path - Week 1-2)

### FR-1.1: Formalize Separation of Concerns

**Description**: Lock in layer boundaries to prevent architectural drift

**Requirements:**

- Document layer boundaries mapping roadmap layers to existing packages
- Map existing code to layers: ingestion → feature engineering → strategy → execution → evaluation
- Document violations (code that crosses boundaries)
- Add ESLint rules that block cross-layer imports
- Create architecture tests that validate imports in CI
- Refactor existing violations

**Files:**

- `docs/ARCHITECTURE_BOUNDARIES.md`
- `eslint.config.mjs` (add layer boundary rules)
- `scripts/verify-architecture-boundaries.ts`
- `.github/workflows/ci.yml` (add architecture tests)

**Success Criteria:**

- ESLint blocks cross-layer imports
- Architecture tests pass in CI
- Documentation maps all boundaries
- Zero violations in existing code

### FR-1.2: Enforce Determinism Contract

**Description**: Ensure all simulations are deterministic and replayable

**Requirements:**

- Document deterministic contract: seeded random, versioned inputs, replayable outputs
- Create `SeedManager` class that generates deterministic seeds from run IDs
- Ensure all simulation inputs include version fields
- Add version validation to `SimInputSchema` (already exists, verify completeness)
- Add determinism tests that verify: same inputs + same seed → same outputs
- Refactor non-deterministic code (Date.now(), Math.random(), etc.)

**Files:**

- `packages/core/src/determinism.ts` (already exists, extend)
- `packages/core/src/seed-manager.ts` (new)
- `packages/simulation/src/types/contracts.ts` (verify completeness)
- `packages/simulation/tests/unit/determinism.test.ts` (verify exists)

**Success Criteria:**

- All simulations accept seed parameter
- Same inputs + seed → byte-identical outputs
- Determinism tests pass
- Documentation complete
- No non-deterministic patterns in simulation code

### FR-1.3: Artifact Versioning System

**Description**: Version all artifacts (strategies, feature sets, sim runs, configs) for reproducibility

**Requirements:**

- Define Zod schemas for versioned artifacts (strategies, feature sets, sim runs, configs)
- Add version, hash, timestamp fields to all artifacts
- Create `ArtifactRepository` port for storing/retrieving artifacts
- Support versioning, tagging, querying
- Implement DuckDB artifact adapter
- Migrate existing storage to artifact system
- Add artifact CLI commands

**Files:**

- `packages/core/src/artifacts.ts` (new)
- `packages/core/src/ports/artifact-repository-port.ts` (new)
- `packages/storage/src/adapters/artifact-duckdb-adapter.ts` (new)
- `tools/storage/artifact_schema.sql` (new)
- `packages/cli/src/commands/artifacts/` (new)

**Success Criteria:**

- Artifact schema defined and validated
- Repository interface implemented
- Existing storage migrated
- CLI commands work end-to-end

---

## PHASE II: DATA LAYER - RAW → CANONICAL → FEATURES (Parallel to Phase I, Week 2-3)

### FR-2.1: Raw Data Immutability

**Description**: Ensure raw data is append-only and hash-tracked

**Requirements:**

- Audit current raw data storage (Telegram exports, API responses)
- Identify mutable operations (updates, deletes)
- Refactor storage to append-only (no updates/deletes on raw data)
- Add run_id/timestamp to all raw data tables
- Store SHA256 hash of raw inputs (files, API responses)
- Use hash to detect duplicates (idempotency)
- Create `RawDataRepository` port for accessing raw data
- Add raw data CLI commands

**Files:**

- `packages/ingestion/` (refactor)
- `packages/storage/src/repositories/` (refactor)
- `tools/telegram/duckdb_punch_pipeline.py` (refactor)
- `packages/core/src/ports/raw-data-repository-port.ts` (new)
- `packages/cli/src/commands/data/raw.ts` (new)

**Success Criteria:**

- Raw data is append-only (no updates/deletes)
- Hash tracking prevents duplicates
- Repository interface implemented
- CLI commands work

### FR-2.2: Canonical Data Schema

**Description**: Create unified canonical event schema

**Requirements:**

- Define unified schema: `(asset, venue, timestamp, event_type, value, confidence)`
- Map existing data types (calls, candles, trades) to canonical format
- Create canonical transformers: Calls → Canonical, Candles → Canonical, Trades → Canonical
- Handle missing fields, normalization, timestamp conversion
- Implement `CanonicalRepository` port and DuckDB adapter
- Create migration script: raw data → canonical format
- Add canonical query interface

**Files:**

- `packages/core/src/canonical/event-schema.ts` (new)
- `packages/core/src/canonical/transformers.ts` (new)
- `packages/core/src/ports/canonical-repository-port.ts` (new)
- `packages/storage/src/adapters/canonical-duckdb-adapter.ts` (new)
- `scripts/migration/raw-to-canonical.ts` (new)

**Success Criteria:**

- Canonical schema defined and validated
- Transformers implemented and tested
- Migration script works
- Query interface supports all use cases

### FR-2.3: Feature Store (Disposable)

**Description**: Create versioned, tagged feature store

**Requirements:**

- Define `FeatureStore` port with: `compute(featureSet, data)`, `get(featureSet, asset, timestamp)`
- Features are versioned, tagged with source assumptions
- Implement in-memory feature store with LRU cache
- TTL-based expiration (10 minutes default)
- Add feature computation registry: `registerFeature(name, computeFn, version)`
- Features can depend on other features
- Create feature CLI commands

**Files:**

- `packages/core/src/ports/feature-store-port.ts` (new)
- `packages/analytics/src/feature-store/in-memory-feature-store.ts` (new)
- `packages/analytics/src/feature-store/feature-registry.ts` (new)
- `packages/cli/src/commands/features/` (new)

**Success Criteria:**

- Feature store interface defined
- In-memory implementation works
- Registry supports feature dependencies
- CLI commands work

---

## PHASE III: SIMULATION CONTRACT (Critical Path - Week 3-4)

### FR-3.1: Formalize Simulation Contract Interface

**Description**: Ensure simulation contract is complete and validated

**Requirements:**

- Review existing `SimInputSchema` in `packages/simulation/src/types/contracts.ts`
- Document gaps: missing fields, unclear semantics
- Extend contract schema if needed (verify execution model, risk model, clock resolution are included)
- Ensure all fields are JSON-serializable
- Create contract validator that ensures contract compliance
- Add contract documentation with examples

**Files:**

- `packages/simulation/src/types/contracts.ts` (review and extend)
- `packages/simulation/src/core/contract-validator.ts` (verify exists)
- `docs/SIMULATION_CONTRACT.md` (new)

**Success Criteria:**

- Contract schema is complete and validated
- All simulation code uses contract
- Documentation is comprehensive
- Validator catches invalid inputs

### FR-3.2: Implement Execution Models (No Perfect Fills)

**Description**: Ensure all simulations use execution models (already implemented, verify completeness)

**Requirements:**

- Verify execution models are integrated into simulator (already done)
- Verify execution models use deterministic RNG (already done)
- Verify multiple execution models exist (PerfectFill, FixedSlippage, Pumpfun, Pumpswap)
- Verify execution models handle: slippage, latency, partial fills, failures, fees
- Add execution model tests if missing
- Document execution models

**Files:**

- `packages/simulation/src/execution-models/` (verify completeness)
- `packages/simulation/src/core/simulator.ts` (verify integration)
- `packages/simulation/tests/unit/execution-models.test.ts` (verify exists)

**Success Criteria:**

- Multiple execution models implemented
- Simulator uses execution models
- Tests pass
- No "perfect fills" in production simulations

### FR-3.3: Configurable Time Resolution

**Description**: Ensure clock abstraction supports multiple resolutions (already implemented, verify)

**Requirements:**

- Verify `SimulationClock` interface exists and supports: milliseconds, seconds, minutes, hours
- Verify simulator uses clock abstraction
- Verify clock resolution is in contract (`clockResolution` field)
- Test different resolutions for consistency
- Document clock resolution usage

**Files:**

- `packages/simulation/src/core/clock.ts` (verify exists)
- `packages/simulation/src/types/contracts.ts` (verify `clockResolution` field)
- `packages/simulation/tests/integration/clock-resolution.test.ts` (verify exists)

**Success Criteria:**

- Clock abstraction implemented
- Multiple resolutions supported
- Simulator uses clock
- Tests verify consistency

---

## PHASE IV: EXPERIMENT TRACKING (Critical Path - Week 4-5)

### FR-4.1: Enhanced Run Metadata Schema

**Description**: Extend simulation run metadata with experiment tracking fields

**Requirements:**

- Extend `SimulationRunMetadata` with: git commit hash, data snapshot hash, parameter vector, random seed
- Ensure all fields are stored in database
- Create experiment ID generator: `exp-{timestamp}-{hash}`
- Implement parameter vector serialization
- Hash parameter vector for quick comparison
- Add data snapshot hashing
- Update database schema

**Files:**

- `packages/storage/src/engine/StorageEngine.ts` (extend)
- `packages/core/src/experiment-id-generator.ts` (new)
- `packages/core/src/parameter-vector.ts` (new)
- `tools/simulation/sql_functions.py` (extend)
- `scripts/migration/add-experiment-tracking.sql` (new)

**Success Criteria:**

- Metadata schema includes all required fields
- IDs are unique and deterministic
- Database schema updated
- Migration script works

### FR-4.2: Automatic Experiment Registration

**Description**: Automatically register experiments before execution

**Requirements:**

- Create experiment registry service
- Register experiment before simulation starts
- Update status during execution
- Store final metadata on completion
- Detect current git commit hash (or "unknown" if not in git)
- Hash canonical data used in simulation
- Handle experiment failures (store error, stack trace, failed_at)

**Files:**

- `packages/workflows/src/experiments/experiment-registry.ts` (new)
- `packages/workflows/src/simulation/runSimulation.ts` (integrate)
- `packages/utils/src/git.ts` (new)

**Success Criteria:**

- All experiments are automatically registered
- Git commit and data snapshot hashes stored
- Failures are captured
- No experiments are lost

### FR-4.3: Experiment Query Interface

**Description**: Enable querying experiments by various criteria

**Requirements:**

- Create `ExperimentRepository` port
- Interface: `get(id)`, `list(filter)`, `getByParameterHash(hash)`, `getByGitCommit(commit)`
- Implement DuckDB adapter
- Support filtering by: time range, strategy, git commit, parameter hash, status
- Add experiment CLI commands

**Files:**

- `packages/core/src/ports/experiment-repository-port.ts` (new)
- `packages/storage/src/adapters/experiment-duckdb-adapter.ts` (new)
- `packages/cli/src/commands/experiments/` (new)

**Success Criteria:**

- Repository interface implemented
- Adapter supports all query patterns
- CLI commands work

---

## PHASE V: STRATEGY DSL (Parallel to Phase IV, Week 5-6)

### FR-5.1: Strategy DSL Schema

**Description**: Define complete strategy DSL as structured data

**Requirements:**

- Define complete strategy DSL: entry conditions, exit conditions, re-entry rules, position sizing, risk constraints
- All as structured config (JSON/YAML)
- Create strategy DSL validator
- Implement DSL → Simulation Config converter
- Migrate existing strategies to DSL
- Add DSL documentation

**Files:**

- `packages/core/src/strategy/dsl-schema.ts` (new)
- `packages/core/src/strategy/dsl-validator.ts` (new)
- `packages/core/src/strategy/dsl-to-sim-input.ts` (new)
- `scripts/migration/strategies-to-dsl.ts` (new)
- `docs/STRATEGY_DSL.md` (new)

**Success Criteria:**

- DSL schema is complete
- Validator catches invalid strategies
- Converter works for all strategy types
- Existing strategies migrated

### FR-5.2: Strategy Templates

**Description**: Enable strategy templates with parameter placeholders

**Requirements:**

- Define template schema: DSL with parameter placeholders `{param_name: type, default, range}`
- Create template registry
- Templates are versioned artifacts
- Implement template instantiation: `instantiate(template, parameters) -> StrategyDSL`
- Validate parameters against template constraints
- Add template CLI commands
- Create initial template library (5-10 common templates)

**Files:**

- `packages/core/src/strategy/template-schema.ts` (new)
- `packages/core/src/strategy/template-registry.ts` (new)
- `packages/core/src/strategy/template-instantiation.ts` (new)
- `packages/cli/src/commands/strategies/templates.ts` (new)
- `packages/core/src/strategy/templates/` (new)
- `docs/STRATEGY_TEMPLATES.md` (new)

**Success Criteria:**

- Template system works
- Registry has initial templates
- CLI commands work
- Documentation complete

### FR-5.3: Strategy Mutation & Comparison

**Description**: Enable automated strategy mutation and comparison

**Requirements:**

- Implement strategy mutators: adjust parameter, add/remove exit condition, change position sizing
- Mutators are deterministic (seed-based)
- Create strategy comparator: same parameters? similar structure? different only in X?
- Add strategy diff tool (CLI)
- Implement strategy similarity metrics
- Used for deduplication in optimization

**Files:**

- `packages/analytics/src/strategy/mutators.ts` (new)
- `packages/analytics/src/strategy/comparator.ts` (new)
- `packages/cli/src/commands/strategies/diff.ts` (new)
- `packages/analytics/src/strategy/similarity.ts` (new)

**Success Criteria:**

- Mutators work and are deterministic
- Comparator accurately identifies similar strategies
- Diff tool works
- Similarity metrics are meaningful

---

## PHASE VI: OPTIMIZATION ENGINE (Critical Path - Week 6-8)

### FR-6.1: Optimization Infrastructure

**Description**: Create base infrastructure for optimization jobs

**Requirements:**

- Define optimization job schema: strategy template, parameter space, optimization algorithm, metrics to optimize
- Create optimization job repository
- Implement job runner: manages job queue, worker allocation, result collection
- Add optimization CLI commands
- Create base optimization interface: `Optimizer.optimize(searchSpace, objective, constraints) -> Result[]`

**Files:**

- `packages/core/src/optimization/job-schema.ts` (new)
- `packages/core/src/ports/optimization-job-repository-port.ts` (new)
- `packages/storage/src/adapters/optimization-job-duckdb-adapter.ts` (new)
- `packages/workflows/src/optimization/job-runner.ts` (new)
- `packages/cli/src/commands/optimize/` (new)
- `packages/analytics/src/optimization/optimizer-interface.ts` (new)

**Success Criteria:**

- Job schema defined
- Repository implemented
- Job runner works
- CLI commands work
- Base interface established

### FR-6.2: Grid Search Optimizer

**Description**: Implement grid search optimization

**Requirements:**

- Generate grid of parameter combinations
- Execute simulations for each combination
- Return ranked results
- Add early termination (kill bad runs early)
- Configurable termination criteria
- Test grid search

**Files:**

- `packages/analytics/src/optimization/grid-search.ts` (new)
- `packages/analytics/tests/unit/optimization/grid-search.test.ts` (new)

**Success Criteria:**

- Grid search works
- Early termination works
- Tests pass

### FR-6.3: Random Search Optimizer

**Description**: Implement random search optimization

**Requirements:**

- Sample random parameter combinations from search space
- Configurable: number of samples, sampling distribution
- Track parameter space coverage
- Prefer diverse samples
- Test random search

**Files:**

- `packages/analytics/src/optimization/random-search.ts` (new)
- `packages/analytics/tests/unit/optimization/random-search.test.ts` (new)

**Success Criteria:**

- Random search works
- Diversity metrics work
- Tests pass

### FR-6.4: Bayesian Optimization (Optional)

**Description**: Implement Bayesian optimization (can defer)

**Priority:** P2 (can defer)

**Requirements:**

- Research Bayesian optimization libraries (scikit-optimize, optuna, etc.)
- Choose library or implement from scratch
- Implement Bayesian optimizer: Gaussian process surrogate model, acquisition function (UCB, EI)
- Test Bayesian optimizer
- Compare to grid/random search on known functions

**Files:**

- `docs/OPTIMIZATION_RESEARCH.md` (new)
- `packages/analytics/src/optimization/bayesian-optimizer.ts` (new)
- `packages/analytics/tests/unit/optimization/bayesian-optimizer.test.ts` (new)

**Success Criteria:**

- Bayesian optimizer works
- Outperforms grid/random on test cases
- Tests pass

### FR-6.5: Pruning Heuristics

**Description**: Implement pruning rules to kill bad runs early

**Requirements:**

- Define pruning rules: max drawdown exceeded, win rate too low, Sharpe ratio too low, etc.
- Implement pruning system
- Check rules during optimization
- Kill runs that violate rules
- Integrate into all optimizers
- Test pruning

**Files:**

- `packages/analytics/src/optimization/pruning-rules.ts` (new)
- `packages/analytics/src/optimization/pruner.ts` (new)
- `packages/analytics/tests/unit/optimization/pruning.test.ts` (new)

**Success Criteria:**

- Pruning rules work
- Bad runs are killed early
- Tests pass

### FR-6.6: Multi-Objective Optimization

**Description**: Support multiple objective metrics

**Requirements:**

- Define multi-objective metrics: vector of metrics [return, Sharpe, max drawdown, win rate, latency sensitivity]
- Implement Pareto frontier calculation
- Extend optimizers to handle multiple objectives
- Test multi-objective optimization

**Files:**

- `packages/core/src/optimization/metrics.ts` (new)
- `packages/analytics/src/optimization/pareto-frontier.ts` (new)
- `packages/analytics/tests/unit/optimization/multi-objective.test.ts` (new)

**Success Criteria:**

- Multi-objective optimization works
- Pareto frontier is calculated correctly
- Tests pass

---

## PHASE VII: EXECUTION BRIDGE (Week 8-9)

### FR-7.1: Paper Trading Adapter

**Description**: Implement paper trading using simulation logic

**Requirements:**

- Create paper execution port
- Port simulates execution without real trades
- Uses execution models from Phase III
- Implement paper execution adapter
- Logs trades, tracks positions, calculates PnL
- Integrate into workflows
- Add paper trading CLI commands

**Files:**

- `packages/core/src/ports/paper-execution-port.ts` (new)
- `packages/workflows/src/adapters/paper-execution-adapter.ts` (new)
- `packages/cli/src/commands/paper/` (new)

**Success Criteria:**

- Paper execution works
- Positions tracked accurately
- CLI commands work

### FR-7.2: Live Execution Adapter (Stub)

**Description**: Create stub for live execution (safety-first)

**Requirements:**

- Create live execution port
- Same interface as paper, but executes real trades
- Implement stub adapter that always fails (safety-first)
- Can be replaced with real adapter later
- Add safety guards: max loss per strategy, max capital per strategy, kill switches
- Document live execution setup

**Files:**

- `packages/core/src/ports/live-execution-port.ts` (new)
- `packages/workflows/src/adapters/live-execution-stub-adapter.ts` (new)
- `packages/workflows/src/execution/safety-guards.ts` (new)
- `docs/LIVE_EXECUTION.md` (new)

**Success Criteria:**

- Port defined
- Stub adapter implemented
- Safety guards in place
- Documentation complete

### FR-7.3: Live Telemetry Collection

**Description**: Collect telemetry from live execution

**Requirements:**

- Define telemetry schema: slippage deltas vs sim, latency drift, unexpected failures
- Implement telemetry collection
- Store telemetry with experiments
- Use telemetry to improve execution models

**Files:**

- `packages/core/src/telemetry/telemetry-schema.ts` (new)
- `packages/workflows/src/execution/telemetry-collector.ts` (new)

**Success Criteria:**

- Telemetry schema defined
- Collection works
- Telemetry stored with experiments

---

## PHASE VIII: REPORTS & UI (Week 9-10)

### FR-8.1: Experiment Reports

**Description**: Generate rich reports for experiments

**Requirements:**

- Create report generator for experiments
- Include: metrics, parameter vectors, comparisons, visualizations
- Support export to PDF, HTML, JSON
- Add report CLI commands

**Files:**

- `packages/reporting/src/experiment-reports.ts` (new)
- `packages/cli/src/commands/reports/` (new)

**Success Criteria:**

- Reports generated correctly
- Multiple export formats supported
- CLI commands work

### FR-8.2: Lab UI Enhancements

**Description**: Enhance lab UI for experiment management

**Requirements:**

- Add experiment list view
- Add experiment detail view
- Add experiment comparison view
- Add optimization job management
- Add strategy DSL editor

**Files:**

- `packages/lab-ui/src/experiments/` (new)

**Success Criteria:**

- UI works for all experiment operations
- User experience is smooth

---

## PHASE IX: GOVERNANCE (Week 10-11)

### FR-9.1: Safety Guards

**Description**: Implement safety guards for live execution

**Requirements:**

- Max loss per strategy
- Max capital per strategy
- Kill switches
- Position limits
- Drawdown limits
- Exposure limits

**Files:**

- `packages/workflows/src/execution/safety-guards.ts` (extend)

**Success Criteria:**

- Safety guards work
- Guards prevent dangerous operations

### FR-9.2: Audit Trails

**Description**: Create audit trails for all operations

**Requirements:**

- Log all experiment executions
- Log all live trades
- Log all configuration changes
- Store audit logs in database
- Query audit logs

**Files:**

- `packages/core/src/audit/audit-log.ts` (new)
- `packages/storage/src/adapters/audit-duckdb-adapter.ts` (new)

**Success Criteria:**

- Audit trails work
- All operations logged
- Query interface works

---

## PHASE X: KNOWLEDGE RETENTION (Week 11-12)

### FR-10.1: Knowledge Base

**Description**: Capture learnings and patterns

**Requirements:**

- Document successful strategies
- Document failed strategies (and why)
- Document optimization findings
- Create knowledge base interface
- Enable knowledge sharing

**Files:**

- `docs/knowledge-base/` (new)
- `packages/knowledge/src/` (new)

**Success Criteria:**

- Knowledge base works
- Patterns documented
- Knowledge sharing enabled

---

## Technical Specifications

### Technology Stack

- **TypeScript**: 5.9+
- **pnpm**: Workspace management
- **DuckDB**: File-based database for storage
- **ClickHouse**: Time-series database for OHLCV (optional)
- **luxon**: Date/time handling
- **zod**: Schema validation
- **@quantbot/simulation**: Base simulation package (already exists)

### Dependencies

**Core Package:**

- `luxon` - Date/time
- `zod` - Validation

**Simulation Package:**

- `@quantbot/core` - Core types and determinism
- `@quantbot/core/determinism` - Deterministic RNG

**Storage Package:**

- `@quantbot/core` - Core types
- `duckdb` - DuckDB bindings

**Analytics Package:**

- `@quantbot/core` - Core types
- `@quantbot/simulation` - Simulation engine

### Architecture Principles

1. **Separation of Concerns**: Clear layer boundaries enforced by ESLint
2. **Determinism**: All simulations use seeded RNGs, versioned inputs
3. **Contracts**: Simulation contract is single source of truth
4. **Ports & Adapters**: Handlers depend on ports, adapters implement ports
5. **Immutability**: Raw data is append-only, artifacts are versioned
6. **Provenance**: Every experiment has full traceability

---

## Implementation Tasks

### Phase I Tasks

1. **Task 1.1**: Document layer boundaries and add ESLint rules
2. **Task 1.2**: Verify and extend determinism contract
3. **Task 1.3**: Implement artifact versioning system

### Phase II Tasks

1. **Task 2.1**: Refactor raw data to append-only
2. **Task 2.2**: Create canonical data schema
3. **Task 2.3**: Implement feature store

### Phase III Tasks

1. **Task 3.1**: Review and extend simulation contract
2. **Task 3.2**: Verify execution models completeness
3. **Task 3.3**: Verify clock resolution support

### Phase IV Tasks

1. **Task 4.1**: Extend run metadata schema
2. **Task 4.2**: Implement automatic experiment registration
3. **Task 4.3**: Create experiment query interface

### Phase V Tasks

1. **Task 5.1**: Define strategy DSL schema
2. **Task 5.2**: Implement strategy templates
3. **Task 5.3**: Add strategy mutation and comparison

### Phase VI Tasks

1. **Task 6.1**: Create optimization infrastructure
2. **Task 6.2**: Implement grid search
3. **Task 6.3**: Implement random search
4. **Task 6.4**: Implement Bayesian optimization (optional)
5. **Task 6.5**: Implement pruning heuristics
6. **Task 6.6**: Implement multi-objective optimization

### Phase VII Tasks

1. **Task 7.1**: Implement paper trading adapter
2. **Task 7.2**: Create live execution stub
3. **Task 7.3**: Implement telemetry collection

### Phase VIII Tasks

1. **Task 8.1**: Create experiment reports
2. **Task 8.2**: Enhance lab UI

### Phase IX Tasks

1. **Task 9.1**: Implement safety guards
2. **Task 9.2**: Create audit trails

### Phase X Tasks

1. **Task 10.1**: Create knowledge base

---

## Success Criteria

### Phase I Success Criteria

- ✅ ESLint blocks cross-layer imports
- ✅ Architecture tests pass in CI
- ✅ All simulations accept seed parameter
- ✅ Same inputs + seed → byte-identical outputs
- ✅ Artifact system works end-to-end

### Phase II Success Criteria

- ✅ Raw data is append-only
- ✅ Canonical schema defined and validated
- ✅ Feature store works

### Phase III Success Criteria

- ✅ Simulation contract is complete
- ✅ Execution models work (no perfect fills)
- ✅ Clock resolution supported

### Phase IV Success Criteria

- ✅ All experiments automatically registered
- ✅ Full provenance captured
- ✅ Experiment query interface works

### Phase V Success Criteria

- ✅ Strategy DSL complete
- ✅ Templates work
- ✅ Mutation and comparison work

### Phase VI Success Criteria

- ✅ Optimization infrastructure works
- ✅ Multiple optimizers implemented
- ✅ Pruning works
- ✅ Multi-objective optimization works

### Phase VII Success Criteria

- ✅ Paper trading works
- ✅ Live execution stub in place
- ✅ Telemetry collection works

### Phase VIII Success Criteria

- ✅ Reports generated correctly
- ✅ Lab UI enhanced

### Phase IX Success Criteria

- ✅ Safety guards work
- ✅ Audit trails work

### Phase X Success Criteria

- ✅ Knowledge base works

---

## Dependencies

### External Dependencies

- Existing DuckDB database with alerts table
- Existing ClickHouse database with OHLCV tables (optional)
- Database connection credentials/config
- Git repository (for commit hash detection)

### Internal Dependencies

- `@quantbot/core` - Core types and determinism
- `@quantbot/simulation` - Simulation engine (base package)
- `@quantbot/storage` - Storage adapters
- `@quantbot/workflows` - Workflow orchestration
- `@quantbot/cli` - CLI interface

---

## Risks & Mitigations

**Risk**: Architectural drift after Phase I  
**Mitigation**: ESLint rules and CI tests prevent violations

**Risk**: Non-deterministic code introduced  
**Mitigation**: Determinism tests catch violations, code review enforces patterns

**Risk**: Performance issues with optimization  
**Mitigation**: Pruning heuristics kill bad runs early, parallel execution

**Risk**: Live execution safety  
**Mitigation**: Stub adapter prevents accidental live trading, safety guards enforce limits

**Risk**: Data quality issues  
**Mitigation**: Canonical schema validation, data quality checks

---

## Open Questions

1. Should we use Python for optimization algorithms (scikit-optimize, optuna) or TypeScript implementations?
2. What level of data validation should be performed at the canonical layer?
3. Should we implement caching for frequently accessed data?
4. How should we handle database connection pooling?
5. What's the best format for strategy DSL (JSON vs YAML)?

---

## Next Steps

1. **Review this PRD** with stakeholders
2. **Approve package recommendation** (`@quantbot/simulation`)
3. **Prioritize phases** (Phase I is critical path)
4. **Assign owners** to each phase/task
5. **Begin Phase I** implementation

---

## Appendix: Package Analysis

### Current State Analysis

**`@quantbot/simulation` Package:**

- ✅ Determinism correctly implemented (`DeterministicRNG`, seed management)
- ✅ Simulation contract formalized (`SimInputSchema`, `SimResult`)
- ✅ Execution models implemented (no perfect fills)
- ✅ Clock resolution support (`ms`, `s`, `m`, `h`)
- ✅ Clean architecture (types, core, execution, indicators, position)
- ✅ Contract adapter pattern
- ✅ Contract validator

**`@quantbot/backtest` Package:**

- ⚠️ Now a compatibility shim (re-exports from `@quantbot/simulation/backtest`)
- ✅ Uses `@quantbot/simulation` internally
- ✅ Determinism correctly implemented (uses `@quantbot/core` determinism)

### Recommendation

**Use `@quantbot/simulation` as the base package** for the research lab roadmap because:

1. It already has all the foundational pieces:
   - Determinism correctly implemented
   - Simulation contract formalized
   - Execution models (no perfect fills)
   - Clock resolution support
   - Clean architecture

2. The `backtest` package is just a compatibility layer, so building on `simulation` directly is cleaner

3. All new features (experiment tracking, optimization, DSL) should extend `simulation` rather than creating parallel systems

### Action Items

1. ✅ Verify determinism implementation is complete (already done - it's correct)
2. ✅ Verify simulation contract is complete (already done - it's formalized)
3. ✅ Use `@quantbot/simulation` as base package
4. ✅ Extend existing contracts rather than creating new ones
5. ✅ Build on existing determinism infrastructure
