/**
 * Performance Optimizations
 * =========================
 * Optimizations for hot paths in simulation engine.
 */

import type { Candle } from '../types/candle.js';
import type { LegacyIndicatorData } from '../indicators/registry.js';

/**
 * Memoized indicator calculation cache
 */
class IndicatorCache {
  private cache: Map<string, LegacyIndicatorData[]>;
  private readonly maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Generate cache key from candles
   */
  private generateKey(candles: readonly Candle[]): string {
    if (candles.length === 0) return 'empty';

    // Use first and last candle timestamps + count for quick hashing
    const first = candles[0].timestamp;
    const last = candles[candles.length - 1].timestamp;
    const count = candles.length;

    // Also hash a sample of prices for uniqueness
    const sample =
      candles.length > 10
        ? candles
            .slice(0, 5)
            .map((c) => c.close)
            .join(',')
        : candles.map((c) => c.close).join(',');

    return `${first}:${last}:${count}:${sample.substring(0, 50)}`;
  }

  /**
   * Get cached indicators
   */
  get(candles: readonly Candle[]): LegacyIndicatorData[] | null {
    const key = this.generateKey(candles);
    return this.cache.get(key) ?? null;
  }

  /**
   * Set cached indicators
   */
  set(candles: readonly Candle[], indicators: LegacyIndicatorData[]): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    const key = this.generateKey(candles);
    this.cache.set(key, indicators);
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
  }
}

/**
 * Global indicator cache
 */
let indicatorCache: IndicatorCache | null = null;

/**
 * Get indicator cache
 */
function getIndicatorCache(): IndicatorCache {
  if (!indicatorCache) {
    indicatorCache = new IndicatorCache(50); // Cache up to 50 different candle sets
  }
  return indicatorCache;
}

/**
 * Optimized indicator series calculation with caching
 */
export function calculateIndicatorSeriesOptimized(
  candles: readonly Candle[],
  calculateFn: (candles: readonly Candle[]) => LegacyIndicatorData[]
): LegacyIndicatorData[] {
  // Check cache first
  const cache = getIndicatorCache();
  const cached = cache.get(candles);

  if (cached) {
    return cached;
  }

  // Calculate and cache
  const result = calculateFn(candles);
  cache.set(candles, result);

  return result;
}

/**
 * Batch process candles for better performance
 */
export function batchProcess<T>(
  items: readonly T[],
  batchSize: number,
  processor: (batch: T[]) => void
): void {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    processor(batch);
  }
}

/**
 * Optimize array operations
 */
export function optimizedMap<T, R>(
  array: readonly T[],
  mapper: (item: T, index: number) => R,
  batchSize: number = 1000
): R[] {
  const result: R[] = new Array(array.length);

  for (let i = 0; i < array.length; i += batchSize) {
    const end = Math.min(i + batchSize, array.length);
    for (let j = i; j < end; j++) {
      result[j] = mapper(array[j], j);
    }
  }

  return result;
}
