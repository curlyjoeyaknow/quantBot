/**
 * SliceExporter Port
 *
 * Port interface for exporting data slices from ClickHouse to Parquet.
 * Adapters implement this port to handle the actual I/O operations.
 */

/**
 * Slice export specification
 */
export interface SliceExportSpec {
  /** Unique identifier for this export (e.g., run_id, experiment_id) */
  exportId: string;

  /** Time range for the slice */
  timeRange: {
    from: string; // ISO 8601 timestamp
    to: string; // ISO 8601 timestamp
  };

  /** Token addresses to include (empty = all tokens) */
  tokenAddresses?: string[];

  /** Chain filter (optional) */
  chain?: string;

  /** Tables/columns to export */
  tables: Array<{
    tableName: string;
    columns?: string[]; // If undefined, export all columns
    filters?: Record<string, unknown>; // Additional WHERE clause filters
  }>;

  /** Output configuration */
  output: {
    basePath: string; // Base directory for Parquet files
    partitionBy?: string[]; // Partition columns (e.g., ['dt', 'chain'])
    compression?: 'snappy' | 'gzip' | 'zstd' | 'lz4';
  };
}

/**
 * Parquet file metadata
 */
export interface ParquetFileMetadata {
  /** Relative path from basePath */
  path: string;

  /** Absolute path */
  absolutePath: string;

  /** Number of rows in this file */
  rowCount: number;

  /** File size in bytes */
  sizeBytes: number;

  /** Schema version */
  schemaVersion?: string;
}

/**
 * Slice manifest
 *
 * Describes what was exported, making the pipeline reproducible and debuggable.
 */
export interface SliceManifest {
  /** Export ID */
  exportId: string;

  /** Export specification */
  spec: SliceExportSpec;

  /** Timestamp when export was created */
  exportedAt: string; // ISO 8601

  /** Parquet files created */
  parquetFiles: ParquetFileMetadata[];

  /** Total row counts per table */
  rowCounts: Record<string, number>;

  /** Schema version */
  schemaVersion: string;

  /** Optional checksum/version hash for integrity verification */
  checksum?: string;

  /** Export metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Slice export result
 */
export interface SliceExportResult {
  /** Success flag */
  success: boolean;

  /** Manifest describing what was exported */
  manifest: SliceManifest;

  /** Error message if export failed */
  error?: string;
}

/**
 * SliceExporter Port
 *
 * Pure interface - no I/O, no filesystem, no network.
 * Adapters implement this to do the actual work.
 *
 * This is one of only two verbs the handler is allowed to touch.
 */
export interface SliceExporterPort {
  /**
   * Export a data slice from ClickHouse to Parquet
   *
   * @param spec - Export specification
   * @returns Export result with manifest
   */
  exportSlice(spec: SliceExportSpec): Promise<SliceExportResult>;
}
