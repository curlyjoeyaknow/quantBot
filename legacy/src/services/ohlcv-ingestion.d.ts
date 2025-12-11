import { OHLCVData } from '../storage/influxdb-client';
export interface IngestionResult {
    tokenAddress: string;
    recordsAdded: number;
    recordsSkipped: number;
    success: boolean;
    error?: string;
}
export declare class OHLCVIngestionService {
    private influxClient;
    private birdeyeClient;
    private cache;
    /**
     * Initialize the ingestion service
     */
    initialize(): Promise<void>;
    /**
     * Fetch and store OHLCV for a single token
     */
    fetchAndStoreOHLCV(tokenAddress: string, startTime: Date, endTime: Date, tokenSymbol?: string, chain?: string): Promise<IngestionResult>;
    /**
     * Batch fetch for multiple tokens (used in simulations)
     */
    batchFetchOHLCV(tokens: Array<{
        address: string;
        symbol: string;
        chain: string;
    }>, startTime: Date, endTime: Date): Promise<Map<string, OHLCVData[]>>;
    /**
     * Backfill missing data for existing tokens
     */
    backfillMissingData(tokenAddress: string): Promise<IngestionResult>;
    /**
     * Find gaps in OHLCV data
     */
    private findDataGaps;
    /**
     * Get ingestion statistics
     */
    getIngestionStats(): {
        apiUsage: any;
        cacheStats: any;
        influxRecordCount: number;
    };
    /**
     * Close connections
     */
    close(): Promise<void>;
}
export declare const ohlcvIngestion: OHLCVIngestionService;
//# sourceMappingURL=ohlcv-ingestion.d.ts.map