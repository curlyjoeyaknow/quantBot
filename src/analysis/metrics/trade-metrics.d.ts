/**
 * Trade Metrics Calculation
 *
 * Calculates trade-level statistics
 */
import { SimulationResult } from '../../simulation/engine';
export interface TradeMetrics {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    breakEvenTrades: number;
    winRate: number;
    lossRate: number;
    avgWin: number;
    avgLoss: number;
    largestWin: number;
    largestLoss: number;
    profitFactor: number;
    expectancy: number;
    avgHoldDuration: number;
    avgTimeToAth: number;
}
/**
 * Calculate trade metrics from simulation results
 */
export declare function calculateTradeMetrics(results: SimulationResult[]): TradeMetrics;
//# sourceMappingURL=trade-metrics.d.ts.map