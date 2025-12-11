"use strict";
/**
 * Result Analyzer
 *
 * Main class for analyzing simulation results
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultAnalyzer = void 0;
const pnl_metrics_1 = require("./metrics/pnl-metrics");
const risk_metrics_1 = require("./metrics/risk-metrics");
const trade_metrics_1 = require("./metrics/trade-metrics");
class ResultAnalyzer {
    /**
     * Analyze simulation results
     */
    analyze(results) {
        const pnl = (0, pnl_metrics_1.calculatePnLMetrics)(results);
        const risk = (0, risk_metrics_1.calculateRiskMetrics)(results);
        const trade = (0, trade_metrics_1.calculateTradeMetrics)(results);
        // Determine overall performance
        const performance = this.determinePerformance(pnl, risk, trade);
        const recommendation = this.generateRecommendation(pnl, risk, trade);
        return {
            pnl,
            risk,
            trade,
            summary: {
                totalResults: results.length,
                overallPerformance: performance,
                recommendation,
            },
        };
    }
    /**
     * Determine overall performance rating
     */
    determinePerformance(pnl, risk, trade) {
        // Score based on multiple factors
        let score = 0;
        // PnL factors
        if (pnl.averagePnlPercent > 50)
            score += 3;
        else if (pnl.averagePnlPercent > 20)
            score += 2;
        else if (pnl.averagePnlPercent > 0)
            score += 1;
        // Win rate factors
        if (trade.winRate > 60)
            score += 2;
        else if (trade.winRate > 50)
            score += 1;
        // Risk factors
        if (risk.sharpeRatio > 2)
            score += 2;
        else if (risk.sharpeRatio > 1)
            score += 1;
        if (risk.maxDrawdownPercent < 10)
            score += 1;
        else if (risk.maxDrawdownPercent > 30)
            score -= 1;
        // Profit factor
        if (trade.profitFactor > 2)
            score += 1;
        else if (trade.profitFactor < 1)
            score -= 1;
        // Determine rating
        if (score >= 7)
            return 'excellent';
        if (score >= 5)
            return 'good';
        if (score >= 3)
            return 'average';
        if (score >= 1)
            return 'poor';
        return 'very-poor';
    }
    /**
     * Generate recommendation based on analysis
     */
    generateRecommendation(pnl, risk, trade) {
        const recommendations = [];
        if (pnl.averagePnlPercent < 0) {
            recommendations.push('Strategy is losing money. Consider revising entry/exit rules.');
        }
        if (trade.winRate < 40) {
            recommendations.push('Low win rate. Consider tighter stop losses or better entry timing.');
        }
        if (risk.maxDrawdownPercent > 30) {
            recommendations.push('High drawdown. Consider reducing position size or adding loss limits.');
        }
        if (trade.profitFactor < 1) {
            recommendations.push('Profit factor below 1.0. Average losses exceed average wins.');
        }
        if (risk.sharpeRatio < 0.5) {
            recommendations.push('Low Sharpe ratio. Returns are not compensating for risk.');
        }
        if (recommendations.length === 0) {
            recommendations.push('Strategy performance looks good. Consider scaling up gradually.');
        }
        return recommendations.join(' ');
    }
    /**
     * Compare multiple strategy results
     */
    compare(strategies) {
        const analyses = strategies.map(s => ({
            name: s.name,
            analysis: this.analyze(s.results),
        }));
        // Sort by average PnL
        analyses.sort((a, b) => b.analysis.pnl.averagePnlPercent - a.analysis.pnl.averagePnlPercent);
        return {
            strategies: analyses,
            best: analyses[0],
            worst: analyses[analyses.length - 1],
        };
    }
}
exports.ResultAnalyzer = ResultAnalyzer;
//# sourceMappingURL=result-analyzer.js.map