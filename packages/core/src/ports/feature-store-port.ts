/**
 * Feature Store Port
 *
 * Interface for computing and retrieving features.
 * Features are versioned and tagged with source assumptions.
 */

/**
 * Feature set identifier
 */
export type FeatureSetId = string;

/**
 * Feature computation result
 */
export interface FeatureComputationResult {
  /**
   * Feature set ID
   */
  featureSetId: FeatureSetId;

  /**
   * Computed features (asset -> timestamp -> feature values)
   */
  features: Map<string, Map<number, Record<string, unknown>>>;

  /**
   * Feature metadata (version, dependencies, assumptions)
   */
  metadata: FeatureMetadata;
}

/**
 * Feature metadata
 */
export interface FeatureMetadata {
  /**
   * Feature set version
   */
  version: string;

  /**
   * Source assumptions (e.g., data quality, normalization)
   */
  assumptions: Record<string, unknown>;

  /**
   * Feature dependencies (other feature sets this depends on)
   */
  dependencies: FeatureSetId[];

  /**
   * Computation timestamp
   */
  computedAt: number;

  /**
   * Git commit hash (for reproducibility)
   */
  gitCommit?: string;
}

/**
 * Feature store port
 */
export interface FeatureStore {
  /**
   * Compute features for a feature set from data
   *
   * @param featureSetId - Feature set identifier
   * @param data - Input data (canonical events, candles, etc.)
   * @returns Computed features with metadata
   */
  compute(featureSetId: FeatureSetId, data: unknown): Promise<FeatureComputationResult>;

  /**
   * Get features for a specific asset and timestamp
   *
   * @param featureSetId - Feature set identifier
   * @param asset - Asset address
   * @param timestamp - Timestamp (milliseconds)
   * @returns Feature values or null if not found
   */
  get(
    featureSetId: FeatureSetId,
    asset: string,
    timestamp: number
  ): Promise<Record<string, unknown> | null>;

  /**
   * Check if feature store is available
   */
  isAvailable(): Promise<boolean>;
}
