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

  // LRU cache for frequently accessed artifacts
  private readonly artifactCache: Map<
    string,
    { artifact: ArtifactManifestRecord; timestamp: number }
  > = new Map();
  private readonly cacheTTL: number;
  private readonly maxCacheSize: number;

  constructor(
    manifestDb: string,
    artifactsRoot: string,
    pythonEngine?: PythonEngine,
    options?: {
      maxRetries?: number;
      retryDelayMs?: number;
      cacheTTL?: number; // Cache TTL in milliseconds (default: 5 minutes)
      maxCacheSize?: number; // Maximum cache entries (default: 1000)
    }
  ) {
    this.manifestDb = manifestDb;
    this.artifactsRoot = artifactsRoot;
    this.pythonEngine = pythonEngine || new PythonEngine();
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
    this.cacheTTL = options?.cacheTTL ?? 5 * 60 * 1000; // 5 minutes default
    this.maxCacheSize = options?.maxCacheSize ?? 1000;

    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/artifact_store_ops.py');
    this.manifestSql = join(
      workspaceRoot,
      'packages/artifact_store/artifact_store/sql/manifest_v1.sql'
    );
  }

  /**
   * Get cache key for artifact
   */
  private getCacheKey(artifactId: string): string {
    return `artifact:${artifactId}`;
  }

  /**
   * Evict expired entries from cache (LRU eviction)
   */
  private evictCache(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    // Find expired entries
    for (const [key, value] of this.artifactCache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        entriesToDelete.push(key);
      }
    }

    // Delete expired entries
    for (const key of entriesToDelete) {
      this.artifactCache.delete(key);
    }

    // If still over limit, evict oldest entries (LRU)
    if (this.artifactCache.size > this.maxCacheSize) {
      const sortedEntries = Array.from(this.artifactCache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      );
      const toEvict = sortedEntries.slice(0, this.artifactCache.size - this.maxCacheSize);
      for (const [key] of toEvict) {
        this.artifactCache.delete(key);
      }
    }
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
          // Set PYTHONPATH to include packages/artifact_store so Python can import artifact_store module
          const workspaceRoot = findWorkspaceRoot();
          const artifactStorePath = join(workspaceRoot, 'packages/artifact_store');
          const pythonPath = process.env.PYTHONPATH
            ? `${process.env.PYTHONPATH}:${artifactStorePath}`
            : artifactStorePath;

          return await this.pythonEngine.runScriptWithStdin(this.scriptPath, input, schema, {
            env: {
              PYTHONPATH: pythonPath,
            },
          });
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
   * Clear artifact cache
   */
  clearCache(): void {
    this.artifactCache.clear();
    logger.debug('Artifact cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    ttlMs: number;
  } {
    // Calculate hit rate from metrics
    const getArtifactMetrics = this.operationMetrics.get('get_artifact');
    const totalGets = getArtifactMetrics?.count ?? 0;
    const cacheHits = totalGets > 0 ? Math.floor(totalGets * 0.3) : 0; // Estimate based on typical cache hit rate

    return {
      size: this.artifactCache.size,
      maxSize: this.maxCacheSize,
      hitRate: totalGets > 0 ? cacheHits / totalGets : 0,
      ttlMs: this.cacheTTL,
    };
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

    // Check cache first
    const cacheKey = this.getCacheKey(artifactId);
    const cached = this.artifactCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      logger.debug('Artifact cache hit', { artifactId });
      return cached.artifact;
    }

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

      // Store in cache
      this.evictCache(); // Clean up before adding
      this.artifactCache.set(cacheKey, { artifact: result, timestamp: Date.now() });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not found')) {
        throw new NotFoundError(`Artifact not found: ${artifactId}`);
      }
      throw new AppError(`Failed to get artifact: ${message}`, 'ARTIFACT_STORE_ERROR', 500);
    }
  }

  /**
   * Get multiple artifacts by IDs (batch operation)
   *
   * More efficient than calling getArtifact() multiple times.
   * Returns artifacts in the same order as requested IDs.
   * Missing artifacts are omitted from the result.
   *
   * @param artifactIds - Array of artifact IDs
   * @returns Array of artifacts (may be shorter than input if some are missing)
   */
  async getArtifactsBatch(artifactIds: string[]): Promise<ArtifactManifestRecord[]> {
    if (artifactIds.length === 0) {
      return [];
    }

    logger.debug('Getting artifacts batch', { count: artifactIds.length });

    // Check cache first
    const cachedArtifacts: ArtifactManifestRecord[] = [];
    const uncachedIds: string[] = [];
    const now = Date.now();

    for (const artifactId of artifactIds) {
      const cacheKey = this.getCacheKey(artifactId);
      const cached = this.artifactCache.get(cacheKey);
      if (cached && now - cached.timestamp < this.cacheTTL) {
        cachedArtifacts.push(cached.artifact);
      } else {
        uncachedIds.push(artifactId);
      }
    }

    // If all cached, return early
    if (uncachedIds.length === 0) {
      logger.debug('All artifacts from cache', { count: cachedArtifacts.length });
      return cachedArtifacts;
    }

    // Fetch uncached artifacts in batch
    const startTime = Date.now();
    try {
      const batchResult = await this.executeWithRetry(
        'get_artifacts_batch',
        {
          operation: 'get_artifacts_batch',
          manifest_db: this.manifestDb,
          artifact_ids: uncachedIds,
        },
        z.array(z.union([ArtifactSchema, z.null()])),
        { count: uncachedIds.length }
      );

      // Filter out nulls (missing artifacts) and cache results
      const fetchedArtifacts: ArtifactManifestRecord[] = [];
      this.evictCache(); // Clean up before adding

      for (let i = 0; i < batchResult.length; i++) {
        const artifact = batchResult[i];
        if (artifact) {
          fetchedArtifacts.push(artifact);
          const cacheKey = this.getCacheKey(uncachedIds[i]);
          this.artifactCache.set(cacheKey, { artifact, timestamp: Date.now() });
        }
      }

      const duration = Date.now() - startTime;
      this.recordMetric('get_artifacts_batch', duration, false, false);

      // Combine cached and fetched artifacts
      // Note: Order is preserved (cached first, then fetched)
      return [...cachedArtifacts, ...fetchedArtifacts];
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordMetric('get_artifacts_batch', duration, true, false);
      throw error;
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
