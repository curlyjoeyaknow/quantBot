/**
 * Credit Usage Monitor
 * ====================
 * Tracks API credit usage for monitoring and alerting
 */
export interface CreditUsage {
    provider: string;
    creditsUsed: number;
    creditsLimit?: number;
    requestsCount: number;
    lastReset?: Date;
    resetInterval?: 'daily' | 'monthly' | 'never';
}
declare class CreditMonitor {
    private usage;
    private alertThreshold;
    /**
     * Record credit usage
     */
    recordUsage(provider: string, creditsUsed: number, requestsCount?: number): void;
    /**
     * Set credit limit for a provider
     */
    setLimit(provider: string, limit: number, resetInterval?: 'daily' | 'monthly' | 'never'): void;
    /**
     * Get credit usage for a provider
     */
    getUsage(provider: string): CreditUsage | undefined;
    /**
     * Get all credit usage
     */
    getAllUsage(): CreditUsage[];
    /**
     * Reset credit usage (for daily/monthly resets)
     */
    resetUsage(provider: string): void;
    /**
     * Check if provider has credits available
     */
    hasCredits(provider: string, required?: number): boolean;
    /**
     * Get usage report
     */
    getReport(): {
        providers: CreditUsage[];
        totalCreditsUsed: number;
        totalRequests: number;
    };
}
export declare const creditMonitor: CreditMonitor;
export {};
//# sourceMappingURL=credit-monitor.d.ts.map