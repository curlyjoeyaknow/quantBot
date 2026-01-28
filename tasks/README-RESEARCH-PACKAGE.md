# QuantBot Research Package - Documentation Index

## Overview

The QuantBot Research Package formalizes the Parquet-first, DuckDB-as-projection architecture for reproducible research.

---

## Primary Documents

### 1. **Consolidated PRD** (START HERE)
**File**: `prd-research-package-consolidated.md`

**Purpose**: Comprehensive, cohesive architecture using ports/adapters pattern

**Contents**:
- Executive summary with current state (4,899 artifacts in `/home/memez/opn`)
- Correct architecture (ports/adapters/handlers, no separate bridge package)
- Complete functional requirements (7 phases)
- Implementation plan (8 weeks)
- Testing strategy
- Migration strategy

**Key Decisions**:
- ✅ Use `@quantbot/simulation` package (determinism already correct)
- ✅ Use ports/adapters pattern (no separate bridge package)
- ✅ Use existing `PythonEngine` for Python integration
- ✅ Use `/home/memez/opn` as data lake
- ✅ Use `packages/artifact_store` for Parquet publishing

---

### 2. **Research Lab Roadmap PRD**
**File**: `prd-research-lab-roadmap.md`

**Purpose**: High-level 10-phase roadmap for research lab transformation

**Contents**:
- 10 phases (Foundations → Knowledge Retention)
- Critical path analysis
- Package recommendation (`@quantbot/simulation`)
- Determinism analysis (already correct)

**Use Case**: Strategic planning, phase prioritization

---

### 3. **Integration Correction Document**
**File**: `prd-research-package-integration-CORRECTION.md`

**Purpose**: Explains why ports/adapters pattern is correct (no separate bridge package)

**Contents**:
- Architecture correction
- Port interface examples
- Adapter implementation examples
- Handler examples
- Composition root wiring

**Use Case**: Understanding the correct pattern

---

### 4. **Original Integration Document** (SUPERSEDED)
**File**: `prd-research-package-integration.md`

**Status**: ⚠️ Superseded by consolidated PRD

**Issue**: Proposed separate `@quantbot/artifact-store-bridge` package (incorrect)

**Use Case**: Historical reference only

---

## Quick Start

### For Implementation

1. **Read**: `prd-research-package-consolidated.md` (comprehensive guide)
2. **Start**: Phase I (Artifact Store Integration)
3. **Follow**: Ports/adapters/handlers pattern
4. **Test**: Unit tests for handlers, integration tests for adapters

### For Understanding Architecture

1. **Read**: `prd-research-package-integration-CORRECTION.md` (pattern explanation)
2. **Review**: Existing adapters in `packages/storage/src/adapters/`
3. **Study**: `PythonEngine` in `packages/utils/src/python/python-engine.ts`

### For Strategic Planning

1. **Read**: `prd-research-lab-roadmap.md` (10-phase roadmap)
2. **Review**: Phase dependencies and critical path
3. **Prioritize**: Phase I is critical path

---

## Key Architectural Decisions

### Decision 1: Use `@quantbot/simulation` Package

**Rationale**: 
- Determinism already correctly implemented
- Simulation contract already formalized
- Execution models already implemented
- Clean architecture already in place

**Action**: Build on `@quantbot/simulation`, don't create parallel systems

### Decision 2: Use Ports/Adapters Pattern (No Bridge Package)

**Rationale**:
- Existing pattern used throughout codebase
- `PythonEngine` already handles subprocess execution
- Testable handlers (depend on ports, not adapters)
- Clean boundaries (port in `core`, adapter in `storage`)

**Action**: Create port + adapter, not separate package

### Decision 3: Use `/home/memez/opn` as Data Lake

**Rationale**:
- Already populated with 4,899 artifacts
- Structure already correct (artifacts, cache, manifest, coverage)
- Artifact store already integrated

**Action**: Use existing data lake, don't create new structure

### Decision 4: Parquet-First, DuckDB-as-Projection

**Rationale**:
- Parquet is immutable, content-addressable, deterministic
- DuckDB is rebuildable from Parquet (disposable)
- Enables reproducibility and auditability

**Action**: Enforce at workflow level via ports/adapters

---

## Architecture Diagrams

### Ports/Adapters/Handlers Pattern

```
Handler (pure orchestration)
    ↓ depends on
Port Interface (types only, in @quantbot/core)
    ↑ implemented by
Adapter (I/O, in @quantbot/storage, uses PythonEngine)
    ↓ calls
Python Artifact Store (packages/artifact_store)
    ↓ writes
Data Lake (/home/memez/opn)
```

### Data Flow

```
Ingestion (Telegram/ClickHouse)
       ↓
Staging & Normalization
       ↓
Parquet Artifact (via ArtifactStorePort)
       ↓
Manifest Registration (SQLite)
       ↓
DuckDB Projection (via ProjectionBuilderPort)
       ↓
Experiment Execution (frozen artifact set)
       ↓
Results as Artifacts (with lineage)
```

### Experiment Lifecycle

```
1. Define Experiment
   - Input artifacts (alerts + OHLCV)
   - Configuration (strategy, params)
   - Provenance (git commit, timestamps)

2. Validate Artifacts
   - Check all artifacts exist
   - Verify artifact status (active)

3. Build Projection
   - Query manifest for artifact metadata
   - Create DuckDB from Parquet files
   - Create indexes for queries

4. Execute Simulation
   - Run strategy on projection
   - Generate trades, metrics, curves

5. Publish Results
   - Write results to temp Parquet
   - Publish via ArtifactStorePort
   - Track lineage (results → inputs)

6. Update Experiment
   - Store output artifact IDs
   - Update status to completed
   - Record execution metadata

7. Cleanup
   - Dispose DuckDB projection
   - Cleanup temp files
```

---

## Data Lake Structure

```
/home/memez/opn/
├── artifacts/                      # Immutable Parquet truth
│   ├── alerts_v1/v1/              # 750 alert artifacts
│   ├── ohlcv_slice_v2/v2/         # 3,641 OHLCV slice artifacts
│   ├── alerts_event_v1/v1/        # 508 alert event artifacts
│   └── _quarantine/               # Invalid/rejected artifacts
├── cache/                          # Disposable DuckDB projections
│   ├── ohlcv_cache.duckdb         # Rebuildable from artifacts
│   └── ohlcv_v2_dataset/          # Bucketed partitions
├── coverage/                       # Coverage analysis artifacts
│   └── ohlcv_v2/
├── manifest/                       # Artifact registry (SQLite)
│   └── manifest.sqlite            # 4,899 artifacts registered
├── staging/                        # Temporary ingestion staging
└── verify/                         # Verification & rebuild scripts
```

---

## Files to Create

### Phase I: Artifact Store Integration
1. `packages/core/src/ports/artifact-store-port.ts`
2. `packages/storage/src/adapters/artifact-store-adapter.ts`
3. `tools/storage/artifact_store_ops.py`

### Phase II: Projection Builder
1. `packages/core/src/ports/projection-builder-port.ts`
2. `packages/storage/src/adapters/projection-builder-adapter.ts`

### Phase III: Experiment Tracking
1. `packages/core/src/ports/experiment-tracker-port.ts`
2. `packages/storage/src/adapters/experiment-tracker-adapter.ts`
3. `tools/storage/experiment_tracker_ops.py`

### Phase IV: Experiment Execution
1. `packages/workflows/src/experiments/handlers/execute-experiment.ts`

### Phase V: CLI Integration
1. `packages/cli/src/handlers/artifacts/*.ts`
2. `packages/cli/src/handlers/experiments/*.ts`
3. `packages/cli/src/commands/artifacts.ts`
4. `packages/cli/src/commands/experiments.ts`

### Phase VI: Alert Ingestion
1. `packages/ingestion/src/handlers/ingest-telegram-alerts.ts`

### Phase VII: OHLCV Slice
1. `packages/ohlcv/src/handlers/export-ohlcv-slice.ts`

---

## Next Steps

1. ✅ **Review consolidated PRD** with stakeholders
2. ✅ **Approve architecture** (ports/adapters, no bridge package)
3. ✅ **Begin Phase I** (artifact store integration)
4. ✅ **Set up testing** (unit tests for handlers, integration tests for adapters)
5. ✅ **Document patterns** (add examples to `.cursor/rules/`)

---

## References

- **Existing Patterns**: See `packages/storage/src/adapters/` for adapter examples
- **PythonEngine**: See `packages/utils/src/python/python-engine.ts`
- **Artifact Store**: See `packages/artifact_store/artifact_store/`
- **Data Lake**: See `/home/memez/opn/`
- **Architecture Rules**: See `.cursor/rules/10-architecture-ports-adapters.mdc`

