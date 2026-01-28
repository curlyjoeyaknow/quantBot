/**
 * In-Memory Feature Store with LRU Cache and TTL
 *
 * Simple LRU cache for features with TTL-based expiration.
 */

import type {
  FeatureStore,
  FeatureSetId,
  FeatureComputationResult,
  FeatureMetadata,
} from '@quantbot/core';
import { featureRegistry } from './feature-registry.js';

/**
 * Cache entry
 */
interface CacheEntry {
  /**
   * Feature computation result
   */
  result: FeatureComputationResult;

  /**
   * Expiration timestamp (milliseconds)
   */
  expiresAt: number;

  /**
   * Last accessed timestamp (for LRU)
   */
  lastAccessed: number;
}

/**
 * In-Memory Feature Store with LRU Cache and TTL
 */
export class InMemoryFeatureStore implements FeatureStore {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly defaultTTL: number; // milliseconds
  private readonly maxSize: number;

  constructor(options: { defaultTTL?: number; maxSize?: number } = {}) {
    this.defaultTTL = options.defaultTTL ?? 10 * 60 * 1000; // 10 minutes default
    this.maxSize = options.maxSize ?? 1000; // 1000 entries default
  }

  async compute(featureSetId: FeatureSetId, data: unknown): Promise<FeatureComputationResult> {
    // Get feature registration
    const registration = featureRegistry.get(featureSetId);
    if (!registration) {
      throw new Error(`Feature set not registered: ${featureSetId}`);
    }

    // Check cache first
    const cacheKey = this.getCacheKey(featureSetId, data);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // Update last accessed
      cached.lastAccessed = Date.now();
      return cached.result;
    }

    // Compute features
    const featureValues = await registration.computeFn(data);

    // Build result
    const result: FeatureComputationResult = {
      featureSetId,
      features: this.buildFeaturesMap(featureValues),
      metadata: registration.metadata,
    };

    // Store in cache
    this.setCache(cacheKey, result);

    return result;
  }

  async get(
    featureSetId: FeatureSetId,
    asset: string,
    timestamp: number
  ): Promise<Record<string, unknown> | null> {
    // Search cache for matching entry
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= Date.now()) {
        // Expired, remove it
        this.cache.delete(key);
        continue;
      }

      if (entry.result.featureSetId === featureSetId) {
        const assetFeatures = entry.result.features.get(asset);
        if (assetFeatures) {
          const featureValues = assetFeatures.get(timestamp);
          if (featureValues) {
            // Update last accessed
            entry.lastAccessed = Date.now();
            return featureValues;
          }
        }
      }
    }

    return null;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Build features map from feature values
   */
  private buildFeaturesMap(
    featureValues: Record<string, unknown>
  ): Map<string, Map<number, Record<string, unknown>>> {
    // This is a simplified implementation
    // In practice, you'd extract asset and timestamp from featureValues
    const features = new Map<string, Map<number, Record<string, unknown>>>();

    // For now, assume featureValues contains asset and timestamp
    // This would need to be adapted based on actual data structure
    const asset = (featureValues as any).asset || 'unknown';
    const timestamp = (featureValues as any).timestamp || Date.now();

    if (!features.has(asset)) {
      features.set(asset, new Map());
    }

    const assetMap = features.get(asset)!;
    assetMap.set(timestamp, featureValues);

    return features;
  }

  /**
   * Get cache key from feature set ID and data
   */
  private getCacheKey(featureSetId: FeatureSetId, data: unknown): string {
    // Simple hash of data (in production, use proper hashing)
    const dataStr = JSON.stringify(data);
    return `${featureSetId}:${this.simpleHash(dataStr)}`;
  }

  /**
   * Simple hash function (for cache keys)
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Set cache entry (with LRU eviction)
   */
  private setCache(key: string, result: FeatureComputationResult): void {
    // Evict expired entries
    this.evictExpired();

    // Evict LRU if at max size
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const now = Date.now();
    this.cache.set(key, {
      result,
      expiresAt: now + this.defaultTTL,
      lastAccessed: now,
    });
  }

  /**
   * Evict expired entries
   */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; expiredCount: number } {
    const now = Date.now();
    let expiredCount = 0;
    for (const entry of this.cache.values()) {
      if (entry.expiresAt <= now) {
        expiredCount++;
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      expiredCount,
    };
  }
}
