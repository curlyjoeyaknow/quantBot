/**
 * Strategy Optimizer
 *
 * Optimizes trading strategies by testing parameter combinations
 */
import { OptimizationConfig, OptimizationRunResult } from './types';
export declare class StrategyOptimizer {
    /**
     * Run optimization with given configuration
     */
    optimize(config: OptimizationConfig): Promise<OptimizationRunResult>;
    /**
     * Test a single strategy against data
     */
    private testStrategy;
    /**
     * Calculate performance metrics from trades
     */
    private calculateMetrics;
    /**
     * Calculate time to ATH (all-time high)
     */
    private calculateTimeToAth;
    /**
     * Find the best strategy from results
     */
    private findBestStrategy;
    /**
     * Calculate summary statistics
     */
    private calculateSummary;
}
//# sourceMappingURL=optimizer.d.ts.map