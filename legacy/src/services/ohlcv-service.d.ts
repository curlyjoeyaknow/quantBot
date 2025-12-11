/**
 * OHLCV Data Management Service
 *
 * Centralized service for fetching, ingesting, and caching OHLCV candles.
 * Provides multi-layer caching (in-memory → ClickHouse → CSV cache) and
 * integrates with Birdeye API and ClickHouse storage.
 */
import { DateTime } from 'luxon';
import { type Candle } from '../simulation/candles';
export interface OHLCVFetchOptions {
    interval?: '1m' | '5m' | '1H';
    useCache?: boolean;
    forceRefresh?: boolean;
}
export interface OHLCVIngestOptions {
    interval?: '1m' | '5m' | '1H';
    skipDuplicates?: boolean;
}
export interface OHLCVGetOptions extends OHLCVFetchOptions {
    alertTime?: DateTime;
}
/**
 * OHLCV Service for managing candle data
 */
export declare class OHLCVService {
    private readonly birdeyeClient;
    private inMemoryCache;
    private readonly cacheTTL;
    /**
     * Initialize the service (ensure ClickHouse is ready)
     */
    initialize(): Promise<void>;
    /**
     * Fetch candles from Birdeye API
     */
    fetchCandles(mint: string, chain: string, startTime: DateTime, endTime: DateTime, interval?: '1m' | '5m' | '1H'): Promise<Candle[]>;
    /**
     * Ingest candles into ClickHouse
     */
    ingestCandles(mint: string, chain: string, candles: Candle[], options?: OHLCVIngestOptions): Promise<{
        ingested: number;
        skipped: number;
    }>;
    /**
     * Get candles with multi-layer caching
     * Priority: in-memory → ClickHouse → Birdeye API
     */
    getCandles(mint: string, chain: string, startTime: DateTime, endTime: DateTime, options?: OHLCVGetOptions): Promise<Candle[]>;
    /**
     * Fetch and ingest candles in one operation
     */
    fetchAndIngest(mint: string, chain: string, startTime: DateTime, endTime: DateTime, options?: OHLCVFetchOptions & OHLCVIngestOptions): Promise<{
        fetched: number;
        ingested: number;
        skipped: number;
    }>;
    /**
     * Clear in-memory cache
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        inMemoryEntries: number;
        cacheSize: number;
    };
    /**
     * Generate cache key
     */
    private getCacheKey;
}
export declare const ohlcvService: OHLCVService;
//# sourceMappingURL=ohlcv-service.d.ts.map