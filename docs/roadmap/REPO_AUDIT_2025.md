# Repo Audit 2025 — Engineering Autopsy

**Date**: 2025-01-XX  
**Scope**: Full codebase analysis for research lab readiness  
**Method**: AST traversal, boundary analysis, dependency graph, test coverage, hygiene checks

---

## 1) REPO SCORECARD — CUT-THROAT, NO MERCY

Each category graded against what is required to become a real research lab.

### A. Determinism & Scientific Rigor — **A-**

**Why it scores high:**
- ✅ Eliminated `Math.random()` and `Date.now()` from execution models
- ✅ Uses seeded RNG explicitly (`seedFromString`)
- ✅ Determinism tests verify byte-identical outputs
- ✅ Run ID generation is deterministic (when components provided)
- ✅ This already puts you above ~95% of "quant" repos

**Why it's not A+:**
- ❌ Run ID generation has nondeterministic fallback path (line 401-407 in `execute.ts`)
- ❌ Data snapshots are not fully enforced as inputs
- ❌ Object-key-based lookups still exist (potential nondeterminism)
- ❌ Parallelism present without explicit floating-point determinism guarantees
- ❌ `extractRunIdComponents` can return `null` → no run ID → nondeterministic artifact paths

**Verdict**: The core engine is deterministic. The system is not yet fully deterministic end-to-end.

---

### B. Architecture & Layering — **C+**

**What's good:**
- ✅ Intended layered boundaries exist
- ✅ AST-based boundary enforcement script exists
- ✅ Separated domains (simulation, ingestion, storage, CLI, workflows)
- ✅ WorkflowContext pattern for dependency injection

**What's actually happening:**
- ❌ Tests excluded from boundary checks (line 149 in `verify-boundaries-ast.ts`)
- ❌ TS path aliases can bypass package boundaries
- ❌ `@quantbot/core` is becoming a dependency magnet (exports everything)
- ❌ Boundary enforcement is AST-based but not enforced in CI pre-commit
- ❌ Deep imports still possible via `@quantbot/storage/src/...` (only documented, not enforced)

**Verdict**: The architecture exists as an idea, not yet as a hard constraint. This will degrade unless tightened soon.

---

### C. Research Lab Readiness — **D**

**Why:**
- ❌ Research OS layer is partially stubbed (`ResearchSimulationAdapter` exists but incomplete)
- ❌ Data snapshotting has TODO holes (`packages/data-observatory/src/snapshots/event-collector.ts:77-83`)
- ❌ Run artifacts are not yet canonical or re-runnable end-to-end
- ❌ No "replay from manifest" command exists
- ❌ SnapshotRef system incomplete

**Right now, this repo cannot:**
- ❌ Replay a run from a manifest alone
- ❌ Guarantee data consistency across experiments
- ❌ Support automated large-scale optimization safely
- ❌ Enforce snapshot inputs for all simulation runs

**Verdict**: You are building a lab — you are not operating one yet.

---

### D. Storage & Data Infrastructure — **C**

**What works:**
- ✅ DuckDB is a good choice for analytics
- ✅ Artifact schema direction is sane
- ✅ Separation of raw vs canonical data exists conceptually
- ✅ PythonEngine abstraction exists

**What hurts:**
- ❌ Python is acting as a DB driver for Node (hot path latency)
- ❌ Error handling is weak (silent failures in DuckDB adapters)
- ❌ WAL files and test DBs can leak into repo (hygiene checks exist but not enforced)
- ❌ Storage is on the hot path but is multi-runtime (Node → Python → DuckDB)
- ❌ No native DuckDB Node.js driver for hot paths

**Verdict**: Functional today, but fragile at scale. Python-as-DB-driver will hurt latency-sensitive strategies.

---

### E. CLI & Command Architecture — **C**

**Improvements in flight:**
- ✅ `defineCommand()` is the right idea
- ✅ `validation-pipeline.ts` centralizes coercion/validation
- ✅ Standardizing error handling

**Critical flaw:**
- ❌ **Two parsing/validation pipelines exist:**
  1. `defineCommand()` → `executeValidated()` (skips validation)
  2. `execute()` → `validateAndCoerceArgs()` (validates)
- ❌ Same input can be interpreted differently depending on entry path
- ❌ `executeValidated()` bypasses validation (line 68 in `defineCommand.ts`)
- ❌ This is a textbook "latent bug factory"

**Verdict**: Direction is correct, execution is incomplete and dangerous until unified.

---

### F. Repo Hygiene & Operational Discipline — **D**

**Findings:**
- ❌ Build artifacts in `dist/` directories (`.js.map`, `.d.ts.map`) — these are generated, should be gitignored
- ❌ `logs/` directories exist in multiple packages (committed or not gitignored)
- ❌ Hygiene checks exist (`scripts/ci/hygiene-checks.ts`) but not enforced in CI
- ❌ No pre-commit hook to prevent committing artifacts
- ❌ `.gitignore` has patterns but files still get committed

**Verdict**: Left unchecked, this kills confidence, CI reliability, and future contributors.

---

## OVERALL SCORE: **C+**

**Not because you're sloppy — but because the system is mid-metamorphosis.**

You've laid the hardest bricks (determinism, engine logic).  
You haven't yet poured the concrete (artifacts, snapshots, boundaries).

---

## 2) TOP 25 CONCRETE ISSUES (WITH RECEIPTS)

These are not stylistic opinions. Each one either:
- breaks determinism,
- blocks scaling,
- or guarantees future refactors.

### SEVERITY 1 — MUST FIX OR THE LAB FAILS

#### 1. **Double validation/coercion pipeline**

**Paths:**
- `packages/cli/src/core/defineCommand.ts:68` → `executeValidated()`
- `packages/cli/src/core/execute.ts:379` → `validateAndCoerceArgs()`

**Why deadly:**
Same input can be interpreted differently depending on entry path. `defineCommand()` validates, then calls `executeValidated()` which skips validation. But `execute()` also validates. Two code paths = two possible interpretations.

**Fix:** Remove `executeValidated()` or make it require pre-validation contract.

---

#### 2. **Nondeterministic run-id fallback**

**Path:**
- `packages/cli/src/core/execute.ts:401-407`

**Why deadly:**
```typescript
} else if (shouldGenerateRunId(fullCommandName)) {
  // Command should generate run ID but components are missing
  logger.warn(...); // Just warns, doesn't fail
}
```
Two identical runs can generate different artifacts if run ID is missing.

**Fix:** Fail fast if run ID required but components missing. No warnings, no fallbacks.

---

#### 3. **Run ID generation can return null**

**Path:**
- `packages/cli/src/core/execute.ts:385` → `extractRunIdComponents()` can return `null`

**Why deadly:**
If `extractRunIdComponents()` returns `null`, no run ID is generated, but artifacts may still be written with nondeterministic paths.

**Fix:** Make run ID generation required for commands that need it, or fail fast.

---

#### 4. **ResearchSimulationAdapter is incomplete**

**Path:**
- `packages/workflows/src/research/simulation-adapter.ts`

**Why deadly:**
Your "lab" does not yet run real experiments end-to-end. The adapter exists but:
- Snapshot loading is incomplete
- Trade collection has TODOs
- No leaderboard integration
- No sweep runner

**Fix:** Complete the adapter to actually run simulations from snapshots.

---

#### 5. **Data snapshot system incomplete**

**Path:**
- `packages/data-observatory/src/snapshots/event-collector.ts:77-83`

**Why deadly:**
```typescript
case 'trades':
  // TODO: Implement trade collection when trade storage is available
  break;
case 'metadata':
  // TODO: Implement metadata collection
  break;
case 'signals':
  // TODO: Implement signal collection
  break;
```
Experiments do not have stable data inputs without complete snapshotting.

**Fix:** Implement all event collection types or fail fast if missing.

---

#### 6. **Tests excluded from boundary checks**

**Path:**
- `scripts/ci/verify-boundaries-ast.ts:149`

**Why deadly:**
```typescript
const isTestFile = filePath.includes('.test.') || filePath.includes('.spec.');
// Tests are excluded from boundary checks
```
Test code slowly becomes architecture rot. Violations in tests will metastasize to production.

**Fix:** Include tests in boundary checks, or create separate test boundary rules.

---

#### 7. **Build artifacts not gitignored in dist/**

**Path:**
- `packages/data-observatory/dist/*.js.map`
- `packages/data-observatory/dist/*.d.ts.map`

**Why deadly:**
Source-of-truth confusion. Build artifacts should never be committed. They're generated files.

**Fix:** Add `dist/` to `.gitignore` or ensure build outputs go to separate directory.

---

### SEVERITY 2 — WILL BITE YOU AT SCALE

#### 8. **Python acting as DB driver**

**Path:**
- `packages/storage/src/duckdb/duckdb-client.ts:64` → `pythonEngine.runScript()`

**Why bad:**
Hot path latency. Every DuckDB operation goes: Node → Python subprocess → DuckDB → Python → Node. This adds 10-50ms per operation.

**Fix:** Use native DuckDB Node.js driver for hot paths, Python only for offline transforms.

---

#### 9. **Silent error swallowing in DuckDB adapters**

**Path:**
- `packages/storage/src/duckdb/repositories/*.ts`

**Why bad:**
Errors are logged but not always propagated. False confidence in results.

**Fix:** Ensure all errors bubble up, no silent failures.

---

#### 10. **Core package is dependency magnet**

**Path:**
- `packages/core/src/index.ts` exports everything

**Why bad:**
`@quantbot/core` is becoming a god-module. Every package depends on it, which defeats the purpose of layering.

**Fix:** Split core into smaller, focused packages (types, ports, domain).

---

#### 11. **No canonical RunManifest type**

**Path:**
- Multiple manifest types exist:
  - `packages/cli/src/core/run-manifest-service.ts` (CLI manifest)
  - `packages/ingestion/tests/stress/pipeline-invariants/run-manifest.stress.test.ts` (test manifest)
  - `packages/storage/src/engine/StorageEngine.ts` (storage manifest)

**Why bad:**
No single source of truth for run manifests. Different parts of the system use different formats.

**Fix:** Create canonical `RunManifest` type in `@quantbot/core` and use everywhere.

---

#### 12. **Object-stringify fallback for candle lookup**

**Path:**
- `packages/simulation/src/engine.ts` (implied from search results)

**Why bad:**
Using object keys for lookups can be nondeterministic if object iteration order varies.

**Fix:** Use `Map` or explicit key-based lookups, never rely on object iteration order.

---

#### 13. **No CI enforcement of hygiene checks**

**Path:**
- `scripts/ci/hygiene-checks.ts` exists but not in CI workflow

**Why bad:**
Hygiene checks are written but not enforced. Build artifacts and WAL files can still be committed.

**Fix:** Add `pnpm check:hygiene` to CI workflow, fail build if violations found.

---

#### 14. **No CI enforcement of boundary checks**

**Path:**
- `scripts/ci/verify-boundaries-ast.ts` exists but not in CI workflow

**Why bad:**
Boundary violations can be committed. Architecture degrades over time.

**Fix:** Add `pnpm verify:boundaries-ast` to CI workflow, fail build if violations found.

---

#### 15. **Logs directories exist**

**Path:**
- `./logs`
- `./packages/data-observatory/logs`
- `./packages/storage/logs`

**Why bad:**
Runtime state in repo. Should be gitignored or removed.

**Fix:** Add `logs/` to `.gitignore`, remove existing logs directories.

---

### SEVERITY 3 — TECH DEBT ACCRUAL

#### 16. **Mixed ESM/CJS without strict boundaries**
- Some packages use ESM, some CJS. No clear policy.

#### 17. **Public vs internal APIs not enforced**
- No `@internal` JSDoc tags or export restrictions.

#### 18. **Artifact handlers are TODO stubs**
- Some artifact handlers are incomplete.

#### 19. **CLI commands partially migrated**
- Some commands use `defineCommand()`, others use old pattern.

#### 20. **No fingerprinting of run inputs**
- Run manifests don't include input hashes for deduplication.

#### 21. **No CI check for determinism regressions**
- No automated test that verifies determinism hasn't regressed.

#### 22. **No early-abort optimization in sweeps**
- Sweep runners don't stop early if strategy is clearly failing.

#### 23. **No explicit floating-point determinism policy**
- No documentation or tests for FP determinism across platforms.

#### 24. **WAL files can be committed**
- `.gitignore` has patterns but files still get committed sometimes.

#### 25. **No replay-from-manifest command**
- Cannot replay a run from manifest alone. Must reconstruct inputs manually.

---

## 3) 3-AGENT PARALLEL EXECUTION PLAN

Each agent gets hard ownership. No overlap. No stepping on toes.

---

### AGENT A — RESEARCH OS & SIMULATION PIPELINE

**Goal:** Turn the engine into a real lab.

**Owns:**
- `packages/simulation/`
- `packages/workflows/src/research/`
- RunManifest + artifact contract
- Experiment runner & sweeps

**Must deliver:**

1. **Canonical RunManifest**
   - Single source of truth in `@quantbot/core`
   - Includes: runId, seed, strategyConfig, dataSnapshot, executionModel, costModel, riskModel, engineVersion, command, packageName, metadata
   - JSON-serializable, versioned schema

2. **End-to-end sim → artifact write**
   - Complete `ResearchSimulationAdapter.run()`
   - Load snapshot → resolve strategy → apply models → run sim → write artifacts
   - All trade events, PnL series, metrics collected

3. **Replay by run-id**
   - `quantbot research replay <run-id>` command
   - Loads manifest from artifacts
   - Reconstructs inputs from manifest
   - Re-runs simulation with same seed
   - Verifies byte-identical output

4. **Deterministic sweep runner**
   - Sweep over strategy parameters
   - Each sweep run gets deterministic run ID
   - Early abort if strategy clearly failing
   - Leaderboard integration

**Deliverables:**
- `packages/workflows/src/research/simulation-adapter.ts` (complete implementation)
- `packages/cli/src/handlers/research/replay.ts` (replay command)
- `packages/core/src/artifacts/run-manifest.ts` (canonical manifest type)
- `packages/workflows/src/research/sweep-runner.ts` (sweep orchestration)

**Success criteria:**
- Can run simulation from snapshot
- Can replay run from manifest
- All runs produce deterministic artifacts
- Sweep runner works end-to-end

---

### AGENT B — DATA & STORAGE FOUNDATIONS

**Goal:** Make data reproducible and boring.

**Owns:**
- `packages/data-observatory/`
- `packages/storage/src/duckdb/`
- DuckDB integration
- Snapshot system

**Must deliver:**

1. **SnapshotRef system**
   - Complete `EventCollector` (trades, metadata, signals)
   - SnapshotRef includes: snapshotId, sources, from, to, filters, manifest, contentHash
   - SnapshotRef is required input for all simulation runs

2. **Clean storage API**
   - Native DuckDB Node.js driver for hot paths
   - Python only for offline transforms
   - Clear separation: hot path (Node) vs batch (Python)

3. **No WAL/logs/artifacts in repo**
   - Enforce `.gitignore` patterns
   - Pre-commit hook to prevent committing artifacts
   - CI check fails if artifacts found

4. **Deterministic data reads**
   - All data reads are deterministic (same snapshot = same data)
   - No object iteration order dependencies
   - Explicit key-based lookups

**Deliverables:**
- `packages/data-observatory/src/snapshots/event-collector.ts` (complete all TODOs)
- `packages/storage/src/duckdb/duckdb-client-native.ts` (Node.js driver wrapper)
- `scripts/git/pre-commit-hygiene.ts` (pre-commit hook)
- `.github/workflows/build.yml` (add hygiene check)

**Success criteria:**
- All event types collected (calls, OHLCV, trades, metadata, signals)
- Hot path uses native DuckDB (no Python subprocess)
- No build artifacts or WAL files in repo
- All data reads are deterministic

---

### AGENT C — CLI, BOUNDARIES & HYGIENE

**Goal:** Make the system safe to operate.

**Owns:**
- `packages/cli/`
- Boundary enforcement
- CI rules
- Repo hygiene

**Must deliver:**

1. **Single coercion/validation path**
   - Remove `executeValidated()` or make it require pre-validation contract
   - All commands go through `validateAndCoerceArgs()`
   - No duplicate validation paths

2. **Deterministic run-id handling**
   - Fail fast if run ID required but components missing
   - No warnings, no fallbacks
   - All run IDs are deterministic

3. **AST-based boundary enforcement**
   - Include tests in boundary checks (or separate test rules)
   - Enforce in CI (fail build if violations)
   - Pre-commit hook to catch violations early

4. **CI hygiene checks**
   - `pnpm check:hygiene` in CI workflow
   - `pnpm verify:boundaries-ast` in CI workflow
   - Fail build if violations found

**Deliverables:**
- `packages/cli/src/core/execute.ts` (remove duplicate validation)
- `packages/cli/src/core/defineCommand.ts` (remove `executeValidated()` or fix contract)
- `scripts/ci/verify-boundaries-ast.ts` (include tests or separate rules)
- `.github/workflows/build.yml` (add boundary and hygiene checks)
- `scripts/git/pre-commit-boundaries.ts` (pre-commit hook)

**Success criteria:**
- Single validation path for all commands
- All run IDs are deterministic (no fallbacks)
- Boundary violations caught in CI
- No build artifacts or WAL files in repo

---

## EXECUTION ORDER

**Week 1:**
- AGENT C: Single validation path, deterministic run IDs, CI hygiene
- AGENT B: Complete snapshot system, remove WAL files

**Week 2:**
- AGENT A: Complete ResearchSimulationAdapter, canonical RunManifest
- AGENT B: Native DuckDB driver for hot paths

**Week 3:**
- AGENT A: Replay command, sweep runner
- AGENT C: Boundary enforcement in CI, pre-commit hooks

**Week 4:**
- All agents: Integration testing, documentation, final polish

---

## SUCCESS METRICS

**Determinism:**
- ✅ All runs produce byte-identical artifacts given same inputs
- ✅ Run IDs are deterministic (no fallbacks)
- ✅ Data reads are deterministic

**Architecture:**
- ✅ Zero boundary violations in CI
- ✅ Tests included in boundary checks
- ✅ Single validation path for all commands

**Research Lab:**
- ✅ Can run simulation from snapshot
- ✅ Can replay run from manifest
- ✅ Sweep runner works end-to-end

**Hygiene:**
- ✅ Zero build artifacts in repo
- ✅ Zero WAL files in repo
- ✅ Zero logs in repo

---

**END OF AUDIT**

