# PRD: QuantBot Research Package - Integration Plan

## Executive Summary

This document defines the integration plan for the **QuantBot Research Package**, which formalizes the Parquet-first, DuckDB-as-projection architecture using the existing `/home/memez/opn` data lake and `packages/artifact_store` infrastructure.

**Key Finding**: The foundational infrastructure already exists and is production-ready:
- ✅ Artifact store with SQLite manifest (`packages/artifact_store`)
- ✅ Data lake structure (`/home/memez/opn`)
- ✅ Content-addressable Parquet artifacts with deduplication
- ✅ Lineage tracking and provenance
- ✅ Deterministic content hashing

**What's Needed**: Integration layer to connect this infrastructure to the research workflows defined in the Research Lab Roadmap PRD.

---

## Introduction

### Context

The QuantBot project has established a robust data lake architecture:

**Existing Infrastructure:**
- **Artifact Store** (`packages/artifact_store`): Python package for immutable Parquet artifact publishing with SQLite manifest
- **Data Lake** (`/home/memez/opn`): Structured storage with artifacts, cache, coverage, staging, and verification directories
- **Manifest System**: SQLite-based artifact registry with content hashing, lineage, and tags

**Problem**: This infrastructure exists but is not yet integrated into the research workflows. Experiments still depend on mutable DuckDB tables rather than immutable Parquet artifacts.

### Goals

1. **Integrate** artifact store into research workflows
2. **Enforce** Parquet-first invariants at the workflow level
3. **Enable** experiment tracking with artifact lineage
4. **Make** DuckDB fully disposable and rebuildable
5. **Provide** TypeScript/Node.js bridge to Python artifact store

---

## Architecture Overview

### Current State (Existing Infrastructure)

```
/home/memez/opn/
├── artifacts/                    # Immutable Parquet truth
│   ├── alerts_v1/v1/            # Canonical alert artifacts
│   ├── ohlcv_slice_v2/v2/       # OHLCV slice artifacts
│   └── _quarantine/             # Invalid/rejected artifacts
├── cache/                        # Disposable DuckDB projections
│   ├── ohlcv_cache.duckdb       # Query-optimized OHLCV view
│   └── ohlcv_v2_dataset/        # Bucketed OHLCV partitions
├── coverage/                     # Coverage analysis artifacts
│   └── ohlcv_v2/                # Alert forward coverage
├── data/                         # Legacy DuckDB (to be deprecated)
│   └── alerts.duckdb            # Mutable alerts DB (superseded)
├── manifest/                     # Artifact registry
│   └── manifest.sqlite          # SQLite manifest (truth ledger)
├── staging/                      # Temporary ingestion staging
│   └── alerts_v1_shards/        # Alert shards before publishing
└── verify/                       # Verification scripts
    └── *.py                     # Data quality checks
```

**Artifact Store Package:**
```
packages/artifact_store/
├── artifact_store/
│   ├── manifest.py              # SQLite manifest operations
│   ├── spec.py                  # Artifact type specifications
│   ├── publisher.py             # Parquet publishing with dedup
│   ├── hashing.py               # Content hashing
│   └── bin/
│       └── artifacts_cli.py     # CLI for artifact operations
├── pyproject.toml               # Python package config
└── manifest.sqlite              # Local manifest (dev)
```

### Target State (Research Package Integration)

```
Research Workflows
       ↓
TypeScript/Node.js Bridge
       ↓
Python Artifact Store
       ↓
Parquet Artifacts (Truth)
       ↓
DuckDB Projections (Cache)
```

**Flow:**
1. Research workflow requests data (alerts + OHLCV)
2. TypeScript bridge calls Python artifact store
3. Artifact store returns registered Parquet artifacts
4. DuckDB projection built on-demand from Parquet
5. Experiment executes with frozen artifact set
6. Results published as new Parquet artifacts
7. Lineage tracked in manifest

---

## Existing Infrastructure Analysis

### Artifact Store Package (Python)

**Status**: ✅ Production-ready

**Capabilities:**
- Immutable Parquet artifact publishing
- SQLite manifest with schema versioning
- Content-addressable storage (file hash + content hash)
- Automatic deduplication (file-level and semantic)
- Lineage tracking (input artifacts)
- Tag-based metadata
- Deterministic content hashing with canonical column ordering
- Sidecar JSON metadata

**Artifact Types Defined:**
- `alerts_v1`: Canonical alert events
- `alerts`: Generic alert schema
- `ohlcv_slice`: OHLCV candle slices
- `run_metrics`: Experiment metrics

**Key Functions:**
```python
# Publisher API
publish_dataframe(
    manifest_db: Path,
    artifacts_root: Path,
    artifact_type: str,
    schema_version: int,
    logical_key: str,
    df: DataFrame,
    tags: List[Tuple[str, str]],
    input_artifact_ids: List[str],
    writer_name: str,
    writer_version: str,
    git_commit: str,
    git_dirty: bool,
    params: Dict[str, Any]
) -> Dict[str, Any]

# Manifest API
artifact_exists_by_file_hash(con, file_hash) -> Optional[str]
artifact_exists_by_semantic_key(con, artifact_type, logical_key, content_hash) -> Optional[str]
insert_artifact(con, artifact_id, ...)
insert_tags(con, artifact_id, tags)
insert_lineage(con, artifact_id, inputs)
supersede(con, new_artifact_id, old_artifact_id)
```

**Deduplication Strategy:**
1. **File-level**: SHA256 of Parquet bytes (exact duplicate detection)
2. **Semantic**: Content hash of canonical columns in deterministic order (logical duplicate detection)

**Content Hashing:**
- Reads Parquet with deterministic column selection and ordering
- Applies type casts for normalization (timestamps → ISO8601 UTC)
- Computes SHA256 of delimited row stream
- Returns: `(content_hash, row_count, min_ts, max_ts)`

### Data Lake Structure (`/home/memez/opn`)

**Status**: ✅ Active and populated

**Artifacts:**
- **Alerts**: `artifacts/alerts_v1/v1/` (canonical alert Parquet files)
- **OHLCV**: `artifacts/ohlcv_slice_v2/v2/` (candle slice Parquet files)
- **Quarantine**: `artifacts/_quarantine*/` (rejected/invalid artifacts)

**Cache:**
- **OHLCV Cache**: `cache/ohlcv_cache.duckdb` (query-optimized projection)
- **Bucketed Dataset**: `cache/ohlcv_v2_dataset/bucket=N/month=YYYY-MM/` (partitioned OHLCV)

**Coverage:**
- **Alert Coverage**: `coverage/ohlcv_v2/alert_forward_coverage.parquet`
- **Coverage Gaps**: `coverage/ohlcv_v2/coverage_gaps.parquet`
- **Coverage Summary**: `coverage/ohlcv_v2/coverage_summary.parquet`

**Manifest:**
- **SQLite Manifest**: `manifest/manifest.sqlite` (artifact registry)

**Verification Scripts:**
- `verify/audit_artifacts.py`: Audit artifact integrity
- `verify/build_alert_forward_coverage.py`: Compute alert coverage
- `verify/rebuild_cache_duckdb.py`: Rebuild DuckDB from Parquet

### Manifest Schema (SQLite)

**Tables:**

```sql
-- Artifact registry
artifacts (
  artifact_id TEXT PRIMARY KEY,
  artifact_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  logical_key TEXT NOT NULL,
  status TEXT NOT NULL,  -- active | superseded | tombstoned
  path_parquet TEXT NOT NULL,
  path_sidecar TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  min_ts TEXT,
  max_ts TEXT,
  created_at TEXT NOT NULL
)

-- Lineage tracking
artifact_lineage (
  artifact_id TEXT NOT NULL,
  input_artifact_id TEXT NOT NULL,
  PRIMARY KEY (artifact_id, input_artifact_id)
)

-- Tag-based metadata
artifact_tags (
  artifact_id TEXT NOT NULL,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  PRIMARY KEY (artifact_id, k, v)
)

-- Supersession tracking
artifact_supersedes (
  artifact_id TEXT NOT NULL PRIMARY KEY,
  supersedes_artifact_id TEXT NOT NULL
)
```

**Indexes:**
- `idx_artifacts_type_key` on `(artifact_type, logical_key)`
- `idx_artifacts_content_hash` on `(content_hash)`
- `idx_artifacts_type_key_content` on `(artifact_type, logical_key, content_hash)`

---

## Integration Requirements

### FR-1: TypeScript/Node.js Bridge to Artifact Store

**Description**: Create TypeScript package that bridges to Python artifact store

**Requirements:**

- TypeScript package: `@quantbot/artifact-store`
- Wraps Python artifact store via subprocess or Python bridge
- Provides typed interfaces for artifact operations
- Handles path resolution (`/home/memez/opn`)
- Manages Python environment activation

**API:**

```typescript
// Artifact Store Client
interface ArtifactStoreClient {
  // Query artifacts
  getArtifact(artifactId: string): Promise<Artifact>;
  listArtifacts(filter: ArtifactFilter): Promise<Artifact[]>;
  findByLogicalKey(artifactType: string, logicalKey: string): Promise<Artifact[]>;
  
  // Publish artifacts
  publishDataFrame(request: PublishRequest): Promise<PublishResult>;
  
  // Lineage
  getLineage(artifactId: string): Promise<ArtifactLineage>;
  getDownstream(artifactId: string): Promise<Artifact[]>;
  
  // Manifest operations
  supersede(newArtifactId: string, oldArtifactId: string): Promise<void>;
}

// Types
interface Artifact {
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

interface PublishRequest {
  artifactType: string;
  schemaVersion: number;
  logicalKey: string;
  dataFrame: DataFrame | string; // DataFrame or CSV path
  tags?: Record<string, string>;
  inputArtifactIds?: string[];
  writerName: string;
  writerVersion: string;
  gitCommit: string;
  gitDirty: boolean;
  params?: Record<string, unknown>;
}

interface PublishResult {
  deduped: boolean;
  mode?: 'file_hash' | 'content_hash';
  existingArtifactId?: string;
  artifactId?: string;
  sidecar?: Record<string, unknown>;
}
```

**Implementation:**

```typescript
// packages/artifact-store-bridge/src/client.ts
import { spawn } from 'child_process';
import { join } from 'path';

export class ArtifactStoreClient {
  constructor(
    private readonly manifestDb: string,
    private readonly artifactsRoot: string,
    private readonly pythonEnv?: string
  ) {}

  async publishDataFrame(request: PublishRequest): Promise<PublishResult> {
    // Call Python artifact store via subprocess
    const result = await this.callPython('publish', request);
    return result;
  }

  private async callPython(command: string, args: unknown): Promise<unknown> {
    // Spawn Python process with artifact_store module
    // Parse JSON output
    // Return typed result
  }
}
```

**Files:**
- `packages/artifact-store-bridge/src/client.ts` (new)
- `packages/artifact-store-bridge/src/types.ts` (new)
- `packages/artifact-store-bridge/src/python-bridge.ts` (new)
- `packages/artifact-store-bridge/package.json` (new)

**Success Criteria:**
- TypeScript can query artifacts from manifest
- TypeScript can publish new artifacts
- Deduplication works correctly
- Lineage is tracked

---

### FR-2: Experiment Artifact Integration

**Description**: Integrate artifact store into experiment workflows

**Requirements:**

- Experiments declare input artifacts (alerts + OHLCV)
- Experiment execution freezes artifact versions
- Experiment outputs published as new artifacts
- Lineage tracked: experiment results → input artifacts
- Experiment metadata includes artifact IDs

**Experiment Definition:**

```typescript
interface ExperimentDefinition {
  experimentId: string;
  name: string;
  description?: string;
  
  // Input artifacts (frozen)
  inputs: {
    alerts: string[];        // Alert artifact IDs
    ohlcv: string[];         // OHLCV artifact IDs
    strategies?: string[];   // Strategy artifact IDs
  };
  
  // Configuration
  config: {
    strategy: StrategyConfig;
    dateRange: DateRange;
    params: Record<string, unknown>;
  };
  
  // Provenance
  provenance: {
    gitCommit: string;
    gitDirty: boolean;
    engineVersion: string;
    createdAt: string;
  };
}

interface ExperimentResult {
  experimentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  
  // Output artifacts
  outputs: {
    trades?: string;         // Trade artifact ID
    metrics?: string;        // Metrics artifact ID
    curves?: string;         // Equity curve artifact ID
    diagnostics?: string;    // Diagnostics artifact ID
  };
  
  // Execution metadata
  execution: {
    startedAt: string;
    completedAt?: string;
    duration?: number;
    error?: string;
  };
}
```

**Workflow:**

```typescript
// 1. Define experiment with input artifacts
const experiment: ExperimentDefinition = {
  experimentId: generateExperimentId(),
  name: 'momentum-strategy-v1',
  inputs: {
    alerts: ['artifact-id-1', 'artifact-id-2'],
    ohlcv: ['artifact-id-3', 'artifact-id-4'],
  },
  config: { /* ... */ },
  provenance: { /* ... */ },
};

// 2. Validate artifact availability
await validateArtifacts(experiment.inputs);

// 3. Build DuckDB projection from artifacts
const duckdb = await buildProjection(experiment.inputs);

// 4. Execute experiment
const result = await executeExperiment(experiment, duckdb);

// 5. Publish outputs as artifacts
const tradesArtifact = await artifactStore.publishDataFrame({
  artifactType: 'experiment_trades',
  schemaVersion: 1,
  logicalKey: `experiment=${experiment.experimentId}/trades`,
  dataFrame: result.trades,
  inputArtifactIds: [...experiment.inputs.alerts, ...experiment.inputs.ohlcv],
  writerName: 'experiment-engine',
  writerVersion: '1.0.0',
  gitCommit: experiment.provenance.gitCommit,
  gitDirty: experiment.provenance.gitDirty,
  params: experiment.config,
});

// 6. Store experiment result
await storeExperimentResult({
  ...experiment,
  outputs: {
    trades: tradesArtifact.artifactId,
  },
});
```

**Files:**
- `packages/workflows/src/experiments/artifact-integration.ts` (new)
- `packages/workflows/src/experiments/experiment-executor.ts` (extend)
- `packages/workflows/src/experiments/projection-builder.ts` (new)

**Success Criteria:**
- Experiments declare input artifacts
- Artifact versions frozen at experiment start
- Outputs published as artifacts
- Lineage tracked correctly

---

### FR-3: DuckDB Projection Builder

**Description**: Build DuckDB projections from Parquet artifacts on-demand

**Requirements:**

- Query manifest for artifact set
- Build DuckDB tables from Parquet files
- Enforce read-only access (no mutations)
- Support incremental updates
- Cache projections for reuse
- Provide rebuild mechanism

**API:**

```typescript
interface ProjectionBuilder {
  // Build projection from artifact set
  buildProjection(request: ProjectionRequest): Promise<ProjectionResult>;
  
  // Rebuild projection (discard cache)
  rebuildProjection(projectionId: string): Promise<void>;
  
  // Query projection
  query(projectionId: string, sql: string): Promise<QueryResult>;
  
  // Dispose projection
  disposeProjection(projectionId: string): Promise<void>;
}

interface ProjectionRequest {
  projectionId: string;
  artifacts: {
    alerts?: string[];       // Alert artifact IDs
    ohlcv?: string[];        // OHLCV artifact IDs
  };
  tables: {
    alerts?: string;         // Table name
    ohlcv?: string;          // Table name
  };
  cacheDir?: string;
}

interface ProjectionResult {
  projectionId: string;
  duckdbPath: string;
  tables: string[];
  artifactCount: number;
  rowCount: Record<string, number>;
}
```

**Implementation:**

```typescript
// packages/storage/src/projections/projection-builder.ts
export class ProjectionBuilder {
  async buildProjection(request: ProjectionRequest): Promise<ProjectionResult> {
    // 1. Query manifest for artifact metadata
    const artifacts = await this.getArtifacts(request.artifacts);
    
    // 2. Create DuckDB database
    const duckdb = await this.createDuckDB(request.projectionId);
    
    // 3. Create tables from Parquet files
    for (const [table, artifactIds] of Object.entries(request.artifacts)) {
      const parquetPaths = artifacts
        .filter(a => artifactIds.includes(a.artifactId))
        .map(a => a.pathParquet);
      
      await this.createTableFromParquet(duckdb, table, parquetPaths);
    }
    
    // 4. Return projection metadata
    return {
      projectionId: request.projectionId,
      duckdbPath: duckdb.path,
      tables: Object.keys(request.tables),
      artifactCount: artifacts.length,
      rowCount: await this.getRowCounts(duckdb),
    };
  }
  
  private async createTableFromParquet(
    duckdb: DuckDB,
    tableName: string,
    parquetPaths: string[]
  ): Promise<void> {
    // Use DuckDB's read_parquet to create view/table
    const paths = parquetPaths.map(p => `'${p}'`).join(', ');
    await duckdb.execute(`
      CREATE TABLE ${tableName} AS
      SELECT * FROM read_parquet([${paths}])
      ORDER BY /* deterministic ordering */;
    `);
  }
}
```

**Files:**
- `packages/storage/src/projections/projection-builder.ts` (new)
- `packages/storage/src/projections/projection-cache.ts` (new)
- `packages/storage/src/projections/index.ts` (new)

**Success Criteria:**
- DuckDB projections built from Parquet
- Projections are deterministic
- Projections are rebuildable
- Cache management works

---

### FR-4: Alert Ingestion Pipeline Integration

**Description**: Integrate alert ingestion with artifact store

**Requirements:**

- Telegram exports → staging → canonical Parquet
- Deduplication at artifact level (not DuckDB)
- Publish canonical alerts as artifacts
- Track ingestion provenance
- Quarantine invalid alerts

**Pipeline:**

```
Telegram Export (JSON)
       ↓
Staging (alerts_v1_shards/)
       ↓
Normalization & Validation
       ↓
Canonical Parquet (alerts_v1)
       ↓
Artifact Store (publish)
       ↓
Manifest (register)
       ↓
DuckDB Projection (optional)
```

**Implementation:**

```typescript
// packages/ingestion/src/alerts/artifact-pipeline.ts
export class AlertArtifactPipeline {
  async ingestTelegramExport(exportPath: string): Promise<IngestResult> {
    // 1. Load Telegram export
    const rawAlerts = await this.loadTelegramExport(exportPath);
    
    // 2. Normalize to canonical schema
    const canonical = await this.normalizeAlerts(rawAlerts);
    
    // 3. Validate alerts
    const { valid, invalid } = await this.validateAlerts(canonical);
    
    // 4. Quarantine invalid alerts
    if (invalid.length > 0) {
      await this.quarantineAlerts(invalid);
    }
    
    // 5. Publish valid alerts as artifact
    const artifact = await this.artifactStore.publishDataFrame({
      artifactType: 'alerts_v1',
      schemaVersion: 1,
      logicalKey: `source=telegram/export=${exportPath}/date=${date}`,
      dataFrame: valid,
      tags: {
        source: 'telegram',
        export_path: exportPath,
      },
      writerName: 'telegram-ingestion',
      writerVersion: '1.0.0',
      gitCommit: await getGitCommit(),
      gitDirty: await isGitDirty(),
      params: { exportPath },
    });
    
    return {
      artifactId: artifact.artifactId,
      validCount: valid.length,
      invalidCount: invalid.length,
      deduped: artifact.deduped,
    };
  }
}
```

**Files:**
- `packages/ingestion/src/alerts/artifact-pipeline.ts` (new)
- `packages/ingestion/src/alerts/normalization.ts` (extend)
- `packages/ingestion/src/alerts/validation.ts` (extend)

**Success Criteria:**
- Alerts ingested as artifacts
- Deduplication works at artifact level
- Invalid alerts quarantined
- Provenance tracked

---

### FR-5: OHLCV Slice Artifact Integration

**Description**: Integrate OHLCV slice export with artifact store

**Requirements:**

- ClickHouse → Parquet slices
- Publish slices as artifacts
- Track coverage metadata
- Enable slice reuse across experiments

**Pipeline:**

```
ClickHouse (OHLCV tables)
       ↓
Slice Export (token + date range)
       ↓
Parquet Slice
       ↓
Artifact Store (publish)
       ↓
Manifest (register)
       ↓
Coverage Analysis
       ↓
DuckDB Projection (optional)
```

**Implementation:**

```typescript
// packages/ohlcv/src/slices/artifact-exporter.ts
export class OhlcvSliceArtifactExporter {
  async exportSlice(request: SliceRequest): Promise<SliceResult> {
    // 1. Query ClickHouse for candles
    const candles = await this.clickhouse.getCandles(request);
    
    // 2. Validate coverage
    const coverage = await this.validateCoverage(candles, request);
    
    // 3. Publish as artifact
    const artifact = await this.artifactStore.publishDataFrame({
      artifactType: 'ohlcv_slice',
      schemaVersion: 2,
      logicalKey: `token=${request.token}/res=${request.resolution}/from=${request.from}/to=${request.to}`,
      dataFrame: candles,
      tags: {
        token: request.token,
        resolution: request.resolution,
        chain: request.chain,
      },
      writerName: 'ohlcv-slice-exporter',
      writerVersion: '2.0.0',
      gitCommit: await getGitCommit(),
      gitDirty: await isGitDirty(),
      params: request,
    });
    
    return {
      artifactId: artifact.artifactId,
      rowCount: candles.length,
      coverage: coverage,
      deduped: artifact.deduped,
    };
  }
}
```

**Files:**
- `packages/ohlcv/src/slices/artifact-exporter.ts` (new)
- `packages/ohlcv/src/slices/coverage-validator.ts` (new)

**Success Criteria:**
- OHLCV slices published as artifacts
- Coverage tracked
- Slices reusable across experiments

---

### FR-6: Experiment Result Artifacts

**Description**: Publish experiment results as first-class artifacts

**Requirements:**

- Trade-level results → Parquet artifact
- Metrics → Parquet artifact
- Equity curves → Parquet artifact
- Diagnostics → Parquet artifact
- Lineage: results → input artifacts

**Artifact Types:**

```typescript
// Experiment trades
interface ExperimentTradesArtifact {
  artifact_type: 'experiment_trades';
  schema_version: 1;
  logical_key: `experiment=${experimentId}/trades`;
  columns: [
    'experiment_id',
    'alert_id',
    'trade_id',
    'entry_ts',
    'exit_ts',
    'entry_price',
    'exit_price',
    'pnl',
    'pnl_pct',
    'duration_ms',
  ];
}

// Experiment metrics
interface ExperimentMetricsArtifact {
  artifact_type: 'experiment_metrics';
  schema_version: 1;
  logical_key: `experiment=${experimentId}/metrics`;
  columns: [
    'experiment_id',
    'metric_name',
    'metric_value',
    'metric_unit',
    'computed_at',
  ];
}

// Experiment equity curve
interface ExperimentEquityCurveArtifact {
  artifact_type: 'experiment_equity_curve';
  schema_version: 1;
  logical_key: `experiment=${experimentId}/equity`;
  columns: [
    'experiment_id',
    'ts',
    'equity',
    'drawdown',
    'drawdown_pct',
  ];
}
```

**Implementation:**

```typescript
// packages/workflows/src/experiments/result-publisher.ts
export class ExperimentResultPublisher {
  async publishResults(
    experiment: ExperimentDefinition,
    results: ExperimentResults
  ): Promise<PublishedResults> {
    // Publish trades
    const tradesArtifact = await this.publishTrades(experiment, results.trades);
    
    // Publish metrics
    const metricsArtifact = await this.publishMetrics(experiment, results.metrics);
    
    // Publish equity curve
    const equityArtifact = await this.publishEquityCurve(experiment, results.equity);
    
    return {
      trades: tradesArtifact.artifactId,
      metrics: metricsArtifact.artifactId,
      equity: equityArtifact.artifactId,
    };
  }
  
  private async publishTrades(
    experiment: ExperimentDefinition,
    trades: Trade[]
  ): Promise<PublishResult> {
    return await this.artifactStore.publishDataFrame({
      artifactType: 'experiment_trades',
      schemaVersion: 1,
      logicalKey: `experiment=${experiment.experimentId}/trades`,
      dataFrame: trades,
      inputArtifactIds: [
        ...experiment.inputs.alerts,
        ...experiment.inputs.ohlcv,
      ],
      writerName: 'experiment-engine',
      writerVersion: '1.0.0',
      gitCommit: experiment.provenance.gitCommit,
      gitDirty: experiment.provenance.gitDirty,
      params: experiment.config,
    });
  }
}
```

**Files:**
- `packages/workflows/src/experiments/result-publisher.ts` (new)
- `packages/artifact-store/artifact_store/spec.py` (extend with new artifact types)

**Success Criteria:**
- Experiment results published as artifacts
- Lineage tracked correctly
- Results queryable via manifest

---

## Implementation Plan

### Phase 1: TypeScript Bridge (Week 1)

**Tasks:**
1. Create `@quantbot/artifact-store-bridge` package
2. Implement Python subprocess bridge
3. Add typed interfaces for artifact operations
4. Test deduplication and lineage

**Deliverables:**
- `packages/artifact-store-bridge/` (new package)
- Unit tests for bridge
- Integration tests with Python artifact store

### Phase 2: Projection Builder (Week 2)

**Tasks:**
1. Create projection builder in `@quantbot/storage`
2. Implement DuckDB table creation from Parquet
3. Add cache management
4. Test rebuild mechanism

**Deliverables:**
- `packages/storage/src/projections/` (new module)
- Projection builder tests
- Cache invalidation tests

### Phase 3: Alert Ingestion Integration (Week 3)

**Tasks:**
1. Refactor alert ingestion to use artifact store
2. Implement quarantine mechanism
3. Add deduplication at artifact level
4. Migrate existing alerts to artifacts

**Deliverables:**
- `packages/ingestion/src/alerts/artifact-pipeline.ts` (new)
- Alert migration script
- Ingestion tests

### Phase 4: OHLCV Slice Integration (Week 4)

**Tasks:**
1. Refactor OHLCV slice export to use artifact store
2. Add coverage validation
3. Implement slice reuse logic
4. Migrate existing slices to artifacts

**Deliverables:**
- `packages/ohlcv/src/slices/artifact-exporter.ts` (new)
- Slice migration script
- Coverage validation tests

### Phase 5: Experiment Integration (Week 5)

**Tasks:**
1. Integrate artifact store into experiment workflows
2. Implement experiment result publishing
3. Add lineage tracking
4. Test end-to-end experiment flow

**Deliverables:**
- `packages/workflows/src/experiments/artifact-integration.ts` (new)
- `packages/workflows/src/experiments/result-publisher.ts` (new)
- End-to-end experiment tests

### Phase 6: Legacy Migration (Week 6)

**Tasks:**
1. Migrate existing DuckDB data to artifacts
2. Deprecate mutable DuckDB tables
3. Update documentation
4. Verify all workflows use artifacts

**Deliverables:**
- Migration scripts
- Updated documentation
- Deprecation warnings

---

## Success Criteria

### Phase 1 Success Criteria
- ✅ TypeScript can query artifacts from manifest
- ✅ TypeScript can publish new artifacts
- ✅ Deduplication works correctly
- ✅ Lineage is tracked

### Phase 2 Success Criteria
- ✅ DuckDB projections built from Parquet
- ✅ Projections are deterministic
- ✅ Projections are rebuildable
- ✅ Cache management works

### Phase 3 Success Criteria
- ✅ Alerts ingested as artifacts
- ✅ Deduplication works at artifact level
- ✅ Invalid alerts quarantined
- ✅ Provenance tracked

### Phase 4 Success Criteria
- ✅ OHLCV slices published as artifacts
- ✅ Coverage tracked
- ✅ Slices reusable across experiments

### Phase 5 Success Criteria
- ✅ Experiments declare input artifacts
- ✅ Artifact versions frozen at experiment start
- ✅ Outputs published as artifacts
- ✅ Lineage tracked correctly

### Phase 6 Success Criteria
- ✅ All data migrated to artifacts
- ✅ Mutable DuckDB tables deprecated
- ✅ All workflows use artifacts
- ✅ Documentation updated

---

## Architectural Invariants (Enforced)

### Invariant 1: Parquet is Truth

**Rule**: All authoritative data exists as immutable Parquet artifacts.

**Enforcement**:
- No direct writes to DuckDB tables (read-only projections only)
- All data mutations go through artifact store
- Artifact store enforces immutability

**Verification**:
- Architecture tests check for direct DuckDB writes
- Code review enforces artifact-first pattern

### Invariant 2: DuckDB is Disposable

**Rule**: DuckDB files can be deleted without data loss.

**Enforcement**:
- DuckDB projections built from Parquet on-demand
- Rebuild mechanism available
- No authoritative state in DuckDB

**Verification**:
- Integration tests delete and rebuild DuckDB
- Documentation emphasizes disposability

### Invariant 3: Idempotency Everywhere

**Rule**: Every pipeline step is safe to re-run.

**Enforcement**:
- Content hashing prevents duplicate artifacts
- Semantic deduplication at artifact level
- Deterministic artifact IDs

**Verification**:
- Tests run pipelines multiple times
- Verify same inputs → same artifacts

### Invariant 4: Lineage is Complete

**Rule**: Every artifact declares its inputs.

**Enforcement**:
- Artifact store requires `input_artifact_ids`
- Manifest tracks lineage
- Experiments declare input artifacts

**Verification**:
- Lineage queries work correctly
- Orphaned artifacts detected

---

## Open Questions

1. **Python Environment**: Should we use a dedicated Python venv for artifact store, or integrate with existing Python tooling?
2. **Cache Invalidation**: How should we handle cache invalidation when artifacts are superseded?
3. **Artifact Retention**: What's the retention policy for superseded artifacts?
4. **Performance**: Should we optimize for large artifact sets (millions of rows)?
5. **Concurrency**: How should we handle concurrent artifact publishing?

---

## Next Steps

1. **Review this PRD** with stakeholders
2. **Approve integration approach** (TypeScript bridge to Python)
3. **Begin Phase 1** (TypeScript bridge implementation)
4. **Set up CI/CD** for artifact store package
5. **Document migration path** from existing DuckDB tables

---

## Appendix: Existing Artifact Store CLI

### Initialize Manifest

```bash
python3 -m artifact_store.bin.artifacts_cli init \
  --manifest-db /home/memez/opn/manifest/manifest.sqlite \
  --manifest-sql ./packages/artifact_store/artifact_store/sql/manifest_v1.sql
```

### Publish CSV as Artifact

```bash
python3 -m artifact_store.bin.artifacts_cli publish-csv \
  --manifest-db /home/memez/opn/manifest/manifest.sqlite \
  --manifest-sql ./packages/artifact_store/artifact_store/sql/manifest_v1.sql \
  --artifacts-root /home/memez/opn/artifacts \
  --artifact-type ohlcv_slice \
  --schema-version 2 \
  --logical-key "token=ABC.../res=1s/from=2026-01-26T00:00:00Z/to=2026-01-26T01:00:00Z" \
  --csv /tmp/slice.csv \
  --writer-name slice_exporter \
  --writer-version 0.1.0 \
  --git-commit $(git rev-parse HEAD) \
  --params-json '{"resolution":"1s","source":"clickhouse"}' \
  --tag res=1s --tag kind=ohlcv_slice
```

### Query Manifest (SQL)

```bash
sqlite3 /home/memez/opn/manifest/manifest.sqlite

-- List all artifacts
SELECT artifact_id, artifact_type, logical_key, status, row_count
FROM artifacts
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 10;

-- Find artifacts by type
SELECT * FROM artifacts
WHERE artifact_type = 'alerts_v1'
AND status = 'active';

-- Find artifacts by tag
SELECT a.* FROM artifacts a
JOIN artifact_tags t ON a.artifact_id = t.artifact_id
WHERE t.k = 'source' AND t.v = 'telegram';

-- Get lineage
SELECT * FROM artifact_lineage
WHERE artifact_id = 'abc-123';
```

---

## Summary

The QuantBot Research Package integration leverages existing, production-ready infrastructure:

**Existing (Ready to Use):**
- ✅ Python artifact store with SQLite manifest
- ✅ Data lake structure (`/home/memez/opn`)
- ✅ Content-addressable Parquet artifacts
- ✅ Deduplication and lineage tracking

**What's Needed (Integration Layer):**
- TypeScript bridge to Python artifact store
- DuckDB projection builder
- Alert/OHLCV ingestion integration
- Experiment artifact integration
- Legacy migration

**Timeline**: 6 weeks to full integration

**Outcome**: Parquet-first, DuckDB-as-projection architecture fully enforced at the workflow level, with complete lineage tracking and reproducibility guarantees.

