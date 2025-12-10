#!/usr/bin/env ts-node
"use strict";
/**
 * Test Tenkan/Kijun Cross Strategy - WITH LOSS CLAMP ENABLED
 * Run analysis for EACH CALLER separately in parallel
 * Loss clamp: minimum PnL of 0.8x (-20% max loss)
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
const luxon_1 = require("luxon");
const candles_1 = require("../src/simulation/candles");
const csv_parse_1 = require("csv-parse");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const csv_stringify_1 = require("csv-stringify");
const indicators_1 = require("../src/simulation/indicators");
const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/tenkan-kijun-with-loss-clamp');
// Risk modeling options - LOSS CLAMP ENABLED
const CLAMP_MIN_PNL = true; // ✅ ENABLED
const MIN_PNL = 0.8; // 0.8x = -20% max loss
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
// Import the simulation function from the original script
function simulateTenkanKijunRemainingPeriodOnly(candles, alertTime) {
    if (candles.length < 52) {
        return null;
    }
    const alertTimestamp = alertTime.toMillis();
    const sixHourMark = alertTimestamp + (6 * 60 * 60 * 1000);
    // Find the index where 6 hours have passed
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
    if (sixHourIndex === 0 || candles.length - sixHourIndex < 52) {
        return null;
    }
    // Calculate indicators from the beginning
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
    // Find Tenkan/Kijun cross entry - ONLY after 6-hour mark
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
    if (entryIndex === 0 || entryIndex < sixHourIndex) {
        return null;
    }
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
    const minExitPrice = actualEntryPrice * 0.8;
    const targetsHit = new Set();
    const startIndex = entryIndex + 1;
    if (startIndex >= candles.length) {
        return {
            pnl: 1.0,
            maxReached: 1.0,
            holdDuration: 0,
            entryTime,
            exitTime: entryTime,
            entryPrice: actualEntryPrice,
        };
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
        if (currentMultiplier > maxReached) {
            maxReached = currentMultiplier;
        }
        if (remaining > 0 && effectiveHigh > highestPrice) {
            highestPrice = effectiveHigh;
        }
        if (previousIndicators?.ichimoku && indicators.ichimoku) {
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
        const targetPrice = actualEntryPrice * 1.5;
        if (!targetsHit.has(1.5) && remaining >= 0.5 && effectiveHigh >= targetPrice) {
            pnl += 0.5 * 1.5;
            remaining -= 0.5;
            targetsHit.add(1.5);
        }
        let currentStopPrice = minExitPrice;
        if (indicators.ichimoku) {
            currentStopPrice = Math.max(indicators.ichimoku.kijun, minExitPrice);
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
    // ✅ APPLY LOSS CLAMP
    if (CLAMP_MIN_PNL && pnl < MIN_PNL) {
        pnl = MIN_PNL;
    }
    const holdDurationMinutes = exited
        ? Math.max(0, Math.floor((exitTime - entryTime) / 60000))
        : 0;
    return {
        pnl,
        maxReached,
        holdDuration: holdDurationMinutes,
        entryTime,
        exitTime,
        entryPrice: actualEntryPrice,
    };
}
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
async function analyzeCaller(callerName, allRecords) {
    const callerRecords = allRecords.filter(r => {
        const sender = r.sender || '';
        const cleanCaller = sender.split('\n')[0].trim();
        return cleanCaller === callerName;
    });
    if (callerRecords.length === 0) {
        console.log(`⚠️  No records found for ${callerName}`);
        return;
    }
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 Analyzing: ${callerName} (${callerRecords.length} calls)`);
    console.log(`${'='.repeat(80)}`);
    const callerOutputDir = path.join(OUTPUT_DIR, callerName.replace(/[^a-zA-Z0-9]/g, '_'));
    if (!fs.existsSync(callerOutputDir)) {
        fs.mkdirSync(callerOutputDir, { recursive: true });
    }
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
    console.log(`   Unique calls: ${uniqueCalls.length}`);
    const trades = [];
    const initialPortfolio = 100;
    const fixedPositionSize = 10;
    const positionSizePercent = 0.1;
    const maxRiskPerTrade = 0.02;
    const stopLossPercent = 0.2;
    for (let i = 0; i < uniqueCalls.length; i++) {
        const call = uniqueCalls[i];
        try {
            const chain = call.chain || 'solana';
            const tokenAddress = call.tokenAddress || call.mint;
            if (!tokenAddress)
                continue;
            const alertTime = luxon_1.DateTime.fromISO(call.timestamp || call.alertTime);
            if (!alertTime.isValid)
                continue;
            const endTime = alertTime.plus({ days: 7 });
            process.env.USE_CACHE_ONLY = 'true'; // Use cache/ClickHouse only, no API calls
            const candles = await (0, candles_1.fetchHybridCandles)(tokenAddress, alertTime, endTime, chain);
            delete process.env.USE_CACHE_ONLY;
            if (candles.length < 52)
                continue;
            const result = simulateTenkanKijunRemainingPeriodOnly(candles, alertTime);
            if (!result)
                continue;
            trades.push({
                tokenAddress,
                alertTime: call.timestamp || call.alertTime || '',
                entryTime: luxon_1.DateTime.fromMillis(result.entryTime).toISO() || '',
                exitTime: luxon_1.DateTime.fromMillis(result.exitTime).toISO() || '',
                pnl: result.pnl,
                pnlPercent: (result.pnl - 1) * 100,
                maxReached: result.maxReached,
                holdDuration: result.holdDuration,
                entryPrice: result.entryPrice,
            });
            if ((i + 1) % 10 === 0) {
                console.log(`   Processed ${i + 1}/${uniqueCalls.length} calls...`);
            }
        }
        catch (error) {
            // Skip errors
        }
    }
    if (trades.length === 0) {
        console.log(`   ❌ No trades generated for ${callerName}`);
        return;
    }
    const sortedTrades = trades.sort((a, b) => luxon_1.DateTime.fromISO(a.alertTime).toMillis() - luxon_1.DateTime.fromISO(b.alertTime).toMillis());
    const winningTrades = sortedTrades.filter(t => t.pnl > 1.0).length;
    const losingTrades = sortedTrades.filter(t => t.pnl <= 1.0).length;
    const winRate = sortedTrades.length > 0 ? winningTrades / sortedTrades.length : 0;
    const totalPnl = sortedTrades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
    const avgPnlPerTrade = sortedTrades.length > 0 ? (totalPnl / sortedTrades.length) * 100 : 0;
    // Calculate reinvestment performance with moving average position sizing
    let portfolio = initialPortfolio;
    const portfolioHistory = [portfolio];
    const reinvestmentHistory = [];
    const movingAvgWindow = 7;
    const portfolioValues = [portfolio];
    for (let i = 0; i < sortedTrades.length; i++) {
        const trade = sortedTrades[i];
        const portfolioBefore = portfolio;
        // Calculate moving average of portfolio
        if (portfolioValues.length >= movingAvgWindow) {
            portfolioValues.shift();
        }
        portfolioValues.push(portfolioBefore);
        const movingAvgPortfolio = portfolioValues.reduce((a, b) => a + b, 0) / portfolioValues.length;
        // Position size based on moving average
        const currentPositionSize = movingAvgPortfolio * positionSizePercent;
        const positionSize = Math.max(1, Math.min(currentPositionSize, portfolioBefore * 0.5));
        const tradeReturn = trade.pnl - 1.0;
        const tradePnL = positionSize * tradeReturn;
        portfolio = portfolioBefore + tradePnL;
        if (portfolio < 0)
            portfolio = 0;
        portfolioHistory.push(portfolio);
        reinvestmentHistory.push({
            tradeNum: i + 1,
            alertTime: trade.alertTime,
            pnl: trade.pnl,
            positionSize,
            tradeReturn: tradeReturn * 100,
            portfolioBefore,
            portfolioAfter: portfolio,
            movingAvgPortfolio,
        });
    }
    const finalPortfolio = portfolio;
    const compoundFactor = finalPortfolio / initialPortfolio;
    // Without reinvestment
    let simplePortfolio = initialPortfolio;
    for (const trade of sortedTrades) {
        const tradeReturn = trade.pnl - 1.0;
        simplePortfolio += fixedPositionSize * tradeReturn;
    }
    const simpleFinalPortfolio = Math.max(0, simplePortfolio);
    const simpleReturnPercent = ((simpleFinalPortfolio / initialPortfolio) - 1) * 100;
    // Risk metrics
    const { maxDrawdown, maxDrawdownPct } = computeMaxDrawdown(portfolioHistory);
    const perTradeReturns = sortedTrades.map(t => (t.pnl - 1.0) * 100);
    const stdDevReturnsPct = computeStdDev(perTradeReturns);
    // Per-trade max drawdown and risk ratio
    const perTradeMaxDrawdowns = [];
    const riskRatios = [];
    for (const trade of sortedTrades) {
        const maxGain = (trade.maxReached - 1.0) * 100;
        const maxLoss = Math.min(0, (trade.pnl - 1.0) * 100);
        const perTradeDD = Math.abs(maxLoss);
        perTradeMaxDrawdowns.push(perTradeDD);
        if (perTradeDD > 0) {
            const riskRatio = maxGain / perTradeDD;
            riskRatios.push(riskRatio);
        }
    }
    const avgPerTradeMaxDrawdown = perTradeMaxDrawdowns.length > 0
        ? perTradeMaxDrawdowns.reduce((a, b) => a + b, 0) / perTradeMaxDrawdowns.length
        : 0;
    const maxPerTradeMaxDrawdown = perTradeMaxDrawdowns.length > 0
        ? Math.max(...perTradeMaxDrawdowns)
        : 0;
    const avgRiskRatio = riskRatios.length > 0
        ? riskRatios.reduce((a, b) => a + b, 0) / riskRatios.length
        : 0;
    const sortedRiskRatios = [...riskRatios].sort((a, b) => a - b);
    const medianRiskRatio = sortedRiskRatios.length > 0
        ? sortedRiskRatios[Math.floor(sortedRiskRatios.length / 2)]
        : 0;
    // Time-weighted ROI
    const firstTradeTime = luxon_1.DateTime.fromISO(sortedTrades[0].alertTime);
    const lastTradeTime = luxon_1.DateTime.fromISO(sortedTrades[sortedTrades.length - 1].alertTime);
    const daysActive = lastTradeTime.diff(firstTradeTime, 'days').days || 1;
    const weeklyReturns = [];
    let currentWeekStart = firstTradeTime;
    let weekPortfolio = initialPortfolio;
    for (const trade of sortedTrades) {
        const tradeTime = luxon_1.DateTime.fromISO(trade.alertTime);
        if (tradeTime.diff(currentWeekStart, 'days').days >= 7) {
            if (weekPortfolio > 0) {
                const weekReturn = (portfolioHistory[portfolioHistory.length - 1] / weekPortfolio) - 1;
                weeklyReturns.push(weekReturn);
            }
            currentWeekStart = tradeTime;
            weekPortfolio = portfolioHistory[portfolioHistory.indexOf(trade.pnl) - 1] || initialPortfolio;
        }
    }
    const twrWeekly = weeklyReturns.length > 0
        ? weeklyReturns.reduce((prod, r) => prod * (1 + r), 1) - 1
        : compoundFactor - 1;
    const twrWeeklyPct = twrWeekly * 100;
    const twrDailyPct = (Math.pow(1 + twrWeekly, 1 / 7) - 1) * 100;
    const twrAnnualPct = (Math.pow(1 + twrWeekly, 52) - 1) * 100;
    // Save trade history
    const tradeHistoryPath = path.join(callerOutputDir, 'trade_history.csv');
    const tradeRows = sortedTrades.map(t => ({
        TokenAddress: t.tokenAddress,
        AlertTime: t.alertTime,
        EntryTime: t.entryTime,
        ExitTime: t.exitTime,
        PnL: t.pnl.toFixed(6),
        PnLPercent: t.pnlPercent.toFixed(2),
        MaxReached: t.maxReached.toFixed(4),
        HoldDurationMinutes: t.holdDuration,
        EntryPrice: t.entryPrice.toFixed(8),
    }));
    await new Promise((resolve, reject) => {
        (0, csv_stringify_1.stringify)(tradeRows, { header: true }, (err, output) => {
            if (err)
                reject(err);
            else {
                fs.writeFileSync(tradeHistoryPath, output);
                resolve();
            }
        });
    });
    // Save reinvestment history
    const reinvestmentPath = path.join(callerOutputDir, 'reinvestment_history.csv');
    const reinvestmentRows = reinvestmentHistory.map(r => ({
        TradeNumber: r.tradeNum,
        AlertTime: r.alertTime,
        PnL: r.pnl.toFixed(6),
        PositionSize: r.positionSize.toFixed(2),
        TradeReturn: r.tradeReturn.toFixed(2),
        PortfolioBefore: r.portfolioBefore.toFixed(2),
        PortfolioAfter: r.portfolioAfter.toFixed(2),
        MovingAvgPortfolio: r.movingAvgPortfolio.toFixed(2),
    }));
    await new Promise((resolve, reject) => {
        (0, csv_stringify_1.stringify)(reinvestmentRows, { header: true }, (err, output) => {
            if (err)
                reject(err);
            else {
                fs.writeFileSync(reinvestmentPath, output);
                resolve();
            }
        });
    });
    // Save summary
    const summaryPath = path.join(callerOutputDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
        caller: callerName,
        totalCalls: callerRecords.length,
        uniqueTokens: uniqueCalls.length,
        totalTrades: sortedTrades.length,
        winRate: winRate * 100,
        winningTrades,
        losingTrades,
        avgPnlPerTrade,
        finalPortfolio,
        compoundFactor,
        simpleFinalPortfolio,
        simpleReturnPercent,
        initialPortfolio,
        maxDrawdown,
        maxDrawdownPct,
        stdDevReturnsPct,
        peakPortfolio: Math.max(...portfolioHistory),
        avgPerTradeMaxDrawdown,
        maxPerTradeMaxDrawdown,
        avgRiskRatio,
        medianRiskRatio,
        daysActive,
        twrDailyPct,
        twrWeeklyPct,
        twrAnnualPct,
        riskAdjustedScore: stdDevReturnsPct > 0 ? twrDailyPct / stdDevReturnsPct : 0,
        clampMinPnlEnabled: CLAMP_MIN_PNL,
        minPnlFloor: MIN_PNL,
    }, null, 2));
    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ [${callerName}] ANALYSIS COMPLETE`);
    console.log(`${'='.repeat(80)}`);
    console.log(`\n📈 TRADE STATISTICS:`);
    console.log(`   Total Trades: ${sortedTrades.length}`);
    console.log(`   Winning Trades: ${winningTrades} (${(winRate * 100).toFixed(2)}%)`);
    console.log(`   Losing Trades: ${losingTrades} (${((losingTrades / sortedTrades.length) * 100).toFixed(2)}%)`);
    console.log(`   Average PnL per Trade: ${avgPnlPerTrade >= 0 ? '+' : ''}${avgPnlPerTrade.toFixed(2)}%`);
    console.log(`\n💰 PORTFOLIO PERFORMANCE:`);
    console.log(`   Initial Portfolio: $${initialPortfolio.toFixed(2)}`);
    console.log(`   Final Portfolio: $${finalPortfolio.toFixed(2)}`);
    console.log(`   Total Growth: ${compoundFactor.toFixed(4)}x`);
    console.log(`   Total Return: ${((compoundFactor - 1) * 100).toFixed(2)}%`);
    console.log(`\n📉 RISK METRICS:`);
    console.log(`   Portfolio Max Drawdown: $${maxDrawdown.toFixed(2)} (${maxDrawdownPct.toFixed(2)}%)`);
    console.log(`   Std Dev Returns: ${stdDevReturnsPct.toFixed(2)}%`);
    console.log(`\n🔒 LOSS CLAMP:`);
    console.log(`   Enabled: ${CLAMP_MIN_PNL ? 'YES ✅' : 'NO'}`);
    console.log(`   Min PnL Floor: ${MIN_PNL}x (-${((1 - MIN_PNL) * 100).toFixed(0)}% max loss)`);
    console.log(`${'='.repeat(80)}\n`);
}
async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🔬 TENKAN/KIJUN CROSS - WITH LOSS CLAMP ENABLED');
    console.log('📊 Running parallel analysis for each caller');
    console.log(`🔒 Loss Clamp: ${MIN_PNL}x (${((1 - MIN_PNL) * 100).toFixed(0)}% max loss)`);
    console.log(`${'='.repeat(80)}\n`);
    const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
    const records = await new Promise((resolve, reject) => {
        (0, csv_parse_1.parse)(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
            if (err)
                reject(err);
            else
                resolve(records);
        });
    });
    const callers = new Set();
    for (const record of records) {
        const sender = record.sender || '';
        if (sender && sender.trim()) {
            const cleanCaller = sender.split('\n')[0].trim();
            if (cleanCaller) {
                callers.add(cleanCaller);
            }
        }
    }
    const callerList = Array.from(callers).sort();
    console.log(`✅ Found ${callerList.length} unique callers\n`);
    console.log(`🚀 Starting parallel analysis for ${callerList.length} callers...\n`);
    const promises = callerList.map(caller => analyzeCaller(caller, records));
    await Promise.all(promises);
    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ ALL CALLER ANALYSES COMPLETE');
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Results saved to: ${OUTPUT_DIR}`);
    console.log(`Each caller has their own directory with trade history and reinvestment data.\n`);
}
main().catch(console.error);
//# sourceMappingURL=test-tenkan-kijun-with-loss-clamp.js.map