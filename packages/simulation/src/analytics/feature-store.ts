/**
 * Feature Store with versioning
 *
 * Provides versioned feature storage with immutability guarantees.
 * Features are computed once and cached with version tracking.
 */

import { z } from 'zod';

export const FeatureVersionSchema = z.object({
  version: z.string(),
  computedAt: z.number(),
  gitCommit: z.string().optional(),
  configHash: z.string(),
});

export type FeatureVersion = z.infer<typeof FeatureVersionSchema>;

export const FeatureMetadataSchema = z.object({
  featureName: z.string(),
  featureType: z.enum(['indicator', 'pattern', 'metric', 'signal']),
  version: FeatureVersionSchema,
  dependencies: z.array(z.string()),
  parameters: z.record(z.unknown()),
});

export type FeatureMetadata = z.infer<typeof FeatureMetadataSchema>;

export const FeatureValueSchema = z.object({
  timestamp: z.number(),
  value: z.unknown(),
  metadata: FeatureMetadataSchema,
});

export type FeatureValue = z.infer<typeof FeatureValueSchema>;

/**
 * Feature Store interface
 */
export interface FeatureStore {
  /**
   * Store a feature value with version tracking
   */
  put(
    featureName: string,
    timestamp: number,
    value: unknown,
    metadata: FeatureMetadata
  ): Promise<void>;

  /**
   * Get a feature value for a specific timestamp and version
   */
  get(featureName: string, timestamp: number, version?: string): Promise<FeatureValue | null>;

  /**
   * Get all versions of a feature
   */
  getVersions(featureName: string): Promise<FeatureVersion[]>;

  /**
   * Get latest version of a feature
   */
  getLatestVersion(featureName: string): Promise<FeatureVersion | null>;

  /**
   * Invalidate a feature version (mark as stale)
   */
  invalidate(featureName: string, version: string): Promise<void>;

  /**
   * Clear all features (for testing)
   */
  clear(): Promise<void>;
}

/**
 * In-memory feature store implementation
 */
export class InMemoryFeatureStore implements FeatureStore {
  private features: Map<string, Map<number, FeatureValue[]>> = new Map();
  private versions: Map<string, FeatureVersion[]> = new Map();
  private invalidated: Set<string> = new Set();

  async put(
    featureName: string,
    timestamp: number,
    value: unknown,
    metadata: FeatureMetadata
  ): Promise<void> {
    // Ensure feature map exists
    if (!this.features.has(featureName)) {
      this.features.set(featureName, new Map());
    }

    const featureMap = this.features.get(featureName)!;

    // Ensure timestamp map exists
    if (!featureMap.has(timestamp)) {
      featureMap.set(timestamp, []);
    }

    const values = featureMap.get(timestamp)!;

    // Check if version already exists for this timestamp
    const existingIndex = values.findIndex(
      (v) => v.metadata.version.version === metadata.version.version
    );

    const featureValue: FeatureValue = {
      timestamp,
      value,
      metadata,
    };

    if (existingIndex >= 0) {
      // Replace existing version
      values[existingIndex] = featureValue;
    } else {
      // Add new version
      values.push(featureValue);
    }

    // Track version
    if (!this.versions.has(featureName)) {
      this.versions.set(featureName, []);
    }

    const versionList = this.versions.get(featureName)!;
    const versionExists = versionList.some((v) => v.version === metadata.version.version);

    if (!versionExists) {
      versionList.push(metadata.version);
      // Sort by computedAt descending
      versionList.sort((a, b) => b.computedAt - a.computedAt);
    }
  }

  async get(
    featureName: string,
    timestamp: number,
    version?: string
  ): Promise<FeatureValue | null> {
    const featureMap = this.features.get(featureName);
    if (!featureMap) return null;

    const values = featureMap.get(timestamp);
    if (!values || values.length === 0) return null;

    if (version) {
      // Get specific version
      const value = values.find((v) => v.metadata.version.version === version);
      if (!value) return null;

      // Check if invalidated
      const key = `${featureName}:${version}`;
      if (this.invalidated.has(key)) return null;

      return value;
    } else {
      // Get latest non-invalidated version
      const sortedValues = [...values].sort(
        (a, b) => b.metadata.version.computedAt - a.metadata.version.computedAt
      );

      for (const value of sortedValues) {
        const key = `${featureName}:${value.metadata.version.version}`;
        if (!this.invalidated.has(key)) {
          return value;
        }
      }

      return null;
    }
  }

  async getVersions(featureName: string): Promise<FeatureVersion[]> {
    const versions = this.versions.get(featureName);
    if (!versions) return [];

    // Filter out invalidated versions
    return versions.filter((v) => {
      const key = `${featureName}:${v.version}`;
      return !this.invalidated.has(key);
    });
  }

  async getLatestVersion(featureName: string): Promise<FeatureVersion | null> {
    const versions = await this.getVersions(featureName);
    if (versions.length === 0) return null;

    // Already sorted by computedAt descending
    return versions[0];
  }

  async invalidate(featureName: string, version: string): Promise<void> {
    const key = `${featureName}:${version}`;
    this.invalidated.add(key);
  }

  async clear(): Promise<void> {
    this.features.clear();
    this.versions.clear();
    this.invalidated.clear();
  }

  /**
   * Get statistics about the feature store
   */
  getStats(): {
    featureCount: number;
    versionCount: number;
    invalidatedCount: number;
  } {
    let versionCount = 0;
    for (const versions of this.versions.values()) {
      versionCount += versions.length;
    }

    return {
      featureCount: this.features.size,
      versionCount,
      invalidatedCount: this.invalidated.size,
    };
  }
}

/**
 * Create a feature version hash from parameters
 */
export function createFeatureVersionHash(parameters: Record<string, unknown>): string {
  const sorted = Object.keys(parameters)
    .sort()
    .map((key) => `${key}=${JSON.stringify(parameters[key])}`)
    .join('&');

  // Simple hash function (use crypto.createHash in production)
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return `v${Math.abs(hash).toString(36)}`;
}
