# Phase I: Artifact Store Integration

## Overview

| Attribute | Value |
|-----------|-------|
| **Phase** | I |
| **Duration** | Week 1-2 |
| **Dependencies** | None |
| **Status** | ✅ **COMPLETE** |
| **Completed** | 2026-01-28 |
| **Critical Path** | Yes |

---

## Objective

Connect the existing Python artifact store (`packages/artifact_store`) to TypeScript via the ports/adapters pattern, enabling TypeScript handlers to query and publish Parquet artifacts.

---

## Deliverables

### 1. Artifact Store Port Interface

**File**: `packages/core/src/ports/artifact-store-port.ts`

**Purpose**: Define type-only interface for artifact store operations. Handlers depend on this port, not on specific implementations.

**Interface**:

```typescript
export interface ArtifactStorePort {
  getArtifact(artifactId: string): Promise<Artifact>;
  listArtifacts(filter: ArtifactFilter): Promise<Artifact[]>;
  findByLogicalKey(artifactType: string, logicalKey: string): Promise<Artifact[]>;
  publishArtifact(request: PublishArtifactRequest): Promise<PublishArtifactResult>;
  getLineage(artifactId: string): Promise<ArtifactLineage>;
  getDownstream(artifactId: string): Promise<Artifact[]>;
  supersede(newArtifactId: string, oldArtifactId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

**Types**:

```typescript
export interface Artifact {
  artifactId: string;
  artifactType: string;
  schemaVersion: number;
  logicalKey: string;
  status: 'active' | 'superseded' | 'tombstoned';
  pathParquet: string;
  pathSidecar: string;
  fileHash: string;
  contentHash: string;
  rowCount: number;
  minTs?: string;
  maxTs?: string;
  createdAt: string;
}

export interface ArtifactFilter {
  artifactType?: string;
  status?: 'active' | 'superseded' | 'tombstoned';
  tags?: Record<string, string>;
  minCreatedAt?: string;
  maxCreatedAt?: string;
  limit?: number;
}

export interface PublishArtifactRequest {
  artifactType: string;
  schemaVersion: number;
  logicalKey: string;
  dataPath: string;
  tags?: Record<string, string>;
  inputArtifactIds?: string[];
  writerName: string;
  writerVersion: string;
  gitCommit: string;
  gitDirty: boolean;
  params?: Record<string, unknown>;
  filenameHint?: string;
}

export interface PublishArtifactResult {
  success: boolean;
  deduped: boolean;
  mode?: 'file_hash' | 'content_hash';
  existingArtifactId?: string;
  artifactId?: string;
  pathParquet?: string;
  pathSidecar?: string;
  error?: string;
}

export interface ArtifactLineage {
  artifactId: string;
  inputs: Artifact[];
  depth: number;
}
```

---

### 2. Artifact Store Adapter

**File**: `packages/storage/src/adapters/artifact-store-adapter.ts`

**Purpose**: Implement `ArtifactStorePort` using `PythonEngine` to call Python artifact store.

**Pattern**: Same as existing adapters (`DuckDbSliceAnalyzerAdapter`, `CanonicalDuckDBAdapter`, etc.)

**Key Implementation Details**:

- Uses `PythonEngine.runScriptWithStdin()` for all Python calls
- Zod schemas validate all Python responses
- Error handling matches existing adapter patterns
- Lazy initialization via `CommandContext`

**Constructor**:

```typescript
constructor(
  manifestDb: string,          // /home/memez/opn/manifest/manifest.sqlite
  artifactsRoot: string,       // /home/memez/opn/artifacts
  pythonEngine?: PythonEngine  // Injected for testing
)
```

---

### 3. Python Wrapper Script

**File**: `tools/storage/artifact_store_ops.py`

**Purpose**: Provide JSON stdin/stdout interface for TypeScript integration via PythonEngine.

**Pattern**: Same as existing Python tools:

- `tools/storage/duckdb_run_events.py`
- `tools/storage/duckdb_canonical.py`
- `tools/storage/duckdb_artifacts.py`

**Operations**:

| Operation | Input | Output |
|-----------|-------|--------|
| `get_artifact` | `{ artifact_id }` | `Artifact` |
| `list_artifacts` | `{ filter }` | `Artifact[]` |
| `find_by_logical_key` | `{ artifact_type, logical_key }` | `Artifact[]` |
| `publish_artifact` | `PublishRequest` | `PublishResult` |
| `get_lineage` | `{ artifact_id }` | `ArtifactLineage` |
| `get_downstream` | `{ artifact_id }` | `Artifact[]` |
| `supersede` | `{ new_artifact_id, old_artifact_id }` | `{ success }` |
| `health_check` | `{ manifest_db }` | `{ available }` |

**Implementation Notes**:

- Convert SQLite row to camelCase keys for TypeScript
- Load CSV/Parquet files via pandas
- Call existing `publish_dataframe()` from artifact_store package
- Exit 0 on success with JSON to stdout
- Exit 1 on error with JSON to stderr

---

### 4. Command Context Integration

**File**: `packages/cli/src/core/command-context.ts`

**Purpose**: Add artifact store to lazy service factory for dependency injection.

**Implementation**:

```typescript
artifactStore(): ArtifactStorePort {
  if (!this._artifactStore) {
    const manifestDb = process.env.ARTIFACT_MANIFEST_DB || '/home/memez/opn/manifest/manifest.sqlite';
    const artifactsRoot = process.env.ARTIFACTS_ROOT || '/home/memez/opn/artifacts';
    this._artifactStore = new ArtifactStoreAdapter(manifestDb, artifactsRoot, this.pythonEngine());
  }
  return this._artifactStore;
}
```

---

### 5. Port Index Export

**File**: `packages/core/src/ports/index.ts`

**Purpose**: Export new port from core package.

**Change**: Add export for `artifact-store-port.ts`

---

### 6. Adapter Index Export

**File**: `packages/storage/src/adapters/index.ts`

**Purpose**: Export new adapter from storage package.

**Change**: Add export for `artifact-store-adapter.ts`

---

## Tasks

### Task 1.1: Create Port Interface

- [ ] Create `packages/core/src/ports/artifact-store-port.ts`
- [ ] Define `ArtifactStorePort` interface
- [ ] Define all supporting types (`Artifact`, `ArtifactFilter`, etc.)
- [ ] Add JSDoc documentation
- [ ] Export from `packages/core/src/ports/index.ts`

### Task 1.2: Create Python Wrapper

- [ ] Create `tools/storage/artifact_store_ops.py`
- [ ] Implement `get_artifact` operation
- [ ] Implement `list_artifacts` operation
- [ ] Implement `find_by_logical_key` operation
- [ ] Implement `publish_artifact` operation
- [ ] Implement `get_lineage` operation
- [ ] Implement `get_downstream` operation
- [ ] Implement `supersede` operation
- [ ] Implement `health_check` operation
- [ ] Add error handling (JSON to stderr)
- [ ] Test manually with JSON input

### Task 1.3: Create Adapter

- [ ] Create `packages/storage/src/adapters/artifact-store-adapter.ts`
- [ ] Implement `ArtifactStoreAdapter` class
- [ ] Add Zod schemas for validation
- [ ] Implement all port methods
- [ ] Add logging using `@quantbot/infra/utils`
- [ ] Add error handling (NotFoundError, AppError)
- [ ] Export from `packages/storage/src/adapters/index.ts`

### Task 1.4: Integrate with CommandContext

- [ ] Add `_artifactStore` field to CommandContext
- [ ] Add `artifactStore()` method
- [ ] Configure environment variables (ARTIFACT_MANIFEST_DB, ARTIFACTS_ROOT)

### Task 1.5: Write Unit Tests

- [ ] Create `packages/storage/tests/unit/adapters/artifact-store-adapter.test.ts`
- [ ] Test with mock PythonEngine
- [ ] Test successful operations
- [ ] Test error handling
- [ ] Test deduplication detection

### Task 1.6: Write Integration Tests

- [ ] Create `packages/storage/tests/integration/artifact-store-adapter.test.ts`
- [ ] Test with real Python script
- [ ] Test end-to-end publish flow
- [ ] Test deduplication
- [ ] Test lineage tracking

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/ports/artifact-store-port.ts` | Create | Port interface |
| `packages/core/src/ports/index.ts` | Modify | Export new port |
| `packages/storage/src/adapters/artifact-store-adapter.ts` | Create | Adapter implementation |
| `packages/storage/src/adapters/index.ts` | Modify | Export new adapter |
| `tools/storage/artifact_store_ops.py` | Create | Python wrapper |
| `packages/cli/src/core/command-context.ts` | Modify | Add service factory |
| `packages/storage/tests/unit/adapters/artifact-store-adapter.test.ts` | Create | Unit tests |
| `packages/storage/tests/integration/artifact-store-adapter.test.ts` | Create | Integration tests |

---

## Success Criteria

- [x] Port interface defined in `@quantbot/core`
- [x] Types are comprehensive and well-documented
- [x] Interface matches Python artifact store capabilities
- [x] Adapter implements `ArtifactStorePort`
- [x] Uses `PythonEngine` for Python calls
- [x] Follows existing adapter pattern
- [x] Error handling matches existing adapters
- [x] Python wrapper follows existing pattern
- [x] JSON stdin/stdout interface works
- [x] Comprehensive error handling
- [x] All operations implemented
- [x] Artifact store available via `ctx.services.artifactStore()`
- [x] Environment variables for configuration
- [x] Lazy initialization works
- [x] **No separate bridge package created**
- [x] Unit tests pass
- [x] Integration tests pass

---

## Testing Strategy

### Unit Tests

```typescript
describe('ArtifactStoreAdapter', () => {
  it('should get artifact by ID', async () => {
    const mockEngine = createMockPythonEngine({
      response: { artifactId: 'test-123', ... }
    });
    const adapter = new ArtifactStoreAdapter(manifestDb, artifactsRoot, mockEngine);
    
    const artifact = await adapter.getArtifact('test-123');
    
    expect(artifact.artifactId).toBe('test-123');
    expect(mockEngine.runScriptWithStdin).toHaveBeenCalledWith(
      expect.stringContaining('artifact_store_ops.py'),
      expect.objectContaining({ operation: 'get_artifact', artifact_id: 'test-123' }),
      expect.any(Object)
    );
  });

  it('should throw NotFoundError when artifact not found', async () => {
    const mockEngine = createMockPythonEngine({
      error: new Error('Artifact not found: invalid-id')
    });
    const adapter = new ArtifactStoreAdapter(manifestDb, artifactsRoot, mockEngine);
    
    await expect(adapter.getArtifact('invalid-id'))
      .rejects.toThrow(NotFoundError);
  });

  it('should detect deduplication', async () => {
    const mockEngine = createMockPythonEngine({
      response: { success: true, deduped: true, mode: 'content_hash', existingArtifactId: 'existing-123' }
    });
    const adapter = new ArtifactStoreAdapter(manifestDb, artifactsRoot, mockEngine);
    
    const result = await adapter.publishArtifact({ ... });
    
    expect(result.deduped).toBe(true);
    expect(result.existingArtifactId).toBe('existing-123');
  });
});
```

### Integration Tests

```typescript
describe('ArtifactStoreAdapter (integration)', () => {
  it('should publish and retrieve artifact', async () => {
    const adapter = new ArtifactStoreAdapter(testManifestDb, testArtifactsRoot);
    
    // Publish
    const publishResult = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/key',
      dataPath: '/tmp/test-data.csv',
      writerName: 'test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit',
      gitDirty: false,
    });
    
    expect(publishResult.success).toBe(true);
    expect(publishResult.artifactId).toBeDefined();
    
    // Retrieve
    const artifact = await adapter.getArtifact(publishResult.artifactId!);
    expect(artifact.logicalKey).toBe('test/key');
  });

  it('should dedupe identical artifacts', async () => {
    const adapter = new ArtifactStoreAdapter(testManifestDb, testArtifactsRoot);
    
    const result1 = await adapter.publishArtifact({ ... });
    const result2 = await adapter.publishArtifact({ ... }); // Same data
    
    expect(result1.deduped).toBe(false);
    expect(result2.deduped).toBe(true);
    expect(result2.existingArtifactId).toBe(result1.artifactId);
  });
});
```

---

## Environment Variables

```bash
# Add to .env or export in shell
export ARTIFACT_MANIFEST_DB="/home/memez/opn/manifest/manifest.sqlite"
export ARTIFACTS_ROOT="/home/memez/opn/artifacts"

# Python environment (if needed)
export PYTHONPATH="/home/memez/backups/quantBot/packages/artifact_store:$PYTHONPATH"
```

---

## Dependencies

### TypeScript

- `@quantbot/core` (for port definition)
- `@quantbot/utils` (for PythonEngine)
- `@quantbot/infra/utils` (for logger, findWorkspaceRoot)
- `zod` (for schema validation)

### Python

- `artifact_store` (existing package)
- `pandas` (for DataFrame operations)
- `sqlite3` (for manifest queries)

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Python environment issues | Medium | High | Test in CI with same Python version |
| PythonEngine subprocess errors | Low | Medium | Comprehensive error handling |
| Schema validation failures | Medium | Medium | Extensive Zod schemas |
| Manifest corruption | Low | High | SQLite WAL mode, regular backups |

---

## Acceptance Checklist

- [x] All deliverables created
- [x] All tasks completed
- [x] All success criteria met
- [x] Unit tests pass (10 tests)
- [x] Integration tests pass (8 tests)
- [x] Code review completed
- [x] Documentation updated
- [x] Build succeeds
- [x] **Phase II can begin**

---

## ✅ PHASE I COMPLETE (2026-01-28)

**Deliverables Summary**:
- Port interface: 240 lines
- Adapter: 243 lines
- Python wrapper: 294 lines
- Unit tests: 319 lines (10 tests)
- Integration tests: 235 lines (8 tests)
- Total: ~1,400 lines of code

**Next Phase**: Phase II - Projection Builder

---

## Next Phase

After Phase I is complete, Phase II (Projection Builder) and Phase III (Experiment Tracking) can begin in parallel, as they both depend on the artifact store.
