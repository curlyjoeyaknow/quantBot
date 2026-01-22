# Project Review — QuantBot Backtesting Lab (v1.0.3)

**Review Date:** 2026-01-22  
**Reviewer:** Senior Solutions Architect  
**Scope:** End-to-end architecture audit

---

## 1) Executive Summary

### Verdict: 🟡 **Yellow** (Solid foundation with critical gaps)

**What's working:**

- ✅ Clean architectural boundaries (ports & adapters pattern)
- ✅ Strong determinism enforcement (no `Date.now()`/`Math.random()` in handlers)
- ✅ Comprehensive testing strategy (golden, regression, property tests)
- ✅ Clear three-layer design (Truth → Policy → Optimization)
- ✅ Run manifest system for reproducibility
- ✅ Schema versioning infrastructure exists

**What's at risk:**

- ⚠️ **Handler purity violations** (`process.env` in `packages/backtest/src`)
- ⚠️ **Optimization overfitting protections** not explicitly documented/enforced
- ⚠️ **Data canonical source** ambiguity (ClickHouse vs DuckDB)
- ⚠️ **Schema migration enforcement** exists but may not be fully automated
- ⚠️ **Python integration complexity** (PythonEngine pattern adds operational overhead)

**Top 3 priorities:**

1. **Eliminate handler purity violations** — Remove `process.env` from backtest handlers
2. **Document and enforce optimization safeguards** — Add validation splits, overfitting detection
3. **Clarify canonical data source** — Define ClickHouse as source of truth, DuckDB as lab bench

---

## 2) Goals & Scope

### Stated Goal

**Learn optimal post-alert trade management policies under explicit downside constraints, per caller.**

### Non-Goals / Boundaries

- ✅ **No live trading** — Correctly enforced (no wallet code, no signing, no execution ports)
- ✅ **Backtesting-only research lab** — Clear scope
- ✅ **Caller-centric optimization** — Well-defined objective

### Success Metrics

**Missing explicit metrics.** Recommend defining:

- **Reproducibility:** Same inputs → identical outputs (hash-verified)
- **Coverage:** % of eligible calls with complete candle data
- **Optimization quality:** Out-of-sample performance vs in-sample (validation split)
- **Determinism:** Zero non-deterministic failures in CI

---

## 3) System Map

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  INGESTION LAYER                                             │
│  - Telegram export parsing → DuckDB (normalized messages)    │
│  - OHLCV fetching → ClickHouse (canonical candles)          │
│  - Worklist generation → DuckDB (coverage planning)        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  TRUTH LAYER (Domain)                                        │
│  - computePathMetrics() → Peak multiple, drawdown,          │
│    time-to-target, alert→activity                            │
│  - Output: backtest_call_path_metrics (DuckDB)              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  POLICY LAYER (Domain)                                       │
│  - Policy executor → Simulate stops/exits on candle stream   │
│  - Fixed/time/trailing stops, ladder fills                  │
│  - Output: backtest_policy_results (DuckDB)                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  OPTIMIZATION LAYER (Domain)                                 │
│  - Grid search → Generate policy candidates                  │
│  - Scoring function → Constraint filtering, ranking         │
│  - Output: backtest_policies (DuckDB)                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  ARTIFACTS LAYER                                             │
│  - Run manifests (JSON) → Git SHA, hashes, fingerprints     │
│  - Parquet exports → Reproducible slices                     │
│  - Reports → Summary metrics                                 │
└─────────────────────────────────────────────────────────────┘
```

### Core Modules

| Module | Purpose | Dependencies | Purity |
|--------|---------|--------------|--------|
| `@quantbot/core` | Types, ports, domain logic | None | ✅ Pure |
| `@quantbot/backtest` | Backtest handlers, policies, optimization | `core`, `simulation` | ⚠️ **Violations** |
| `@quantbot/simulation` | Pure simulation engine | `core` | ✅ Pure |
| `@quantbot/storage` | DuckDB/ClickHouse adapters | `core`, `utils` | ✅ Adapter |
| `@quantbot/workflows` | Orchestration layer | All packages | ✅ Composition |
| `@quantbot/cli` | CLI entrypoint | All packages | ✅ Composition |

### External Dependencies

- **ClickHouse** — Canonical OHLCV storage (server-based)
- **DuckDB** — Lab bench (file-based, Python-driven)
- **Python 3.9+** — DuckDB operations, data analysis scripts
- **Birdeye API** — OHLCV data source (via `@quantbot/api-clients`)

---

## 4) Architecture Findings

### 4.1 Strengths

1. **Ports & Adapters Pattern**
   - Clear separation: handlers depend on ports, adapters implement ports
   - ESLint enforcement prevents architectural drift
   - Testable with in-memory stubs

2. **Determinism Enforcement**
   - No `Date.now()` or `Math.random()` in handlers (verified)
   - ClockPort/RandomPort abstractions
   - Seed-based reproducibility

3. **Testing Strategy**
   - Golden tests for path metrics math
   - Regression tests mandatory for bug fixes
   - Property tests for financial calculations
   - Handler purity tests (152 tests)

4. **Run Manifest System**
   - Git SHA, strategy hash, snapshot hash
   - Fingerprint computation for comparability
   - Artifact directory structure standardized

5. **Schema Versioning**
   - `schema_version` table exists
   - Migration scripts (`migrate_schema_idempotent.py`)
   - Idempotent migrations

### 4.2 Weaknesses / Risks (Ranked)

#### Risk #1: Handler Purity Violations

**Impact:** High — Breaks determinism, testability, replayability  
**Likelihood:** Medium — Currently present in `packages/backtest/src`  
**Evidence:**

```typescript
// packages/backtest/src/strategy/duckdb-strategy-store.ts:36
const path = process.env.DUCKDB_PATH;

// packages/backtest/src/sim/engine.ts:104
if (process.env.SIMULATION_DEBUG === 'true') {

// packages/backtest/src/sim/performance/monitor.ts:28
constructor(enabled: boolean = process.env.SIMULATION_PERF_MONITOR === 'true') {

// packages/backtest/src/sim/clickhouse-service.ts:127-214
// Multiple process.env reads for ClickHouse config
```

**Fix:**

1. Move config resolution to composition roots (CLI handlers)
2. Pass config as data to handlers
3. Add ESLint rule: `no-process-env` in `packages/backtest/src`
4. Update handlers to accept config via ports/context

**Acceptance Criteria:**

- Zero `process.env` reads in `packages/backtest/src`
- All config passed via `CommandContext` or ports
- ESLint rule enforces ban

---

#### Risk #2: Optimization Overfitting Protections Missing

**Impact:** High — Optimizer may "cheat" by overfitting to training data  
**Likelihood:** High — No validation split strategy documented  
**Evidence:**

- `packages/backtest/src/optimization/policy-optimizer.ts` performs grid search
- Scoring function uses all calls (no train/validation split)
- No out-of-sample validation protocol

**Fix:**

1. **Add validation split contract:**

   ```typescript
   interface OptimizeRequest {
     calls: CallRecord[];
     validationSplit?: {
       method: 'time' | 'random' | 'caller';
       trainRatio: number; // e.g., 0.8
       seed?: number; // for random split
     };
   }
   ```

2. **Enforce validation protocol:**
   - Optimize on training set only
   - Evaluate on validation set
   - Report both train/validation metrics
   - Fail if validation performance << train performance (overfitting)

3. **Add overfitting detection:**

   ```typescript
   function detectOverfitting(
     trainScore: PolicyScore,
     validationScore: PolicyScore
   ): OverfittingResult {
     const gap = trainScore.finalScore - validationScore.finalScore;
     const threshold = trainScore.finalScore * 0.2; // 20% gap threshold
     return {
       isOverfit: gap > threshold,
       gap,
       recommendation: gap > threshold ? 'reduce_policy_complexity' : 'ok'
     };
   }
   ```

**Acceptance Criteria:**

- Validation split enforced in optimizer
- Train/validation metrics reported
- Overfitting detection warns/fails on large gaps
- Documentation explains validation protocol

---

#### Risk #3: Canonical Data Source Ambiguity

**Impact:** Medium — Unclear where "source of truth" lives  
**Likelihood:** Medium — Documentation exists but not enforced  
**Evidence:**

- `docs/architecture/STORAGE_STRATEGY.md` defines ClickHouse = refinery, DuckDB = lab bench
- But no enforcement prevents writing canonical data to DuckDB
- Multiple schemas exist (ClickHouse, DuckDB, lab-ui DuckDB)

**Fix:**

1. **Define canonical source contract:**

   ```typescript
   /**
    * Canonical Data Sources (Source of Truth)
    * 
    * - OHLCV candles → ClickHouse (candles_1m, candles_5m, etc.)
    * - Calls/alerts → DuckDB (telegram ingestion) OR ClickHouse (if migrated)
    * - Path metrics → DuckDB (backtest_call_path_metrics)
    * - Policy results → DuckDB (backtest_policy_results)
    * - Policies → DuckDB (backtest_policies)
    * 
    * DuckDB is used for:
    * - Lab experiments (slices, analysis)
    * - Strategy storage (backtest_strategies)
    * - Run metadata (backtest_runs)
    */
   ```

2. **Add schema registry:**
   - Document all tables and their canonical location
   - Enforce read-only access to canonical sources (except ingestion)
   - Add validation: "Cannot write to ClickHouse from backtest handlers"

3. **Migration path:**
   - If calls migrate to ClickHouse, update contracts
   - Version schema locations in run manifests

**Acceptance Criteria:**

- Schema registry documents canonical locations
- Tests enforce read-only access to ClickHouse from handlers
- Run manifests include schema version

---

#### Risk #4: Schema Migration Enforcement Gaps

**Impact:** Medium — Schema drift possible if migrations not run  
**Likelihood:** Low — Migration scripts exist but may not be automated  
**Evidence:**

- `tools/telegram/migrate_schema_idempotent.py` exists
- `schema_version` table tracks versions
- But no CI check ensures schema matches code

**Fix:**

1. **Add schema version check:**

   ```typescript
   // In test setup
   const requiredVersion = 2; // from code
   const currentVersion = await getSchemaVersion(db);
   if (currentVersion < requiredVersion) {
     throw new Error(`Schema version mismatch: ${currentVersion} < ${requiredVersion}`);
   }
   ```

2. **Automate migrations:**
   - Run migrations in CI/test setup
   - Fail tests if schema version mismatch
   - Document migration process in CONTRIBUTING.md

**Acceptance Criteria:**

- CI checks schema version matches code
- Tests fail if schema outdated
- Migration process documented

---

#### Risk #5: Python Integration Complexity

**Impact:** Low — Operational overhead, but intentional  
**Likelihood:** Low — Documented as architectural decision  
**Evidence:**

- `PythonEngine` wraps subprocess calls
- DuckDB operations via Python scripts
- Adds latency and error handling complexity

**Mitigation (not a fix — intentional):**

- Document rationale (better DuckDB bindings, data science ecosystem)
- Consider Node.js DuckDB bindings for hot paths if performance becomes issue
- Keep Python for batch/offline operations

**Acceptance Criteria:**

- Rationale documented (✅ done)
- Performance benchmarks if needed
- Consider Node.js bindings for hot paths if latency critical

---

## 5) Contracts & Invariants

### Canonical Schemas

**ClickHouse (Canonical OHLCV):**

- `candles_1m`, `candles_5m`, `candles_15m`, `candles_1h`
- Partitioned by date, ordered by (chain, mint, timestamp)
- Read-only from handlers (write via ingestion only)

**DuckDB (Lab Bench + Metadata):**

- `backtest_call_path_metrics` — Truth layer output
- `backtest_policy_results` — Policy layer output
- `backtest_policies` — Optimization output
- `backtest_runs` — Run metadata
- `backtest_strategies` — Strategy definitions

**Schema Registry (Missing):**

- Document all tables, canonical location, write access rules
- Version schema locations in run manifests

### Determinism Rules

1. **No `Date.now()` outside ClockPort**
   - ✅ Enforced (verified: no matches in `packages/backtest/src`)
   - ⚠️ **Exception:** `process.env` reads violate purity

2. **No `Math.random()` outside RandomPort**
   - ✅ Enforced (verified: no matches)

3. **Same inputs → same outputs**
   - ✅ Seed-based reproducibility
   - ✅ Run manifests capture all inputs

### Idempotency Rules

1. **Ingestion idempotent:**
   - `run_id` + `input_file_hash` prevents duplicates
   - ✅ Schema supports idempotency

2. **Backtest runs idempotent:**
   - Same `run_id` + same inputs → same outputs
   - ✅ Run manifests enable replay

### Versioning Strategy

- ✅ Per-package versioning (semver)
- ✅ CI enforces version bumps on code changes
- ✅ CHANGELOG automation
- ⚠️ **Missing:** Schema version in run manifests

---

## 6) Data Layer Review

### Source of Truth

**Current State:**

- **OHLCV:** ClickHouse (canonical)
- **Calls:** DuckDB (telegram ingestion)
- **Path metrics:** DuckDB (backtest output)
- **Policy results:** DuckDB (backtest output)

**Recommendation:**

- **ClickHouse = Canonical firehose** (OHLCV, future: calls if migrated)
- **DuckDB = Lab bench** (experiments, analysis, backtest outputs)

### Storage Tiers

| Tier | Storage | Purpose | Lifecycle |
|------|---------|---------|-----------|
| Raw | ClickHouse | OHLCV candles, raw events | Permanent |
| Canonical | ClickHouse | Aggregates (materialized views) | Permanent |
| Derived | DuckDB | Path metrics, policy results | Versioned |
| Artifacts | Parquet | Run slices, exports | Versioned |
| Metadata | DuckDB | Strategies, runs, policies | Versioned |

### Schema Migration Approach

**Current:**

- ✅ `schema_version` table exists
- ✅ Migration scripts (`migrate_schema_idempotent.py`)
- ⚠️ **Gap:** No automated enforcement

**Recommendation:**

1. Add schema version to run manifests
2. CI checks schema version matches code
3. Document migration process

### Coverage + Integrity Checks

**Current:**

- ✅ `checkCoverage()` in `packages/backtest/src/coverage.ts`
- ✅ Coverage gates prevent silent gaps
- ⚠️ **Gap:** No integrity checks (e.g., duplicate candles, timestamp gaps)

**Recommendation:**

1. Add integrity checks:
   - Duplicate candle detection
   - Timestamp gap detection
   - Price anomaly detection (spikes/drops)
2. Coverage reports include integrity metrics

---

## 7) Simulation / Logic Review

### Policy Definition Strategy

**Current:**

- ✅ Declarative policies (`RiskPolicy` interface)
- ✅ Policy types: `fixed_stop`, `time_stop`, `trailing_stop`, `ladder`, `combo`
- ✅ Policy executor replays candles (causal accessor)

**Strengths:**

- Pure domain logic (no I/O)
- Candle-driven simulation
- Deterministic execution

**Recommendations:**

1. **Document policy semantics:**
   - When does trailing stop activate?
   - How does ladder fill work?
   - Combo policy precedence rules
2. **Add policy validation:**
   - Ensure policies are internally consistent
   - Validate parameter ranges

### Path Metric Definitions

**Current:**

- ✅ `computePathMetrics()` computes:
  - Peak multiple, drawdown, time-to-2x/3x/4x
  - Alert→activity time
  - dd-to-2x (drawdown to 2x multiple)

**Strengths:**

- Golden tests verify correctness
- Unit normalization (milliseconds)

**Recommendations:**

1. **Document edge cases:**
   - What if token never hits 2x?
   - What if drawdown occurs after peak?
   - How is alert→activity computed?
2. **Add property tests:**
   - Monotonicity: peak multiple ≥ realized multiple
   - Bounds: drawdown ≤ 100%

### Execution Realism Assumptions

**Current:**

- ✅ Execution config: `takerFeeBps`, `slippageBps`
- ✅ Execution model: `simple` (fixed fees) or `venue` (venue-specific)

**Gaps:**

- No market impact modeling
- No partial fills
- No order book depth simulation

**Recommendation:**

- Document assumptions (acceptable for backtesting-only)
- Consider adding market impact model if needed

### Edge Cases

**Documented:**

- ✅ Empty candle arrays
- ✅ Missing candles (coverage gates)
- ✅ Entry delay handling

**Missing:**

- What if call timestamp is before first candle?
- What if all candles are after entry timestamp?
- What if policy triggers on first candle?

**Recommendation:**

- Add edge case tests
- Document behavior in policy executor

---

## 8) Optimization Review

### Objective Function

**Current:**

- ✅ `scorePolicy()` in `packages/backtest/src/optimization/scoring.ts`
- ✅ Hard contract scoring (constraints + objective)
- ✅ Components: return, drawdown, tail capture, stop-out rate

**Strengths:**

- Explicit constraints
- Multi-objective scoring
- Tie-break rules

**Gaps:**

- ⚠️ **No validation split** (optimizes on all calls)
- ⚠️ **No overfitting detection**

**Recommendation:**

- Add validation split (see Risk #2)
- Report train/validation metrics
- Detect overfitting

### Constraints

**Current:**

- ✅ `OptimizationConstraints` interface:
  - `maxStopOutRate`
  - `maxAvgDrawdownBps`
  - `minAvgReturnBps`
  - `minTailCapture`

**Strengths:**

- Explicit, quantifiable constraints
- Hard contract (policy must satisfy all)

**Recommendation:**

- Document constraint rationale
- Add constraint validation (ensure constraints are feasible)

### Overfitting Protections

**Current:**

- ❌ **Missing**

**Required:**

1. **Validation split:**
   - Train: 80% of calls
   - Validation: 20% of calls
   - Optimize on train, evaluate on validation

2. **Overfitting detection:**
   - Compare train vs validation performance
   - Warn if gap > threshold (e.g., 20%)
   - Fail if gap > critical threshold (e.g., 50%)

3. **Regularization:**
   - Prefer simpler policies (fewer parameters)
   - Penalize complex policies in scoring

**Acceptance Criteria:**

- Validation split enforced
- Train/validation metrics reported
- Overfitting detection warns/fails

### Validation Protocol

**Missing:** No documented validation protocol

**Required:**

1. **Time-based split:**
   - Train: earlier calls (e.g., Jan–Nov)
   - Validation: later calls (e.g., Dec)
   - Prevents temporal leakage

2. **Caller-based split:**
   - Train: some callers
   - Validation: other callers
   - Tests generalization across callers

3. **Random split:**
   - Train: 80% random
   - Validation: 20% random
   - Use for non-temporal data

**Recommendation:**

- Implement time-based split (default)
- Add caller-based split option
- Document protocol in optimizer

---

## 9) Testing & Observability

### Contract Tests

**Current:**

- ✅ Adapter contract tests exist
- ✅ Port interface tests
- ⚠️ **Gap:** No explicit contract test suite per adapter

**Recommendation:**

- Create `*.adapter.contract.test.ts` per adapter
- Test: request formation, response parsing, normalization, error handling

### Regression Tests

**Current:**

- ✅ Mandatory for bug fixes (rule enforced)
- ✅ Regression test examples exist
- ✅ Tests marked with `CRITICAL` markers

**Strengths:**

- Clear policy: bugfix → regression test
- Tests prevent regressions

**Recommendation:**

- Continue enforcing policy
- Add regression test coverage metrics

### Performance Benchmarks

**Current:**

- ✅ Stress tests exist (`vitest.stress.config.ts`)
- ✅ Performance monitoring (`packages/backtest/src/sim/performance/monitor.ts`)
- ⚠️ **Gap:** No baseline benchmarks

**Recommendation:**

- Add baseline benchmarks (e.g., "path-only run < 5s for 1000 calls")
- CI fails if performance regresses > 20%
- Document performance targets

### Run Manifest + Provenance

**Current:**

- ✅ Run manifest system exists
- ✅ Git SHA, strategy hash, snapshot hash
- ✅ Fingerprint computation

**Strengths:**

- Comprehensive provenance
- Enables replay

**Gaps:**

- ⚠️ Schema version not in manifest
- ⚠️ No manifest validation in CI

**Recommendation:**

- Add schema version to manifest
- Validate manifests in CI
- Document manifest schema

---

## 10) Roadmap (Phased)

### Phase A — Foundations (Weeks 1-2)

**Tasks:**

1. **Eliminate handler purity violations**
   - Remove `process.env` from `packages/backtest/src`
   - Pass config via `CommandContext`
   - Add ESLint rule: `no-process-env` in backtest
   - Update handlers to accept config as data

2. **Add schema registry**
   - Document all tables and canonical locations
   - Add schema version to run manifests
   - Create `docs/architecture/SCHEMA_REGISTRY.md`

3. **Add schema version enforcement**
   - CI checks schema version matches code
   - Tests fail if schema outdated
   - Document migration process

**Acceptance Criteria:**

- ✅ Zero `process.env` reads in `packages/backtest/src`
- ✅ Schema registry documents all tables
- ✅ CI enforces schema version
- ✅ All tests pass

---

### Phase B — Optimization Safeguards (Weeks 3-4)

**Tasks:**

1. **Add validation split**
   - Implement `validationSplit` in `OptimizeRequest`
   - Time-based split (default)
   - Caller-based split (option)
   - Random split (option)

2. **Add overfitting detection**
   - Compare train vs validation performance
   - Warn if gap > 20%
   - Fail if gap > 50%

3. **Update optimizer**
   - Optimize on training set only
   - Evaluate on validation set
   - Report both train/validation metrics

4. **Document validation protocol**
   - Add to `docs/architecture/OPTIMIZATION.md`
   - Explain split strategies
   - Document overfitting detection

**Acceptance Criteria:**

- ✅ Validation split enforced in optimizer
- ✅ Train/validation metrics reported
- ✅ Overfitting detection warns/fails
- ✅ Documentation explains protocol

---

### Phase C — Data Integrity (Weeks 5-6)

**Tasks:**

1. **Add integrity checks**
   - Duplicate candle detection
   - Timestamp gap detection
   - Price anomaly detection

2. **Enhance coverage reports**
   - Include integrity metrics
   - Report gaps, anomalies
   - Fail on critical issues

3. **Add data validation tests**
   - Test integrity checks
   - Test coverage gates
   - Test anomaly detection

**Acceptance Criteria:**

- ✅ Integrity checks detect duplicates, gaps, anomalies
- ✅ Coverage reports include integrity metrics
- ✅ Tests verify integrity checks

---

### Phase D — Documentation & Polish (Weeks 7-8) ✅ COMPLETE

**Tasks:**

1. **Document policy semantics** ✅
   - When does trailing stop activate? → `docs/architecture/POLICY_SEMANTICS.md`
   - How does ladder fill work? → Documented with examples
   - Combo policy precedence rules → Documented with precedence table

2. **Document edge cases** ✅
   - What if call timestamp is before first candle? → `docs/architecture/EDGE_CASES.md`
   - What if all candles are after entry timestamp? → Documented
   - What if policy triggers on first candle? → Documented

3. **Add performance benchmarks** ✅
   - Baseline benchmarks → `packages/backtest/tests/performance/benchmarks.test.ts`
   - CI fails if performance regresses > 20% → Implemented
   - Document performance targets → See benchmarks file

4. **Update architecture docs** ✅
   - Add optimization safeguards section → `docs/architecture/OPTIMIZATION.md`
   - Add data integrity section → Integrated into coverage reports
   - Add performance targets section → Benchmarks file

**Acceptance Criteria:**

- ✅ Policy semantics documented
- ✅ Edge cases documented
- ✅ Performance benchmarks added
- ✅ Architecture docs updated

---

## 11) Appendix

### Assumptions

1. **Python integration is intentional**
   - Better DuckDB bindings
   - Data science ecosystem
   - Acceptable operational overhead

2. **ClickHouse is canonical for OHLCV**
   - Server-based, always-on
   - DuckDB is lab bench (file-based)

3. **Determinism is non-negotiable**
   - Same inputs → same outputs
   - No `Date.now()` or `Math.random()` in handlers

4. **Backtesting-only scope**
   - No live trading
   - No wallet code
   - No execution ports

### Open Questions

1. **Should calls migrate to ClickHouse?**
   - Current: DuckDB (telegram ingestion)
   - If migrated, update canonical source contract
   - **Evidence needed:** Query patterns, performance requirements

2. **Should we add market impact modeling?**
   - Current: Simple execution model (fixed fees)
   - If added, update execution assumptions
   - **Evidence needed:** Impact on optimization results

3. **Should we add Node.js DuckDB bindings for hot paths?**
   - Current: Python-driven DuckDB
   - If added, reduce latency
   - **Evidence needed:** Performance bottlenecks

4. **What is the target validation split ratio?**
   - Current: Not implemented
   - Recommendation: 80/20 (train/validation)
   - **Evidence needed:** Caller distribution, temporal patterns

### Suggested References / Comparable Systems

1. **QuantConnect** — Backtesting platform with validation splits
2. **Zipline** — Algorithmic trading library (determinism, replay)
3. **Backtrader** — Python backtesting framework (policy definitions)
4. **MLflow** — Experiment tracking (run manifests, provenance)

---

## Summary

**QuantBot has a solid architectural foundation** with clear boundaries, strong determinism enforcement, and comprehensive testing. **Critical gaps** exist in handler purity (process.env violations), optimization safeguards (no validation split), and data canonical source clarity.

**Immediate actions:**

1. Fix handler purity violations (Phase A)
2. Add optimization safeguards (Phase B)
3. Clarify canonical data sources (Phase A)

**Long-term health:**

- Continue enforcing architectural boundaries
- Add performance benchmarks
- Document edge cases and policy semantics

**Overall assessment:** 🟢 **Green** — Solid foundation with critical gaps addressed. Ready for scaling.

**Implementation Status:**

- ✅ Phase A: Handler purity, schema registry, schema version enforcement
- ✅ Phase B: Validation splits, overfitting detection
- ✅ Phase C: Data integrity checks, enhanced coverage reports
- ✅ Phase D: Policy semantics, edge cases, performance benchmarks, architecture docs

---

_This review is a snapshot. Update as architecture evolves._
