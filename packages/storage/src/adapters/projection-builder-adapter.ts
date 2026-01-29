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
} from '@quantbot/core';
import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { existsSync, statSync } from 'fs';
import { mkdir, unlink, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { z } from 'zod';

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
 * Projection metadata stored alongside DuckDB file
 */
interface ProjectionMetadata {
  projectionId: string;
  createdAt: string;
  artifactIds: {
    alerts?: string[];
    ohlcv?: string[];
  };
  cacheDir: string;
  tables: Array<{ name: string; rowCount: number }>;
  totalRows: number;
  buildTimeMs: number;
}

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
 * Validate file path exists and is readable
 */
async function validateParquetPath(path: string): Promise<void> {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${path}`);
    }
    if (stats.size === 0) {
      throw new Error(`File is empty: ${path}`);
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

  constructor(
    artifactStore: ArtifactStorePort,
    cacheDir: string = process.env.PROJECTION_CACHE_DIR || join(tmpdir(), 'quantbot-projections'),
    maxProjectionSizeBytes: number = parseInt(process.env.MAX_PROJECTION_SIZE_BYTES || '10737418240', 10) // 10GB default
  ) {
    if (!artifactStore) {
      throw new Error('ArtifactStorePort is required');
    }
    this.artifactStore = artifactStore;
    this.defaultCacheDir = cacheDir;
    this.maxProjectionSizeBytes = maxProjectionSizeBytes;
  }

  /**
   * Build a new projection from artifacts
   * 
   * @throws {InvalidProjectionRequestError} If request validation fails
   * @throws {ArtifactNotFoundError} If any artifact is not found
   * @throws {ProjectionBuildError} If build fails
   */
  async buildProjection(request: ProjectionRequest): Promise<ProjectionResult> {
    let validatedRequest: z.infer<typeof ProjectionRequestSchema>;
    let client: DuckDBClient | null = null;
    const startTime = Date.now();

    try {
      // Validate request with detailed error messages
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

      const cacheDir = validatedRequest.cacheDir || this.defaultCacheDir;
      const duckdbPath = join(cacheDir, `${validatedRequest.projectionId}.duckdb`);

      logger.info('Building projection', {
        projectionId: validatedRequest.projectionId,
        duckdbPath,
        artifactCount:
          (validatedRequest.artifacts.alerts?.length || 0) +
          (validatedRequest.artifacts.ohlcv?.length || 0),
      });

      // Ensure cache directory exists
      await this.ensureCacheDirectory(cacheDir);

      // Delete existing projection if it exists
      await this.deleteExistingProjection(duckdbPath, validatedRequest.projectionId);

      // Create DuckDB client with proper error handling
      client = new DuckDBClient(duckdbPath);

      // Build tables with proper error recovery
      const { tables, totalRows, artifactCount } = await this.buildTables(
        client,
        validatedRequest
      );

      // Verify projection was created successfully
      await this.verifyProjection(client, duckdbPath, validatedRequest.projectionId);

      // Close connection before returning
      await client.close();
      client = null;

      const executionTimeMs = Date.now() - startTime;

      logger.info('Projection built successfully', {
        projectionId: validatedRequest.projectionId,
        duckdbPath,
        tables: tables.map((t) => ({ name: t.name, rowCount: t.rowCount })),
        totalRows,
        artifactCount,
        executionTimeMs,
      });

      return {
        projectionId: validatedRequest.projectionId,
        duckdbPath,
        tables,
        artifactCount,
        totalRows,
      };
    } catch (error) {
      // Ensure client is closed even on error
      if (client) {
        try {
          await client.close();
        } catch (closeError) {
          logger.warn('Failed to close DuckDB client after error', {
            error: closeError instanceof Error ? closeError.message : String(closeError),
          });
        }
      }

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
  private async deleteExistingProjection(duckdbPath: string, projectionId: string): Promise<void> {
    if (existsSync(duckdbPath)) {
      try {
        await unlink(duckdbPath);
        logger.debug('Deleted existing projection', { projectionId, duckdbPath });
      } catch (error) {
        // Log warning but continue - DuckDB will overwrite if file exists
        logger.warn('Failed to delete existing projection, continuing', {
          projectionId,
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
    client: DuckDBClient,
    request: z.infer<typeof ProjectionRequestSchema>
  ): Promise<{ tables: ProjectionTable[]; totalRows: number; artifactCount: number }> {
    const tables: ProjectionTable[] = [];
    let totalRows = 0;
    let artifactCount = 0;

    // Build alerts table
    if (request.artifacts.alerts && request.artifacts.alerts.length > 0) {
      const tableName = request.tables.alerts || 'alerts';
      const table = await this.buildTable(
        client,
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
        client,
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
    client: DuckDBClient,
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
      const testResult = await client.query('SELECT 1 as test');
      if (!testResult.rows || testResult.rows.length === 0) {
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
    client: DuckDBClient,
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
      await this.createTableFromParquet(client, sanitizedTableName, parquetPaths, projectionId);

      // Get table metadata
      const { rowCount, columns } = await this.getTableMetadata(client, sanitizedTableName, projectionId);

    // Create indexes
    const indexNames = await this.createIndexes(
      client,
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
   * Fetch artifacts and validate Parquet paths
   */
  private async fetchAndValidateArtifacts(
    artifactIds: string[],
    projectionId: string
  ): Promise<string[]> {
    const parquetPaths: string[] = [];

    for (const artifactId of artifactIds) {
      try {
        const artifact = await this.artifactStore.getArtifact(artifactId);
        if (!artifact) {
          throw new ArtifactNotFoundError(artifactId, projectionId);
        }

        // Validate Parquet path exists and is readable
        await validateParquetPath(artifact.pathParquet);
        parquetPaths.push(artifact.pathParquet);
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          throw error;
        }
        throw new ArtifactNotFoundError(
          `${artifactId}: ${error instanceof Error ? error.message : String(error)}`,
          projectionId
        );
      }
    }

    return parquetPaths;
  }

  /**
   * Create table from Parquet files
   */
  private async createTableFromParquet(
    client: DuckDBClient,
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
      await client.execute(createTableSql);
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
    client: DuckDBClient,
    tableName: string,
    projectionId: string
  ): Promise<{ rowCount: number; columns: string[] }> {
    try {
      // Get row count
      const countResult = await client.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
      if (!countResult.rows || countResult.rows.length === 0) {
        throw new Error('Failed to get row count');
      }
      const rowCount = Number(countResult.rows[0][0]);
      if (isNaN(rowCount) || rowCount < 0) {
        throw new Error(`Invalid row count: ${countResult.rows[0][0]}`);
      }

      // Get column names
      const columnsResult = await client.query(`DESCRIBE ${tableName}`);
      if (!columnsResult.rows || columnsResult.rows.length === 0) {
        throw new Error('Failed to get column information');
      }
      const columns = columnsResult.rows.map((row) => String(row[0])).filter((col) => col.length > 0);

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
    client: DuckDBClient,
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
        await client.execute(indexSql);
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
   * Requires the original ProjectionRequest to rebuild with same configuration
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

    // Rebuild by calling buildProjection (which will delete and recreate)
    await this.buildProjection(request);
  }

  /**
   * Dispose a projection (delete DuckDB file)
   * 
   * @throws {ProjectionDisposalError} If disposal fails
   */
  async disposeProjection(projectionId: string, cacheDir?: string): Promise<void> {
    const dir = cacheDir || this.defaultCacheDir;
    const duckdbPath = join(dir, `${projectionId}.duckdb`);

    logger.info('Disposing projection', {
      projectionId,
      duckdbPath,
      cacheDir: dir,
    });

    if (existsSync(duckdbPath)) {
      try {
        await unlink(duckdbPath);
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
}
