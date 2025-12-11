export interface BirdeyeOHLCVResponse {
    items: Array<{
        unixTime: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }>;
}
export interface APIKeyUsage {
    key: string;
    requestsUsed: number;
    lastUsed: Date;
    isActive: boolean;
    estimatedCreditsUsed: number;
}
export declare class BirdeyeClient {
    private apiKeys;
    private keyUsage;
    private currentKeyIndex;
    private axiosInstances;
    private baseURL;
    private readonly TOTAL_CREDITS;
    private readonly CREDITS_FOR_5000_CANDLES;
    private readonly CREDITS_FOR_LESS_THAN_1000;
    private totalCreditsUsed;
    constructor();
    /**
     * Load API keys from environment variables
     */
    private loadAPIKeys;
    /**
     * Initialize API key usage tracking
     */
    private initializeAPIKeys;
    /**
     * Get the next available API key using round-robin
     */
    private getNextAPIKey;
    /**
     * Update API key usage statistics
     * @param candleCount Number of candles returned in the response (for credit calculation)
     */
    private updateKeyUsage;
    /**
     * Handle API key deactivation on rate limit
     */
    private deactivateKey;
    /**
     * Sleep for specified milliseconds
     */
    private sleep;
    /**
     * Fetch OHLCV data with retry logic and exponential backoff
     */
    fetchOHLCVData(tokenAddress: string, startTime: Date, endTime: Date, interval?: string, chain?: string): Promise<BirdeyeOHLCVResponse | null>;
    /**
     * Get API key usage statistics
     */
    getAPIKeyUsage(): APIKeyUsage[];
    /**
     * Get total requests made across all keys
     */
    getTotalRequests(): number;
    /**
     * Get total credits used across all keys (from running counter)
     */
    getTotalCreditsUsed(): number;
    /**
     * Get remaining credits estimate
     */
    getRemainingCredits(): number;
    /**
     * Get running credit usage statistics
     */
    getCreditUsageStats(): {
        totalCredits: number;
        creditsUsed: number;
        creditsRemaining: number;
        percentage: number;
    };
    /**
     * Get credit usage percentage
     */
    getCreditUsagePercentage(): number;
    /**
     * Check if we're approaching credit limit (80% threshold)
     */
    isApproachingCreditLimit(): boolean;
    /**
     * Reset API key usage statistics
     */
    resetUsageStats(): void;
    /**
     * Log comprehensive credit usage report
     */
    logCreditUsageReport(): void;
    /**
     * Check if any API keys are still active
     */
    hasActiveKeys(): boolean;
    /**
     * Fetch token metadata (name, symbol, etc.)
     */
    getTokenMetadata(tokenAddress: string, chain?: string): Promise<{
        name: string;
        symbol: string;
    } | null>;
}
export declare const birdeyeClient: BirdeyeClient;
//# sourceMappingURL=birdeye-client.d.ts.map