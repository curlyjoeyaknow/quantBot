#!/usr/bin/env ts-node
/**
 * Test Tenkan/Kijun Cross Strategy with 1h candles (consolidated from 5m)
 * Starting from alert time, NO reinvestment (simple PnL calculation)
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
const OUTPUT_DIR = path.join(__dirname, '../data/exports/tenkan-kijun-1h-no-reinvestment');

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
 * Consolidate 5m candles into 1h candles
 */
function consolidateTo1hCandles(candles: any[]): any[] {
  if (candles.length === 0) return [];

  const oneHourCandles: any[] = [];
  const oneHourMs = 60 * 60 * 1000; // 1 hour in milliseconds

  let currentHourStart: number | null = null;
  let currentHourCandle: any | null = null;

  for (const candle of candles) {
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp * 1000
        : new Date(candle.timestamp).getTime()
      : Date.now();

    // Round down to the start of the hour
    const hourStart = Math.floor(candleTime / oneHourMs) * oneHourMs;

    if (currentHourStart === null || hourStart !== currentHourStart) {
      // Save previous hour candle if exists
      if (currentHourCandle) {
        oneHourCandles.push(currentHourCandle);
      }

      // Start new hour candle
      currentHourStart = hourStart;
      currentHourCandle = {
        timestamp: hourStart / 1000, // Convert back to seconds
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
    } else {
      // Update current hour candle with this 5m candle's data
      if (currentHourCandle) {
        currentHourCandle.high = Math.max(currentHourCandle.high, candle.high);
        currentHourCandle.low = Math.min(currentHourCandle.low, candle.low);
        currentHourCandle.close = candle.close; // Last close becomes the hour's close
        currentHourCandle.volume += candle.volume;
      }
    }
  }

  // Don't forget the last hour candle
  if (currentHourCandle) {
    oneHourCandles.push(currentHourCandle);
  }

  return oneHourCandles;
}

/**
 * Simulate Tenkan/Kijun cross strategy with 1h candles, starting from alert time
 */
function simulateTenkanKijun1hStrategy(
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
  // Consolidate 5m candles to 1h candles
  const oneHourCandles = consolidateTo1hCandles(candles);

  if (oneHourCandles.length < 52) {
    return null;
  }

  // Calculate indicators
  const indicatorData: IndicatorData[] = [];
  let previousEMAs: { ema9?: number | null; ema20?: number | null; ema50?: number | null } = {};

  for (let i = 0; i < oneHourCandles.length; i++) {
    const indicators = calculateIndicators(oneHourCandles, i, previousEMAs);
    indicatorData.push(indicators);

    previousEMAs = {
      ema9: indicators.movingAverages.ema9,
      ema20: indicators.movingAverages.ema20,
      ema50: indicators.movingAverages.ema50,
    };
  }

  const alertTimestamp = alertTime.toMillis();

  // Find Tenkan/Kijun cross entry - starting from alert time
  let entryIndex = 0;

  // Start looking from candle 52 (need enough data for Ichimoku)
  for (let i = 52; i < oneHourCandles.length; i++) {
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

  if (entryIndex === 0) {
    return null;
  }

  const actualEntryPrice = oneHourCandles[entryIndex].close;
  const entryTime = oneHourCandles[entryIndex].timestamp
    ? typeof oneHourCandles[entryIndex].timestamp === 'number'
      ? oneHourCandles[entryIndex].timestamp * 1000
      : new Date(oneHourCandles[entryIndex].timestamp).getTime()
    : alertTimestamp;

  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = actualEntryPrice;
  let maxReached = 1.0;
  let exitTime = entryTime;
  let exited = false;

  const minExitPrice = actualEntryPrice * 0.8;
  const targetsHit = new Set<number>();

  // Simulate from entry point
  for (let i = entryIndex; i < oneHourCandles.length; i++) {
    const candle = oneHourCandles[i];
    const indicators = indicatorData[i];
    const previousIndicators = i > entryIndex ? indicatorData[i - 1] : null;

    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp * 1000
        : new Date(candle.timestamp).getTime()
      : entryTime;

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
    const finalPrice = oneHourCandles[oneHourCandles.length - 1].close;
    const exitPrice = Math.max(finalPrice, minExitPrice);
    pnl += remaining * (exitPrice / actualEntryPrice);
    exitTime = oneHourCandles[oneHourCandles.length - 1].timestamp
      ? typeof oneHourCandles[oneHourCandles.length - 1].timestamp === 'number'
        ? oneHourCandles[oneHourCandles.length - 1].timestamp * 1000
        : new Date(oneHourCandles[oneHourCandles.length - 1].timestamp).getTime()
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

async function test1hCandlesNoReinvestment() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🔬 TENKAN/KIJUN CROSS - 1H CANDLES (Consolidated from 5m)');
  console.log('📊 Starting from alert time, NO reinvestment (simple PnL)');
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

  console.log('🔄 Processing tokens (consolidating 5m → 1h candles)...\n');

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

      const result = simulateTenkanKijun1hStrategy(candles, alertTime);

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

  // Calculate metrics WITHOUT reinvestment (simple sum)
  const winningTrades = trades.filter((t) => t.pnl > 1.0).length;
  const losingTrades = trades.filter((t) => t.pnl <= 1.0).length;
  const winRate = trades.length > 0 ? winningTrades / trades.length : 0;

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
  const avgPnlPerTrade = trades.length > 0 ? (totalPnl / trades.length) * 100 : 0;

  // Sort trades by alert time for proper sequential processing
  const sortedTrades = trades.sort(
    (a, b) => DateTime.fromISO(a.alertTime).toMillis() - DateTime.fromISO(b.alertTime).toMillis()
  );

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

  // Simple PnL (no reinvestment) - using actual trade sequence
  const simplePnL = sortedTrades.reduce((sum, t) => sum + (t.pnl - 1.0), 0) * 100; // Assuming $100 per trade
  const simpleTotalReturn = sortedTrades.length * 100 + simplePnL;

  // Display results
  console.log(`${'='.repeat(80)}`);
  console.log('📊 1H CANDLES - NO REINVESTMENT RESULTS');
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Total Trades: ${trades.length}`);
  console.log(`Win Rate: ${(winRate * 100).toFixed(2)}%`);
  console.log(`Winning Trades: ${winningTrades}`);
  console.log(`Losing Trades: ${losingTrades}`);
  console.log(
    `Average PnL per Trade: ${avgPnlPerTrade >= 0 ? '+' : ''}${avgPnlPerTrade.toFixed(2)}%`
  );
  console.log(`\n📊 REINVESTMENT CALCULATION (Using ACTUAL Trade Sequence):`);
  console.log(`  Initial Portfolio: $${initialPortfolio.toFixed(2)}`);
  console.log(`  Position Size: ${(positionSizePercent * 100).toFixed(2)}% of portfolio (weekly)`);
  console.log(`  Final Portfolio: $${finalPortfolio.toFixed(2)}`);
  console.log(`  Compound Growth Factor: ${compoundFactor.toFixed(4)}x`);
  console.log(`\n📊 SIMPLE PnL (No Reinvestment - $100 per trade):`);
  console.log(`  Total Trades: ${sortedTrades.length}`);
  console.log(`  Investment per Trade: $100.00`);
  console.log(`  Total Invested: $${(sortedTrades.length * 100).toFixed(2)}`);
  console.log(`  Total Profit: $${simplePnL >= 0 ? '+' : ''}${simplePnL.toFixed(2)}`);
  console.log(`  Total Return: $${simpleTotalReturn.toFixed(2)}`);
  console.log(
    `  Return %: ${(simpleTotalReturn / (sortedTrades.length * 100) - 1) * 100 >= 0 ? '+' : ''}${((simpleTotalReturn / (sortedTrades.length * 100) - 1) * 100).toFixed(2)}%`
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

test1hCandlesNoReinvestment().catch(console.error);
