/**
 * Unified OHLCV Engine
 *
 * Single source of truth for all OHLCV operations:
 * - Fetching (from API, cache, or ClickHouse)
 * - Ingestion (to ClickHouse and CSV cache)
 * - Caching (ClickHouse and CSV)
 *
 * This eliminates ad-hoc scripts and ensures consistent behavior across the codebase.
 */
import { DateTime } from 'luxon';
import { Candle } from '../simulation/candles';
export interface OHLCVFetchOptions {
    /**
     * If true, only use cache (no API calls)
     */
    cacheOnly?: boolean;
    /**
     * If true, ensure candles are ingested to ClickHouse after fetching
     */
    ensureIngestion?: boolean;
    /**
     * Optional alert time - if provided, fetches 1m candles for 30min before/after
     */
    alertTime?: DateTime;
    /**
     * Interval to use for ingestion (defaults to '5m')
     */
    interval?: '1m' | '5m' | '1H';
}
export interface OHLCVFetchResult {
    candles: Candle[];
    fromCache: boolean;
    ingestedToClickHouse: boolean;
    source: 'clickhouse' | 'csv' | 'api';
}
export declare class OHLCVEngine {
    private clickHouseEnabled;
    constructor();
    /**
     * Initialize the engine (e.g., connect to ClickHouse)
     */
    initialize(): Promise<void>;
    /**
     * Fetch OHLCV candles with automatic caching and ingestion
     *
     * This is the main entry point - it handles:
     * 1. Checking ClickHouse cache
     * 2. Checking CSV cache
     * 3. Fetching from API if needed
     * 4. Ingesting to ClickHouse
     * 5. Caching to CSV
     *
     * @param tokenAddress Token mint address
     * @param startTime Start time for candles
     * @param endTime End time for candles
     * @param chain Blockchain name (defaults to 'solana')
     * @param options Fetch options
     * @returns Fetch result with candles and metadata
     */
    fetch(tokenAddress: string, startTime: DateTime, endTime: DateTime, chain?: string, options?: OHLCVFetchOptions): Promise<OHLCVFetchResult>;
    /**
     * Batch fetch candles for multiple tokens
     *
     * @param tokens Array of token addresses
     * @param startTime Start time for candles
     * @param endTime End time for candles
     * @param chain Blockchain name
     * @param options Fetch options
     * @returns Map of token address to fetch result
     */
    batchFetch(tokens: string[], startTime: DateTime, endTime: DateTime, chain?: string, options?: OHLCVFetchOptions): Promise<Map<string, OHLCVFetchResult>>;
    /**
     * Get statistics about cached vs fetched candles
     */
    getStats(results: Map<string, OHLCVFetchResult>): {
        total: number;
        fromCache: number;
        fromAPI: number;
        ingested: number;
        totalCandles: number;
    };
}
/**
 * Get the singleton OHLCV Engine instance
 */
export declare function getOHLCVEngine(): OHLCVEngine;
//# sourceMappingURL=ohlcv-engine.d.ts.map