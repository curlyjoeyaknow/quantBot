/**
 * Result Analyzer
 *
 * Main class for analyzing simulation results
 */
import { SimulationResult } from '../simulation/engine';
import { PnLMetrics } from './metrics/pnl-metrics';
import { RiskMetrics } from './metrics/risk-metrics';
import { TradeMetrics } from './metrics/trade-metrics';
export interface AnalysisResult {
    pnl: PnLMetrics;
    risk: RiskMetrics;
    trade: TradeMetrics;
    summary: {
        totalResults: number;
        overallPerformance: 'excellent' | 'good' | 'average' | 'poor' | 'very-poor';
        recommendation: string;
    };
}
export declare class ResultAnalyzer {
    /**
     * Analyze simulation results
     */
    analyze(results: SimulationResult[]): AnalysisResult;
    /**
     * Determine overall performance rating
     */
    private determinePerformance;
    /**
     * Generate recommendation based on analysis
     */
    private generateRecommendation;
    /**
     * Compare multiple strategy results
     */
    compare(strategies: Array<{
        name: string;
        results: SimulationResult[];
    }>): {
        strategies: {
            name: string;
            analysis: AnalysisResult;
        }[];
        best: {
            name: string;
            analysis: AnalysisResult;
        };
        worst: {
            name: string;
            analysis: AnalysisResult;
        };
    };
}
//# sourceMappingURL=result-analyzer.d.ts.map