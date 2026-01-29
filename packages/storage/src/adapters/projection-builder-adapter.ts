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
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

/**
 * Projection Builder Adapter
 *
 * Builds DuckDB projections from Parquet artifacts.
 */
export class ProjectionBuilderAdapter implements ProjectionBuilderPort {
  private readonly artifactStore: ArtifactStorePort;
  private readonly defaultCacheDir: string;

  constructor(artifactStore: ArtifactStorePort, cacheDir: string = '/home/memez/opn/cache') {
    this.artifactStore = artifactStore;
    this.defaultCacheDir = cacheDir;
  }

  /**
   * Build a new projection from artifacts
   */
  async buildProjection(request: ProjectionRequest): Promise<ProjectionResult> {
    const startTime = Date.now();
    const cacheDir = request.cacheDir || this.defaultCacheDir;
    const duckdbPath = join(cacheDir, `${request.projectionId}.duckdb`);

    logger.info('Building projection', {
      projectionId: request.projectionId,
      duckdbPath,
      artifactCount:
        (request.artifacts.alerts?.length || 0) + (request.artifacts.ohlcv?.length || 0),
    });

    try {
      // Ensure cache directory exists
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
      }

      // Delete existing projection if it exists
      if (existsSync(duckdbPath)) {
        unlinkSync(duckdbPath);
      }

      // Create DuckDB client
      const client = new DuckDBClient(duckdbPath);

      // Build tables
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
          request.indexes?.filter((idx) => idx.table === tableName)
        );
        tables.push(table);
        totalRows += table.rowCount;
        artifactCount += request.artifacts.ohlcv.length;
      }

      // Close connection
      await client.close();

      const executionTimeMs = Date.now() - startTime;

      logger.info('Projection built successfully', {
        projectionId: request.projectionId,
        duckdbPath,
        tables: tables.map((t) => ({ name: t.name, rowCount: t.rowCount })),
        totalRows,
        artifactCount,
        executionTimeMs,
      });

      return {
        projectionId: request.projectionId,
        duckdbPath,
        tables,
        artifactCount,
        totalRows,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to build projection', {
        projectionId: request.projectionId,
        error: message,
      });
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
    logger.info('Building table', {
      tableName,
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

    // Create table from Parquet files
    const pathsArray = parquetPaths.map((p) => `'${p}'`).join(', ');
    const createTableSql = `
      CREATE TABLE ${tableName} AS
      SELECT * FROM read_parquet([${pathsArray}])
    `;

    await client.execute(createTableSql);

    // Get row count
    const countResult = await client.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    const rowCount = Number(countResult.rows[0][0]);

    // Get column names
    const columnsResult = await client.query(`DESCRIBE ${tableName}`);
    const columns = columnsResult.rows.map((row) => String(row[0]));

    // Create indexes
    const indexNames: string[] = [];
    if (indexes && indexes.length > 0) {
      for (const index of indexes) {
        const indexName = `idx_${tableName}_${index.columns.join('_')}`;
        const indexSql = `CREATE INDEX ${indexName} ON ${tableName}(${index.columns.join(', ')})`;
        await client.execute(indexSql);
        indexNames.push(indexName);
      }
    }

    logger.info('Table built successfully', {
      tableName,
      rowCount,
      columns: columns.length,
      indexes: indexNames.length,
    });

    return {
      name: tableName,
      rowCount,
      columns,
      indexes: indexNames,
    };
  }

  /**
   * Rebuild an existing projection
   */
  async rebuildProjection(projectionId: string): Promise<void> {
    logger.info('Rebuilding projection', { projectionId });

    // For rebuild, we need to store the original request
    // This is a limitation - we'd need to persist the request or require it as a parameter
    throw new Error(
      'rebuildProjection not implemented - requires persisting original ProjectionRequest'
    );
  }

  /**
   * Dispose a projection (delete DuckDB file)
   */
  async disposeProjection(projectionId: string): Promise<void> {
    const duckdbPath = join(this.defaultCacheDir, `${projectionId}.duckdb`);

    logger.info('Disposing projection', {
      projectionId,
      duckdbPath,
    });

    if (existsSync(duckdbPath)) {
      unlinkSync(duckdbPath);
      logger.info('Projection disposed', { projectionId });
    } else {
      logger.warn('Projection not found for disposal', { projectionId, duckdbPath });
    }
  }

  /**
   * Check if a projection exists
   */
  async projectionExists(projectionId: string): Promise<boolean> {
    const duckdbPath = join(this.defaultCacheDir, `${projectionId}.duckdb`);
    return existsSync(duckdbPath);
  }
}
