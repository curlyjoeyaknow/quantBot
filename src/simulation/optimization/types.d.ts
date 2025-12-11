/**
 * Optimization Types
 *
 * Types for strategy optimization
 */
import { StrategyConfig } from '../strategies/types';
/**
 * Parameter grid definition
 */
export interface ParameterGrid {
    profitTargets?: Array<Array<{
        target: number;
        percent: number;
    }>>;
    trailingStopPercent?: number[];
    trailingStopActivation?: number[];
    minExitPrice?: number[];
    stopLossInitial?: number[];
    holdHours?: number[];
    lossClampPercent?: number[];
}
/**
 * Optimization configuration
 */
export interface OptimizationConfig {
    name: string;
    baseStrategy?: StrategyConfig;
    parameterGrid: ParameterGrid;
    data: {
        kind: 'file' | 'clickhouse' | 'caller';
        [key: string]: unknown;
    };
    outputs?: Array<{
        type: 'csv' | 'json' | 'stdout';
        path?: string;
        detail?: 'summary' | 'detailed';
    }>;
    maxConcurrent?: number;
    maxStrategies?: number;
}
/**
 * Strategy optimization result
 */
export interface StrategyOptimizationResult {
    strategy: StrategyConfig;
    metrics: {
        totalPnl: number;
        totalPnlPercent: number;
        totalTrades: number;
        winningTrades: number;
        losingTrades: number;
        winRate: number;
        avgWin: number;
        avgLoss: number;
        maxDrawdown: number;
        sharpeRatio: number;
        profitFactor: number;
        avgHoldDuration: number;
        avgTimeToAth: number;
    };
    trades: Array<{
        tokenAddress: string;
        tokenSymbol?: string;
        tokenName?: string;
        chain?: string;
        caller?: string;
        alertTime?: string;
        pnl: number;
        pnlPercent: number;
        maxReached: number;
        holdDuration: number;
        timeToAth: number;
        entryPrice?: number;
        exitPrice?: number;
        candlesCount?: number;
    }>;
}
/**
 * Optimization run result
 */
export interface OptimizationRunResult {
    config: OptimizationConfig;
    results: StrategyOptimizationResult[];
    bestStrategy: StrategyOptimizationResult | null;
    summary: {
        totalStrategiesTested: number;
        bestPnl: number;
        bestWinRate: number;
        bestProfitFactor: number;
        averagePnl: number;
    };
}
//# sourceMappingURL=types.d.ts.map