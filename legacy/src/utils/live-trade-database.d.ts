/**
 * Live Trade Database Functions
 * =============================
 * Database functions for storing live trade alerts and price cache
 */
/**
 * Store entry alert in database
 */
export declare function storeEntryAlert(alert: {
    alertId: number;
    tokenAddress: string;
    tokenSymbol?: string;
    chain: string;
    callerName: string;
    alertPrice: number;
    entryPrice: number;
    entryType: string;
    signal: string;
    priceChange: number;
    timestamp: number;
    sentToGroups?: string[];
}): Promise<void>;
/**
 * Store price in cache database
 */
export declare function storePriceCache(tokenAddress: string, chain: string, price: number, marketCap?: number, timestamp?: number): Promise<void>;
/**
 * Get cached price
 */
export declare function getCachedPrice(tokenAddress: string, chain: string, maxAgeSeconds?: number): Promise<number | null>;
/**
 * Get entry alerts for a token
 */
export declare function getEntryAlertsForToken(tokenAddress: string, limit?: number): Promise<any[]>;
//# sourceMappingURL=live-trade-database.d.ts.map