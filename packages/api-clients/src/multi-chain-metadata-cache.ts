/**
 * Multi-Chain Metadata Cache
 * ===========================
 *
 * In-memory cache for token metadata to avoid redundant Birdeye API calls.
 * Uses a simple Map-based cache with TTL (time-to-live).
 *
 * Cache key: `${chain}:${address}` (lowercase)
 * Cache value: TokenMetadata with timestamp
 */

import type { TokenMetadata } from './multi-chain-metadata-service';

interface CachedMetadata {
  metadata: TokenMetadata;
  cachedAt: number;
  ttl: number; // milliseconds
}

const DEFAULT_TTL = 1000 * 60 * 60; // 1 hour

export class MultiChainMetadataCache {
  private cache: Map<string, CachedMetadata>;
  private readonly defaultTtl: number;

  constructor(defaultTtl: number = DEFAULT_TTL) {
    this.cache = new Map();
    this.defaultTtl = defaultTtl;
  }

  /**
   * Get cached metadata for an address on a specific chain
   * Returns null if not cached or expired
   */
  get(address: string, chain: string): TokenMetadata | null {
    const key = this.getCacheKey(address, chain);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now - cached.cachedAt > cached.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.metadata;
  }

  /**
   * Set cached metadata for an address on a specific chain
   */
  set(address: string, chain: string, metadata: TokenMetadata, ttl?: number): void {
    const key = this.getCacheKey(address, chain);
    this.cache.set(key, {
      metadata,
      cachedAt: Date.now(),
      ttl: ttl || this.defaultTtl,
    });
  }

  /**
   * Check if we have valid cached metadata for any chain
   * Returns the chain and metadata if found, null otherwise
   */
  getAnyChain(
    address: string,
    chains: string[]
  ): { chain: string; metadata: TokenMetadata } | null {
    for (const chain of chains) {
      const cached = this.get(address, chain);
      if (cached && cached.found) {
        return { chain, metadata: cached };
      }
    }
    return null;
  }

  /**
   * Clear expired entries from cache
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.cachedAt > cached.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Generate cache key from address and chain
   */
  private getCacheKey(address: string, chain: string): string {
    return `${chain.toLowerCase()}:${address.toLowerCase()}`;
  }
}

// Singleton instance
let _cacheInstance: MultiChainMetadataCache | null = null;

/**
 * Get the global metadata cache instance
 */
export function getMetadataCache(): MultiChainMetadataCache {
  if (!_cacheInstance) {
    _cacheInstance = new MultiChainMetadataCache();
  }
  return _cacheInstance;
}

