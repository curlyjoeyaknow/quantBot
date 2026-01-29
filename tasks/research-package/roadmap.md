# Research Package Implementation Roadmap

## Executive Summary

**Project**: QuantBot Research Package
**Duration**: 8 weeks
**Goal**: Transform QuantBot into a research lab with reproducibility guarantees

---

## Timeline Overview

```
Week 1-2    │ Phase I: Artifact Store Integration     │ CRITICAL PATH
Week 2-3    │ Phase II: Projection Builder            │ CRITICAL PATH
Week 3-4    │ Phase III: Experiment Tracking          │ CRITICAL PATH
Week 4-5    │ Phase IV: Experiment Execution          │ CRITICAL PATH
Week 5-6    │ Phase V: CLI Integration                │ Parallel
Week 6-7    │ Phase VI: Alert Ingestion Integration   │ Parallel
Week 7-8    │ Phase VII: OHLCV Slice Integration      │ Parallel
```

---

## Phase Summary

| Phase | Name | Duration | Status | Dependencies |
|-------|------|----------|--------|--------------|
| I | Artifact Store Integration | Week 1-2 | ✅ **COMPLETE** | None |
| II | Projection Builder | Week 2-3 | ✅ **COMPLETE** | Phase I |
| III | Experiment Tracking | Week 3-4 | ✅ **COMPLETE** | Phase I |
| IV | Experiment Execution | Week 4-5 | ✅ **COMPLETE** | Phase II, III |
| V | CLI Integration | Week 5-6 | 🔲 Pending | Phase I, II, III |
| VI | Alert Ingestion Integration | Week 6-7 | 🔲 Pending | Phase I |
| VII | OHLCV Slice Integration | Week 7-8 | 🔲 Pending | Phase I |

---

## Critical Path

```
Phase I → Phase II → Phase IV
    ↘            ↗
      Phase III
```

**Phases I-IV are sequential and blocking.** Phases V-VII can run in parallel after Phase I.

---

## Existing Infrastructure

### Data Lake (`/home/memez/opn`)

- **4,899 artifacts** registered in manifest
  - 3,641 OHLCV slice artifacts
  - 750 alert artifacts (day-partitioned)
  - 508 alert event artifacts
- **SQLite manifest** with lineage tracking
- **DuckDB cache** (disposable, rebuildable)
- **Coverage analysis** artifacts

### Artifact Store (`packages/artifact_store`)

- Immutable Parquet publishing
- Content-addressable storage (file hash + content hash)
- Automatic deduplication
- Lineage tracking and provenance

### Simulation Engine (`@quantbot/simulation`)

- Determinism correctly implemented (`DeterministicRNG`)
- Simulation contract formalized (`SimInputSchema`)
- Execution models (no perfect fills)

---

## Architectural Pattern

```
Handler (pure orchestration)
    ↓ depends on
Port Interface (@quantbot/core)
    ↑ implemented by
Adapter (@quantbot/storage, uses PythonEngine)
    ↓ calls
Python Artifact Store (packages/artifact_store)
    ↓ writes
Data Lake (/home/memez/opn)
```

**Key Decisions:**

- ✅ Use ports/adapters pattern (no separate bridge package)
- ✅ Use existing `PythonEngine` for Python integration
- ✅ Use `@quantbot/simulation` as base package
- ✅ Use `/home/memez/opn` as data lake

---

## Phase Details

### Phase I: Artifact Store Integration (Week 1-2) ✅ **COMPLETE**

**Goal**: Connect artifact store to TypeScript via ports/adapters

**Deliverables**:

- ✅ `packages/core/src/ports/artifact-store-port.ts` (240 lines)
- ✅ `packages/storage/src/adapters/artifact-store-adapter.ts` (243 lines)
- ✅ `tools/storage/artifact_store_ops.py` (294 lines)
- ✅ Unit tests (319 lines, 10 tests)
- ✅ Integration tests (235 lines, 8 tests)
- ✅ CommandContext integration

**Success Criteria**:

- ✅ Port interface defined in `@quantbot/core`
- ✅ Adapter implements port using PythonEngine
- ✅ No separate bridge package created
- ✅ All tests passing
- ✅ Environment variables configured

**Completed**: 2026-01-28

**Document**: [Phase I: Artifact Store Integration](./phase-1-artifact-store-integration.md)

---

### Phase II: Projection Builder (Week 2-3) ✅ **COMPLETE**

**Goal**: Build DuckDB projections from Parquet artifacts

**Deliverables**:

- ✅ `packages/core/src/ports/projection-builder-port.ts`
- ✅ `packages/storage/src/adapters/projection-builder-adapter.ts`
- ✅ Projection builder tests

**Success Criteria**:

- ✅ DuckDB projections built from Parquet
- ✅ Projections are rebuildable
- ✅ Cache management works

**Completed**: 2026-01-28

**Document**: [Phase II: Projection Builder](./phase-2-projection-builder.md)

---

### Phase III: Experiment Tracking (Week 3-4) ✅ **COMPLETE**

**Goal**: Track experiments with artifact lineage

**Deliverables**:

- ✅ `packages/core/src/ports/experiment-tracker-port.ts` (226 lines)
- ✅ `packages/storage/src/adapters/experiment-tracker-adapter.ts` (264 lines)
- ✅ `tools/storage/experiment_tracker_ops.py` (388 lines)
- ✅ `tools/storage/experiment_tracker_schema.sql` (73 lines)
- ✅ Unit tests (425 lines, 10 tests)
- ✅ Integration tests (445 lines, 15 tests)
- ✅ CommandContext integration

**Success Criteria**:

- ✅ Experiments tracked with artifact lineage
- ✅ Status updates work
- ✅ Results stored correctly
- ✅ All tests passing

**Completed**: 2026-01-28

**Document**: [Phase III: Experiment Tracking](./phase-3-experiment-tracking.md)

---

### Phase IV: Experiment Execution (Week 4-5) ✅ **COMPLETE**

**Goal**: Execute experiments with frozen artifact sets

**Deliverables**:

- ✅ `packages/workflows/src/experiments/handlers/execute-experiment.ts` (180 lines)
- ✅ `packages/workflows/src/experiments/types.ts` (344 lines)
- ✅ `packages/workflows/src/experiments/simulation-executor.ts` (313 lines)
- ✅ `packages/workflows/src/experiments/result-publisher.ts` (148 lines)
- ✅ `packages/workflows/src/experiments/artifact-validator.ts` (69 lines)
- ✅ `packages/workflows/src/experiments/index.ts` (32 lines)
- ✅ Unit tests (320 lines, 10 tests)
- ✅ Integration tests (150 lines, 2 tests)

**Success Criteria**:

- ✅ Experiments execute with frozen artifacts
- ✅ Results published as artifacts
- ✅ Lineage tracked correctly
- ✅ Handler is pure (depends on ports only)
- ✅ All tests passing

**Completed**: 2026-01-29

**Document**: [Phase IV: Experiment Execution](./phase-4-experiment-execution.md)

---

### Phase V: CLI Integration (Week 5-6)

**Goal**: CLI commands for artifacts and experiments

**Deliverables**:

- Artifact CLI commands (`quantbot artifacts list/get/find/lineage`)
- Experiment CLI commands (`quantbot experiments create/execute/get/list`)
- CLI handlers (pure, depend on ports)

**Success Criteria**:

- ✅ All CLI commands work
- ✅ Handlers follow pattern
- ✅ Output formatting correct

**Document**: [Phase V: CLI Integration](./phase-5-cli-integration.md)

---

### Phase VI: Alert Ingestion Integration (Week 6-7)

**Goal**: Ingest alerts via artifact store

**Deliverables**:

- Alert ingestion handler
- Quarantine mechanism
- Migration script

**Success Criteria**:

- ✅ Alerts ingested as artifacts
- ✅ Deduplication at artifact level
- ✅ Invalid alerts quarantined

**Document**: [Phase VI: Alert Ingestion Integration](./phase-6-alert-ingestion-integration.md)

---

### Phase VII: OHLCV Slice Integration (Week 7-8)

**Goal**: Export OHLCV slices via artifact store

**Deliverables**:

- OHLCV slice handler
- Coverage validation
- Migration script

**Success Criteria**:

- ✅ OHLCV slices published as artifacts
- ✅ Coverage validated
- ✅ Slices reusable across experiments

**Document**: [Phase VII: OHLCV Slice Integration](./phase-7-ohlcv-slice-integration.md)

---

## Milestones

### Milestone 1: Core Integration (Week 2)

- ✅ Artifact store port + adapter working
- ✅ Can query and publish artifacts from TypeScript
- ✅ Deduplication works

### Milestone 2: Experiment Infrastructure (Week 4)

- ✅ Projection builder working (completed 2026-01-28)
- ✅ Experiment tracker working (completed 2026-01-28)
- ✅ Can create and track experiments

### Milestone 3: End-to-End Flow (Week 5) ✅ **COMPLETE**

- ✅ Experiment execution working (completed 2026-01-29)
- ✅ Results published as artifacts (completed 2026-01-29)
- ✅ Lineage tracked correctly (completed 2026-01-29)

### Milestone 4: CLI Complete (Week 6)

- ✅ All CLI commands working
- ✅ End-to-end experiment flow via CLI

### Milestone 5: Full Integration (Week 8)

- ✅ Alert ingestion via artifacts
- ✅ OHLCV slice via artifacts
- ✅ All workflows use artifact store

---

## Success Metrics

### Architectural Invariants

1. ✅ **Parquet is Truth**: All authoritative data in immutable Parquet
2. ✅ **DuckDB is Disposable**: Can delete and rebuild without data loss
3. ✅ **Idempotency Everywhere**: Safe to re-run any pipeline step
4. ✅ **Lineage is Complete**: Every artifact declares its inputs
5. ✅ **Ports/Adapters Pattern**: Handlers depend on ports, adapters implement ports

### Reproducibility

- ✅ Same artifact set + same config → same results
- ✅ Full provenance (git commit, params, timestamps)
- ✅ Lineage queries work (results → inputs)
- ✅ Can reproduce any historical experiment

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Python integration complexity | Use existing PythonEngine pattern |
| Performance with large artifact sets | DuckDB parallel read_parquet |
| Breaking existing workflows | Parallel operation during migration |
| Artifact manifest corruption | SQLite with WAL, regular backups |

---

## Resources Required

### Development

- 1 full-time developer
- 8 weeks duration
- Access to `/home/memez/opn` data lake

### Testing

- CI/CD pipeline with artifact store tests
- Integration tests with real Python scripts
- End-to-end experiment tests

### Documentation

- Architecture documentation (complete)
- Phase-specific implementation guides (this roadmap)
- CLI usage documentation

---

## Next Steps

1. ✅ **Review roadmap** with stakeholders
2. ✅ **Approve Phase I** implementation
3. ✅ **Create Phase I tasks** in project tracker
4. ✅ **Begin implementation** (artifact store port + adapter)

---

## Related Documents

- **Consolidated PRD**: [prd-research-package-consolidated.md](../prd-research-package-consolidated.md)
- **Architecture Document**: [research-package-architecture.md](../../docs/architecture/research-package-architecture.md)
- **Phase Documents**: See individual phase files in this directory
