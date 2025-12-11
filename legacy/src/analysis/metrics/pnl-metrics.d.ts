/**
 * PnL Metrics Calculation
 *
 * Calculates profit and loss metrics from simulation results
 */
import { SimulationResult } from '../../simulation/engine';
export interface PnLMetrics {
    totalPnl: number;
    totalPnlPercent: number;
    averagePnl: number;
    averagePnlPercent: number;
    medianPnl: number;
    bestTrade: number;
    worstTrade: number;
    profitableTrades: number;
    losingTrades: number;
    breakEvenTrades: number;
}
/**
 * Calculate PnL metrics from simulation results
 */
export declare function calculatePnLMetrics(results: SimulationResult[]): PnLMetrics;
//# sourceMappingURL=pnl-metrics.d.ts.map