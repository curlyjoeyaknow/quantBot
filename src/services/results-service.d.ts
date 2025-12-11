/**
 * Results & Visualization Service
 *
 * Generates aggregated summaries, performance metrics, and chart data
 * for backtest results.
 */
export interface PerformanceMetrics {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    winRate: number;
    averagePnl: number;
    totalPnl: number;
    maxPnl: number;
    minPnl: number;
    maxDrawdown: number;
    averageCandles: number;
    sharpeRatio?: number;
}
export interface ChartDataPoint {
    timestamp: number;
    price: number;
    pnl?: number;
    event?: string;
}
export interface ChartData {
    priceChart: ChartDataPoint[];
    pnlChart: ChartDataPoint[];
    tradeDistribution: {
        profitable: number;
        losing: number;
        breakeven: number;
    };
}
/**
 * Results Service for aggregating and visualizing backtest results
 */
export declare class ResultsService {
    /**
     * Aggregate results across multiple backtest runs
     */
    aggregateResults(runIds: number[]): Promise<{
        metrics: PerformanceMetrics;
        runs: any[];
    }>;
    /**
     * Generate chart data for a single backtest run
     */
    generateChartData(runId: number): Promise<ChartData>;
    /**
     * Calculate performance metrics from runs
     */
    private calculateMetrics;
    /**
     * Get empty metrics structure
     */
    private getEmptyMetrics;
    /**
     * Compare multiple strategies
     */
    compareStrategies(strategyIds: number[], userId: number): Promise<{
        strategies: Array<{
            strategyId: number;
            strategyName: string;
            metrics: PerformanceMetrics;
        }>;
    }>;
}
export declare const resultsService: ResultsService;
//# sourceMappingURL=results-service.d.ts.map