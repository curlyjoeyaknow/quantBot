import { Database } from 'sqlite3';
/**
 * Initialize caller database connection
 */
declare function initCallerDatabase(): Promise<Database>;
/**
 * Find calls for a specific token address
 */
declare function findCallsForToken(tokenAddress: string): Promise<any[]>;
/**
 * Get recent calls (for /history command)
 */
declare function getRecentCalls(limit?: number): Promise<any[]>;
/**
 * Get caller statistics
 */
declare function getCallerStats(): Promise<{
    stats: any;
    topCallers: any[];
}>;
export { initCallerDatabase, findCallsForToken, getRecentCalls, getCallerStats };
//# sourceMappingURL=caller-database.d.ts.map