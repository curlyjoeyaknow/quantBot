"use strict";
/**
 * Technical Indicators for Trading Simulations
 * ============================================
 * Provides moving averages and integrates with Ichimoku Cloud
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSMA = calculateSMA;
exports.calculateEMA = calculateEMA;
exports.calculateMovingAverages = calculateMovingAverages;
exports.calculateIndicators = calculateIndicators;
exports.isPriceAboveMA = isPriceAboveMA;
exports.isPriceBelowMA = isPriceBelowMA;
exports.isGoldenCross = isGoldenCross;
exports.isDeathCross = isDeathCross;
exports.getBullishSignals = getBullishSignals;
exports.getBearishSignals = getBearishSignals;
exports.isBullishEntry = isBullishEntry;
exports.isBearishExit = isBearishExit;
const ichimoku_1 = require("./ichimoku");
/**
 * Calculate Simple Moving Average (SMA)
 */
function calculateSMA(candles, period, currentIndex) {
    if (currentIndex < period - 1 || candles.length < period) {
        return null;
    }
    const slice = candles.slice(currentIndex - period + 1, currentIndex + 1);
    const sum = slice.reduce((acc, candle) => acc + candle.close, 0);
    return sum / period;
}
/**
 * Calculate Exponential Moving Average (EMA)
 */
function calculateEMA(candles, period, currentIndex, previousEMA) {
    if (currentIndex < period - 1 || candles.length < period) {
        return null;
    }
    const multiplier = 2 / (period + 1);
    const currentPrice = candles[currentIndex].close;
    if (previousEMA === null || previousEMA === undefined) {
        // Initialize with SMA
        const sma = calculateSMA(candles, period, currentIndex);
        if (sma === null)
            return null;
        return (currentPrice - sma) * multiplier + sma;
    }
    return (currentPrice - previousEMA) * multiplier + previousEMA;
}
/**
 * Calculate all moving averages for a candle
 */
function calculateMovingAverages(candles, currentIndex, previousEMAs) {
    return {
        sma9: calculateSMA(candles, 9, currentIndex),
        sma20: calculateSMA(candles, 20, currentIndex),
        sma50: calculateSMA(candles, 50, currentIndex),
        ema9: calculateEMA(candles, 9, currentIndex, previousEMAs?.ema9),
        ema20: calculateEMA(candles, 20, currentIndex, previousEMAs?.ema20),
        ema50: calculateEMA(candles, 50, currentIndex, previousEMAs?.ema50),
    };
}
/**
 * Calculate all indicators for a candle
 */
function calculateIndicators(candles, currentIndex, previousEMAs) {
    const candle = candles[currentIndex];
    const movingAverages = calculateMovingAverages(candles, currentIndex, previousEMAs);
    const ichimoku = (0, ichimoku_1.calculateIchimoku)(candles, currentIndex);
    return {
        candle,
        index: currentIndex,
        movingAverages,
        ichimoku,
    };
}
/**
 * Check if price is above moving average (bullish signal)
 */
function isPriceAboveMA(price, ma) {
    return ma !== null && price > ma;
}
/**
 * Check if price is below moving average (bearish signal)
 */
function isPriceBelowMA(price, ma) {
    return ma !== null && price < ma;
}
/**
 * Check for golden cross (fast MA crosses above slow MA)
 */
function isGoldenCross(fastMA, slowMA, prevFastMA, prevSlowMA) {
    if (!fastMA || !slowMA || prevFastMA === null || prevSlowMA === null) {
        return false;
    }
    return prevFastMA <= prevSlowMA && fastMA > slowMA;
}
/**
 * Check for death cross (fast MA crosses below slow MA)
 */
function isDeathCross(fastMA, slowMA, prevFastMA, prevSlowMA) {
    if (!fastMA || !slowMA || prevFastMA === null || prevSlowMA === null) {
        return false;
    }
    return prevFastMA >= prevSlowMA && fastMA < slowMA;
}
/**
 * Get bullish indicator signals
 */
function getBullishSignals(current, previous) {
    const signals = [];
    const price = current.candle.close;
    // Ichimoku signals
    if (current.ichimoku) {
        if (current.ichimoku.isBullish) {
            signals.push('ichimoku_bullish');
        }
        if (previous?.ichimoku && !previous.ichimoku.isBullish && current.ichimoku.isBullish) {
            signals.push('ichimoku_cloud_cross_up');
        }
        if (previous?.ichimoku &&
            previous.ichimoku.tenkan <= previous.ichimoku.kijun &&
            current.ichimoku.tenkan > current.ichimoku.kijun) {
            signals.push('ichimoku_tenkan_kijun_cross_up');
        }
    }
    // Moving average signals
    if (isPriceAboveMA(price, current.movingAverages.sma20)) {
        signals.push('price_above_sma20');
    }
    if (isPriceAboveMA(price, current.movingAverages.ema20)) {
        signals.push('price_above_ema20');
    }
    if (isGoldenCross(current.movingAverages.ema9, current.movingAverages.ema20, previous?.movingAverages.ema9 || null, previous?.movingAverages.ema20 || null)) {
        signals.push('golden_cross');
    }
    return signals;
}
/**
 * Get bearish indicator signals
 */
function getBearishSignals(current, previous) {
    const signals = [];
    const price = current.candle.close;
    // Ichimoku signals
    if (current.ichimoku) {
        if (current.ichimoku.isBearish) {
            signals.push('ichimoku_bearish');
        }
        if (previous?.ichimoku && !previous.ichimoku.isBearish && current.ichimoku.isBearish) {
            signals.push('ichimoku_cloud_cross_down');
        }
        if (previous?.ichimoku &&
            previous.ichimoku.tenkan >= previous.ichimoku.kijun &&
            current.ichimoku.tenkan < current.ichimoku.kijun) {
            signals.push('ichimoku_tenkan_kijun_cross_down');
        }
    }
    // Moving average signals
    if (isPriceBelowMA(price, current.movingAverages.sma20)) {
        signals.push('price_below_sma20');
    }
    if (isPriceBelowMA(price, current.movingAverages.ema20)) {
        signals.push('price_below_ema20');
    }
    if (isDeathCross(current.movingAverages.ema9, current.movingAverages.ema20, previous?.movingAverages.ema9 || null, previous?.movingAverages.ema20 || null)) {
        signals.push('death_cross');
    }
    return signals;
}
/**
 * Check if indicators support bullish entry
 */
function isBullishEntry(current, previous) {
    const bullishSignals = getBullishSignals(current, previous);
    // Require at least one strong signal
    const strongSignals = ['ichimoku_cloud_cross_up', 'ichimoku_tenkan_kijun_cross_up', 'golden_cross'];
    return bullishSignals.some(signal => strongSignals.includes(signal));
}
/**
 * Check if indicators suggest exit
 */
function isBearishExit(current, previous) {
    const bearishSignals = getBearishSignals(current, previous);
    // Require at least one strong signal
    const strongSignals = ['ichimoku_cloud_cross_down', 'ichimoku_tenkan_kijun_cross_down', 'death_cross'];
    return bearishSignals.some(signal => strongSignals.includes(signal));
}
//# sourceMappingURL=indicators.js.map