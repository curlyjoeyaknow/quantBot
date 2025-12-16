/**
 * Result Cache
 * ============
 * Caches simulation results to avoid redundant computations.
 *
 * @deprecated This cache has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/storage/result-cache instead.
 * This file will be removed in a future version.
 */

import { createHash } from 'crypto';
import { logger } from '@quantbot/utils';
import type {
  SimulationResult,
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
} from '../types';
import type { ScenarioConfig } from '../core/orchestrator';

/**
 * Cache configuration
 */
export interface ResultCacheConfig {
  /** Enable caching */
  enabled?: boolean;
  /** Cache TTL in milliseconds */
  ttl?: number;
  /** Maximum cache size */
  maxSize?: number;
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: Required<ResultCacheConfig> = {
  enabled: true,
  ttl: 24 * 60 * 60 * 1000, // 24 hours
  maxSize: 1000,
};

/**
 * Cache entry
 */
interface CacheEntry {
  result: SimulationResult;
  timestamp: number;
  configHash: string;
}

/**
 * Result cache implementation
 */
export class ResultCache {
  private cache: Map<string, CacheEntry>;
  private readonly config: Required<ResultCacheConfig>;

  constructor(config: ResultCacheConfig = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.cache = new Map();
  }

  /**
   * Generate cache key from scenario and candle data
   */
  generateCacheKey(
    scenario: ScenarioConfig,
    mint: string,
    startTime: number,
    endTime: number,
    candleCount: number
  ): string {
    const configHash = this.hashScenario(scenario);
    const dataHash = createHash('sha256')
      .update(`${mint}:${startTime}:${endTime}:${candleCount}`)
      .digest('hex')
      .substring(0, 16);

    return `sim:${configHash}:${dataHash}`;
  }

  /**
   * Hash scenario configuration
   */
  private hashScenario(scenario: ScenarioConfig): string {
    const configString = JSON.stringify({
      strategy: scenario.strategy,
      stopLoss: scenario.stopLoss,
      entry: scenario.entry,
      reEntry: scenario.reEntry,
      costs: scenario.costs,
      entrySignal: scenario.entrySignal,
      exitSignal: scenario.exitSignal,
    });

    return createHash('sha256').update(configString).digest('hex').substring(0, 16);
  }

  /**
   * Get cached result
   */
  get(key: string): SimulationResult | null {
    if (!this.config.enabled) {
      return null;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check TTL
    const age = Date.now() - entry.timestamp;
    if (age > this.config.ttl) {
      this.cache.delete(key);
      return null;
    }

    logger.debug('Cache hit', { key: key.substring(0, 20) + '...' });
    return entry.result;
  }

  /**
   * Store result in cache
   */
  set(key: string, result: SimulationResult): void {
    if (!this.config.enabled) {
      return;
    }

    // If key already exists, update it (no eviction needed)
    if (this.cache.has(key)) {
      this.cache.set(key, {
        result,
        timestamp: Date.now(),
        configHash: key.split(':')[1],
      });
      return;
    }

    // Enforce max size (FIFO eviction - remove first inserted)
    if (this.cache.size >= this.config.maxSize) {
      // Remove oldest entry (first key in insertion order)
      const oldestKey = this.findOldestKey();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      configHash: key.split(':')[1],
    });

    logger.debug('Cached result', { key: key.substring(0, 20) + '...' });
  }

  /**
   * Find oldest cache key (FIFO - first inserted)
   */
  private findOldestKey(): string | null {
    // Map maintains insertion order, so first key is oldest
    const firstKey = this.cache.keys().next().value;
    return firstKey || null;
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
    };
  }
}

/**
 * Global result cache instance
 */
let globalCache: ResultCache | null = null;

/**
 * Get or create global cache
 */
export function getResultCache(config?: ResultCacheConfig): ResultCache {
  if (!globalCache) {
    globalCache = new ResultCache(config);
  }
  return globalCache;
}
