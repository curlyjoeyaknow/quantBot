# Phase 5 CLI Integration - Implementation Audit

**Date**: 2026-01-29
**Phase**: V - CLI Integration
**Status**: In Progress

---

## Overview

Phase 5 focuses on creating CLI commands for artifact store and experiment operations, following the established handler/command pattern.

---

## Current State

### Existing Infrastructure

#### 1. Artifact Store (Research Package)

**Port**: `ArtifactStorePort` (`packages/core/src/ports/artifact-store-port.ts`)
- ✅ Fully implemented
- ✅ Methods: `getArtifact`, `listArtifacts`, `findByLogicalKey`, `publishArtifact`, `getLineage`, `getDownstream`, `supersede`
- ✅ Adapter: `ArtifactStoreAdapter` (`packages/storage/src/adapters/artifact-store-adapter.ts`)
- ✅ Python backend: `tools/storage/artifact_store_ops.py`

**Current CLI**: `packages/cli/src/commands/artifacts.ts`
- ⚠️ Uses **OLD** `ArtifactRepository` (DuckDB-based, versioned artifacts)
- ⚠️ NOT using new `ArtifactStorePort` (Parquet + SQLite manifest)
- Commands: `list`, `get`, `tag`
- Handlers: Stub implementations (return empty/null)

#### 2. Experiment Tracker (Research Package)

**Port**: `ExperimentTrackerPort` (`packages/core/src/ports/experiment-tracker-port.ts`)
- ✅ Fully implemented
- ✅ Methods: `createExperiment`, `getExperiment`, `listExperiments`, `updateStatus`, `storeResults`, `findByInputArtifacts`
- ✅ Adapter: `ExperimentTrackerAdapter` (`packages/storage/src/adapters/experiment-tracker-adapter.ts`)
- ✅ Python backend: `tools/storage/experiment_tracker_ops.py`

**Current CLI**: `packages/cli/src/commands/experiments.ts`
- ⚠️ Uses **OLD** `ExperimentRepository` (DuckDB-based, different schema)
- ⚠️ NOT using new `ExperimentTrackerPort` (research package)
- Commands: `list`, `get`, `find`
- Handlers: Implemented but use old repository

#### 3. Experiment Execution (Research Package)

**Handler**: `executeExperiment` (`packages/workflows/src/experiments/handlers/execute-experiment.ts`)
- ✅ Fully implemented (Phase IV)
- ✅ Uses `ArtifactStorePort`, `ProjectionBuilderPort`, `ExperimentTrackerPort`
- ✅ Pure handler (depends on ports only)
- ✅ Comprehensive tests (unit, integration, performance, property)

---

## Key Findings

### 1. **Two Separate Artifact Systems**

There are TWO distinct artifact systems in the codebase:

#### A. Old System: `ArtifactRepository` (DuckDB)
- **Location**: `packages/storage/src/adapters/artifact-duckdb-adapter.ts`
- **Purpose**: Versioned artifacts (strategies, sim runs, configs)
- **Storage**: DuckDB tables
- **Schema**: `id`, `version`, `type`, `tags`, `content`
- **Used by**: Current CLI artifact commands

#### B. New System: `ArtifactStorePort` (Parquet + SQLite)
- **Location**: `packages/core/src/ports/artifact-store-port.ts`
- **Purpose**: Immutable Parquet artifacts with lineage
- **Storage**: Parquet files + SQLite manifest
- **Schema**: `artifactId`, `artifactType`, `schemaVersion`, `logicalKey`, `status`, `fileHash`, `contentHash`
- **Used by**: Research package (Phases I-IV)

**Decision Required**: Which system should CLI use?

### 2. **Two Separate Experiment Systems**

There are TWO distinct experiment systems:

#### A. Old System: `ExperimentRepository` (DuckDB)
- **Location**: `packages/storage/src/adapters/experiment-duckdb-adapter.ts`
- **Purpose**: Generic experiment tracking
- **Schema**: Different from research package
- **Used by**: Current CLI experiment commands

#### B. New System: `ExperimentTrackerPort` (DuckDB)
- **Location**: `packages/core/src/ports/experiment-tracker-port.ts`
- **Purpose**: Experiment tracking with artifact lineage
- **Schema**: Frozen artifact sets, provenance, outputs
- **Used by**: Research package (Phases III-IV)

**Decision Required**: Which system should CLI use?

---

## Recommended Approach

### Strategy: Dual CLI Namespaces

Create **separate CLI namespaces** for old and new systems:

#### 1. Artifacts CLI

**Old System** (keep existing):
```bash
quantbot artifacts list          # DuckDB versioned artifacts
quantbot artifacts get <id>      # DuckDB versioned artifacts
quantbot artifacts tag <id>      # DuckDB versioned artifacts
```

**New System** (add new commands):
```bash
quantbot research artifacts list              # Parquet artifact store
quantbot research artifacts get <artifact-id> # Parquet artifact store
quantbot research artifacts find --type <type> --key <key>
quantbot research artifacts lineage <artifact-id>
quantbot research artifacts downstream <artifact-id>
```

#### 2. Experiments CLI

**Old System** (keep existing):
```bash
quantbot experiments list        # DuckDB experiments
quantbot experiments get <id>    # DuckDB experiments
```

**New System** (add new commands):
```bash
quantbot research experiments create ...      # Research package
quantbot research experiments execute <id>    # Research package
quantbot research experiments get <id>        # Research package
quantbot research experiments list            # Research package
quantbot research experiments find-by-inputs --artifacts <ids>
```

### Benefits

1. **No Breaking Changes**: Existing CLI commands continue to work
2. **Clear Separation**: `research` namespace for research package
3. **Gradual Migration**: Can migrate old commands to new system over time
4. **User Clarity**: Clear which system is being used

---

## Implementation Plan

### Phase 5A: Research Package CLI (Priority)

Focus on research package CLI commands (Phase V deliverables).

#### Task 5A.1: Create Research Artifacts Handlers

**Files to create**:
- `packages/cli/src/handlers/research/artifacts/list-artifacts.ts`
- `packages/cli/src/handlers/research/artifacts/get-artifact.ts`
- `packages/cli/src/handlers/research/artifacts/find-artifact.ts`
- `packages/cli/src/handlers/research/artifacts/get-lineage.ts`
- `packages/cli/src/handlers/research/artifacts/get-downstream.ts`

**Pattern**:
```typescript
export async function listArtifactsHandler(
  args: ListArtifactsArgs,
  ctx: CommandContext
) {
  const artifactStore = ctx.services.artifactStore(); // ArtifactStorePort
  return await artifactStore.listArtifacts({
    artifactType: args.type,
    status: args.status,
    limit: args.limit || 100,
  });
}
```

#### Task 5A.2: Create Research Experiments Handlers

**Files to create**:
- `packages/cli/src/handlers/research/experiments/create-experiment.ts`
- `packages/cli/src/handlers/research/experiments/execute-experiment.ts`
- `packages/cli/src/handlers/research/experiments/get-experiment.ts`
- `packages/cli/src/handlers/research/experiments/list-experiments.ts`
- `packages/cli/src/handlers/research/experiments/find-by-inputs.ts`

**Pattern**:
```typescript
export async function executeExperimentHandler(
  args: ExecuteExperimentArgs,
  ctx: CommandContext
) {
  const experimentTracker = ctx.services.experimentTracker();
  const artifactStore = ctx.services.artifactStore();
  const projectionBuilder = ctx.services.projectionBuilder();
  
  const definition = await experimentTracker.getExperiment(args.experimentId);
  
  const result = await executeExperiment(definition, {
    artifactStore,
    projectionBuilder,
    experimentTracker,
  });
  
  return result;
}
```

#### Task 5A.3: Create Command Registration

**Files to create**:
- `packages/cli/src/commands/research.ts` (new namespace)
- `packages/cli/src/command-defs/research-artifacts.ts`
- `packages/cli/src/command-defs/research-experiments.ts`

**Pattern**:
```typescript
export function registerResearchCommands(program: Command): void {
  const researchCmd = program
    .command('research')
    .description('Research package operations (artifact store, experiments)');

  // Artifacts subcommand
  const artifactsCmd = researchCmd
    .command('artifacts')
    .description('Artifact store operations');

  artifactsCmd
    .command('list')
    .description('List artifacts from artifact store')
    .option('--type <type>', 'Filter by artifact type')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Limit results')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('research', 'artifacts-list');
      await execute(commandDef!, options);
    });
  
  // ... more commands
}
```

#### Task 5A.4: Write Tests

**Files to create**:
- `packages/cli/tests/unit/handlers/research/artifacts/*.test.ts`
- `packages/cli/tests/unit/handlers/research/experiments/*.test.ts`
- `packages/cli/tests/integration/research/*.test.ts`

---

## Success Criteria

### Phase 5A (Research Package CLI)

- [ ] All research artifact commands work (`quantbot research artifacts ...`)
- [ ] All research experiment commands work (`quantbot research experiments ...`)
- [ ] Handlers follow pattern (pure, depend on ports)
- [ ] Output formatting correct (table, json, csv)
- [ ] Error messages user-friendly
- [ ] Handler unit tests pass (100% coverage)
- [ ] CLI integration tests pass
- [ ] Documentation updated

---

## Files Summary

### New Files (Phase 5A)

| File | Action | Description |
|------|--------|-------------|
| `packages/cli/src/handlers/research/artifacts/list-artifacts.ts` | Create | List handler (ArtifactStorePort) |
| `packages/cli/src/handlers/research/artifacts/get-artifact.ts` | Create | Get handler (ArtifactStorePort) |
| `packages/cli/src/handlers/research/artifacts/find-artifact.ts` | Create | Find handler (ArtifactStorePort) |
| `packages/cli/src/handlers/research/artifacts/get-lineage.ts` | Create | Lineage handler (ArtifactStorePort) |
| `packages/cli/src/handlers/research/artifacts/get-downstream.ts` | Create | Downstream handler (ArtifactStorePort) |
| `packages/cli/src/handlers/research/experiments/create-experiment.ts` | Create | Create handler (ExperimentTrackerPort) |
| `packages/cli/src/handlers/research/experiments/execute-experiment.ts` | Create | Execute handler (executeExperiment) |
| `packages/cli/src/handlers/research/experiments/get-experiment.ts` | Create | Get handler (ExperimentTrackerPort) |
| `packages/cli/src/handlers/research/experiments/list-experiments.ts` | Create | List handler (ExperimentTrackerPort) |
| `packages/cli/src/handlers/research/experiments/find-by-inputs.ts` | Create | Find handler (ExperimentTrackerPort) |
| `packages/cli/src/commands/research.ts` | Create | Research command registration |
| `packages/cli/src/command-defs/research-artifacts.ts` | Create | Artifact command schemas |
| `packages/cli/src/command-defs/research-experiments.ts` | Create | Experiment command schemas |
| `packages/cli/tests/unit/handlers/research/artifacts/*.test.ts` | Create | Handler tests |
| `packages/cli/tests/unit/handlers/research/experiments/*.test.ts` | Create | Handler tests |
| `packages/cli/tests/integration/research/*.test.ts` | Create | Integration tests |

### Existing Files (No Changes)

| File | Status | Notes |
|------|--------|-------|
| `packages/cli/src/commands/artifacts.ts` | Keep | Old system (DuckDB versioned artifacts) |
| `packages/cli/src/commands/experiments.ts` | Keep | Old system (DuckDB experiments) |
| `packages/cli/src/handlers/artifacts/*.ts` | Keep | Old system handlers |
| `packages/cli/src/handlers/experiments/*.ts` | Keep | Old system handlers |

---

## Next Steps

1. ✅ Complete audit (this document)
2. Create research artifacts handlers
3. Create research experiments handlers
4. Create command registration
5. Write tests
6. Update documentation

---

## Notes

- **No breaking changes**: Old CLI commands remain functional
- **Clear namespace**: `research` for research package operations
- **Future migration**: Can deprecate old commands later
- **Consistent pattern**: All handlers follow CLI handler pattern

