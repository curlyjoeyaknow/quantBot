import { CallerAlert } from '../storage/caller-database';
export interface ProcessedCADrop {
    sender: string;
    tokenAddress: string;
    tokenSymbol?: string;
    chain: string;
    timestamp: Date;
    message?: string;
    priceAtAlert?: number;
    volumeAtAlert?: number;
}
export declare class CallerTrackingService {
    private callerDb;
    /**
     * Initialize the caller tracking service
     */
    initialize(): Promise<void>;
    /**
     * Process and store CA drops from CSV or real-time data
     */
    processCADrops(caDrops: ProcessedCADrop[]): Promise<number>;
    /**
     * Get alerts for a specific caller
     */
    getCallerAlerts(callerName: string, limit?: number): Promise<CallerAlert[]>;
    /**
     * Get alerts for a caller within a time range
     */
    getCallerAlertsInRange(callerName: string, startTime: Date, endTime: Date): Promise<CallerAlert[]>;
    /**
     * Get all callers with their statistics
     */
    getAllCallersWithStats(): Promise<Array<{
        callerName: string;
        stats: any;
    }>>;
    /**
     * Get top callers by alert count
     */
    getTopCallers(limit?: number): Promise<Array<{
        callerName: string;
        alertCount: number;
        uniqueTokens: number;
    }>>;
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
     * Update caller success rate after simulation
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
     * Export caller data for analysis
     */
    exportCallerData(callerName: string, format?: 'json' | 'csv'): Promise<string>;
    /**
     * Get simulation-ready data for a caller
     */
    getSimulationDataForCaller(callerName: string, startTime?: Date, endTime?: Date): Promise<Array<{
        tokenAddress: string;
        tokenSymbol: string;
        chain: string;
        alertTimestamp: Date;
        priceAtAlert?: number;
    }>>;
    /**
     * Close the service
     */
    close(): Promise<void>;
}
export declare const callerTracking: CallerTrackingService;
//# sourceMappingURL=caller-tracking.d.ts.map