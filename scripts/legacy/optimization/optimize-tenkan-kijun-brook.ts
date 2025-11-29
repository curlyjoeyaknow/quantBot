#!/usr/bin/env ts-node
/**
 * Optimize Tenkan/Kijun Cross Strategy - BROOK CALLS ONLY
 * Tests different strategy parameters to find optimal settings for Brook's calls
 * Runs with and without loss clamp
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';
import {
  calculateIndicators,
  IndicatorData,
} from '../src/simulation/indicators';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

// Get caller name from command line argument or default to Brook
const CALLER_NAME = process.argv[2] || 'Brook';
const OUTPUT_DIR = path.join(__dirname, `../data/exports/tenkan-kijun-${CALLER_NAME.toLowerCase()}-optimization`);

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface StrategyParams {
  name: string;
  profitTargets: Array<{ target: number; percent: number }>;
  stopLossPercent: number; // e.g., 0.2 = 20% stop loss
  trailingStopPercent?: number;
  trailingStopActivation?: number; // e.g., 1.3 = activate after 30% gain
  exitOnTenkanKijunCrossDown: boolean;
  stopLossAtKijun: boolean;
  clampMinPnl: boolean;
  minPnlFloor: number;
}

interface TradeResult {
  tokenAddress: string;
  alertTime: string;
  entryTime: string;
  exitTime: string;
  pnl: number;
  pnlPercent: number;
  maxReached: number;
  holdDuration: number;
  entryPrice: number;
}

interface StrategyResult {
  strategy: string;
  params: StrategyParams;
  totalTrades: number;
  winRate: number;
  avgPnlPerTrade: number;
  finalPortfolio: number;
  compoundFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  stdDevReturns: number;
  riskAdjustedScore: number;
  sharpeRatio: number;
  avgPerTradeMaxDrawdown: number;
  avgRiskRatio: number;
  trades?: TradeResult[]; // Store trades for detailed analysis
  weeklyBreakdown?: Array<{
    weekStart: string;
    trades: number;
    portfolioStart: number;
    portfolioEnd: number;
    returnPercent: number;
    multiplier: number;
  }>; // Store weekly breakdown
}

function simulateTenkanKijunStrategy(
  candles: any[],
  alertTime: DateTime,
  params: StrategyParams
): { pnl: number; maxReached: number; holdDuration: number; entryTime: number; exitTime: number; entryPrice: number } | null {
  if (candles.length < 52) {
    return null;
  }

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

  if (sixHourIndex === 0 || candles.length - sixHourIndex < 52) {
    return null;
  }

  const indicatorData: IndicatorData[] = [];
  let previousEMAs: { ema9?: number | null; ema20?: number | null; ema50?: number | null } = {};
  
  for (let i = 0; i < candles.length; i++) {
    const indicators = calculateIndicators(candles, i, previousEMAs);
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

  const minExitPrice = actualEntryPrice * (1 - params.stopLossPercent);
  const targetsHit = new Set<number>();

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
      if (candleDurationMs <= 0) candleDurationMs = 60 * 60 * 1000;
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

    // Check Tenkan/Kijun cross down exit
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

    // Check profit targets
    for (const target of params.profitTargets) {
      const targetPrice = actualEntryPrice * target.target;
      if (!targetsHit.has(target.target) && remaining > 0 && effectiveHigh >= targetPrice) {
        const sellPercent = Math.min(target.percent, remaining);
        pnl += sellPercent * target.target;
        remaining -= sellPercent;
        targetsHit.add(target.target);
      }
    }

    // Stop loss at Kijun or fixed stop
    let currentStopPrice = minExitPrice;
    if (params.stopLossAtKijun && indicators.ichimoku) {
      currentStopPrice = Math.max(indicators.ichimoku.kijun, minExitPrice);
    }
    
    // Trailing stop
    if (
      params.trailingStopPercent &&
      params.trailingStopActivation &&
      remaining > 0 &&
      maxReached >= params.trailingStopActivation
    ) {
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

  // Apply loss clamp if enabled
  if (params.clampMinPnl && pnl < params.minPnlFloor) {
    pnl = params.minPnlFloor;
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

function computeMaxDrawdown(equity: number[]): { maxDrawdown: number; maxDrawdownPct: number } {
  if (equity.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPct: 0 };
  }

  let peak = equity[0];
  let maxDrawdown = 0;

  for (const v of equity) {
    if (v > peak) peak = v;
    const drawdown = peak - v;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
  return { maxDrawdown, maxDrawdownPct };
}

function computeStdDev(values: number[]): number {
  const n = values.length;
  if (n <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
  return Math.sqrt(variance);
}

function generateStrategies(): StrategyParams[] {
  const strategies: StrategyParams[] = [];

  // Base configurations
  const profitTargetConfigs = [
    [{ target: 1.5, percent: 0.5 }], // 50% at 1.5x
    [{ target: 2.0, percent: 0.5 }], // 50% at 2.0x
    [{ target: 1.5, percent: 0.33 }, { target: 2.0, percent: 0.33 }], // 33% at 1.5x, 33% at 2.0x
    [{ target: 2.0, percent: 0.5 }, { target: 3.0, percent: 0.25 }], // 50% at 2.0x, 25% at 3.0x
  ];

  const stopLossConfigs = [0.15, 0.2, 0.25]; // 15%, 20%, 25%

  const trailingStopConfigs = [
    { percent: 0.1, activation: 1.3 }, // 10% trailing after 30% gain
    { percent: 0.15, activation: 1.5 }, // 15% trailing after 50% gain
    { percent: 0.2, activation: 2.0 }, // 20% trailing after 100% gain
  ];

  const exitConfigs = [
    { exitOnCrossDown: true, stopLossAtKijun: true },
    { exitOnCrossDown: true, stopLossAtKijun: false },
    { exitOnCrossDown: false, stopLossAtKijun: true },
  ];

  const lossClampConfigs = [
    { clamp: false, floor: 0.8 },
    { clamp: true, floor: 0.8 },
    { clamp: true, floor: 0.85 },
  ];

  // Generate all combinations
  for (const profitTargets of profitTargetConfigs) {
    for (const stopLoss of stopLossConfigs) {
      for (const exitConfig of exitConfigs) {
        for (const lossClamp of lossClampConfigs) {
          // Without trailing stop
          strategies.push({
            name: `PT${profitTargets.map(pt => pt.target).join('-')}_SL${(stopLoss * 100).toFixed(0)}_${exitConfig.exitOnCrossDown ? 'ExitCross' : 'NoExitCross'}_${exitConfig.stopLossAtKijun ? 'KijunSL' : 'FixedSL'}_${lossClamp.clamp ? `Clamp${(lossClamp.floor * 100).toFixed(0)}` : 'NoClamp'}`,
            profitTargets,
            stopLossPercent: stopLoss,
            exitOnTenkanKijunCrossDown: exitConfig.exitOnCrossDown,
            stopLossAtKijun: exitConfig.stopLossAtKijun,
            clampMinPnl: lossClamp.clamp,
            minPnlFloor: lossClamp.floor,
          });

          // With trailing stop
          for (const trailingStop of trailingStopConfigs) {
            strategies.push({
              name: `PT${profitTargets.map(pt => pt.target).join('-')}_SL${(stopLoss * 100).toFixed(0)}_TS${(trailingStop.percent * 100).toFixed(0)}@${trailingStop.activation}_${exitConfig.exitOnCrossDown ? 'ExitCross' : 'NoExitCross'}_${exitConfig.stopLossAtKijun ? 'KijunSL' : 'FixedSL'}_${lossClamp.clamp ? `Clamp${(lossClamp.floor * 100).toFixed(0)}` : 'NoClamp'}`,
              profitTargets,
              stopLossPercent: stopLoss,
              trailingStopPercent: trailingStop.percent,
              trailingStopActivation: trailingStop.activation,
              exitOnTenkanKijunCrossDown: exitConfig.exitOnCrossDown,
              stopLossAtKijun: exitConfig.stopLossAtKijun,
              clampMinPnl: lossClamp.clamp,
              minPnlFloor: lossClamp.floor,
            });
          }
        }
      }
    }
  }

  return strategies;
}

async function optimizeStrategies() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔬 TENKAN/KIJUN OPTIMIZATION - ${CALLER_NAME.toUpperCase()} CALLS ONLY`);
  console.log(`${'='.repeat(80)}\n`);

  // Load calls
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  const callerRecords = records.filter(r => {
    const sender = r.sender || '';
    const cleanCaller = sender.split('\n')[0].trim();
    return cleanCaller === CALLER_NAME || cleanCaller.includes(CALLER_NAME);
  });

  const uniqueCalls: any[] = [];
  const seen = new Set<string>();

  for (const record of callerRecords) {
    const tokenAddress = record.tokenAddress || record.mint;
    const timestamp = record.timestamp || record.alertTime;
    const key = `${tokenAddress}-${timestamp}`;
    
    if (!seen.has(key) && tokenAddress && timestamp) {
      seen.add(key);
      uniqueCalls.push(record);
    }
  }

  console.log(`✅ Found ${uniqueCalls.length} unique ${CALLER_NAME} calls\n`);

  const strategies = generateStrategies();
  console.log(`📊 Testing ${strategies.length} strategy configurations...\n`);

  const results: StrategyResult[] = [];
  const initialPortfolio = 100;
  const positionSizePercent = 0.1;
  const movingAvgWindow = 7;

  const startTime = Date.now();

  for (let s = 0; s < strategies.length; s++) {
    const strategy = strategies[s];
    const currentTime = Date.now();
    const elapsed = (currentTime - startTime) / 1000; // seconds
    const avgTimePerStrategy = elapsed / (s + 1);
    const remaining = (strategies.length - s - 1) * avgTimePerStrategy;
    const elapsedMinutes = Math.floor(elapsed / 60);
    const elapsedSeconds = Math.floor(elapsed % 60);
    const remainingMinutes = Math.floor(remaining / 60);
    const remainingSeconds = Math.floor(remaining % 60);
    
    console.log(`\n[${s + 1}/${strategies.length}] Testing: ${strategy.name}`);
    if (s > 0 && s % 10 === 0) {
      console.log(`   ⏱️  Elapsed: ${elapsedMinutes}m ${elapsedSeconds}s | Est. remaining: ${remainingMinutes}m ${remainingSeconds}s`);
    }

    const trades: TradeResult[] = [];

    for (let i = 0; i < uniqueCalls.length; i++) {
      const call = uniqueCalls[i];
      try {
        const chain = call.chain || 'solana';
        const tokenAddress = call.tokenAddress || call.mint;
        if (!tokenAddress) continue;

        const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
        if (!alertTime.isValid) continue;

        const endTime = alertTime.plus({ days: 7 });

        process.env.USE_CACHE_ONLY = 'true'; // Use cache/ClickHouse only, no API calls
        const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
        delete process.env.USE_CACHE_ONLY;

        if (candles.length < 52) continue;

        const result = simulateTenkanKijunStrategy(candles, alertTime, strategy);
        if (!result) continue;

        trades.push({
          tokenAddress,
          alertTime: call.timestamp || call.alertTime || '',
          entryTime: DateTime.fromMillis(result.entryTime).toISO() || '',
          exitTime: DateTime.fromMillis(result.exitTime).toISO() || '',
          pnl: result.pnl,
          pnlPercent: (result.pnl - 1) * 100,
          maxReached: result.maxReached,
          holdDuration: result.holdDuration,
          entryPrice: result.entryPrice,
        });
      } catch (error) {
        // Skip errors
      }
    }

    if (trades.length === 0) {
      console.log(`   ⚠️  No trades generated`);
      continue;
    }

    const sortedTrades = trades.sort((a, b) => 
      DateTime.fromISO(a.alertTime).toMillis() - DateTime.fromISO(b.alertTime).toMillis()
    );

    const winningTrades = sortedTrades.filter(t => t.pnl > 1.0).length;
    const winRate = sortedTrades.length > 0 ? winningTrades / sortedTrades.length : 0;
    const totalPnl = sortedTrades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
    const avgPnlPerTrade = sortedTrades.length > 0 ? (totalPnl / sortedTrades.length) * 100 : 0;

    // Group trades by week for weekly breakdown
    const tradesByWeek = new Map<string, TradeResult[]>();
    for (const trade of sortedTrades) {
      const alertDate = DateTime.fromISO(trade.alertTime);
      if (alertDate.isValid) {
        // Get Monday of the week (ISO week starts on Monday)
        const weekStart = alertDate.startOf('week');
        const weekKey = weekStart.toFormat('yyyy-MM-dd');
        if (!tradesByWeek.has(weekKey)) {
          tradesByWeek.set(weekKey, []);
        }
        tradesByWeek.get(weekKey)!.push(trade);
      }
    }

    // Calculate reinvestment performance with weekly tracking
    let portfolio = initialPortfolio;
    const portfolioHistory: number[] = [portfolio];
    const portfolioValues: number[] = [portfolio];
    const weeklyBreakdown: Array<{
      weekStart: string;
      trades: number;
      portfolioStart: number;
      portfolioEnd: number;
      returnPercent: number;
      multiplier: number;
    }> = [];

    // Track current week for weekly breakdown
    let currentWeekKey: string | null = null;
    let weekPortfolioStart = portfolio;

    for (let i = 0; i < sortedTrades.length; i++) {
      const trade = sortedTrades[i];
      const portfolioBefore = portfolio;

      // Check if we've moved to a new week
      const alertDate = DateTime.fromISO(trade.alertTime);
      if (alertDate.isValid) {
        const weekStart = alertDate.startOf('week');
        const weekKey = weekStart.toFormat('yyyy-MM-dd');
        
        if (currentWeekKey !== null && weekKey !== currentWeekKey) {
          // Save previous week's results
          weeklyBreakdown.push({
            weekStart: currentWeekKey,
            trades: tradesByWeek.get(currentWeekKey)?.length || 0,
            portfolioStart: weekPortfolioStart,
            portfolioEnd: portfolioBefore,
            returnPercent: ((portfolioBefore / weekPortfolioStart - 1) * 100),
            multiplier: portfolioBefore / weekPortfolioStart,
          });
          weekPortfolioStart = portfolioBefore;
        }
        currentWeekKey = weekKey;
      }

      if (portfolioValues.length >= movingAvgWindow) {
        portfolioValues.shift();
      }
      portfolioValues.push(portfolioBefore);
      const movingAvgPortfolio = portfolioValues.reduce((a, b) => a + b, 0) / portfolioValues.length;

      const currentPositionSize = movingAvgPortfolio * positionSizePercent;
      const positionSize = Math.max(1, Math.min(currentPositionSize, portfolioBefore * 0.5));

      const tradeReturn = trade.pnl - 1.0;
      const tradePnL = positionSize * tradeReturn;
      portfolio = portfolioBefore + tradePnL;

      if (portfolio < 0) portfolio = 0;
      portfolioHistory.push(portfolio);
    }

    // Save final week's results
    if (currentWeekKey !== null) {
      weeklyBreakdown.push({
        weekStart: currentWeekKey,
        trades: tradesByWeek.get(currentWeekKey)?.length || 0,
        portfolioStart: weekPortfolioStart,
        portfolioEnd: portfolio,
        returnPercent: ((portfolio / weekPortfolioStart - 1) * 100),
        multiplier: portfolio / weekPortfolioStart,
      });
    }

    const finalPortfolio = portfolio;
    const compoundFactor = finalPortfolio / initialPortfolio;
    const { maxDrawdown, maxDrawdownPct } = computeMaxDrawdown(portfolioHistory);
    const perTradeReturns = sortedTrades.map(t => (t.pnl - 1.0) * 100);
    const stdDevReturns = computeStdDev(perTradeReturns);

    // Per-trade risk metrics
    const perTradeMaxDrawdowns: number[] = [];
    const riskRatios: number[] = [];

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
    const avgRiskRatio = riskRatios.length > 0
      ? riskRatios.reduce((a, b) => a + b, 0) / riskRatios.length
      : 0;

    const riskAdjustedScore = stdDevReturns > 0 ? (finalPortfolio / initialPortfolio - 1) / stdDevReturns : 0;
    
    // Calculate Sharpe ratio (annualized)
    const avgReturn = perTradeReturns.length > 0 ? perTradeReturns.reduce((a, b) => a + b, 0) / perTradeReturns.length : 0;
    const sharpeRatio = stdDevReturns > 0 ? (avgReturn / stdDevReturns) * Math.sqrt(252) : 0; // Annualized assuming daily trades

    results.push({
      strategy: strategy.name,
      params: strategy,
      totalTrades: sortedTrades.length,
      winRate: winRate * 100,
      avgPnlPerTrade,
      finalPortfolio,
      compoundFactor,
      maxDrawdown,
      maxDrawdownPct,
      stdDevReturns,
      riskAdjustedScore,
      sharpeRatio,
      avgPerTradeMaxDrawdown,
      avgRiskRatio,
      trades: sortedTrades, // Store trades for detailed export
      weeklyBreakdown, // Store weekly breakdown for export
    });

    console.log(`   ✅ Trades: ${sortedTrades.length} | Win Rate: ${(winRate * 100).toFixed(1)}% | Final: $${finalPortfolio.toFixed(2)} (${compoundFactor.toFixed(2)}x)`);
  }

  // Sort by final portfolio
  results.sort((a, b) => b.finalPortfolio - a.finalPortfolio);

  // Save results
  const resultsPath = path.join(OUTPUT_DIR, 'optimization_results.csv');
  const resultsRows = results.map(r => ({
    Strategy: r.strategy,
    TotalTrades: r.totalTrades,
    WinRate: r.winRate.toFixed(2),
    AvgPnlPerTrade: r.avgPnlPerTrade.toFixed(2),
    FinalPortfolio: r.finalPortfolio.toFixed(2),
    CompoundFactor: r.compoundFactor.toFixed(4),
    MaxDrawdown: r.maxDrawdown.toFixed(2),
    MaxDrawdownPct: r.maxDrawdownPct.toFixed(2),
    StdDevReturns: r.stdDevReturns.toFixed(2),
    RiskAdjustedScore: r.riskAdjustedScore.toFixed(4),
    AvgPerTradeMaxDrawdown: r.avgPerTradeMaxDrawdown.toFixed(2),
    AvgRiskRatio: r.avgRiskRatio.toFixed(2),
    SharpeRatio: r.sharpeRatio.toFixed(4),
    LossClampEnabled: r.params.clampMinPnl ? 'Yes' : 'No',
    MinPnlFloor: r.params.minPnlFloor,
  }));

  await new Promise<void>((resolve, reject) => {
    stringify(resultsRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(resultsPath, output);
        resolve();
      }
    });
  });

  // Save trade-by-trade results for top strategies (top 10 by default)
  const topN = Math.min(10, results.length);
  const topStrategies = results.slice(0, topN);
  const tradesPath = path.join(OUTPUT_DIR, 'trade_details_top10_strategies.csv');
  const tradeRows: any[] = [];

  for (const result of topStrategies) {
    if (result.trades && result.trades.length > 0) {
      for (const trade of result.trades) {
        // Calculate per-token max drawdown
        const maxGain = (trade.maxReached - 1.0) * 100;
        const maxLoss = Math.min(0, (trade.pnl - 1.0) * 100);
        const tokenMaxDrawdown = Math.abs(maxLoss);
        
        tradeRows.push({
          Strategy: result.strategy,
          TokenAddress: trade.tokenAddress,
          AlertTime: trade.alertTime,
          EntryTime: trade.entryTime,
          ExitTime: trade.exitTime,
          EntryPrice: trade.entryPrice.toFixed(8),
          PnL: trade.pnl.toFixed(4),
          PnLPercent: trade.pnlPercent.toFixed(2),
          MaxReached: trade.maxReached.toFixed(4),
          MaxGainPercent: maxGain.toFixed(2),
          TokenMaxDrawdownPercent: tokenMaxDrawdown.toFixed(2),
          HoldDurationHours: (trade.holdDuration / (1000 * 60 * 60)).toFixed(2),
        });
      }
    }
  }

  const hasTradeDetails = tradeRows.length > 0;
  if (hasTradeDetails) {
    await new Promise<void>((resolve, reject) => {
      stringify(tradeRows, { header: true }, (err, output) => {
        if (err) reject(err);
        else {
          fs.writeFileSync(tradesPath, output);
          console.log(`📊 Trade-by-trade details saved: ${tradeRows.length} trades from top ${topN} strategies`);
          resolve();
        }
      });
    });
  }

  // Save weekly breakdown for top strategies
  const weeklyPath = path.join(OUTPUT_DIR, 'weekly_breakdown_top10_strategies.csv');
  const weeklyRows: any[] = [];

  for (const result of topStrategies) {
    if (result.weeklyBreakdown && result.weeklyBreakdown.length > 0) {
      for (const week of result.weeklyBreakdown) {
        weeklyRows.push({
          Strategy: result.strategy,
          WeekStart: week.weekStart,
          Trades: week.trades,
          PortfolioStart: week.portfolioStart.toFixed(2),
          PortfolioEnd: week.portfolioEnd.toFixed(2),
          ReturnPercent: week.returnPercent.toFixed(2),
          Multiplier: week.multiplier.toFixed(4),
        });
      }
    }
  }

  const hasWeeklyDetails = weeklyRows.length > 0;
  if (hasWeeklyDetails) {
    await new Promise<void>((resolve, reject) => {
      stringify(weeklyRows, { header: true }, (err, output) => {
        if (err) reject(err);
        else {
          fs.writeFileSync(weeklyPath, output);
          console.log(`📅 Weekly breakdown saved: ${weeklyRows.length} weeks from top ${topN} strategies`);
          resolve();
        }
      });
    });
  }

  const totalTime = (Date.now() - startTime) / 1000;
  const totalMinutes = Math.floor(totalTime / 60);
  const totalSeconds = Math.floor(totalTime % 60);

  console.log(`\n${'='.repeat(80)}`);
  console.log('✅ OPTIMIZATION COMPLETE');
  console.log(`⏱️  Total time: ${totalMinutes}m ${totalSeconds}s (${totalTime.toFixed(1)}s)`);
  console.log(`📈 Average: ${(totalTime / strategies.length).toFixed(2)}s per strategy`);
  console.log(`${'='.repeat(80)}\n`);
  console.log(`📊 TOP 10 STRATEGIES BY FINAL PORTFOLIO:\n`);
  
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    console.log(`${i + 1}. ${r.strategy}`);
    console.log(`   Final Portfolio: $${r.finalPortfolio.toFixed(2)} (${r.compoundFactor.toFixed(2)}x)`);
    console.log(`   Win Rate: ${r.winRate.toFixed(1)}% | Trades: ${r.totalTrades}`);
    console.log(`   Max DD: ${r.maxDrawdownPct.toFixed(2)}% | Sharpe: ${r.sharpeRatio.toFixed(2)} | Risk Score: ${r.riskAdjustedScore.toFixed(2)}`);
    console.log(`   Loss Clamp: ${r.params.clampMinPnl ? 'Yes' : 'No'}\n`);
  }

  console.log(`\n📁 Strategy results saved to: ${resultsPath}`);
  if (hasTradeDetails) {
    console.log(`📊 Trade-by-trade details saved to: ${tradesPath}`);
  }
  if (hasWeeklyDetails) {
    console.log(`📅 Weekly breakdown saved to: ${weeklyPath}\n`);
  } else {
    console.log();
  }
}

optimizeStrategies().catch(console.error);

