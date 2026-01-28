# PRD Correction: Artifact Store Integration Using Ports/Adapters Pattern

## Correction Summary

**Original Approach (INCORRECT)**: Create separate `@quantbot/artifact-store-bridge` package

**Correct Approach**: Follow existing ports/adapters/handlers pattern

---

## Correct Architecture

```
Handler (pure orchestration)
    ↓ depends on
Port Interface (types only, in @quantbot/core)
    ↑ implemented by
Adapter (I/O, in @quantbot/storage, uses PythonEngine)
    ↓ calls
Python Artifact Store (existing)
```

**Key Insight**: We already have `PythonEngine` in `@quantbot/utils` that handles subprocess execution, JSON I/O, and schema validation. We don't need a separate bridge package.

---

## FR-1 CORRECTED: Artifact Store Port and Adapter

### Port Interface (Types Only)

**Location**: `packages/core/src/ports/artifact-store-port.ts`

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
   * Publish DataFrame as Parquet artifact
   */
  publishDataFrame(request: PublishRequest): Promise<PublishResult>;
  
  /**
   * Get artifact lineage (inputs)
   */
  getLineage(artifactId: string): Promise<ArtifactLineage>;
  
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

export interface PublishRequest {
  artifactType: string;
  schemaVersion: number;
  logicalKey: string;
  dataPath: string; // Path to CSV/Parquet file
  tags?: Record<string, string>;
  inputArtifactIds?: string[];
  writerName: string;
  writerVersion: string;
  gitCommit: string;
  gitDirty: boolean;
  params?: Record<string, unknown>;
}

export interface PublishResult {
  success: boolean;
  deduped: boolean;
  mode?: 'file_hash' | 'content_hash';
  existingArtifactId?: string;
  artifactId?: string;
  error?: string;
}
```

### Adapter Implementation (I/O)

**Location**: `packages/storage/src/adapters/artifact-store-adapter.ts`

```typescript
import { join } from 'path';
import { z } from 'zod';
import type {
  ArtifactStorePort,
  Artifact,
  ArtifactFilter,
  PublishRequest,
  PublishResult,
} from '@quantbot/core';
import { PythonEngine } from '@quantbot/utils';
import { logger, findWorkspaceRoot } from '@quantbot/infra/utils';

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
  minTs: z.string().optional(),
  maxTs: z.string().optional(),
  createdAt: z.string(),
});

const PublishResultSchema = z.object({
  success: z.boolean(),
  deduped: z.boolean(),
  mode: z.enum(['file_hash', 'content_hash']).optional(),
  existingArtifactId: z.string().optional(),
  artifactId: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Artifact Store Adapter
 *
 * Implements ArtifactStorePort using Python artifact store.
 * Uses PythonEngine to call Python scripts (following existing pattern).
 */
export class ArtifactStoreAdapter implements ArtifactStorePort {
  private readonly pythonEngine: PythonEngine;
  private readonly scriptPath: string;
  private readonly manifestDb: string;
  private readonly artifactsRoot: string;

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
  }

  async getArtifact(artifactId: string): Promise<Artifact> {
    logger.debug('Getting artifact', { artifactId });
    
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

  async publishDataFrame(request: PublishRequest): Promise<PublishResult> {
    logger.info('Publishing artifact', {
      artifactType: request.artifactType,
      logicalKey: request.logicalKey,
    });
    
    const result = await this.pythonEngine.runScriptWithStdin(
      this.scriptPath,
      {
        operation: 'publish_dataframe',
        manifest_db: this.manifestDb,
        artifacts_root: this.artifactsRoot,
        ...request,
      },
      PublishResultSchema
    );
    
    if (result.deduped) {
      logger.info('Artifact deduplicated', {
        mode: result.mode,
        existingArtifactId: result.existingArtifactId,
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
      z.object({
        artifactId: z.string(),
        inputs: z.array(ArtifactSchema),
        depth: z.number(),
      })
    );
    
    return result;
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

### Python Wrapper Script

**Location**: `tools/storage/artifact_store_ops.py`

```python
"""
Artifact Store Operations

Wrapper script for artifact_store Python package.
Provides JSON stdin/stdout interface for TypeScript integration via PythonEngine.

Follows existing pattern used by other Python tools in tools/storage/.
"""

import json
import sys
from pathlib import Path

# Import artifact_store package
from artifact_store.manifest import (
    connect_manifest,
    apply_migrations,
)
from artifact_store.publisher import publish_dataframe
import pandas as pd


def get_artifact(manifest_db: str, artifact_id: str):
    """Get artifact by ID"""
    con = connect_manifest(Path(manifest_db))
    row = con.execute(
        "SELECT * FROM artifacts WHERE artifact_id = ?",
        (artifact_id,)
    ).fetchone()
    con.close()
    
    if row is None:
        raise ValueError(f"Artifact not found: {artifact_id}")
    
    # Convert SQLite row to dict with camelCase keys
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


def list_artifacts(manifest_db: str, filter_dict: dict):
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
    
    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
    limit = filter_dict.get('limit', 100)
    
    rows = con.execute(
        f"SELECT * FROM artifacts WHERE {where_sql} ORDER BY created_at DESC LIMIT ?",
        (*params, limit)
    ).fetchall()
    con.close()
    
    # Convert rows to dicts with camelCase keys
    return [
        {
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
        for row in rows
    ]


def publish_dataframe_op(manifest_db: str, artifacts_root: str, request: dict):
    """Publish DataFrame as artifact"""
    # Load data from file
    data_path = request['dataPath']
    if data_path.endswith('.csv'):
        df = pd.read_csv(data_path)
    elif data_path.endswith('.parquet'):
        df = pd.read_parquet(data_path)
    else:
        raise ValueError(f"Unsupported file format: {data_path}")
    
    # Get manifest SQL path (relative to this script)
    manifest_sql = Path(__file__).parent.parent / 'packages/artifact_store/artifact_store/sql/manifest_v1.sql'
    
    # Publish using artifact_store
    result = publish_dataframe(
        manifest_db=Path(manifest_db),
        manifest_sql=manifest_sql,
        artifacts_root=Path(artifacts_root),
        artifact_type=request['artifactType'],
        schema_version=request['schemaVersion'],
        logical_key=request['logicalKey'],
        df=df,
        tags=[(k, v) for k, v in request.get('tags', {}).items()],
        input_artifact_ids=request.get('inputArtifactIds', []),
        writer_name=request['writerName'],
        writer_version=request['writerVersion'],
        git_commit=request['gitCommit'],
        git_dirty=request['gitDirty'],
        params=request.get('params', {}),
    )
    
    # Return result with camelCase keys
    return {
        'success': True,
        'deduped': result.get('deduped', False),
        'mode': result.get('mode'),
        'existingArtifactId': result.get('existing_artifact_id'),
        'artifactId': result.get('artifact_id'),
    }


def get_lineage(manifest_db: str, artifact_id: str):
    """Get artifact lineage (inputs)"""
    con = connect_manifest(Path(manifest_db))
    
    # Get input artifacts
    rows = con.execute(
        """
        SELECT a.* FROM artifacts a
        JOIN artifact_lineage l ON a.artifact_id = l.input_artifact_id
        WHERE l.artifact_id = ?
        """,
        (artifact_id,)
    ).fetchall()
    con.close()
    
    inputs = [
        {
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
        for row in rows
    ]
    
    return {
        'artifactId': artifact_id,
        'inputs': inputs,
        'depth': 1,  # Simple implementation, can be extended for recursive lineage
    }


def health_check(manifest_db: str):
    """Check if artifact store is available"""
    try:
        con = connect_manifest(Path(manifest_db))
        con.execute("SELECT 1").fetchone()
        con.close()
        return {'available': True}
    except Exception as e:
        return {'available': False, 'error': str(e)}


def main():
    """Main entry point - reads JSON from stdin, executes operation, writes JSON to stdout"""
    try:
        input_data = json.load(sys.stdin)
        operation = input_data['operation']
        
        if operation == 'get_artifact':
            result = get_artifact(input_data['manifest_db'], input_data['artifact_id'])
        elif operation == 'list_artifacts':
            result = list_artifacts(input_data['manifest_db'], input_data.get('filter', {}))
        elif operation == 'publish_dataframe':
            result = publish_dataframe_op(
                input_data['manifest_db'],
                input_data['artifacts_root'],
                input_data
            )
        elif operation == 'get_lineage':
            result = get_lineage(input_data['manifest_db'], input_data['artifact_id'])
        elif operation == 'health_check':
            result = health_check(input_data['manifest_db'])
        else:
            raise ValueError(f"Unknown operation: {operation}")
        
        json.dump(result, sys.stdout, indent=2)
        sys.exit(0)
    except Exception as e:
        json.dump({'error': str(e)}, sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
```

---

## Handler Example (Pure Orchestration)

**Location**: `packages/workflows/src/experiments/handlers/publish-experiment-results.ts`

```typescript
import type { ArtifactStorePort, PublishRequest } from '@quantbot/core';
import type { ExperimentResults } from '../types.js';

/**
 * Publish Experiment Results Handler
 *
 * Pure orchestration - no I/O, no subprocess calls.
 * Depends on ArtifactStorePort (not adapter).
 */
export async function publishExperimentResults(
  experimentId: string,
  results: ExperimentResults,
  artifactStore: ArtifactStorePort, // Port dependency, not adapter
  gitCommit: string,
  gitDirty: boolean
): Promise<{ tradesArtifactId: string; metricsArtifactId: string }> {
  // 1. Write trades to temp file (or use existing file)
  const tradesPath = results.tradesPath; // Assume already written
  
  // 2. Publish trades artifact
  const tradesResult = await artifactStore.publishDataFrame({
    artifactType: 'experiment_trades',
    schemaVersion: 1,
    logicalKey: `experiment=${experimentId}/trades`,
    dataPath: tradesPath,
    tags: { experiment_id: experimentId, type: 'trades' },
    inputArtifactIds: results.inputArtifactIds,
    writerName: 'experiment-engine',
    writerVersion: '1.0.0',
    gitCommit,
    gitDirty,
    params: { experimentId },
  });
  
  if (!tradesResult.success) {
    throw new Error(`Failed to publish trades: ${tradesResult.error}`);
  }
  
  // 3. Publish metrics artifact
  const metricsPath = results.metricsPath;
  const metricsResult = await artifactStore.publishDataFrame({
    artifactType: 'experiment_metrics',
    schemaVersion: 1,
    logicalKey: `experiment=${experimentId}/metrics`,
    dataPath: metricsPath,
    tags: { experiment_id: experimentId, type: 'metrics' },
    inputArtifactIds: results.inputArtifactIds,
    writerName: 'experiment-engine',
    writerVersion: '1.0.0',
    gitCommit,
    gitDirty,
    params: { experimentId },
  });
  
  if (!metricsResult.success) {
    throw new Error(`Failed to publish metrics: ${metricsResult.error}`);
  }
  
  return {
    tradesArtifactId: tradesResult.artifactId!,
    metricsArtifactId: metricsResult.artifactId!,
  };
}
```

---

## Composition Root (Wiring)

**Location**: `packages/cli/src/core/command-context.ts`

```typescript
import { ArtifactStoreAdapter } from '@quantbot/storage';
import { PythonEngine } from '@quantbot/utils';

export class CommandContext {
  // ... existing services ...
  
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

---

## Key Benefits of This Approach

1. **Follows Existing Pattern**: Same as `DuckDbSliceAnalyzerAdapter`, `CanonicalDuckDBAdapter`, etc.
2. **No New Package**: Uses existing `@quantbot/core` (ports) and `@quantbot/storage` (adapters)
3. **Reuses PythonEngine**: No need to reinvent subprocess handling
4. **Testable Handlers**: Handlers depend on port, can be tested with mocks
5. **Clean Boundaries**: Port in `core`, adapter in `storage`, Python in `tools`

---

## Files to Create

1. `packages/core/src/ports/artifact-store-port.ts` (port interface)
2. `packages/storage/src/adapters/artifact-store-adapter.ts` (adapter implementation)
3. `tools/storage/artifact_store_ops.py` (Python wrapper)

**No separate package needed!**

---

## Updated Implementation Plan

### Phase 1: Port and Adapter (Week 1)

**Tasks:**
1. Create `ArtifactStorePort` in `@quantbot/core`
2. Create `ArtifactStoreAdapter` in `@quantbot/storage`
3. Create `artifact_store_ops.py` wrapper
4. Add to `CommandContext`
5. Write unit tests

**Deliverables:**
- Port interface
- Adapter implementation
- Python wrapper
- Unit tests
- Integration tests

### Success Criteria

- ✅ Port interface defined in `@quantbot/core`
- ✅ Adapter implements port using PythonEngine
- ✅ Python wrapper script works
- ✅ Handlers can depend on port (not adapter)
- ✅ Follows existing ports/adapters pattern
- ✅ No separate bridge package created

