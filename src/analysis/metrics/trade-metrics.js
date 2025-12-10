"use strict";
/**
 * Trade Metrics Calculation
 *
 * Calculates trade-level statistics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateTradeMetrics = calculateTradeMetrics;
/**
 * Calculate trade metrics from simulation results
 */
function calculateTradeMetrics(results) {
    if (results.length === 0) {
        return {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            breakEvenTrades: 0,
            winRate: 0,
            lossRate: 0,
            avgWin: 0,
            avgLoss: 0,
            largestWin: 0,
            largestLoss: 0,
            profitFactor: 0,
            expectancy: 0,
            avgHoldDuration: 0,
            avgTimeToAth: 0,
        };
    }
    const totalTrades = results.length;
    const winningTrades = results.filter(r => r.finalPnl > 1).length;
    const losingTrades = results.filter(r => r.finalPnl < 1).length;
    const breakEvenTrades = results.filter(r => r.finalPnl === 1).length;
    const winRate = (winningTrades / totalTrades) * 100;
    const lossRate = (losingTrades / totalTrades) * 100;
    const wins = results.filter(r => r.finalPnl > 1).map(r => r.finalPnl - 1);
    const losses = results.filter(r => r.finalPnl < 1).map(r => 1 - r.finalPnl);
    const avgWin = wins.length > 0
        ? wins.reduce((sum, w) => sum + w, 0) / wins.length
        : 0;
    const avgLoss = losses.length > 0
        ? losses.reduce((sum, l) => sum + l, 0) / losses.length
        : 0;
    const largestWin = wins.length > 0 ? Math.max(...wins) : 0;
    const largestLoss = losses.length > 0 ? Math.max(...losses) : 0;
    const totalWin = wins.reduce((sum, w) => sum + w, 0);
    const totalLoss = losses.reduce((sum, l) => sum + l, 0);
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;
    // Expectancy = (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
    const expectancy = (winRate / 100) * avgWin - (lossRate / 100) * avgLoss;
    // Calculate average hold duration and time to ATH
    let totalHoldDuration = 0;
    let totalTimeToAth = 0;
    let validHoldDurations = 0;
    let validTimeToAth = 0;
    for (const result of results) {
        if (result.events.length > 0) {
            const firstEvent = result.events[0];
            const lastEvent = result.events[result.events.length - 1];
            const holdDuration = (lastEvent.timestamp - firstEvent.timestamp) / 60; // minutes
            totalHoldDuration += holdDuration;
            validHoldDurations++;
            // Find time to ATH
            const entryPrice = result.entryPrice;
            let ath = entryPrice;
            let athTime = firstEvent.timestamp;
            for (const event of result.events) {
                if (event.price > ath) {
                    ath = event.price;
                    athTime = event.timestamp;
                }
            }
            const timeToAth = (athTime - firstEvent.timestamp) / 60; // minutes
            totalTimeToAth += timeToAth;
            validTimeToAth++;
        }
    }
    const avgHoldDuration = validHoldDurations > 0 ? totalHoldDuration / validHoldDurations : 0;
    const avgTimeToAth = validTimeToAth > 0 ? totalTimeToAth / validTimeToAth : 0;
    return {
        totalTrades,
        winningTrades,
        losingTrades,
        breakEvenTrades,
        winRate,
        lossRate,
        avgWin,
        avgLoss,
        largestWin,
        largestLoss,
        profitFactor,
        expectancy,
        avgHoldDuration,
        avgTimeToAth,
    };
}
//# sourceMappingURL=trade-metrics.js.map