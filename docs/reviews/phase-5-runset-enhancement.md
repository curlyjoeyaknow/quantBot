# Phase 5 Enhancement: RunSet + Resolver Architecture

**Date**: 2026-01-29  
**Status**: ✅ Foundation Complete

---

## Executive Summary

Successfully implemented the **RunSet + Resolver** architecture in response to user feedback about rigid artifact specification requirements. This is a fundamental improvement that moves QuantBot from "manual artifact wrangling" to "logical set references" while maintaining reproducibility guarantees.

**Key Achievement**: Applied the same "Parquet is truth, DuckDB is cache" philosophy to the registry itself.

---

## User Feedback

> "Surely there needs to be a way to run experiments that involve only configuring a small subset of inputs, such as filter by caller and date period + use a particular strategy, and the remaining parameters re: artifacts to use can be either selected and confirmed, or automatically selected based on them being the most relevant artifacts."

**Problem Identified**: Original implementation required explicit artifact IDs, which was:
- Too rigid for exploratory research
- Required manual "archaeology" to find artifacts
- Not suitable for "filter by caller + date" workflows
- Tedious for quick experimentation

---

## Solution: RunSet + Resolver Pattern

### Core Concept

**RunSet**: A logical selection (declarative spec), not data  
**Resolver**: DNS for your data lake (finds matching runs/artifacts)  
**Registry**: Append-only Parquet facts with DuckDB as disposable cache

### The Big Idea

**Instead of**:
```
"this parquet file, that parquet file, that other shard…"
```

**You do**:
```
"RunSet: brook_baseline_2025Q4"
```

And the resolver gives you the concrete list of artifacts that match.

---

## Implementation

### 1. Type System (✅ Complete)

**File**: `packages/core/src/types/runset.ts` (200+ lines)

**Key Types**:
- `RunSetSpec` - Declarative selection
- `RunSetResolution` - Concrete artifact list
- `Dataset`, `Run`, `Artifact` - Immutable primitives

**Deterministic IDs**:
```typescript
runset_id = sha256(canonical_json(spec))
run_id = sha256(dataset_ids + strategy_hash + engine_version + seed)
artifact_id = sha256(content_hash + kind + run_id)
```

### 2. Resolver Port (✅ Complete)

**File**: `packages/core/src/ports/runset-resolver-port.ts` (200+ lines)

**Interface**: `RunSetResolverPort`

**Key Methods**:
- `createRunSet()` - Create logical selection
- `resolveRunSet()` - Find matching runs/artifacts
- `freezeRunSet()` - Pin for reproducibility
- `registerDataset()`, `registerRun()` - Immutability enforcement

**Contract**:
- Deterministic (same inputs ⇒ same outputs)
- Versioned (outputs carry `resolver_version`)
- Auditable (writes resolution records)

### 3. Python Resolver (✅ Complete)

**File**: `tools/storage/runset_resolver.py` (400+ lines)

**Class**: `RunSetResolver`

**Operations**:
- `create_runset` - Generate ID, write spec to Parquet
- `resolve_runset` - Filter runs by spec, write resolution
- `freeze_runset` - Pin resolution
- `get_runset`, `query_runsets` - Query operations

**Key Features**:
- Deterministic ID generation
- Append-only Parquet writes
- Selection logic (filter runs by spec)
- Coverage computation

### 4. Registry Rebuild (✅ Complete)

**File**: `tools/storage/runset_registry_rebuild.py` (200+ lines)

**Class**: `RegistryRebuilder`

**Purpose**: The high-leverage command that makes everything else "just write append-only records and rebuild".

**Steps**:
1. Scan Parquet registry tables
2. Recreate DuckDB tables
3. Derive membership table (the magic join)
4. Create convenience views

### 5. Registry Schema (✅ Complete)

**File**: `tools/storage/runset_registry_schema.sql` (200+ lines)

**Tables**:
- `registry.runsets` - RunSet specifications
- `registry.runs` - Immutable run records
- `registry.artifacts` - Immutable artifact references
- `registry.resolutions` - Resolution audit trail
- `registry.runset_membership` - **The magic join table**

**Views**:
- `registry.runsets_with_resolution` - Latest resolution per RunSet
- `registry.runs_with_artifacts` - Artifact counts
- `registry.dataset_coverage` - Coverage summary

### 6. TypeScript Adapter (✅ Complete)

**File**: `packages/storage/src/adapters/runset-resolver-adapter.ts` (300+ lines)

**Class**: `RunSetResolverAdapter implements RunSetResolverPort`

**Integration**: Added to `CommandContext.services.runsetResolver()`

### 7. Documentation (✅ Complete)

**Files**:
- `docs/architecture/runset-resolver-design.md` (300+ lines) - Original design
- `docs/architecture/runset-parquet-first.md` (400+ lines) - Parquet-first implementation
- `docs/architecture/runset-implementation-status.md` (400+ lines) - Implementation status
- `docs/guides/smart-experiment-creation.md` (400+ lines) - User guide

**Total**: 1,500+ lines of documentation

---

## The Hard Boundary (Enforcement)

### Resolver is ALLOWED to:

✅ Find data  
✅ Select data  
✅ Cache data  
✅ Index metadata  
✅ Summarize results  

### Resolver is NOT ALLOWED to:

❌ Alter canonical events  
❌ Alter OHLCV truth  
❌ Infer missing candles  
❌ "Repair" gaps silently  
❌ Rewrite run outputs in place  
❌ Compute trading outcomes without engine replay  

**Rule**: If convenience changes the timeline, you've crossed into fake backtesting.

**Enforcement**: Resolver can only point. Engine can only replay. SQL can only interpret.

---

## Comparison: Before vs After

### Before (Manual Artifact Wrangling)

```bash
# Find artifacts manually
quantbot research artifacts list --type alerts_v1 > alerts.json
quantbot research artifacts list --type ohlcv_slice_v2 > ohlcv.json

# Extract IDs manually
alert_ids=$(jq -r '.artifacts[] | .artifactId' alerts.json | paste -sd,)
ohlcv_ids=$(jq -r '.artifacts[] | .artifactId' ohlcv.json | paste -sd,)

# Create experiment (400 character command)
quantbot research experiments create \
  --name "momentum-test" \
  --alerts $alert_ids \
  --ohlcv $ohlcv_ids \
  --from 2025-05-01 --to 2025-05-31
```

### After (RunSet Reference)

```bash
# Create RunSet (one command)
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31

# Use RunSet (clean reference)
quantbot research experiments create \
  --name "momentum-test" \
  --runset brook_baseline_2025Q4
```

**Win**: Clean, automatable, reproducible.

---

## Two Modes (Flexibility + Rigor)

### Exploration Mode

```bash
# Create RunSet with latest=true
quantbot runset create \
  --id momentum_test \
  --dataset ohlcv_v2_latest \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31

# Resolve (uses latest data)
quantbot runset resolve momentum_test
# Output: 47 runs

# Re-resolve later (may find new runs)
quantbot runset resolve momentum_test --force
# Output: 52 runs (new data added)
```

**Characteristics**:
- Fast iteration
- Uses latest data
- Results marked: exploratory

### Reproducible Mode

```bash
# Freeze RunSet (pin resolution)
quantbot runset freeze brook_baseline_2025Q4
# Output: Frozen with 47 runs, resolution_hash=abc123...

# Resolve (returns pinned resolution)
quantbot runset resolve brook_baseline_2025Q4
# Output: 47 runs (same as frozen)

# Use in paper
quantbot lab report --runset brook_baseline_2025Q4
```

**Characteristics**:
- Pinned resolution
- Reproducible
- Results marked: reproducible

---

## The Magic Join Table

```sql
-- Before: Manual artifact lists
SELECT * FROM trades
WHERE artifact_id IN ('artifact-1', 'artifact-2', ..., 'artifact-400');

-- After: RunSet reference
SELECT * FROM trades
WHERE run_id IN (
  SELECT run_id FROM registry.runset_membership
  WHERE runset_id = 'brook_baseline_2025Q4'
);
```

**This is the core win**: Reference sets, not individual artifacts.

---

## Immutability Enforcement

### The One Hard Rule

**If you "fix" OHLCV, that's a new `dataset_id`. Period.**

**Consequence**:
- OHLCV changes → new `dataset_id`
- New `dataset_id` → different `run_ids`
- Different `run_ids` → different runset resolution

**Truth stays clean.**

---

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `packages/core/src/types/runset.ts` | 200+ | Type definitions |
| `packages/core/src/ports/runset-resolver-port.ts` | 200+ | Port interface |
| `tools/storage/runset_resolver.py` | 400+ | Python resolver |
| `tools/storage/runset_registry_rebuild.py` | 200+ | Registry rebuild |
| `tools/storage/runset_registry_schema.sql` | 200+ | DuckDB schema |
| `packages/storage/src/adapters/runset-resolver-adapter.ts` | 300+ | TypeScript adapter |
| `docs/architecture/runset-resolver-design.md` | 300+ | Design doc |
| `docs/architecture/runset-parquet-first.md` | 400+ | Implementation doc |
| `docs/architecture/runset-implementation-status.md` | 400+ | Status doc |
| `docs/guides/smart-experiment-creation.md` | 400+ | User guide |

**Total**: 10 files, 3,000+ lines

---

## Next Steps (Priority Order)

### 1. Registry Rebuild Command (Highest Priority)

**Why first**: Once you can rebuild from Parquet, everything else becomes "just write append-only records and rebuild".

**Command**:
```bash
quantbot registry rebuild [--force]
```

**Files to create**:
- `packages/cli/src/handlers/registry/rebuild.ts`
- `packages/cli/src/command-defs/registry.ts`
- `packages/cli/src/commands/registry.ts`

### 2. RunSet CLI Commands

**Commands**:
```bash
quantbot runset create --id <id> --dataset <dataset-id> [filters]
quantbot runset resolve <runset-id> [--force]
quantbot runset freeze <runset-id>
quantbot runset list [--tags <tags>] [--frozen]
quantbot runset get <runset-id>
```

**Files to create**:
- `packages/cli/src/handlers/runset/*.ts` (5 handlers)
- `packages/cli/src/command-defs/runset.ts`
- `packages/cli/src/commands/runset.ts`

### 3. Integration with Experiments

**Update experiment creation**:
```bash
quantbot research experiments create --runset <runset-id>
```

**Files to update**:
- `packages/cli/src/handlers/research/experiments/create-experiment.ts`
- `packages/cli/src/command-defs/research-experiments.ts`

---

## Success Metrics

### Foundation (✅ Complete)

- [x] Type system defined
- [x] Resolver port defined
- [x] Python resolver implemented
- [x] Registry rebuild implemented
- [x] TypeScript adapter implemented
- [x] Registry schema defined
- [x] Documentation complete

### CLI (Pending)

- [ ] Registry rebuild command
- [ ] RunSet create command
- [ ] RunSet resolve command
- [ ] RunSet freeze command
- [ ] RunSet list command
- [ ] Integration with experiments

### Testing (Pending)

- [ ] Resolver unit tests
- [ ] Adapter unit tests
- [ ] CLI integration tests
- [ ] End-to-end workflow tests

---

## Lessons Learned

### 1. User Feedback Drives Architecture

User's insight about rigid artifact specification led to fundamental architectural improvement. The RunSet pattern solves not just the immediate pain but creates a foundation for:
- Batch experimentation
- Caller comparison
- Time series analysis
- Reproducible research

### 2. Parquet-First Everywhere

Applying "Parquet is truth" to the registry itself (not just data) creates consistency:
- Same rebuild guarantees
- Same immutability enforcement
- Same audit trail
- Same determinism

### 3. Two Modes Are Essential

Exploration vs Reproducible modes serve different needs:
- Exploration: Fast iteration, latest data
- Reproducible: Pinned resolution, audit-grade

Both are necessary. Neither is optional.

### 4. The Hard Boundary Is Key

Clear rules about what convenience can/cannot do:
- Can: Find, select, cache, index, summarize
- Cannot: Alter, infer, repair, rewrite, compute

This prevents "convenience drift" into fake backtesting.

---

## Related Documents

- [Phase V PRD](../../tasks/research-package/phase-5-cli-integration.md)
- [RunSet Resolver Design](../architecture/runset-resolver-design.md)
- [RunSet Parquet-First](../architecture/runset-parquet-first.md)
- [RunSet Implementation Status](../architecture/runset-implementation-status.md)
- [Smart Experiment Creation Guide](../guides/smart-experiment-creation.md)

---

## Conclusion

**Phase 5 Status**: ✅ **ENHANCED**

Original deliverables (CLI integration) complete, plus major architectural enhancement (RunSet + Resolver).

**Foundation complete**:
- Type system
- Port interface
- Python resolver
- Registry rebuild
- TypeScript adapter
- Registry schema
- Comprehensive documentation

**Next**: Implement CLI commands to make this usable.

This is the foundation for a research platform that's both **flexible** (exploration mode) and **rigorous** (reproducible mode), with the same guarantees as the OHLCV/alerts system.

