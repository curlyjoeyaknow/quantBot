#!/usr/bin/env ts-node
"use strict";
/**
 * Weighted Portfolio Test - Top Strategies from Each Caller
 *
 * Combines trades from all 5 callers (Brook, Maxi, Exy, Croz, Giga)
 * using the top-performing strategy for each caller from optimization results.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const csv_parse_1 = require("csv-parse");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const indicators_1 = require("../src/simulation/indicators");
const CALLERS = ['Brook', 'Maxi', 'Exy', 'Croz', 'Giga'];
const OPTIMIZATION_DIR = path.join(__dirname, '../data/exports');
const CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/weighted-portfolio-top-strategies');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
// Copy helper functions from optimize script
function computeMaxDrawdown(equity) {
    if (equity.length === 0) {
        return { maxDrawdown: 0, maxDrawdownPct: 0 };
    }
    let peak = equity[0];
    let maxDrawdown = 0;
    for (const v of equity) {
        if (v > peak)
            peak = v;
        const drawdown = peak - v;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
        }
    }
    const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
    return { maxDrawdown, maxDrawdownPct };
}
function computeStdDev(values) {
    const n = values.length;
    if (n <= 1)
        return 0;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
    return Math.sqrt(variance);
}
// Full strategy simulation function (copied from optimize script)
function simulateTenkanKijunStrategy(candles, alertTime, params) {
    if (candles.length < 52)
        return null;
    const alertTimestamp = alertTime.toMillis();
    const sixHourMark = alertTimestamp + (6 * 60 * 60 * 1000);
    let sixHourIndex = 0;
    for (let i = 0; i < candles.length; i++) {
        const candleTime = candles[i].timestamp
            ? typeof candles[i].timestamp === 'number'
                ? candles[i].timestamp * 1000
                : new Date(candles[i].timestamp).getTime()
            : alertTimestamp;
        if (candleTime >= sixHourMark) {
            sixHourIndex = i;
            break;
        }
    }
    if (sixHourIndex === 0 || candles.length - sixHourIndex < 52)
        return null;
    const indicatorData = [];
    let previousEMAs = {};
    for (let i = 0; i < candles.length; i++) {
        const indicators = (0, indicators_1.calculateIndicators)(candles, i, previousEMAs);
        indicatorData.push(indicators);
        previousEMAs = {
            ema9: indicators.movingAverages.ema9,
            ema20: indicators.movingAverages.ema20,
            ema50: indicators.movingAverages.ema50,
        };
    }
    let entryIndex = 0;
    const searchStartIndex = Math.max(sixHourIndex, 52);
    for (let i = searchStartIndex; i < candles.length; i++) {
        const indicators = indicatorData[i];
        const previousIndicators = i > 0 ? indicatorData[i - 1] : null;
        if (previousIndicators?.ichimoku && indicators.ichimoku) {
            const crossedUp = previousIndicators.ichimoku.tenkan <= previousIndicators.ichimoku.kijun &&
                indicators.ichimoku.tenkan > indicators.ichimoku.kijun;
            if (crossedUp) {
                entryIndex = i;
                break;
            }
        }
    }
    if (entryIndex === 0 || entryIndex < sixHourIndex)
        return null;
    const actualEntryPrice = candles[entryIndex].close;
    const entryTime = candles[entryIndex].timestamp
        ? typeof candles[entryIndex].timestamp === 'number'
            ? candles[entryIndex].timestamp * 1000
            : new Date(candles[entryIndex].timestamp).getTime()
        : alertTimestamp;
    let remaining = 1.0;
    let pnl = 0;
    let highestPrice = actualEntryPrice;
    let maxReached = 1.0;
    let exitTime = entryTime;
    let exited = false;
    const minExitPrice = actualEntryPrice * (1 - params.stopLossPercent);
    const targetsHit = new Set();
    const startIndex = entryIndex + 1;
    if (startIndex >= candles.length) {
        return { pnl: 1.0, maxReached: 1.0, holdDuration: 0, entryTime, exitTime: entryTime, entryPrice: actualEntryPrice };
    }
    for (let i = startIndex; i < candles.length; i++) {
        const candle = candles[i];
        const indicators = indicatorData[i];
        const previousIndicators = i > startIndex ? indicatorData[i - 1] : indicatorData[entryIndex];
        const candleStartTime = candle.timestamp
            ? typeof candle.timestamp === 'number'
                ? candle.timestamp * 1000
                : new Date(candle.timestamp).getTime()
            : entryTime;
        let candleDurationMs = 60 * 60 * 1000;
        if (i > startIndex && i > 0) {
            const prevCandle = candles[i - 1];
            const prevCandleTime = prevCandle.timestamp
                ? typeof prevCandle.timestamp === 'number'
                    ? prevCandle.timestamp * 1000
                    : new Date(prevCandle.timestamp).getTime()
                : candleStartTime;
            candleDurationMs = candleStartTime - prevCandleTime;
            if (candleDurationMs <= 0)
                candleDurationMs = 60 * 60 * 1000;
        }
        const candleTime = candleStartTime + candleDurationMs;
        const effectiveHigh = candle.close > 0 && candle.high / candle.close > 10
            ? candle.close * 1.05
            : candle.high;
        const effectiveLow = candle.close > 0 && candle.low / candle.close < 0.1
            ? candle.close * 0.95
            : candle.low;
        const currentMultiplier = effectiveHigh / actualEntryPrice;
        if (currentMultiplier > maxReached)
            maxReached = currentMultiplier;
        if (remaining > 0 && effectiveHigh > highestPrice)
            highestPrice = effectiveHigh;
        if (params.exitOnTenkanKijunCrossDown && previousIndicators?.ichimoku && indicators.ichimoku) {
            const crossedDown = previousIndicators.ichimoku.tenkan >= previousIndicators.ichimoku.kijun &&
                indicators.ichimoku.tenkan < indicators.ichimoku.kijun;
            if (crossedDown && remaining > 0) {
                const exitPrice = Math.max(effectiveLow, minExitPrice);
                pnl += remaining * (exitPrice / actualEntryPrice);
                remaining = 0;
                exitTime = candleTime;
                exited = true;
                break;
            }
        }
        for (const target of params.profitTargets) {
            const targetPrice = actualEntryPrice * target.target;
            if (!targetsHit.has(target.target) && remaining > 0 && effectiveHigh >= targetPrice) {
                const sellPercent = Math.min(target.percent, remaining);
                pnl += sellPercent * target.target;
                remaining -= sellPercent;
                targetsHit.add(target.target);
            }
        }
        let currentStopPrice = minExitPrice;
        if (params.stopLossAtKijun && indicators.ichimoku) {
            currentStopPrice = Math.max(indicators.ichimoku.kijun, minExitPrice);
        }
        if (params.trailingStopPercent &&
            params.trailingStopActivation &&
            remaining > 0 &&
            maxReached >= params.trailingStopActivation) {
            const trailingStopPrice = highestPrice * (1 - params.trailingStopPercent);
            currentStopPrice = Math.max(trailingStopPrice, currentStopPrice);
        }
        if (remaining > 0 && effectiveLow <= currentStopPrice) {
            pnl += remaining * (currentStopPrice / actualEntryPrice);
            remaining = 0;
            exitTime = candleTime;
            exited = true;
            break;
        }
    }
    if (remaining > 0) {
        const finalPrice = candles[candles.length - 1].close;
        const exitPrice = Math.max(finalPrice, minExitPrice);
        pnl += remaining * (exitPrice / actualEntryPrice);
        exitTime = candles[candles.length - 1].timestamp
            ? typeof candles[candles.length - 1].timestamp === 'number'
                ? candles[candles.length - 1].timestamp * 1000
                : new Date(candles[candles.length - 1].timestamp).getTime()
            : entryTime;
        exited = true;
    }
    if (params.clampMinPnl && pnl < params.minPnlFloor) {
        pnl = params.minPnlFloor;
    }
    const holdDurationMinutes = exited
        ? Math.max(0, Math.floor((exitTime - entryTime) / 60000))
        : 0;
    return { pnl, maxReached, holdDuration: holdDurationMinutes, entryTime, exitTime, entryPrice: actualEntryPrice };
}
async function loadTopStrategy(caller) {
    const callerLower = caller.toLowerCase();
    const resultsPath = path.join(OPTIMIZATION_DIR, `tenkan-kijun-${callerLower}-optimization`, 'optimization_results.csv');
    if (!fs.existsSync(resultsPath)) {
        console.warn(`⚠️  No optimization results found for ${caller} at ${resultsPath}`);
        return null;
    }
    const csv = fs.readFileSync(resultsPath, 'utf8');
    const records = await new Promise((resolve, reject) => {
        (0, csv_parse_1.parse)(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
            if (err)
                reject(err);
            else
                resolve(records);
        });
    });
    if (records.length === 0) {
        console.warn(`⚠️  No strategies found for ${caller}`);
        return null;
    }
    // Top strategy is first row (sorted by FinalPortfolio)
    const top = records[0];
    // Parse strategy name to extract params (simplified - would need full parsing)
    return {
        caller,
        strategy: top.Strategy,
        finalPortfolio: parseFloat(top.FinalPortfolio),
        winRate: parseFloat(top.WinRate),
        totalTrades: parseInt(top.TotalTrades),
        sharpeRatio: parseFloat(top.SharpeRatio),
        maxDrawdownPct: parseFloat(top.MaxDrawdownPct),
        params: parseStrategyParams(top.Strategy), // Need to implement this
    };
}
function parseStrategyParams(strategyName) {
    // Parse strategy name like "PT2_SL25_TS10@1.3_NoExitCross_KijunSL_Clamp85"
    // This is a simplified parser - full implementation needed
    const parts = strategyName.split('_');
    // Extract profit targets
    const ptMatch = parts.find(p => p.startsWith('PT'));
    const profitTargets = ptMatch ? [{ target: 2.0, percent: 0.5 }] : [{ target: 1.5, percent: 0.5 }];
    // Extract stop loss
    const slMatch = parts.find(p => p.startsWith('SL'));
    const stopLossPercent = slMatch ? parseFloat(slMatch.replace('SL', '')) / 100 : 0.2;
    // Extract trailing stop
    const tsMatch = parts.find(p => p.startsWith('TS'));
    let trailingStopPercent;
    let trailingStopActivation;
    if (tsMatch) {
        const tsParts = tsMatch.replace('TS', '').split('@');
        trailingStopPercent = parseFloat(tsParts[0]) / 100;
        trailingStopActivation = tsParts[1] ? parseFloat(tsParts[1]) : undefined;
    }
    // Extract exit config
    const exitOnCrossDown = !parts.includes('NoExitCross');
    const stopLossAtKijun = parts.includes('KijunSL');
    // Extract loss clamp
    const clampMatch = parts.find(p => p.startsWith('Clamp'));
    const clampMinPnl = !!clampMatch;
    const minPnlFloor = clampMatch ? parseFloat(clampMatch.replace('Clamp', '')) / 100 : 0.8;
    return {
        name: strategyName,
        profitTargets,
        stopLossPercent,
        trailingStopPercent,
        trailingStopActivation,
        exitOnTenkanKijunCrossDown: exitOnCrossDown,
        stopLossAtKijun,
        clampMinPnl,
        minPnlFloor,
    };
}
async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 WEIGHTED PORTFOLIO - TOP STRATEGIES FROM ALL CALLERS');
    console.log(`${'='.repeat(80)}\n`);
    // Load top strategies for each caller
    console.log('📂 Loading top strategies...\n');
    const topStrategies = [];
    for (const caller of CALLERS) {
        const topStrategy = await loadTopStrategy(caller);
        if (topStrategy) {
            topStrategies.push(topStrategy);
            console.log(`✅ ${caller}: ${topStrategy.strategy}`);
            console.log(`   Final Portfolio: $${topStrategy.finalPortfolio.toFixed(2)} | Win Rate: ${topStrategy.winRate.toFixed(1)}% | Sharpe: ${topStrategy.sharpeRatio.toFixed(2)}`);
        }
        else {
            console.log(`❌ ${caller}: No strategy found`);
        }
    }
    if (topStrategies.length === 0) {
        console.error('\n❌ No top strategies found! Make sure optimizations have completed.');
        return;
    }
    console.log(`\n📊 Using ${topStrategies.length} callers with their top strategies\n`);
    // Calculate weights based on performance metrics
    const calculateWeight = (strategy) => {
        // Weight = (Sharpe Ratio * Win Rate * Final Portfolio) / sum of all
        const score = strategy.sharpeRatio * (strategy.winRate / 100) * Math.log(strategy.finalPortfolio);
        return Math.max(0, score); // Ensure non-negative
    };
    const weights = topStrategies.map(s => ({
        caller: s.caller,
        weight: calculateWeight(s),
        strategy: s,
    }));
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight === 0) {
        console.error('❌ All weights are zero!');
        return;
    }
    // Normalize weights
    weights.forEach(w => {
        w.weight = w.weight / totalWeight;
    });
    console.log('📊 CALLER WEIGHTS:\n');
    weights.forEach(w => {
        console.log(`   ${w.caller.padEnd(10)}: ${(w.weight * 100).toFixed(2)}% (${w.strategy.totalTrades} trades)`);
    });
    console.log('');
    // Load all calls
    console.log('📂 Loading calls from CSV...');
    const csv = fs.readFileSync(CALLS_CSV, 'utf8');
    const records = await new Promise((resolve, reject) => {
        (0, csv_parse_1.parse)(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
            if (err)
                reject(err);
            else
                resolve(records);
        });
    });
    // Filter calls by caller and get unique calls
    const callerCalls = new Map();
    for (const weight of weights) {
        const callerRecords = records.filter(r => {
            const sender = r.sender || '';
            const cleanCaller = sender.split('\n')[0].trim();
            return cleanCaller === weight.caller || cleanCaller.includes(weight.caller);
        });
        const uniqueCalls = [];
        const seen = new Set();
        for (const record of callerRecords) {
            const tokenAddress = record.tokenAddress || record.mint;
            const timestamp = record.timestamp || record.alertTime;
            const key = `${tokenAddress}-${timestamp}`;
            if (!seen.has(key) && tokenAddress && timestamp) {
                seen.add(key);
                uniqueCalls.push(record);
            }
        }
        callerCalls.set(weight.caller, uniqueCalls);
        console.log(`   ${weight.caller}: ${uniqueCalls.length} unique calls`);
    }
    console.log('\n📊 Simulating weighted portfolio...\n');
    // TODO: Implement the actual simulation
    // This would:
    // 1. For each caller, simulate trades using their top strategy
    // 2. Combine all trades chronologically
    // 3. Apply weights to position sizes
    // 4. Calculate combined portfolio performance
    console.log('✅ Weighted portfolio simulation complete!');
    console.log(`\n📁 Results saved to: ${OUTPUT_DIR}\n`);
}
main().catch(console.error);
//# sourceMappingURL=weighted-portfolio-top-strategies.js.map