import { OHLCVData } from '../storage/influxdb-client';
export interface CacheEntry {
    data: OHLCVData[];
    timestamp: number;
    ttl: number;
}
export interface CacheStats {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    hitRate: number;
}
export declare class OHLCVCache {
    private cache;
    private stats;
    constructor(maxSize?: number);
    /**
     * Generate cache key for OHLCV query
     */
    private generateCacheKey;
    /**
     * Get OHLCV data from cache
     */
    get(tokenAddress: string, startTime: Date, endTime: Date, interval?: string): OHLCVData[] | null;
    /**
     * Set OHLCV data in cache
     */
    set(tokenAddress: string, startTime: Date, endTime: Date, data: OHLCVData[], interval?: string, ttlMinutes?: number): void;
    /**
     * Check if data exists in cache
     */
    has(tokenAddress: string, startTime: Date, endTime: Date, interval?: string): boolean;
    /**
     * Delete specific cache entry
     */
    delete(tokenAddress: string, startTime: Date, endTime: Date, interval?: string): boolean;
    /**
     * Clear all cache entries
     */
    clear(): void;
    /**
     * Get cache statistics
     */
    getStats(): CacheStats;
    /**
     * Update hit rate calculation
     */
    private updateHitRate;
    /**
     * Get cache size and capacity info
     */
    getCacheInfo(): {
        size: number;
        maxSize: number;
        utilization: number;
    };
    /**
     * Pre-fetch data for simulation (batch caching)
     */
    prefetchForSimulation(tokens: string[], startTime: Date, endTime: Date, fetchFunction: (token: string, start: Date, end: Date) => Promise<OHLCVData[] | null>): Promise<Map<string, OHLCVData[]>>;
    /**
     * Log cache statistics
     */
    logStats(): void;
}
export declare const ohlcvCache: OHLCVCache;
//# sourceMappingURL=ohlcv-cache.d.ts.map