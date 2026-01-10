#!/usr/bin/env ts-node
/**
 * Test Tenkan/Kijun Cross Strategy ONLY on Remaining Period (after first 6 hours)
 * Simulates using 1h candles instead of 5m candles
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '@quantbot/ohlcv';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';
import { calculateIndicators } from '@quantbot/backtest';
import type { IndicatorData } from '@quantbot/backtest';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/tenkan-kijun-remaining-period-only');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
}

/**
 * Simulate Tenkan/Kijun cross strategy - ONLY on remaining period (after 6 hours)
 */
function simulateTenkanKijunRemainingPeriodOnly(
  candles: any[],
  alertTime: DateTime
): {
  pnl: number;
  maxReached: number;
  holdDuration: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
} | null {
  if (candles.length < 52) {
    return null;
  }

  const alertTimestamp = alertTime.toMillis();
  const sixHourMark = alertTimestamp + 6 * 60 * 60 * 1000;

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

  // Need at least 52 candles AFTER the 6-hour mark for Ichimoku calculation
  if (sixHourIndex === 0 || candles.length - sixHourIndex < 52) {
    return null;
  }

  // Calculate indicators from the beginning (needed for proper Ichimoku calculation)
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

  // Find Tenkan/Kijun cross entry - ONLY after 6-hour mark
  let entryIndex = 0;

  // Start looking from sixHourIndex + 52 to ensure we have enough data for Ichimoku
  // But also need at least 52 candles before sixHourIndex for proper indicator calculation
  const searchStartIndex = Math.max(sixHourIndex, 52);

  for (let i = searchStartIndex; i < candles.length; i++) {
    const indicators = indicatorData[i];
    const previousIndicators = i > 0 ? indicatorData[i - 1] : null;

    if (previousIndicators?.ichimoku && indicators.ichimoku) {
      const crossedUp =
        previousIndicators.ichimoku.tenkan <= previousIndicators.ichimoku.kijun &&
        indicators.ichimoku.tenkan > indicators.ichimoku.kijun;
      if (crossedUp) {
        entryIndex = i;
        break;
      }
    }
  }

  if (entryIndex === 0 || entryIndex < sixHourIndex) {
    return null; // No cross found after 6-hour mark
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
  const targetsHit = new Set<number>();

  // Simulate from entry point (using candles as-is: 5m for first 6h, then 1h after)
  // Start from entryIndex + 1 to avoid exiting on the same candle we entered
  // Entry happens at candle[entryIndex].close, so we check exits starting from the next candle
  const startIndex = entryIndex + 1;

  // If no candles after entry, exit immediately at entry price (shouldn't happen but handle it)
  if (startIndex >= candles.length) {
    return {
      pnl: 1.0, // Breakeven if no candles to trade
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

    // Calculate candle time - for 1h candles, this is the candle's start time
    // We need to add the candle duration to get the exit time
    const candleStartTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp * 1000
        : new Date(candle.timestamp).getTime()
      : entryTime;

    // Estimate candle duration: if it's a 1h candle, add 1 hour; if 5m, add 5 minutes
    // We can detect this by checking the time difference from previous candle
    let candleDurationMs = 60 * 60 * 1000; // Default to 1 hour
    if (i > startIndex && i > 0) {
      const prevCandle = candles[i - 1];
      const prevCandleTime = prevCandle.timestamp
        ? typeof prevCandle.timestamp === 'number'
          ? prevCandle.timestamp * 1000
          : new Date(prevCandle.timestamp).getTime()
        : candleStartTime;
      candleDurationMs = candleStartTime - prevCandleTime;
      if (candleDurationMs <= 0) candleDurationMs = 60 * 60 * 1000; // Fallback to 1h
    }

    const candleTime = candleStartTime + candleDurationMs; // Exit happens at candle close

    const effectiveHigh =
      candle.close > 0 && candle.high / candle.close > 10 ? candle.close * 1.05 : candle.high;

    const effectiveLow =
      candle.close > 0 && candle.low / candle.close < 0.1 ? candle.close * 0.95 : candle.low;

    const currentMultiplier = effectiveHigh / actualEntryPrice;
    if (currentMultiplier > maxReached) {
      maxReached = currentMultiplier;
    }

    if (remaining > 0 && effectiveHigh > highestPrice) {
      highestPrice = effectiveHigh;
    }

    // Check Tenkan/Kijun cross down exit
    if (previousIndicators?.ichimoku && indicators.ichimoku) {
      const crossedDown =
        previousIndicators.ichimoku.tenkan >= previousIndicators.ichimoku.kijun &&
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
    if (!targetsHit.has(1.5) && remaining >= 0.5 && effectiveHigh >= targetPrice) {
      pnl += 0.5 * 1.5;
      remaining -= 0.5;
      targetsHit.add(1.5);
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

  const holdDurationMinutes = exited ? Math.max(0, Math.floor((exitTime - entryTime) / 60000)) : 0;

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
  const sortedTrades = trades.sort(
    (a, b) => DateTime.fromISO(a.alertTime).toMillis() - DateTime.fromISO(b.alertTime).toMillis()
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
  const sortedWeeks = Array.from(tradesByWeek.entries()).sort(
    (a, b) => DateTime.fromISO(a[0]).toMillis() - DateTime.fromISO(b[0]).toMillis()
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

async function testRemainingPeriodOnly() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🔬 TENKAN/KIJUN CROSS - REMAINING PERIOD ONLY (After 6 Hours)');
  console.log('📊 Using cached candles: 5m for first 6h, then 1h after 6h');
  console.log('   ONLY investing after first 6 hours (using 1h candles)');
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

  const trades: TradeResult[] = [];
  let noCrossFound = 0;
  let insufficientData = 0;

  console.log('🔄 Processing tokens (skipping first 6 hours)...\n');

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

      if (candles.length < 52) {
        insufficientData++;
        continue;
      }

      const result = simulateTenkanKijunRemainingPeriodOnly(candles, alertTime);

      if (!result) {
        noCrossFound++;
        continue;
      }

      trades.push({
        tokenAddress,
        alertTime: call.timestamp || call.alertTime || '',
        entryTime: DateTime.fromMillis(result.entryTime).toISO() || '',
        exitTime: DateTime.fromMillis(result.exitTime).toISO() || '',
        pnl: result.pnl,
        pnlPercent: (result.pnl - 1) * 100,
        maxReached: result.maxReached,
        holdDuration: result.holdDuration,
      });

      if ((i + 1) % 50 === 0) {
        console.log(`   Processed ${i + 1}/${uniqueCalls.length} tokens...`);
      }
    } catch (error) {
      // Skip errors
    }
  }

  console.log(`\n✅ Processed ${uniqueCalls.length} tokens`);
  console.log(`   Trades found: ${trades.length}`);
  console.log(`   No cross found: ${noCrossFound}`);
  console.log(`   Insufficient data: ${insufficientData}\n`);

  if (trades.length === 0) {
    console.log('❌ No trades found!\n');
    return;
  }

  // Sort trades by alert time for proper sequential processing
  const sortedTrades = trades.sort(
    (a, b) => DateTime.fromISO(a.alertTime).toMillis() - DateTime.fromISO(b.alertTime).toMillis()
  );

  // Calculate metrics
  const winningTrades = sortedTrades.filter((t) => t.pnl > 1.0).length;
  const losingTrades = sortedTrades.filter((t) => t.pnl <= 1.0).length;
  const winRate = sortedTrades.length > 0 ? winningTrades / sortedTrades.length : 0;

  const totalPnl = sortedTrades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
  const avgPnlPerTrade = sortedTrades.length > 0 ? (totalPnl / sortedTrades.length) * 100 : 0;

  // Calculate reinvestment using ACTUAL trade sequence
  const initialPortfolio = 100;
  const stopLossPercent = 0.2; // 1 - 0.8
  const maxRiskPerTrade = 0.02;
  const positionSizePercent = maxRiskPerTrade / stopLossPercent; // 10%

  let portfolio = initialPortfolio;
  const reinvestmentHistory: Array<{
    tradeNum: number;
    alertTime: string;
    pnl: number;
    positionSize: number;
    tradeReturn: number;
    portfolioBefore: number;
    portfolioAfter: number;
  }> = [];

  // Group trades by week for weekly rebalancing
  const tradesByWeek = new Map<string, typeof sortedTrades>();

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
  const sortedWeeks = Array.from(tradesByWeek.entries()).sort(
    (a, b) => DateTime.fromISO(a[0]).toMillis() - DateTime.fromISO(b[0]).toMillis()
  );

  let tradeNum = 0;
  for (const [weekKey, weekTrades] of sortedWeeks) {
    const weeklyPositionSize = portfolio * positionSizePercent;

    for (const trade of weekTrades) {
      tradeNum++;
      const portfolioBefore = portfolio;
      const tradeReturn = (trade.pnl - 1.0) * weeklyPositionSize;
      portfolio = portfolio + tradeReturn;

      reinvestmentHistory.push({
        tradeNum,
        alertTime: trade.alertTime,
        pnl: trade.pnl,
        positionSize: weeklyPositionSize,
        tradeReturn,
        portfolioBefore,
        portfolioAfter: portfolio,
      });
    }
  }

  const finalPortfolio = portfolio;
  const compoundFactor = finalPortfolio / initialPortfolio;

  // Calculate risk-adjusted metrics
  // Risk-free rate: 5% annual = 0.0137% daily = 0.000137 per day
  const RISK_FREE_RATE_ANNUAL = 0.05;
  const RISK_FREE_RATE_DAILY = RISK_FREE_RATE_ANNUAL / 365;

  // Calculate portfolio value over time for drawdown and return calculations
  let portfolioValue = initialPortfolio;
  let peak = initialPortfolio;
  let maxDrawdown = 0;
  const portfolioValues: Array<{ week: string; value: number; date: DateTime }> = [
    {
      week: 'start',
      value: initialPortfolio,
      date: DateTime.fromISO(sortedTrades[0]?.alertTime || ''),
    },
  ];

  for (const [weekKey, weekTrades] of sortedWeeks) {
    const weeklyPositionSize = portfolioValue * positionSizePercent;
    let weeklyPnL = 0;

    for (const trade of weekTrades) {
      const tradeReturn = (trade.pnl - 1.0) * weeklyPositionSize;
      weeklyPnL += tradeReturn;
    }

    portfolioValue = portfolioValue + weeklyPnL;
    const weekDate = DateTime.fromISO(weekKey);
    portfolioValues.push({ week: weekKey, value: portfolioValue, date: weekDate });

    if (portfolioValue > peak) {
      peak = portfolioValue;
    }

    if (peak > 0) {
      const drawdown = (peak - portfolioValue) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  // Calculate weekly returns (more appropriate than daily for this strategy)
  const weeklyReturns: number[] = [];
  for (let i = 1; i < portfolioValues.length; i++) {
    const prevValue = portfolioValues[i - 1].value;
    const currValue = portfolioValues[i].value;
    if (prevValue > 0) {
      const weeklyReturn = (currValue - prevValue) / prevValue;
      weeklyReturns.push(weeklyReturn);
    }
  }

  // Calculate average trade duration
  const avgTradeDurationDays =
    sortedTrades.reduce((sum, t) => sum + t.holdDuration / (24 * 60), 0) / sortedTrades.length;

  // Calculate time period
  const firstTradeDate = DateTime.fromISO(sortedTrades[0]?.alertTime || '');
  const lastTradeDate = DateTime.fromISO(sortedTrades[sortedTrades.length - 1]?.alertTime || '');
  const totalDays = lastTradeDate.diff(firstTradeDate, 'days').days || 1;
  const totalWeeks = portfolioValues.length - 1;

  // Calculate Sharpe Ratio (using weekly returns, annualized)
  const avgWeeklyReturn = weeklyReturns.reduce((sum, r) => sum + r, 0) / weeklyReturns.length;
  const weeklyReturnStdDev = Math.sqrt(
    weeklyReturns.reduce((sum, r) => sum + Math.pow(r - avgWeeklyReturn, 2), 0) /
      weeklyReturns.length
  );
  const weeklyRiskFreeRate = RISK_FREE_RATE_ANNUAL / 52;
  const sharpeRatio =
    weeklyReturnStdDev > 0
      ? ((avgWeeklyReturn - weeklyRiskFreeRate) / weeklyReturnStdDev) * Math.sqrt(52) // Annualized
      : 0;

  // Calculate Sortino Ratio (only downside deviation)
  const downsideReturns = weeklyReturns.filter((r) => r < 0);
  const downsideStdDev =
    downsideReturns.length > 0
      ? Math.sqrt(
          downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length
        )
      : 0;
  const sortinoRatio =
    downsideStdDev > 0
      ? ((avgWeeklyReturn - weeklyRiskFreeRate) / downsideStdDev) * Math.sqrt(52) // Annualized
      : 0;

  // Calculate Calmar Ratio (Annual Return / Max Drawdown)
  const annualReturn = totalDays > 0 ? Math.pow(compoundFactor, 365 / totalDays) - 1 : 0;
  const calmarRatio = maxDrawdown > 0 ? annualReturn / maxDrawdown : 0;

  // Calculate total return and portfolio volatility
  const totalReturn = compoundFactor - 1;
  const portfolioVolatility = weeklyReturnStdDev * Math.sqrt(52); // Annualized volatility

  // Display results
  console.log(`${'='.repeat(80)}`);
  console.log('📊 REMAINING PERIOD ONLY RESULTS');
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Total Trades: ${sortedTrades.length}`);
  console.log(`Win Rate: ${(winRate * 100).toFixed(2)}%`);
  console.log(`Winning Trades: ${winningTrades}`);
  console.log(`Losing Trades: ${losingTrades}`);
  console.log(
    `Average PnL per Trade: ${avgPnlPerTrade >= 0 ? '+' : ''}${avgPnlPerTrade.toFixed(2)}%`
  );
  console.log(`Average Trade Duration: ${avgTradeDurationDays.toFixed(2)} days`);
  console.log(`\n📊 REINVESTMENT CALCULATION (Using ACTUAL Trade Sequence):`);
  console.log(`  Initial Portfolio: $${initialPortfolio.toFixed(2)}`);
  console.log(`  Position Size: ${(positionSizePercent * 100).toFixed(2)}% of portfolio (weekly)`);
  console.log(`  Final Portfolio: $${finalPortfolio.toFixed(2)}`);
  console.log(`  Compound Growth Factor: ${compoundFactor.toFixed(4)}x`);
  console.log(`  Total Return: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`  Max Drawdown: ${(maxDrawdown * 100).toFixed(2)}%`);

  console.log(`\n📈 RISK-ADJUSTED METRICS:`);
  console.log(`  Risk-Free Rate: ${(RISK_FREE_RATE_ANNUAL * 100).toFixed(2)}% annual`);
  console.log(`  Total Period: ${totalDays.toFixed(1)} days (${totalWeeks} weeks)`);
  console.log(`  Average Weekly Return: ${(avgWeeklyReturn * 100).toFixed(4)}%`);
  console.log(`  Weekly Return Std Dev: ${(weeklyReturnStdDev * 100).toFixed(4)}%`);
  console.log(`  Sharpe Ratio (Annualized): ${sharpeRatio.toFixed(4)}`);
  console.log(`  Sortino Ratio (Annualized): ${sortinoRatio.toFixed(4)}`);
  console.log(`  Calmar Ratio: ${calmarRatio.toFixed(4)}`);
  console.log(`  Portfolio Volatility (Annualized): ${(portfolioVolatility * 100).toFixed(2)}%`);
  console.log(`  Annual Return: ${(annualReturn * 100).toFixed(2)}%`);
  console.log(`\n📊 SIMPLE PnL (No Reinvestment - Fixed Position Size):`);
  // Risk rule: 2% of portfolio risked per trade, 20% stop loss
  // Therefore: position_size * 0.20 = portfolio * 0.02
  // So: position_size = portfolio * 0.10 = 10% of portfolio
  const initialPortfolioForSimple = 100;
  const fixedPositionSize = initialPortfolioForSimple * positionSizePercent; // $10 (10% of $100)

  // Calculate sequential trades without compounding (keep portfolio at $100, use $10 per trade)
  const simplePortfolio = initialPortfolioForSimple;
  let simpleTotalProfit = 0;

  for (const trade of sortedTrades) {
    const tradeReturn = (trade.pnl - 1.0) * fixedPositionSize;
    simpleTotalProfit += tradeReturn;
    // Don't compound - keep using fixed $10 per trade
  }

  const simpleTotalReturn = initialPortfolioForSimple + simpleTotalProfit;

  console.log(`  Risk Rule: 2% of portfolio risked per trade, 20% stop loss`);
  console.log(
    `  Position Size: $${fixedPositionSize.toFixed(2)} (10% of $${initialPortfolioForSimple})`
  );
  console.log(`  Total Trades: ${sortedTrades.length}`);
  console.log(`  Total Invested: $${(sortedTrades.length * fixedPositionSize).toFixed(2)}`);
  console.log(
    `  Total Profit: $${simpleTotalProfit >= 0 ? '+' : ''}${simpleTotalProfit.toFixed(2)}`
  );
  console.log(`  Final Portfolio: $${simpleTotalReturn.toFixed(2)}`);
  console.log(
    `  Return %: ${(simpleTotalReturn / initialPortfolioForSimple - 1) * 100 >= 0 ? '+' : ''}${((simpleTotalReturn / initialPortfolioForSimple - 1) * 100).toFixed(2)}%`
  );

  // Save COMPLETE trade history
  const tradeHistoryPath = path.join(OUTPUT_DIR, 'complete_trade_history.csv');
  const tradeHistoryRows = sortedTrades.map((t, idx) => ({
    TradeNumber: idx + 1,
    TokenAddress: t.tokenAddress,
    AlertTime: t.alertTime,
    EntryTime: t.entryTime,
    ExitTime: t.exitTime,
    PnL: t.pnl.toFixed(6),
    PnLPercent: t.pnlPercent.toFixed(2),
    MaxReached: t.maxReached.toFixed(4),
    HoldDurationMinutes: t.holdDuration,
    IsWin: t.pnl > 1.0 ? 'Yes' : 'No',
  }));

  await new Promise<void>((resolve, reject) => {
    stringify(tradeHistoryRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(tradeHistoryPath, output);
        resolve();
      }
    });
  });

  // Save reinvestment history
  const reinvestmentPath = path.join(OUTPUT_DIR, 'reinvestment_history.csv');
  const reinvestmentRows = reinvestmentHistory.map((r) => ({
    TradeNumber: r.tradeNum,
    AlertTime: r.alertTime,
    PnL: r.pnl.toFixed(6),
    PositionSize: r.positionSize.toFixed(2),
    TradeReturn: r.tradeReturn.toFixed(2),
    PortfolioBefore: r.portfolioBefore.toFixed(2),
    PortfolioAfter: r.portfolioAfter.toFixed(2),
  }));

  await new Promise<void>((resolve, reject) => {
    stringify(reinvestmentRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(reinvestmentPath, output);
        resolve();
      }
    });
  });

  console.log(`\n✅ COMPLETE TRADE HISTORY saved to: ${tradeHistoryPath}`);
  console.log(`   Contains ${sortedTrades.length} trades with full details`);
  console.log(`✅ REINVESTMENT HISTORY saved to: ${reinvestmentPath}`);
  console.log(`   Contains portfolio before/after each trade with weekly rebalancing`);
  console.log(
    `\n💡 You can now apply your own reinvestment model using the complete trade history.\n`
  );
}

testRemainingPeriodOnly().catch(console.error);
