# Phase V: CLI Integration

## Overview

| Attribute | Value |
|-----------|-------|
| **Phase** | V |
| **Duration** | Week 5-6 |
| **Dependencies** | Phase I (Artifact Store), Phase II (Projection Builder), Phase III (Experiment Tracking) |
| **Status** | 🔲 Pending |
| **Critical Path** | No (can run in parallel with Phase VI-VII) |

---

## Objective

Create CLI commands for artifact and experiment operations, following the established handler/command pattern.

---

## Deliverables

### 1. Artifact CLI Commands

**Commands**:

```bash
# List artifacts
quantbot artifacts list [--type <type>] [--status <status>] [--limit <n>]

# Get artifact details
quantbot artifacts get <artifact-id>

# Find by logical key
quantbot artifacts find --type <type> --key <logical-key>

# Get lineage
quantbot artifacts lineage <artifact-id>

# Get downstream artifacts
quantbot artifacts downstream <artifact-id>

# Publish artifact (dev/test)
quantbot artifacts publish \
  --type <type> \
  --version <n> \
  --key <logical-key> \
  --data <path> \
  [--tag <key>=<value>]... \
  --writer <name> \
  --writer-version <version>
```

---

### 2. Experiment CLI Commands

**Commands**:

```bash
# Create experiment
quantbot experiments create \
  --name <name> \
  --alerts <artifact-id>,... \
  --ohlcv <artifact-id>,... \
  [--strategy <name>] \
  [--from <date>] \
  [--to <date>] \
  [--param <key>=<value>]...

# Execute experiment
quantbot experiments execute <experiment-id>

# Get experiment status
quantbot experiments get <experiment-id>

# List experiments
quantbot experiments list [--status <status>] [--limit <n>]

# Find by input artifacts
quantbot experiments find-by-inputs --artifacts <artifact-id>,...
```

---

### 3. Artifact Handlers

**Files**:
- `packages/cli/src/handlers/artifacts/list-artifacts.ts`
- `packages/cli/src/handlers/artifacts/get-artifact.ts`
- `packages/cli/src/handlers/artifacts/find-artifact.ts`
- `packages/cli/src/handlers/artifacts/get-lineage.ts`
- `packages/cli/src/handlers/artifacts/get-downstream.ts`
- `packages/cli/src/handlers/artifacts/publish-artifact.ts`

**Pattern**:

```typescript
// packages/cli/src/handlers/artifacts/list-artifacts.ts
import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { listArtifactsSchema } from '../../commands/artifacts.js';

export type ListArtifactsArgs = z.infer<typeof listArtifactsSchema>;

export async function listArtifactsHandler(
  args: ListArtifactsArgs,
  ctx: CommandContext
) {
  const artifactStore = ctx.services.artifactStore();
  
  const artifacts = await artifactStore.listArtifacts({
    artifactType: args.type,
    status: args.status,
    limit: args.limit || 100,
  });
  
  return artifacts;
}
```

---

### 4. Experiment Handlers

**Files**:
- `packages/cli/src/handlers/experiments/create-experiment.ts`
- `packages/cli/src/handlers/experiments/execute-experiment.ts`
- `packages/cli/src/handlers/experiments/get-experiment.ts`
- `packages/cli/src/handlers/experiments/list-experiments.ts`
- `packages/cli/src/handlers/experiments/find-by-inputs.ts`

**Pattern**:

```typescript
// packages/cli/src/handlers/experiments/execute-experiment.ts
import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { executeExperiment } from '@quantbot/workflows/experiments';
import { executeExperimentSchema } from '../../commands/experiments.js';

export type ExecuteExperimentArgs = z.infer<typeof executeExperimentSchema>;

export async function executeExperimentHandler(
  args: ExecuteExperimentArgs,
  ctx: CommandContext
) {
  const artifactStore = ctx.services.artifactStore();
  const projectionBuilder = ctx.services.projectionBuilder();
  const experimentTracker = ctx.services.experimentTracker();
  
  // Get experiment definition
  const definition = await experimentTracker.getExperiment(args.experimentId);
  
  // Execute
  const result = await executeExperiment(definition, {
    artifactStore,
    projectionBuilder,
    experimentTracker,
  });
  
  return result;
}
```

---

### 5. Command Registration

**Files**:
- `packages/cli/src/commands/artifacts.ts`
- `packages/cli/src/commands/experiments.ts`

**Pattern**:

```typescript
// packages/cli/src/commands/artifacts.ts
import { z } from 'zod';
import { commandRegistry } from '../core/command-registry.js';

export const listArtifactsSchema = z.object({
  type: z.string().optional(),
  status: z.enum(['active', 'superseded', 'tombstoned']).optional(),
  limit: z.number().int().positive().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export function registerArtifactsCommands(program: Command): void {
  const artifactsCmd = program
    .command('artifacts')
    .description('Artifact operations');

  artifactsCmd
    .command('list')
    .description('List artifacts')
    .option('--type <type>', 'Filter by artifact type')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Limit results')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('artifacts', 'list');
      await execute(commandDef!, options);
    });
  
  // ... more commands
}
```

---

## Tasks

### Task 5.1: Create Artifact Handlers
- [ ] Create `list-artifacts.ts` handler
- [ ] Create `get-artifact.ts` handler
- [ ] Create `find-artifact.ts` handler
- [ ] Create `get-lineage.ts` handler
- [ ] Create `get-downstream.ts` handler
- [ ] Create `publish-artifact.ts` handler

### Task 5.2: Create Experiment Handlers
- [ ] Create `create-experiment.ts` handler
- [ ] Create `execute-experiment.ts` handler
- [ ] Create `get-experiment.ts` handler
- [ ] Create `list-experiments.ts` handler
- [ ] Create `find-by-inputs.ts` handler

### Task 5.3: Create Command Registration
- [ ] Create `packages/cli/src/commands/artifacts.ts`
- [ ] Define schemas for all artifact commands
- [ ] Register commands with Commander
- [ ] Wire to execute()

### Task 5.4: Create Experiment Commands
- [ ] Create `packages/cli/src/commands/experiments.ts`
- [ ] Define schemas for all experiment commands
- [ ] Register commands with Commander
- [ ] Wire to execute()

### Task 5.5: Update Main CLI
- [ ] Import and register artifacts commands
- [ ] Import and register experiments commands

### Task 5.6: Write Handler Tests
- [ ] Create tests for artifact handlers
- [ ] Create tests for experiment handlers
- [ ] Test with mock services

### Task 5.7: Write CLI Integration Tests
- [ ] Test `quantbot artifacts list`
- [ ] Test `quantbot artifacts get`
- [ ] Test `quantbot experiments create`
- [ ] Test `quantbot experiments execute`

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/cli/src/handlers/artifacts/list-artifacts.ts` | Create | List handler |
| `packages/cli/src/handlers/artifacts/get-artifact.ts` | Create | Get handler |
| `packages/cli/src/handlers/artifacts/find-artifact.ts` | Create | Find handler |
| `packages/cli/src/handlers/artifacts/get-lineage.ts` | Create | Lineage handler |
| `packages/cli/src/handlers/artifacts/get-downstream.ts` | Create | Downstream handler |
| `packages/cli/src/handlers/artifacts/publish-artifact.ts` | Create | Publish handler |
| `packages/cli/src/handlers/experiments/create-experiment.ts` | Create | Create handler |
| `packages/cli/src/handlers/experiments/execute-experiment.ts` | Create | Execute handler |
| `packages/cli/src/handlers/experiments/get-experiment.ts` | Create | Get handler |
| `packages/cli/src/handlers/experiments/list-experiments.ts` | Create | List handler |
| `packages/cli/src/handlers/experiments/find-by-inputs.ts` | Create | Find handler |
| `packages/cli/src/commands/artifacts.ts` | Create | Command registration |
| `packages/cli/src/commands/experiments.ts` | Create | Command registration |
| `packages/cli/tests/unit/handlers/artifacts/*.test.ts` | Create | Handler tests |
| `packages/cli/tests/unit/handlers/experiments/*.test.ts` | Create | Handler tests |

---

## Success Criteria

- [ ] All CLI commands work
- [ ] Handlers follow pattern (pure, depend on ports)
- [ ] Output formatting correct (table, json, csv)
- [ ] Error messages are user-friendly
- [ ] Handler tests pass
- [ ] CLI integration tests pass

---

## Output Formatting

Handlers return data; executor formats output based on `--format` option:

```typescript
// In executor
const result = await handler(args, ctx);

switch (args.format) {
  case 'json':
    console.log(JSON.stringify(result, null, 2));
    break;
  case 'table':
    console.log(formatTable(result));
    break;
  case 'csv':
    console.log(formatCsv(result));
    break;
}
```

---

## Example Usage

### Artifacts

```bash
# List recent alerts
$ quantbot artifacts list --type alerts_v1 --limit 5
┌──────────────────────────────────────┬─────────────────────────────────────┬────────┐
│ artifact_id                          │ logical_key                         │ rows   │
├──────────────────────────────────────┼─────────────────────────────────────┼────────┤
│ 88f07b79-621c-4d6b-ae39-a2c71c995703 │ day=2025-05-01/chain=solana        │ 40     │
│ 7a1c3f29-8d45-4e2b-9f12-b3c4d5e6f789 │ day=2025-05-02/chain=solana        │ 35     │
└──────────────────────────────────────┴─────────────────────────────────────┴────────┘

# Get artifact details
$ quantbot artifacts get 88f07b79-621c-4d6b-ae39-a2c71c995703
Artifact: 88f07b79-621c-4d6b-ae39-a2c71c995703
Type: alerts_v1 (v1)
Key: day=2025-05-01/chain=solana
Status: active
Rows: 40
Created: 2026-01-27T07:04:10.779624Z

# Get lineage
$ quantbot artifacts lineage experiment-trades-123
Inputs:
  - alerts_v1: 88f07b79-621c-4d6b-ae39-a2c71c995703
  - ohlcv_slice_v2: 3a4b5c6d-7e8f-9012-3456-789abcdef012
```

### Experiments

```bash
# Create experiment
$ quantbot experiments create \
    --name "momentum-v1" \
    --alerts 88f07b79-621c-4d6b-ae39-a2c71c995703 \
    --ohlcv 3a4b5c6d-7e8f-9012-3456-789abcdef012 \
    --strategy momentum \
    --from 2025-05-01 \
    --to 2025-05-31
Experiment created: exp-abc123
Status: pending

# Execute experiment
$ quantbot experiments execute exp-abc123
Executing experiment exp-abc123...
  Building projection... done (2.3s)
  Running simulation... done (15.7s)
  Publishing results... done (1.2s)
Experiment completed: exp-abc123
Results:
  - trades: experiment-trades-xyz789
  - metrics: experiment-metrics-uvw456

# Get experiment
$ quantbot experiments get exp-abc123
Experiment: exp-abc123
Name: momentum-v1
Status: completed
Inputs:
  - alerts: 88f07b79-621c-4d6b-ae39-a2c71c995703
  - ohlcv: 3a4b5c6d-7e8f-9012-3456-789abcdef012
Outputs:
  - trades: experiment-trades-xyz789
  - metrics: experiment-metrics-uvw456
Duration: 19.2s
```

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Output formatting complexity | Medium | Low | Reuse existing formatters |
| Command naming conflicts | Low | Low | Use namespaced commands |
| Long-running commands timeout | Medium | Medium | Add progress output |

---

## Acceptance Checklist

- [ ] All deliverables created
- [ ] All tasks completed
- [ ] All success criteria met
- [ ] Handler tests pass
- [ ] CLI tests pass
- [ ] Code review completed
- [ ] Build succeeds
- [ ] Documentation updated

---

## Next Phase

Phase V can run in parallel with Phases VI and VII, as they all depend on the artifact store (Phase I) but not on each other.

