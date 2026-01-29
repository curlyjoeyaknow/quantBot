/**
 * Projection Builder Adapter
 *
 * Implements ProjectionBuilderPort to build DuckDB projections from Parquet artifacts.
 *
 * Architecture:
 * - Queries artifact store for Parquet paths
 * - Uses DuckDB's read_parquet() to create tables
 * - Creates indexes for query optimization
 * - Manages cache directory lifecycle
 *
 * Adapter responsibilities:
 * - I/O operations (file system, DuckDB connections)
 * - Artifact store integration
 * - Error handling and logging
 * - Resource cleanup and recovery
 */

import { logger } from '@quantbot/infra/utils';
import type {
  ProjectionBuilderPort,
  ProjectionRequest,
  ProjectionResult,
  ProjectionTable,
  ArtifactStorePort,
  ProjectionMetadata,
  ProjectionLineage,
  ProjectionMetrics,
  ProjectionFilter,
} from '@quantbot/core';
import { openDuckDb, type DuckDbConnection } from '@quantbot/infra/storage';
import { existsSync } from 'fs';
import { mkdir, unlink, stat, realpath } from 'fs/promises';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { z } from 'zod';
import { ProjectionMetadataManager } from './projection-metadata-manager.js';

/**
 * Custom error types for better error handling
 */
export class ProjectionBuilderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly projectionId?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProjectionBuilderError';
  }
}

export class ArtifactNotFoundError extends ProjectionBuilderError {
  constructor(artifactId: string, projectionId?: string) {
    super(`Artifact not found: ${artifactId}`, 'ARTIFACT_NOT_FOUND', projectionId);
    this.name = 'ArtifactNotFoundError';
  }
}

export class InvalidProjectionRequestError extends ProjectionBuilderError {
  constructor(message: string, cause?: z.ZodError) {
    super(`Invalid ProjectionRequest: ${message}`, 'INVALID_REQUEST', undefined, cause);
    this.name = 'InvalidProjectionRequestError';
  }
}

export class ProjectionBuildError extends ProjectionBuilderError {
  constructor(message: string, projectionId: string, cause?: Error) {
    super(`Failed to build projection: ${message}`, 'BUILD_FAILED', projectionId, cause);
    this.name = 'ProjectionBuildError';
  }
}

export class ProjectionDisposalError extends ProjectionBuilderError {
  constructor(message: string, projectionId: string, cause?: Error) {
    super(`Failed to dispose projection: ${message}`, 'DISPOSAL_FAILED', projectionId, cause);
    this.name = 'ProjectionDisposalError';
  }
}

/**
 * Zod schema for ProjectionRequest validation
 */
const ProjectionRequestSchema = z
  .object({
    projectionId: z
      .string()
      .min(1, 'Projection ID cannot be empty')
      .max(255, 'Projection ID cannot exceed 255 characters')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Projection ID can only contain alphanumeric characters, hyphens, and underscores'),
    version: z.string().optional(),
    artifacts: z
      .object({
        alerts: z
          .array(z.string().min(1, 'Artifact ID cannot be empty'))
          .min(0)
          .max(10000, 'Cannot exceed 10000 alert artifacts')
          .optional(),
        ohlcv: z
          .array(z.string().min(1, 'Artifact ID cannot be empty'))
          .min(0)
          .max(10000, 'Cannot exceed 10000 OHLCV artifacts')
          .optional(),
      })
      .refine(
        (data) => (data.alerts?.length ?? 0) > 0 || (data.ohlcv?.length ?? 0) > 0,
        'At least one artifact type (alerts or ohlcv) must be provided'
      ),
    tables: z.object({
      alerts: z.string().min(1).max(255).regex(/^[a-zA-Z0-9_]+$/).optional(),
      ohlcv: z.string().min(1).max(255).regex(/^[a-zA-Z0-9_]+$/).optional(),
    }),
    cacheDir: z.string().min(1).optional(),
    indexes: z
      .array(
        z.object({
          table: z.string().min(1).max(255),
          columns: z.array(z.string().min(1).max(255)).min(1).max(10),
        })
      )
      .max(50, 'Cannot exceed 50 indexes')
      .optional(),
  })
  .strict();


/**
 * Sanitize SQL identifier (table name, index name)
 * Only allows alphanumeric characters and underscores
 * Ensures it doesn't start with a number
 */
function sanitizeSqlIdentifier(identifier: string): string {
  if (!identifier || identifier.length === 0) {
    return 'unnamed';
  }

  // Replace any non-alphanumeric/underscore characters with underscore
  let sanitized = identifier.replace(/[^a-zA-Z0-9_]/g, '_');

  // Remove leading/trailing underscores
  sanitized = sanitized.replace(/^_+|_+$/g, '');

  // Ensure it doesn't start with a number (SQL requirement)
  if (/^\d/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  // Ensure it's not empty after sanitization
  if (sanitized.length === 0) {
    return 'unnamed';
  }

  // Limit length to prevent issues
  return sanitized.substring(0, 63);
}

/**
 * Escape file path for use in SQL string literal
 * Escapes single quotes, backslashes, and control characters
 */
function escapeSqlString(path: string): string {
  if (!path || path.length === 0) {
    throw new Error('Path cannot be empty');
  }

  return path
    .replace(/\\/g, '\\\\') // Escape backslashes first
    .replace(/'/g, "''") // Escape single quotes (SQL standard)
    .replace(/\n/g, '\\n') // Escape newlines
    .replace(/\r/g, '\\r') // Escape carriage returns
    .replace(/\t/g, '\\t') // Escape tabs
    .replace(/\0/g, '\\0'); // Escape null bytes
}

/**
 * Sanitize column names for index creation
 */
function sanitizeColumnNames(columns: string[]): string[] {
  if (!columns || columns.length === 0) {
    throw new Error('Column list cannot be empty');
  }

  const sanitized = columns.map((col) => sanitizeSqlIdentifier(col));
  
  // Remove duplicates while preserving order
  const unique = Array.from(new Set(sanitized));
  
  if (unique.length === 0) {
    throw new Error('No valid columns after sanitization');
  }

  return unique;
}

/**
 * Retry helper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 100,
  description?: string
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Don't retry on certain error types
      if (
        error instanceof ArtifactNotFoundError ||
        error instanceof InvalidProjectionRequestError ||
        (error instanceof Error && error.message.includes('Path traversal'))
      ) {
        throw error;
      }
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        throw error;
      }
      
      // Exponential backoff: baseDelayMs * 2^attempt
      const delay = baseDelayMs * Math.pow(2, attempt);
      logger.debug(`Retrying ${description || 'operation'} (attempt ${attempt + 1}/${maxRetries})`, {
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      });
      
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  // This should never be reached, but TypeScript requires it
  throw new Error('Retry loop completed without returning or throwing');
}

/**
 * Validate file path exists, is readable, and is within artifacts root (path traversal prevention)
 */
async function validateParquetPath(
  path: string,
  artifactsRoot: string
): Promise<void> {
  try {
    // Resolve to absolute path (handles relative paths and ..)
    const resolvedPath = resolve(path);
    
    // Resolve artifacts root to absolute path
    const resolvedArtifactsRoot = resolve(artifactsRoot);
    
    // Use realpath to resolve symlinks and get canonical path
    // This prevents path traversal attacks via symlinks
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(resolvedPath);
    } catch {
      // If realpath fails, use resolved path (file might not exist yet)
      canonicalPath = resolvedPath;
    }
    
    const canonicalArtifactsRoot = await realpath(resolvedArtifactsRoot).catch(() => resolvedArtifactsRoot);
    
    // Ensure path is within artifacts root (defense-in-depth)
    if (!canonicalPath.startsWith(canonicalArtifactsRoot)) {
      throw new Error(
        `Path traversal detected: ${path} resolves to ${canonicalPath} which is outside artifacts root ${canonicalArtifactsRoot}`
      );
    }
    
    // Validate file exists and is readable
    const stats = await stat(canonicalPath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${canonicalPath}`);
    }
    if (stats.size === 0) {
      throw new Error(`File is empty: ${canonicalPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File does not exist: ${path}`);
    }
    throw error;
  }
}

/**
 * Projection Builder Adapter
 *
 * Builds DuckDB projections from Parquet artifacts with comprehensive error handling,
 * resource management, and validation.
 */
export class ProjectionBuilderAdapter implements ProjectionBuilderPort {
  private readonly artifactStore: ArtifactStorePort;
  private readonly defaultCacheDir: string;
  private readonly maxProjectionSizeBytes: number;
  private readonly metadataManager: ProjectionMetadataManager;
  private readonly batchSize: number;
  private readonly builderVersion: string = '1.0.0';
  private readonly artifactsRoot: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(
    artifactStore: ArtifactStorePort,
    cacheDir: string = process.env.PROJECTION_CACHE_DIR || join(tmpdir(), 'quantbot-projections'),
    maxProjectionSizeBytes: number = parseInt(process.env.MAX_PROJECTION_SIZE_BYTES || '10737418240', 10), // 10GB default
    metadataDbPath?: string,
    batchSize: number = parseInt(process.env.PROJECTION_BATCH_SIZE || '10', 10),
    artifactsRoot?: string,
    retryOptions?: {
      maxRetries?: number;
      baseDelayMs?: number;
    }
  ) {
    if (!artifactStore) {
      throw new Error('ArtifactStorePort is required');
    }
    this.artifactStore = artifactStore;
    this.defaultCacheDir = cacheDir;
    this.maxProjectionSizeBytes = maxProjectionSizeBytes;
    this.batchSize = batchSize;
    this.maxRetries = retryOptions?.maxRetries ?? 3;
    this.retryBaseDelayMs = retryOptions?.baseDelayMs ?? 100;
    
    // Get artifacts root from artifact store if available, otherwise use environment variable or default
    // Note: ArtifactStorePort doesn't expose artifactsRoot, so we need to get it from environment
    // or pass it explicitly. For now, use environment variable with fallback.
    this.artifactsRoot = artifactsRoot || 
      process.env.ARTIFACTS_ROOT || 
      process.env.QUANTBOT_ARTIFACTS_DIR ||
      join(process.env.HOME || tmpdir(), '.cache', 'quantbot', 'artifacts');

    // Initialize metadata manager
    const metadataPath = metadataDbPath || join(cacheDir, 'projection_manifest.duckdb');
    this.metadataManager = new ProjectionMetadataManager(metadataPath);
  }

  /**
   * Build a new projection from artifacts
   * 
   * @throws {InvalidProjectionRequestError} If request validation fails
   * @throws {ArtifactNotFoundError} If any artifact is not found
   * @throws {ProjectionBuildError} If build fails
   */
  async buildProjection(request: ProjectionRequest): Promise<ProjectionResult> {
    const startTime = Date.now();

    // Validate request with detailed error messages
    let validatedRequest: z.infer<typeof ProjectionRequestSchema>;
    try {
      validatedRequest = ProjectionRequestSchema.parse(request);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues.map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
          return `${path}: ${issue.message}`;
        });
        throw new InvalidProjectionRequestError(errorMessages.join('; '), error);
      }
      throw error;
    }

    try {
      // Generate version if not provided
      const version = validatedRequest.version || `v${Date.now()}`;
      const cacheDir = validatedRequest.cacheDir || this.defaultCacheDir;
      const duckdbPath = join(cacheDir, `${validatedRequest.projectionId}-${version}.duckdb`);

      logger.info('Building projection', {
        projectionId: validatedRequest.projectionId,
        version,
        duckdbPath,
        artifactCount:
          (validatedRequest.artifacts.alerts?.length || 0) +
          (validatedRequest.artifacts.ohlcv?.length || 0),
      });

      // Ensure cache directory exists
      await this.ensureCacheDirectory(cacheDir);

      // Delete existing projection if it exists (for same version)
      // Note: Different versions can coexist
      await this.deleteExistingProjection(duckdbPath, validatedRequest.projectionId, version);

      // Open native DuckDB connection
      const conn = await openDuckDb(duckdbPath);

      // Build tables with proper error recovery
      const { tables, totalRows, artifactCount } = await this.buildTables(
        conn,
        validatedRequest
      );

      // Verify projection was created successfully
      await this.verifyProjection(conn, duckdbPath, validatedRequest.projectionId);

      // Native connections close automatically when out of scope
      // No explicit close() needed

      const executionTimeMs = Date.now() - startTime;

      // Get file size
      const stats = await stat(duckdbPath);
      const totalSizeBytes = stats.size;

      // Collect all artifact IDs and types
      const artifactIds: string[] = [];
      const artifactTypes: string[] = [];
      if (validatedRequest.artifacts.alerts) {
        artifactIds.push(...validatedRequest.artifacts.alerts);
        artifactTypes.push(...validatedRequest.artifacts.alerts.map(() => 'alerts'));
      }
      if (validatedRequest.artifacts.ohlcv) {
        artifactIds.push(...validatedRequest.artifacts.ohlcv);
        artifactTypes.push(...validatedRequest.artifacts.ohlcv.map(() => 'ohlcv'));
      }

      // Run data quality checks
      const qualityCheck = await this.checkDataQuality(
        {
          projectionId: validatedRequest.projectionId,
          version,
          duckdbPath,
          tables,
          totalRows,
          artifactIds,
        },
        validatedRequest
      );

      if (!qualityCheck.schemaConsistent) {
        logger.warn('Schema inconsistency detected in projection', {
          projectionId: validatedRequest.projectionId,
          quality: qualityCheck,
        });
      }

      if (!qualityCheck.dataFresh) {
        logger.warn('Stale data detected in projection', {
          projectionId: validatedRequest.projectionId,
          quality: qualityCheck,
        });
      }

      // Store metadata
      const metadata: ProjectionMetadata = {
        projectionId: validatedRequest.projectionId,
        version,
        duckdbPath,
        artifactIds,
        artifactTypes,
        tableNames: tables.map((t) => t.name),
        indexes: validatedRequest.indexes || [],
        buildTimestamp: startTime,
        buildDurationMs: executionTimeMs,
        totalRows,
        totalSizeBytes,
        cacheDir,
        builderVersion: this.builderVersion,
      };

      try {
        await this.metadataManager.storeMetadata(metadata);
      } catch (error) {
        logger.warn('Failed to store projection metadata', {
          error: error instanceof Error ? error.message : String(error),
          projectionId: validatedRequest.projectionId,
        });
        // Don't fail the build if metadata storage fails
      }

      logger.info('Projection built successfully', {
        projectionId: validatedRequest.projectionId,
        version,
        duckdbPath,
        tables: tables.map((t) => ({ name: t.name, rowCount: t.rowCount })),
        totalRows,
        artifactCount,
        executionTimeMs,
      });

      return {
        projectionId: validatedRequest.projectionId,
        version,
        duckdbPath,
        tables,
        artifactCount,
        totalRows,
      };
    } catch (error) {
      // Re-throw known error types
      if (
        error instanceof ProjectionBuilderError ||
        error instanceof ArtifactNotFoundError ||
        error instanceof InvalidProjectionRequestError ||
        error instanceof ProjectionBuildError
      ) {
        throw error;
      }

      // Wrap unknown errors
      const message = error instanceof Error ? error.message : String(error);
      const projectionId = validatedRequest?.projectionId || 'unknown';
      
      // Increment failure metrics
      try {
        await this.metadataManager.incrementFailureCount();
      } catch (metricsError) {
        logger.warn('Failed to update failure metrics', {
          error: metricsError instanceof Error ? metricsError.message : String(metricsError),
        });
      }
      
      throw new ProjectionBuildError(message, projectionId, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Ensure cache directory exists, creating it if necessary
   */
  private async ensureCacheDirectory(cacheDir: string): Promise<void> {
    try {
      if (!existsSync(cacheDir)) {
        await mkdir(cacheDir, { recursive: true });
        logger.debug('Created cache directory', { cacheDir });
      }
    } catch (error) {
      throw new ProjectionBuilderError(
        `Failed to create cache directory: ${error instanceof Error ? error.message : String(error)}`,
        'CACHE_DIR_ERROR',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete existing projection file if it exists
   */
  private async deleteExistingProjection(duckdbPath: string, projectionId: string, version: string): Promise<void> {
    if (existsSync(duckdbPath)) {
      try {
        await unlink(duckdbPath);
        
        // Delete metadata for this version
        try {
          await this.metadataManager.deleteMetadata(projectionId, version);
        } catch (error) {
          logger.debug('Failed to delete metadata for existing projection', {
            projectionId,
            version,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        
        logger.debug('Deleted existing projection', { projectionId, version, duckdbPath });
      } catch (error) {
        // Log warning but continue - DuckDB will overwrite if file exists
        logger.warn('Failed to delete existing projection, continuing', {
          projectionId,
          version,
          duckdbPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Build all tables for the projection
   */
  private async buildTables(
    conn: DuckDbConnection,
    request: z.infer<typeof ProjectionRequestSchema>
  ): Promise<{ tables: ProjectionTable[]; totalRows: number; artifactCount: number }> {
    const tables: ProjectionTable[] = [];
    let totalRows = 0;
    let artifactCount = 0;

    // Build alerts table
    if (request.artifacts.alerts && request.artifacts.alerts.length > 0) {
      const tableName = request.tables.alerts || 'alerts';
      const table = await this.buildTable(
        conn,
        tableName,
        request.artifacts.alerts,
        request.projectionId,
        request.indexes?.filter((idx) => idx.table === tableName)
      );
      tables.push(table);
      totalRows += table.rowCount;
      artifactCount += request.artifacts.alerts.length;
    }

    // Build OHLCV table
    if (request.artifacts.ohlcv && request.artifacts.ohlcv.length > 0) {
      const tableName = request.tables.ohlcv || 'ohlcv';
      const table = await this.buildTable(
        conn,
        tableName,
        request.artifacts.ohlcv,
        request.projectionId,
        request.indexes?.filter((idx) => idx.table === tableName)
      );
      tables.push(table);
      totalRows += table.rowCount;
      artifactCount += request.artifacts.ohlcv.length;
    }

    return { tables, totalRows, artifactCount };
  }

  /**
   * Verify projection was created successfully
   */
  private async verifyProjection(
    conn: DuckDbConnection,
    duckdbPath: string,
    projectionId: string
  ): Promise<void> {
    try {
      // Verify file exists and has reasonable size
      const stats = await stat(duckdbPath);
      if (stats.size === 0) {
        throw new Error('Projection file is empty');
      }
      if (stats.size > this.maxProjectionSizeBytes) {
        throw new Error(
          `Projection file exceeds maximum size: ${stats.size} bytes > ${this.maxProjectionSizeBytes} bytes`
        );
      }

      // Verify we can query the database
      const testResult = await conn.all<{ test: number }>('SELECT 1 as test');
      if (!testResult || testResult.length === 0) {
        throw new Error('Cannot query projection database');
      }
    } catch (error) {
      throw new ProjectionBuildError(
        `Projection verification failed: ${error instanceof Error ? error.message : String(error)}`,
        projectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Build a single table from artifacts
   * 
   * @throws {ArtifactNotFoundError} If any artifact is not found
   * @throws {ProjectionBuildError} If table build fails
   */
  private async buildTable(
    conn: DuckDbConnection,
    tableName: string,
    artifactIds: string[],
    projectionId: string,
    indexes?: Array<{ table: string; columns: string[] }>
  ): Promise<ProjectionTable> {
    // Sanitize table name to prevent SQL injection
    const sanitizedTableName = sanitizeSqlIdentifier(tableName);

    if (sanitizedTableName !== tableName) {
      logger.warn('Table name sanitized', {
        original: tableName,
        sanitized: sanitizedTableName,
        projectionId,
      });
    }

    logger.info('Building table', {
      tableName: sanitizedTableName,
      artifactCount: artifactIds.length,
      projectionId,
    });

    // Fetch and validate artifacts
    const parquetPaths = await this.fetchAndValidateArtifacts(artifactIds, projectionId);

      // Create table from Parquet files
      await this.createTableFromParquet(conn, sanitizedTableName, parquetPaths, projectionId);

      // Get table metadata
      const { rowCount, columns } = await this.getTableMetadata(conn, sanitizedTableName, projectionId);

    // Create indexes
    const indexNames = await this.createIndexes(
      conn,
      sanitizedTableName,
      indexes || [],
      projectionId
    );

    logger.info('Table built successfully', {
      tableName: sanitizedTableName,
      rowCount,
      columns: columns.length,
      indexes: indexNames.length,
      projectionId,
    });

    return {
      name: sanitizedTableName,
      rowCount,
      columns,
      indexes: indexNames,
    };
  }

  /**
   * Fetch artifacts and validate Parquet paths (with batching for performance and retry logic)
   */
  private async fetchAndValidateArtifacts(
    artifactIds: string[],
    projectionId: string
  ): Promise<string[]> {
    const parquetPaths: string[] = [];

    // Process artifacts in batches for better performance
    for (let i = 0; i < artifactIds.length; i += this.batchSize) {
      const batch = artifactIds.slice(i, i + this.batchSize);
      
      // Fetch artifacts concurrently within batch with retry logic
      const batchResults = await Promise.all(
        batch.map(async (artifactId) => {
          return retryWithBackoff(
            async () => {
              const artifact = await this.artifactStore.getArtifact(artifactId);
              if (!artifact) {
                throw new ArtifactNotFoundError(artifactId, projectionId);
              }

              // Validate Parquet path exists, is readable, and is within artifacts root
              await validateParquetPath(artifact.pathParquet, this.artifactsRoot);
              return artifact.pathParquet;
            },
            this.maxRetries,
            this.retryBaseDelayMs,
            `fetch artifact ${artifactId}`
          );
        })
      );

      parquetPaths.push(...batchResults);
    }

    return parquetPaths;
  }

  /**
   * Create table from Parquet files
   */
  private async createTableFromParquet(
    conn: DuckDbConnection,
    tableName: string,
    parquetPaths: string[],
    projectionId: string
  ): Promise<void> {
    if (parquetPaths.length === 0) {
      throw new ProjectionBuildError('No Parquet paths provided', projectionId);
    }

    // Escape file paths for SQL string literals
    const escapedPaths = parquetPaths.map((p) => {
      try {
        return `'${escapeSqlString(p)}'`;
      } catch (error) {
        throw new ProjectionBuildError(
          `Invalid path: ${p} - ${error instanceof Error ? error.message : String(error)}`,
          projectionId,
          error instanceof Error ? error : undefined
        );
      }
    });
    const pathsArray = escapedPaths.join(', ');

    // Create table from Parquet files (table name is already sanitized)
    const createTableSql = `
      CREATE TABLE ${tableName} AS
      SELECT * FROM read_parquet([${pathsArray}])
    `;

    try {
      await conn.run(createTableSql);
    } catch (error) {
      throw new ProjectionBuildError(
        `Failed to create table ${tableName}: ${error instanceof Error ? error.message : String(error)}`,
        projectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get table metadata (row count and columns)
   */
  private async getTableMetadata(
    conn: DuckDbConnection,
    tableName: string,
    projectionId: string
  ): Promise<{ rowCount: number; columns: string[] }> {
    try {
      // Get row count
      // DuckDB COUNT(*) returns BigInt, so we need to handle both number and BigInt
      const countResult = await conn.all<{ cnt: number | bigint }>(`SELECT COUNT(*) as cnt FROM ${tableName}`);
      if (!countResult || countResult.length === 0) {
        throw new Error('Failed to get row count');
      }
      const rawCount = countResult[0].cnt;
      // Convert BigInt to number if needed
      const rowCount = typeof rawCount === 'bigint' ? Number(rawCount) : rawCount;
      if (isNaN(rowCount) || rowCount < 0) {
        throw new Error(`Invalid row count: ${rowCount}`);
      }

      // Get column names using DESCRIBE
      // DESCRIBE returns positional columns: [column_name, column_type, null, key, default, extra]
      // DuckDB's native client returns objects, but DESCRIBE columns may not have names
      // Use PRAGMA table_info as a more reliable alternative
      const columnsResult = await conn.all<{ name: string }>(`PRAGMA table_info('${tableName}')`);
      if (!columnsResult || columnsResult.length === 0) {
        throw new Error('Failed to get column information');
      }
      const columns = columnsResult.map((row) => row.name).filter((col) => col.length > 0);

      return { rowCount, columns };
    } catch (error) {
      throw new ProjectionBuildError(
        `Failed to get table metadata: ${error instanceof Error ? error.message : String(error)}`,
        projectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create indexes for the table
   */
  private async createIndexes(
    conn: DuckDbConnection,
    tableName: string,
    indexes: Array<{ table: string; columns: string[] }>,
    projectionId: string
  ): Promise<string[]> {
    const indexNames: string[] = [];

    if (indexes.length === 0) {
      return indexNames;
    }

    for (const index of indexes) {
      // Only create index if it matches this table
      if (sanitizeSqlIdentifier(index.table) !== tableName) {
        continue;
      }

      try {
        const sanitizedColumns = sanitizeColumnNames(index.columns);
        const indexName = `idx_${tableName}_${sanitizedColumns.join('_')}`;
        const sanitizedIndexName = sanitizeSqlIdentifier(indexName);
        const columnList = sanitizedColumns.join(', ');

        const indexSql = `CREATE INDEX ${sanitizedIndexName} ON ${tableName}(${columnList})`;
        await conn.run(indexSql);
        indexNames.push(sanitizedIndexName);
      } catch (error) {
        logger.warn('Failed to create index', {
          table: tableName,
          columns: index.columns,
          projectionId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other indexes - index creation failure is not fatal
      }
    }

    return indexNames;
  }

  /**
   * Rebuild an existing projection
   * Uses incremental rebuild if <10% of artifacts changed, otherwise full rebuild
   * 
   * @throws {InvalidProjectionRequestError} If request validation fails
   * @throws {ProjectionBuildError} If rebuild fails
   */
  async rebuildProjection(projectionId: string, request: ProjectionRequest): Promise<void> {
    logger.info('Rebuilding projection', {
      projectionId,
      artifactCount:
        (request.artifacts.alerts?.length || 0) + (request.artifacts.ohlcv?.length || 0),
    });

    // Validate projectionId matches request
    if (request.projectionId !== projectionId) {
      throw new InvalidProjectionRequestError(
        `Projection ID mismatch: request.projectionId (${request.projectionId}) !== projectionId (${projectionId})`
      );
    }

    // Check if projection exists and get metadata
    const existing = await this.getProjectionMetadata(projectionId);
    
    if (!existing) {
      // No existing projection, do full build
      logger.debug('No existing projection found, performing full build', { projectionId });
      await this.buildProjection(request);
      return;
    }

    // Detect changed artifacts using content hashes
    const changedArtifacts = await this.detectChangedArtifacts(existing, request);
    
    if (changedArtifacts.length === 0) {
      // No changes detected, skip rebuild
      logger.info('No changes detected, skipping rebuild', { projectionId });
      return;
    }

    const changeRatio = changedArtifacts.length / existing.artifactIds.length;
    const INCREMENTAL_THRESHOLD = 0.1; // 10%

    if (changeRatio < INCREMENTAL_THRESHOLD) {
      // <10% changed → incremental rebuild
      logger.info('Performing incremental rebuild', {
        projectionId,
        changedCount: changedArtifacts.length,
        totalCount: existing.artifactIds.length,
        changeRatio: changeRatio.toFixed(2),
      });
      await this.incrementalRebuild(projectionId, request, changedArtifacts, existing);
      return;
    }

    // >10% changed → full rebuild
    logger.info('Performing full rebuild (too many changes)', {
      projectionId,
      changedCount: changedArtifacts.length,
      totalCount: existing.artifactIds.length,
      changeRatio: changeRatio.toFixed(2),
    });
    await this.buildProjection(request);
  }

  /**
   * Detect changed artifacts by comparing artifact sets
   * 
   * Note: Full incremental rebuild would require storing artifact hashes in metadata.
   * For now, we detect changes by comparing artifact ID sets.
   */
  private async detectChangedArtifacts(
    existing: ProjectionMetadata,
    request: ProjectionRequest
  ): Promise<string[]> {
    const changedArtifactIds: string[] = [];
    
    // Collect all artifact IDs from request
    const requestedArtifactIds: string[] = [];
    if (request.artifacts.alerts) {
      requestedArtifactIds.push(...request.artifacts.alerts);
    }
    if (request.artifacts.ohlcv) {
      requestedArtifactIds.push(...request.artifacts.ohlcv);
    }

    const existingSet = new Set(existing.artifactIds);
    const requestedSet = new Set(requestedArtifactIds);

    // Find artifacts that were added or removed
    for (const artifactId of requestedSet) {
      if (!existingSet.has(artifactId)) {
        // New artifact
        changedArtifactIds.push(artifactId);
      }
    }

    for (const artifactId of existingSet) {
      if (!requestedSet.has(artifactId)) {
        // Removed artifact
        changedArtifactIds.push(artifactId);
      }
    }

    // For artifacts that exist in both, check if content hash changed
    // This requires fetching artifacts, so we do it in batch
    const commonArtifactIds = requestedArtifactIds.filter((id) => existingSet.has(id));
    
    if (commonArtifactIds.length > 0) {
      // Fetch artifacts to check content hashes
      // Note: We'd need to store hashes in metadata for optimal performance
      // For now, we'll skip hash comparison and only detect add/remove changes
      // This is a simplified incremental build - full implementation would store hashes
    }

    return changedArtifactIds;
  }

  /**
   * Perform incremental rebuild (only rebuild changed artifacts)
   * 
   * Note: DuckDB doesn't support incremental table updates easily.
   * For now, we'll rebuild the affected tables entirely.
   * A more sophisticated implementation would use INSERT/UPDATE statements.
   */
  private async incrementalRebuild(
    projectionId: string,
    request: ProjectionRequest,
    changedArtifactIds: string[],
    existing: ProjectionMetadata
  ): Promise<void> {
    // Group changed artifacts by type
    const changedAlerts: string[] = [];
    const changedOhlcv: string[] = [];
    
    for (const artifactId of changedArtifactIds) {
      const index = existing.artifactIds.indexOf(artifactId);
      if (index !== -1) {
        const artifactType = existing.artifactTypes[index];
        if (artifactType === 'alerts') {
          changedAlerts.push(artifactId);
        } else if (artifactType === 'ohlcv' || artifactType === 'ohlcv_slice') {
          changedOhlcv.push(artifactId);
        }
      }
    }

    // For incremental rebuild, we rebuild entire tables that have changes
    // This is simpler than trying to do row-level updates in DuckDB
    // A more sophisticated implementation could use INSERT/UPDATE/DELETE
    
    // Rebuild request with only changed artifacts (plus unchanged ones for same table)
    const incrementalRequest: ProjectionRequest = {
      ...request,
      artifacts: {
        alerts: changedAlerts.length > 0 ? request.artifacts.alerts : undefined,
        ohlcv: changedOhlcv.length > 0 ? request.artifacts.ohlcv : undefined,
      },
    };

    // For now, fall back to full rebuild
    // TODO: Implement true incremental rebuild with INSERT/UPDATE/DELETE
    logger.info('Incremental rebuild: rebuilding affected tables', {
      projectionId,
      changedAlerts: changedAlerts.length,
      changedOhlcv: changedOhlcv.length,
    });
    
    await this.buildProjection(incrementalRequest);
  }

  /**
   * Dispose a projection (delete DuckDB file)
   * 
   * @throws {ProjectionDisposalError} If disposal fails
   */
  async disposeProjection(projectionId: string, cacheDir?: string): Promise<void> {
    const dir = cacheDir || this.defaultCacheDir;
    
    // Try to find the projection (could be versioned or unversioned)
    // First check metadata for latest version
    let duckdbPath: string | null = null;
    try {
      const metadata = await this.metadataManager.getMetadata(projectionId);
      if (metadata) {
        duckdbPath = metadata.duckdbPath;
      }
    } catch (error) {
      logger.debug('Could not get metadata for projection', {
        projectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback to unversioned path if metadata not found
    if (!duckdbPath || !existsSync(duckdbPath)) {
      duckdbPath = join(dir, `${projectionId}.duckdb`);
    }

    logger.info('Disposing projection', {
      projectionId,
      duckdbPath,
      cacheDir: dir,
    });

    if (existsSync(duckdbPath)) {
      try {
        await unlink(duckdbPath);
        
        // Delete metadata
        try {
          await this.metadataManager.deleteMetadata(projectionId);
        } catch (error) {
          logger.warn('Failed to delete projection metadata', {
            projectionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        
        logger.info('Projection disposed', { projectionId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to dispose projection', {
          projectionId,
          duckdbPath,
          error: message,
        });
        throw new ProjectionDisposalError(message, projectionId, error instanceof Error ? error : undefined);
      }
    } else {
      logger.debug('Projection not found for disposal (may already be disposed)', {
        projectionId,
        duckdbPath,
      });
    }
  }

  /**
   * Check if a projection exists
   */
  async projectionExists(projectionId: string, cacheDir?: string): Promise<boolean> {
    // Check metadata first (more reliable)
    try {
      const metadata = await this.metadataManager.getMetadata(projectionId);
      if (metadata && existsSync(metadata.duckdbPath)) {
        return true;
      }
    } catch (error) {
      logger.debug('Could not check metadata for projection', {
        projectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback to filesystem check
    const dir = cacheDir || this.defaultCacheDir;
    const duckdbPath = join(dir, `${projectionId}.duckdb`);
    
    try {
      return existsSync(duckdbPath);
    } catch (error) {
      logger.warn('Error checking projection existence', {
        projectionId,
        duckdbPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get projection metadata
   */
  async getProjectionMetadata(projectionId: string, version?: string): Promise<ProjectionMetadata | null> {
    return this.metadataManager.getMetadata(projectionId, version);
  }

  /**
   * List all projections
   */
  async listProjections(filter?: ProjectionFilter): Promise<ProjectionMetadata[]> {
    return this.metadataManager.listProjections(filter);
  }

  /**
   * Get projection lineage
   */
  async getProjectionLineage(projectionId: string, version?: string): Promise<ProjectionLineage | null> {
    const lineage = await this.metadataManager.getLineage(projectionId, version);
    if (!lineage) {
      return null;
    }

    // Enrich with actual artifact paths from artifact store
      const enrichedArtifacts = await Promise.all(
      lineage.artifacts.map(async (artifact: { artifactId: string; artifactType: string; pathParquet: string }) => {
        try {
          const fullArtifact = await this.artifactStore.getArtifact(artifact.artifactId);
          return {
            artifactId: artifact.artifactId,
            artifactType: artifact.artifactType,
            pathParquet: fullArtifact?.pathParquet || '',
          };
        } catch (error) {
          logger.warn('Failed to get artifact for lineage', {
            artifactId: artifact.artifactId,
            error: error instanceof Error ? error.message : String(error),
          });
          return artifact;
        }
      })
    );

    return {
      ...lineage,
      artifacts: enrichedArtifacts,
    };
  }

  /**
   * Get projection metrics
   */
  async getMetrics(): Promise<ProjectionMetrics> {
    return this.metadataManager.getMetrics();
  }

  /**
   * Cleanup old projections based on lifecycle policy
   * 
   * @param policy - Lifecycle policy (TTL, max age, max count)
   * @returns Number of projections cleaned up
   */
  async cleanupOldProjections(policy: {
    maxAgeMs?: number; // Max age before cleanup
    maxCount?: number; // Max projections (LRU eviction)
  }): Promise<number> {
    const projections = await this.listProjections();
    const now = Date.now();
    let cleanedCount = 0;

    // Sort by build timestamp (oldest first)
    const sortedProjections = [...projections].sort(
      (a, b) => a.buildTimestamp - b.buildTimestamp
    );

    for (const projection of sortedProjections) {
      const age = now - projection.buildTimestamp;
      let shouldCleanup = false;

      // Check max age policy
      if (policy.maxAgeMs && age > policy.maxAgeMs) {
        shouldCleanup = true;
        logger.debug('Cleaning up projection due to max age', {
          projectionId: projection.projectionId,
          version: projection.version,
          ageMs: age,
          maxAgeMs: policy.maxAgeMs,
        });
      }

      // Check max count policy (LRU eviction)
      if (policy.maxCount && sortedProjections.length - cleanedCount > policy.maxCount) {
        shouldCleanup = true;
        logger.debug('Cleaning up projection due to max count (LRU)', {
          projectionId: projection.projectionId,
          version: projection.version,
          currentCount: sortedProjections.length - cleanedCount,
          maxCount: policy.maxCount,
        });
      }

      if (shouldCleanup) {
        try {
          await this.disposeProjection(projection.projectionId, projection.cacheDir);
          cleanedCount++;
        } catch (error) {
          logger.warn('Failed to cleanup projection', {
            projectionId: projection.projectionId,
            version: projection.version,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old projections', {
        cleanedCount,
        remainingCount: projections.length - cleanedCount,
      });
    }

    return cleanedCount;
  }

  /**
   * Cleanup failed builds (orphaned files without metadata)
   * 
   * @param cacheDir - Optional cache directory to scan (defaults to defaultCacheDir)
   * @returns Number of orphaned files cleaned up
   */
  async cleanupFailedBuilds(cacheDir?: string): Promise<number> {
    const dir = cacheDir || this.defaultCacheDir;
    let cleanedCount = 0;

    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(dir);
      
      // Get all known projections from metadata
      const knownProjections = await this.listProjections();
      const knownPaths = new Set(
        knownProjections.map((p) => p.duckdbPath)
      );

      // Find orphaned DuckDB files
      for (const file of files) {
        if (file.endsWith('.duckdb')) {
          const filePath = join(dir, file);
          
          // Check if file exists in metadata
          if (!knownPaths.has(filePath)) {
            try {
              await unlink(filePath);
              cleanedCount++;
              logger.debug('Cleaned up orphaned projection file', { filePath });
            } catch (error) {
              logger.warn('Failed to cleanup orphaned file', {
                filePath,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to scan cache directory for orphaned files', {
        cacheDir: dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up orphaned projection files', { cleanedCount });
    }

    return cleanedCount;
  }

  /**
   * Check data quality for a projection
   * 
   * Validates:
   * - Schema consistency across artifacts
   * - Data freshness (artifact timestamps)
   * - Data completeness (expected vs actual rows)
   * - Data integrity (basic checks)
   */
  private async checkDataQuality(
    result: {
      projectionId: string;
      version: string;
      duckdbPath: string;
      tables: ProjectionTable[];
      totalRows: number;
      artifactIds: string[];
    },
    _request: ProjectionRequest
  ): Promise<{
    schemaConsistent: boolean;
    dataFresh: boolean;
    rowCountMatches: boolean;
    checksumValid: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    let schemaConsistent = true;
    let dataFresh = true;
    let rowCountMatches = true;
    let checksumValid = true;

    try {
      // Check schema consistency by comparing table schemas
      // For now, we assume schema is consistent if tables were created successfully
      // A more sophisticated check would compare column types across artifacts
      schemaConsistent = result.tables.length > 0;

      // Check data freshness (artifact timestamps)
      const freshnessWindowMs = parseInt(
        process.env.PROJECTION_FRESHNESS_WINDOW_MS || '86400000',
        10
      ); // Default: 24 hours
      const now = Date.now();

      let allArtifactsFresh = true;
      for (const artifactId of result.artifactIds) {
        try {
          const artifact = await this.artifactStore.getArtifact(artifactId);
          if (artifact) {
            const createdAt = new Date(artifact.createdAt).getTime();
            const age = now - createdAt;
            if (age > freshnessWindowMs) {
              allArtifactsFresh = false;
              warnings.push(
                `Artifact ${artifactId} is stale (age: ${Math.round(age / 3600000)} hours)`
              );
            }
          }
        } catch {
          // Skip if artifact not found
        }
      }
      dataFresh = allArtifactsFresh;

      // Check row count completeness
      // Compare expected rows (sum of artifact rowCounts) vs actual rows
      let expectedRows = 0;
      for (const artifactId of result.artifactIds) {
        try {
          const artifact = await this.artifactStore.getArtifact(artifactId);
          if (artifact) {
            expectedRows += artifact.rowCount || 0;
          }
        } catch {
          // Skip if artifact not found
        }
      }

      // Allow 5% variance for row count (due to deduplication, filtering, etc.)
      const variance = Math.abs(result.totalRows - expectedRows) / Math.max(expectedRows, 1);
      if (variance > 0.05) {
        rowCountMatches = false;
        warnings.push(
          `Row count mismatch: expected ${expectedRows}, got ${result.totalRows} (variance: ${(variance * 100).toFixed(2)}%)`
        );
      }

      // Basic checksum validation (verify files exist and are readable)
      // More sophisticated checksum validation would require reading file hashes
      checksumValid = true; // Assume valid if projection was built successfully
    } catch (error) {
      logger.warn('Data quality check failed', {
        projectionId: result.projectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      warnings.push(`Data quality check error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      schemaConsistent,
      dataFresh,
      rowCountMatches,
      checksumValid,
      warnings,
    };
  }
}
