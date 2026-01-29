/**
 * Projection Builder Port
 *
 * Defines the interface for building DuckDB projections from Parquet artifacts.
 * Projections are disposable, rebuildable, query-optimized views of the immutable Parquet truth layer.
 *
 * Architecture:
 * - Parquet artifacts are the immutable truth layer
 * - DuckDB projections are disposable query engines
 * - Projections can be rebuilt from artifacts at any time
 * - Indexes optimize common query patterns
 */

/**
 * Projection Builder Port
 *
 * Builds DuckDB databases from Parquet artifacts for query optimization.
 */
export interface ProjectionBuilderPort {
  /**
   * Build a new projection from artifacts
   *
   * @param request - Projection build request
   * @returns Projection result with metadata
   */
  buildProjection(request: ProjectionRequest): Promise<ProjectionResult>;

  /**
   * Rebuild an existing projection
   * Useful for refreshing data or applying schema changes
   *
   * @param projectionId - Projection identifier (must match request.projectionId)
   * @param request - Original projection request (used to rebuild with same configuration)
   */
  rebuildProjection(projectionId: string, request: ProjectionRequest): Promise<void>;

  /**
   * Dispose a projection (delete DuckDB file)
   *
   * @param projectionId - Projection identifier
   * @param cacheDir - Optional cache directory (if not provided, uses default)
   */
  disposeProjection(projectionId: string, cacheDir?: string): Promise<void>;

  /**
   * Check if a projection exists
   *
   * @param projectionId - Projection identifier
   * @param cacheDir - Optional cache directory (if not provided, uses default)
   * @returns True if projection exists
   */
  projectionExists(projectionId: string, cacheDir?: string): Promise<boolean>;

  /**
   * Get projection metadata
   *
   * @param projectionId - Projection identifier
   * @param version - Optional version tag (if not provided, returns latest)
   * @returns Projection metadata or null if not found
   */
  getProjectionMetadata(projectionId: string, version?: string): Promise<ProjectionMetadata | null>;

  /**
   * List all projections
   *
   * @param filter - Optional filter criteria
   * @returns List of projection metadata
   */
  listProjections(filter?: ProjectionFilter): Promise<ProjectionMetadata[]>;

  /**
   * Get projection lineage (which artifacts were used)
   *
   * @param projectionId - Projection identifier
   * @param version - Optional version tag (if not provided, returns latest)
   * @returns Projection lineage with artifact details
   */
  getProjectionLineage(projectionId: string, version?: string): Promise<ProjectionLineage | null>;

  /**
   * Get projection metrics
   *
   * @returns Aggregated metrics across all projections
   */
  getMetrics(): Promise<ProjectionMetrics>;

  /**
   * Cleanup old projections based on lifecycle policy
   *
   * @param policy - Lifecycle policy (TTL, max age, max count)
   * @returns Number of projections cleaned up
   */
  cleanupOldProjections(policy: {
    maxAgeMs?: number; // Max age before cleanup
    maxCount?: number; // Max projections (LRU eviction)
  }): Promise<number>;

  /**
   * Cleanup failed builds (orphaned files without metadata)
   *
   * @param cacheDir - Optional cache directory to scan (defaults to defaultCacheDir)
   * @returns Number of orphaned files cleaned up
   */
  cleanupFailedBuilds(cacheDir?: string): Promise<number>;

  /**
   * Resume a failed projection build from checkpoint
   *
   * @param checkpointId - Checkpoint identifier from previous build attempt
   * @returns Projection result if build completes successfully
   */
  resumeBuild(checkpointId: string): Promise<ProjectionResult>;

  /**
   * Compress a projection (reduces disk usage)
   *
   * @param projectionId - Projection identifier
   * @param version - Optional version tag (if not provided, uses latest)
   * @returns Path to compressed file
   */
  compressProjection(projectionId: string, version?: string): Promise<string>;

  /**
   * Decompress a compressed projection
   *
   * @param compressedPath - Path to compressed projection file
   * @returns Path to decompressed DuckDB file
   */
  decompressProjection(compressedPath: string): Promise<string>;
}

/**
 * Projection metadata stored in manifest
 */
export interface ProjectionMetadata {
  projectionId: string;
  version: string;
  duckdbPath: string;
  artifactIds: string[];
  artifactTypes: string[];
  tableNames: string[];
  indexes: ProjectionIndex[];
  buildTimestamp: number; // milliseconds
  buildDurationMs: number;
  totalRows: number;
  totalSizeBytes: number;
  cacheDir: string;
  builderVersion: string;
}

/**
 * Projection filter for listing projections
 */
export interface ProjectionFilter {
  artifactType?: string;
  minBuildTimestamp?: number;
  maxBuildTimestamp?: number;
  projectionId?: string;
}

/**
 * Projection lineage (artifact → projection mapping)
 */
export interface ProjectionLineage {
  projectionId: string;
  version: string;
  artifacts: Array<{
    artifactId: string;
    artifactType: string;
    pathParquet: string;
  }>;
  buildTimestamp: number;
}

/**
 * Projection metrics
 */
export interface ProjectionMetrics {
  buildCount: number;
  successCount: number;
  failureCount: number;
  avgBuildTimeMs: number;
  avgArtifactCount: number;
  avgTotalRows: number;
  totalDiskUsageBytes: number;
  projectionCount: number;
}

/**
 * Projection build request
 */
export interface ProjectionRequest {
  /**
   * Unique identifier for this projection
   * Used to name the DuckDB file
   */
  projectionId: string;

  /**
   * Optional version tag for this projection
   * If not provided, defaults to timestamp-based version (v{timestamp})
   * Enables immutable builds and version tracking
   */
  version?: string;

  /**
   * Artifact IDs to include in projection
   * Organized by data type
   */
  artifacts: {
    /**
     * Alert artifact IDs
     */
    alerts?: string[];

    /**
     * OHLCV artifact IDs
     */
    ohlcv?: string[];
  };

  /**
   * Table names for each data type
   */
  tables: {
    /**
     * Table name for alerts
     */
    alerts?: string;

    /**
     * Table name for OHLCV
     */
    ohlcv?: string;
  };

  /**
   * Cache directory for DuckDB files
   * Defaults to environment variable or /home/memez/opn/cache
   */
  cacheDir?: string;

  /**
   * Indexes to create for query optimization
   */
  indexes?: ProjectionIndex[];
}

/**
 * Index definition for projection
 */
export interface ProjectionIndex {
  /**
   * Table name
   */
  table: string;

  /**
   * Columns to index (in order)
   */
  columns: string[];
}

/**
 * Projection build result
 */
export interface ProjectionResult {
  /**
   * Projection identifier
   */
  projectionId: string;

  /**
   * Version tag used for this projection
   */
  version: string;

  /**
   * Path to DuckDB file
   */
  duckdbPath: string;

  /**
   * Tables created in projection
   */
  tables: ProjectionTable[];

  /**
   * Total number of artifacts included
   */
  artifactCount: number;

  /**
   * Total rows across all tables
   */
  totalRows: number;
}

/**
 * Projection table metadata
 */
export interface ProjectionTable {
  /**
   * Table name
   */
  name: string;

  /**
   * Row count
   */
  rowCount: number;

  /**
   * Column names
   */
  columns: string[];

  /**
   * Index names
   */
  indexes: string[];
}
