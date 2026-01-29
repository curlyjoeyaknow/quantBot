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
import { existsSync } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { z } from 'zod';

/**
 * Zod schema for ProjectionRequest validation
 */
const ProjectionRequestSchema = z.object({
  projectionId: z.string().min(1).max(255),
  artifacts: z.object({
    alerts: z.array(z.string().min(1)).optional(),
    ohlcv: z.array(z.string().min(1)).optional(),
  }),
  tables: z.object({
    alerts: z.string().min(1).max(255).optional(),
    ohlcv: z.string().min(1).max(255).optional(),
  }),
  cacheDir: z.string().optional(),
  indexes: z
    .array(
      z.object({
        table: z.string().min(1).max(255),
        columns: z.array(z.string().min(1).max(255)).min(1),
      })
    )
    .optional(),
});

/**
 * Sanitize SQL identifier (table name, index name)
 * Only allows alphanumeric characters and underscores
 */
function sanitizeSqlIdentifier(identifier: string): string {
  // Replace any non-alphanumeric/underscore characters with underscore
  const sanitized = identifier.replace(/[^a-zA-Z0-9_]/g, '_');
  // Ensure it doesn't start with a number (SQL requirement)
  if (/^\d/.test(sanitized)) {
    return `_${sanitized}`;
  }
  return sanitized || 'unnamed';
}

/**
 * Escape file path for use in SQL string literal
 * Escapes single quotes, backslashes, and newlines
 */
function escapeSqlString(path: string): string {
  return path
    .replace(/\\/g, '\\\\') // Escape backslashes
    .replace(/'/g, "''") // Escape single quotes (SQL standard)
    .replace(/\n/g, '\\n') // Escape newlines
    .replace(/\r/g, '\\r') // Escape carriage returns
    .replace(/\t/g, '\\t'); // Escape tabs
}

/**
 * Sanitize column names for index creation
 */
function sanitizeColumnNames(columns: string[]): string[] {
  return columns.map((col) => sanitizeSqlIdentifier(col));
}

/**
 * Projection Builder Adapter
 *
 * Builds DuckDB projections from Parquet artifacts.
 */
export class ProjectionBuilderAdapter implements ProjectionBuilderPort {
  private readonly artifactStore: ArtifactStorePort;
  private readonly defaultCacheDir: string;

  constructor(
    artifactStore: ArtifactStorePort,
    cacheDir: string = process.env.PROJECTION_CACHE_DIR || join(tmpdir(), 'quantbot-projections')
  ) {
    this.artifactStore = artifactStore;
    this.defaultCacheDir = cacheDir;
  }

  /**
   * Build a new projection from artifacts
   */
  async buildProjection(request: ProjectionRequest): Promise<ProjectionResult> {
    // Validate request
    const validatedRequest = ProjectionRequestSchema.parse(request);

    // Ensure at least one artifact type is provided
    const hasAlerts = validatedRequest.artifacts.alerts && validatedRequest.artifacts.alerts.length > 0;
    const hasOhlcv = validatedRequest.artifacts.ohlcv && validatedRequest.artifacts.ohlcv.length > 0;
    if (!hasAlerts && !hasOhlcv) {
      throw new Error('ProjectionRequest must include at least one artifact (alerts or ohlcv)');
    }

    const startTime = Date.now();
    const cacheDir = validatedRequest.cacheDir || this.defaultCacheDir;
    const duckdbPath = join(cacheDir, `${validatedRequest.projectionId}.duckdb`);

    logger.info('Building projection', {
      projectionId: validatedRequest.projectionId,
      duckdbPath,
      artifactCount:
        (validatedRequest.artifacts.alerts?.length || 0) + (validatedRequest.artifacts.ohlcv?.length || 0),
    });

    try {
      // Ensure cache directory exists (async)
      if (!existsSync(cacheDir)) {
        await mkdir(cacheDir, { recursive: true });
      }

      // Delete existing projection if it exists (async)
      if (existsSync(duckdbPath)) {
        try {
          await unlink(duckdbPath);
        } catch (error) {
          logger.warn('Failed to delete existing projection, continuing', {
            projectionId: validatedRequest.projectionId,
            duckdbPath,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue - DuckDB will overwrite if file exists
        }
      }

      // Create DuckDB client
      const client = new DuckDBClient(duckdbPath);

      // Build tables
      const tables: ProjectionTable[] = [];
      let totalRows = 0;
      let artifactCount = 0;

      // Build alerts table
      if (validatedRequest.artifacts.alerts && validatedRequest.artifacts.alerts.length > 0) {
        const tableName = validatedRequest.tables.alerts || 'alerts';
        const table = await this.buildTable(
          client,
          tableName,
          validatedRequest.artifacts.alerts,
          validatedRequest.indexes?.filter((idx) => idx.table === tableName)
        );
        tables.push(table);
        totalRows += table.rowCount;
        artifactCount += validatedRequest.artifacts.alerts.length;
      }

      // Build OHLCV table
      if (validatedRequest.artifacts.ohlcv && validatedRequest.artifacts.ohlcv.length > 0) {
        const tableName = validatedRequest.tables.ohlcv || 'ohlcv';
        const table = await this.buildTable(
          client,
          tableName,
          validatedRequest.artifacts.ohlcv,
          validatedRequest.indexes?.filter((idx) => idx.table === tableName)
        );
        tables.push(table);
        totalRows += table.rowCount;
        artifactCount += validatedRequest.artifacts.ohlcv.length;
      }

      // Close connection
      await client.close();

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
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to build projection', {
        projectionId: validatedRequest?.projectionId || 'unknown',
        error: message,
      });
      
      // Re-throw Zod validation errors with better messages
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues.map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
          return `${path}: ${issue.message}`;
        });
        throw new Error(`Invalid ProjectionRequest: ${errorMessages.join(', ')}`);
      }
      
      throw new Error(`Failed to build projection: ${message}`);
    }
  }

  /**
   * Build a single table from artifacts
   */
  private async buildTable(
    client: DuckDBClient,
    tableName: string,
    artifactIds: string[],
    indexes?: Array<{ table: string; columns: string[] }>
  ): Promise<ProjectionTable> {
    // Sanitize table name to prevent SQL injection
    const sanitizedTableName = sanitizeSqlIdentifier(tableName);
    
    if (sanitizedTableName !== tableName) {
      logger.warn('Table name sanitized', {
        original: tableName,
        sanitized: sanitizedTableName,
      });
    }

    logger.info('Building table', {
      tableName: sanitizedTableName,
      artifactCount: artifactIds.length,
    });

    // Get Parquet paths from artifact store
    const parquetPaths: string[] = [];
    for (const artifactId of artifactIds) {
      const artifact = await this.artifactStore.getArtifact(artifactId);
      if (!artifact) {
        throw new Error(`Artifact not found: ${artifactId}`);
      }
      parquetPaths.push(artifact.pathParquet);
    }

    // Escape file paths for SQL string literals
    const escapedPaths = parquetPaths.map((p) => `'${escapeSqlString(p)}'`);
    const pathsArray = escapedPaths.join(', ');
    
    // Create table from Parquet files (sanitized table name)
    const createTableSql = `
      CREATE TABLE ${sanitizedTableName} AS
      SELECT * FROM read_parquet([${pathsArray}])
    `;

    await client.execute(createTableSql);

    // Get row count (use sanitized table name)
    const countResult = await client.query(`SELECT COUNT(*) as cnt FROM ${sanitizedTableName}`);
    const rowCount = Number(countResult.rows[0][0]);

    // Get column names (use sanitized table name)
    const columnsResult = await client.query(`DESCRIBE ${sanitizedTableName}`);
    const columns = columnsResult.rows.map((row) => String(row[0]));

    // Create indexes (sanitize index names and column names)
    const indexNames: string[] = [];
    if (indexes && indexes.length > 0) {
      for (const index of indexes) {
        // Only create index if it matches this table
        if (sanitizeSqlIdentifier(index.table) !== sanitizedTableName) {
          continue;
        }
        
        const sanitizedColumns = sanitizeColumnNames(index.columns);
        const indexName = `idx_${sanitizedTableName}_${sanitizedColumns.join('_')}`;
        const sanitizedIndexName = sanitizeSqlIdentifier(indexName);
        const columnList = sanitizedColumns.join(', ');
        
        const indexSql = `CREATE INDEX ${sanitizedIndexName} ON ${sanitizedTableName}(${columnList})`;
        await client.execute(indexSql);
        indexNames.push(sanitizedIndexName);
      }
    }

    logger.info('Table built successfully', {
      tableName: sanitizedTableName,
      rowCount,
      columns: columns.length,
      indexes: indexNames.length,
    });

    return {
      name: sanitizedTableName,
      rowCount,
      columns,
      indexes: indexNames,
    };
  }

  /**
   * Rebuild an existing projection
   * Requires the original ProjectionRequest to rebuild with same configuration
   */
  async rebuildProjection(projectionId: string, request: ProjectionRequest): Promise<void> {
    logger.info('Rebuilding projection', {
      projectionId,
      artifactCount:
        (request.artifacts.alerts?.length || 0) + (request.artifacts.ohlcv?.length || 0),
    });

    // Validate projectionId matches request
    if (request.projectionId !== projectionId) {
      throw new Error(
        `Projection ID mismatch: request.projectionId (${request.projectionId}) !== projectionId (${projectionId})`
      );
    }

    // Rebuild by calling buildProjection (which will delete and recreate)
    await this.buildProjection(request);
  }

  /**
   * Dispose a projection (delete DuckDB file)
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
        logger.error('Failed to dispose projection', {
          projectionId,
          duckdbPath,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(`Failed to dispose projection: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      logger.warn('Projection not found for disposal', { projectionId, duckdbPath });
    }
  }

  /**
   * Check if a projection exists
   */
  async projectionExists(projectionId: string, cacheDir?: string): Promise<boolean> {
    const dir = cacheDir || this.defaultCacheDir;
    const duckdbPath = join(dir, `${projectionId}.duckdb`);
    return existsSync(duckdbPath);
  }
}
