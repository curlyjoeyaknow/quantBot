# RunSet CLI Guide

**Version**: 1.0.0  
**Date**: 2026-01-29  
**Status**: Complete

---

## Overview

RunSets are **logical selections** (declarative specs), not data. They provide a way to reference sets of runs without manually specifying hundreds of artifact IDs.

**Core Concept**: Reference sets, not individual artifacts.

---

## Quick Start

```bash
# 1. Create RunSet
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --name "Brook Baseline Q4 2025" \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31 \
  --tags baseline,q4

# 2. Resolve (find matching runs)
quantbot runset resolve brook_baseline_2025Q4
# Output: 47 runs, 235 artifacts

# 3. Use in experiment
quantbot research experiments create \
  --name "momentum-test" \
  --runset brook_baseline_2025Q4 \
  --from 2025-10-01 --to 2025-12-31

# 4. Freeze (pin for paper)
quantbot runset freeze brook_baseline_2025Q4
```

---

## Commands

### Create RunSet

Create a new RunSet with declarative selection spec.

```bash
quantbot runset create [options]
```

**Required Options**:
- `--id <id>` - RunSet ID (deterministic identifier)
- `--name <name>` - Human-readable name
- `--dataset <dataset-id>` - Dataset ID (e.g., `ohlcv_v2_2025Q4`)
- `--from <date>` - Start date (ISO 8601)
- `--to <date>` - End date (ISO 8601)

**Universe Filters** (optional):
- `--caller <caller>` - Filter by caller
- `--chain <chain>` - Filter by chain
- `--venue <venue>` - Filter by venue
- `--min-market-cap <usd>` - Minimum market cap
- `--max-market-cap <usd>` - Maximum market cap
- `--min-volume <usd>` - Minimum volume

**Strategy Filters** (optional):
- `--strategy-family <family>` - Strategy family
- `--strategy-hash <hash>` - Strategy hash (exact match)
- `--engine-version <version>` - Engine version

**Other Options**:
- `--tags <tags...>` - Tags (e.g., `baseline`, `ablation`)
- `--latest` - Use latest semantics (exploration mode)
- `--auto-resolve` - Auto-resolve after creation
- `--format <format>` - Output format (`json`, `table`)

**Examples**:

```bash
# Simple RunSet (all callers)
quantbot runset create \
  --id momentum_2025Q4 \
  --name "Momentum Q4 2025" \
  --dataset ohlcv_v2_2025Q4 \
  --from 2025-10-01 --to 2025-12-31

# Caller-specific RunSet
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --name "Brook Baseline Q4 2025" \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31 \
  --tags baseline,q4

# Strategy-specific RunSet
quantbot runset create \
  --id multitrade_trail_2025Q4 \
  --name "MultiTrade Trail Q4 2025" \
  --dataset ohlcv_v2_2025Q4 \
  --strategy-family MultiTrade_20pctTrail \
  --engine-version 1.0.0 \
  --from 2025-10-01 --to 2025-12-31

# Auto-resolve on creation
quantbot runset create \
  --id test_runset \
  --name "Test RunSet" \
  --dataset ohlcv_v2_2025Q4 \
  --from 2025-10-01 --to 2025-12-31 \
  --auto-resolve
```

---

### Resolve RunSet

Resolve RunSet to concrete run_ids and artifacts.

```bash
quantbot runset resolve <runset-id> [options]
```

**Options**:
- `--force` - Force re-resolution even if cached/frozen
- `--format <format>` - Output format (`json`, `table`)

**Examples**:

```bash
# Resolve RunSet
quantbot runset resolve brook_baseline_2025Q4

# Force re-resolution (even if frozen)
quantbot runset resolve brook_baseline_2025Q4 --force
```

**Output**:

```
RunSet: brook_baseline_2025Q4
Resolved: 47 runs, 235 artifacts
Mode: exploration
Resolution hash: abc123def456...

Runs:
  - run-20251001-abc123
  - run-20251002-def456
  ...

Artifacts:
  - trades: 47 artifacts
  - metrics: 47 artifacts
  - curves: 47 artifacts
```

---

### Freeze RunSet

Freeze RunSet (pin resolution for reproducibility).

```bash
quantbot runset freeze <runset-id> [options]
```

**Options**:
- `--format <format>` - Output format (`json`, `table`)

**Examples**:

```bash
# Freeze RunSet
quantbot runset freeze brook_baseline_2025Q4
```

**Output**:

```
RunSet frozen: brook_baseline_2025Q4 (47 runs, resolution_hash=abc123de...)
Mode: reproducible

Future resolves will return this pinned resolution.
```

**What Freezing Does**:
1. Pins the current resolution
2. Sets `frozen=true`
3. Stores resolution snapshot in Parquet
4. Future resolves return the pinned resolution (unless `--force`)

---

### List RunSets

List RunSets with optional filters.

```bash
quantbot runset list [options]
```

**Options**:
- `--tags <tags...>` - Filter by tags
- `--dataset <dataset-id>` - Filter by dataset ID
- `--frozen` - Filter by frozen status
- `--mode <mode>` - Filter by mode (`exploration`, `reproducible`)
- `--limit <n>` - Limit number of results (default: 100)
- `--format <format>` - Output format (`json`, `table`, `csv`)

**Examples**:

```bash
# List all RunSets
quantbot runset list

# List frozen RunSets
quantbot runset list --frozen

# List baseline RunSets
quantbot runset list --tags baseline

# List RunSets for specific dataset
quantbot runset list --dataset ohlcv_v2_2025Q4
```

---

### Get RunSet

Get RunSet by ID.

```bash
quantbot runset get <runset-id> [options]
```

**Options**:
- `--format <format>` - Output format (`json`, `table`)

**Examples**:

```bash
# Get RunSet details
quantbot runset get brook_baseline_2025Q4
```

**Output**:

```
RunSet: brook_baseline_2025Q4
Name: Brook Baseline Q4 2025
Mode: reproducible
Dataset: ohlcv_v2_2025Q4
Time Bounds: 2025-10-01 to 2025-12-31
Universe: caller=whale_watcher
Tags: baseline, q4
Created: 2026-01-29T10:00:00Z

Latest Resolution:
  Resolved: 2026-01-29T12:00:00Z
  Runs: 47
  Artifacts: 235
  Resolution Hash: abc123def456...
  Frozen: true
```

---

## Registry Commands

### Rebuild Registry

Rebuild DuckDB registry from Parquet truth.

```bash
quantbot registry rebuild [options]
```

**Options**:
- `--force` - Force rebuild even if DuckDB exists
- `--format <format>` - Output format (`json`, `table`)

**Examples**:

```bash
# Rebuild registry
quantbot registry rebuild

# Force rebuild
quantbot registry rebuild --force
```

**Output**:

```
Rebuilding registry from Parquet...
  Loaded: 10 runsets
  Loaded: 47 runs
  Loaded: 235 artifacts
  Loaded: 15 resolutions
  Derived: 47 membership records
Registry rebuilt successfully (2.3s)
```

**When to Rebuild**:
- After adding new runs/artifacts to Parquet
- After DuckDB corruption
- After schema changes
- For fresh start

---

## Workflows

### Workflow 1: Exploratory Research

```bash
# 1. Create RunSet (exploration mode)
quantbot runset create \
  --id momentum_test \
  --name "Momentum Test" \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31 \
  --auto-resolve

# 2. Create experiment using RunSet
quantbot research experiments create \
  --name "momentum-test-1" \
  --runset momentum_test \
  --from 2025-10-01 --to 2025-12-31

# 3. Execute experiment
quantbot research experiments execute exp-20260129120000-abc123

# 4. Iterate (re-resolve with new data)
quantbot runset resolve momentum_test --force
# Output: 52 runs (new data added)

# 5. Run another experiment with updated RunSet
quantbot research experiments create \
  --name "momentum-test-2" \
  --runset momentum_test \
  --from 2025-10-01 --to 2025-12-31
```

### Workflow 2: Reproducible Research

```bash
# 1. Create RunSet
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --name "Brook Baseline Q4 2025" \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31 \
  --tags baseline,q4 \
  --auto-resolve

# 2. Review resolution
quantbot runset get brook_baseline_2025Q4

# 3. Freeze (pin for paper)
quantbot runset freeze brook_baseline_2025Q4

# 4. Create experiment with frozen RunSet
quantbot research experiments create \
  --name "momentum-paper-fig-2" \
  --runset brook_baseline_2025Q4 \
  --from 2025-10-01 --to 2025-12-31

# 5. Execute
quantbot research experiments execute exp-20260129120000-abc123

# 6. Verify reproducibility
quantbot runset resolve brook_baseline_2025Q4
# Output: 47 runs (same as frozen)
```

### Workflow 3: Caller Comparison

```bash
# 1. Create RunSets for each caller
for caller in whale_watcher smart_money degen_trader; do
  quantbot runset create \
    --id baseline_${caller}_2025Q4 \
    --name "Baseline ${caller} Q4 2025" \
    --dataset ohlcv_v2_2025Q4 \
    --caller $caller \
    --from 2025-10-01 --to 2025-12-31 \
    --tags baseline,q4 \
    --auto-resolve
done

# 2. Create experiments for each RunSet
for caller in whale_watcher smart_money degen_trader; do
  quantbot research experiments create \
    --name "momentum-${caller}" \
    --runset baseline_${caller}_2025Q4 \
    --from 2025-10-01 --to 2025-12-31
done

# 3. Execute all experiments
quantbot research experiments list --status pending --format json | \
  jq -r '.experiments[] | .experimentId' | \
  xargs -I {} quantbot research experiments execute {}

# 4. Compare results
quantbot research experiments list --status completed --format table
```

### Workflow 4: Time Series Analysis

```bash
# 1. Create RunSets for each month
for month in 10 11 12; do
  quantbot runset create \
    --id baseline_2025_${month} \
    --name "Baseline 2025-${month}" \
    --dataset ohlcv_v2_2025Q4 \
    --from 2025-${month}-01 --to 2025-${month}-31 \
    --tags baseline,monthly \
    --auto-resolve
done

# 2. Create experiments
for month in 10 11 12; do
  quantbot research experiments create \
    --name "momentum-2025-${month}" \
    --runset baseline_2025_${month} \
    --from 2025-${month}-01 --to 2025-${month}-31
done

# 3. Execute and compare
# ...
```

---

## Two Modes

### Exploration Mode (Default)

**Characteristics**:
- `frozen=false`
- Uses latest data
- Re-resolution allowed
- Results marked: exploratory

**Use for**:
- Quick experimentation
- Iterative development
- Discovering patterns

**Example**:
```bash
quantbot runset create --id test --dataset ohlcv_v2_2025Q4 --from 2025-10-01 --to 2025-12-31
quantbot runset resolve test  # 47 runs
# ... add more data ...
quantbot runset resolve test --force  # 52 runs (new data)
```

### Reproducible Mode (After Freeze)

**Characteristics**:
- `frozen=true`
- Pinned resolution
- Re-resolution returns same results
- Results marked: reproducible

**Use for**:
- Paper figures
- Production workflows
- Audit-grade results

**Example**:
```bash
quantbot runset freeze brook_baseline_2025Q4
quantbot runset resolve brook_baseline_2025Q4  # Always returns same 47 runs
```

---

## Integration with Experiments

### Using RunSets in Experiments

```bash
# Create experiment with RunSet reference
quantbot research experiments create \
  --name "momentum-test" \
  --runset brook_baseline_2025Q4 \
  --from 2025-10-01 --to 2025-12-31
```

**What happens**:
1. Resolver resolves RunSet to concrete artifact IDs
2. Experiment is created with those artifact IDs
3. RunSet metadata is stored in experiment config

**Benefits**:
- No manual artifact ID lookup
- Automatic artifact selection
- Lineage tracked (experiment → RunSet → artifacts)

### Explicit vs RunSet Mode

**Explicit Mode** (original):
```bash
quantbot research experiments create \
  --name "momentum-test" \
  --alerts alert-1,alert-2,alert-3 \
  --ohlcv ohlcv-1,ohlcv-2 \
  --from 2025-10-01 --to 2025-12-31
```

**RunSet Mode** (new):
```bash
quantbot research experiments create \
  --name "momentum-test" \
  --runset brook_baseline_2025Q4 \
  --from 2025-10-01 --to 2025-12-31
```

**Both modes supported** - use explicit for precise control, RunSet for convenience.

---

## Registry Management

### Rebuild Registry

The registry is a **Parquet-first** system with DuckDB as a disposable cache.

```bash
# Rebuild DuckDB from Parquet truth
quantbot registry rebuild
```

**When to rebuild**:
- After adding runs/artifacts to Parquet
- After DuckDB corruption
- After schema changes
- For fresh start

**What it does**:
1. Scans `lake/registry/**/*.parquet`
2. Recreates DuckDB tables
3. Derives membership table
4. Creates convenience views

**Safe to run anytime** - DuckDB is disposable.

---

## Best Practices

### 1. Use Descriptive IDs

```bash
# Good
--id brook_baseline_2025Q4
--id momentum_whale_watcher_jan2025

# Bad
--id test1
--id runset_123
```

### 2. Tag Appropriately

```bash
--tags baseline,q4,paper_fig_2
```

**Common tags**:
- `baseline` - Baseline runs
- `ablation` - Ablation studies
- `paper_fig_N` - Paper figures
- `production` - Production runs
- `qN` - Quarter tags

### 3. Freeze Before Publishing

```bash
# Always freeze before using in papers/reports
quantbot runset freeze brook_baseline_2025Q4
```

### 4. Document Selection Rationale

Use `--description` to document intent:

```bash
quantbot runset create \
  --id brook_baseline_2025Q4 \
  --name "Brook Baseline Q4 2025" \
  --description "Baseline runs for whale_watcher caller in Q4 2025, using MultiTrade_20pctTrail strategy" \
  --dataset ohlcv_v2_2025Q4 \
  --caller whale_watcher \
  --from 2025-10-01 --to 2025-12-31
```

### 5. Rebuild Regularly

```bash
# Rebuild after batch operations
quantbot registry rebuild
```

---

## Troubleshooting

### RunSet Not Found

**Problem**: `Error: RunSet not found: <runset-id>`

**Solution**: Check RunSet ID spelling:
```bash
quantbot runset list
```

### No Matching Runs

**Problem**: `Resolved: 0 runs, 0 artifacts`

**Solution**: Check filters and dataset:
```bash
# List available runs
quantbot run list --dataset ohlcv_v2_2025Q4

# Adjust filters
quantbot runset create --id test --dataset ohlcv_v2_2025Q4 --from 2025-01-01 --to 2025-12-31
```

### Cannot Freeze Already Frozen RunSet

**Problem**: `Error: RunSet already frozen`

**Solution**: Unfreeze first (if needed):
```bash
quantbot runset unfreeze brook_baseline_2025Q4
quantbot runset resolve brook_baseline_2025Q4 --force
quantbot runset freeze brook_baseline_2025Q4
```

### Registry Out of Sync

**Problem**: DuckDB doesn't match Parquet

**Solution**: Rebuild registry:
```bash
quantbot registry rebuild --force
```

---

## Advanced Usage

### Deterministic IDs

RunSet IDs are deterministic (based on spec):

```python
runset_id = sha256(canonical_json(spec))
```

**Consequence**: Same spec → same ID

**Use case**: Idempotent RunSet creation
```bash
# Run multiple times - creates same RunSet
quantbot runset create --id test --dataset ohlcv_v2_2025Q4 --from 2025-10-01 --to 2025-12-31
```

### Resolution History

View resolution history:

```bash
quantbot runset get brook_baseline_2025Q4 --format json | jq '.resolution'
```

### Programmatic Usage

Use JSON format for automation:

```bash
# Get all frozen RunSets
runsets=$(quantbot runset list --frozen --format json)

# Extract IDs
echo "$runsets" | jq -r '.runsets[] | .spec.runsetId'

# Create experiments for each
echo "$runsets" | jq -r '.runsets[] | .spec.runsetId' | \
  xargs -I {} quantbot research experiments create \
    --name "momentum-{}" \
    --runset {} \
    --from 2025-10-01 --to 2025-12-31
```

---

## Related Documentation

- [RunSet Resolver Design](../architecture/runset-resolver-design.md)
- [RunSet Parquet-First](../architecture/runset-parquet-first.md)
- [Research CLI Guide](./research-cli-guide.md)

---

## Summary

RunSets provide a **logical selection layer** that sits between user intent and concrete artifacts.

**Key benefits**:
- Reference sets, not individual artifacts
- Exploration mode (fast) + Reproducible mode (pinned)
- Parquet-first (DuckDB is disposable)
- Deterministic IDs (rebuildable)
- Hard boundary (resolver can only point, not alter)

This is the foundation for a research platform that's both flexible and rigorous.

