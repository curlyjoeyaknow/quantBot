/**
 * Result Cache
 * ===========
 * LRU cache for simulation results with TTL support
 */

import type { SimulationResult } from '../types/index.js';
import { createHash } from 'crypto';
import type { ClockPort, createSystemClock } from '@quantbot/core';

export interface ResultCacheOptions {
  maxSize?: number;
  ttl?: number; // Time to live in milliseconds
  /** Clock for deterministic time access (defaults to system clock for backward compatibility) */
  clock?: ClockPort;
}

interface CacheEntry {
  result: SimulationResult;
  timestamp: number;
  ttl?: number;
}

/**
 * LRU cache for simulation results
 */
export class ResultCache {
  private cache: Map<string, CacheEntry>;
  private readonly maxSize: number;
  private readonly ttl?: number;
  private accessOrder: string[]; // Track access order for FIFO eviction
  private readonly clock: ClockPort;

  constructor(options: ResultCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttl = options.ttl;
    // Use injected clock or default to system clock for backward compatibility
    // System clock is only used in composition roots, not in simulation code
    this.clock = options.clock ?? createSystemClock();
    this.cache = new Map();
    this.accessOrder = [];
  }

  /**
   * Get a cached result
   */
  get(key: string): SimulationResult | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (this.ttl && entry.ttl) {
      const now = this.clock.nowMs();
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        this.accessOrder = this.accessOrder.filter((k) => k !== key);
        return null;
      }
    }

    // Update access order (move to end)
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);

    return entry.result;
  }

  /**
   * Set a cached result
   */
  set(key: string, result: SimulationResult): void {
    // Check if we need to evict
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Evict oldest (first in access order)
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const entry: CacheEntry = {
      result,
      timestamp: this.clock.nowMs(),
      ttl: this.ttl,
    };

    this.cache.set(key, entry);

    // Update access order (move to end if exists, otherwise add)
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);
  }

  /**
   * Generate a cache key from scenario and data parameters
   */
  generateCacheKey(
    scenario: { name: string; strategy: Array<{ target: number; percent: number }> },
    mint: string,
    startTime: number,
    endTime: number,
    candleCount: number
  ): string {
    // Hash configuration
    const configStr = JSON.stringify({
      name: scenario.name,
      strategy: scenario.strategy,
    });
    const configHash = createHash('md5').update(configStr).digest('hex').substring(0, 16);

    // Hash data parameters
    const dataStr = JSON.stringify({
      mint,
      startTime,
      endTime,
      candleCount,
    });
    const dataHash = createHash('md5').update(dataStr).digest('hex').substring(0, 16);

    return `sim:${configHash}:${dataHash}`;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Global result cache instance
 */
let globalResultCache: ResultCache | null = null;

/**
 * Get the global result cache instance
 */
export function getResultCache(): ResultCache {
  if (!globalResultCache) {
    globalResultCache = new ResultCache();
  }
  return globalResultCache;
}

/**
 * Reset the global result cache
 */
export function resetResultCache(): void {
  globalResultCache = null;
}
