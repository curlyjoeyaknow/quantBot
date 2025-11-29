// LRU cache with TTL
// Can be replaced with Redis later

import { LRUCache } from 'lru-cache';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class Cache {
  private cache: LRUCache<string, CacheEntry<any>>;
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
    this.cache = new LRUCache<string, CacheEntry<any>>({
      max: maxSize,
      ttl: 0, // We handle TTL manually
      updateAgeOnGet: true, // Update access time on get
    });
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { data: value, expiresAt });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      calculatedSize: this.cache.calculatedSize,
      remainingCapacity: this.maxSize - this.cache.size,
      utilizationPercent: ((this.cache.size / this.maxSize) * 100).toFixed(2),
    };
  }

  /**
   * Get all keys (for debugging)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}

// Create cache with configurable max size (default 1000 entries)
const maxCacheSize = parseInt(process.env.CACHE_MAX_SIZE || '1000', 10);
export const cache = new Cache(maxCacheSize);

// Cache key generators
export const cacheKeys = {
  ohlcv: (tokenAddress: string, chain: string, startTime: string, endTime: string, interval: string) =>
    `ohlcv:${chain}:${tokenAddress}:${startTime}:${endTime}:${interval}`,
  currentPrice: (tokenAddress: string, chain: string) =>
    `price:${chain}:${tokenAddress}`,
  marketCap: (tokenAddress: string, chain: string, timestamp: string) =>
    `mcap:${chain}:${tokenAddress}:${timestamp}`,
  dashboard: () => 'dashboard:metrics',
};

