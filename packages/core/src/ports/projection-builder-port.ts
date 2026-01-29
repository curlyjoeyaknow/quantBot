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
