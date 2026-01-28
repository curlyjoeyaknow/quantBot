# Phase IV: Experiment Execution

## Overview

| Attribute | Value |
|-----------|-------|
| **Phase** | IV |
| **Duration** | Week 4-5 |
| **Dependencies** | Phase II (Projection Builder), Phase III (Experiment Tracking) |
| **Status** | 🔲 Pending |
| **Critical Path** | Yes |

---

## Objective

Execute experiments with frozen artifact sets. This is the core handler that orchestrates:
1. Validating artifact availability
2. Building DuckDB projections
3. Running simulations
4. Publishing results as artifacts
5. Tracking lineage

---

## Deliverables

### 1. Experiment Execution Handler

**File**: `packages/workflows/src/experiments/handlers/execute-experiment.ts`

**Purpose**: Pure handler that orchestrates experiment execution. Depends on ports only (not adapters).

**Interface**:

```typescript
export async function executeExperiment(
  definition: ExperimentDefinition,
  ports: {
    artifactStore: ArtifactStorePort;
    projectionBuilder: ProjectionBuilderPort;
    experimentTracker: ExperimentTrackerPort;
  }
): Promise<Experiment>;
```

**Execution Flow**:

```
1. Create experiment record (pending)
2. Update status to running
3. Validate all input artifacts exist
4. Build DuckDB projection from artifacts
5. Execute simulation engine
6. Publish results as artifacts (trades, metrics)
7. Store output artifact IDs
8. Update status to completed
9. Dispose projection (cleanup)
10. Return completed experiment
```

**Error Handling**:

```typescript
try {
  // Steps 2-9
} catch (error) {
  await experimentTracker.updateStatus(experimentId, 'failed');
  throw error;
}
```

---

### 2. Simulation Integration Types

**File**: `packages/workflows/src/experiments/types.ts`

**Purpose**: Types for simulation integration.

```typescript
export interface SimulationInput {
  duckdbPath: string;
  config: SimulationConfig;
  seed: number;
}

export interface SimulationConfig {
  strategy: StrategyConfig;
  dateRange: DateRange;
  params: Record<string, unknown>;
}

export interface SimulationOutput {
  trades: Trade[];
  metrics: Metrics;
  equityCurve: EquityPoint[];
  diagnostics: Diagnostic[];
}

export interface SimulationResults {
  tradesPath: string;    // Path to trades Parquet
  metricsPath: string;   // Path to metrics Parquet
  curvesPath: string;    // Path to equity curve Parquet
  inputArtifactIds: string[];
}
```

---

### 3. Simulation Executor (Integration Point)

**File**: `packages/workflows/src/experiments/simulation-executor.ts`

**Purpose**: Integration point with existing `@quantbot/simulation` package.

```typescript
export async function executeSimulation(
  duckdbPath: string,
  config: SimulationConfig
): Promise<SimulationResults> {
  // 1. Load data from DuckDB projection
  // 2. Call simulation engine from @quantbot/simulation
  // 3. Write results to temp Parquet files
  // 4. Return paths to result files
}
```

**Note**: This integrates with existing simulation engine. The simulation package already has correct determinism.

---

### 4. Result Publishing Helper

**File**: `packages/workflows/src/experiments/result-publisher.ts`

**Purpose**: Publish simulation results as artifacts.

```typescript
export async function publishResults(
  experimentId: string,
  results: SimulationResults,
  provenance: Provenance,
  artifactStore: ArtifactStorePort
): Promise<ExperimentResults> {
  // 1. Publish trades artifact
  const tradesResult = await artifactStore.publishArtifact({
    artifactType: 'experiment_trades',
    schemaVersion: 1,
    logicalKey: `experiment=${experimentId}/trades`,
    dataPath: results.tradesPath,
    inputArtifactIds: results.inputArtifactIds,
    ...
  });
  
  // 2. Publish metrics artifact
  const metricsResult = await artifactStore.publishArtifact({
    artifactType: 'experiment_metrics',
    ...
  });
  
  return {
    tradesArtifactId: tradesResult.artifactId,
    metricsArtifactId: metricsResult.artifactId,
  };
}
```

---

### 5. Command Context Integration

**File**: `packages/cli/src/core/command-context.ts`

**Purpose**: Ensure all required services are available.

Services needed:
- `artifactStore()` (from Phase I)
- `projectionBuilder()` (from Phase II)
- `experimentTracker()` (from Phase III)

---

## Tasks

### Task 4.1: Create Handler
- [ ] Create `packages/workflows/src/experiments/handlers/execute-experiment.ts`
- [ ] Implement `executeExperiment()` function
- [ ] Add artifact validation
- [ ] Add projection building
- [ ] Add result publishing
- [ ] Add error handling with status updates
- [ ] Add cleanup (dispose projection)

### Task 4.2: Create Types
- [ ] Create `packages/workflows/src/experiments/types.ts`
- [ ] Define simulation input/output types
- [ ] Define result types

### Task 4.3: Create Simulation Executor
- [ ] Create `packages/workflows/src/experiments/simulation-executor.ts`
- [ ] Integrate with `@quantbot/simulation` package
- [ ] Implement data loading from DuckDB
- [ ] Implement result writing to temp Parquet
- [ ] Add seed handling for determinism

### Task 4.4: Create Result Publisher
- [ ] Create `packages/workflows/src/experiments/result-publisher.ts`
- [ ] Implement trades artifact publishing
- [ ] Implement metrics artifact publishing
- [ ] Handle lineage (input artifact IDs)

### Task 4.5: Create Artifact Validator
- [ ] Create `packages/workflows/src/experiments/artifact-validator.ts`
- [ ] Validate all input artifacts exist
- [ ] Validate artifact status is 'active'
- [ ] Return validation errors

### Task 4.6: Export from Package
- [ ] Create `packages/workflows/src/experiments/index.ts`
- [ ] Export `executeExperiment`
- [ ] Export types

### Task 4.7: Write Unit Tests
- [ ] Create test file
- [ ] Test with mock ports
- [ ] Test successful execution flow
- [ ] Test error handling (failed status)
- [ ] Test artifact validation
- [ ] Test result publishing

### Task 4.8: Write Integration Tests
- [ ] Create integration test file
- [ ] Test end-to-end flow with real artifacts
- [ ] Verify lineage tracking
- [ ] Verify projection cleanup

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/workflows/src/experiments/handlers/execute-experiment.ts` | Create | Main handler |
| `packages/workflows/src/experiments/types.ts` | Create | Types |
| `packages/workflows/src/experiments/simulation-executor.ts` | Create | Simulation integration |
| `packages/workflows/src/experiments/result-publisher.ts` | Create | Artifact publishing |
| `packages/workflows/src/experiments/artifact-validator.ts` | Create | Validation |
| `packages/workflows/src/experiments/index.ts` | Create | Package exports |
| `packages/workflows/tests/unit/experiments/execute-experiment.test.ts` | Create | Unit tests |
| `packages/workflows/tests/integration/experiments/execute-experiment.test.ts` | Create | Integration tests |

---

## Success Criteria

- [ ] Handler is pure (depends on ports only)
- [ ] Validates artifacts before execution
- [ ] Builds projection correctly
- [ ] Integrates with simulation engine
- [ ] Publishes results as artifacts
- [ ] Tracks lineage correctly
- [ ] Updates experiment status correctly
- [ ] Cleans up projection after execution
- [ ] Unit tests pass
- [ ] Integration tests pass

---

## Testing Strategy

### Unit Tests

```typescript
describe('executeExperiment', () => {
  it('should execute experiment with frozen artifacts', async () => {
    const mockArtifactStore = createMockArtifactStore();
    const mockProjectionBuilder = createMockProjectionBuilder();
    const mockExperimentTracker = createMockExperimentTracker();
    
    const result = await executeExperiment(definition, {
      artifactStore: mockArtifactStore,
      projectionBuilder: mockProjectionBuilder,
      experimentTracker: mockExperimentTracker,
    });
    
    expect(result.status).toBe('completed');
    expect(mockArtifactStore.getArtifact).toHaveBeenCalled();
    expect(mockProjectionBuilder.buildProjection).toHaveBeenCalled();
    expect(mockExperimentTracker.storeResults).toHaveBeenCalled();
  });

  it('should update status to failed on error', async () => {
    const mockArtifactStore = createMockArtifactStore();
    const mockProjectionBuilder = createMockProjectionBuilder({
      buildProjection: vi.fn().mockRejectedValue(new Error('Build failed'))
    });
    const mockExperimentTracker = createMockExperimentTracker();
    
    await expect(executeExperiment(definition, ports))
      .rejects.toThrow('Build failed');
    
    expect(mockExperimentTracker.updateStatus)
      .toHaveBeenCalledWith(definition.experimentId, 'failed');
  });

  it('should dispose projection after completion', async () => {
    const mockProjectionBuilder = createMockProjectionBuilder();
    
    await executeExperiment(definition, { ...ports, projectionBuilder: mockProjectionBuilder });
    
    expect(mockProjectionBuilder.disposeProjection).toHaveBeenCalled();
  });
});
```

### Integration Tests

```typescript
describe('executeExperiment (integration)', () => {
  it('should execute experiment with lineage', async () => {
    // Create real artifacts
    const alertArtifact = await createTestArtifact('alerts_v1');
    const ohlcvArtifact = await createTestArtifact('ohlcv_slice_v2');
    
    const definition = {
      experimentId: 'test-exp-' + Date.now(),
      name: 'Integration Test',
      inputs: {
        alerts: [alertArtifact.artifactId],
        ohlcv: [ohlcvArtifact.artifactId],
      },
      // ...
    };
    
    const result = await executeExperiment(definition, realPorts);
    
    expect(result.status).toBe('completed');
    expect(result.outputs?.trades).toBeDefined();
    
    // Verify lineage
    const lineage = await realPorts.artifactStore.getLineage(result.outputs!.trades!);
    expect(lineage.inputs).toContainEqual(
      expect.objectContaining({ artifactId: alertArtifact.artifactId })
    );
  });
});
```

---

## Handler Pattern

The experiment execution handler follows the established pattern:

```typescript
// Pure handler - no I/O, depends on ports only
export async function executeExperiment(
  definition: ExperimentDefinition,
  ports: {
    artifactStore: ArtifactStorePort;
    projectionBuilder: ProjectionBuilderPort;
    experimentTracker: ExperimentTrackerPort;
  }
): Promise<Experiment> {
  // All I/O via ports
  // Testable with mocks
  // No process.exit, no console.log
}
```

**Not allowed in handler**:
- Direct database access
- File system operations
- Console output
- Process exit
- Environment variable reads

---

## Determinism Guarantee

The experiment execution guarantees determinism:

1. **Frozen Artifacts**: Input artifacts are immutable
2. **Seeded RNG**: Simulation uses seeded random number generator
3. **Versioned Config**: Strategy and params are frozen
4. **Provenance**: Git commit + engine version tracked

**Result**: Same inputs + same seed → byte-identical outputs

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Simulation integration complexity | High | High | Incremental integration, mock first |
| Large projection build time | Medium | Medium | Progress logging, timeout handling |
| Temp file cleanup on error | Medium | Low | Try/finally for cleanup |

---

## Acceptance Checklist

- [ ] All deliverables created
- [ ] All tasks completed
- [ ] All success criteria met
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Code review completed
- [ ] Build succeeds
- [ ] End-to-end experiment works

---

## Next Phase

After Phase IV is complete, Phase V (CLI Integration) can begin. Phases V, VI, and VII can run in parallel as they all depend on the artifact store but not on each other.

