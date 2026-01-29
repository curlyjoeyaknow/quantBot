# RunSet + Resolver Design

**Version**: 1.0.0  
**Date**: 2026-01-29  
**Status**: Design Complete, Implementation Pending

---

## Problem

Current workflow requires manual artifact wrangling:

```bash
# Too rigid - requires knowing exact artifact IDs
quantbot research experiments create \
  --alerts 88f07b79-...,7a1c3f29-...,3f4a5b6c-... \
  --ohlcv 3a4b5c6d-...,7e8f9012-...,4d5e6f7a-...
```

**Pain points**:
- Manual archaeology to find artifacts
- No way to reference "all runs for Q4 2025"
- Can't easily compare "baseline vs ablation"
- Reproducibility requires saving long artifact lists

---

## Solution: RunSet + Resolver

**Core move**: Introduce a RunSet (a selection, not data) and a Resolver (DNS for your lake).

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

## What is a RunSet?

**A RunSet is a logical selection, not data.**

It's a named queryable set that can be regenerated any time.

### RunSet Inputs (Pure, Declarative)

```typescript
interface RunSetSpec {
  runsetId: string;  // e.g., 'brook_baseline_2025Q4'
  name: string;
  datasetId: string;  // e.g., 'ohlcv_v2_2025Q4'
  universe: UniverseFilter;  // chain, venue, token_source, caller set
  timeBounds: TimeBounds;  // time bounds + alert window policy
  strategy: StrategyFilter;  // engine_version, strategy family
  tags: string[];  // e.g., ['baseline', 'ablation', 'paper_fig_2']
  frozen: boolean;  // If true, resolution is pinned
}
```

### RunSet Output

```typescript
interface RunSetResolution {
  runsetId: string;
  runIds: string[];  // List of matching run IDs
  artifacts: ResolvedArtifact[];  // Concrete URIs
  contentHash: string;  // Hash of the resolved list
  frozen: boolean;  // If true, this resolution is pinned
}
```

**This kills "individually reference each artifact" because you reference RunSet ID.**

---

## What is the Resolver?

**The Resolver is the ONLY convenience layer allowed to touch truth.**

It takes a RunSet spec and produces concrete URIs:
- Parquet file paths
- DuckDB tables/views
- Manifest pointers
- Metadata sidecars

### Resolver Contract

1. **Deterministic**: Same inputs ⇒ same resolved list (unless using `latest=true`)
2. **Versioned**: Outputs carry `resolver_version`
3. **Auditable**: Writes a resolution record

**Think of it like DNS for your data lake.**

---

## The Hard Boundary (What Convenience Can/Cannot Do)

### Convenience is ALLOWED to:

✅ Find data  
✅ Select data  
✅ Cache data  
✅ Index metadata  
✅ Summarize results  

### Convenience is NOT ALLOWED to:

❌ Alter canonical events  
❌ Alter OHLCV truth  
❌ Infer missing candles  
❌ "Repair" gaps silently  
❌ Rewrite run outputs in place  
❌ Compute trading outcomes without engine replay  

**If convenience changes the timeline, you've crossed into fake backtesting.**

So: **Resolver can only point. Engine can only replay. SQL can only interpret.**

---

## Your New Minimum Set of Primitives

### A) Canonical Datasets (Immutable)

```
datasets/ohlcv/<dataset_id>/...
datasets/alerts/<dataset_id>/...
```

Each `dataset_id` corresponds to:
- Schema version
- Source provenance (birdeye, clickhouse export, etc.)
- Coverage policy snapshot
- Creation timestamp

**Rule**: If you "fix" OHLCV, that's a new `dataset_id`. Period. No exceptions.

### B) StrategySpec (Engine Input, Hashed)

A StrategySpec must be:
- JSON-serializable
- Stable ordering (canonical JSON)
- Hashed (sha256)

Example fields:
```json
{
  "strategy_family": "MultiTrade_20pctTrail_50pctDropRebound_24h",
  "params": {
    "trailingStop": 0.20,
    "reentryLogic": "50pctDropRebound",
    "maxTrades": 3,
    "fees": 0.001,
    "slippageModel": "linear"
  },
  "engine_version": "1.0.0",
  "seed": 42
}
```

### C) Run (One Execution)

A run is:
- `run_id`
- Pointers to `dataset_id(s)`
- Pointers to `StrategySpec` hash
- Outputs: artifacts (trades, curve, metrics)
- Status + timing + machine info (optional)

### D) RunSet (Selection)

A RunSet spec is:
```typescript
{
  runs_where: {
    dataset_id: 'ohlcv_v2_2025Q4',
    caller: ['whale_watcher', 'smart_money'],
    strategy_family: 'MultiTrade_20pctTrail',
    engine_version: '1.0.0'
  }
}
```

OR:
```typescript
{
  run_ids: ['run-123', 'run-456', 'run-789']  // Explicit pin
}
```

OR:
```typescript
{
  tags: ['baseline', 'paper_fig_2']
}
```

### E) Experiment (A "Bundle")

An Experiment is:
- A name + intent
- One or more RunSets
- Optional report config (plots, tables)
- A frozen "resolution snapshot" for reproducibility

This keeps experimentation flexible: you can rapidly iterate RunSets, but when you want to publish/compare, you "freeze" the snapshot.

---

## The Trick That Makes This Practical: Two Modes

You need both. Explicitly.

### 1) Exploration Mode (Fast, Flexible)

- RunSet may use `latest=true` semantics (e.g., "latest dataset for ohlcv_v2")
- Resolver caches aggressively
- Lab queries are parameterized and easy
- Results are marked: **exploratory**

### 2) Repro Mode (Pinned, Strict)

- `dataset_id` pinned
- `run_id` list pinned
- Resolution snapshot stored
- All queries run against frozen list
- Results are marked: **reproducible**

**Same codepaths. Different flags + metadata.**

---

## How This Solves Your Current Pain

### Before (Manual Artifact References)

```bash
quantbot research experiments create \
  --name "momentum-test" \
  --alerts 88f07b79-...,7a1c3f29-...,3f4a5b6c-... \
  --ohlcv 3a4b5c6d-...,7e8f9012-...,4d5e6f7a-...
```

### After (RunSet Reference)

```bash
# Create RunSet
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --name "Brook Baseline Q4 2025" \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31 \
  --strategy-family MultiTrade_20pctTrail

# Resolve RunSet (see what it matches)
quantbot runset resolve brook_baseline_2025Q4

# Create experiment using RunSet
quantbot research experiments create \
  --name "momentum-test" \
  --runset brook_baseline_2025Q4

# Freeze RunSet (pin for reproducibility)
quantbot runset freeze brook_baseline_2025Q4
```

**Your SQL becomes**:
```sql
-- Parameterized by runset_id
SELECT * FROM trades
WHERE run_id IN (
  SELECT run_id FROM registry.runset_membership
  WHERE runset_id = 'brook_baseline_2025Q4'
);
```

No more referencing each artifact by hand.

---

## The "Convenience Budget" (Simple Rule You Can Enforce)

### Only These Tables Can Be Updated Without Creating New dataset_id:

- Indexes
- Manifests
- RunSet membership
- Cached resolutions
- Derived summaries

### These Must Be Immutable:

- Raw OHLCV slices
- Canonical alert events
- Engine outputs for a given `run_id`

**If you ever "fix" OHLCV, that's a new `dataset_id`. Period. No exceptions.**

(This is what keeps you honest.)

---

## Concrete Implementation Shape

### Python: Engine, Optimizer, Resolver, Run Registry Writer

- Engine: Executes strategies
- Optimizer: Searches parameter space
- Resolver: Finds matching runs/artifacts
- Registry Writer: Records runs/datasets/resolutions

### DuckDB: Metadata Registry + Posthoc Analytics

- Metadata registry (small, fast)
- Posthoc analytics (joins, aggregations)

### Parquet: Immutable Truth + Immutable Run Outputs

- OHLCV slices
- Alert events
- Trade outputs
- Metrics outputs

### TypeScript: Orchestration CLI Only (Optional)

- CLI commands
- Workflow orchestration
- UI/API (future)

**Key**: The resolver is Python (so it can share hashing + canonicalization + manifest logic with the engine).

---

## What Your Tables Look Like (Small, Powerful)

In your DuckDB "research registry" DB:

```sql
registry.datasets (
  dataset_id, kind, schema_version, created_at, provenance_json
)

registry.artifacts (
  artifact_id, kind, uri, content_hash, dataset_id?, run_id?, created_at
)

registry.runs (
  run_id, dataset_ids, strategy_hash, engine_version, status, created_at
)

registry.runsets (
  runset_id, spec_json, created_at, frozen_bool, resolution_hash
)

registry.runset_membership (
  runset_id, run_id
)  ← THE MAGIC JOIN TABLE

registry.resolutions (
  runset_id, resolver_version, resolved_at, resolved_list_hash, resolved_json
)
```

Now your lab query takes `runset_id`, not file paths.

---

## CLI Verbs

### RunSet Management

```bash
# Create RunSet
quantbot runset create \
  --id <runset-id> \
  --name <name> \
  --dataset <dataset-id> \
  --caller <caller> \
  --from <date> --to <date> \
  [--strategy-family <family>] \
  [--tags <tags>]

# Resolve RunSet (find matching runs)
quantbot runset resolve <runset-id> [--force]

# Freeze RunSet (pin for reproducibility)
quantbot runset freeze <runset-id>

# Unfreeze RunSet (allow re-resolution)
quantbot runset unfreeze <runset-id>

# List RunSets
quantbot runset list [--tags <tags>] [--frozen]

# Get RunSet details
quantbot runset get <runset-id>

# Delete RunSet
quantbot runset delete <runset-id>
```

### Dataset Management

```bash
# Register dataset
quantbot dataset register \
  --id <dataset-id> \
  --kind <kind> \
  --schema-version <version> \
  --source <source> \
  --from <date> --to <date>

# List datasets
quantbot dataset list [--kind <kind>]

# Get dataset details
quantbot dataset get <dataset-id>
```

### Run Management

```bash
# Register run
quantbot run register \
  --id <run-id> \
  --datasets <dataset-ids> \
  --strategy-hash <hash> \
  --engine-version <version>

# List runs
quantbot run list [--dataset <dataset-id>] [--strategy-hash <hash>]

# Get run details
quantbot run get <run-id>
```

### Lab Queries

```bash
# Query by RunSet
quantbot lab query \
  --runset <runset-id> \
  --query <sql-file>

# Generate report
quantbot lab report \
  --runset <runset-id> \
  --template <template-name>
```

---

## Momentum Cue (The Next Step to Build)

**Build one thing first: the RunSet + Resolver, end-to-end.**

Even if the engine is messy, once you can do:

```bash
resolve_runset("brook_baseline_2025Q4") → [run_id…]
lab.sql(runset_id="brook_baseline_2025Q4")
```

…your entire workflow stops feeling like manual archaeology.

Then you can tighten the boundary with "freeze runset" when you're ready to compare/publish.

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

- [x] RunSet types (`packages/core/src/types/runset.ts`)
- [x] Resolver port (`packages/core/src/ports/runset-resolver-port.ts`)
- [x] Registry schema (`tools/storage/runset_registry_schema.sql`)
- [ ] Python resolver implementation
- [ ] DuckDB adapter

### Phase 2: CLI (Week 2)

- [ ] `runset create` command
- [ ] `runset resolve` command
- [ ] `runset freeze` command
- [ ] `runset list` command
- [ ] `dataset register` command
- [ ] `run register` command

### Phase 3: Integration (Week 3)

- [ ] Update experiment creation to use RunSets
- [ ] Lab queries parameterized by `runset_id`
- [ ] Freeze semantics for reproducibility
- [ ] Migration guide

### Phase 4: Polish (Week 4)

- [ ] UI for RunSet management
- [ ] Visualization of RunSet coverage
- [ ] Performance optimization
- [ ] Documentation

---

## Success Criteria

- [ ] Can create RunSet with high-level filters
- [ ] Can resolve RunSet to concrete artifact list
- [ ] Can freeze RunSet for reproducibility
- [ ] Can query lab data by `runset_id`
- [ ] Resolution is deterministic (same inputs ⇒ same outputs)
- [ ] Resolution is auditable (history tracked)
- [ ] Immutability enforced (datasets, runs, artifacts)

---

## Related Documents

- [Research Package Architecture](./research-package-architecture.md)
- [Artifact Store Design](./artifact-store.md)
- [Experiment Tracking](./experiment-tracking.md)

---

## Conclusion

RunSet + Resolver provides a **logical selection layer** that sits between user intent and concrete artifacts.

**Key benefits**:
- Reference sets, not individual artifacts
- Exploration mode (fast) + Reproducible mode (pinned)
- Hard boundary: convenience can only point, not alter
- Immutability enforced: datasets, runs, artifacts

This is the foundation for a research platform that's both flexible and rigorous.

