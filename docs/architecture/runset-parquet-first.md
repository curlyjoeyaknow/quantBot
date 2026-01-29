# RunSet Registry: Parquet-First, DuckDB as Cache

**Version**: 1.0.0  
**Date**: 2026-01-29  
**Status**: Design Complete

---

## Core Principle

**Registry state is append-only facts in Parquet.**  
**DuckDB is a disposable cache/query engine.**

Same philosophy as OHLCV/alerts: Parquet is truth, DuckDB is rebuildable.

---

## Lake Layout (Parquet-First)

```
lake/
  registry/
    runsets_spec/              # Immutable specs (source of truth)
      runset_id=<sha256>/part-*.parquet
      
    runs/                      # Immutable runs (execution records)
      engine_version=<ver>/day=YYYY-MM-DD/part-*.parquet
      
    artifacts/                 # Immutable artifacts (run outputs)
      kind=trades/day=YYYY-MM-DD/part-*.parquet
      kind=equity_curve/day=YYYY-MM-DD/part-*.parquet
      kind=metrics/day=YYYY-MM-DD/part-*.parquet
      
    runsets_resolution/        # Frozen snapshots (audit trail)
      runset_id=<sha256>/resolved_at=YYYY-MM-DDTHHMMSSZ/part-*.parquet
      
    tags/                      # Append-only tags/labels
      tag=<name>/part-*.parquet
```

**Partitioning is for performance. Contract is: all records append-only, no mutation.**

---

## Deterministic IDs (Rebuilding Without Guessing)

### runset_id

```python
runset_id = sha256(canonical_json(spec_json))
```

**Consequence**:
- Same spec → same ID
- Tweak spec → new RunSet
- Rebuild → regenerate same ID
- Dedupe/idempotency trivial: "seen this runset_id?" → skip

### run_id

```python
run_id = sha256(
    dataset_ids + 
    strategy_spec_hash + 
    engine_version + 
    seed + 
    execution_assumptions_hash
)
```

**Consequence**:
- Input → deterministic identity
- Dedupe trivial: "seen this run_id?" → skip
- Rebuild → same run_ids for same inputs

### artifact_id

```python
artifact_id = sha256(content_hash + kind + run_id)
```

**Consequence**:
- Content-addressable
- Dedupe automatic
- Rebuild → same artifact_ids

---

## Minimal Schemas (Parquet Tables)

### 1) runsets_spec (Source of Truth)

**Columns**:
```
runset_id: string
spec_json: string  (canonical JSON)
created_at: timestamp
created_by: string (optional)
mode: enum('explore', 'repro')
notes: string (optional)
```

**That's it.** Everything else is derived.

### 2) runs (Execution Records)

**Columns**:
```
run_id: string
dataset_ids: json  (array of dataset_ids)
strategy_spec_hash: string
engine_version: string
seed: int64
execution_assumptions_hash: string
created_at: timestamp
status: enum('success', 'fail')
metrics_summary: json (optional, for quick filtering)
```

### 3) artifacts (Run Outputs)

**Columns**:
```
artifact_id: string
run_id: string
kind: enum('trades', 'curve', 'metrics', 'diagnostics')
uri: string  (path in lake)
content_hash: string (sha256)
created_at: timestamp
schema_version: string
row_count: int64 (optional)
```

### 4) runsets_resolution (Frozen Truth)

**Columns**:
```
runset_id: string
resolved_at: timestamp
resolver_version: string
resolution_hash: string  (sha256 of sorted run_id list)
run_id: string  (one row per member)
match_metadata: json (optional, for debugging)
```

**This is what lets you say**: "This paper figure used exactly these 352 runs."

---

## How Rebuilding Works (Clean and Deterministic)

### Rebuild Command

```bash
quantbot registry rebuild [--force]
```

**Steps**:

1. **Scan Parquet registry tables**:
   ```python
   runsets_spec = read_parquet('lake/registry/runsets_spec/**/*.parquet')
   runs = read_parquet('lake/registry/runs/**/*.parquet')
   artifacts = read_parquet('lake/registry/artifacts/**/*.parquet')
   resolutions = read_parquet('lake/registry/runsets_resolution/**/*.parquet')
   tags = read_parquet('lake/registry/tags/**/*.parquet')
   ```

2. **Recreate DuckDB tables**:
   ```sql
   CREATE TABLE registry.runsets AS SELECT * FROM runsets_spec;
   CREATE TABLE registry.runs AS SELECT * FROM runs;
   CREATE TABLE registry.artifacts AS SELECT * FROM artifacts;
   CREATE TABLE registry.resolutions AS SELECT * FROM resolutions;
   CREATE TABLE registry.tags AS SELECT * FROM tags;
   ```

3. **Derive convenience views**:
   ```sql
   -- Latest resolution per runset
   CREATE VIEW registry.runsets_with_resolution AS ...
   
   -- RunSet membership (the magic join table)
   CREATE TABLE registry.runset_membership AS
   SELECT runset_id, run_id FROM registry.resolutions
   WHERE (runset_id, resolved_at) IN (
     SELECT runset_id, MAX(resolved_at)
     FROM registry.resolutions
     GROUP BY runset_id
   );
   
   -- Runs with artifact counts
   CREATE VIEW registry.runs_with_artifacts AS ...
   ```

**DuckDB becomes a pure cache you can blow away and recreate anytime.**

---

## How RunSet Membership is Derived

### Case A: Frozen / Reproducible

Membership = the latest (or selected) snapshot from `runsets_resolution`.

```sql
-- Get runs for frozen RunSet
SELECT run_id
FROM registry.resolutions
WHERE runset_id = 'brook_baseline_2025Q4'
  AND frozen = TRUE
ORDER BY run_id;
```

**This is the "audit-grade" mode.**

### Case B: Exploratory / Dynamic

Membership is derived by executing the spec against runs metadata.

**Example spec** (conceptually):
```json
{
  "datasetId": "ohlcv_v2_2025Q4",
  "universe": {
    "callers": ["Brook", "TY"]
  },
  "strategy": {
    "strategyFamily": "MultiTrade_20pctTrail"
  },
  "timeBounds": {
    "from": "2025-10-01",
    "to": "2025-12-31"
  }
}
```

**Resolver evaluates** that spec against `runs` + `tags` and produces a fresh list.

**Optionally writes** a new resolution snapshot (so you can later freeze it).

**Important**: Even in exploration, you keep yourself honest by writing the resolution record. It's your "trail of breadcrumbs".

---

## The One Hard Rule (Keeps Convenience from Corrupting Truth)

### Resolver Does Not Invent Data

It only selects from what exists in `runs` (and their recorded inputs).

**Rebuilding is always**:
1. Deterministic ID generation
2. Append-only registry facts
3. Derived membership

**No "fixing" missing data.**  
**No silent gap patching.**

If OHLCV changes → new `dataset_id` → different `run_ids` → different runset resolution.

**Truth stays clean.**

---

## Practical Workflow (Daily Use)

### 1. Create RunSetSpec

```bash
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31
```

**Writes**: `lake/registry/runsets_spec/runset_id=<sha256>/part-*.parquet`

### 2. Run Optimizer/Engine

```bash
quantbot optimize \
  --dataset ohlcv_v2_2025Q4 \
  --strategy MultiTrade_20pctTrail \
  --param-grid config.yaml
```

**Writes**:
- `lake/registry/runs/engine_version=1.0.0/day=2025-10-01/part-*.parquet`
- `lake/registry/artifacts/kind=trades/day=2025-10-01/part-*.parquet`
- `lake/registry/artifacts/kind=metrics/day=2025-10-01/part-*.parquet`

### 3. Resolve RunSet (Explore)

```bash
quantbot runset resolve brook_baseline_2025Q4
```

**Reads**: `lake/registry/runs/**/*.parquet`  
**Filters**: By spec criteria  
**Writes**: `lake/registry/runsets_resolution/runset_id=<sha256>/resolved_at=<timestamp>/part-*.parquet`

**Output**:
```
RunSet: brook_baseline_2025Q4
Resolved: 47 runs, 235 artifacts
Mode: exploration
```

### 4. Freeze RunSet (Repro)

```bash
quantbot runset freeze brook_baseline_2025Q4
```

**Reads**: Latest resolution from `lake/registry/runsets_resolution/`  
**Marks**: `frozen=TRUE` in resolution record  
**Writes**: Updated resolution with `frozen=TRUE`

**Output**:
```
RunSet frozen: brook_baseline_2025Q4
Resolution hash: abc123def456...
Runs: 47
Artifacts: 235
```

### 5. Use in Reports

```bash
quantbot lab report \
  --runset brook_baseline_2025Q4 \
  --template performance_summary
```

**Reads**: `registry.runset_membership` (derived from frozen resolution)  
**Queries**: Joins to trades/metrics via `run_id`

---

## Registry Rebuild (The High-Leverage Command)

```bash
quantbot registry rebuild [--force]
```

**Steps**:

1. **Scan Parquet registry**:
   ```python
   runsets_spec = scan_parquet('lake/registry/runsets_spec/**/*.parquet')
   runs = scan_parquet('lake/registry/runs/**/*.parquet')
   artifacts = scan_parquet('lake/registry/artifacts/**/*.parquet')
   resolutions = scan_parquet('lake/registry/runsets_resolution/**/*.parquet')
   tags = scan_parquet('lake/registry/tags/**/*.parquet')
   ```

2. **Recreate DuckDB registry**:
   ```sql
   DROP SCHEMA IF EXISTS registry CASCADE;
   CREATE SCHEMA registry;
   
   CREATE TABLE registry.runsets AS SELECT * FROM runsets_spec;
   CREATE TABLE registry.runs AS SELECT * FROM runs;
   CREATE TABLE registry.artifacts AS SELECT * FROM artifacts;
   CREATE TABLE registry.resolutions AS SELECT * FROM resolutions;
   CREATE TABLE registry.tags AS SELECT * FROM tags;
   ```

3. **Derive membership table**:
   ```sql
   CREATE TABLE registry.runset_membership AS
   SELECT DISTINCT
       r.runset_id,
       r.run_id
   FROM registry.resolutions r
   WHERE (r.runset_id, r.resolved_at) IN (
       SELECT runset_id, MAX(resolved_at)
       FROM registry.resolutions
       WHERE frozen = TRUE
       GROUP BY runset_id
   );
   ```

4. **Create convenience views**:
   ```sql
   CREATE VIEW registry.runsets_with_resolution AS ...
   CREATE VIEW registry.runs_with_artifacts AS ...
   CREATE VIEW registry.dataset_coverage AS ...
   ```

**Result**: Fresh DuckDB registry, fully consistent with Parquet truth.

---

## Resolver Implementation (Python)

### Core Resolver Class

```python
class RunSetResolver:
    """
    Resolver: DNS for your data lake.
    
    Allowed to:
    - Find data
    - Select data
    - Cache data
    
    NOT allowed to:
    - Alter canonical events
    - Infer missing candles
    - Compute outcomes without engine replay
    """
    
    def __init__(self, registry_root: str):
        self.registry_root = registry_root
        self.resolver_version = "1.0.0"
    
    def create_runset(self, spec: RunSetSpec) -> RunSetWithResolution:
        """Create RunSet and optionally resolve."""
        # 1. Generate deterministic ID
        runset_id = self._hash_spec(spec)
        
        # 2. Write spec to Parquet
        self._write_spec(runset_id, spec)
        
        # 3. Optionally resolve
        if spec.get('auto_resolve'):
            resolution = self.resolve_runset(runset_id)
        else:
            resolution = None
        
        return {
            'spec': spec,
            'resolution': resolution,
            'mode': spec.get('mode', 'explore')
        }
    
    def resolve_runset(self, runset_id: str, force: bool = False) -> RunSetResolution:
        """Resolve RunSet to concrete run_ids and artifacts."""
        # 1. Load spec
        spec = self._load_spec(runset_id)
        
        # 2. Check if frozen
        if spec.get('frozen') and not force:
            return self._load_frozen_resolution(runset_id)
        
        # 3. Load runs metadata
        runs_df = self._load_runs()
        
        # 4. Filter by spec criteria
        filtered_runs = self._filter_runs(runs_df, spec)
        
        # 5. Load artifacts for matching runs
        artifacts = self._load_artifacts(filtered_runs['run_id'].tolist())
        
        # 6. Compute resolution hash
        run_ids_sorted = sorted(filtered_runs['run_id'].tolist())
        resolution_hash = hashlib.sha256(
            json.dumps(run_ids_sorted, sort_keys=True).encode()
        ).hexdigest()
        
        # 7. Create resolution record
        resolution = {
            'runset_id': runset_id,
            'resolver_version': self.resolver_version,
            'resolved_at': datetime.utcnow().isoformat(),
            'run_ids': run_ids_sorted,
            'artifacts': artifacts,
            'content_hash': resolution_hash,
            'metadata': {
                'run_count': len(run_ids_sorted),
                'artifact_count': len(artifacts),
            },
            'frozen': False
        }
        
        # 8. Write resolution snapshot (audit trail)
        self._write_resolution(runset_id, resolution)
        
        return resolution
    
    def freeze_runset(self, runset_id: str) -> RunSetResolution:
        """Freeze RunSet (pin resolution for reproducibility)."""
        # 1. Resolve (if not already resolved)
        resolution = self.resolve_runset(runset_id, force=False)
        
        # 2. Mark as frozen
        resolution['frozen'] = True
        
        # 3. Write frozen resolution
        self._write_resolution(runset_id, resolution, frozen=True)
        
        # 4. Update spec (mark as frozen)
        self._update_spec_frozen_status(runset_id, frozen=True)
        
        return resolution
    
    def _hash_spec(self, spec: dict) -> str:
        """Generate deterministic runset_id from spec."""
        # Canonical JSON (sorted keys, no whitespace)
        canonical = json.dumps(spec, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]
    
    def _filter_runs(self, runs_df: pd.DataFrame, spec: dict) -> pd.DataFrame:
        """Filter runs by spec criteria (the core selection logic)."""
        filtered = runs_df.copy()
        
        # Filter by dataset_id
        if 'dataset_id' in spec:
            filtered = filtered[
                filtered['dataset_ids'].apply(
                    lambda ids: spec['dataset_id'] in ids
                )
            ]
        
        # Filter by time bounds
        if 'time_bounds' in spec:
            from_ts = pd.Timestamp(spec['time_bounds']['from'])
            to_ts = pd.Timestamp(spec['time_bounds']['to'])
            filtered = filtered[
                (filtered['created_at'] >= from_ts) &
                (filtered['created_at'] <= to_ts)
            ]
        
        # Filter by strategy
        if 'strategy' in spec:
            if 'strategy_hash' in spec['strategy']:
                filtered = filtered[
                    filtered['strategy_spec_hash'] == spec['strategy']['strategy_hash']
                ]
            if 'engine_version' in spec['strategy']:
                filtered = filtered[
                    filtered['engine_version'] == spec['strategy']['engine_version']
                ]
        
        # Filter by universe (requires loading metadata)
        if 'universe' in spec:
            # This would require joining with run metadata
            # For now, defer to metadata filtering
            pass
        
        return filtered
```

---

## How Membership is Derived

### Case A: Frozen / Reproducible

```sql
-- Membership = pinned resolution
SELECT run_id
FROM registry.resolutions
WHERE runset_id = 'brook_baseline_2025Q4'
  AND frozen = TRUE
ORDER BY run_id;
```

### Case B: Exploratory / Dynamic

```python
# Membership = execute spec against runs
def derive_membership(runset_id: str) -> List[str]:
    spec = load_spec(runset_id)
    runs = load_runs()
    filtered = filter_runs(runs, spec)
    return sorted(filtered['run_id'].tolist())
```

**Even in exploration, write the resolution record** (trail of breadcrumbs).

---

## The One Hard Rule

### Resolver Does Not Invent Data

It only selects from what exists in `runs` (and their recorded inputs).

**Rebuilding is always**:
1. Deterministic ID generation
2. Append-only registry facts
3. Derived membership

**No "fixing" missing data.**  
**No silent gap patching.**

If OHLCV changes → new `dataset_id` → different `run_ids` → different runset resolution.

**Truth stays clean.**

---

## Implementation Plan

### Phase 1: Python Resolver (Week 1)

**Files to create**:
- `tools/storage/runset_resolver.py` - Core resolver implementation
- `tools/storage/runset_registry_ops.py` - Registry operations (read/write Parquet)
- `tools/storage/runset_rebuild.py` - Registry rebuild command

**Key functions**:
```python
def create_runset(spec: dict) -> dict
def resolve_runset(runset_id: str, force: bool = False) -> dict
def freeze_runset(runset_id: str) -> dict
def rebuild_registry(registry_root: str, duckdb_path: str) -> dict
```

### Phase 2: DuckDB Adapter (Week 1)

**Files to create**:
- `packages/storage/src/adapters/runset-resolver-adapter.ts` - TypeScript adapter
- `packages/storage/tests/unit/adapters/runset-resolver-adapter.test.ts` - Unit tests

**Pattern**:
```typescript
export class RunSetResolverAdapter implements RunSetResolverPort {
  constructor(
    private readonly registryRoot: string,
    private readonly duckdbPath: string,
    private readonly pythonEngine: PythonEngine
  ) {}
  
  async createRunSet(request: CreateRunSetRequest): Promise<RunSetWithResolution> {
    return this.pythonEngine.runScript(
      'tools/storage/runset_resolver.py',
      { operation: 'create_runset', spec: request.spec },
      RunSetWithResolutionSchema
    );
  }
  
  async resolveRunSet(runsetId: string, force?: boolean): Promise<RunSetResolution> {
    return this.pythonEngine.runScript(
      'tools/storage/runset_resolver.py',
      { operation: 'resolve_runset', runset_id: runsetId, force },
      RunSetResolutionSchema
    );
  }
  
  async freezeRunSet(runsetId: string): Promise<RunSetResolution> {
    return this.pythonEngine.runScript(
      'tools/storage/runset_resolver.py',
      { operation: 'freeze_runset', runset_id: runsetId },
      RunSetResolutionSchema
    );
  }
}
```

### Phase 3: CLI Commands (Week 2)

**Commands**:
```bash
quantbot runset create --id <id> --dataset <dataset-id> [filters]
quantbot runset resolve <runset-id> [--force]
quantbot runset freeze <runset-id>
quantbot runset list [--tags <tags>] [--frozen]
quantbot runset get <runset-id>

quantbot registry rebuild [--force]
```

### Phase 4: Integration (Week 2)

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
```

---

## Success Criteria

- [ ] Can create RunSet with high-level filters
- [ ] Can resolve RunSet to concrete run_ids
- [ ] Can freeze RunSet for reproducibility
- [ ] Can rebuild registry from Parquet
- [ ] Resolution is deterministic
- [ ] Resolution is auditable (history in Parquet)
- [ ] Immutability enforced (no mutation of runs/artifacts)
- [ ] DuckDB is disposable (can delete and rebuild)

---

## Example: End-to-End Workflow

```bash
# 1. Create RunSet (exploration mode)
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31 \
  --strategy-family MultiTrade_20pctTrail \
  --tags baseline,q4

# 2. Resolve (see what it matches)
quantbot runset resolve brook_baseline_2025Q4
# Output: 47 runs, 235 artifacts

# 3. Run experiments using RunSet
quantbot research experiments create \
  --name "momentum-test" \
  --runset brook_baseline_2025Q4

# 4. Freeze (pin for paper)
quantbot runset freeze brook_baseline_2025Q4

# 5. Generate report (uses frozen resolution)
quantbot lab report \
  --runset brook_baseline_2025Q4 \
  --template paper_fig_2

# 6. Rebuild registry (if needed)
quantbot registry rebuild
```

---

## Next Step (High Leverage)

**Implement the registry rebuild command first.**

Why? Because once you can rebuild from Parquet, everything else becomes "just write append-only records and rebuild".

**Single command**:
```bash
quantbot registry rebuild
```

**What it does**:
1. Scans `lake/registry/**/*.parquet`
2. Recreates `registry.duckdb`
3. Creates views you'll query in the lab

**Then** you can iterate on:
- RunSet creation
- Resolution logic
- Freeze semantics

All with the confidence that you can always rebuild from truth.

---

## Related Documents

- [RunSet Resolver Design](./runset-resolver-design.md)
- [Research Package Architecture](./research-package-architecture.md)
- [Artifact Store Design](./artifact-store.md)

---

## Conclusion

RunSet registry as **append-only Parquet facts** with **DuckDB as disposable cache**.

**Key principles**:
- Parquet is truth
- DuckDB is rebuildable
- Deterministic IDs
- Append-only records
- No mutation, ever

This is the foundation for a research platform that's both flexible and rigorous, with the same guarantees as your OHLCV/alerts system.

