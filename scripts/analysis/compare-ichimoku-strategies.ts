#!/usr/bin/env ts-node
/**
 * Compare Tenkan/Kijun Cross vs Cloud Cross Strategies
 * Also analyze performance in first 6 hours vs remaining period
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
const OUTPUT_DIR = path.join(__dirname, '../data/exports/ichimoku-comparison');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface StrategyResult {
  strategy: string;
  totalTrades: number;
  winRate: number;
  avgPnlPerTrade: number;
  finalPortfolio: number;
  compoundFactor: number;
  first6Hours: {
    trades: number;
    winRate: number;
    avgPnl: number;
    totalPnl: number;
  };
  remainingPeriod: {
    trades: number;
    winRate: number;
    avgPnl: number;
    totalPnl: number;
  };
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
  period: 'first6h' | 'remaining';
}

/**
 * Simulate Tenkan/Kijun cross strategy
 */
function simulateTenkanKijunStrategy(
  candles: any[],
  alertTime: DateTime
): { pnl: number; maxReached: number; holdDuration: number; entryTime: number; exitTime: number; entryPrice: number; period: 'first6h' | 'remaining' } | null {
  if (candles.length < 52) {
    return null;
  }

  // Calculate indicators
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

  const firstCandle = candles[0];
  const alertTimestamp = alertTime.toMillis();
  const sixHourMark = alertTimestamp + (6 * 60 * 60 * 1000);

  // Find Tenkan/Kijun cross entry
  let entryIndex = 0;
  
  for (let i = 52; i < candles.length; i++) {
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

  if (entryIndex === 0) {
    return null;
  }

  const actualEntryPrice = candles[entryIndex].close;
  const entryTime = candles[entryIndex].timestamp
    ? typeof candles[entryIndex].timestamp === 'number'
      ? candles[entryIndex].timestamp * 1000
      : new Date(candles[entryIndex].timestamp).getTime()
    : alertTimestamp;

  // Determine which period the entry falls into
  const entryPeriod: 'first6h' | 'remaining' = entryTime < sixHourMark ? 'first6h' : 'remaining';

  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = actualEntryPrice;
  let maxReached = 1.0;
  let exitTime = entryTime;
  let exited = false;

  const minExitPrice = actualEntryPrice * 0.8;

  // Simulate from entry point
  for (let i = entryIndex; i < candles.length; i++) {
    const candle = candles[i];
    const indicators = indicatorData[i];
    const previousIndicators = i > entryIndex ? indicatorData[i - 1] : null;
    
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp * 1000
        : new Date(candle.timestamp).getTime()
      : entryTime;

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

    // Profit target: 50% at 1.5x
    const targetPrice = actualEntryPrice * 1.5;
    if (remaining >= 0.5 && effectiveHigh >= targetPrice) {
      pnl += 0.5 * 1.5;
      remaining -= 0.5;
    }

    // Stop loss at Kijun
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

  // Final exit
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

  if (pnl < 0.8) {
    pnl = 0.8;
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
    period: entryPeriod,
  };
}

/**
 * Simulate Cloud Cross strategy (Senkou Span A/B)
 */
function simulateCloudCrossStrategy(
  candles: any[],
  alertTime: DateTime
): { pnl: number; maxReached: number; holdDuration: number; entryTime: number; exitTime: number; entryPrice: number; period: 'first6h' | 'remaining' } | null {
  if (candles.length < 52) {
    return null;
  }

  // Calculate indicators
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

  const firstCandle = candles[0];
  const alertTimestamp = alertTime.toMillis();
  const sixHourMark = alertTimestamp + (6 * 60 * 60 * 1000);

  // Find cloud cross entry (price crosses above cloud)
  let entryIndex = 0;
  
  for (let i = 52; i < candles.length; i++) {
    const indicators = indicatorData[i];
    const previousIndicators = i > 0 ? indicatorData[i - 1] : null;
    
    if (previousIndicators?.ichimoku && indicators.ichimoku) {
      // Entry: price crosses above cloud (was below or in cloud, now above)
      const wasBelowOrInCloud = previousIndicators.ichimoku.isBearish || previousIndicators.ichimoku.inCloud;
      const nowAboveCloud = indicators.ichimoku.isBullish;
      const price = candles[i].close;
      
      if (wasBelowOrInCloud && nowAboveCloud && price > indicators.ichimoku.cloudTop) {
        entryIndex = i;
        break;
      }
    }
  }

  if (entryIndex === 0) {
    return null;
  }

  const actualEntryPrice = candles[entryIndex].close;
  const entryTime = candles[entryIndex].timestamp
    ? typeof candles[entryIndex].timestamp === 'number'
      ? candles[entryIndex].timestamp * 1000
      : new Date(candles[entryIndex].timestamp).getTime()
    : alertTimestamp;

  // Determine which period the entry falls into
  const entryPeriod: 'first6h' | 'remaining' = entryTime < sixHourMark ? 'first6h' : 'remaining';

  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = actualEntryPrice;
  let maxReached = 1.0;
  let exitTime = entryTime;
  let exited = false;

  const minExitPrice = actualEntryPrice * 0.8;

  // Simulate from entry point
  for (let i = entryIndex; i < candles.length; i++) {
    const candle = candles[i];
    const indicators = indicatorData[i];
    const previousIndicators = i > entryIndex ? indicatorData[i - 1] : null;
    
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp * 1000
        : new Date(candle.timestamp).getTime()
      : entryTime;

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

    // Exit: price crosses below cloud
    if (previousIndicators?.ichimoku && indicators.ichimoku) {
      const wasAboveOrInCloud = previousIndicators.ichimoku.isBullish || previousIndicators.ichimoku.inCloud;
      const nowBelowCloud = indicators.ichimoku.isBearish;
      
      if (wasAboveOrInCloud && nowBelowCloud && remaining > 0) {
        const exitPrice = Math.max(effectiveLow, minExitPrice);
        pnl += remaining * (exitPrice / actualEntryPrice);
        remaining = 0;
        exitTime = candleTime;
        exited = true;
        break;
      }
    }

    // Profit target: 50% at 1.5x
    const targetPrice = actualEntryPrice * 1.5;
    if (remaining >= 0.5 && effectiveHigh >= targetPrice) {
      pnl += 0.5 * 1.5;
      remaining -= 0.5;
    }

    // Stop loss at cloud bottom
    let currentStopPrice = minExitPrice;
    if (indicators.ichimoku) {
      currentStopPrice = Math.max(indicators.ichimoku.cloudBottom, minExitPrice);
    }
    
    if (remaining > 0 && effectiveLow <= currentStopPrice) {
      pnl += remaining * (currentStopPrice / actualEntryPrice);
      remaining = 0;
      exitTime = candleTime;
      exited = true;
      break;
    }
  }

  // Final exit
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

  if (pnl < 0.8) {
    pnl = 0.8;
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
    period: entryPeriod,
  };
}

/**
 * Calculate reinvestment with weekly rebalancing
 */
function calculateReinvestmentPerformance(
  trades: TradeResult[],
  initialPortfolio: number = 100,
  stopLossPercent: number,
  maxRiskPerTrade: number = 0.02
): {
  finalPortfolio: number;
  compoundGrowthFactor: number;
  positionSizePercent: number;
} {
  const sortedTrades = trades.sort((a, b) => 
    DateTime.fromISO(a.alertTime).toMillis() - DateTime.fromISO(b.alertTime).toMillis()
  );

  if (sortedTrades.length === 0) {
    return {
      finalPortfolio: initialPortfolio,
      compoundGrowthFactor: 1.0,
      positionSizePercent: maxRiskPerTrade / stopLossPercent,
    };
  }

  const positionSizePercent = maxRiskPerTrade / stopLossPercent;
  let portfolio = initialPortfolio;

  // Group trades by week
  const tradesByWeek = new Map<string, TradeResult[]>();
  
  for (const trade of sortedTrades) {
    const tradeDate = DateTime.fromISO(trade.alertTime);
    if (!tradeDate.isValid) continue;
    
    const weekStart = tradeDate.startOf('week');
    const weekKey = weekStart.toISODate() || '';
    
    if (!tradesByWeek.has(weekKey)) {
      tradesByWeek.set(weekKey, []);
    }
    tradesByWeek.get(weekKey)!.push(trade);
  }

  // Process trades week by week
  const sortedWeeks = Array.from(tradesByWeek.entries()).sort((a, b) => 
    DateTime.fromISO(a[0]).toMillis() - DateTime.fromISO(b[0]).toMillis()
  );

  for (const [weekKey, weekTrades] of sortedWeeks) {
    const weeklyPositionSize = portfolio * positionSizePercent;
    let weeklyPnL = 0;
    
    for (const trade of weekTrades) {
      const tradeReturn = (trade.pnl - 1.0) * weeklyPositionSize;
      weeklyPnL += tradeReturn;
    }
    
    portfolio = portfolio + weeklyPnL;
  }

  return {
    finalPortfolio: portfolio,
    compoundGrowthFactor: portfolio / initialPortfolio,
    positionSizePercent,
  };
}

async function compareStrategies() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🔬 ICHIMOKU STRATEGY COMPARISON: Tenkan/Kijun vs Cloud Cross');
  console.log('📊 Also analyzing: First 6 Hours vs Remaining Period');
  console.log(`${'='.repeat(80)}\n`);

  // Load calls data
  console.log('📂 Loading calls data...');
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  // Get all unique calls
  const uniqueTokens = new Map<string, any>();
  for (const record of records) {
    const tokenAddress = record.tokenAddress || record.mint;
    const chain = record.chain || 'solana';
    if (!tokenAddress) continue;
    const key = `${chain}:${tokenAddress}`;
    if (!uniqueTokens.has(key)) {
      uniqueTokens.set(key, record);
    }
  }

  const uniqueCalls = Array.from(uniqueTokens.values());
  console.log(`✅ Found ${uniqueCalls.length} unique tokens\n`);

  const tenkanKijunTrades: TradeResult[] = [];
  const cloudCrossTrades: TradeResult[] = [];

  console.log('🔄 Processing tokens...\n');

  for (let i = 0; i < uniqueCalls.length; i++) {
    const call = uniqueCalls[i];
    try {
      const chain = call.chain || 'solana';
      const tokenAddress = call.tokenAddress || call.mint;
      if (!tokenAddress) continue;

      const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
      if (!alertTime.isValid) continue;

      const endTime = alertTime.plus({ days: 7 });

      process.env.USE_CACHE_ONLY = 'true';
      const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
      delete process.env.USE_CACHE_ONLY;

      if (candles.length < 52) continue;

      // Test Tenkan/Kijun strategy
      const tkResult = simulateTenkanKijunStrategy(candles, alertTime);
      if (tkResult) {
        tenkanKijunTrades.push({
          tokenAddress,
          alertTime: call.timestamp || call.alertTime || '',
          entryTime: DateTime.fromMillis(tkResult.entryTime).toISO() || '',
          exitTime: DateTime.fromMillis(tkResult.exitTime).toISO() || '',
          pnl: tkResult.pnl,
          pnlPercent: (tkResult.pnl - 1) * 100,
          maxReached: tkResult.maxReached,
          holdDuration: tkResult.holdDuration,
          period: tkResult.period,
        });
      }

      // Test Cloud Cross strategy
      const cloudResult = simulateCloudCrossStrategy(candles, alertTime);
      if (cloudResult) {
        cloudCrossTrades.push({
          tokenAddress,
          alertTime: call.timestamp || call.alertTime || '',
          entryTime: DateTime.fromMillis(cloudResult.entryTime).toISO() || '',
          exitTime: DateTime.fromMillis(cloudResult.exitTime).toISO() || '',
          pnl: cloudResult.pnl,
          pnlPercent: (cloudResult.pnl - 1) * 100,
          maxReached: cloudResult.maxReached,
          holdDuration: cloudResult.holdDuration,
          period: cloudResult.period,
        });
      }

      if ((i + 1) % 50 === 0) {
        console.log(`   Processed ${i + 1}/${uniqueCalls.length} tokens...`);
      }
    } catch (error) {
      // Skip errors
    }
  }

  console.log(`\n✅ Processed ${uniqueCalls.length} tokens\n`);

  // Analyze Tenkan/Kijun strategy
  const tkFirst6h = tenkanKijunTrades.filter(t => t.period === 'first6h');
  const tkRemaining = tenkanKijunTrades.filter(t => t.period === 'remaining');

  const tkResult: StrategyResult = {
    strategy: 'Tenkan/Kijun Cross',
    totalTrades: tenkanKijunTrades.length,
    winRate: tenkanKijunTrades.length > 0 
      ? tenkanKijunTrades.filter(t => t.pnl > 1.0).length / tenkanKijunTrades.length * 100
      : 0,
    avgPnlPerTrade: tenkanKijunTrades.length > 0
      ? tenkanKijunTrades.reduce((sum, t) => sum + (t.pnl - 1.0), 0) / tenkanKijunTrades.length * 100
      : 0,
    finalPortfolio: 0,
    compoundFactor: 0,
    first6Hours: {
      trades: tkFirst6h.length,
      winRate: tkFirst6h.length > 0 ? tkFirst6h.filter(t => t.pnl > 1.0).length / tkFirst6h.length * 100 : 0,
      avgPnl: tkFirst6h.length > 0 ? tkFirst6h.reduce((sum, t) => sum + (t.pnl - 1.0), 0) / tkFirst6h.length * 100 : 0,
      totalPnl: tkFirst6h.reduce((sum, t) => sum + (t.pnl - 1.0), 0) * 100,
    },
    remainingPeriod: {
      trades: tkRemaining.length,
      winRate: tkRemaining.length > 0 ? tkRemaining.filter(t => t.pnl > 1.0).length / tkRemaining.length * 100 : 0,
      avgPnl: tkRemaining.length > 0 ? tkRemaining.reduce((sum, t) => sum + (t.pnl - 1.0), 0) / tkRemaining.length * 100 : 0,
      totalPnl: tkRemaining.reduce((sum, t) => sum + (t.pnl - 1.0), 0) * 100,
    },
  };

  const tkReinvestment = calculateReinvestmentPerformance(tenkanKijunTrades, 100, 0.2, 0.02);
  tkResult.finalPortfolio = tkReinvestment.finalPortfolio;
  tkResult.compoundFactor = tkReinvestment.compoundGrowthFactor;

  // Analyze Cloud Cross strategy
  const cloudFirst6h = cloudCrossTrades.filter(t => t.period === 'first6h');
  const cloudRemaining = cloudCrossTrades.filter(t => t.period === 'remaining');

  const cloudResult: StrategyResult = {
    strategy: 'Cloud Cross',
    totalTrades: cloudCrossTrades.length,
    winRate: cloudCrossTrades.length > 0 
      ? cloudCrossTrades.filter(t => t.pnl > 1.0).length / cloudCrossTrades.length * 100
      : 0,
    avgPnlPerTrade: cloudCrossTrades.length > 0
      ? cloudCrossTrades.reduce((sum, t) => sum + (t.pnl - 1.0), 0) / cloudCrossTrades.length * 100
      : 0,
    finalPortfolio: 0,
    compoundFactor: 0,
    first6Hours: {
      trades: cloudFirst6h.length,
      winRate: cloudFirst6h.length > 0 ? cloudFirst6h.filter(t => t.pnl > 1.0).length / cloudFirst6h.length * 100 : 0,
      avgPnl: cloudFirst6h.length > 0 ? cloudFirst6h.reduce((sum, t) => sum + (t.pnl - 1.0), 0) / cloudFirst6h.length * 100 : 0,
      totalPnl: cloudFirst6h.reduce((sum, t) => sum + (t.pnl - 1.0), 0) * 100,
    },
    remainingPeriod: {
      trades: cloudRemaining.length,
      winRate: cloudRemaining.length > 0 ? cloudRemaining.filter(t => t.pnl > 1.0).length / cloudRemaining.length * 100 : 0,
      avgPnl: cloudRemaining.length > 0 ? cloudRemaining.reduce((sum, t) => sum + (t.pnl - 1.0), 0) / cloudRemaining.length * 100 : 0,
      totalPnl: cloudRemaining.reduce((sum, t) => sum + (t.pnl - 1.0), 0) * 100,
    },
  };

  const cloudReinvestment = calculateReinvestmentPerformance(cloudCrossTrades, 100, 0.2, 0.02);
  cloudResult.finalPortfolio = cloudReinvestment.finalPortfolio;
  cloudResult.compoundFactor = cloudReinvestment.compoundGrowthFactor;

  // Display results
  console.log(`${'='.repeat(80)}`);
  console.log('📊 STRATEGY COMPARISON RESULTS');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Strategy | Total Trades | Win Rate | Avg PnL | Final Portfolio | Compound');
  console.log('-'.repeat(80));
  console.log(
    `${tkResult.strategy.padEnd(20)} | ` +
    `${tkResult.totalTrades.toString().padStart(12)} | ` +
    `${tkResult.winRate.toFixed(1).padStart(8)}% | ` +
    `${tkResult.avgPnlPerTrade >= 0 ? '+' : ''}${tkResult.avgPnlPerTrade.toFixed(2).padStart(6)}% | ` +
    `$${tkResult.finalPortfolio.toFixed(2).padStart(13)} | ` +
    `${tkResult.compoundFactor.toFixed(2)}x`
  );
  console.log(
    `${cloudResult.strategy.padEnd(20)} | ` +
    `${cloudResult.totalTrades.toString().padStart(12)} | ` +
    `${cloudResult.winRate.toFixed(1).padStart(8)}% | ` +
    `${cloudResult.avgPnlPerTrade >= 0 ? '+' : ''}${cloudResult.avgPnlPerTrade.toFixed(2).padStart(6)}% | ` +
    `$${cloudResult.finalPortfolio.toFixed(2).padStart(13)} | ` +
    `${cloudResult.compoundFactor.toFixed(2)}x`
  );

  console.log(`\n${'='.repeat(80)}`);
  console.log('⏰ FIRST 6 HOURS vs REMAINING PERIOD ANALYSIS');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Tenkan/Kijun Cross:');
  console.log(`  First 6 Hours:  ${tkResult.first6Hours.trades} trades | ${tkResult.first6Hours.winRate.toFixed(1)}% win rate | ${tkResult.first6Hours.avgPnl >= 0 ? '+' : ''}${tkResult.first6Hours.avgPnl.toFixed(2)}% avg PnL`);
  console.log(`  Remaining:     ${tkResult.remainingPeriod.trades} trades | ${tkResult.remainingPeriod.winRate.toFixed(1)}% win rate | ${tkResult.remainingPeriod.avgPnl >= 0 ? '+' : ''}${tkResult.remainingPeriod.avgPnl.toFixed(2)}% avg PnL`);

  console.log('\nCloud Cross:');
  console.log(`  First 6 Hours:  ${cloudResult.first6Hours.trades} trades | ${cloudResult.first6Hours.winRate.toFixed(1)}% win rate | ${cloudResult.first6Hours.avgPnl >= 0 ? '+' : ''}${cloudResult.first6Hours.avgPnl.toFixed(2)}% avg PnL`);
  console.log(`  Remaining:     ${cloudResult.remainingPeriod.trades} trades | ${cloudResult.remainingPeriod.winRate.toFixed(1)}% win rate | ${cloudResult.remainingPeriod.avgPnl >= 0 ? '+' : ''}${cloudResult.remainingPeriod.avgPnl.toFixed(2)}% avg PnL`);

  // Save results
  const summaryPath = path.join(OUTPUT_DIR, 'ichimoku_comparison.csv');
  const csvRows = [
    {
      Strategy: tkResult.strategy,
      TotalTrades: tkResult.totalTrades,
      WinRate: tkResult.winRate.toFixed(2),
      AvgPnlPerTrade: tkResult.avgPnlPerTrade.toFixed(2),
      FinalPortfolio: tkResult.finalPortfolio.toFixed(2),
      CompoundFactor: tkResult.compoundFactor.toFixed(4),
      First6hTrades: tkResult.first6Hours.trades,
      First6hWinRate: tkResult.first6Hours.winRate.toFixed(2),
      First6hAvgPnl: tkResult.first6Hours.avgPnl.toFixed(2),
      RemainingTrades: tkResult.remainingPeriod.trades,
      RemainingWinRate: tkResult.remainingPeriod.winRate.toFixed(2),
      RemainingAvgPnl: tkResult.remainingPeriod.avgPnl.toFixed(2),
    },
    {
      Strategy: cloudResult.strategy,
      TotalTrades: cloudResult.totalTrades,
      WinRate: cloudResult.winRate.toFixed(2),
      AvgPnlPerTrade: cloudResult.avgPnlPerTrade.toFixed(2),
      FinalPortfolio: cloudResult.finalPortfolio.toFixed(2),
      CompoundFactor: cloudResult.compoundFactor.toFixed(4),
      First6hTrades: cloudResult.first6Hours.trades,
      First6hWinRate: cloudResult.first6Hours.winRate.toFixed(2),
      First6hAvgPnl: cloudResult.first6Hours.avgPnl.toFixed(2),
      RemainingTrades: cloudResult.remainingPeriod.trades,
      RemainingWinRate: cloudResult.remainingPeriod.winRate.toFixed(2),
      RemainingAvgPnl: cloudResult.remainingPeriod.avgPnl.toFixed(2),
    },
  ];

  await new Promise<void>((resolve, reject) => {
    stringify(csvRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(summaryPath, output);
        resolve();
      }
    });
  });

  console.log(`\n✅ Results saved to: ${summaryPath}\n`);
}

compareStrategies().catch(console.error);

