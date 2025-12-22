/**
 * Raw Data Repository Port
 *
 * Interface for accessing raw, immutable data.
 * Raw data is append-only and never modified or deleted.
 */

/**
 * Raw data source type
 */
export type RawDataSourceType = 'telegram_export' | 'api_response' | 'file_upload' | 'stream_event';

/**
 * Raw data query filter
 */
export interface RawDataQueryFilter {
  /**
   * Filter by source type
   */
  sourceType?: RawDataSourceType;

  /**
   * Filter by source identifier (e.g., chat ID, API endpoint)
   */
  sourceId?: string;

  /**
   * Filter by content hash
   */
  hash?: string;

  /**
   * Filter by time range
   */
  timeRange?: {
    from: string; // ISO 8601
    to: string; // ISO 8601
  };

  /**
   * Filter by run ID
   */
  runId?: string;
}

/**
 * Raw data record
 */
export interface RawDataRecord {
  /**
   * Unique record ID
   */
  id: string;

  /**
   * Source type
   */
  sourceType: RawDataSourceType;

  /**
   * Source identifier
   */
  sourceId: string;

  /**
   * Content hash (SHA256)
   */
  hash: string;

  /**
   * Raw content (JSON or text)
   */
  content: string;

  /**
   * Ingestion run ID
   */
  runId: string;

  /**
   * Timestamp when ingested (ISO 8601)
   */
  ingestedAt: string;

  /**
   * Metadata (source-specific)
   */
  metadata?: Record<string, unknown>;
}

/**
 * Raw data repository port
 */
export interface RawDataRepository {
  /**
   * Query raw data by filter
   *
   * @returns Array of raw data records
   */
  query(filter: RawDataQueryFilter): Promise<RawDataRecord[]>;

  /**
   * Get raw data by hash
   *
   * @returns Raw data record if found, null otherwise
   */
  getByHash(hash: string): Promise<RawDataRecord | null>;

  /**
   * List all raw data sources
   *
   * @returns Array of source identifiers with metadata
   */
  listSources(): Promise<
    Array<{ sourceType: RawDataSourceType; sourceId: string; recordCount: number }>
  >;

  /**
   * Check if repository is available
   */
  isAvailable(): Promise<boolean>;
}
