export interface CallerAlert {
    id?: number;
    callerName: string;
    tokenAddress: string;
    tokenSymbol?: string;
    chain: string;
    alertTimestamp: Date;
    alertMessage?: string;
    priceAtAlert?: number;
    volumeAtAlert?: number;
    createdAt: Date;
}
export interface CallerStats {
    callerName: string;
    totalAlerts: number;
    uniqueTokens: number;
    firstAlert: Date;
    lastAlert: Date;
    avgAlertsPerDay: number;
    successRate?: number;
}
export declare class CallerDatabase {
    private db;
    private dbPath;
    constructor(dbPath?: string);
    /**
     * Initialize database tables
     */
    private initDatabase;
    /**
     * Add a new caller alert
     */
    addCallerAlert(alert: CallerAlert): Promise<number>;
    /**
     * Batch add multiple caller alerts
     */
    addCallerAlertsBatch(alerts: CallerAlert[]): Promise<number>;
    /**
     * Get all alerts for a specific caller
     */
    getCallerAlerts(callerName: string, limit?: number): Promise<CallerAlert[]>;
    /**
     * Get alerts for a caller within a time range
     */
    getCallerAlertsInRange(callerName: string, startTime: Date, endTime: Date): Promise<CallerAlert[]>;
    /**
     * Get all unique callers
     */
    getAllCallers(): Promise<string[]>;
    /**
     * Get caller statistics
     */
    getCallerStats(callerName: string): Promise<CallerStats | null>;
    /**
     * Get all caller statistics
     */
    getAllCallerStats(): Promise<CallerStats[]>;
    /**
     * Get tokens called by a specific caller
     */
    getCallerTokens(callerName: string): Promise<Array<{
        tokenAddress: string;
        tokenSymbol: string;
        chain: string;
        alertCount: number;
    }>>;
    /**
     * Update caller success rate (called after simulations)
     */
    updateCallerSuccessRate(callerName: string, successRate: number): Promise<void>;
    /**
     * Get database statistics
     */
    getDatabaseStats(): Promise<{
        totalAlerts: number;
        totalCallers: number;
        totalTokens: number;
        dateRange: {
            start: Date;
            end: Date;
        };
    }>;
    /**
     * Close database connection
     */
    close(): Promise<void>;
}
export declare const callerDatabase: CallerDatabase;
//# sourceMappingURL=caller-database.d.ts.map