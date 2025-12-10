"use strict";
/**
 * PnL Metrics Calculation
 *
 * Calculates profit and loss metrics from simulation results
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePnLMetrics = calculatePnLMetrics;
/**
 * Calculate PnL metrics from simulation results
 */
function calculatePnLMetrics(results) {
    if (results.length === 0) {
        return {
            totalPnl: 0,
            totalPnlPercent: 0,
            averagePnl: 0,
            averagePnlPercent: 0,
            medianPnl: 0,
            bestTrade: 0,
            worstTrade: 0,
            profitableTrades: 0,
            losingTrades: 0,
            breakEvenTrades: 0,
        };
    }
    const pnls = results.map(r => r.finalPnl);
    const pnlPercents = results.map(r => (r.finalPnl - 1) * 100);
    const totalPnl = pnls.reduce((sum, pnl) => sum + (pnl - 1), 0);
    const totalPnlPercent = (totalPnl / results.length) * 100;
    const averagePnl = pnls.reduce((sum, pnl) => sum + pnl, 0) / pnls.length;
    const averagePnlPercent = pnlPercents.reduce((sum, p) => sum + p, 0) / pnlPercents.length;
    const sortedPnls = [...pnls].sort((a, b) => a - b);
    const medianPnl = sortedPnls.length % 2 === 0
        ? (sortedPnls[sortedPnls.length / 2 - 1] + sortedPnls[sortedPnls.length / 2]) / 2
        : sortedPnls[Math.floor(sortedPnls.length / 2)];
    const bestTrade = Math.max(...pnls);
    const worstTrade = Math.min(...pnls);
    const profitableTrades = results.filter(r => r.finalPnl > 1).length;
    const losingTrades = results.filter(r => r.finalPnl < 1).length;
    const breakEvenTrades = results.filter(r => r.finalPnl === 1).length;
    return {
        totalPnl,
        totalPnlPercent,
        averagePnl,
        averagePnlPercent,
        medianPnl,
        bestTrade,
        worstTrade,
        profitableTrades,
        losingTrades,
        breakEvenTrades,
    };
}
//# sourceMappingURL=pnl-metrics.js.map