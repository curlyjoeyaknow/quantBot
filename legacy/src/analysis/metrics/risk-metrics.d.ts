/**
 * Risk Metrics Calculation
 *
 * Calculates risk metrics (Sharpe ratio, drawdown, etc.)
 */
import { SimulationResult } from '../../simulation/engine';
export interface RiskMetrics {
    sharpeRatio: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    volatility: number;
    downsideDeviation: number;
    sortinoRatio: number;
    calmarRatio: number;
}
/**
 * Calculate risk metrics from simulation results
 */
export declare function calculateRiskMetrics(results: SimulationResult[]): RiskMetrics;
//# sourceMappingURL=risk-metrics.d.ts.map