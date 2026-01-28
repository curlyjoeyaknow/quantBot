# Phase II: Projection Builder

## Overview

| Attribute | Value |
|-----------|-------|
| **Phase** | II |
| **Duration** | Week 2-3 |
| **Dependencies** | Phase I (Artifact Store Integration) |
| **Status** | 🔲 Pending |
| **Critical Path** | Yes |

---

## Objective

Build DuckDB projections from Parquet artifacts on-demand. Projections are disposable, rebuildable, query-optimized views of the immutable Parquet truth layer.

---

## Deliverables

### 1. Projection Builder Port Interface

**File**: `packages/core/src/ports/projection-builder-port.ts`

**Purpose**: Define type-only interface for building DuckDB projections from Parquet artifacts.

**Interface**:

```typescript
export interface ProjectionBuilderPort {
  buildProjection(request: ProjectionRequest): Promise<ProjectionResult>;
  rebuildProjection(projectionId: string): Promise<void>;
  disposeProjection(projectionId: string): Promise<void>;
  projectionExists(projectionId: string): Promise<boolean>;
}

export interface ProjectionRequest {
  projectionId: string;
  artifacts: {
    alerts?: string[];    // Alert artifact IDs
    ohlcv?: string[];     // OHLCV artifact IDs
  };
  tables: {
    alerts?: string;      // Table name for alerts
    ohlcv?: string;       // Table name for OHLCV
  };
  cacheDir?: string;
  indexes?: ProjectionIndex[];
}

export interface ProjectionIndex {
  table: string;
  columns: string[];
}

export interface ProjectionResult {
  projectionId: string;
  duckdbPath: string;
  tables: ProjectionTable[];
  artifactCount: number;
  totalRows: number;
}

export interface ProjectionTable {
  name: string;
  rowCount: number;
  columns: string[];
  indexes: string[];
}
```

---

### 2. Projection Builder Adapter

**File**: `packages/storage/src/adapters/projection-builder-adapter.ts`

**Purpose**: Implement `ProjectionBuilderPort` using DuckDB to create tables from Parquet files.

**Key Features**:
- Uses DuckDB's `read_parquet()` to create tables
- Creates indexes for query optimization
- Manages cache directory
- Supports disposal and rebuild

**Constructor**:

```typescript
constructor(
  artifactStore: ArtifactStorePort,  // To get artifact metadata
  cacheDir: string = '/home/memez/opn/cache'
)
```

**Implementation Approach**:

```typescript
async buildProjection(request: ProjectionRequest): Promise<ProjectionResult> {
  // 1. Ensure cache directory exists
  mkdirSync(cacheDir, { recursive: true });
  
  // 2. Create DuckDB file
  const duckdbPath = join(cacheDir, `${projectionId}.duckdb`);
  const client = new DuckDBClient(duckdbPath);
  
  // 3. For each artifact type, get Parquet paths and create table
  for (const artifactId of artifacts.alerts) {
    const artifact = await artifactStore.getArtifact(artifactId);
    parquetPaths.push(artifact.pathParquet);
  }
  
  // 4. Create table from Parquet files
  await client.execute(`
    CREATE TABLE alerts AS
    SELECT * FROM read_parquet([${paths}])
  `);
  
  // 5. Create indexes
  await client.execute(`CREATE INDEX idx_alerts_ts ON alerts(alert_ts_utc, mint)`);
  
  // 6. Return metadata
  return { projectionId, duckdbPath, tables, artifactCount, totalRows };
}
```

---

### 3. DuckDB Client (if not exists)

**File**: `packages/storage/src/duckdb/duckdb-client.ts`

**Purpose**: Wrapper around DuckDB for executing queries.

**Interface**:

```typescript
export class DuckDBClient {
  constructor(dbPath: string);
  execute(sql: string): Promise<any[]>;
  close(): Promise<void>;
}
```

---

### 4. Command Context Integration

**File**: `packages/cli/src/core/command-context.ts`

**Purpose**: Add projection builder to service factory.

**Implementation**:

```typescript
projectionBuilder(): ProjectionBuilderPort {
  if (!this._projectionBuilder) {
    const artifactStore = this.artifactStore();
    const cacheDir = process.env.PROJECTION_CACHE_DIR || '/home/memez/opn/cache';
    this._projectionBuilder = new ProjectionBuilderAdapter(artifactStore, cacheDir);
  }
  return this._projectionBuilder;
}
```

---

## Tasks

### Task 2.1: Create Port Interface
- [ ] Create `packages/core/src/ports/projection-builder-port.ts`
- [ ] Define `ProjectionBuilderPort` interface
- [ ] Define supporting types (`ProjectionRequest`, `ProjectionResult`, etc.)
- [ ] Add JSDoc documentation
- [ ] Export from `packages/core/src/ports/index.ts`

### Task 2.2: Verify/Create DuckDB Client
- [ ] Check if `DuckDBClient` exists in codebase
- [ ] If not, create `packages/storage/src/duckdb/duckdb-client.ts`
- [ ] Implement basic execute/close methods
- [ ] Add error handling

### Task 2.3: Create Adapter
- [ ] Create `packages/storage/src/adapters/projection-builder-adapter.ts`
- [ ] Implement `buildProjection()` method
- [ ] Implement `disposeProjection()` method
- [ ] Implement `projectionExists()` method
- [ ] Implement `rebuildProjection()` method
- [ ] Add logging
- [ ] Export from index

### Task 2.4: Integrate with CommandContext
- [ ] Add `_projectionBuilder` field
- [ ] Add `projectionBuilder()` method
- [ ] Configure environment variable (PROJECTION_CACHE_DIR)

### Task 2.5: Write Unit Tests
- [ ] Create test file
- [ ] Test with mock artifact store
- [ ] Test table creation
- [ ] Test index creation
- [ ] Test disposal

### Task 2.6: Write Integration Tests
- [ ] Create integration test file
- [ ] Test with real Parquet files
- [ ] Test rebuild mechanism
- [ ] Verify DuckDB matches Parquet data

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/ports/projection-builder-port.ts` | Create | Port interface |
| `packages/core/src/ports/index.ts` | Modify | Export new port |
| `packages/storage/src/duckdb/duckdb-client.ts` | Create/Verify | DuckDB wrapper |
| `packages/storage/src/adapters/projection-builder-adapter.ts` | Create | Adapter implementation |
| `packages/storage/src/adapters/index.ts` | Modify | Export new adapter |
| `packages/cli/src/core/command-context.ts` | Modify | Add service factory |
| `packages/storage/tests/unit/adapters/projection-builder-adapter.test.ts` | Create | Unit tests |
| `packages/storage/tests/integration/projection-builder-adapter.test.ts` | Create | Integration tests |

---

## Success Criteria

- [ ] Port interface defined
- [ ] Comprehensive types
- [ ] Supports multiple artifact types
- [ ] DuckDB projections built from Parquet
- [ ] Creates indexes for query optimization
- [ ] Disposable and rebuildable
- [ ] Follows adapter pattern
- [ ] Unit tests pass
- [ ] Integration tests pass

---

## Testing Strategy

### Unit Tests

```typescript
describe('ProjectionBuilderAdapter', () => {
  it('should build projection from artifacts', async () => {
    const mockArtifactStore = createMockArtifactStore([
      { artifactId: 'alert-1', pathParquet: '/path/to/alert1.parquet' },
      { artifactId: 'ohlcv-1', pathParquet: '/path/to/ohlcv1.parquet' },
    ]);
    const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
    
    const result = await adapter.buildProjection({
      projectionId: 'test-projection',
      artifacts: { alerts: ['alert-1'], ohlcv: ['ohlcv-1'] },
      tables: { alerts: 'alerts', ohlcv: 'ohlcv' },
    });
    
    expect(result.projectionId).toBe('test-projection');
    expect(result.tables).toHaveLength(2);
    expect(existsSync(result.duckdbPath)).toBe(true);
  });

  it('should dispose projection', async () => {
    const adapter = new ProjectionBuilderAdapter(mockArtifactStore, tempCacheDir);
    await adapter.buildProjection({ projectionId: 'to-delete', ... });
    
    await adapter.disposeProjection('to-delete');
    
    expect(await adapter.projectionExists('to-delete')).toBe(false);
  });
});
```

### Integration Tests

```typescript
describe('ProjectionBuilderAdapter (integration)', () => {
  it('should build projection with correct data', async () => {
    const adapter = new ProjectionBuilderAdapter(realArtifactStore, tempCacheDir);
    
    const result = await adapter.buildProjection({
      projectionId: 'integration-test',
      artifacts: { alerts: [realAlertArtifactId] },
      tables: { alerts: 'alerts' },
      indexes: [{ table: 'alerts', columns: ['alert_ts_utc'] }],
    });
    
    // Verify data matches
    const client = new DuckDBClient(result.duckdbPath);
    const rows = await client.execute('SELECT COUNT(*) as cnt FROM alerts');
    expect(rows[0].cnt).toBeGreaterThan(0);
    
    // Verify index exists
    const indexes = await client.execute("SELECT * FROM duckdb_indexes()");
    expect(indexes.some(i => i.index_name === 'idx_alerts_alert_ts_utc')).toBe(true);
  });
});
```

---

## Performance Considerations

### DuckDB Parallel Read

DuckDB can read multiple Parquet files in parallel:

```sql
CREATE TABLE ohlcv AS
SELECT * FROM read_parquet([
  '/path/to/slice1.parquet',
  '/path/to/slice2.parquet',
  -- ... up to thousands of files
]);
```

**Benchmark**: 3,641 OHLCV artifacts → DuckDB table in ~30 seconds

### Index Strategy

Create indexes for common query patterns:

```sql
-- Alerts: filter by time and token
CREATE INDEX idx_alerts_ts_mint ON alerts(alert_ts_utc, mint);

-- OHLCV: filter by time and token
CREATE INDEX idx_ohlcv_ts_token ON ohlcv(timestamp, token_address);
```

---

## Environment Variables

```bash
export PROJECTION_CACHE_DIR="/home/memez/opn/cache"
```

---

## Dependencies

### TypeScript
- `@quantbot/core` (for ports)
- `@quantbot/storage` (for DuckDBClient)
- `duckdb` (DuckDB Node.js bindings)

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| DuckDB native binding issues | Medium | High | Pin Node.js version, test in CI |
| Large projection build time | Medium | Medium | Use parallel read_parquet |
| Disk space for projections | Low | Medium | Dispose after use, monitor cache dir |

---

## Acceptance Checklist

- [ ] All deliverables created
- [ ] All tasks completed
- [ ] All success criteria met
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Code review completed
- [ ] Build succeeds
- [ ] Phase IV can use projections

---

## Next Phase

After Phase II is complete, Phase IV (Experiment Execution) can begin once Phase III (Experiment Tracking) is also complete. Phases II and III can run in parallel.

