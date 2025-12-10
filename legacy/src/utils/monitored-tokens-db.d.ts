/**
 * Monitored Tokens Database Utilities
 * ====================================
 * Functions for storing and retrieving monitored tokens from Postgres
 */
import { EntryConfig } from '../simulation/config';
export interface MonitoredToken {
    id?: number;
    tokenAddress: string;
    chain: string;
    tokenSymbol?: string;
    callerName: string;
    alertTimestamp: Date;
    alertPrice: number;
    entryConfig?: EntryConfig;
    status?: 'active' | 'paused' | 'completed' | 'removed';
    historicalCandlesCount?: number;
    lastPrice?: number;
    lastUpdateTime?: Date;
    entrySignalSent?: boolean;
    entryPrice?: number;
    entryTime?: Date;
    entryType?: 'initial' | 'trailing' | 'ichimoku';
}
/**
 * Store a monitored token in Postgres
 */
export declare function storeMonitoredToken(token: MonitoredToken): Promise<number>;
/**
 * Get all active monitored tokens
 */
export declare function getActiveMonitoredTokens(): Promise<MonitoredToken[]>;
/**
 * Update monitored token status
 */
export declare function updateMonitoredTokenStatus(id: number, status: 'active' | 'paused' | 'completed' | 'removed'): Promise<void>;
/**
 * Update monitored token entry information
 */
export declare function updateMonitoredTokenEntry(id: number, entryPrice: number, entryTime: Date, entryType: 'initial' | 'trailing' | 'ichimoku', signalSent?: boolean): Promise<void>;
//# sourceMappingURL=monitored-tokens-db.d.ts.map