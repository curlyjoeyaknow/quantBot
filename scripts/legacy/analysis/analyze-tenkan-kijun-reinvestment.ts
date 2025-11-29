#!/usr/bin/env ts-node
/**
 * Analyze Tenkan/Kijun Cross Strategy with Reinvestment
 * 
 * Calculates cumulative portfolio growth with reinvestment for the Tenkan/Kijun indicator strategy
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import {
  calculateIndicators,
  IndicatorData,
} from '../src/simulation/indicators';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/reinvestment-analysis');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface TradeResult {
  tokenAddress: string;
  alertTime: string;
  entryTime: string;
  pnl: number;
  pnlPercent: number;
  timestamp: DateTime;
}

interface ReinvestmentResult {
  strategyName: string;
  initialPortfolio: number;
  finalPortfolio: number;
  totalReturn: number;
  totalReturnPercent: number;
  compoundGrowthFactor: number;
  winRate: number;
  totalTrades: number;
  avgPnlPerTrade: number;
  profitFactor: number;
  maxDrawdown: number;
  trades: TradeResult[];
}

/**
 * Check entry conditions for Tenkan/Kijun cross
 */
function checkTenkanKijunEntry(
  indicators: IndicatorData,
  previousIndicators: IndicatorData | null
): { canEnter: boolean; reason: string } {
  if (!indicators.ichimoku || !previousIndicators?.ichimoku) {
    return { canEnter: false, reason: 'Insufficient Ichimoku data' };
  }

  const crossedUp = previousIndicators.ichimoku.tenkan <= previousIndicators.ichimoku.kijun &&
                    indicators.ichimoku.tenkan > indicators.ichimoku.kijun;

  if (crossedUp) {
    return { canEnter: true, reason: 'Tenkan crossed above Kijun' };
  }

  return { canEnter: false, reason: 'No Tenkan/Kijun cross up' };
}

/**
 * Check exit conditions for Tenkan/Kijun cross down
 */
function checkTenkanKijunExit(
  indicators: IndicatorData,
  previousIndicators: IndicatorData | null
): { shouldExit: boolean; reason: string } {
  if (!indicators.ichimoku || !previousIndicators?.ichimoku) {
    return { shouldExit: false, reason: '' };
  }

  const crossedDown = previousIndicators.ichimoku.tenkan >= previousIndicators.ichimoku.kijun &&
                       indicators.ichimoku.tenkan < indicators.ichimoku.kijun;

  if (crossedDown) {
    return { shouldExit: true, reason: 'Tenkan crossed below Kijun' };
  }

  return { shouldExit: false, reason: '' };
}

/**
 * Simulate Tenkan/Kijun strategy
 */
function simulateTenkanKijunStrategy(
  candles: any[],
  params: {
    profitTargets: Array<{ target: number; percent: number }>;
    trailingStopPercent?: number;
    trailingStopActivation?: number;
    minExitPrice: number;
  }
): { pnl: number; maxReached: number; holdDuration: number; entryTime: number; exitTime: number; entryPrice: number } {
  if (candles.length < 52) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime: Date.now(),
      exitTime: Date.now(),
      entryPrice: candles[0]?.close || 1,
    };
  }

  const firstCandle = candles[0];
  const alertTime = firstCandle.timestamp
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
    
    previousEMAs = {
      ema9: indicators.movingAverages.ema9,
      ema20: indicators.movingAverages.ema20,
      ema50: indicators.movingAverages.ema50,
    };
  }

  // Find entry point (wait for Tenkan/Kijun cross)
  let entryIndex = 0;
  
  for (let i = 52; i < candles.length; i++) {
    const indicators = indicatorData[i];
    const previousIndicators = i > 0 ? indicatorData[i - 1] : null;
    
    const entryCheck = checkTenkanKijunEntry(indicators, previousIndicators);
    if (entryCheck.canEnter) {
      entryIndex = i;
      break;
    }
  }

  // If no entry found, skip trade
  if (entryIndex === 0) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime: alertTime,
      exitTime: alertTime,
      entryPrice: candles[0].close,
    };
  }

  const actualEntryPrice = candles[entryIndex].close;
  const entryTime = candles[entryIndex].timestamp
    ? typeof candles[entryIndex].timestamp === 'number'
      ? candles[entryIndex].timestamp
      : new Date(candles[entryIndex].timestamp).getTime()
    : alertTime;

  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = actualEntryPrice;
  let maxReached = 1.0;
  let exitTime = entryTime;
  let exited = false;

  const targetsHit = new Set<number>();
  const minExitPrice = actualEntryPrice * params.minExitPrice;
  const stopLossPrice = actualEntryPrice * params.minExitPrice; // Stop at Kijun or min exit

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

    // Check exit conditions (Tenkan/Kijun cross down)
    const exitCheck = checkTenkanKijunExit(indicators, previousIndicators);
    if (exitCheck.shouldExit && remaining > 0) {
      const exitPrice = Math.max(effectiveLow, minExitPrice);
      pnl += remaining * (exitPrice / actualEntryPrice);
      remaining = 0;
      exitTime = candleTime;
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

    // Stop loss at Kijun or min exit price
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
    entryTime,
    exitTime,
    entryPrice: actualEntryPrice,
  };
}

/**
 * Calculate reinvestment performance
 * 
 * Risk Management Rule: Maximum RISK per trade = 2% of portfolio
 * Position size = 2% / stop_loss_percentage
 * Example: If stop loss is 30%, position size = 2% / 30% = 6.67% of portfolio
 */
function calculateReinvestmentPerformance(
  trades: TradeResult[],
  initialPortfolio: number = 100,
  stopLossPercent: number = 0.20, // 20% stop loss (minExitPrice = 0.8)
  maxRiskPerTrade: number = 0.02 // 2% of portfolio maximum risk
): Omit<ReinvestmentResult, 'strategyName' | 'winRate' | 'avgPnlPerTrade' | 'profitFactor' | 'trades'> {
  const sortedTrades = [...trades].sort((a, b) => 
    a.timestamp.toMillis() - b.timestamp.toMillis()
  );

  // Calculate position size based on stop loss
  // Position size = maxRiskPerTrade / stopLossPercent
  // This ensures that if stop loss hits, we lose exactly maxRiskPerTrade of portfolio
  const positionSizePercent = maxRiskPerTrade / stopLossPercent;

  let portfolio = initialPortfolio;
  let maxPortfolio = initialPortfolio;
  let minPortfolio = initialPortfolio;
  let peak = initialPortfolio;
  let maxDrawdown = 0;

  for (const trade of sortedTrades) {
    const positionSize = portfolio * positionSizePercent;
    const tradeReturn = (trade.pnl - 1.0) * positionSize;
    portfolio = portfolio + tradeReturn;
    
    if (portfolio > peak) {
      peak = portfolio;
    }
    if (portfolio > maxPortfolio) {
      maxPortfolio = portfolio;
    }
    if (portfolio < minPortfolio) {
      minPortfolio = portfolio;
    }
    
    if (peak > 0) {
      const drawdown = (peak - portfolio) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  const totalReturn = portfolio - initialPortfolio;
  const totalReturnPercent = (totalReturn / initialPortfolio) * 100;
  const compoundGrowthFactor = portfolio / initialPortfolio;

  return {
    initialPortfolio,
    finalPortfolio: portfolio,
    totalReturn,
    totalReturnPercent,
    compoundGrowthFactor,
    totalTrades: sortedTrades.length,
    maxDrawdown,
  };
}

async function analyzeTenkanKijunReinvestment() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('💰 TENKAN/KIJUN CROSS STRATEGY - REINVESTMENT ANALYSIS');
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

  // Tenkan/Kijun strategy parameters (from optimization results)
  const strategyParams = {
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    minExitPrice: 0.8, // 20% stop loss
  };

  console.log('🧪 Simulating Tenkan/Kijun Cross Strategy...\n');
  console.log('Strategy Parameters:');
  console.log(`  Entry: Tenkan crosses above Kijun`);
  console.log(`  Exit: Tenkan crosses below Kijun`);
  console.log(`  Profit Target: 50% @ 1.5x`);
  console.log(`  Stop Loss: 20% (at Kijun or min exit)\n`);

  const trades: TradeResult[] = [];
  const initialPortfolio = 100;
  const stopLossPercent = 0.20; // 20% stop loss (minExitPrice = 0.8)
  const maxRiskPerTrade = 0.02; // 2% of portfolio maximum risk

  for (const call of uniqueCalls) {
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

      const result = simulateTenkanKijunStrategy(candles, strategyParams);

      trades.push({
        tokenAddress,
        alertTime: call.timestamp || call.alertTime || '',
        entryTime: DateTime.fromMillis(result.entryTime).toISO() || '',
        pnl: result.pnl,
        pnlPercent: (result.pnl - 1) * 100,
        timestamp: alertTime,
      });
    } catch (error) {
      // Skip errors
    }
  }

  if (trades.length === 0) {
    console.log('❌ No trades generated');
    return;
  }

  // Calculate metrics
  const winningTrades = trades.filter(t => t.pnl > 1.0).length;
  const losingTrades = trades.filter(t => t.pnl <= 1.0).length;
  const winRate = trades.length > 0 ? winningTrades / trades.length : 0;
  
  const wins = trades.filter(t => t.pnl > 1.0).map(t => t.pnl - 1.0);
  const losses = trades.filter(t => t.pnl <= 1.0).map(t => 1.0 - t.pnl);
  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalLosses = losses.reduce((a, b) => a + b, 0);
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;
  
  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
  const avgPnlPerTrade = trades.length > 0 ? (totalPnl / trades.length) * 100 : 0;

  // Calculate reinvestment performance
  const reinvestmentResult = calculateReinvestmentPerformance(trades, initialPortfolio, stopLossPercent, maxRiskPerTrade);

  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 STRATEGY PERFORMANCE METRICS');
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Total Trades: ${trades.length}`);
  console.log(`Winning Trades: ${winningTrades}`);
  console.log(`Losing Trades: ${losingTrades}`);
  console.log(`Win Rate: ${(winRate * 100).toFixed(2)}%`);
  console.log(`Average PnL per Trade: ${avgPnlPerTrade >= 0 ? '+' : ''}${avgPnlPerTrade.toFixed(2)}%`);
  console.log(`Profit Factor: ${profitFactor.toFixed(2)}`);
  console.log(`\nOverall Total PnL (without reinvestment): ${(totalPnl * 100).toFixed(2)}%`);

  console.log(`\n${'='.repeat(80)}`);
  console.log('💰 REINVESTMENT PERFORMANCE');
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Initial Portfolio: $${reinvestmentResult.initialPortfolio.toFixed(2)}`);
  console.log(`Final Portfolio: $${reinvestmentResult.finalPortfolio.toFixed(2)}`);
  console.log(`Total Return: $${reinvestmentResult.totalReturn.toFixed(2)} (${reinvestmentResult.totalReturnPercent >= 0 ? '+' : ''}${reinvestmentResult.totalReturnPercent.toFixed(2)}%)`);
  console.log(`Compound Growth Factor: ${reinvestmentResult.compoundGrowthFactor.toFixed(2)}x`);
  console.log(`Max Drawdown: ${(reinvestmentResult.maxDrawdown * 100).toFixed(2)}%`);

  const positionSizePercent = maxRiskPerTrade / stopLossPercent;
  console.log(`\n💡 Interpretation:`);
  console.log(`   Starting with $${initialPortfolio}`);
  console.log(`   Stop Loss: ${(stopLossPercent * 100)}%`);
  console.log(`   Max Risk per Trade: ${(maxRiskPerTrade * 100)}% of portfolio`);
  console.log(`   Position Size: ${(positionSizePercent * 100).toFixed(2)}% of portfolio (calculated as ${(maxRiskPerTrade * 100)}% / ${(stopLossPercent * 100)}%)`);
  console.log(`   Final value: $${reinvestmentResult.finalPortfolio.toFixed(2)}`);
  console.log(`   Total profit: $${reinvestmentResult.totalReturn.toFixed(2)}`);
  console.log(`   Your $${initialPortfolio} would have grown to $${reinvestmentResult.finalPortfolio.toFixed(2)}`);

  // Compare to simple average
  const simpleTotalReturn = initialPortfolio * (1 + totalPnl * positionSizePercent);
  console.log(`\n📈 Comparison:`);
  console.log(`   Simple average (no reinvestment): $${simpleTotalReturn.toFixed(2)}`);
  console.log(`   With reinvestment: $${reinvestmentResult.finalPortfolio.toFixed(2)}`);
  console.log(`   Difference: $${(reinvestmentResult.finalPortfolio - simpleTotalReturn).toFixed(2)}`);

  // Save results
  const resultPath = path.join(OUTPUT_DIR, 'tenkan_kijun_reinvestment.json');
  const result = {
    strategyName: 'Tenkan_Kijun_Cross',
    ...reinvestmentResult,
    winRate,
    avgPnlPerTrade,
    profitFactor,
    trades: trades.map(t => ({
      tokenAddress: t.tokenAddress,
      alertTime: t.alertTime,
      entryTime: t.entryTime,
      pnl: t.pnl,
      pnlPercent: t.pnlPercent,
    })),
  };

  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(`\n✅ Results saved to: ${resultPath}\n`);
}

analyzeTenkanKijunReinvestment().catch(console.error);

