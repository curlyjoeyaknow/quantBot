# PRD: QuantBot Research Package - Consolidated Architecture

## Executive Summary

This document defines the comprehensive Product Requirements Document (PRD) for the **QuantBot Research Package**, which formalizes the Parquet-first, DuckDB-as-projection architecture using the existing `/home/memez/opn` data lake and `packages/artifact_store` infrastructure.

**Key Finding**: The foundational infrastructure is production-ready and actively populated:
- ✅ **4,899 artifacts** registered in manifest (3,641 OHLCV slices, 750 alerts, 508 alert events)
- ✅ **Artifact store** with SQLite manifest and deterministic content hashing
- ✅ **Data lake** with immutable Parquet artifacts, disposable DuckDB cache, coverage analysis
- ✅ **Deduplication** at file and semantic levels
- ✅ **Lineage tracking** and provenance metadata

**What's Needed**: Integration layer using **ports/adapters/handlers pattern** (no separate bridge package).

---

## Introduction

### Context

The QuantBot project has evolved into a complex system with multiple concerns. This PRD defines a systematic transformation that:

- **Establishes** architectural invariants (separation of concerns, determinism)
- **Formalizes** Parquet as immutable truth, DuckDB as disposable projection
- **Integrates** existing artifact store into research workflows
- **Enables** experiment tracking with full lineage
- **Provides** reproducibility guarantees

### Problem Statement

**Current Pain Points:**
1. Experiments depend on mutable DuckDB tables (fragile)
2. No formal experiment tracking with lineage
3. Results are not reproducible (missing provenance)
4. No integration between artifact store and research workflows
5. Architectural boundaries not enforced

**Solution:**
- Parquet artifacts are immutable truth
- DuckDB is rebuildable from Parquet
- Experiments declare frozen artifact sets
- Full lineage tracking (results → inputs)
- Ports/adapters enforce boundaries

### Research Lab Philosophy

This platform is designed as a **research lab, not a bot**. Research labs require:

- **Provenance**: Complete traceability of inputs, outputs, and execution parameters
- **Determinism**: Byte-identical results from identical inputs (within fixed tolerance)
- **Repeatability**: Ability to reproduce any historical result exactly
- **Immutability**: Raw data never changes; derived data is rebuildable
- **Lineage**: Every artifact declares its inputs

The platform lives or dies by its **contracts, not code**.

---

## Architecture Overview

### Existing Infrastructure (Production-Ready)

**Data Lake** (`/home/memez/opn`):
```
/home/memez/opn/
├── artifacts/                      # Immutable Parquet truth
│   ├── alerts_v1/v1/              # 750 alert artifacts (day-partitioned)
│   ├── ohlcv_slice_v2/v2/         # 3,641 OHLCV slice artifacts
│   ├── alerts_event_v1/v1/        # 508 alert event artifacts
│   ├── _quarantine/               # Invalid/rejected artifacts
│   └── _quarantine_alerts_*/      # Quarantined alerts
├── cache/                          # Disposable DuckDB projections
│   ├── ohlcv_cache.duckdb         # Rebuildable from artifacts
│   └── ohlcv_v2_dataset/          # Bucketed partitions (64 buckets × 8 months)
├── coverage/                       # Coverage analysis artifacts
│   └── ohlcv_v2/
│       ├── alert_forward_coverage.parquet
│       ├── coverage_gaps.parquet
│       └── coverage_summary.parquet
├── manifest/                       # Artifact registry (SQLite)
│   └── manifest.sqlite            # 4,899 artifacts registered
├── staging/                        # Temporary ingestion staging
│   └── alerts_v1_shards/          # Pre-publish alert shards
└── verify/                         # Verification & rebuild scripts
    ├── rebuild_cache_duckdb.py    # Rebuild DuckDB from Parquet
    ├── audit_artifacts.py         # Audit artifact integrity
    └── build_alert_forward_coverage.py
```

**Artifact Store** (`packages/artifact_store`):
```python
# Python package with:
- manifest.py              # SQLite manifest operations
- spec.py                  # Artifact type specifications
- publisher.py             # Parquet publishing with dedup
- hashing.py               # Deterministic content hashing
- bin/artifacts_cli.py     # CLI for artifact operations
```

**Artifact Types (Active):**
- `ohlcv_slice_v2`: 3,641 artifacts (OHLCV candle slices)
- `alerts_v1`: 750 artifacts (canonical alerts, day-partitioned)
- `alerts_event_v1`: 508 artifacts (alert events)

### Target Architecture (Ports/Adapters/Handlers)

```
┌─────────────────────────────────────────────────────────┐
│                    CLI/Handlers                          │
│  (Pure orchestration, depends on ports only)            │
└────────────────────┬────────────────────────────────────┘
                     │ depends on
┌────────────────────▼────────────────────────────────────┐
│                 Port Interfaces                          │
│  (@quantbot/core/src/ports/)                            │
│  - ArtifactStorePort                                    │
│  - ProjectionBuilderPort                                │
│  - ExperimentTrackerPort                                │
└────────────────────▲────────────────────────────────────┘
                     │ implemented by
┌────────────────────┴────────────────────────────────────┐
│                    Adapters                              │
│  (@quantbot/storage/src/adapters/)                      │
│  - ArtifactStoreAdapter (uses PythonEngine)             │
│  - ProjectionBuilderAdapter (uses DuckDB)               │
│  - ExperimentTrackerAdapter (uses DuckDB)               │
└────────────────────┬────────────────────────────────────┘
                     │ calls
┌────────────────────▼────────────────────────────────────┐
│              External Systems                            │
│  - Python Artifact Store (packages/artifact_store)      │
│  - Data Lake (/home/memez/opn)                          │
│  - DuckDB (cache projections)                           │
└─────────────────────────────────────────────────────────┘
```

**Data Flow:**

```
Ingestion (Telegram/API)
       ↓
Staging & Normalization
       ↓
Parquet Artifact (via ArtifactStorePort)
       ↓
Manifest Registration (SQLite)
       ↓
DuckDB Projection (via ProjectionBuilderPort)
       ↓
Experiment Execution (frozen artifact set)
       ↓
Results as Artifacts (with lineage)
```

---

## Goals

### Primary Objectives

1. **Integrate Artifact Store**: Connect existing artifact store to research workflows using ports/adapters pattern
2. **Enforce Parquet-First**: All authoritative data in immutable Parquet artifacts
3. **Enable Experiment Tracking**: Every experiment tracks frozen artifact set + full provenance
4. **Make DuckDB Disposable**: DuckDB can be deleted and rebuilt from Parquet without data loss
5. **Provide Reproducibility**: Same inputs → same outputs, with full lineage

### Business Value

- **Auditability**: Byte-identical results enable regulatory compliance
- **Reproducibility**: Any historical result can be reproduced exactly
- **Reliability**: Deterministic execution ensures consistent results
- **Maintainability**: Clear architectural boundaries prevent drift

### User Value

- **Fast Iteration**: Reuse artifacts across experiments (no repeated database queries)
- **Easy Comparison**: Diff experiments based on artifact sets + parameters
- **Reproducibility**: Confidence that results can be reproduced months later
- **Provenance**: Complete traceability from results to inputs

---

## Core Architectural Principles

### 1. Parquet-First Truth Layer

**Rule**: All primary data exists as **immutable Parquet artifacts** stored in the data lake.

**Properties:**
- Append-only (no mutations)
- Content-addressable (hash-based identity)
- Deterministically generated
- Schema-versioned
- Registered in SQLite manifest

**Enforcement:**
- No direct writes to DuckDB tables (read-only projections only)
- All data mutations go through `ArtifactStorePort`
- Architecture tests verify no direct DuckDB writes

### 2. DuckDB as Projection, Not Truth

**Rule**: DuckDB files are ephemeral, rebuildable, and disposable.

**Properties:**
- Derived from Parquet artifacts
- Query-optimized (indexes, partitions)
- Rebuildable via `rebuild_cache_duckdb.py`
- No authoritative state

**Enforcement:**
- DuckDB tables declare Parquet sources
- Rebuild mechanism tested in CI
- Documentation emphasizes disposability

### 3. Idempotency Everywhere

**Rule**: Every pipeline step is safe to re-run.

**Mechanism:**
- Content hashing prevents duplicate artifacts
- Semantic deduplication (same logical_key + content_hash)
- Deterministic artifact IDs

**Verification:**
- Tests run pipelines multiple times
- Verify same inputs → same artifacts

### 4. Experiment-Centric Design

**Rule**: System is optimized around experiments, not ingestion.

**Experiment Properties:**
- Frozen set of input artifacts (immutable)
- Declared configuration (strategy, params, windows)
- Deterministic execution (seeded RNG)
- Output artifacts (metrics, trades, curves)
- Full lineage (results → inputs)

### 5. Ports/Adapters/Handlers Pattern

**Rule**: Handlers depend on ports, adapters implement ports.

**Structure:**
- **Ports** (`@quantbot/core/src/ports/`): Type-only interfaces
- **Adapters** (`@quantbot/storage/src/adapters/`): I/O implementations
- **Handlers** (`packages/*/src/handlers/`): Pure orchestration
- **Apps** (`packages/cli/`, `packages/lab-ui/`): Wiring only

**Enforcement:**
- ESLint rules block cross-layer imports
- Architecture tests verify boundaries
- Code review enforces pattern

---

## Functional Requirements

## PHASE I: ARTIFACT STORE INTEGRATION (Week 1-2)

### FR-1.1: Artifact Store Port Interface

**Description**: Define port interface for artifact store operations

**Location**: `packages/core/src/ports/artifact-store-port.ts`

**Interface:**

```typescript
/**
 * Artifact Store Port
 *
 * Port interface for artifact store operations (Parquet + SQLite manifest).
 * Handlers depend on this port, not on specific implementations.
 * Adapters implement this port using Python artifact store.
 */
export interface ArtifactStorePort {
  /**
   * Query artifact by ID
   */
  getArtifact(artifactId: string): Promise<Artifact>;
  
  /**
   * List artifacts with filters
   */
  listArtifacts(filter: ArtifactFilter): Promise<Artifact[]>;
  
  /**
   * Find artifacts by logical key
   */
  findByLogicalKey(artifactType: string, logicalKey: string): Promise<Artifact[]>;
  
  /**
   * Publish DataFrame as Parquet artifact
   */
  publishArtifact(request: PublishArtifactRequest): Promise<PublishArtifactResult>;
  
  /**
   * Get artifact lineage (inputs)
   */
  getLineage(artifactId: string): Promise<ArtifactLineage>;
  
  /**
   * Get downstream artifacts (outputs that depend on this artifact)
   */
  getDownstream(artifactId: string): Promise<Artifact[]>;
  
  /**
   * Supersede old artifact with new one
   */
  supersede(newArtifactId: string, oldArtifactId: string): Promise<void>;
  
  /**
   * Check if artifact store is available
   */
  isAvailable(): Promise<boolean>;
}

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
  dataPath: string; // Path to CSV/Parquet file to publish
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

**Files:**
- `packages/core/src/ports/artifact-store-port.ts` (new)
- `packages/core/src/ports/index.ts` (export new port)

**Success Criteria:**
- ✅ Port interface defined in `@quantbot/core`
- ✅ Types are comprehensive and well-documented
- ✅ Interface matches Python artifact store capabilities

---

### FR-1.2: Artifact Store Adapter Implementation

**Description**: Implement adapter using PythonEngine (follows existing pattern)

**Location**: `packages/storage/src/adapters/artifact-store-adapter.ts`

**Implementation:**

```typescript
import { join } from 'path';
import { z } from 'zod';
import type {
  ArtifactStorePort,
  Artifact,
  ArtifactFilter,
  PublishArtifactRequest,
  PublishArtifactResult,
  ArtifactLineage,
} from '@quantbot/core';
import { PythonEngine } from '@quantbot/utils';
import { logger, findWorkspaceRoot, NotFoundError, AppError } from '@quantbot/infra/utils';

// Zod schemas for validation
const ArtifactSchema = z.object({
  artifactId: z.string(),
  artifactType: z.string(),
  schemaVersion: z.number(),
  logicalKey: z.string(),
  status: z.enum(['active', 'superseded', 'tombstoned']),
  pathParquet: z.string(),
  pathSidecar: z.string(),
  fileHash: z.string(),
  contentHash: z.string(),
  rowCount: z.number(),
  minTs: z.string().nullable(),
  maxTs: z.string().nullable(),
  createdAt: z.string(),
});

const PublishArtifactResultSchema = z.object({
  success: z.boolean(),
  deduped: z.boolean(),
  mode: z.enum(['file_hash', 'content_hash']).optional(),
  existingArtifactId: z.string().optional(),
  artifactId: z.string().optional(),
  pathParquet: z.string().optional(),
  pathSidecar: z.string().optional(),
  error: z.string().optional(),
});

const ArtifactLineageSchema = z.object({
  artifactId: z.string(),
  inputs: z.array(ArtifactSchema),
  depth: z.number(),
});

/**
 * Artifact Store Adapter
 *
 * Implements ArtifactStorePort using Python artifact store.
 * Uses PythonEngine to call Python scripts (following existing pattern).
 *
 * Pattern: Same as DuckDbSliceAnalyzerAdapter, CanonicalDuckDBAdapter, etc.
 */
export class ArtifactStoreAdapter implements ArtifactStorePort {
  private readonly pythonEngine: PythonEngine;
  private readonly scriptPath: string;
  private readonly manifestDb: string;
  private readonly artifactsRoot: string;
  private readonly manifestSql: string;

  constructor(
    manifestDb: string,
    artifactsRoot: string,
    pythonEngine?: PythonEngine
  ) {
    this.manifestDb = manifestDb;
    this.artifactsRoot = artifactsRoot;
    this.pythonEngine = pythonEngine || new PythonEngine();
    
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/artifact_store_ops.py');
    this.manifestSql = join(workspaceRoot, 'packages/artifact_store/artifact_store/sql/manifest_v1.sql');
  }

  async getArtifact(artifactId: string): Promise<Artifact> {
    logger.debug('Getting artifact', { artifactId });
    
    try {
      const result = await this.pythonEngine.runScriptWithStdin(
        this.scriptPath,
        {
          operation: 'get_artifact',
          manifest_db: this.manifestDb,
          artifact_id: artifactId,
        },
        ArtifactSchema
      );
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not found')) {
        throw new NotFoundError(`Artifact not found: ${artifactId}`);
      }
      throw new AppError(`Failed to get artifact: ${message}`, 'ARTIFACT_STORE_ERROR', 500);
    }
  }

  async listArtifacts(filter: ArtifactFilter): Promise<Artifact[]> {
    logger.debug('Listing artifacts', { filter });
    
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'list_artifacts',
        manifest_db: this.manifestDb,
        filter,
      },
      z.array(ArtifactSchema)
    );
    
    return result;
  }

  async findByLogicalKey(artifactType: string, logicalKey: string): Promise<Artifact[]> {
    logger.debug('Finding artifacts by logical key', { artifactType, logicalKey });
    
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'find_by_logical_key',
        manifest_db: this.manifestDb,
        artifact_type: artifactType,
        logical_key: logicalKey,
      },
      z.array(ArtifactSchema)
    );
    
    return result;
  }

  async publishArtifact(request: PublishArtifactRequest): Promise<PublishArtifactResult> {
    logger.info('Publishing artifact', {
      artifactType: request.artifactType,
      logicalKey: request.logicalKey,
      dataPath: request.dataPath,
    });
    
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'publish_artifact',
        manifest_db: this.manifestDb,
        manifest_sql: this.manifestSql,
        artifacts_root: this.artifactsRoot,
        artifact_type: request.artifactType,
        schema_version: request.schemaVersion,
        logical_key: request.logicalKey,
        data_path: request.dataPath,
        tags: request.tags || {},
        input_artifact_ids: request.inputArtifactIds || [],
        writer_name: request.writerName,
        writer_version: request.writerVersion,
        git_commit: request.gitCommit,
        git_dirty: request.gitDirty,
        params: request.params || {},
        filename_hint: request.filenameHint,
      },
      PublishArtifactResultSchema
    );
    
    if (result.deduped) {
      logger.info('Artifact deduplicated', {
        mode: result.mode,
        existingArtifactId: result.existingArtifactId,
      });
    } else {
      logger.info('Artifact published', {
        artifactId: result.artifactId,
        pathParquet: result.pathParquet,
      });
    }
    
    return result;
  }

  async getLineage(artifactId: string): Promise<ArtifactLineage> {
    logger.debug('Getting artifact lineage', { artifactId });
    
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'get_lineage',
        manifest_db: this.manifestDb,
        artifact_id: artifactId,
      },
      ArtifactLineageSchema
    );
    
    return result;
  }

  async getDownstream(artifactId: string): Promise<Artifact[]> {
    logger.debug('Getting downstream artifacts', { artifactId });
    
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'get_downstream',
        manifest_db: this.manifestDb,
        artifact_id: artifactId,
      },
      z.array(ArtifactSchema)
    );
    
    return result;
  }

  async supersede(newArtifactId: string, oldArtifactId: string): Promise<void> {
    logger.info('Superseding artifact', { newArtifactId, oldArtifactId });
    
    await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'supersede',
        manifest_db: this.manifestDb,
        new_artifact_id: newArtifactId,
        old_artifact_id: oldArtifactId,
      },
      z.object({ success: z.boolean() })
    );
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.pythonEngine.runScriptWithStdin(
        this.scriptPath,
        { operation: 'health_check', manifest_db: this.manifestDb },
        z.object({ available: z.boolean() })
      );
      return true;
    } catch (error) {
      logger.warn('Artifact store not available', { error });
      return false;
    }
  }
}
```

**Files:**
- `packages/storage/src/adapters/artifact-store-adapter.ts` (new)
- `packages/storage/src/adapters/index.ts` (export new adapter)

**Success Criteria:**
- ✅ Adapter implements `ArtifactStorePort`
- ✅ Uses `PythonEngine` for Python calls
- ✅ Follows existing adapter pattern
- ✅ Error handling matches existing adapters

---

### FR-1.3: Python Wrapper Script

**Description**: Create Python wrapper script for artifact store operations

**Location**: `tools/storage/artifact_store_ops.py`

**Implementation:**

```python
#!/usr/bin/env python3
"""
Artifact Store Operations

Wrapper script for artifact_store Python package.
Provides JSON stdin/stdout interface for TypeScript integration via PythonEngine.

Follows existing pattern used by:
- tools/storage/duckdb_run_events.py
- tools/storage/duckdb_canonical.py
- tools/storage/duckdb_artifacts.py
"""

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Import artifact_store package
from artifact_store.manifest import (
    connect_manifest,
    apply_migrations,
    supersede as manifest_supersede,
)
from artifact_store.publisher import publish_dataframe
import pandas as pd


def snake_to_camel(snake_str: str) -> str:
    """Convert snake_case to camelCase"""
    components = snake_str.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])


def row_to_dict(row: Any) -> Dict[str, Any]:
    """Convert SQLite row to dict with camelCase keys"""
    return {
        'artifactId': row['artifact_id'],
        'artifactType': row['artifact_type'],
        'schemaVersion': row['schema_version'],
        'logicalKey': row['logical_key'],
        'status': row['status'],
        'pathParquet': row['path_parquet'],
        'pathSidecar': row['path_sidecar'],
        'fileHash': row['file_hash'],
        'contentHash': row['content_hash'],
        'rowCount': row['row_count'],
        'minTs': row['min_ts'],
        'maxTs': row['max_ts'],
        'createdAt': row['created_at'],
    }


def get_artifact(manifest_db: str, artifact_id: str) -> Dict[str, Any]:
    """Get artifact by ID"""
    con = connect_manifest(Path(manifest_db))
    row = con.execute(
        "SELECT * FROM artifacts WHERE artifact_id = ?",
        (artifact_id,)
    ).fetchone()
    con.close()
    
    if row is None:
        raise ValueError(f"Artifact not found: {artifact_id}")
    
    return row_to_dict(row)


def list_artifacts(manifest_db: str, filter_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List artifacts with filters"""
    con = connect_manifest(Path(manifest_db))
    
    # Build WHERE clause from filter
    where_clauses = []
    params = []
    
    if filter_dict.get('artifactType'):
        where_clauses.append("artifact_type = ?")
        params.append(filter_dict['artifactType'])
    
    if filter_dict.get('status'):
        where_clauses.append("status = ?")
        params.append(filter_dict['status'])
    
    if filter_dict.get('minCreatedAt'):
        where_clauses.append("created_at >= ?")
        params.append(filter_dict['minCreatedAt'])
    
    if filter_dict.get('maxCreatedAt'):
        where_clauses.append("created_at <= ?")
        params.append(filter_dict['maxCreatedAt'])
    
    # Tag filtering (if provided)
    if filter_dict.get('tags'):
        for k, v in filter_dict['tags'].items():
            where_clauses.append(
                "artifact_id IN (SELECT artifact_id FROM artifact_tags WHERE k = ? AND v = ?)"
            )
            params.extend([k, v])
    
    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
    limit = filter_dict.get('limit', 100)
    
    rows = con.execute(
        f"SELECT * FROM artifacts WHERE {where_sql} ORDER BY created_at DESC LIMIT ?",
        (*params, limit)
    ).fetchall()
    con.close()
    
    return [row_to_dict(row) for row in rows]


def find_by_logical_key(
    manifest_db: str,
    artifact_type: str,
    logical_key: str
) -> List[Dict[str, Any]]:
    """Find artifacts by logical key"""
    con = connect_manifest(Path(manifest_db))
    rows = con.execute(
        """
        SELECT * FROM artifacts
        WHERE artifact_type = ? AND logical_key = ?
        ORDER BY created_at DESC
        """,
        (artifact_type, logical_key)
    ).fetchall()
    con.close()
    
    return [row_to_dict(row) for row in rows]


def publish_artifact_op(
    manifest_db: str,
    manifest_sql: str,
    artifacts_root: str,
    request: Dict[str, Any]
) -> Dict[str, Any]:
    """Publish artifact using artifact_store package"""
    # Load data from file
    data_path = request['data_path']
    if data_path.endswith('.csv'):
        df = pd.read_csv(data_path)
    elif data_path.endswith('.parquet'):
        df = pd.read_parquet(data_path)
    else:
        raise ValueError(f"Unsupported file format: {data_path}")
    
    # Publish using artifact_store
    result = publish_dataframe(
        manifest_db=Path(manifest_db),
        manifest_sql=Path(manifest_sql),
        artifacts_root=Path(artifacts_root),
        artifact_type=request['artifact_type'],
        schema_version=request['schema_version'],
        logical_key=request['logical_key'],
        df=df,
        tags=[(k, v) for k, v in request.get('tags', {}).items()],
        input_artifact_ids=request.get('input_artifact_ids', []),
        writer_name=request['writer_name'],
        writer_version=request['writer_version'],
        git_commit=request['git_commit'],
        git_dirty=request['git_dirty'],
        params=request.get('params', {}),
        filename_hint=request.get('filename_hint'),
    )
    
    # Handle deduplication result
    if result.get('deduped'):
        return {
            'success': True,
            'deduped': True,
            'mode': result.get('mode'),
            'existingArtifactId': result.get('existing_artifact_id'),
        }
    
    # New artifact published
    return {
        'success': True,
        'deduped': False,
        'artifactId': result['artifact_id'],
        'pathParquet': result['paths']['parquet'],
        'pathSidecar': result['paths']['sidecar'],
    }


def get_lineage(manifest_db: str, artifact_id: str) -> Dict[str, Any]:
    """Get artifact lineage (inputs)"""
    con = connect_manifest(Path(manifest_db))
    
    # Get input artifacts
    rows = con.execute(
        """
        SELECT a.* FROM artifacts a
        JOIN artifact_lineage l ON a.artifact_id = l.input_artifact_id
        WHERE l.artifact_id = ?
        ORDER BY a.created_at
        """,
        (artifact_id,)
    ).fetchall()
    con.close()
    
    inputs = [row_to_dict(row) for row in rows]
    
    return {
        'artifactId': artifact_id,
        'inputs': inputs,
        'depth': 1,  # Simple implementation, can be extended for recursive lineage
    }


def get_downstream(manifest_db: str, artifact_id: str) -> List[Dict[str, Any]]:
    """Get downstream artifacts (outputs that depend on this artifact)"""
    con = connect_manifest(Path(manifest_db))
    
    # Get downstream artifacts
    rows = con.execute(
        """
        SELECT a.* FROM artifacts a
        JOIN artifact_lineage l ON a.artifact_id = l.artifact_id
        WHERE l.input_artifact_id = ?
        ORDER BY a.created_at DESC
        """,
        (artifact_id,)
    ).fetchall()
    con.close()
    
    return [row_to_dict(row) for row in rows]


def supersede_artifact(manifest_db: str, new_artifact_id: str, old_artifact_id: str) -> Dict[str, Any]:
    """Supersede old artifact with new one"""
    con = connect_manifest(Path(manifest_db))
    manifest_supersede(con, new_artifact_id=new_artifact_id, old_artifact_id=old_artifact_id)
    con.close()
    
    return {'success': True}


def health_check(manifest_db: str) -> Dict[str, Any]:
    """Check if artifact store is available"""
    try:
        con = connect_manifest(Path(manifest_db))
        con.execute("SELECT 1").fetchone()
        con.close()
        return {'available': True}
    except Exception as e:
        return {'available': False, 'error': str(e)}


def main() -> None:
    """Main entry point - reads JSON from stdin, executes operation, writes JSON to stdout"""
    try:
        input_data = json.load(sys.stdin)
        operation = input_data['operation']
        
        if operation == 'get_artifact':
            result = get_artifact(input_data['manifest_db'], input_data['artifact_id'])
        elif operation == 'list_artifacts':
            result = list_artifacts(input_data['manifest_db'], input_data.get('filter', {}))
        elif operation == 'find_by_logical_key':
            result = find_by_logical_key(
                input_data['manifest_db'],
                input_data['artifact_type'],
                input_data['logical_key']
            )
        elif operation == 'publish_artifact':
            result = publish_artifact_op(
                input_data['manifest_db'],
                input_data['manifest_sql'],
                input_data['artifacts_root'],
                input_data
            )
        elif operation == 'get_lineage':
            result = get_lineage(input_data['manifest_db'], input_data['artifact_id'])
        elif operation == 'get_downstream':
            result = get_downstream(input_data['manifest_db'], input_data['artifact_id'])
        elif operation == 'supersede':
            result = supersede_artifact(
                input_data['manifest_db'],
                input_data['new_artifact_id'],
                input_data['old_artifact_id']
            )
        elif operation == 'health_check':
            result = health_check(input_data['manifest_db'])
        else:
            raise ValueError(f"Unknown operation: {operation}")
        
        json.dump(result, sys.stdout, indent=2)
        sys.exit(0)
    except Exception as e:
        error_result = {'error': str(e), 'type': type(e).__name__}
        json.dump(error_result, sys.stderr, indent=2)
        sys.exit(1)


if __name__ == '__main__':
    main()
```

**Files:**
- `tools/storage/artifact_store_ops.py` (new)

**Success Criteria:**
- ✅ Python wrapper follows existing pattern
- ✅ JSON stdin/stdout interface
- ✅ Comprehensive error handling
- ✅ All operations implemented

---

### FR-1.4: Command Context Integration

**Description**: Add artifact store to CommandContext for dependency injection

**Location**: `packages/cli/src/core/command-context.ts`

**Implementation:**

```typescript
import { ArtifactStoreAdapter } from '@quantbot/storage';
import type { ArtifactStorePort } from '@quantbot/core';

export class CommandContext {
  private _artifactStore?: ArtifactStorePort;
  
  // ... existing services ...
  
  /**
   * Get artifact store service
   */
  artifactStore(): ArtifactStorePort {
    if (!this._artifactStore) {
      const manifestDb = process.env.ARTIFACT_MANIFEST_DB || '/home/memez/opn/manifest/manifest.sqlite';
      const artifactsRoot = process.env.ARTIFACTS_ROOT || '/home/memez/opn/artifacts';
      const pythonEngine = this.pythonEngine();
      
      this._artifactStore = new ArtifactStoreAdapter(
        manifestDb,
        artifactsRoot,
        pythonEngine
      );
    }
    return this._artifactStore;
  }
}
```

**Files:**
- `packages/cli/src/core/command-context.ts` (extend)

**Success Criteria:**
- ✅ Artifact store available via `ctx.services.artifactStore()`
- ✅ Environment variables for configuration
- ✅ Lazy initialization

---

## PHASE II: PROJECTION BUILDER (Week 2-3)

### FR-2.1: Projection Builder Port Interface

**Description**: Define port for building DuckDB projections from Parquet artifacts

**Location**: `packages/core/src/ports/projection-builder-port.ts`

**Interface:**

```typescript
/**
 * Projection Builder Port
 *
 * Port interface for building DuckDB projections from Parquet artifacts.
 * Projections are disposable, rebuildable, query-optimized views.
 */
export interface ProjectionBuilderPort {
  /**
   * Build projection from artifact set
   */
  buildProjection(request: ProjectionRequest): Promise<ProjectionResult>;
  
  /**
   * Rebuild projection (discard cache, rebuild from Parquet)
   */
  rebuildProjection(projectionId: string): Promise<void>;
  
  /**
   * Dispose projection (delete DuckDB file)
   */
  disposeProjection(projectionId: string): Promise<void>;
  
  /**
   * Check if projection exists
   */
  projectionExists(projectionId: string): Promise<boolean>;
}

export interface ProjectionRequest {
  projectionId: string;
  artifacts: {
    alerts?: string[];       // Alert artifact IDs
    ohlcv?: string[];        // OHLCV artifact IDs
  };
  tables: {
    alerts?: string;         // Table name for alerts
    ohlcv?: string;          // Table name for OHLCV
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

**Files:**
- `packages/core/src/ports/projection-builder-port.ts` (new)

**Success Criteria:**
- ✅ Port interface defined
- ✅ Comprehensive types
- ✅ Supports multiple artifact types

---

### FR-2.2: Projection Builder Adapter

**Description**: Implement projection builder using DuckDB

**Location**: `packages/storage/src/adapters/projection-builder-adapter.ts`

**Implementation:**

```typescript
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import type {
  ProjectionBuilderPort,
  ProjectionRequest,
  ProjectionResult,
  ProjectionTable,
  ArtifactStorePort,
} from '@quantbot/core';
import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger } from '@quantbot/infra/utils';

/**
 * Projection Builder Adapter
 *
 * Builds DuckDB projections from Parquet artifacts.
 * Projections are disposable, rebuildable, query-optimized views.
 *
 * Pattern: Uses DuckDB's read_parquet to create tables from artifact files.
 */
export class ProjectionBuilderAdapter implements ProjectionBuilderPort {
  constructor(
    private readonly artifactStore: ArtifactStorePort,
    private readonly cacheDir: string = '/home/memez/opn/cache'
  ) {}

  async buildProjection(request: ProjectionRequest): Promise<ProjectionResult> {
    const { projectionId, artifacts, tables } = request;
    const cacheDir = request.cacheDir || this.cacheDir;
    
    logger.info('Building projection', { projectionId, artifactCount: this.countArtifacts(artifacts) });
    
    // 1. Ensure cache directory exists
    mkdirSync(cacheDir, { recursive: true });
    
    // 2. Create DuckDB file
    const duckdbPath = join(cacheDir, `${projectionId}.duckdb`);
    const client = new DuckDBClient(duckdbPath);
    
    try {
      // 3. Build tables from artifacts
      const projectionTables: ProjectionTable[] = [];
      let totalRows = 0;
      
      // Build alerts table
      if (artifacts.alerts && artifacts.alerts.length > 0) {
        const table = await this.buildTable(
          client,
          tables.alerts || 'alerts',
          artifacts.alerts,
          request.indexes?.filter(idx => idx.table === (tables.alerts || 'alerts'))
        );
        projectionTables.push(table);
        totalRows += table.rowCount;
      }
      
      // Build OHLCV table
      if (artifacts.ohlcv && artifacts.ohlcv.length > 0) {
        const table = await this.buildTable(
          client,
          tables.ohlcv || 'ohlcv',
          artifacts.ohlcv,
          request.indexes?.filter(idx => idx.table === (tables.ohlcv || 'ohlcv'))
        );
        projectionTables.push(table);
        totalRows += table.rowCount;
      }
      
      await client.close();
      
      logger.info('Projection built', {
        projectionId,
        duckdbPath,
        tables: projectionTables.length,
        totalRows,
      });
      
      return {
        projectionId,
        duckdbPath,
        tables: projectionTables,
        artifactCount: this.countArtifacts(artifacts),
        totalRows,
      };
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private async buildTable(
    client: DuckDBClient,
    tableName: string,
    artifactIds: string[],
    indexes?: ProjectionIndex[]
  ): Promise<ProjectionTable> {
    logger.debug('Building table', { tableName, artifactCount: artifactIds.length });
    
    // 1. Get artifact metadata
    const artifacts = await Promise.all(
      artifactIds.map(id => this.artifactStore.getArtifact(id))
    );
    
    // 2. Extract Parquet paths
    const parquetPaths = artifacts.map(a => a.pathParquet);
    
    // 3. Create table from Parquet files
    const pathsList = parquetPaths.map(p => `'${p}'`).join(', ');
    await client.execute(`
      CREATE TABLE ${tableName} AS
      SELECT * FROM read_parquet([${pathsList}])
    `);
    
    // 4. Create indexes
    const indexNames: string[] = [];
    if (indexes) {
      for (const index of indexes) {
        const indexName = `idx_${tableName}_${index.columns.join('_')}`;
        const columns = index.columns.join(', ');
        await client.execute(`
          CREATE INDEX ${indexName} ON ${tableName}(${columns})
        `);
        indexNames.push(indexName);
      }
    }
    
    // 5. Get table metadata
    const rowCount = await client.execute(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    const columns = await client.execute(`DESCRIBE ${tableName}`);
    
    return {
      name: tableName,
      rowCount: rowCount[0].cnt,
      columns: columns.map(c => c.column_name),
      indexes: indexNames,
    };
  }

  async rebuildProjection(projectionId: string): Promise<void> {
    logger.info('Rebuilding projection', { projectionId });
    
    // 1. Delete existing projection
    await this.disposeProjection(projectionId);
    
    // 2. Rebuild (requires original request - store in metadata or pass explicitly)
    // For now, throw error - caller must call buildProjection again
    throw new Error('Rebuild requires original ProjectionRequest - call buildProjection instead');
  }

  async disposeProjection(projectionId: string): Promise<void> {
    const duckdbPath = join(this.cacheDir, `${projectionId}.duckdb`);
    
    if (existsSync(duckdbPath)) {
      unlinkSync(duckdbPath);
      logger.info('Projection disposed', { projectionId, duckdbPath });
    }
  }

  async projectionExists(projectionId: string): Promise<boolean> {
    const duckdbPath = join(this.cacheDir, `${projectionId}.duckdb`);
    return existsSync(duckdbPath);
  }

  private countArtifacts(artifacts: { alerts?: string[]; ohlcv?: string[] }): number {
    return (artifacts.alerts?.length || 0) + (artifacts.ohlcv?.length || 0);
  }
}
```

**Files:**
- `packages/storage/src/adapters/projection-builder-adapter.ts` (new)

**Success Criteria:**
- ✅ Builds DuckDB from Parquet artifacts
- ✅ Creates indexes for query optimization
- ✅ Disposable and rebuildable
- ✅ Follows adapter pattern

---

## PHASE III: EXPERIMENT TRACKING (Week 3-4)

### FR-3.1: Experiment Tracker Port Interface

**Description**: Define port for experiment tracking with artifact lineage

**Location**: `packages/core/src/ports/experiment-tracker-port.ts`

**Interface:**

```typescript
/**
 * Experiment Tracker Port
 *
 * Port interface for experiment tracking with artifact lineage.
 * Tracks experiments, their input artifacts, and output artifacts.
 */
export interface ExperimentTrackerPort {
  /**
   * Create new experiment
   */
  createExperiment(definition: ExperimentDefinition): Promise<Experiment>;
  
  /**
   * Get experiment by ID
   */
  getExperiment(experimentId: string): Promise<Experiment>;
  
  /**
   * List experiments with filters
   */
  listExperiments(filter: ExperimentFilter): Promise<Experiment[]>;
  
  /**
   * Update experiment status
   */
  updateStatus(experimentId: string, status: ExperimentStatus): Promise<void>;
  
  /**
   * Store experiment results (output artifacts)
   */
  storeResults(experimentId: string, results: ExperimentResults): Promise<void>;
  
  /**
   * Find experiments by input artifacts
   */
  findByInputArtifacts(artifactIds: string[]): Promise<Experiment[]>;
}

export interface ExperimentDefinition {
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
    strategy: Record<string, unknown>;
    dateRange: { from: string; to: string };
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

export interface Experiment extends ExperimentDefinition {
  status: ExperimentStatus;
  
  // Output artifacts (populated after execution)
  outputs?: {
    trades?: string;         // Trade artifact ID
    metrics?: string;        // Metrics artifact ID
    curves?: string;         // Equity curve artifact ID
    diagnostics?: string;    // Diagnostics artifact ID
  };
  
  // Execution metadata
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

**Files:**
- `packages/core/src/ports/experiment-tracker-port.ts` (new)

**Success Criteria:**
- ✅ Port interface defined
- ✅ Comprehensive experiment tracking
- ✅ Artifact lineage support

---

### FR-3.2: Experiment Tracker Adapter

**Description**: Implement experiment tracker using DuckDB

**Location**: `packages/storage/src/adapters/experiment-tracker-adapter.ts`

**Implementation:**

```typescript
import { join } from 'path';
import { z } from 'zod';
import type {
  ExperimentTrackerPort,
  ExperimentDefinition,
  Experiment,
  ExperimentFilter,
  ExperimentStatus,
  ExperimentResults,
} from '@quantbot/core';
import { PythonEngine } from '@quantbot/utils';
import { logger, findWorkspaceRoot, NotFoundError } from '@quantbot/infra/utils';

const ExperimentSchema = z.object({
  experimentId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  inputs: z.object({
    alerts: z.array(z.string()),
    ohlcv: z.array(z.string()),
    strategies: z.array(z.string()).optional(),
  }),
  config: z.object({
    strategy: z.record(z.unknown()),
    dateRange: z.object({ from: z.string(), to: z.string() }),
    params: z.record(z.unknown()),
  }),
  provenance: z.object({
    gitCommit: z.string(),
    gitDirty: z.boolean(),
    engineVersion: z.string(),
    createdAt: z.string(),
  }),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  outputs: z.object({
    trades: z.string().optional(),
    metrics: z.string().optional(),
    curves: z.string().optional(),
    diagnostics: z.string().optional(),
  }).optional(),
  execution: z.object({
    startedAt: z.string(),
    completedAt: z.string().optional(),
    duration: z.number().optional(),
    error: z.string().optional(),
  }).optional(),
});

/**
 * Experiment Tracker Adapter
 *
 * Implements ExperimentTrackerPort using DuckDB for storage.
 * Uses PythonEngine to call Python scripts.
 */
export class ExperimentTrackerAdapter implements ExperimentTrackerPort {
  private readonly pythonEngine: PythonEngine;
  private readonly scriptPath: string;
  private readonly dbPath: string;

  constructor(dbPath: string, pythonEngine?: PythonEngine) {
    this.dbPath = dbPath;
    this.pythonEngine = pythonEngine || new PythonEngine();
    
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/experiment_tracker_ops.py');
  }

  async createExperiment(definition: ExperimentDefinition): Promise<Experiment> {
    logger.info('Creating experiment', { experimentId: definition.experimentId });
    
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'create_experiment',
        db_path: this.dbPath,
        definition,
      },
      ExperimentSchema
    );
    
    return result;
  }

  async getExperiment(experimentId: string): Promise<Experiment> {
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'get_experiment',
        db_path: this.dbPath,
        experiment_id: experimentId,
      },
      ExperimentSchema
    );
    
    return result;
  }

  async listExperiments(filter: ExperimentFilter): Promise<Experiment[]> {
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'list_experiments',
        db_path: this.dbPath,
        filter,
      },
      z.array(ExperimentSchema)
    );
    
    return result;
  }

  async updateStatus(experimentId: string, status: ExperimentStatus): Promise<void> {
    await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'update_status',
        db_path: this.dbPath,
        experiment_id: experimentId,
        status,
      },
      z.object({ success: z.boolean() })
    );
  }

  async storeResults(experimentId: string, results: ExperimentResults): Promise<void> {
    await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'store_results',
        db_path: this.dbPath,
        experiment_id: experimentId,
        results,
      },
      z.object({ success: z.boolean() })
    );
  }

  async findByInputArtifacts(artifactIds: string[]): Promise<Experiment[]> {
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'find_by_input_artifacts',
        db_path: this.dbPath,
        artifact_ids: artifactIds,
      },
      z.array(ExperimentSchema)
    );
    
    return result;
  }
}
```

**Files:**
- `packages/storage/src/adapters/experiment-tracker-adapter.ts` (new)
- `tools/storage/experiment_tracker_ops.py` (new)
- `tools/storage/sql/experiment_tracker_schema.sql` (new)

**Success Criteria:**
- ✅ Adapter implements port
- ✅ Uses PythonEngine
- ✅ Stores experiments in DuckDB
- ✅ Tracks artifact lineage

---

## PHASE IV: EXPERIMENT EXECUTION (Week 4-5)

### FR-4.1: Experiment Execution Handler

**Description**: Pure handler for executing experiments with frozen artifact sets

**Location**: `packages/workflows/src/experiments/handlers/execute-experiment.ts`

**Implementation:**

```typescript
import type {
  ArtifactStorePort,
  ProjectionBuilderPort,
  ExperimentTrackerPort,
  ExperimentDefinition,
  Experiment,
} from '@quantbot/core';
import { logger } from '@quantbot/infra/utils';

/**
 * Execute Experiment Handler
 *
 * Pure orchestration - no I/O, no subprocess calls.
 * Depends on ports only (not adapters).
 *
 * Flow:
 * 1. Validate artifact availability
 * 2. Build DuckDB projection from artifacts
 * 3. Execute experiment (simulation)
 * 4. Publish results as artifacts
 * 5. Update experiment with output artifacts
 */
export async function executeExperiment(
  definition: ExperimentDefinition,
  ports: {
    artifactStore: ArtifactStorePort;
    projectionBuilder: ProjectionBuilderPort;
    experimentTracker: ExperimentTrackerPort;
  }
): Promise<Experiment> {
  const { artifactStore, projectionBuilder, experimentTracker } = ports;
  const { experimentId } = definition;
  
  logger.info('Executing experiment', { experimentId });
  
  // 1. Create experiment record
  const experiment = await experimentTracker.createExperiment(definition);
  
  try {
    // 2. Update status to running
    await experimentTracker.updateStatus(experimentId, 'running');
    
    // 3. Validate artifact availability
    await validateArtifacts(definition.inputs, artifactStore);
    
    // 4. Build DuckDB projection from artifacts
    const projection = await projectionBuilder.buildProjection({
      projectionId: `exp-${experimentId}`,
      artifacts: definition.inputs,
      tables: {
        alerts: 'alerts',
        ohlcv: 'ohlcv',
      },
      indexes: [
        { table: 'alerts', columns: ['alert_ts_utc', 'mint'] },
        { table: 'ohlcv', columns: ['ts', 'token_address'] },
      ],
    });
    
    logger.info('Projection built', {
      experimentId,
      duckdbPath: projection.duckdbPath,
      totalRows: projection.totalRows,
    });
    
    // 5. Execute simulation (call simulation engine)
    const simulationResults = await executeSimulation(
      projection.duckdbPath,
      definition.config
    );
    
    // 6. Publish results as artifacts
    const outputArtifacts = await publishResults(
      experimentId,
      simulationResults,
      definition.inputs,
      definition.provenance,
      artifactStore
    );
    
    // 7. Store output artifacts in experiment
    await experimentTracker.storeResults(experimentId, outputArtifacts);
    
    // 8. Update status to completed
    await experimentTracker.updateStatus(experimentId, 'completed');
    
    // 9. Dispose projection (cleanup)
    await projectionBuilder.disposeProjection(`exp-${experimentId}`);
    
    // 10. Return completed experiment
    return await experimentTracker.getExperiment(experimentId);
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Experiment failed', { experimentId, error: message });
    
    // Update status to failed
    await experimentTracker.updateStatus(experimentId, 'failed');
    
    throw error;
  }
}

async function validateArtifacts(
  inputs: { alerts: string[]; ohlcv: string[]; strategies?: string[] },
  artifactStore: ArtifactStorePort
): Promise<void> {
  const allArtifactIds = [
    ...inputs.alerts,
    ...inputs.ohlcv,
    ...(inputs.strategies || []),
  ];
  
  logger.debug('Validating artifacts', { count: allArtifactIds.length });
  
  // Check all artifacts exist
  for (const artifactId of allArtifactIds) {
    await artifactStore.getArtifact(artifactId); // Throws if not found
  }
}

async function executeSimulation(
  duckdbPath: string,
  config: Record<string, unknown>
): Promise<SimulationResults> {
  // Call simulation engine (existing code)
  // This is where the actual backtest runs
  // Returns trades, metrics, curves, diagnostics
  
  // TODO: Integrate with existing simulation engine
  throw new Error('Not implemented - integrate with @quantbot/simulation');
}

async function publishResults(
  experimentId: string,
  results: SimulationResults,
  inputArtifactIds: { alerts: string[]; ohlcv: string[] },
  provenance: { gitCommit: string; gitDirty: boolean },
  artifactStore: ArtifactStorePort
): Promise<ExperimentResults> {
  // Publish trades artifact
  const tradesResult = await artifactStore.publishArtifact({
    artifactType: 'experiment_trades',
    schemaVersion: 1,
    logicalKey: `experiment=${experimentId}/trades`,
    dataPath: results.tradesPath,
    tags: { experiment_id: experimentId, type: 'trades' },
    inputArtifactIds: [...inputArtifactIds.alerts, ...inputArtifactIds.ohlcv],
    writerName: 'experiment-engine',
    writerVersion: '1.0.0',
    gitCommit: provenance.gitCommit,
    gitDirty: provenance.gitDirty,
    params: { experimentId },
  });
  
  // Publish metrics artifact
  const metricsResult = await artifactStore.publishArtifact({
    artifactType: 'experiment_metrics',
    schemaVersion: 1,
    logicalKey: `experiment=${experimentId}/metrics`,
    dataPath: results.metricsPath,
    tags: { experiment_id: experimentId, type: 'metrics' },
    inputArtifactIds: [...inputArtifactIds.alerts, ...inputArtifactIds.ohlcv],
    writerName: 'experiment-engine',
    writerVersion: '1.0.0',
    gitCommit: provenance.gitCommit,
    gitDirty: provenance.gitDirty,
    params: { experimentId },
  });
  
  return {
    tradesArtifactId: tradesResult.artifactId,
    metricsArtifactId: metricsResult.artifactId,
  };
}
```

**Files:**
- `packages/workflows/src/experiments/handlers/execute-experiment.ts` (new)

**Success Criteria:**
- ✅ Handler is pure (depends on ports only)
- ✅ Validates artifacts before execution
- ✅ Publishes results as artifacts
- ✅ Tracks lineage correctly

---

## PHASE V: CLI INTEGRATION (Week 5-6)

### FR-5.1: Artifact CLI Commands

**Description**: CLI commands for artifact operations

**Commands:**

```bash
# List artifacts
quantbot artifacts list --type alerts_v1 --status active --limit 10

# Get artifact details
quantbot artifacts get <artifact-id>

# Find by logical key
quantbot artifacts find --type alerts_v1 --key "day=2025-05-01/chain=solana"

# Get lineage
quantbot artifacts lineage <artifact-id>

# Get downstream
quantbot artifacts downstream <artifact-id>

# Publish artifact (dev/test)
quantbot artifacts publish \
  --type experiment_trades \
  --version 1 \
  --key "experiment=exp-123/trades" \
  --data /tmp/trades.csv \
  --tag experiment_id=exp-123 \
  --writer experiment-engine \
  --writer-version 1.0.0
```

**Handler:**

```typescript
// packages/cli/src/handlers/artifacts/list-artifacts.ts
import type { ArtifactStorePort, ArtifactFilter } from '@quantbot/core';
import type { CommandContext } from '../../core/command-context.js';

export interface ListArtifactsArgs {
  type?: string;
  status?: 'active' | 'superseded' | 'tombstoned';
  limit?: number;
}

export async function listArtifactsHandler(
  args: ListArtifactsArgs,
  ctx: CommandContext
) {
  const artifactStore = ctx.services.artifactStore();
  
  const filter: ArtifactFilter = {
    artifactType: args.type,
    status: args.status,
    limit: args.limit || 100,
  };
  
  const artifacts = await artifactStore.listArtifacts(filter);
  
  return artifacts;
}
```

**Files:**
- `packages/cli/src/handlers/artifacts/list-artifacts.ts` (new)
- `packages/cli/src/handlers/artifacts/get-artifact.ts` (new)
- `packages/cli/src/handlers/artifacts/find-artifact.ts` (new)
- `packages/cli/src/handlers/artifacts/get-lineage.ts` (new)
- `packages/cli/src/commands/artifacts.ts` (new)

**Success Criteria:**
- ✅ CLI commands work
- ✅ Handlers follow pattern (pure, depend on ports)
- ✅ Output formatting in executor

---

### FR-5.2: Experiment CLI Commands

**Description**: CLI commands for experiment operations

**Commands:**

```bash
# Create experiment
quantbot experiments create \
  --name "momentum-v1" \
  --alerts artifact-id-1,artifact-id-2 \
  --ohlcv artifact-id-3,artifact-id-4 \
  --strategy momentum \
  --from 2025-05-01 \
  --to 2025-05-31

# Execute experiment
quantbot experiments execute <experiment-id>

# Get experiment status
quantbot experiments get <experiment-id>

# List experiments
quantbot experiments list --status completed --limit 10

# Find experiments by input artifacts
quantbot experiments find-by-inputs --artifacts artifact-id-1,artifact-id-2
```

**Handler:**

```typescript
// packages/cli/src/handlers/experiments/execute-experiment.ts
import type { CommandContext } from '../../core/command-context.js';
import { executeExperiment } from '@quantbot/workflows/experiments';

export interface ExecuteExperimentArgs {
  experimentId: string;
}

export async function executeExperimentHandler(
  args: ExecuteExperimentArgs,
  ctx: CommandContext
) {
  const artifactStore = ctx.services.artifactStore();
  const projectionBuilder = ctx.services.projectionBuilder();
  const experimentTracker = ctx.services.experimentTracker();
  
  // Get experiment definition
  const experiment = await experimentTracker.getExperiment(args.experimentId);
  
  // Execute experiment
  const result = await executeExperiment(experiment, {
    artifactStore,
    projectionBuilder,
    experimentTracker,
  });
  
  return result;
}
```

**Files:**
- `packages/cli/src/handlers/experiments/create-experiment.ts` (new)
- `packages/cli/src/handlers/experiments/execute-experiment.ts` (new)
- `packages/cli/src/handlers/experiments/get-experiment.ts` (new)
- `packages/cli/src/handlers/experiments/list-experiments.ts` (new)
- `packages/cli/src/commands/experiments.ts` (new)

**Success Criteria:**
- ✅ CLI commands work
- ✅ Handlers are pure
- ✅ End-to-end experiment flow works

---

## PHASE VI: ALERT INGESTION INTEGRATION (Week 6-7)

### FR-6.1: Alert Ingestion with Artifact Store

**Description**: Integrate alert ingestion with artifact store

**Pipeline:**

```
Telegram Export (JSON)
       ↓
Staging (normalize, validate)
       ↓
Write to temp Parquet
       ↓
Publish via ArtifactStorePort
       ↓
Manifest Registration
       ↓
(Optional) Build DuckDB projection
```

**Handler:**

```typescript
// packages/ingestion/src/handlers/ingest-telegram-alerts.ts
import type { ArtifactStorePort } from '@quantbot/core';
import type { CommandContext } from '@quantbot/cli/core/command-context';

export interface IngestTelegramAlertsArgs {
  exportPath: string;
  chain: 'solana' | 'evm';
  date: string; // YYYY-MM-DD
}

export async function ingestTelegramAlertsHandler(
  args: IngestTelegramAlertsArgs,
  ctx: CommandContext
) {
  const artifactStore = ctx.services.artifactStore();
  
  // 1. Load and normalize alerts
  const alerts = await loadTelegramExport(args.exportPath);
  const normalized = await normalizeAlerts(alerts, args.chain);
  
  // 2. Validate alerts
  const { valid, invalid } = await validateAlerts(normalized);
  
  // 3. Quarantine invalid alerts
  if (invalid.length > 0) {
    await quarantineAlerts(invalid, artifactStore);
  }
  
  // 4. Write valid alerts to temp Parquet
  const tempPath = await writeTempParquet(valid);
  
  // 5. Publish as artifact
  const result = await artifactStore.publishArtifact({
    artifactType: 'alerts_v1',
    schemaVersion: 1,
    logicalKey: `day=${args.date}/chain=${args.chain}`,
    dataPath: tempPath,
    tags: {
      source: 'telegram',
      chain: args.chain,
      date: args.date,
    },
    inputArtifactIds: [],
    writerName: 'telegram-ingestion',
    writerVersion: '1.0.0',
    gitCommit: await getGitCommit(),
    gitDirty: await isGitDirty(),
    params: { exportPath: args.exportPath },
  });
  
  // 6. Cleanup temp file
  await cleanupTempFile(tempPath);
  
  return {
    artifactId: result.artifactId,
    deduped: result.deduped,
    validCount: valid.length,
    invalidCount: invalid.length,
  };
}
```

**Files:**
- `packages/ingestion/src/handlers/ingest-telegram-alerts.ts` (new)
- `packages/cli/src/handlers/ingestion/ingest-telegram-alerts.ts` (new)
- `packages/cli/src/commands/ingestion.ts` (extend)

**Success Criteria:**
- ✅ Alerts ingested as artifacts
- ✅ Deduplication at artifact level
- ✅ Invalid alerts quarantined
- ✅ Provenance tracked

---

## PHASE VII: OHLCV SLICE INTEGRATION (Week 7-8)

### FR-7.1: OHLCV Slice Export with Artifact Store

**Description**: Integrate OHLCV slice export with artifact store

**Pipeline:**

```
ClickHouse (OHLCV tables)
       ↓
Slice Export (token + date range)
       ↓
Write to temp Parquet
       ↓
Publish via ArtifactStorePort
       ↓
Manifest Registration
       ↓
Coverage Analysis
```

**Handler:**

```typescript
// packages/ohlcv/src/handlers/export-ohlcv-slice.ts
import type { ArtifactStorePort } from '@quantbot/core';
import type { CommandContext } from '@quantbot/cli/core/command-context';

export interface ExportOhlcvSliceArgs {
  token: string;
  resolution: string; // 1m, 5m, etc.
  from: string; // ISO8601
  to: string; // ISO8601
  chain: string;
}

export async function exportOhlcvSliceHandler(
  args: ExportOhlcvSliceArgs,
  ctx: CommandContext
) {
  const artifactStore = ctx.services.artifactStore();
  const clickhouse = ctx.services.clickhouse();
  
  // 1. Query ClickHouse for candles
  const candles = await clickhouse.getCandles({
    tokenAddress: args.token,
    chain: args.chain,
    interval: args.resolution,
    dateRange: { from: args.from, to: args.to },
  });
  
  // 2. Validate coverage
  const coverage = await validateCoverage(candles, args);
  
  // 3. Write to temp Parquet
  const tempPath = await writeTempParquet(candles);
  
  // 4. Publish as artifact
  const result = await artifactStore.publishArtifact({
    artifactType: 'ohlcv_slice_v2',
    schemaVersion: 2,
    logicalKey: `token=${args.token}/res=${args.resolution}/from=${args.from}/to=${args.to}`,
    dataPath: tempPath,
    tags: {
      token: args.token,
      resolution: args.resolution,
      chain: args.chain,
    },
    inputArtifactIds: [],
    writerName: 'ohlcv-slice-exporter',
    writerVersion: '2.0.0',
    gitCommit: await getGitCommit(),
    gitDirty: await isGitDirty(),
    params: args,
  });
  
  // 5. Cleanup temp file
  await cleanupTempFile(tempPath);
  
  return {
    artifactId: result.artifactId,
    deduped: result.deduped,
    rowCount: candles.length,
    coverage,
  };
}
```

**Files:**
- `packages/ohlcv/src/handlers/export-ohlcv-slice.ts` (new)
- `packages/cli/src/handlers/ohlcv/export-slice.ts` (new)
- `packages/cli/src/commands/ohlcv.ts` (extend)

**Success Criteria:**
- ✅ OHLCV slices published as artifacts
- ✅ Coverage validated
- ✅ Slices reusable across experiments

---

## Implementation Plan

### Phase I: Artifact Store Integration (Week 1-2)

**Tasks:**
1. Create `ArtifactStorePort` in `@quantbot/core`
2. Create `ArtifactStoreAdapter` in `@quantbot/storage`
3. Create `artifact_store_ops.py` wrapper
4. Add to `CommandContext`
5. Write unit tests
6. Write integration tests

**Deliverables:**
- Port interface
- Adapter implementation
- Python wrapper
- Unit tests
- Integration tests

**Success Criteria:**
- ✅ Port interface defined in `@quantbot/core`
- ✅ Adapter implements port using PythonEngine
- ✅ Python wrapper script works
- ✅ Handlers can depend on port (not adapter)
- ✅ Follows existing ports/adapters pattern
- ✅ **No separate bridge package created**

### Phase II: Projection Builder (Week 2-3)

**Tasks:**
1. Create `ProjectionBuilderPort` in `@quantbot/core`
2. Create `ProjectionBuilderAdapter` in `@quantbot/storage`
3. Implement DuckDB table creation from Parquet
4. Add cache management
5. Test rebuild mechanism

**Deliverables:**
- Port interface
- Adapter implementation
- Projection builder tests
- Cache invalidation tests

**Success Criteria:**
- ✅ DuckDB projections built from Parquet
- ✅ Projections are deterministic
- ✅ Projections are rebuildable
- ✅ Cache management works

### Phase III: Experiment Tracking (Week 3-4)

**Tasks:**
1. Create `ExperimentTrackerPort` in `@quantbot/core`
2. Create `ExperimentTrackerAdapter` in `@quantbot/storage`
3. Create `experiment_tracker_ops.py` wrapper
4. Add experiment schema (DuckDB)
5. Test experiment tracking

**Deliverables:**
- Port interface
- Adapter implementation
- Python wrapper
- DuckDB schema
- Tests

**Success Criteria:**
- ✅ Experiments tracked with artifact lineage
- ✅ Status updates work
- ✅ Results stored correctly

### Phase IV: Experiment Execution (Week 4-5)

**Tasks:**
1. Create `executeExperiment` handler
2. Integrate with simulation engine
3. Implement result publishing
4. Test end-to-end flow

**Deliverables:**
- Experiment execution handler
- Integration with simulation
- End-to-end tests

**Success Criteria:**
- ✅ Experiments execute with frozen artifacts
- ✅ Results published as artifacts
- ✅ Lineage tracked correctly

### Phase V: CLI Integration (Week 5-6)

**Tasks:**
1. Create artifact CLI commands
2. Create experiment CLI commands
3. Add handlers for all commands
4. Write CLI tests

**Deliverables:**
- Artifact CLI commands
- Experiment CLI commands
- CLI tests

**Success Criteria:**
- ✅ All CLI commands work
- ✅ Handlers follow pattern
- ✅ Output formatting correct

### Phase VI: Alert Ingestion Integration (Week 6-7)

**Tasks:**
1. Refactor alert ingestion to use artifact store
2. Implement quarantine mechanism
3. Test deduplication
4. Migrate existing alerts

**Deliverables:**
- Alert ingestion handler
- Quarantine mechanism
- Migration script

**Success Criteria:**
- ✅ Alerts ingested as artifacts
- ✅ Deduplication works
- ✅ Invalid alerts quarantined

### Phase VII: OHLCV Slice Integration (Week 7-8)

**Tasks:**
1. Refactor OHLCV slice export to use artifact store
2. Add coverage validation
3. Test slice reuse
4. Migrate existing slices

**Deliverables:**
- OHLCV slice handler
- Coverage validation
- Migration script

**Success Criteria:**
- ✅ OHLCV slices published as artifacts
- ✅ Coverage validated
- ✅ Slices reusable

---

## Success Criteria (Overall)

### Architectural Invariants (Enforced)

1. ✅ **Parquet is Truth**: All authoritative data in immutable Parquet
2. ✅ **DuckDB is Disposable**: Can delete and rebuild without data loss
3. ✅ **Idempotency Everywhere**: Safe to re-run any pipeline step
4. ✅ **Lineage is Complete**: Every artifact declares its inputs
5. ✅ **Ports/Adapters Pattern**: Handlers depend on ports, adapters implement ports

### Integration Complete

1. ✅ Artifact store integrated via ports/adapters
2. ✅ Experiments track frozen artifact sets
3. ✅ Results published as artifacts with lineage
4. ✅ DuckDB projections built on-demand
5. ✅ CLI commands work end-to-end

### Reproducibility Guaranteed

1. ✅ Same artifact set + same config → same results
2. ✅ Full provenance (git commit, params, timestamps)
3. ✅ Lineage queries work (results → inputs)
4. ✅ Can reproduce any historical experiment

---

## Technical Specifications

### Technology Stack

- **TypeScript**: 5.9+ (handlers, ports, adapters)
- **Python**: 3.10+ (artifact store, wrapper scripts)
- **DuckDB**: 0.9+ (projections, experiment tracking)
- **SQLite**: 3.x (artifact manifest)
- **pnpm**: Workspace management
- **zod**: Schema validation

### Environment Variables

```bash
# Artifact store configuration
export ARTIFACT_MANIFEST_DB="/home/memez/opn/manifest/manifest.sqlite"
export ARTIFACTS_ROOT="/home/memez/opn/artifacts"

# Cache configuration
export PROJECTION_CACHE_DIR="/home/memez/opn/cache"

# Experiment tracking
export EXPERIMENT_DB="/home/memez/opn/data/experiments.duckdb"
```

### Dependencies

**Core Package:**
- `luxon` - Date/time
- `zod` - Validation

**Storage Package:**
- `@quantbot/core` - Ports
- `@quantbot/utils` - PythonEngine
- `duckdb` - DuckDB client

**Utils Package:**
- `execa` - Subprocess execution (PythonEngine)

**Artifact Store Package (Python):**
- `duckdb>=0.9` - DuckDB Python
- `pandas>=2.0` - DataFrame operations

---

## Architectural Guarantees

### 1. Separation of Concerns

```
@quantbot/core (ports)
    ↑ depends on
@quantbot/storage (adapters)
    ↑ depends on
@quantbot/workflows (handlers)
    ↑ depends on
@quantbot/cli (commands)
```

**Enforcement:**
- ESLint rules block reverse dependencies
- Architecture tests verify import graph
- Code review enforces pattern

### 2. Determinism

**Guaranteed:**
- Same artifact set + same config + same seed → same results
- Deterministic RNG for all randomness
- Versioned inputs (contract version, data version, strategy version)
- Content hashing ensures semantic identity

**Enforcement:**
- Simulation contract includes seed
- Tests verify determinism
- No `Date.now()` or `Math.random()` in handlers

### 3. Immutability

**Guaranteed:**
- Parquet artifacts never mutated
- DuckDB projections are disposable
- Manifest tracks supersession (not deletion)

**Enforcement:**
- Artifact store enforces immutability
- No direct DuckDB writes in handlers
- Architecture tests verify

### 4. Lineage

**Guaranteed:**
- Every artifact declares inputs
- Experiments track input artifacts
- Results track experiment artifacts

**Enforcement:**
- Manifest schema requires lineage
- Artifact store validates lineage
- Queries verify completeness

---

## Testing Strategy

### Unit Tests

**Handlers:**
- Test with mock ports
- Verify pure orchestration
- No I/O in tests

**Adapters:**
- Test with real Python scripts
- Verify schema validation
- Test error handling

### Integration Tests

**End-to-End:**
- Ingest alerts → publish artifact → build projection → execute experiment → publish results
- Verify lineage tracking
- Verify deduplication
- Verify reproducibility

**Projection Rebuild:**
- Delete DuckDB
- Rebuild from Parquet
- Verify same data

### Contract Tests

**Artifact Store:**
- Verify Python wrapper matches port interface
- Test all operations
- Verify error handling

**Projection Builder:**
- Verify DuckDB tables match Parquet
- Test index creation
- Verify deterministic ordering

---

## Migration Strategy

### Phase 1: Parallel Operation (Week 1-2)

- Artifact store available but not required
- Existing workflows continue using DuckDB
- New workflows use artifact store

### Phase 2: Gradual Migration (Week 3-6)

- Alert ingestion migrated to artifact store
- OHLCV slice export migrated to artifact store
- Experiments start using artifact-based projections

### Phase 3: Deprecation (Week 7-8)

- Legacy DuckDB tables marked deprecated
- Warnings added for direct DuckDB writes
- Documentation updated

### Phase 4: Enforcement (Week 9+)

- Architecture tests fail on direct DuckDB writes
- Legacy code removed
- Full artifact-first enforcement

---

## Open Questions

1. **Python Environment**: Use dedicated venv or system Python?
2. **Cache Invalidation**: How to handle when artifacts are superseded?
3. **Artifact Retention**: Retention policy for superseded artifacts?
4. **Performance**: Optimize for large artifact sets (millions of rows)?
5. **Concurrency**: Handle concurrent artifact publishing?

---

## Summary

This consolidated architecture:

1. **Uses existing infrastructure**: `/home/memez/opn` data lake with 4,899 artifacts
2. **Follows ports/adapters pattern**: No separate bridge package needed
3. **Reuses PythonEngine**: Existing pattern for Python integration
4. **Enforces Parquet-first**: DuckDB is disposable, Parquet is truth
5. **Tracks lineage**: Every artifact declares inputs
6. **Guarantees reproducibility**: Same inputs → same outputs

**Timeline**: 8 weeks to full integration

**Outcome**: Research lab with reproducibility guarantees, artifact lineage, and disposable DuckDB projections.

