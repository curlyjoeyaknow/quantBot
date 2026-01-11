/**
 * Feature Cache
 *
 * Caches computed features to avoid recomputation.
 * Cache key: (slice_hash, feature_set_id) → features.parquet
 *
 * This saves days of compute for ML + rolling windows that reuse the same features.
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { logger } from '@quantbot/utils';
import type { FeaturesSpec } from './types.js';
import { FeatureSetCompiler } from './FeatureSetCompiler.js';

export interface CacheEntry {
  featureSetId: string;
  featuresParquetPath: string;
  manifestPath: string;
  cachedAtIso: string;
}

export interface CacheLookupResult {
  hit: boolean;
  entry?: CacheEntry;
}

/**
 * FeatureCache
 */
export class FeatureCache {
  /**
   * Generate cache key from slice hash and feature set ID
   */
  static generateCacheKey(sliceHash: string, featureSetId: string): string {
    return createHash('sha256').update(`${sliceHash}:${featureSetId}`).digest('hex').slice(0, 16);
  }

  /**
   * Get cache directory path
   */
  static getCacheDir(baseDir: string): string {
    return join(baseDir, '.feature-cache');
  }

  /**
   * Get cache entry path
   */
  static getCacheEntryPath(cacheDir: string, cacheKey: string): string {
    return join(cacheDir, `${cacheKey}.json`);
  }

  /**
   * Lookup cached features
   */
  async lookup(
    sliceHash: string,
    featureSetId: string,
    cacheBaseDir: string
  ): Promise<CacheLookupResult> {
    const cacheKey = FeatureCache.generateCacheKey(sliceHash, featureSetId);
    const cacheDir = FeatureCache.getCacheDir(cacheBaseDir);
    const cacheEntryPath = FeatureCache.getCacheEntryPath(cacheDir, cacheKey);

    try {
      // Check if cache entry exists
      const entryData = await fs.readFile(cacheEntryPath, 'utf-8');
      const entry: CacheEntry = JSON.parse(entryData);

      // Verify cached files still exist
      const parquetExists = await this.fileExists(entry.featuresParquetPath);
      const manifestExists = await this.fileExists(entry.manifestPath);

      if (parquetExists && manifestExists) {
        logger.debug('Feature cache hit', {
          cacheKey,
          featureSetId,
          sliceHash: sliceHash.slice(0, 8),
        });
        return { hit: true, entry };
      } else {
        logger.warn('Feature cache entry found but files missing', {
          cacheKey,
          featuresParquetPath: entry.featuresParquetPath,
          manifestPath: entry.manifestPath,
        });
        // Remove invalid cache entry
        await fs.unlink(cacheEntryPath).catch(() => {
          // Ignore errors
        });
        return { hit: false };
      }
    } catch (error) {
      // Cache miss or error reading cache
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Error reading feature cache', {
          error: error instanceof Error ? error.message : String(error),
          cacheEntryPath,
        });
      }
      return { hit: false };
    }
  }

  /**
   * Store computed features in cache
   */
  async store(
    sliceHash: string,
    featureSetId: string,
    featuresParquetPath: string,
    manifestPath: string,
    cacheBaseDir: string
  ): Promise<void> {
    const cacheKey = FeatureCache.generateCacheKey(sliceHash, featureSetId);
    const cacheDir = FeatureCache.getCacheDir(cacheBaseDir);
    const cacheEntryPath = FeatureCache.getCacheEntryPath(cacheDir, cacheKey);

    try {
      // Ensure cache directory exists
      await fs.mkdir(cacheDir, { recursive: true });

      // Create cache entry
      const entry: CacheEntry = {
        featureSetId,
        featuresParquetPath,
        manifestPath,
        cachedAtIso: new Date().toISOString(),
      };

      // Write cache entry
      await fs.writeFile(cacheEntryPath, JSON.stringify(entry, null, 2), 'utf-8');

      logger.debug('Feature cache stored', {
        cacheKey,
        featureSetId,
        sliceHash: sliceHash.slice(0, 8),
      });
    } catch (error) {
      logger.warn('Failed to store feature cache', {
        error: error instanceof Error ? error.message : String(error),
        cacheEntryPath,
      });
      // Don't throw - cache is optional
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
