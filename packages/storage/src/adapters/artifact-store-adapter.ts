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

