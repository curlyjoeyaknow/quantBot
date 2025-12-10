/**
 * Token Filtering & Query Service
 *
 * Filters tokens from ClickHouse and SQLite based on user criteria.
 * Supports complex filtering by chain, date range, volume, price, caller, etc.
 */
import { DateTime } from 'luxon';
import { type TokenMetadata } from './token-service';
export interface TokenFilterCriteria {
    chain?: string;
    dateRange?: {
        start: DateTime;
        end: DateTime;
    };
    volumeRange?: {
        min?: number;
        max?: number;
    };
    priceRange?: {
        min?: number;
        max?: number;
    };
    caller?: string;
    marketCapRange?: {
        min?: number;
        max?: number;
    };
    liquidityRange?: {
        min?: number;
        max?: number;
    };
    hasCandleData?: boolean;
    limit?: number;
    offset?: number;
}
export interface FilteredToken extends TokenMetadata {
    hasCandleData?: boolean;
    lastCandleTime?: DateTime;
    avgVolume?: number;
    avgPrice?: number;
}
/**
 * Token Filter Service for querying tokens with complex criteria
 */
export declare class TokenFilterService {
    /**
     * Filter tokens based on criteria
     */
    filterTokens(criteria: TokenFilterCriteria): Promise<FilteredToken[]>;
    /**
     * Get tokens directly from ClickHouse (for tokens not in SQLite registry)
     */
    private getTokensFromClickHouse;
    /**
     * Check if token has candle data in ClickHouse
     */
    private checkTokenHasCandleData;
    /**
     * Get token statistics from ClickHouse
     */
    private getTokenStats;
    /**
     * Check if token has calls from a specific caller
     */
    private checkTokenHasCaller;
    /**
     * Get token count matching criteria
     */
    getTokenCount(criteria: TokenFilterCriteria): Promise<number>;
}
export declare const tokenFilterService: TokenFilterService;
//# sourceMappingURL=token-filter-service.d.ts.map