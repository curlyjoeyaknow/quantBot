"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiChainMetadataCache = void 0;
exports.getMetadataCache = getMetadataCache;
const DEFAULT_TTL = 1000 * 60 * 60; // 1 hour
class MultiChainMetadataCache {
    cache;
    defaultTtl;
    constructor(defaultTtl = DEFAULT_TTL) {
        this.cache = new Map();
        this.defaultTtl = defaultTtl;
    }
    /**
     * Get cached metadata for an address on a specific chain
     * Returns null if not cached or expired
     */
    get(address, chain) {
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
    set(address, chain, metadata, ttl) {
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
    getAnyChain(address, chains) {
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
    clearExpired() {
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
    clear() {
        this.cache.clear();
    }
    /**
     * Get cache size
     */
    size() {
        return this.cache.size;
    }
    /**
     * Generate cache key from address and chain
     */
    getCacheKey(address, chain) {
        return `${chain.toLowerCase()}:${address.toLowerCase()}`;
    }
}
exports.MultiChainMetadataCache = MultiChainMetadataCache;
// Singleton instance
let _cacheInstance = null;
/**
 * Get the global metadata cache instance
 */
function getMetadataCache() {
    if (!_cacheInstance) {
        _cacheInstance = new MultiChainMetadataCache();
    }
    return _cacheInstance;
}
//# sourceMappingURL=MultiChainMetadataCache.js.map