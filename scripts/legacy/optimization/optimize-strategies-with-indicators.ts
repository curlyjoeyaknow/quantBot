#!/usr/bin/env ts-node
/**
 * Strategy Optimization with Technical Indicators
 * 
 * Tests strategies that use:
 * - Ichimoku Cloud for entry/exit signals
 * - Moving Averages (SMA/EMA) for trend confirmation
 * - Indicator-based stop losses
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
  isBullishEntry,
  isBearishExit,
  getBullishSignals,
  getBearishSignals,
} from '../src/simulation/indicators';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/indicator-strategy-optimization');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface IndicatorStrategyParams {
  name: string;
  
  // Entry conditions
  requireIchimokuBullish?: boolean; // Price must be above cloud
  requireIchimokuCloudCross?: boolean; // Must cross above cloud
  requireTenkanKijunCross?: boolean; // Tenkan must cross above Kijun
  requirePriceAboveSMA20?: boolean; // Price above SMA(20)
  requirePriceAboveEMA20?: boolean; // Price above EMA(20)
  requireGoldenCross?: boolean; // EMA(9) crosses above EMA(20)
  
  // Exit conditions
  exitOnIchimokuBearish?: boolean; // Exit when price goes below cloud
  exitOnIchimokuCloudCrossDown?: boolean; // Exit on cloud cross down
  exitOnTenkanKijunCrossDown?: boolean; // Exit on Tenkan/Kijun cross down
  exitOnPriceBelowSMA20?: boolean; // Exit when price breaks SMA(20)
  exitOnPriceBelowEMA20?: boolean; // Exit when price breaks EMA(20)
  exitOnDeathCross?: boolean; // Exit on death cross
  
  // Stop loss based on indicators
  stopLossAtCloudBottom?: boolean; // Stop loss at cloud bottom
  stopLossAtSMA20?: boolean; // Stop loss at SMA(20)
  stopLossAtKijun?: boolean; // Stop loss at Kijun-sen
  
  // Traditional strategy params (still supported)
  profitTargets: Array<{ target: number; percent: number }>;
  trailingStopPercent?: number;
  trailingStopActivation?: number;
  minExitPrice: number; // Fallback stop loss
}

interface TradeResult {
  tokenAddress: string;
  alertTime: string;
  pnl: number;
  pnlPercent: number;
  maxReached: number;
  holdDuration: number;
  entryReason: string;
  exitReason: string;
}

interface StrategyResult {
  params: IndicatorStrategyParams;
  totalPnl: number;
  totalPnlPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  trades: TradeResult[];
}

/**
 * Check if entry conditions are met
 */
function checkEntryConditions(
  indicators: IndicatorData,
  previousIndicators: IndicatorData | null,
  params: IndicatorStrategyParams
): { canEnter: boolean; reason: string } {
  const reasons: string[] = [];
  
  // Ichimoku conditions
  if (params.requireIchimokuBullish && indicators.ichimoku) {
    if (!indicators.ichimoku.isBullish) {
      return { canEnter: false, reason: 'Price not above Ichimoku cloud' };
    }
    reasons.push('Price above cloud');
  }
  
  if (params.requireIchimokuCloudCross && previousIndicators?.ichimoku && indicators.ichimoku) {
    const crossedUp = !previousIndicators.ichimoku.isBullish && indicators.ichimoku.isBullish;
    if (!crossedUp) {
      return { canEnter: false, reason: 'No cloud cross up' };
    }
    reasons.push('Cloud cross up');
  }
  
  if (params.requireTenkanKijunCross && previousIndicators?.ichimoku && indicators.ichimoku) {
    const crossedUp = previousIndicators.ichimoku.tenkan <= previousIndicators.ichimoku.kijun &&
                      indicators.ichimoku.tenkan > indicators.ichimoku.kijun;
    if (!crossedUp) {
      return { canEnter: false, reason: 'No Tenkan/Kijun cross up' };
    }
    reasons.push('Tenkan/Kijun cross up');
  }
  
  // Moving average conditions
  if (params.requirePriceAboveSMA20) {
    if (!indicators.movingAverages.sma20 || indicators.candle.close <= indicators.movingAverages.sma20) {
      return { canEnter: false, reason: 'Price not above SMA(20)' };
    }
    reasons.push('Price above SMA(20)');
  }
  
  if (params.requirePriceAboveEMA20) {
    if (!indicators.movingAverages.ema20 || indicators.candle.close <= indicators.movingAverages.ema20) {
      return { canEnter: false, reason: 'Price not above EMA(20)' };
    }
    reasons.push('Price above EMA(20)');
  }
  
  if (params.requireGoldenCross && previousIndicators) {
    const goldenCross = isBullishEntry(indicators, previousIndicators);
    if (!goldenCross) {
      return { canEnter: false, reason: 'No golden cross' };
    }
    reasons.push('Golden cross');
  }
  
  return { canEnter: true, reason: reasons.join(', ') || 'Entry conditions met' };
}

/**
 * Check if exit conditions are met
 */
function checkExitConditions(
  indicators: IndicatorData,
  previousIndicators: IndicatorData | null,
  params: IndicatorStrategyParams
): { shouldExit: boolean; reason: string } {
  const reasons: string[] = [];
  
  // Ichimoku exit conditions
  if (params.exitOnIchimokuBearish && indicators.ichimoku) {
    if (indicators.ichimoku.isBearish) {
      return { shouldExit: true, reason: 'Price below Ichimoku cloud' };
    }
  }
  
  if (params.exitOnIchimokuCloudCrossDown && previousIndicators?.ichimoku && indicators.ichimoku) {
    const crossedDown = previousIndicators.ichimoku.isBullish && indicators.ichimoku.isBearish;
    if (crossedDown) {
      return { shouldExit: true, reason: 'Cloud cross down' };
    }
  }
  
  if (params.exitOnTenkanKijunCrossDown && previousIndicators?.ichimoku && indicators.ichimoku) {
    const crossedDown = previousIndicators.ichimoku.tenkan >= previousIndicators.ichimoku.kijun &&
                        indicators.ichimoku.tenkan < indicators.ichimoku.kijun;
    if (crossedDown) {
      return { shouldExit: true, reason: 'Tenkan/Kijun cross down' };
    }
  }
  
  // Moving average exit conditions
  if (params.exitOnPriceBelowSMA20 && indicators.movingAverages.sma20) {
    if (indicators.candle.close < indicators.movingAverages.sma20) {
      return { shouldExit: true, reason: 'Price below SMA(20)' };
    }
  }
  
  if (params.exitOnPriceBelowEMA20 && indicators.movingAverages.ema20) {
    if (indicators.candle.close < indicators.movingAverages.ema20) {
      return { shouldExit: true, reason: 'Price below EMA(20)' };
    }
  }
  
  if (params.exitOnDeathCross && previousIndicators) {
    const deathCross = isBearishExit(indicators, previousIndicators);
    if (deathCross) {
      return { shouldExit: true, reason: 'Death cross' };
    }
  }
  
  return { shouldExit: false, reason: '' };
}

/**
 * Get dynamic stop loss price based on indicators
 */
function getDynamicStopLoss(
  indicators: IndicatorData,
  params: IndicatorStrategyParams,
  entryPrice: number
): number {
  let stopPrice = entryPrice * params.minExitPrice; // Default stop loss
  
  if (params.stopLossAtCloudBottom && indicators.ichimoku) {
    stopPrice = Math.max(stopPrice, indicators.ichimoku.cloudBottom);
  }
  
  if (params.stopLossAtSMA20 && indicators.movingAverages.sma20) {
    stopPrice = Math.max(stopPrice, indicators.movingAverages.sma20);
  }
  
  if (params.stopLossAtKijun && indicators.ichimoku) {
    stopPrice = Math.max(stopPrice, indicators.ichimoku.kijun);
  }
  
  return stopPrice;
}

/**
 * Simulate strategy with indicators
 */
function simulateStrategyWithIndicators(
  candles: any[],
  params: IndicatorStrategyParams
): { pnl: number; maxReached: number; holdDuration: number; entryReason: string; exitReason: string } {
  if (candles.length < 52) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryReason: 'Insufficient data',
      exitReason: 'Insufficient data',
    };
  }

  const entryPrice = candles[0].close;
  const firstCandle = candles[0];
  const entryTime = firstCandle.timestamp
    ? typeof firstCandle.timestamp === 'number'
      ? firstCandle.timestamp
      : new Date(firstCandle.timestamp).getTime()
    : firstCandle.time
    ? typeof firstCandle.time === 'number'
      ? firstCandle.time
      : new Date(firstCandle.time).getTime()
    : Date.now();

  // Calculate indicators for all candles
  const indicatorData: IndicatorData[] = [];
  let previousEMAs: { ema9?: number | null; ema20?: number | null; ema50?: number | null } = {};
  
  for (let i = 0; i < candles.length; i++) {
    const indicators = calculateIndicators(candles, i, previousEMAs);
    indicatorData.push(indicators);
    
    // Update EMAs for next iteration
    previousEMAs = {
      ema9: indicators.movingAverages.ema9,
      ema20: indicators.movingAverages.ema20,
      ema50: indicators.movingAverages.ema50,
    };
  }

  // Find entry point (wait for indicator conditions)
  let entryIndex = 0;
  let entryReason = 'Immediate entry';
  
  for (let i = 52; i < candles.length; i++) {
    const indicators = indicatorData[i];
    const previousIndicators = i > 0 ? indicatorData[i - 1] : null;
    
    const entryCheck = checkEntryConditions(indicators, previousIndicators, params);
    if (entryCheck.canEnter) {
      entryIndex = i;
      entryReason = entryCheck.reason;
      break;
    }
  }

  // If no entry found, skip trade
  if (entryIndex === 0 && entryReason === 'Immediate entry') {
    // Check if we can enter immediately (no requirements)
    const hasAnyRequirement = 
      params.requireIchimokuBullish ||
      params.requireIchimokuCloudCross ||
      params.requireTenkanKijunCross ||
      params.requirePriceAboveSMA20 ||
      params.requirePriceAboveEMA20 ||
      params.requireGoldenCross;
    
    if (hasAnyRequirement) {
      return {
        pnl: params.minExitPrice,
        maxReached: 1.0,
        holdDuration: 0,
        entryReason: 'Entry conditions never met',
        exitReason: 'No entry',
      };
    }
  }

  const actualEntryPrice = candles[entryIndex].close;
  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = actualEntryPrice;
  let maxReached = 1.0;
  let exitTime = entryTime;
  let exitReason = 'Final exit';
  let exited = false;

  const targetsHit = new Set<number>();
  const minExitPrice = actualEntryPrice * params.minExitPrice;

  // Simulate from entry point
  for (let i = entryIndex; i < candles.length; i++) {
    const candle = candles[i];
    const indicators = indicatorData[i];
    const previousIndicators = i > entryIndex ? indicatorData[i - 1] : null;
    
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp
        : new Date(candle.timestamp).getTime()
      : candle.time
      ? typeof candle.time === 'number'
        ? candle.time
        : new Date(candle.time).getTime()
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

    // Check exit conditions
    const exitCheck = checkExitConditions(indicators, previousIndicators, params);
    if (exitCheck.shouldExit && remaining > 0) {
      const exitPrice = Math.max(effectiveLow, minExitPrice);
      pnl += remaining * (exitPrice / actualEntryPrice);
      remaining = 0;
      exitTime = candleTime;
      exitReason = exitCheck.reason;
      exited = true;
      break;
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

    // Dynamic stop loss
    const dynamicStop = getDynamicStopLoss(indicators, params, actualEntryPrice);
    const currentStopPrice = Math.max(dynamicStop, minExitPrice);
    
    if (remaining > 0 && effectiveLow <= currentStopPrice) {
      pnl += remaining * (currentStopPrice / actualEntryPrice);
      remaining = 0;
      exitTime = candleTime;
      exitReason = 'Dynamic stop loss';
      exited = true;
      break;
    }

    // Trailing stop
    if (
      params.trailingStopPercent &&
      params.trailingStopActivation &&
      remaining > 0 &&
      maxReached >= params.trailingStopActivation
    ) {
      const trailingStopPrice = highestPrice * (1 - params.trailingStopPercent);
      const actualStopPrice = Math.max(trailingStopPrice, currentStopPrice);

      if (effectiveLow <= actualStopPrice) {
        pnl += remaining * (actualStopPrice / actualEntryPrice);
        remaining = 0;
        exitTime = candleTime;
        exitReason = 'Trailing stop';
        exited = true;
        break;
      }
    }
  }

  // Final exit
  if (remaining > 0) {
    const finalPrice = candles[candles.length - 1].close;
    const exitPrice = Math.max(finalPrice, minExitPrice);
    pnl += remaining * (exitPrice / actualEntryPrice);
    exitTime = candles[candles.length - 1].timestamp
      ? typeof candles[candles.length - 1].timestamp === 'number'
        ? candles[candles.length - 1].timestamp
        : new Date(candles[candles.length - 1].timestamp).getTime()
      : entryTime;
    exited = true;
  }

  if (pnl < params.minExitPrice) {
    pnl = params.minExitPrice;
  }

  const holdDurationMinutes = exited
    ? Math.max(0, Math.floor((exitTime - entryTime) / 60))
    : 0;

  return {
    pnl,
    maxReached,
    holdDuration: holdDurationMinutes,
    entryReason,
    exitReason,
  };
}

/**
 * Generate indicator-based strategies
 */
function generateIndicatorStrategies(): IndicatorStrategyParams[] {
  const strategies: IndicatorStrategyParams[] = [];
  let idx = 0;

  // Strategy 1: Ichimoku Cloud Entry
  strategies.push({
    name: `Ichimoku_Cloud_Entry_${idx++}`,
    requireIchimokuBullish: true,
    requireIchimokuCloudCross: true,
    exitOnIchimokuCloudCrossDown: true,
    stopLossAtCloudBottom: true,
    profitTargets: [
      { target: 2.0, percent: 0.30 },
      { target: 3.0, percent: 0.20 },
    ],
    trailingStopPercent: 0.30,
    trailingStopActivation: 3.0,
    minExitPrice: 0.7,
  });

  // Strategy 2: Golden Cross Entry
  strategies.push({
    name: `Golden_Cross_Entry_${idx++}`,
    requireGoldenCross: true,
    requirePriceAboveEMA20: true,
    exitOnDeathCross: true,
    exitOnPriceBelowEMA20: true,
    stopLossAtSMA20: true,
    profitTargets: [
      { target: 1.5, percent: 0.30 },
      { target: 2.0, percent: 0.30 },
    ],
    minExitPrice: 0.8,
  });

  // Strategy 3: Ichimoku + MA Combined
  strategies.push({
    name: `Ichimoku_MA_Combined_${idx++}`,
    requireIchimokuBullish: true,
    requirePriceAboveSMA20: true,
    exitOnIchimokuCloudCrossDown: true,
    exitOnPriceBelowSMA20: true,
    stopLossAtCloudBottom: true,
    profitTargets: [
      { target: 2.0, percent: 0.40 },
    ],
    trailingStopPercent: 0.25,
    trailingStopActivation: 2.0,
    minExitPrice: 0.75,
  });

  // Strategy 4: Tenkan/Kijun Cross Entry
  strategies.push({
    name: `Tenkan_Kijun_Cross_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    minExitPrice: 0.8,
  });

  // Strategy 5: Conservative Ichimoku
  strategies.push({
    name: `Conservative_Ichimoku_${idx++}`,
    requireIchimokuBullish: true,
    requireIchimokuCloudCross: true,
    requirePriceAboveSMA20: true,
    exitOnIchimokuCloudCrossDown: true,
    exitOnPriceBelowSMA20: true,
    stopLossAtCloudBottom: true,
    profitTargets: [
      { target: 1.3, percent: 0.30 },
      { target: 1.6, percent: 0.30 },
    ],
    minExitPrice: 0.85,
  });

  return strategies;
}

/**
 * Calculate metrics
 */
function calculateMetrics(trades: TradeResult[]): Omit<StrategyResult, 'params' | 'trades'> {
  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.pnl > 1.0).length;
  const losingTrades = trades.filter((t) => t.pnl <= 1.0).length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

  const wins = trades.filter((t) => t.pnl > 1.0).map((t) => t.pnl - 1.0);
  const losses = trades.filter((t) => t.pnl <= 1.0).map((t) => 1.0 - t.pnl);

  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
  const totalPnlPercent = totalTrades > 0 ? (totalPnl / totalTrades) * 100 : 0;

  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalLosses = losses.reduce((a, b) => a + b, 0);
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

  return {
    totalPnl,
    totalPnlPercent,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
  };
}

async function optimizeIndicatorStrategies() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 INDICATOR-BASED STRATEGY OPTIMIZATION');
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

  const TARGET_CALLER = 'Brook Giga I verify @BrookCalls';
  const brookGigaCalls = records.filter(record => {
    const caller = (record.sender || record.caller || '').trim();
    return caller === TARGET_CALLER || caller.toLowerCase().includes('brook giga');
  });

  // Deduplicate
  const uniqueTokens = new Map<string, any>();
  for (const record of brookGigaCalls) {
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

  // Generate strategies
  const strategies = generateIndicatorStrategies();
  console.log(`🧪 Testing ${strategies.length} indicator-based strategies\n`);

  const results: StrategyResult[] = [];

  // Test each strategy
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    console.log(`[${i + 1}/${strategies.length}] Testing: ${strategy.name}`);

    const trades: TradeResult[] = [];

    for (const call of uniqueCalls) { // Test on full dataset
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

        if (candles.length < 52) continue; // Need at least 52 candles for Ichimoku

        const result = simulateStrategyWithIndicators(candles, strategy);

        trades.push({
          tokenAddress,
          alertTime: call.timestamp || call.alertTime || '',
          pnl: result.pnl,
          pnlPercent: (result.pnl - 1) * 100,
          maxReached: result.maxReached,
          holdDuration: result.holdDuration,
          entryReason: result.entryReason,
          exitReason: result.exitReason,
        });
      } catch (error) {
        // Skip errors
      }
    }

    if (trades.length === 0) continue;

    const metrics = calculateMetrics(trades);
    results.push({
      params: strategy,
      ...metrics,
      trades,
    });

    console.log(`   Win Rate: ${(metrics.winRate * 100).toFixed(1)}% | Avg PnL: ${metrics.totalPnlPercent.toFixed(2)}% | Trades: ${metrics.totalTrades}\n`);
  }

  // Sort by win rate
  results.sort((a, b) => b.winRate - a.winRate);

  // Display results
  console.log(`\n${'='.repeat(80)}`);
  console.log('🏆 TOP INDICATOR-BASED STRATEGIES');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Rank | Win Rate | Avg PnL | Trades | Strategy');
  console.log('-'.repeat(80));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(
      `${(i + 1).toString().padStart(4)} | ` +
      `${(r.winRate * 100).toFixed(1).padStart(7)}% | ` +
      `${r.totalPnlPercent >= 0 ? '+' : ''}${r.totalPnlPercent.toFixed(2).padStart(6)}% | ` +
      `${r.totalTrades.toString().padStart(6)} | ` +
      `${r.params.name}`
    );
  }

  // Save results
  const summaryPath = path.join(OUTPUT_DIR, 'indicator_strategies.csv');
  const csvRows = results.map(r => ({
    Rank: results.indexOf(r) + 1,
    Strategy: r.params.name,
    WinRate: (r.winRate * 100).toFixed(2),
    AvgPnlPerTrade: r.totalPnlPercent.toFixed(2),
    TotalTrades: r.totalTrades,
    WinningTrades: r.winningTrades,
    LosingTrades: r.losingTrades,
    ProfitFactor: r.profitFactor.toFixed(2),
    EntryConditions: JSON.stringify({
      ichimokuBullish: r.params.requireIchimokuBullish,
      cloudCross: r.params.requireIchimokuCloudCross,
      goldenCross: r.params.requireGoldenCross,
    }),
    ExitConditions: JSON.stringify({
      cloudCrossDown: r.params.exitOnIchimokuCloudCrossDown,
      deathCross: r.params.exitOnDeathCross,
    }),
  }));

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

optimizeIndicatorStrategies().catch(console.error);

