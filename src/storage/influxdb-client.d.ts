export interface OHLCVData {
    timestamp: number;
    dateTime: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export interface TokenInfo {
    address: string;
    symbol: string;
    chain: string;
    recordCount: number;
    firstTimestamp: number;
    lastTimestamp: number;
}
export declare class InfluxDBOHLCVClient {
    private influxDB;
    private writeApi;
    private queryApi;
    private managementApi;
    private bucket;
    private org;
    constructor();
    /**
     * Initialize InfluxDB bucket and retention policy
     */
    initialize(): Promise<void>;
    /**
     * Test InfluxDB connection with a simple write and read
     */
    private testConnection;
    /**
     * Write OHLCV data points to InfluxDB
     */
    writeOHLCVData(tokenAddress: string, tokenSymbol: string, chain: string, data: OHLCVData[]): Promise<void>;
    /**
     * Query OHLCV data from InfluxDB
     */
    getOHLCVData(tokenAddress: string, startTime: Date, endTime: Date, interval?: string): Promise<OHLCVData[]>;
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
     * Get record count for a specific token
     */
    getTokenRecordCount(tokenAddress: string): Promise<number>;
    /**
     * Close the InfluxDB connection
     */
    close(): Promise<void>;
}
export declare const influxDBClient: InfluxDBOHLCVClient;
//# sourceMappingURL=influxdb-client.d.ts.map