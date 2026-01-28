# Research Package Implementation Plan

This directory contains the implementation plan for the QuantBot Research Package.

## Overview

**Project**: QuantBot Research Package
**Duration**: 8 weeks
**Status**: 🔲 Planning Complete

---

## Documents

| Document | Description |
|----------|-------------|
| [roadmap.md](./roadmap.md) | Overall project roadmap and timeline |
| [phase-1-artifact-store-integration.md](./phase-1-artifact-store-integration.md) | Phase I: Artifact Store Integration (Week 1-2) |
| [phase-2-projection-builder.md](./phase-2-projection-builder.md) | Phase II: Projection Builder (Week 2-3) |
| [phase-3-experiment-tracking.md](./phase-3-experiment-tracking.md) | Phase III: Experiment Tracking (Week 3-4) |
| [phase-4-experiment-execution.md](./phase-4-experiment-execution.md) | Phase IV: Experiment Execution (Week 4-5) |
| [phase-5-cli-integration.md](./phase-5-cli-integration.md) | Phase V: CLI Integration (Week 5-6) |
| [phase-6-alert-ingestion-integration.md](./phase-6-alert-ingestion-integration.md) | Phase VI: Alert Ingestion Integration (Week 6-7) |
| [phase-7-ohlcv-slice-integration.md](./phase-7-ohlcv-slice-integration.md) | Phase VII: OHLCV Slice Integration (Week 7-8) |

---

## Quick Reference

### Timeline

```
Week 1-2    Phase I   Artifact Store Integration     CRITICAL PATH
Week 2-3    Phase II  Projection Builder             CRITICAL PATH
Week 3-4    Phase III Experiment Tracking            CRITICAL PATH
Week 4-5    Phase IV  Experiment Execution           CRITICAL PATH
Week 5-6    Phase V   CLI Integration                Parallel
Week 6-7    Phase VI  Alert Ingestion Integration    Parallel
Week 7-8    Phase VII OHLCV Slice Integration        Parallel
```

### Critical Path

```
Phase I → Phase II → Phase IV
    ↘            ↗
      Phase III
```

### Key Files to Create

| Phase | Key Files |
|-------|-----------|
| I | `core/ports/artifact-store-port.ts`, `storage/adapters/artifact-store-adapter.ts`, `tools/storage/artifact_store_ops.py` |
| II | `core/ports/projection-builder-port.ts`, `storage/adapters/projection-builder-adapter.ts` |
| III | `core/ports/experiment-tracker-port.ts`, `storage/adapters/experiment-tracker-adapter.ts`, `tools/storage/experiment_tracker_ops.py` |
| IV | `workflows/src/experiments/handlers/execute-experiment.ts` |
| V | `cli/src/commands/artifacts.ts`, `cli/src/commands/experiments.ts` |
| VI | `ingestion/src/handlers/ingest-telegram-alerts.ts` |
| VII | `ohlcv/src/handlers/export-ohlcv-slice.ts` |

---

## Related Documents

- **Consolidated PRD**: [../prd-research-package-consolidated.md](../prd-research-package-consolidated.md)
- **Architecture**: [../../docs/architecture/research-package-architecture.md](../../docs/architecture/research-package-architecture.md)

---

## Getting Started

1. **Read the roadmap**: Start with [roadmap.md](./roadmap.md) for the overall picture
2. **Review Phase I**: Read [phase-1-artifact-store-integration.md](./phase-1-artifact-store-integration.md) in detail
3. **Create tasks**: Extract tasks from Phase I into your project tracker
4. **Begin implementation**: Start with the port interface in `@quantbot/core`

