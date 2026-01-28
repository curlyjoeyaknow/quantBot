/**
 * Artifact Store Port
 *
 * Port interface for artifact store operations (Parquet + SQLite manifest).
 * Handlers depend on this port, not on specific implementations.
 * Adapters implement this port using Python artifact store.
 *
 * @packageDocumentation
 */

/**
 * Artifact metadata from manifest
 */
export interface Artifact {
  /** Unique artifact identifier (UUID) */
  artifactId: string;

  /** Artifact type (e.g., 'alerts_v1', 'ohlcv_slice_v2') */
  artifactType: string;

  /** Schema version for this artifact type */
  schemaVersion: number;

  /** Logical key for semantic deduplication */
  logicalKey: string;

  /** Artifact status */
  status: 'active' | 'superseded' | 'tombstoned';

  /** Path to Parquet file */
  pathParquet: string;

  /** Path to JSON sidecar metadata */
  pathSidecar: string;

  /** SHA256 hash of Parquet file */
  fileHash: string;

  /** Content hash (deterministic, based on canonical columns) */
  contentHash: string;

  /** Number of rows in artifact */
  rowCount: number;

  /** Minimum timestamp (if applicable) */
  minTs?: string;

  /** Maximum timestamp (if applicable) */
  maxTs?: string;

  /** Creation timestamp (ISO8601) */
  createdAt: string;
}

/**
 * Filter for listing artifacts
 */
export interface ArtifactFilter {
  /** Filter by artifact type */
  artifactType?: string;

  /** Filter by status */
  status?: 'active' | 'superseded' | 'tombstoned';

  /** Filter by tags (all must match) */
  tags?: Record<string, string>;

  /** Filter by creation date (minimum) */
  minCreatedAt?: string;

  /** Filter by creation date (maximum) */
  maxCreatedAt?: string;

  /** Limit number of results */
  limit?: number;
}

/**
 * Request to publish a new artifact
 */
export interface PublishArtifactRequest {
  /** Artifact type */
  artifactType: string;

  /** Schema version */
  schemaVersion: number;

  /** Logical key for semantic deduplication */
  logicalKey: string;

  /** Path to CSV or Parquet file to publish */
  dataPath: string;

  /** Optional tags (key-value pairs) */
  tags?: Record<string, string>;

  /** Input artifact IDs (for lineage tracking) */
  inputArtifactIds?: string[];

  /** Writer name (e.g., 'telegram-ingestion', 'experiment-engine') */
  writerName: string;

  /** Writer version */
  writerVersion: string;

  /** Git commit hash */
  gitCommit: string;

  /** Whether git working directory was dirty */
  gitDirty: boolean;

  /** Optional parameters (JSON-serializable) */
  params?: Record<string, unknown>;

  /** Optional filename hint */
  filenameHint?: string;
}

/**
 * Result of publishing an artifact
 */
export interface PublishArtifactResult {
  /** Whether publish was successful */
  success: boolean;

  /** Whether artifact was deduplicated */
  deduped: boolean;

  /** Deduplication mode (if deduplicated) */
  mode?: 'file_hash' | 'content_hash';

  /** Existing artifact ID (if deduplicated) */
  existingArtifactId?: string;

  /** New artifact ID (if not deduplicated) */
  artifactId?: string;

  /** Path to Parquet file (if not deduplicated) */
  pathParquet?: string;

  /** Path to sidecar JSON (if not deduplicated) */
  pathSidecar?: string;

  /** Error message (if failed) */
  error?: string;
}

/**
 * Artifact lineage (input artifacts)
 */
export interface ArtifactLineage {
  /** Artifact ID */
  artifactId: string;

  /** Input artifacts */
  inputs: Artifact[];

  /** Lineage depth (1 = direct inputs only) */
  depth: number;
}

/**
 * Artifact Store Port
 *
 * Port interface for artifact store operations.
 * Provides access to immutable Parquet artifacts with SQLite manifest.
 */
export interface ArtifactStorePort {
  /**
   * Get artifact by ID
   *
   * @param artifactId - Artifact ID (UUID)
   * @returns Artifact metadata
   * @throws NotFoundError if artifact does not exist
   */
  getArtifact(artifactId: string): Promise<Artifact>;

  /**
   * List artifacts with filters
   *
   * @param filter - Filter criteria
   * @returns Array of artifacts (ordered by created_at DESC)
   */
  listArtifacts(filter: ArtifactFilter): Promise<Artifact[]>;

  /**
   * Find artifacts by logical key
   *
   * @param artifactType - Artifact type
   * @param logicalKey - Logical key
   * @returns Array of artifacts (ordered by created_at DESC)
   */
  findByLogicalKey(artifactType: string, logicalKey: string): Promise<Artifact[]>;

  /**
   * Publish DataFrame as Parquet artifact
   *
   * Handles deduplication at file hash and content hash levels.
   * If duplicate is detected, returns existing artifact ID.
   *
   * @param request - Publish request
   * @returns Publish result (with deduplication info)
   */
  publishArtifact(request: PublishArtifactRequest): Promise<PublishArtifactResult>;

  /**
   * Get artifact lineage (inputs)
   *
   * @param artifactId - Artifact ID
   * @returns Lineage information
   */
  getLineage(artifactId: string): Promise<ArtifactLineage>;

  /**
   * Get downstream artifacts (outputs that depend on this artifact)
   *
   * @param artifactId - Artifact ID
   * @returns Array of downstream artifacts
   */
  getDownstream(artifactId: string): Promise<Artifact[]>;

  /**
   * Supersede old artifact with new one
   *
   * Marks old artifact as 'superseded' and records supersession relationship.
   *
   * @param newArtifactId - New artifact ID
   * @param oldArtifactId - Old artifact ID
   */
  supersede(newArtifactId: string, oldArtifactId: string): Promise<void>;

  /**
   * Check if artifact store is available
   *
   * @returns True if artifact store is accessible
   */
  isAvailable(): Promise<boolean>;
}

