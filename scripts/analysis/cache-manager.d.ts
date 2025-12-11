/**
 * Cache manager for API responses to avoid wasting credits
 */
interface CachedResponse {
    timestamp: number;
    data: any;
    tokenAddress: string;
    chain: string;
    startTime: number;
    endTime: number;
    interval: string;
}
/**
 * Get cached response if available and not expired
 */
export declare function getCachedResponse(tokenAddress: string, chain: string, startTime: number, endTime: number, interval: string): CachedResponse | null;
/**
 * Store response in cache
 */
export declare function cacheResponse(tokenAddress: string, chain: string, startTime: number, endTime: number, interval: string, data: any): void;
/**
 * Cache a "no data" response (to avoid retrying tokens with no data)
 */
export declare function cacheNoDataResponse(tokenAddress: string, chain: string, startTime: number, endTime: number, interval: string): void;
/**
 * Get cache statistics
 */
export declare function getCacheStats(): {
    totalFiles: number;
    totalSize: number;
};
export {};
//# sourceMappingURL=cache-manager.d.ts.map