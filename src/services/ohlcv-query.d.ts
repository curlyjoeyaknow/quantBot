import { OHLCVData, TokenInfo } from '../storage/influxdb-client';
export interface QueryOptions {
    useCache?: boolean;
    cacheTTL?: number;
    aggregation?: 'none' | '5m' | '15m' | '1h' | '4h' | '1d';
}
export declare class OHLCVQueryService {
    private influxClient;
    private cache;
    /**
     * Get OHLCV data for simulation
     */
    getOHLCV(tokenAddress: string, startTime: Date, endTime: Date, interval?: string, options?: QueryOptions): Promise<OHLCVData[]>;
    /**
     * Get latest price for a token
     */
    getLatestPrice(tokenAddress: string): Promise<number>;
    /**
     * Check if data exists for token in time range
     */
    hasData(tokenAddress: string, startTime: Date, endTime: Date): Promise<boolean>;
    /**
     * Get all tokens with available data
     */
    getAvailableTokens(): Promise<TokenInfo[]>;
    /**
     * Get OHLCV data with aggregation
     */
    getAggregatedOHLCV(tokenAddress: string, startTime: Date, endTime: Date, aggregation: '5m' | '15m' | '1h' | '4h' | '1d'): Promise<OHLCVData[]>;
    /**
     * Aggregate OHLCV data to different timeframes
     */
    private aggregateData;
    /**
     * Get interval in milliseconds
     */
    private getIntervalMs;
    /**
     * Create aggregated candle from multiple candles
     */
    private createAggregatedCandle;
    /**
     * Pre-fetch data for simulation (optimized for batch queries)
     */
    prefetchForSimulation(tokens: string[], startTime: Date, endTime: Date): Promise<Map<string, OHLCVData[]>>;
    /**
     * Get query statistics
     */
    getQueryStats(): {
        cacheStats: any;
        cacheInfo: any;
    };
    /**
     * Clear query cache
     */
    clearCache(): void;
    /**
     * Log query statistics
     */
    logStats(): void;
}
export declare const ohlcvQuery: OHLCVQueryService;
//# sourceMappingURL=ohlcv-query.d.ts.map