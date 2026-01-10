# Python as DB Driver - Architectural Decision

**Status**: ✅ DECIDED  
**Date**: 2025-01-23  
**Decision**: Python may touch DuckDB only via storage ports; sweeps must never spawn Python per run.

## Context

Python scripts are used as a database driver layer for DuckDB operations. This document defines when this is acceptable and how it's enforced.

## Decision Criteria

### ✅ Python as DB Layer is Valid IF:

1. **Called through one port** (e.g., StatePort / ArtifactPort) — nobody else imports PythonEngine
2. **Used for coarse operations**:
   - Load snapshot
   - Bulk write artifacts
   - Aggregation queries
   - Feature generation
3. **Can tolerate overhead**:
   - Process invocation overhead is acceptable, OR
   - Long-lived worker is used
4. **Errors are loud**:
   - Non-zero exit → fail
   - Return structured error objects
5. **Pinned Python environment**:
   - uv/poetry/venv ensures CI/prod consistency

### ❌ Don't Use Python as DB Layer IF:

1. **Tight loop operations**:
   - Per-run per-step reads/writes in sweeps
2. **Timing requirements**:
   - Need predictable low-jitter timing
3. **Operational simplicity**:
   - Want "one runtime to rule them all"
4. **Dependency issues**:
   - Seeing flaky "works on my machine" around Python deps

## QuantBot-Specific Decision

Given the goal ("endless sims + optimizations"):

### ✅ Keep Python For:
- **Batch/analytics operations**:
  - Feature transforms
  - Big aggregation queries
  - Report generation
  - Snapshot loading
  - Bulk artifact writes

### ⚠️ Research Loop (Sweeps):
For sweeps writing thousands of artifacts, either:
- **(A)** Use a long-lived Python worker (not spawn-per-call), OR
- **(B)** Move artifact write/read to Node DuckDB bindings

**Critical Rule**: Sweeps must never spawn Python per run.

## Enforcement

### Allowed Locations

PythonEngine may be imported and used **only** in:
- `packages/storage/**` - Storage layer implementations
- `tools/storage/**` - Storage tooling scripts

### Forbidden Locations

PythonEngine **must not** be imported in:
- `packages/workflows/**` - Use storage ports instead
- `packages/cli/**` - Use services that wrap PythonEngine
- `packages/ingestion/**` - Use storage ports or services
- `packages/data-observatory/**` - Use storage ports
- Any other package - Use storage ports

### Enforcement Mechanisms

1. **ESLint Rule**: Forbids PythonEngine imports outside allowed directories
2. **CI Check**: Grep for PythonEngine imports outside storage and fail build
3. **Code Review**: Verify sweeps don't spawn Python per run

## Migration Path

### Current State

PythonEngine is used in multiple packages (violations detected by CI):
- `packages/cli` - Direct imports in command-context.ts and command files (needs migration)
- `packages/workflows` - Direct imports in adapters, context, metadata, storage (needs migration)
- `packages/ingestion` - Direct imports in services and work planning (needs migration)
- `packages/data-observatory` - Direct import in event-collector (needs migration)

**Enforcement**: CI check `pnpm verify:python-engine` will fail the build if new violations are introduced.

### Target State

All PythonEngine usage should go through:
1. **Storage Ports** (preferred):
   - StatePort
   - ArtifactPort
   - StorageEngine methods

2. **Services** (acceptable for CLI):
   - Services in `packages/storage` that wrap PythonEngine
   - Services exposed via CommandContext

### Migration Steps

1. ✅ Document decision (this document)
2. ✅ Add ESLint rule
3. ✅ Add CI check
4. ⏳ Migrate workflows to use storage ports
5. ⏳ Migrate ingestion to use storage ports
6. ⏳ Migrate data-observatory to use storage ports
7. ⏳ Verify sweeps don't spawn Python per run

## Examples

### ✅ Correct Usage

```typescript
// packages/storage/src/duckdb/duckdb-client.ts
import { PythonEngine } from '@quantbot/utils';

export class DuckDBClient {
  constructor(private pythonEngine: PythonEngine) {}
  // Uses PythonEngine for DuckDB operations
}
```

```typescript
// packages/workflows/src/simulation/runSimulation.ts
// Uses storage ports, not PythonEngine directly
const storageEngine = ctx.storageEngine;
await storageEngine.getCandles(...);
```

### ❌ Incorrect Usage

```typescript
// packages/workflows/src/calls/queryCallsDuckdb.ts
import { PythonEngine } from '@quantbot/utils'; // ❌ FORBIDDEN
const engine = new PythonEngine();
```

```typescript
// packages/ingestion/src/OhlcvIngestionService.ts
import { PythonEngine } from '@quantbot/utils'; // ❌ FORBIDDEN
```

## Related Documents

- [Architecture Boundaries](./ARCHITECTURE_BOUNDARIES.md)
- [Storage Package Rules](../.cursor/rules/packages-storage.mdc)
- [CLI Handler Rules](../.cursor/rules/packages-cli.mdc)

