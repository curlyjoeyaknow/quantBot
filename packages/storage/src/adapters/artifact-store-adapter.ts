import { join } from 'path';
import { z } from 'zod';
import type {
  ArtifactStorePort,
  ArtifactManifestRecord,
  ArtifactFilter,
  PublishArtifactRequest,
  PublishArtifactResult,
  ArtifactLineage,
} from '@quantbot/core';
import { PythonEngine } from '@quantbot/utils';
import {
  logger,
  findWorkspaceRoot,
  NotFoundError,
  AppError,
  retryWithBackoff,
} from '@quantbot/infra/utils';

/**
 * Zod schemas for validation
 *
 * Note on null handling:
 * - Python returns `null` for optional timestamp fields (minTs, maxTs)
 * - TypeScript interface expects `string | undefined`
 * - Transform converts `null` → `undefined` to match TypeScript expectations
 * - This is intentional: Python uses null for "no value", TypeScript uses undefined
 */
const ArtifactSchema = z
  .object({
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
  })
  .transform((data) => ({
    ...data,
    // Convert Python null → TypeScript undefined for optional fields
    minTs: data.minTs ?? undefined,
    maxTs: data.maxTs ?? undefined,
  }));

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
 * Features:
 * - Retry logic for transient failures
 * - Metrics tracking (operation times, success rates)
 * - Input validation (handled by Python script)
 *
 * Pattern: Same as DuckDbSliceAnalyzerAdapter, CanonicalDuckDBAdapter, etc.
 */
export class ArtifactStoreAdapter implements ArtifactStorePort {
  private readonly pythonEngine: PythonEngine;
  private readonly scriptPath: string;
  private readonly manifestDb: string;
  private readonly artifactsRoot: string;
  private readonly manifestSql: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  // Metrics tracking
  private readonly operationMetrics: Map<
    string,
    { count: number; totalTimeMs: number; errors: number; deduplications: number }
  > = new Map();

  constructor(
    manifestDb: string,
    artifactsRoot: string,
    pythonEngine?: PythonEngine,
    options?: {
      maxRetries?: number;
      retryDelayMs?: number;
    }
  ) {
    this.manifestDb = manifestDb;
    this.artifactsRoot = artifactsRoot;
    this.pythonEngine = pythonEngine || new PythonEngine();
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;

    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/artifact_store_ops.py');
    this.manifestSql = join(
      workspaceRoot,
      'packages/artifact_store/artifact_store/sql/manifest_v1.sql'
    );
  }

  /**
   * Execute Python script with retry logic and metrics tracking
   */
  private async executeWithRetry<T>(
    operation: string,
    input: Record<string, unknown>,
    schema: z.ZodSchema<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await retryWithBackoff(
        async () => {
          return await this.pythonEngine.runScriptWithStdin(this.scriptPath, input, schema);
        },
        this.maxRetries,
        this.retryDelayMs,
        {
          operation,
          ...context,
        }
      );

      const duration = Date.now() - startTime;
      this.recordMetric(operation, duration, false, false);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordMetric(operation, duration, true, false);

      // Re-throw with context
      throw error;
    }
  }

  /**
   * Record operation metrics
   */
  private recordMetric(
    operation: string,
    durationMs: number,
    isError: boolean,
    isDeduplication: boolean
  ): void {
    const existing = this.operationMetrics.get(operation) || {
      count: 0,
      totalTimeMs: 0,
      errors: 0,
      deduplications: 0,
    };

    existing.count++;
    existing.totalTimeMs += durationMs;
    if (isError) {
      existing.errors++;
    }
    if (isDeduplication) {
      existing.deduplications++;
    }

    this.operationMetrics.set(operation, existing);
  }

  /**
   * Get operation metrics
   */
  getMetrics(): Record<
    string,
    {
      count: number;
      avgTimeMs: number;
      totalTimeMs: number;
      errorRate: number;
      deduplicationRate: number;
    }
  > {
    const result: Record<
      string,
      {
        count: number;
        avgTimeMs: number;
        totalTimeMs: number;
        errorRate: number;
        deduplicationRate: number;
      }
    > = {};

    for (const [operation, metrics] of this.operationMetrics.entries()) {
      result[operation] = {
        count: metrics.count,
        avgTimeMs: metrics.count > 0 ? metrics.totalTimeMs / metrics.count : 0,
        totalTimeMs: metrics.totalTimeMs,
        errorRate: metrics.count > 0 ? metrics.errors / metrics.count : 0,
        deduplicationRate: metrics.count > 0 ? metrics.deduplications / metrics.count : 0,
      };
    }

    return result;
  }

  async getArtifact(artifactId: string): Promise<ArtifactManifestRecord> {
    logger.debug('Getting artifact', { artifactId });

    try {
      const result = await this.executeWithRetry(
        'get_artifact',
        {
          operation: 'get_artifact',
          manifest_db: this.manifestDb,
          artifact_id: artifactId,
        },
        ArtifactSchema,
        { artifactId }
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

  async listArtifacts(filter: ArtifactFilter): Promise<ArtifactManifestRecord[]> {
    logger.debug('Listing artifacts', { filter });

    return this.executeWithRetry(
      'list_artifacts',
      {
        operation: 'list_artifacts',
        manifest_db: this.manifestDb,
        filter,
      },
      z.array(ArtifactSchema),
      { filter: filter.artifactType }
    );
  }

  async findByLogicalKey(
    artifactType: string,
    logicalKey: string
  ): Promise<ArtifactManifestRecord[]> {
    logger.debug('Finding artifacts by logical key', { artifactType, logicalKey });

    return this.executeWithRetry(
      'find_by_logical_key',
      {
        operation: 'find_by_logical_key',
        manifest_db: this.manifestDb,
        artifact_type: artifactType,
        logical_key: logicalKey,
      },
      z.array(ArtifactSchema),
      { artifactType, logicalKey }
    );
  }

  async publishArtifact(request: PublishArtifactRequest): Promise<PublishArtifactResult> {
    logger.info('Publishing artifact', {
      artifactType: request.artifactType,
      logicalKey: request.logicalKey,
      dataPath: request.dataPath,
    });

    const startTime = Date.now();
    const result = await this.executeWithRetry(
      'publish_artifact',
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
      PublishArtifactResultSchema,
      {
        artifactType: request.artifactType,
        logicalKey: request.logicalKey,
      }
    );

    // Record deduplication metric
    const duration = Date.now() - startTime;
    this.recordMetric('publish_artifact', duration, false, result.deduped);

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

    return this.executeWithRetry(
      'get_lineage',
      {
        operation: 'get_lineage',
        manifest_db: this.manifestDb,
        artifact_id: artifactId,
      },
      ArtifactLineageSchema,
      { artifactId }
    );
  }

  async getDownstream(artifactId: string): Promise<ArtifactManifestRecord[]> {
    logger.debug('Getting downstream artifacts', { artifactId });

    return this.executeWithRetry(
      'get_downstream',
      {
        operation: 'get_downstream',
        manifest_db: this.manifestDb,
        artifact_id: artifactId,
      },
      z.array(ArtifactSchema),
      { artifactId }
    );
  }

  async supersede(newArtifactId: string, oldArtifactId: string): Promise<void> {
    logger.info('Superseding artifact', { newArtifactId, oldArtifactId });

    await this.executeWithRetry(
      'supersede',
      {
        operation: 'supersede',
        manifest_db: this.manifestDb,
        new_artifact_id: newArtifactId,
        old_artifact_id: oldArtifactId,
      },
      z.object({ success: z.boolean() }),
      { newArtifactId, oldArtifactId }
    );
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.executeWithRetry(
        'health_check',
        { operation: 'health_check', manifest_db: this.manifestDb },
        z.object({ available: z.boolean() }),
        {}
      );
      return result.available;
    } catch (error) {
      logger.warn('Artifact store not available', { error });
      return false;
    }
  }
}
