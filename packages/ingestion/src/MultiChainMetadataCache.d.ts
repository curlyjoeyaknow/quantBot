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
import type { TokenMetadata } from './MultiChainMetadataService';
export declare class MultiChainMetadataCache {
    private cache;
    private readonly defaultTtl;
    constructor(defaultTtl?: number);
    /**
     * Get cached metadata for an address on a specific chain
     * Returns null if not cached or expired
     */
    get(address: string, chain: string): TokenMetadata | null;
    /**
     * Set cached metadata for an address on a specific chain
     */
    set(address: string, chain: string, metadata: TokenMetadata, ttl?: number): void;
    /**
     * Check if we have valid cached metadata for any chain
     * Returns the chain and metadata if found, null otherwise
     */
    getAnyChain(address: string, chains: string[]): {
        chain: string;
        metadata: TokenMetadata;
    } | null;
    /**
     * Clear expired entries from cache
     */
    clearExpired(): void;
    /**
     * Clear all cache entries
     */
    clear(): void;
    /**
     * Get cache size
     */
    size(): number;
    /**
     * Generate cache key from address and chain
     */
    private getCacheKey;
}
/**
 * Get the global metadata cache instance
 */
export declare function getMetadataCache(): MultiChainMetadataCache;
//# sourceMappingURL=MultiChainMetadataCache.d.ts.map