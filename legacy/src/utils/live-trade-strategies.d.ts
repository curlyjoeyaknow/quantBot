/**
 * Live Trade Strategies Database Functions
 * =======================================
 * Functions to get enabled/disabled strategies for live trade alerts
 */
/**
 * Get enabled strategy IDs
 */
export declare function getEnabledStrategies(): Promise<Set<string>>;
/**
 * Check if a strategy is enabled
 */
export declare function isStrategyEnabled(strategyId: string): Promise<boolean>;
//# sourceMappingURL=live-trade-strategies.d.ts.map