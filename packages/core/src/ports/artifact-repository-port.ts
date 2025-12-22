/**
 * Artifact Repository Port
 *
 * Interface for storing and retrieving versioned artifacts.
 * Artifacts are first-class, versioned entities (strategies, sim runs, configs, etc.)
 */

import type { Artifact, ArtifactMetadata, ArtifactType } from '../artifacts.js';

/**
 * Query filter for artifacts
 */
export interface ArtifactQueryFilter {
  /**
   * Filter by artifact type
   */
  type?: ArtifactType;

  /**
   * Filter by tags
   */
  tags?: string[];

  /**
   * Filter by version
   */
  version?: string;

  /**
   * Filter by parent artifact ID
   */
  parentId?: string;

  /**
   * Filter by git commit hash
   */
  gitCommitHash?: string;

  /**
   * Filter by time range (createdAt)
   */
  createdAtRange?: {
    from: string; // ISO 8601
    to: string; // ISO 8601
  };
}

/**
 * Artifact repository port
 */
export interface ArtifactRepository {
  /**
   * Store an artifact
   *
   * If artifact with same ID + version exists, may update or return existing.
   */
  store(artifact: Artifact): Promise<void>;

  /**
   * Get artifact by ID and version
   *
   * @returns Artifact if found, null otherwise
   */
  get(id: string, version: string): Promise<Artifact | null>;

  /**
   * Get latest version of artifact
   *
   * @returns Latest version of artifact, or null if not found
   */
  getLatest(id: string): Promise<Artifact | null>;

  /**
   * List all versions of an artifact
   *
   * @returns Array of artifacts with all versions
   */
  listVersions(id: string): Promise<Artifact[]>;

  /**
   * Query artifacts by filter
   *
   * @returns Array of matching artifacts
   */
  query(filter: ArtifactQueryFilter): Promise<Artifact[]>;

  /**
   * Tag an artifact
   *
   * Adds tags to artifact metadata for easier discovery
   */
  tag(id: string, version: string, tags: string[]): Promise<void>;

  /**
   * Get artifact metadata (without content)
   *
   * Useful for listing without loading full content
   */
  getMetadata(id: string, version: string): Promise<ArtifactMetadata | null>;

  /**
   * List all artifacts (metadata only)
   *
   * @returns Array of artifact metadata
   */
  listMetadata(filter?: ArtifactQueryFilter): Promise<ArtifactMetadata[]>;

  /**
   * Delete an artifact version
   *
   * Permanently removes artifact version
   */
  delete(id: string, version: string): Promise<void>;

  /**
   * Check if repository is available
   *
   * @returns true if repository can be used
   */
  isAvailable(): Promise<boolean>;
}
