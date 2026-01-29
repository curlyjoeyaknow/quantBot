/**
 * Projection Metadata Manager
 *
 * Manages projection metadata storage using DuckDB.
 * Stores metadata, lineage, and metrics for all projections.
 */

import { logger } from '@quantbot/infra/utils';
import type {
  ProjectionMetadata,
  ProjectionLineage,
  ProjectionMetrics,
  ProjectionFilter,
  ProjectionIndex,
} from '@quantbot/core';
import { openDuckDb, type DuckDbConnection } from '@quantbot/infra/storage';
import { existsSync } from 'fs';
import { mkdir as mkdirSync } from 'fs/promises';
import { dirname } from 'path';

/**
 * Metadata manager for projections
 */
export class ProjectionMetadataManager {
  private readonly metadataDbPath: string;
  private readonly builderVersion: string = '1.0.0';

  constructor(metadataDbPath: string) {
    this.metadataDbPath = metadataDbPath;
  }

  /**
   * Initialize metadata database schema
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.metadataDbPath);
    if (!existsSync(dir)) {
      await mkdirSync(dir, { recursive: true });
    }

    const conn = await openDuckDb(this.metadataDbPath);

    try {
      // Create projections table
      await conn.run(`
        CREATE TABLE IF NOT EXISTS projection_manifest (
          projection_id TEXT NOT NULL,
          version TEXT NOT NULL,
          duckdb_path TEXT NOT NULL,
          artifact_ids TEXT NOT NULL,
          artifact_types TEXT NOT NULL,
          table_names TEXT NOT NULL,
          indexes_json TEXT NOT NULL,
          build_timestamp_ms BIGINT NOT NULL,
          build_duration_ms BIGINT NOT NULL,
          total_rows BIGINT NOT NULL,
          total_size_bytes BIGINT NOT NULL,
          cache_dir TEXT NOT NULL,
          builder_version TEXT NOT NULL,
          PRIMARY KEY (projection_id, version)
        )
      `);

      // Create indexes for efficient queries
      await conn.run(`
        CREATE INDEX IF NOT EXISTS idx_projection_id 
        ON projection_manifest(projection_id)
      `);

      await conn.run(`
        CREATE INDEX IF NOT EXISTS idx_build_timestamp 
        ON projection_manifest(build_timestamp_ms)
      `);

      // Create metrics table
      await conn.run(`
        CREATE TABLE IF NOT EXISTS projection_metrics (
          metric_key TEXT PRIMARY KEY,
          metric_value BIGINT NOT NULL,
          updated_at_ms BIGINT NOT NULL
        )
      `);

      logger.debug('Projection metadata database initialized', {
        metadataDbPath: this.metadataDbPath,
      });
    } catch (error) {
      logger.error('Failed to initialize metadata database', {
        error: error instanceof Error ? error.message : String(error),
        metadataDbPath: this.metadataDbPath,
      });
      throw error;
    }
  }

  /**
   * Store projection metadata
   */
  async storeMetadata(metadata: ProjectionMetadata): Promise<void> {
    const conn = await this.getConnection();

    try {
      await conn.run(
        `
        INSERT INTO projection_manifest (
          projection_id, version, duckdb_path, artifact_ids, artifact_types,
          table_names, indexes_json, build_timestamp_ms, build_duration_ms,
          total_rows, total_size_bytes, cache_dir, builder_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (projection_id, version) DO UPDATE SET
          duckdb_path = EXCLUDED.duckdb_path,
          artifact_ids = EXCLUDED.artifact_ids,
          artifact_types = EXCLUDED.artifact_types,
          table_names = EXCLUDED.table_names,
          indexes_json = EXCLUDED.indexes_json,
          build_timestamp_ms = EXCLUDED.build_timestamp_ms,
          build_duration_ms = EXCLUDED.build_duration_ms,
          total_rows = EXCLUDED.total_rows,
          total_size_bytes = EXCLUDED.total_size_bytes,
          cache_dir = EXCLUDED.cache_dir,
          builder_version = EXCLUDED.builder_version
      `,
        [
          metadata.projectionId,
          metadata.version,
          metadata.duckdbPath,
          JSON.stringify(metadata.artifactIds),
          JSON.stringify(metadata.artifactTypes),
          JSON.stringify(metadata.tableNames),
          JSON.stringify(metadata.indexes),
          metadata.buildTimestamp,
          metadata.buildDurationMs,
          metadata.totalRows,
          metadata.totalSizeBytes,
          metadata.cacheDir,
          metadata.builderVersion,
        ]
      );

      // Update metrics
      await this.updateMetrics(metadata);

      logger.debug('Projection metadata stored', {
        projectionId: metadata.projectionId,
        version: metadata.version,
      });
    } catch (error) {
      logger.error('Failed to store projection metadata', {
        error: error instanceof Error ? error.message : String(error),
        projectionId: metadata.projectionId,
      });
      throw error;
    }
  }

  /**
   * Get projection metadata
   */
  async getMetadata(projectionId: string, version?: string): Promise<ProjectionMetadata | null> {
    const conn = await this.getConnection();

    try {
      let rows: Array<{
        projection_id: string;
        version: string;
        duckdb_path: string;
        artifact_ids: string;
        artifact_types: string;
        table_names: string;
        indexes_json: string;
        build_timestamp_ms: number;
        build_duration_ms: number;
        total_rows: number;
        total_size_bytes: number;
        cache_dir: string;
        builder_version: string;
      }>;

      // DuckDB's all() method doesn't support parameterized queries the same way as run()
      // Use string interpolation with proper escaping
      const escapedProjectionId = projectionId.replace(/'/g, "''");
      if (version) {
        const escapedVersion = version.replace(/'/g, "''");
        rows = await conn.all(
          `SELECT * FROM projection_manifest 
           WHERE projection_id = '${escapedProjectionId}' AND version = '${escapedVersion}'`
        );
      } else {
        // Get latest version
        rows = await conn.all(
          `SELECT * FROM projection_manifest 
           WHERE projection_id = '${escapedProjectionId}' 
           ORDER BY build_timestamp_ms DESC 
           LIMIT 1`
        );
      }

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];
      return {
        projectionId: row.projection_id,
        version: row.version,
        duckdbPath: row.duckdb_path,
        artifactIds: JSON.parse(row.artifact_ids),
        artifactTypes: JSON.parse(row.artifact_types),
        tableNames: JSON.parse(row.table_names),
        indexes: JSON.parse(row.indexes_json),
        buildTimestamp: row.build_timestamp_ms,
        buildDurationMs: row.build_duration_ms,
        totalRows: row.total_rows,
        totalSizeBytes: row.total_size_bytes,
        cacheDir: row.cache_dir,
        builderVersion: row.builder_version,
      };
    } catch (error) {
      logger.error('Failed to get projection metadata', {
        error: error instanceof Error ? error.message : String(error),
        projectionId,
        version,
      });
      throw error;
    }
  }

  /**
   * List projections with optional filter
   */
  async listProjections(filter?: ProjectionFilter): Promise<ProjectionMetadata[]> {
    const conn = await this.getConnection();

    try {
      let query = 'SELECT * FROM projection_manifest WHERE 1=1';

      if (filter?.projectionId) {
        const escapedProjectionId = filter.projectionId.replace(/'/g, "''");
        query += ` AND projection_id = '${escapedProjectionId}'`;
      }

      if (filter?.minBuildTimestamp) {
        query += ` AND build_timestamp_ms >= ${filter.minBuildTimestamp}`;
      }

      if (filter?.maxBuildTimestamp) {
        query += ` AND build_timestamp_ms <= ${filter.maxBuildTimestamp}`;
      }

      query += ' ORDER BY build_timestamp_ms DESC';

      const rows = await conn.all(query);

      return rows.map((row) => ({
        projectionId: row.projection_id,
        version: row.version,
        duckdbPath: row.duckdb_path,
        artifactIds: JSON.parse(row.artifact_ids),
        artifactTypes: JSON.parse(row.artifact_types),
        tableNames: JSON.parse(row.table_names),
        indexes: JSON.parse(row.indexes_json),
        buildTimestamp: row.build_timestamp_ms,
        buildDurationMs: row.build_duration_ms,
        totalRows: row.total_rows,
        totalSizeBytes: row.total_size_bytes,
        cacheDir: row.cache_dir,
        builderVersion: row.builder_version,
      }));
    } catch (error) {
      logger.error('Failed to list projections', {
        error: error instanceof Error ? error.message : String(error),
        filter,
      });
      throw error;
    }
  }

  /**
   * Get projection lineage
   */
  async getLineage(projectionId: string, version?: string): Promise<ProjectionLineage | null> {
    const metadata = await this.getMetadata(projectionId, version);
    if (!metadata) {
      return null;
    }

    return {
      projectionId: metadata.projectionId,
      version: metadata.version,
      artifacts: metadata.artifactIds.map((artifactId, index) => ({
        artifactId,
        artifactType: metadata.artifactTypes[index] || 'unknown',
        pathParquet: '', // Will be filled by adapter if needed
      })),
      buildTimestamp: metadata.buildTimestamp,
    };
  }

  /**
   * Get aggregated metrics
   */
  async getMetrics(): Promise<ProjectionMetrics> {
    const conn = await this.getConnection();

    try {
      // Get counts
      const counts = await conn.all<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM projection_manifest'
      );
      const projectionCount = counts[0]?.cnt || 0;

      // Get aggregated stats
      // Note: DuckDB doesn't have json_array_length, use array_length on parsed JSON
      const stats = await conn.all<{
        avg_build_duration: number;
        avg_total_rows: number;
        sum_size_bytes: number;
        avg_artifact_count: number;
      }>(
        `SELECT 
          AVG(build_duration_ms) as avg_build_duration,
          AVG(total_rows) as avg_total_rows,
          SUM(total_size_bytes) as sum_size_bytes,
          AVG(LEN(artifact_ids)) as avg_artifact_count
         FROM projection_manifest`
      );

      const stat = stats[0] || {
        avg_build_duration: 0,
        avg_total_rows: 0,
        sum_size_bytes: 0,
        sum_artifact_count: 0,
      };

      // Get success/failure counts from metrics table
      const successCount = await this.getMetricValue('success_count') || 0;
      const failureCount = await this.getMetricValue('failure_count') || 0;
      const buildCount = successCount + failureCount;

      // Calculate average artifact count from JSON arrays
      let avgArtifactCount = 0;
      if (projectionCount > 0) {
        const artifactCounts = await conn.all<{ artifact_ids: string }>(
          'SELECT artifact_ids FROM projection_manifest'
        );
        const totalArtifacts = artifactCounts.reduce((sum, row) => {
          try {
            const ids = JSON.parse(row.artifact_ids);
            return sum + (Array.isArray(ids) ? ids.length : 0);
          } catch {
            return sum;
          }
        }, 0);
        avgArtifactCount = Math.round(totalArtifacts / projectionCount);
      }

      return {
        buildCount,
        successCount,
        failureCount,
        avgBuildTimeMs: Math.round(stat.avg_build_duration || 0),
        avgArtifactCount,
        avgTotalRows: Math.round(stat.avg_total_rows || 0),
        totalDiskUsageBytes: stat.sum_size_bytes || 0,
        projectionCount,
      };
    } catch (error) {
      logger.error('Failed to get metrics', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Return default metrics on error
      return {
        buildCount: 0,
        successCount: 0,
        failureCount: 0,
        avgBuildTimeMs: 0,
        avgArtifactCount: 0,
        avgTotalRows: 0,
        totalDiskUsageBytes: 0,
        projectionCount: 0,
      };
    }
  }

  /**
   * Update metrics after build
   */
  private async updateMetrics(metadata: ProjectionMetadata): Promise<void> {
    const conn = await this.getConnection();
    const now = Date.now();

    try {
      // Increment success count
      await conn.run(
        `INSERT INTO projection_metrics (metric_key, metric_value, updated_at_ms)
         VALUES ('success_count', 1, ?)
         ON CONFLICT(metric_key) DO UPDATE SET
           metric_value = metric_value + 1,
           updated_at_ms = ?`,
        [now, now]
      );
    } catch (error) {
      logger.warn('Failed to update metrics', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - metrics update failure shouldn't break builds
    }
  }

  /**
   * Increment failure count
   */
  async incrementFailureCount(): Promise<void> {
    const conn = await this.getConnection();
    const now = Date.now();

    try {
      await conn.run(
        `INSERT INTO projection_metrics (metric_key, metric_value, updated_at_ms)
         VALUES ('failure_count', 1, ?)
         ON CONFLICT(metric_key) DO UPDATE SET
           metric_value = metric_value + 1,
           updated_at_ms = ?`,
        [now, now]
      );
    } catch (error) {
      logger.warn('Failed to update failure metrics', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get metric value
   */
  private async getMetricValue(key: string): Promise<number> {
    const conn = await this.getConnection();
    const escapedKey = key.replace(/'/g, "''");
    const rows = await conn.all<{ metric_value: number }>(
      `SELECT metric_value FROM projection_metrics WHERE metric_key = '${escapedKey}'`
    );
    return rows[0]?.metric_value || 0;
  }

  /**
   * Delete projection metadata
   */
  async deleteMetadata(projectionId: string, version?: string): Promise<void> {
    const conn = await this.getConnection();

    try {
      // Use string interpolation with proper escaping for consistency
      const escapedProjectionId = projectionId.replace(/'/g, "''");
      if (version) {
        const escapedVersion = version.replace(/'/g, "''");
        await conn.run(
          `DELETE FROM projection_manifest WHERE projection_id = '${escapedProjectionId}' AND version = '${escapedVersion}'`
        );
      } else {
        // Delete all versions
        await conn.run(`DELETE FROM projection_manifest WHERE projection_id = '${escapedProjectionId}'`);
      }
    } catch (error) {
      logger.error('Failed to delete projection metadata', {
        error: error instanceof Error ? error.message : String(error),
        projectionId,
        version,
      });
      throw error;
    }
  }

  /**
   * Get DuckDB connection to metadata database
   */
  private async getConnection(): Promise<DuckDbConnection> {
    // Ensure directory exists
    const dir = dirname(this.metadataDbPath);
    if (!existsSync(dir)) {
      await mkdirSync(dir, { recursive: true });
    }

    const conn = await openDuckDb(this.metadataDbPath);
    
    // Initialize schema if needed (check if table exists)
    try {
      const tables = await conn.all<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'projection_manifest'"
      );
      if (tables.length === 0) {
        await this.initialize();
      }
    } catch (error) {
      // If check fails, try to initialize anyway (table might not exist)
      try {
        await this.initialize();
      } catch (initError) {
        // If initialization fails, table might already exist - that's okay
        logger.debug('Metadata initialization check failed', {
          error: initError instanceof Error ? initError.message : String(initError),
        });
      }
    }
    
    return conn;
  }
}

