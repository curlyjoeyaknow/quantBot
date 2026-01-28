# Phase III: Experiment Tracking

## Overview

| Attribute | Value |
|-----------|-------|
| **Phase** | III |
| **Duration** | Week 3-4 |
| **Dependencies** | Phase I (Artifact Store Integration) |
| **Status** | ✅ **COMPLETE** |
| **Critical Path** | Yes |
| **Completed** | 2026-01-28 |

---

## Objective

Enable experiment tracking with artifact lineage. Experiments declare frozen artifact sets, track execution status, and store output artifact IDs.

---

## Deliverables

### 1. Experiment Tracker Port Interface

**File**: `packages/core/src/ports/experiment-tracker-port.ts`

**Purpose**: Define type-only interface for experiment tracking with artifact lineage.

**Interface**:

```typescript
export interface ExperimentTrackerPort {
  createExperiment(definition: ExperimentDefinition): Promise<Experiment>;
  getExperiment(experimentId: string): Promise<Experiment>;
  listExperiments(filter: ExperimentFilter): Promise<Experiment[]>;
  updateStatus(experimentId: string, status: ExperimentStatus): Promise<void>;
  storeResults(experimentId: string, results: ExperimentResults): Promise<void>;
  findByInputArtifacts(artifactIds: string[]): Promise<Experiment[]>;
}

export interface ExperimentDefinition {
  experimentId: string;
  name: string;
  description?: string;
  inputs: {
    alerts: string[];        // Alert artifact IDs
    ohlcv: string[];         // OHLCV artifact IDs
    strategies?: string[];   // Strategy artifact IDs
  };
  config: {
    strategy: Record<string, unknown>;
    dateRange: { from: string; to: string };
    params: Record<string, unknown>;
  };
  provenance: {
    gitCommit: string;
    gitDirty: boolean;
    engineVersion: string;
    createdAt: string;
  };
}

export interface Experiment extends ExperimentDefinition {
  status: ExperimentStatus;
  outputs?: {
    trades?: string;
    metrics?: string;
    curves?: string;
    diagnostics?: string;
  };
  execution?: {
    startedAt: string;
    completedAt?: string;
    duration?: number;
    error?: string;
  };
}

export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExperimentFilter {
  status?: ExperimentStatus;
  artifactType?: string;
  gitCommit?: string;
  minCreatedAt?: string;
  maxCreatedAt?: string;
  limit?: number;
}

export interface ExperimentResults {
  tradesArtifactId?: string;
  metricsArtifactId?: string;
  curvesArtifactId?: string;
  diagnosticsArtifactId?: string;
}
```

---

### 2. Experiment Tracker Adapter

**File**: `packages/storage/src/adapters/experiment-tracker-adapter.ts`

**Purpose**: Implement `ExperimentTrackerPort` using DuckDB for storage.

**Storage**: Uses DuckDB (not SQLite) to match existing patterns and enable complex queries.

**Constructor**:

```typescript
constructor(
  dbPath: string,             // e.g., /home/memez/opn/data/experiments.duckdb
  pythonEngine?: PythonEngine
)
```

---

### 3. Python Wrapper Script

**File**: `tools/storage/experiment_tracker_ops.py`

**Purpose**: Python script for experiment tracking operations via JSON stdin/stdout.

**Operations**:

| Operation | Input | Output |
|-----------|-------|--------|
| `create_experiment` | `ExperimentDefinition` | `Experiment` |
| `get_experiment` | `{ experiment_id }` | `Experiment` |
| `list_experiments` | `{ filter }` | `Experiment[]` |
| `update_status` | `{ experiment_id, status }` | `{ success }` |
| `store_results` | `{ experiment_id, results }` | `{ success }` |
| `find_by_input_artifacts` | `{ artifact_ids }` | `Experiment[]` |

---

### 4. DuckDB Schema

**File**: `tools/storage/sql/experiment_tracker_schema.sql`

**Purpose**: Schema for experiment tracking tables.

**Tables**:

```sql
-- Experiments table
CREATE TABLE experiments (
  experiment_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  
  -- Input artifacts (JSON arrays)
  input_alerts TEXT NOT NULL,      -- JSON array of artifact IDs
  input_ohlcv TEXT NOT NULL,       -- JSON array of artifact IDs
  input_strategies TEXT,           -- JSON array of artifact IDs (optional)
  
  -- Configuration (JSON)
  config TEXT NOT NULL,            -- JSON object
  
  -- Provenance
  git_commit TEXT NOT NULL,
  git_dirty BOOLEAN NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Output artifacts (optional)
  output_trades TEXT,
  output_metrics TEXT,
  output_curves TEXT,
  output_diagnostics TEXT,
  
  -- Execution metadata
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  error TEXT
);

-- Index for status queries
CREATE INDEX idx_experiments_status ON experiments(status);

-- Index for created_at queries
CREATE INDEX idx_experiments_created ON experiments(created_at);

-- Index for git_commit queries
CREATE INDEX idx_experiments_commit ON experiments(git_commit);
```

---

### 5. Command Context Integration

**File**: `packages/cli/src/core/command-context.ts`

**Purpose**: Add experiment tracker to service factory.

**Implementation**:

```typescript
experimentTracker(): ExperimentTrackerPort {
  if (!this._experimentTracker) {
    const dbPath = process.env.EXPERIMENT_DB || '/home/memez/opn/data/experiments.duckdb';
    this._experimentTracker = new ExperimentTrackerAdapter(dbPath, this.pythonEngine());
  }
  return this._experimentTracker;
}
```

---

## Tasks

### Task 3.1: Create Port Interface
- [x] Create `packages/core/src/ports/experiment-tracker-port.ts`
- [x] Define `ExperimentTrackerPort` interface
- [x] Define all supporting types
- [x] Add JSDoc documentation
- [x] Export from `packages/core/src/ports/index.ts`

### Task 3.2: Create DuckDB Schema
- [x] Create `tools/storage/experiment_tracker_schema.sql`
- [x] Define experiments table
- [x] Add indexes for common queries
- [x] Document schema

### Task 3.3: Create Python Wrapper
- [x] Create `tools/storage/experiment_tracker_ops.py`
- [x] Implement schema initialization
- [x] Implement `create_experiment`
- [x] Implement `get_experiment`
- [x] Implement `list_experiments`
- [x] Implement `update_status`
- [x] Implement `store_results`
- [x] Implement `find_by_input_artifacts`
- [x] Add error handling

### Task 3.4: Create Adapter
- [x] Create `packages/storage/src/adapters/experiment-tracker-adapter.ts`
- [x] Implement `ExperimentTrackerAdapter` class
- [x] Add Zod schemas for validation
- [x] Implement all port methods
- [x] Add logging
- [x] Export from index

### Task 3.5: Integrate with CommandContext
- [x] Add `experimentTracker()` method to CommandServices
- [x] Implement service factory in CommandContext
- [x] Configure environment variable (EXPERIMENT_DB)

### Task 3.6: Write Unit Tests
- [x] Create test file
- [x] Test with mock PythonEngine
- [x] Test CRUD operations
- [x] Test status updates
- [x] Test artifact queries

### Task 3.7: Write Integration Tests
- [x] Create integration test file
- [x] Test with real DuckDB
- [x] Test experiment lifecycle
- [x] Test finding by input artifacts

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/ports/experiment-tracker-port.ts` | Create | Port interface |
| `packages/core/src/ports/index.ts` | Modify | Export new port |
| `tools/storage/sql/experiment_tracker_schema.sql` | Create | DuckDB schema |
| `tools/storage/experiment_tracker_ops.py` | Create | Python wrapper |
| `packages/storage/src/adapters/experiment-tracker-adapter.ts` | Create | Adapter |
| `packages/storage/src/adapters/index.ts` | Modify | Export new adapter |
| `packages/cli/src/core/command-context.ts` | Modify | Add service factory |
| `packages/storage/tests/unit/adapters/experiment-tracker-adapter.test.ts` | Create | Unit tests |
| `packages/storage/tests/integration/experiment-tracker-adapter.test.ts` | Create | Integration tests |

---

## Success Criteria

- [x] Port interface defined
- [x] Comprehensive experiment tracking
- [x] Artifact lineage support
- [x] Adapter implements port
- [x] Uses PythonEngine
- [x] Stores experiments in DuckDB
- [x] Tracks artifact lineage
- [x] Unit tests pass
- [x] Integration tests pass

---

## Testing Strategy

### Unit Tests

```typescript
describe('ExperimentTrackerAdapter', () => {
  it('should create experiment', async () => {
    const adapter = new ExperimentTrackerAdapter(testDbPath, mockEngine);
    
    const experiment = await adapter.createExperiment({
      experimentId: 'exp-123',
      name: 'Test Experiment',
      inputs: {
        alerts: ['alert-1', 'alert-2'],
        ohlcv: ['ohlcv-1'],
      },
      config: {
        strategy: { name: 'momentum' },
        dateRange: { from: '2025-01-01', to: '2025-01-31' },
        params: {},
      },
      provenance: {
        gitCommit: 'abc123',
        gitDirty: false,
        engineVersion: '1.0.0',
        createdAt: new Date().toISOString(),
      },
    });
    
    expect(experiment.experimentId).toBe('exp-123');
    expect(experiment.status).toBe('pending');
  });

  it('should update status', async () => {
    const adapter = new ExperimentTrackerAdapter(testDbPath, mockEngine);
    await adapter.createExperiment({ experimentId: 'exp-456', ... });
    
    await adapter.updateStatus('exp-456', 'running');
    
    const experiment = await adapter.getExperiment('exp-456');
    expect(experiment.status).toBe('running');
  });

  it('should find by input artifacts', async () => {
    const adapter = new ExperimentTrackerAdapter(testDbPath, mockEngine);
    await adapter.createExperiment({
      experimentId: 'exp-789',
      inputs: { alerts: ['alert-X'], ohlcv: [] },
      ...
    });
    
    const experiments = await adapter.findByInputArtifacts(['alert-X']);
    
    expect(experiments).toHaveLength(1);
    expect(experiments[0].experimentId).toBe('exp-789');
  });
});
```

### Integration Tests

```typescript
describe('ExperimentTrackerAdapter (integration)', () => {
  it('should track full experiment lifecycle', async () => {
    const adapter = new ExperimentTrackerAdapter(testDbPath);
    
    // Create
    const experiment = await adapter.createExperiment({ ... });
    expect(experiment.status).toBe('pending');
    
    // Start
    await adapter.updateStatus(experiment.experimentId, 'running');
    
    // Store results
    await adapter.storeResults(experiment.experimentId, {
      tradesArtifactId: 'trades-123',
      metricsArtifactId: 'metrics-456',
    });
    
    // Complete
    await adapter.updateStatus(experiment.experimentId, 'completed');
    
    // Verify
    const completed = await adapter.getExperiment(experiment.experimentId);
    expect(completed.status).toBe('completed');
    expect(completed.outputs?.trades).toBe('trades-123');
  });
});
```

---

## Environment Variables

```bash
export EXPERIMENT_DB="/home/memez/opn/data/experiments.duckdb"
```

---

## Dependencies

### TypeScript
- `@quantbot/core` (for ports)
- `@quantbot/utils` (for PythonEngine)
- `zod` (for schema validation)

### Python
- `duckdb` (for database operations)

---

## Experiment Lifecycle

```
┌─────────────┐
│   pending   │ ← createExperiment()
└──────┬──────┘
       │ updateStatus('running')
┌──────▼──────┐
│   running   │ ← Execution in progress
└──────┬──────┘
       │ storeResults() + updateStatus('completed')
┌──────▼──────┐
│  completed  │ ← Success
└─────────────┘

       OR
       
┌──────▼──────┐
│   failed    │ ← updateStatus('failed') on error
└─────────────┘
```

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| JSON serialization issues | Medium | Medium | Use consistent JSON encoding |
| Artifact ID validation | Medium | Medium | Validate artifact IDs exist before storing |
| Concurrent updates | Low | Medium | Use transactions in Python |

---

## Acceptance Checklist

- [x] All deliverables created
- [x] All tasks completed
- [x] All success criteria met
- [x] Unit tests pass
- [x] Integration tests pass
- [x] Code review completed
- [x] Build succeeds
- [x] Phase IV can begin

---

## Next Phase

After Phase III is complete, Phase IV (Experiment Execution) can begin. It requires both Phase II (Projection Builder) and Phase III (Experiment Tracking) to be complete.

