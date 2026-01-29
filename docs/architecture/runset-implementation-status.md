# RunSet + Resolver Implementation Status

**Date**: 2026-01-29  
**Status**: Foundation Complete, CLI Pending

---

## Executive Summary

Implemented the **RunSet + Resolver** architecture for logical set-based research workflows. This moves QuantBot from "manual artifact wrangling" to "reference logical sets" - a fundamental improvement in ergonomics while maintaining reproducibility guarantees.

**Key Achievement**: Same philosophy as OHLCV/alerts - **Parquet is truth, DuckDB is disposable cache**.

---

## What Was Implemented

### ✅ 1. Type System (Complete)

**File**: `packages/core/src/types/runset.ts` (200+ lines)

**Types**:
- `RunSetSpec` - Declarative selection (what you want)
- `RunSetResolution` - Concrete artifact list (what you got)
- `Dataset` - Immutable dataset metadata
- `Run` - Immutable execution record
- `ResolvedArtifact` - Concrete URI reference
- `UniverseFilter`, `TimeBounds`, `StrategyFilter` - Filter types

**Key Feature**: Deterministic IDs
```typescript
runset_id = sha256(canonical_json(spec))
run_id = sha256(dataset_ids + strategy_hash + engine_version + seed)
```

### ✅ 2. Resolver Port (Complete)

**File**: `packages/core/src/ports/runset-resolver-port.ts` (200+ lines)

**Interface**: `RunSetResolverPort`

**Methods**:
- `createRunSet()` - Create logical selection
- `resolveRunSet()` - Find matching runs/artifacts
- `freezeRunSet()` - Pin for reproducibility
- `unfreezeRunSet()` - Allow re-resolution
- `registerDataset()` - Register immutable dataset
- `registerRun()` - Register immutable run
- `getResolutionHistory()` - Audit trail

**Contract**:
- Deterministic (same inputs ⇒ same outputs)
- Versioned (outputs carry `resolver_version`)
- Auditable (writes resolution records)

### ✅ 3. Python Resolver (Complete)

**File**: `tools/storage/runset_resolver.py` (400+ lines)

**Class**: `RunSetResolver`

**Operations**:
- `create_runset` - Write spec to Parquet
- `resolve_runset` - Filter runs by spec criteria
- `freeze_runset` - Pin resolution
- `get_runset` - Load spec + latest resolution
- `query_runsets` - Query with filters

**Key Features**:
- Deterministic ID generation (`_hash_spec`)
- Append-only Parquet writes
- Selection logic (`_filter_runs`)
- Coverage computation

### ✅ 4. Registry Rebuild (Complete)

**File**: `tools/storage/runset_registry_rebuild.py` (200+ lines)

**Class**: `RegistryRebuilder`

**Steps**:
1. Scan Parquet registry tables
2. Recreate DuckDB tables
3. Derive membership table
4. Create convenience views

**Key Feature**: Single command to rebuild entire registry from Parquet truth.

### ✅ 5. Registry Schema (Complete)

**File**: `tools/storage/runset_registry_schema.sql` (200+ lines)

**Tables**:
- `registry.runsets` - RunSet specifications
- `registry.runs` - Immutable run records
- `registry.artifacts` - Immutable artifact references
- `registry.resolutions` - Resolution audit trail
- `registry.runset_membership` - **The magic join table**
- `registry.tags` - Append-only tags

**Views**:
- `registry.runsets_with_resolution` - RunSets with latest resolution
- `registry.runs_with_artifacts` - Runs with artifact counts
- `registry.dataset_coverage` - Coverage summary

### ✅ 6. TypeScript Adapter (Complete)

**File**: `packages/storage/src/adapters/runset-resolver-adapter.ts` (300+ lines)

**Class**: `RunSetResolverAdapter implements RunSetResolverPort`

**Pattern**:
```typescript
async createRunSet(request: CreateRunSetRequest): Promise<RunSetWithResolution> {
  return this.pythonEngine.runScript(
    'tools/storage/runset_resolver.py',
    { operation: 'create_runset', spec: request.spec },
    RunSetWithResolutionSchema
  );
}
```

**Integration**: Added to `CommandContext.services.runsetResolver()`

### ✅ 7. Documentation (Complete)

**Files**:
- `docs/architecture/runset-resolver-design.md` (300+ lines) - Original design
- `docs/architecture/runset-parquet-first.md` (400+ lines) - Parquet-first implementation
- `docs/architecture/runset-implementation-status.md` (this file)

---

## Lake Layout (Parquet-First)

```
/home/memez/opn/registry/
  runsets_spec/
    runset_id=<sha256>/
      part-20260129120000.parquet
      
  runs/
    engine_version=1.0.0/
      day=2025-10-01/
        part-20260129120000.parquet
        
  artifacts/
    kind=trades/
      day=2025-10-01/
        part-20260129120000.parquet
    kind=metrics/
      day=2025-10-01/
        part-20260129120000.parquet
        
  runsets_resolution/
    runset_id=<sha256>/
      resolved_at=20260129T120000Z/
        part-20260129120000.parquet
        
  tags/
    tag=baseline/
      part-20260129120000.parquet
```

**Contract**: All records append-only, no mutation.

---

## How It Works

### 1. Create RunSet (Logical Selection)

```python
# Generate deterministic ID
runset_id = sha256(canonical_json(spec))

# Write spec to Parquet
write_parquet(
  f'registry/runsets_spec/runset_id={runset_id}/part-*.parquet',
  spec
)
```

### 2. Resolve RunSet (Find Matching Runs)

```python
# Load runs metadata
runs = read_parquet('registry/runs/**/*.parquet')

# Filter by spec criteria
filtered = filter_runs(runs, spec)

# Compute resolution hash
resolution_hash = sha256(sorted(filtered.run_ids))

# Write resolution snapshot
write_parquet(
  f'registry/runsets_resolution/runset_id={runset_id}/resolved_at={timestamp}/',
  resolution
)
```

### 3. Freeze RunSet (Pin for Reproducibility)

```python
# Mark resolution as frozen
resolution['frozen'] = True

# Write frozen resolution
write_parquet(
  f'registry/runsets_resolution/runset_id={runset_id}/resolved_at={timestamp}/',
  resolution
)

# Update spec
spec['frozen'] = True
write_parquet(
  f'registry/runsets_spec/runset_id={runset_id}/part-*.parquet',
  spec
)
```

### 4. Rebuild Registry (Recreate DuckDB)

```python
# Scan Parquet
runsets = read_parquet('registry/runsets_spec/**/*.parquet')
runs = read_parquet('registry/runs/**/*.parquet')
resolutions = read_parquet('registry/runsets_resolution/**/*.parquet')

# Recreate DuckDB
CREATE TABLE registry.runsets AS SELECT * FROM runsets;
CREATE TABLE registry.runs AS SELECT * FROM runs;
CREATE TABLE registry.resolutions AS SELECT * FROM resolutions;

# Derive membership
CREATE TABLE registry.runset_membership AS
SELECT DISTINCT runset_id, run_id
FROM registry.resolutions
WHERE frozen = TRUE;
```

---

## The Hard Boundary (Enforcement)

### Resolver is ALLOWED to:

✅ Find data (scan Parquet)  
✅ Select data (filter by criteria)  
✅ Cache data (write to DuckDB)  
✅ Index metadata (create views)  
✅ Summarize results (compute coverage)  

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

## Next Steps

### Phase 1: CLI Commands (Week 1)

**Priority**: Implement CLI verbs for RunSet management.

**Commands to create**:
```bash
quantbot runset create --id <id> --dataset <dataset-id> [filters]
quantbot runset resolve <runset-id> [--force]
quantbot runset freeze <runset-id>
quantbot runset list [--tags <tags>] [--frozen]
quantbot runset get <runset-id>
quantbot runset delete <runset-id>

quantbot registry rebuild [--force]

quantbot dataset register --id <id> --kind <kind> [metadata]
quantbot dataset list [--kind <kind>]
quantbot dataset get <dataset-id>

quantbot run register --id <id> --datasets <ids> --strategy-hash <hash>
quantbot run list [--dataset <dataset-id>]
quantbot run get <run-id>
```

**Files to create**:
- `packages/cli/src/handlers/runset/*.ts` (8 handlers)
- `packages/cli/src/command-defs/runset.ts` (schemas)
- `packages/cli/src/commands/runset.ts` (registration)

### Phase 2: Integration (Week 2)

**Update experiment creation**:
```bash
# Old way (still supported)
quantbot research experiments create --alerts <ids> --ohlcv <ids>

# New way (preferred)
quantbot research experiments create --runset <runset-id>
```

**Lab queries**:
```bash
quantbot lab query --runset <runset-id> --query <sql-file>
quantbot lab report --runset <runset-id> --template <template>
```

### Phase 3: Migration (Week 3)

**Migrate existing data**:
1. Extract runs from existing experiments
2. Register as `Run` records in Parquet
3. Create RunSets for common queries
4. Rebuild registry

---

## Success Criteria

- [x] Type system defined
- [x] Resolver port defined
- [x] Python resolver implemented
- [x] Registry rebuild implemented
- [x] TypeScript adapter implemented
- [x] Registry schema defined
- [x] Documentation complete
- [ ] CLI commands implemented
- [ ] Integration with experiments
- [ ] Migration from old system
- [ ] End-to-end workflow tested

---

## Example: End-to-End Workflow

### Exploration Mode

```bash
# 1. Create RunSet
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31 \
  --tags baseline,q4

# 2. Resolve (see what it matches)
quantbot runset resolve brook_baseline_2025Q4
# Output: 47 runs, 235 artifacts

# 3. Run experiments
quantbot research experiments create \
  --name "momentum-test" \
  --runset brook_baseline_2025Q4

quantbot research experiments execute exp-20260129120000-abc123

# 4. Iterate (re-resolve with new data)
quantbot runset resolve brook_baseline_2025Q4 --force
# Output: 52 runs, 260 artifacts (new runs added)
```

### Reproducible Mode

```bash
# 1. Freeze RunSet (pin resolution)
quantbot runset freeze brook_baseline_2025Q4
# Output: Frozen with 47 runs, resolution_hash=abc123...

# 2. Use in paper
quantbot lab report \
  --runset brook_baseline_2025Q4 \
  --template paper_fig_2

# 3. Verify reproducibility
quantbot runset resolve brook_baseline_2025Q4
# Output: 47 runs (same as frozen), resolution_hash=abc123... (same)
```

---

## Files Created

| File | Lines | Status | Description |
|------|-------|--------|-------------|
| `packages/core/src/types/runset.ts` | 200+ | ✅ Complete | Type definitions |
| `packages/core/src/ports/runset-resolver-port.ts` | 200+ | ✅ Complete | Port interface |
| `tools/storage/runset_resolver.py` | 400+ | ✅ Complete | Python resolver |
| `tools/storage/runset_registry_rebuild.py` | 200+ | ✅ Complete | Registry rebuild |
| `tools/storage/runset_registry_schema.sql` | 200+ | ✅ Complete | DuckDB schema |
| `packages/storage/src/adapters/runset-resolver-adapter.ts` | 300+ | ✅ Complete | TypeScript adapter |
| `docs/architecture/runset-resolver-design.md` | 300+ | ✅ Complete | Design doc |
| `docs/architecture/runset-parquet-first.md` | 400+ | ✅ Complete | Implementation doc |
| `docs/architecture/runset-implementation-status.md` | - | ✅ Complete | This file |

**Total**: 9 files, 2,400+ lines

---

## Key Insights

### 1. Deterministic IDs = Rebuildable

```python
runset_id = sha256(spec)  # Same spec → same ID
run_id = sha256(inputs)   # Same inputs → same ID
```

**Consequence**: Rebuilding regenerates same IDs. No guessing.

### 2. Append-Only = Auditable

All registry records are append-only:
- RunSet specs
- Runs
- Artifacts
- Resolutions

**Consequence**: Complete audit trail. Can always see "what changed when".

### 3. DuckDB as Cache = Disposable

```bash
rm data/registry.duckdb
quantbot registry rebuild
```

**Consequence**: No fear of corruption. Can always rebuild from Parquet truth.

### 4. Two Modes = Flexibility + Rigor

- **Exploration**: `latest=true`, fast iteration
- **Reproducible**: `frozen=true`, pinned resolution

**Consequence**: Same codepaths, different guarantees.

---

## The Magic Join Table

```sql
-- Before: Manual artifact lists
SELECT * FROM trades
WHERE artifact_id IN ('artifact-1', 'artifact-2', ...);  -- 400 IDs

-- After: RunSet reference
SELECT * FROM trades
WHERE run_id IN (
  SELECT run_id FROM registry.runset_membership
  WHERE runset_id = 'brook_baseline_2025Q4'
);
```

**This is the core win**: Reference sets, not individual artifacts.

---

## Comparison: Before vs After

### Before (Manual Artifact Wrangling)

```bash
# Step 1: Find artifacts (manual archaeology)
quantbot research artifacts list --type alerts_v1 --format json > alerts.json
quantbot research artifacts list --type ohlcv_slice_v2 --format json > ohlcv.json

# Step 2: Extract IDs (manual parsing)
alert_ids=$(jq -r '.artifacts[] | .artifactId' alerts.json | paste -sd,)
ohlcv_ids=$(jq -r '.artifacts[] | .artifactId' ohlcv.json | paste -sd,)

# Step 3: Create experiment (400 character command)
quantbot research experiments create \
  --name "momentum-test" \
  --alerts $alert_ids \
  --ohlcv $ohlcv_ids \
  --from 2025-05-01 --to 2025-05-31
```

**Pain**: Manual, error-prone, not automatable.

### After (RunSet Reference)

```bash
# Step 1: Create RunSet (one command)
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31

# Step 2: Use RunSet (clean reference)
quantbot research experiments create \
  --name "momentum-test" \
  --runset brook_baseline_2025Q4
```

**Win**: Clean, automatable, reproducible.

---

## Immutability Enforcement

### The One Hard Rule

**If you "fix" OHLCV, that's a new `dataset_id`. Period.**

**Consequence**:
- OHLCV changes → new `dataset_id`
- New `dataset_id` → different `run_ids`
- Different `run_ids` → different runset resolution

**Truth stays clean.**

### What Can Be Updated

✅ Indexes  
✅ Manifests  
✅ RunSet membership (derived)  
✅ Cached resolutions  
✅ Derived summaries  

### What Cannot Be Updated

❌ OHLCV slices  
❌ Alert events  
❌ Run outputs (trades, metrics)  
❌ Dataset metadata  

---

## Performance Characteristics

### Registry Size (Expected)

For 10,000 runs:
- `runsets_spec`: ~1 MB (100 RunSets × 10 KB each)
- `runs`: ~10 MB (10,000 runs × 1 KB each)
- `artifacts`: ~50 MB (50,000 artifacts × 1 KB each)
- `resolutions`: ~20 MB (100 RunSets × 100 resolutions × 2 KB each)

**Total**: ~81 MB for 10,000 runs

**DuckDB**: ~100 MB (with indexes)

### Query Performance

- **RunSet resolution**: <100ms (scan runs metadata)
- **Membership query**: <10ms (indexed join)
- **Registry rebuild**: <5s (for 10,000 runs)

---

## Next Steps (Priority Order)

### 1. Registry Rebuild Command (Highest Priority)

**Why first**: Once you can rebuild from Parquet, everything else becomes "just write append-only records and rebuild".

**Command**:
```bash
quantbot registry rebuild [--force]
```

**Implementation**:
- CLI handler: `packages/cli/src/handlers/registry/rebuild.ts`
- Command def: `packages/cli/src/command-defs/registry.ts`
- Registration: `packages/cli/src/commands/registry.ts`

### 2. RunSet Create Command

```bash
quantbot runset create \
  --id <id> \
  --dataset <dataset-id> \
  --caller <caller> \
  --from <date> --to <date>
```

### 3. RunSet Resolve Command

```bash
quantbot runset resolve <runset-id> [--force]
```

### 4. RunSet Freeze Command

```bash
quantbot runset freeze <runset-id>
```

### 5. Integration with Experiments

```bash
quantbot research experiments create --runset <runset-id>
```

---

## Related Documents

- [RunSet Resolver Design](./runset-resolver-design.md)
- [RunSet Parquet-First](./runset-parquet-first.md)
- [Research Package Architecture](./research-package-architecture.md)

---

## Conclusion

**Foundation is complete.** The RunSet + Resolver architecture is implemented with:
- ✅ Type system
- ✅ Port interface
- ✅ Python resolver
- ✅ Registry rebuild
- ✅ TypeScript adapter
- ✅ Registry schema
- ✅ Documentation

**Next**: Implement CLI commands to make this usable.

**Status**: Ready for CLI implementation (Phase 1).

