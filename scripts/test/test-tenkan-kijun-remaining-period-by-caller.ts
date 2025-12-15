#!/usr/bin/env ts-node
/**
 * Test Tenkan/Kijun Cross Strategy - Remaining Period Only
 * Run analysis for EACH CALLER separately in parallel
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { queryCandles } from '../src/storage/clickhouse-client';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';
import { calculateIndicators, IndicatorData } from '../src/simulation/indicators';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/tenkan-kijun-remaining-period-by-caller');

// Risk modeling options
const CLAMP_MIN_PNL = true; // set to true to enforce a floor on pnl (e.g. 0.8x)
const MIN_PNL = 0.8; // 0.8x = -20% max loss

// Trading costs (realistic Solana DEX costs)
const ENTRY_SLIPPAGE_PCT = 0.75; // 0.75% slippage on entry (worse price)
const EXIT_SLIPPAGE_PCT = 0.75; // 0.75% slippage on exit (worse price)
const TRADING_FEE_PCT = 0.25; // 0.25% trading fee per trade (Raydium/Jupiter typical)

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
  entryPrice: number;
}

// Import the simulation function from the original script
function simulateTenkanKijunFromAlert(
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

  // Find candles within the alert -> 6 hours window
  let alertIndex = 0;
  let sixHourIndex = candles.length;

  for (let i = 0; i < candles.length; i++) {
    const candleTime = candles[i].timestamp
      ? typeof candles[i].timestamp === 'number'
        ? candles[i].timestamp * 1000
        : new Date(candles[i].timestamp).getTime()
      : alertTimestamp;

    if (candleTime >= alertTimestamp && alertIndex === 0) {
      alertIndex = i;
    }

    if (candleTime >= sixHourMark) {
      sixHourIndex = i;
      break;
    }
  }

  // Need at least 52 candles before alert for indicators, and candles up to 6 hours
  if (alertIndex < 52 || sixHourIndex <= alertIndex) {
    return null;
  }

  // Calculate indicators from the beginning (need history before alert)
  const indicatorData: IndicatorData[] = [];
  let previousEMAs: { ema9?: number | null; ema20?: number | null; ema50?: number | null } = {};

  for (let i = 0; i <= sixHourIndex; i++) {
    const indicators = calculateIndicators(candles, i, previousEMAs);
    indicatorData.push(indicators);

    previousEMAs = {
      ema9: indicators.movingAverages.ema9,
      ema20: indicators.movingAverages.ema20,
      ema50: indicators.movingAverages.ema50,
    };
  }

  // Find Tenkan/Kijun cross entry - starting from alert time (not after 6 hours)
  let entryIndex = 0;
  const searchStartIndex = Math.max(alertIndex, 52);

  for (let i = searchStartIndex; i <= sixHourIndex; i++) {
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

  if (entryIndex === 0 || entryIndex < alertIndex) {
    return null;
  }

  // Apply slippage and fees to entry price
  // Entry slippage: pay worse price (higher) = multiply by (1 + slippage)
  // Trading fee: additional cost = multiply by (1 + fee)
  const rawEntryPrice = candles[entryIndex].close;
  const actualEntryPrice =
    rawEntryPrice * (1 + ENTRY_SLIPPAGE_PCT / 100) * (1 + TRADING_FEE_PCT / 100);

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

  const startIndex = entryIndex + 1;
  const endIndex = sixHourIndex; // Only simulate until 6 hours after alert

  if (startIndex > endIndex) {
    return {
      pnl: 1.0,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime,
      exitTime: entryTime,
      entryPrice: actualEntryPrice,
    };
  }

  for (let i = startIndex; i <= endIndex; i++) {
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

    if (previousIndicators?.ichimoku && indicators.ichimoku) {
      const crossedDown =
        previousIndicators.ichimoku.tenkan >= previousIndicators.ichimoku.kijun &&
        indicators.ichimoku.tenkan < indicators.ichimoku.kijun;
      if (crossedDown && remaining > 0) {
        const rawExitPrice = Math.max(effectiveLow, minExitPrice);
        // Apply slippage and fees to exit price
        // Exit slippage: receive worse price (lower) = multiply by (1 - slippage)
        // Trading fee: additional cost = multiply by (1 - fee)
        const exitPrice =
          rawExitPrice * (1 - EXIT_SLIPPAGE_PCT / 100) * (1 - TRADING_FEE_PCT / 100);
        pnl += remaining * (exitPrice / actualEntryPrice);
        remaining = 0;
        exitTime = candleTime;
        exited = true;
        break;
      }
    }

    const targetPrice = actualEntryPrice * 1.5;
    if (!targetsHit.has(1.5) && remaining >= 0.5 && effectiveHigh >= targetPrice) {
      // Partial exit at profit target - apply slippage and fees
      const rawExitPrice = targetPrice;
      const exitPrice = rawExitPrice * (1 - EXIT_SLIPPAGE_PCT / 100) * (1 - TRADING_FEE_PCT / 100);
      const exitMultiplier = exitPrice / actualEntryPrice;
      pnl += 0.5 * exitMultiplier;
      remaining -= 0.5;
      targetsHit.add(1.5);
    }

    // 20% stop loss is enforced - always use minExitPrice (20% down from entry)
    // The Kijun line can be used as a trailing stop, but we never go below minExitPrice
    let currentStopPrice = minExitPrice;
    if (indicators.ichimoku && indicators.ichimoku.kijun > minExitPrice) {
      // Use Kijun as trailing stop if it's above the 20% stop loss floor
      currentStopPrice = indicators.ichimoku.kijun;
    }

    // Check if price hit the stop loss (20% down or Kijun, whichever is higher)
    if (remaining > 0 && effectiveLow <= currentStopPrice) {
      // Exit at the stop price (never below minExitPrice which is 20% down)
      const rawExitPrice = Math.max(currentStopPrice, minExitPrice);
      // Apply slippage and fees to exit price
      // Exit slippage: receive worse price (lower) = multiply by (1 - slippage)
      // Trading fee: additional cost = multiply by (1 - fee)
      const exitPrice = rawExitPrice * (1 - EXIT_SLIPPAGE_PCT / 100) * (1 - TRADING_FEE_PCT / 100);
      pnl += remaining * (exitPrice / actualEntryPrice);
      remaining = 0;
      exitTime = candleTime;
      exited = true;
      break;
    }
  }

  if (remaining > 0) {
    // Exit at 6-hour mark if still holding
    const finalPrice = candles[endIndex].close;
    // Apply stop loss during simulation - exit at minExitPrice if price dropped below it
    const rawExitPrice = Math.max(finalPrice, minExitPrice);
    // Apply slippage and fees to exit price
    // Exit slippage: receive worse price (lower) = multiply by (1 - slippage)
    // Trading fee: additional cost = multiply by (1 - fee)
    const exitPrice = rawExitPrice * (1 - EXIT_SLIPPAGE_PCT / 100) * (1 - TRADING_FEE_PCT / 100);
    pnl += remaining * (exitPrice / actualEntryPrice);
    exitTime = candles[endIndex].timestamp
      ? typeof candles[endIndex].timestamp === 'number'
        ? candles[endIndex].timestamp * 1000
        : new Date(candles[endIndex].timestamp).getTime()
      : sixHourMark;
    exited = true;
  }

  // NOTE: Do NOT cap PnL after simulation - the 20% stop loss is already enforced
  // during the simulation above (minExitPrice = entryPrice * 0.8)
  // Capping here would give incorrect figures if the simulation didn't properly exit

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

function computeMaxDrawdown(equity: number[]) {
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

function computeStdDev(values: number[]) {
  const n = values.length;
  if (n <= 1) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / (n - 1);

  return Math.sqrt(variance);
}

async function analyzeCaller(callerName: string, records: any[]): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ANALYZING CALLER: ${callerName}`);
  console.log(`${'='.repeat(80)}\n`);
  console.log(`💰 Trading Costs Applied:`);
  console.log(`   Entry Slippage: ${ENTRY_SLIPPAGE_PCT}%`);
  console.log(`   Exit Slippage: ${EXIT_SLIPPAGE_PCT}%`);
  console.log(`   Trading Fee: ${TRADING_FEE_PCT}% per trade`);
  console.log(
    `   Total Cost per Round Trip: ~${(ENTRY_SLIPPAGE_PCT + EXIT_SLIPPAGE_PCT + TRADING_FEE_PCT * 2).toFixed(2)}%\n`
  );

  // Filter records for this caller
  const callerRecords = records.filter((r) => {
    const sender = r.sender || '';
    return sender.includes(callerName) || sender === callerName;
  });

  if (callerRecords.length === 0) {
    console.log(`❌ No records found for caller: ${callerName}\n`);
    return;
  }

  console.log(`📂 Found ${callerRecords.length} calls for ${callerName}`);

  // Get unique tokens for this caller
  const uniqueTokens = new Map<string, any>();
  for (const record of callerRecords) {
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

  for (let i = 0; i < uniqueCalls.length; i++) {
    const call = uniqueCalls[i];
    try {
      const chain = call.chain || 'solana';
      const tokenAddress = call.tokenAddress || call.mint;
      if (!tokenAddress) continue;

      const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
      if (!alertTime.isValid) continue;

      // Fetch candles from before alert (for indicators) to 6 hours after alert (simulation window)
      const startTime = alertTime.minus({ hours: 24 }); // Get 24 hours before alert for indicator history
      const endTime = alertTime.plus({ hours: 6 }); // Only simulate until 6 hours after alert

      // Use ClickHouse OHLCV data directly
      // Add delay between queries to avoid overwhelming ClickHouse
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms delay between queries
      }

      const candles = await queryCandles(tokenAddress, chain, startTime, endTime, '5m');

      if (candles.length < 52) {
        insufficientData++;
        continue;
      }

      const result = simulateTenkanKijunFromAlert(candles, alertTime);

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
        entryPrice: result.entryPrice,
      });

      if ((i + 1) % 50 === 0) {
        console.log(`   [${callerName}] Processed ${i + 1}/${uniqueCalls.length} tokens...`);
      }
    } catch (error) {
      // Skip errors
    }
  }

  console.log(`\n✅ [${callerName}] Processed ${uniqueCalls.length} tokens`);
  console.log(`   ✅ Trades found: ${trades.length}`);
  console.log(`   ❌ No cross found: ${noCrossFound}`);
  console.log(`   ⚠️  Insufficient data: ${insufficientData}`);
  console.log(`   📊 Success rate: ${((trades.length / uniqueCalls.length) * 100).toFixed(2)}%\n`);

  if (trades.length === 0) {
    console.log(`❌ [${callerName}] No trades found!\n`);
    return;
  }

  // Filter: Skip callers with less than 20 trades
  if (trades.length < 20) {
    console.log(
      `⏭️  [${callerName}] Skipping - only ${trades.length} trades (minimum 20 required)\n`
    );
    return;
  }

  // Calculate metrics
  const sortedTrades = trades.sort(
    (a, b) => DateTime.fromISO(a.alertTime).toMillis() - DateTime.fromISO(b.alertTime).toMillis()
  );

  const winningTrades = sortedTrades.filter((t) => t.pnl > 1.0).length;
  const losingTrades = sortedTrades.filter((t) => t.pnl <= 1.0).length;
  const winRate = sortedTrades.length > 0 ? winningTrades / sortedTrades.length : 0;

  const totalPnl = sortedTrades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
  const avgPnlPerTrade = sortedTrades.length > 0 ? (totalPnl / sortedTrades.length) * 100 : 0;

  // Calculate reinvestment with moving average for position sizing
  const initialPortfolio = 100;
  const stopLossPercent = 0.2;
  const maxRiskPerTrade = 0.02;

  // CRITICAL: Position sizing based on loss-clamp setting
  // If loss-clamp is ON: max loss is capped at stopLossPercent (20%), so we can size larger
  //   position size = 2% / 20% = 10% of portfolio
  // If loss-clamp is OFF: trades can lose 100%, so position size must be capped at 2%
  //   position size = 2% (worst case: 100% loss = 2% portfolio loss)
  let positionSizePercent: number;
  if (CLAMP_MIN_PNL) {
    // Loss-clamp ON: max loss is stopLossPercent, so we can size at 10%
    positionSizePercent = maxRiskPerTrade / stopLossPercent; // 2% / 20% = 10%
  } else {
    // Loss-clamp OFF: worst case is 100% loss, so position size = max risk = 2%
    positionSizePercent = maxRiskPerTrade; // 2% max position size
    console.log(
      `⚠️  Loss-clamp is OFF - capping position size at ${(positionSizePercent * 100).toFixed(2)}% to maintain 2% max risk per trade`
    );
  }
  const movingAverageWindow = 10; // Use last 10 trades for moving average

  let portfolio = initialPortfolio;
  const portfolioHistory: number[] = [initialPortfolio]; // Track portfolio values for moving average

  // Track daily and weekly portfolio values for both reinvestment and non-reinvestment
  const dailyPortfolioHistory: Array<{
    date: string;
    reinvestment: number;
    noReinvestment: number;
  }> = [];
  const weeklyPortfolioHistory: Array<{
    week: string;
    reinvestment: number;
    noReinvestment: number;
    maxDrawdownReinvestment: number;
    maxDrawdownNoReinvestment: number;
  }> = [];

  // Track non-reinvestment portfolio separately
  const fixedPositionSize = initialPortfolio * positionSizePercent;
  let simplePortfolio = initialPortfolio;
  const simplePortfolioHistory: number[] = [initialPortfolio];

  const reinvestmentHistory: Array<{
    tradeNum: number;
    alertTime: string;
    pnl: number;
    positionSize: number;
    tradeReturn: number;
    portfolioBefore: number;
    portfolioAfter: number;
    movingAvgPortfolio: number;
  }> = [];

  console.log(`\n📊 REINVESTMENT CALCULATION (Verbose):`);
  console.log(`   Initial Portfolio: $${initialPortfolio.toFixed(2)}`);
  console.log(`   Loss-Clamp: ${CLAMP_MIN_PNL ? 'ON' : 'OFF'}`);
  if (CLAMP_MIN_PNL) {
    console.log(
      `   Position Size %: ${(positionSizePercent * 100).toFixed(2)}% (risk: ${(maxRiskPerTrade * 100).toFixed(2)}%, stop loss: ${(stopLossPercent * 100).toFixed(2)}%)`
    );
  } else {
    console.log(
      `   Position Size %: ${(positionSizePercent * 100).toFixed(2)}% (risk: ${(maxRiskPerTrade * 100).toFixed(2)}%, max loss: 100%)`
    );
  }
  console.log(`   Moving Average Window: ${movingAverageWindow} trades`);
  console.log(`   Total Trades: ${sortedTrades.length}\n`);

  let tradeNum = 0;
  for (const trade of sortedTrades) {
    tradeNum++;
    const portfolioBefore = portfolio;

    // Calculate moving average of portfolio for position sizing
    const recentPortfolios = portfolioHistory.slice(-movingAverageWindow);
    const movingAvgPortfolio =
      recentPortfolios.reduce((sum, p) => sum + p, 0) / recentPortfolios.length;

    // Use moving average for position sizing to smooth out volatility
    const currentPositionSize = movingAvgPortfolio * positionSizePercent;
    const tradeReturn = (trade.pnl - 1.0) * currentPositionSize;
    portfolio = portfolio + tradeReturn;
    portfolioHistory.push(portfolio);

    // Track non-reinvestment portfolio
    const simpleTradeReturn = (trade.pnl - 1.0) * fixedPositionSize;
    simplePortfolio = simplePortfolio + simpleTradeReturn;
    simplePortfolioHistory.push(simplePortfolio);

    // Track daily portfolio values
    const tradeDate = DateTime.fromISO(trade.exitTime).toISODate() || '';
    if (tradeDate) {
      const existingDay = dailyPortfolioHistory.find((d) => d.date === tradeDate);
      if (existingDay) {
        existingDay.reinvestment = portfolio;
        existingDay.noReinvestment = simplePortfolio;
      } else {
        dailyPortfolioHistory.push({
          date: tradeDate,
          reinvestment: portfolio,
          noReinvestment: simplePortfolio,
        });
      }
    }

    const pnlPercent = (trade.pnl - 1.0) * 100;
    const returnPercent = (tradeReturn / portfolioBefore) * 100;

    reinvestmentHistory.push({
      tradeNum,
      alertTime: trade.alertTime,
      pnl: trade.pnl,
      positionSize: currentPositionSize,
      tradeReturn,
      portfolioBefore,
      portfolioAfter: portfolio,
      movingAvgPortfolio,
    });

    // Verbose output every 50 trades or for significant trades
    if (tradeNum % 50 === 0 || Math.abs(tradeReturn) > portfolioBefore * 0.05 || tradeNum <= 10) {
      console.log(`   Trade ${tradeNum}: ${trade.alertTime.split('T')[0]}`);
      console.log(
        `      PnL: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% (${trade.pnl.toFixed(4)}x)`
      );
      console.log(
        `      Portfolio: $${portfolioBefore.toFixed(2)} → $${portfolio.toFixed(2)} (${returnPercent >= 0 ? '+' : ''}${returnPercent.toFixed(2)}%)`
      );
      console.log(
        `      Position Size: $${currentPositionSize.toFixed(2)} (from MA: $${movingAvgPortfolio.toFixed(2)})`
      );
      console.log(`      Trade Return: ${tradeReturn >= 0 ? '+' : ''}$${tradeReturn.toFixed(2)}\n`);
    }
  }

  const finalPortfolio = portfolio;
  const compoundFactor = finalPortfolio / initialPortfolio;

  // ---- Risk metrics on the reinvestment equity curve ----
  // Max drawdown will be calculated later for both scenarios

  // Per-trade % returns for volatility
  const perTradeReturnsPct = reinvestmentHistory.map((r) => {
    const before = r.portfolioBefore;
    const after = r.portfolioAfter;
    if (before <= 0) return 0;
    return (after / before - 1) * 100; // percentage
  });

  const stdDevReturnsPct = computeStdDev(perTradeReturnsPct);

  // ---- Per-trade max drawdown and risk metrics ----
  // For each trade, calculate max drawdown (from entry to worst point)
  // Max drawdown per trade = (entryPrice - minPrice) / entryPrice
  // Where minPrice = entryPrice * (1 - (1 - pnl)) if pnl < 1, or entryPrice * (1 - (1/maxReached)) if maxReached > 1
  const perTradeMaxDrawdowns: number[] = [];
  const perTradeRiskRatios: number[] = [];

  for (const trade of sortedTrades) {
    const entryPrice = trade.entryPrice || 1.0; // Fallback if not available
    const pnl = trade.pnl;
    const maxReached = trade.maxReached;

    // Calculate max drawdown for this trade
    // If trade lost money (pnl < 1), the drawdown is (1 - pnl)
    // If trade made money but had a drawdown, it's based on maxReached
    let tradeMaxDrawdown = 0;

    if (pnl < 1.0) {
      // Trade lost money - drawdown is the loss
      tradeMaxDrawdown = (1.0 - pnl) * 100; // as percentage
    } else if (maxReached > 1.0) {
      // Trade made money but may have had drawdowns
      // Worst case: if it reached maxReached but ended at pnl, the drawdown from peak is:
      // But we want drawdown from entry, so if it went up then down:
      // The minimum it could have been is entryPrice (0% drawdown from entry)
      // Actually, we want the worst point from entry during the trade
      // If maxReached > pnl, there was a drawdown from peak
      if (maxReached > pnl) {
        // It reached a higher point but ended lower - drawdown from peak
        const drawdownFromPeak = ((maxReached - pnl) / maxReached) * 100;
        // But from entry perspective, worst case is if it went to entryPrice (0% from entry)
        // Actually, let's calculate: worst price from entry = entryPrice * min(1, pnl/maxReached)
        const worstPriceFromEntry = entryPrice * (pnl / maxReached);
        tradeMaxDrawdown = ((entryPrice - worstPriceFromEntry) / entryPrice) * 100;
      } else {
        // No drawdown from entry (pnl >= maxReached means it ended at or above peak)
        tradeMaxDrawdown = 0;
      }
    } else {
      // Trade made money and no drawdown
      tradeMaxDrawdown = 0;
    }

    perTradeMaxDrawdowns.push(tradeMaxDrawdown);

    // Risk ratio: Reward / Risk
    // Reward = (pnl - 1) if positive, else 0
    // Risk = max drawdown percentage
    const reward = Math.max(0, (pnl - 1.0) * 100); // reward as percentage
    const risk = Math.max(0.01, tradeMaxDrawdown); // avoid divide by zero
    const riskRatio = reward / risk;

    perTradeRiskRatios.push(riskRatio);
  }

  const avgPerTradeMaxDrawdown =
    perTradeMaxDrawdowns.reduce((sum, d) => sum + d, 0) / perTradeMaxDrawdowns.length;
  const maxPerTradeMaxDrawdown = Math.max(...perTradeMaxDrawdowns);
  const avgRiskRatio =
    perTradeRiskRatios.reduce((sum, r) => sum + r, 0) / perTradeRiskRatios.length;
  const medianRiskRatio = perTradeRiskRatios.sort((a, b) => a - b)[
    Math.floor(perTradeRiskRatios.length / 2)
  ];

  // ---- Time-weighted ROI (CAGR-style) ----
  let twrDailyPct = 0;
  let twrWeeklyPct = 0;
  let twrAnnualPct = 0;
  let twrAnnualDrawdownAdjusted = 0;
  let calmarRatio = 0;
  let daysActive = 0;
  let totalGrowth = 0;

  if (sortedTrades.length > 0) {
    const msPerDay = 24 * 60 * 60 * 1000;

    const firstEntryMs = Math.min(
      ...sortedTrades.map((t) => DateTime.fromISO(t.entryTime).toMillis())
    );
    const lastExitMs = Math.max(
      ...sortedTrades.map((t) => DateTime.fromISO(t.exitTime).toMillis())
    );

    // avoid divide-by-zero if everything happens same day
    const daysActiveRaw = (lastExitMs - firstEntryMs) / msPerDay;
    daysActive = Math.max(1, daysActiveRaw);

    totalGrowth = finalPortfolio / initialPortfolio;

    // Calculate daily TWR (geometric mean of daily returns)
    twrDailyPct = (Math.pow(totalGrowth, 1 / daysActive) - 1) * 100;

    // Weekly TWR (7 days compounded)
    twrWeeklyPct = (Math.pow(totalGrowth, 7 / daysActive) - 1) * 100;

    // Annualized TWR: compound the daily rate for 365 days
    // This is mathematically correct but can be misleading - it assumes you can maintain
    // the same daily return for a full year, which is unrealistic
    // Formula: (1 + daily_rate)^365 - 1
    const dailyRate = Math.pow(totalGrowth, 1 / daysActive) - 1;
    twrAnnualPct = (Math.pow(1 + dailyRate, 365) - 1) * 100;
  }

  // Calculate max drawdown for both scenarios
  const { maxDrawdown: maxDrawdownReinvestment, maxDrawdownPct: maxDrawdownPctReinvestment } =
    computeMaxDrawdown(portfolioHistory);
  const { maxDrawdown: maxDrawdownNoReinvestment, maxDrawdownPct: maxDrawdownPctNoReinvestment } =
    computeMaxDrawdown(simplePortfolioHistory);

  // Calculate realistic annualized return based on actual compounding performance
  // Method: Start with $100, apply daily rate with perfect compounding for observed period,
  // compare to actual result, calculate reduction factor, apply to annual projection
  if (twrAnnualPct > 0 && daysActive > 0 && totalGrowth > 0) {
    const dailyRate = Math.pow(totalGrowth, 1 / daysActive) - 1; // e.g., 0.0089 for 0.89%

    // Step 1: Start with $100, apply perfect compounding of daily rate for 'daysActive' days
    const theoreticalValueAfterPeriod = 100 * Math.pow(1 + dailyRate, daysActive);
    // e.g., $100 * (1.0089)^108 = theoretical value

    // Step 2: What did we actually get? (finalPortfolio from $100 initial)
    const actualValueAfterPeriod = 100 * totalGrowth; // e.g., $100 * 2.6187 = $261.87

    // Step 3: Calculate reduction factor (how much did reality differ from perfect compounding?)
    // Note: Since dailyRate is derived from actual result, these should be very close
    // But we account for the fact that perfect daily compounding is unrealistic
    const reductionFactor = actualValueAfterPeriod / theoreticalValueAfterPeriod;

    // Step 4: Apply reduction factor to annualized projection
    // This scales the annual projection by how well compounding worked in practice
    twrAnnualDrawdownAdjusted = twrAnnualPct * reductionFactor;

    // Calmar Ratio: Annual Return / Max Drawdown %
    // Higher is better - shows return per unit of drawdown risk
    if (maxDrawdownPctReinvestment > 0) {
      calmarRatio = twrAnnualPct / maxDrawdownPctReinvestment;
    }
  } else if (twrAnnualPct > 0) {
    // Fallback: simple linear scaling if we don't have enough data
    twrAnnualDrawdownAdjusted = twrDailyPct * 365;
    if (maxDrawdownPctReinvestment > 0) {
      calmarRatio = twrAnnualPct / maxDrawdownPctReinvestment;
    }
  }

  // Calculate final portfolio values (already calculated above, but ensure consistency)
  const simpleFinalPortfolio =
    simplePortfolioHistory[simplePortfolioHistory.length - 1] || initialPortfolio;
  const simpleReturnPercent = (simpleFinalPortfolio / initialPortfolio - 1) * 100;

  // Generate weekly summary
  const weeklyMap = new Map<string, { reinvestment: number[]; noReinvestment: number[] }>();

  for (let i = 0; i < sortedTrades.length; i++) {
    const trade = sortedTrades[i];
    const exitDate = DateTime.fromISO(trade.exitTime);
    const weekStart = exitDate.startOf('week').toISODate() || '';

    if (weekStart) {
      if (!weeklyMap.has(weekStart)) {
        weeklyMap.set(weekStart, { reinvestment: [], noReinvestment: [] });
      }
      const weekData = weeklyMap.get(weekStart)!;
      // Get portfolio value at this trade's exit
      const reinvestmentValue =
        portfolioHistory[i + 1] || portfolioHistory[portfolioHistory.length - 1];
      const noReinvestmentValue =
        simplePortfolioHistory[i + 1] || simplePortfolioHistory[simplePortfolioHistory.length - 1];
      weekData.reinvestment.push(reinvestmentValue);
      weekData.noReinvestment.push(noReinvestmentValue);
    }
  }

  // Calculate weekly values and max drawdowns
  for (const [weekStart, values] of weeklyMap.entries()) {
    const weekReinvestment =
      values.reinvestment[values.reinvestment.length - 1] || initialPortfolio;
    const weekNoReinvestment =
      values.noReinvestment[values.noReinvestment.length - 1] || initialPortfolio;

    // Calculate max drawdown for this week's reinvestment values
    const weekMaxDrawdownReinvestment =
      values.reinvestment.length > 0 ? computeMaxDrawdown(values.reinvestment).maxDrawdownPct : 0;
    const weekMaxDrawdownNoReinvestment =
      values.noReinvestment.length > 0
        ? computeMaxDrawdown(values.noReinvestment).maxDrawdownPct
        : 0;

    weeklyPortfolioHistory.push({
      week: weekStart,
      reinvestment: weekReinvestment,
      noReinvestment: weekNoReinvestment,
      maxDrawdownReinvestment: weekMaxDrawdownReinvestment,
      maxDrawdownNoReinvestment: weekMaxDrawdownNoReinvestment,
    });
  }

  // Sort weekly history by date
  weeklyPortfolioHistory.sort((a, b) => a.week.localeCompare(b.week));

  // Save results
  const safeCallerName = callerName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const callerOutputDir = path.join(OUTPUT_DIR, safeCallerName);
  if (!fs.existsSync(callerOutputDir)) {
    fs.mkdirSync(callerOutputDir, { recursive: true });
  }

  // Save trade history
  const tradeHistoryPath = path.join(callerOutputDir, 'complete_trade_history.csv');
  const tradeHistoryRows = sortedTrades.map((t, idx) => ({
    TradeNumber: idx + 1,
    TokenAddress: t.tokenAddress,
    AlertTime: t.alertTime,
    EntryTime: t.entryTime,
    ExitTime: t.exitTime,
    EntryPrice: t.entryPrice ? t.entryPrice.toFixed(8) : '',
    ExitPrice: t.entryPrice && t.pnl ? (t.entryPrice * t.pnl).toFixed(8) : '',
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
  const reinvestmentPath = path.join(callerOutputDir, 'reinvestment_history.csv');
  const reinvestmentRows = reinvestmentHistory.map((r) => ({
    TradeNumber: r.tradeNum,
    AlertTime: r.alertTime,
    PnL: r.pnl.toFixed(6),
    PositionSize: r.positionSize.toFixed(2),
    TradeReturn: r.tradeReturn.toFixed(2),
    PortfolioBefore: r.portfolioBefore.toFixed(2),
    PortfolioAfter: r.portfolioAfter.toFixed(2),
    MovingAvgPortfolio: r.movingAvgPortfolio.toFixed(2),
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

  // Save daily summary
  const dailySummaryPath = path.join(callerOutputDir, 'daily_summary.csv');
  const dailySummaryRows = dailyPortfolioHistory.map((d) => ({
    Date: d.date,
    PortfolioValue_Reinvestment: d.reinvestment.toFixed(2),
    PortfolioValue_NoReinvestment: d.noReinvestment.toFixed(2),
    Return_Reinvestment: ((d.reinvestment / initialPortfolio - 1) * 100).toFixed(2),
    Return_NoReinvestment: ((d.noReinvestment / initialPortfolio - 1) * 100).toFixed(2),
  }));

  await new Promise<void>((resolve, reject) => {
    stringify(dailySummaryRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(dailySummaryPath, output);
        resolve();
      }
    });
  });

  // Save weekly summary
  const weeklySummaryPath = path.join(callerOutputDir, 'weekly_summary.csv');
  const weeklySummaryRows = weeklyPortfolioHistory.map((w) => ({
    Week: w.week,
    PortfolioValue_Reinvestment: w.reinvestment.toFixed(2),
    PortfolioValue_NoReinvestment: w.noReinvestment.toFixed(2),
    Return_Reinvestment: ((w.reinvestment / initialPortfolio - 1) * 100).toFixed(2),
    Return_NoReinvestment: ((w.noReinvestment / initialPortfolio - 1) * 100).toFixed(2),
    MaxDrawdown_Reinvestment: w.maxDrawdownReinvestment.toFixed(2),
    MaxDrawdown_NoReinvestment: w.maxDrawdownNoReinvestment.toFixed(2),
  }));

  await new Promise<void>((resolve, reject) => {
    stringify(weeklySummaryRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(weeklySummaryPath, output);
        resolve();
      }
    });
  });

  // Save summary
  const summaryPath = path.join(callerOutputDir, 'summary.json');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        caller: callerName,
        totalCalls: callerRecords.length,
        uniqueTokens: uniqueCalls.length,
        totalTrades: sortedTrades.length,
        winRate: winRate * 100,
        winningTrades,
        losingTrades,
        avgPnlPerTrade,
        // With reinvestment
        finalPortfolio,
        compoundFactor,
        maxDrawdown: maxDrawdownReinvestment,
        maxDrawdownPct: maxDrawdownPctReinvestment,
        // Without reinvestment
        simpleFinalPortfolio,
        simpleReturnPercent,
        maxDrawdownNoReinvestment,
        maxDrawdownPctNoReinvestment,
        initialPortfolio,
        // Risk metrics (reinvestment)
        stdDevReturnsPct,
        peakPortfolio: Math.max(...portfolioHistory),
        // Per-trade risk metrics
        avgPerTradeMaxDrawdown,
        maxPerTradeMaxDrawdown,
        avgRiskRatio,
        medianRiskRatio,
        // Time-weighted ROI
        daysActive,
        twrDailyPct,
        twrWeeklyPct,
        twrAnnualPct,
        twrAnnualDrawdownAdjusted,
        calmarRatio,
        riskAdjustedScore: stdDevReturnsPct > 0 ? twrDailyPct / stdDevReturnsPct : 0,
        clampMinPnlEnabled: CLAMP_MIN_PNL,
        minPnlFloor: MIN_PNL,
      },
      null,
      2
    )
  );

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ [${callerName}] ANALYSIS COMPLETE`);
  console.log(`${'='.repeat(80)}`);
  console.log(`\n📈 TRADE STATISTICS:`);
  console.log(`   Total Trades: ${sortedTrades.length}`);
  console.log(`   Winning Trades: ${winningTrades} (${(winRate * 100).toFixed(2)}%)`);
  console.log(
    `   Losing Trades: ${losingTrades} (${((losingTrades / sortedTrades.length) * 100).toFixed(2)}%)`
  );
  console.log(
    `   Average PnL per Trade: ${avgPnlPerTrade >= 0 ? '+' : ''}${avgPnlPerTrade.toFixed(2)}%`
  );

  const totalReturn = sortedTrades.reduce((sum, t) => sum + (t.pnl - 1.0), 0) * 100;
  console.log(
    `   Total Return (sum of all trades): ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`
  );

  console.log(`\n💰 PORTFOLIO PERFORMANCE:`);
  console.log(`   Initial Portfolio: $${initialPortfolio.toFixed(2)}`);
  console.log(`\n   📊 WITH REINVESTMENT (Per-Trade, Moving Average Position Sizing):`);
  console.log(`      Final Portfolio: $${finalPortfolio.toFixed(2)}`);
  console.log(`      Total Growth: ${compoundFactor.toFixed(4)}x`);
  console.log(`      Total Return: ${((compoundFactor - 1) * 100).toFixed(2)}%`);
  console.log(`      Profit: $${(finalPortfolio - initialPortfolio).toFixed(2)}`);

  console.log(`\n   📊 WITHOUT REINVESTMENT (Fixed $${fixedPositionSize.toFixed(2)} per trade):`);
  console.log(`      Final Portfolio: $${simpleFinalPortfolio.toFixed(2)}`);
  console.log(
    `      Total Return: ${simpleReturnPercent >= 0 ? '+' : ''}${simpleReturnPercent.toFixed(2)}%`
  );
  console.log(`      Profit: $${(simpleFinalPortfolio - initialPortfolio).toFixed(2)}`);

  const reinvestmentBenefit = finalPortfolio - simpleFinalPortfolio;
  const reinvestmentBenefitPercent = (finalPortfolio / simpleFinalPortfolio - 1) * 100;
  console.log(`\n   💡 REINVESTMENT BENEFIT:`);
  console.log(`      Additional Profit: $${reinvestmentBenefit.toFixed(2)}`);
  console.log(
    `      Benefit %: ${reinvestmentBenefitPercent >= 0 ? '+' : ''}${reinvestmentBenefitPercent.toFixed(2)}%`
  );

  // Risk metrics
  console.log(`\n📉 RISK METRICS:`);
  console.log(`   WITH REINVESTMENT:`);
  console.log(
    `      Portfolio Max Drawdown: $${maxDrawdownReinvestment.toFixed(2)} (${maxDrawdownPctReinvestment.toFixed(2)}%)`
  );
  console.log(`      Peak Portfolio: $${Math.max(...portfolioHistory).toFixed(2)}`);
  console.log(`   WITHOUT REINVESTMENT:`);
  console.log(
    `      Portfolio Max Drawdown: $${maxDrawdownNoReinvestment.toFixed(2)} (${maxDrawdownPctNoReinvestment.toFixed(2)}%)`
  );
  console.log(`      Peak Portfolio: $${Math.max(...simplePortfolioHistory).toFixed(2)}`);
  console.log(`   Std Dev of per-trade returns: ${stdDevReturnsPct.toFixed(2)}%`);

  // Per-trade risk metrics
  console.log(`\n📉 PER-TRADE RISK METRICS:`);
  console.log(`   Avg Max Drawdown per Trade: ${avgPerTradeMaxDrawdown.toFixed(2)}%`);
  console.log(`   Worst Trade Drawdown: ${maxPerTradeMaxDrawdown.toFixed(2)}%`);
  console.log(`   Avg Risk Ratio (Reward/Risk): ${avgRiskRatio.toFixed(2)}`);
  console.log(`   Median Risk Ratio: ${medianRiskRatio.toFixed(2)}`);

  // Time-weighted ROI
  console.log(`\n⏱ TIME-WEIGHTED RETURNS:`);
  console.log(`   Active days: ${daysActive.toFixed(2)}`);
  console.log(`   Daily TWR: ${twrDailyPct >= 0 ? '+' : ''}${twrDailyPct.toFixed(2)}%`);
  console.log(`   Weekly TWR: ${twrWeeklyPct >= 0 ? '+' : ''}${twrWeeklyPct.toFixed(2)}%`);
  console.log(
    `   Annualized TWR (compounded, theoretical): ${twrAnnualPct >= 0 ? '+' : ''}${twrAnnualPct.toFixed(2)}%`
  );
  if (twrAnnualDrawdownAdjusted > 0 && totalGrowth > 0) {
    const dailyRate = Math.pow(totalGrowth, 1 / daysActive) - 1;
    const theoreticalValue = 100 * Math.pow(1 + dailyRate, daysActive);
    const actualValue = 100 * totalGrowth;
    const reductionFactor = actualValue / theoreticalValue;

    console.log(
      `   Annualized TWR (realistic projection): ${twrAnnualDrawdownAdjusted >= 0 ? '+' : ''}${twrAnnualDrawdownAdjusted.toFixed(2)}%`
    );
    console.log(
      `      Reduction factor from ${daysActive.toFixed(1)}-day period: ${reductionFactor.toFixed(4)}`
    );
    console.log(
      `      (Theoretical: $${theoreticalValue.toFixed(2)}, Actual: $${actualValue.toFixed(2)})`
    );
    console.log(
      `   Calmar Ratio: ${calmarRatio.toFixed(2)} (annual return / max drawdown, higher = better)`
    );
  }
  console.log(
    `   ⚠️  Note: Compounded assumes same ${twrDailyPct.toFixed(2)}% daily return for 365 days (unrealistic).`
  );
  console.log(
    `      Realistic projection applies observed compounding efficiency to annual projection.`
  );

  // Risk-adjusted score
  const riskAdjustedScore = stdDevReturnsPct > 0 ? twrDailyPct / stdDevReturnsPct : 0;
  console.log(`\n📊 RISK-ADJUSTED METRICS:`);
  console.log(
    `   TWR/Volatility Score: ${riskAdjustedScore.toFixed(2)} (higher = better risk-adjusted returns)`
  );

  console.log(`\n📁 FILES SAVED:`);
  console.log(`   - complete_trade_history.csv (with EntryPrice and ExitPrice)`);
  console.log(`   - reinvestment_history.csv`);
  console.log(`   - daily_summary.csv (daily portfolio values for both scenarios)`);
  console.log(`   - weekly_summary.csv (weekly portfolio values and max drawdowns)`);
  console.log(`   - summary.json`);
  console.log(`${'='.repeat(80)}\n`);
}

async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🔬 TENKAN/KIJUN CROSS - REMAINING PERIOD ONLY BY CALLER');
  console.log('📊 Running parallel analysis for each caller');
  console.log(`${'='.repeat(80)}\n`);

  // Load all calls data
  console.log('📂 Loading calls data...');
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  // Get all unique callers
  const callers = new Set<string>();
  for (const record of records) {
    const sender = record.sender || '';
    if (sender && sender.trim()) {
      // Clean up caller name (take first part before newline if exists)
      const cleanCaller = sender.split('\n')[0].trim();
      if (cleanCaller) {
        callers.add(cleanCaller);
      }
    }
  }

  const callerList = Array.from(callers).sort();
  console.log(`✅ Found ${callerList.length} unique callers\n`);

  // Filter to top 5 callers only (exact matches or specific patterns)
  const TOP_CALLERS = [
    'Brook', // Exact match for "Brook" (not "Brook Giga" or other variants)
    'Brook Giga I verify @BrookCalls', // Exact match for Brook Giga
    'Mistor',
    'exy',
    'meta_maxist',
  ];

  // Match callers to top 5 - prioritize exact matches, then check for "Brook Giga" specifically
  const filteredCallers = callerList.filter((caller) => {
    // Exact match first
    if (TOP_CALLERS.includes(caller)) {
      return true;
    }

    // Special handling for Brook Giga variants
    const callerLower = caller.toLowerCase();
    if (callerLower.includes('brook') && callerLower.includes('giga')) {
      return true; // Include any Brook Giga variant
    }

    // Check for meta_maxist variants
    if (callerLower.includes('meta') && callerLower.includes('maxist')) {
      return true;
    }

    // For others, check if caller name contains the top caller name
    return TOP_CALLERS.some((top) => {
      if (top === 'Brook' && callerLower.includes('brook') && !callerLower.includes('giga')) {
        return true; // Brook but not Brook Giga
      }
      const topLower = top.toLowerCase();
      return callerLower === topLower || (callerLower.includes(topLower) && top !== 'Brook');
    });
  });

  console.log(`📊 Filtering to top 5 callers only:`);
  filteredCallers.forEach((c) => console.log(`   - ${c}`));
  console.log(
    `\n🚀 Starting sequential analysis for ${filteredCallers.length} callers (to avoid ClickHouse connection issues)...\n`
  );

  // Process callers sequentially to avoid overwhelming ClickHouse with concurrent connections
  for (const caller of filteredCallers) {
    await analyzeCaller(caller, records);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('✅ ALL CALLER ANALYSES COMPLETE');
  console.log(`${'='.repeat(80)}\n`);

  // Create consolidated summary table
  console.log('📊 Creating consolidated summary table...');
  await createConsolidatedSummary();

  console.log(`\nResults saved to: ${OUTPUT_DIR}`);
  console.log(`Each caller has their own directory with trade history and reinvestment data.`);
  console.log(`Consolidated summary table: ${path.join(OUTPUT_DIR, 'all_callers_summary.csv')}\n`);
}

async function createConsolidatedSummary(): Promise<void> {
  const summaries: any[] = [];

  // Get all caller directories
  const callerDirs = fs
    .readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const callerDir of callerDirs) {
    const summaryPath = path.join(OUTPUT_DIR, callerDir, 'summary.json');
    if (!fs.existsSync(summaryPath)) continue;

    try {
      const summaryJson = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      summaries.push({
        Caller: summaryJson.caller || callerDir,
        TotalCalls: summaryJson.totalCalls || 0,
        UniqueTokens: summaryJson.uniqueTokens || 0,
        TotalTrades: summaryJson.totalTrades || 0,
        WinRate: summaryJson.winRate ? summaryJson.winRate.toFixed(2) : '0.00',
        WinningTrades: summaryJson.winningTrades || 0,
        LosingTrades: summaryJson.losingTrades || 0,
        AvgPnlPerTrade: summaryJson.avgPnlPerTrade ? summaryJson.avgPnlPerTrade.toFixed(2) : '0.00',
        InitialPortfolio: summaryJson.initialPortfolio
          ? summaryJson.initialPortfolio.toFixed(2)
          : '100.00',
        FinalPortfolio_Reinvestment: summaryJson.finalPortfolio
          ? summaryJson.finalPortfolio.toFixed(2)
          : '100.00',
        TotalReturn_Reinvestment:
          summaryJson.finalPortfolio && summaryJson.initialPortfolio
            ? ((summaryJson.finalPortfolio / summaryJson.initialPortfolio - 1) * 100).toFixed(2)
            : '0.00',
        FinalPortfolio_NoReinvestment: summaryJson.simpleFinalPortfolio
          ? summaryJson.simpleFinalPortfolio.toFixed(2)
          : '100.00',
        TotalReturn_NoReinvestment: summaryJson.simpleReturnPercent
          ? summaryJson.simpleReturnPercent.toFixed(2)
          : '0.00',
        MaxDrawdown_Reinvestment: summaryJson.maxDrawdownPct
          ? summaryJson.maxDrawdownPct.toFixed(2)
          : '0.00',
        MaxDrawdown_NoReinvestment: summaryJson.maxDrawdownPctNoReinvestment
          ? summaryJson.maxDrawdownPctNoReinvestment.toFixed(2)
          : '0.00',
        StdDevReturns: summaryJson.stdDevReturnsPct
          ? summaryJson.stdDevReturnsPct.toFixed(2)
          : '0.00',
        DaysActive: summaryJson.daysActive ? summaryJson.daysActive.toFixed(2) : '0.00',
        DailyTWR: summaryJson.twrDailyPct ? summaryJson.twrDailyPct.toFixed(2) : '0.00',
        WeeklyTWR: summaryJson.twrWeeklyPct ? summaryJson.twrWeeklyPct.toFixed(2) : '0.00',
        AnnualTWR_Theoretical: summaryJson.twrAnnualPct
          ? summaryJson.twrAnnualPct.toFixed(2)
          : '0.00',
        AnnualTWR_Realistic: summaryJson.twrAnnualDrawdownAdjusted
          ? summaryJson.twrAnnualDrawdownAdjusted.toFixed(2)
          : '0.00',
        CalmarRatio: summaryJson.calmarRatio ? summaryJson.calmarRatio.toFixed(2) : '0.00',
        RiskAdjustedScore: summaryJson.riskAdjustedScore
          ? summaryJson.riskAdjustedScore.toFixed(2)
          : '0.00',
        AvgPerTradeMaxDrawdown: summaryJson.avgPerTradeMaxDrawdown
          ? summaryJson.avgPerTradeMaxDrawdown.toFixed(2)
          : '0.00',
        MaxPerTradeMaxDrawdown: summaryJson.maxPerTradeMaxDrawdown
          ? summaryJson.maxPerTradeMaxDrawdown.toFixed(2)
          : '0.00',
        AvgRiskRatio: summaryJson.avgRiskRatio ? summaryJson.avgRiskRatio.toFixed(2) : '0.00',
        MedianRiskRatio: summaryJson.medianRiskRatio
          ? summaryJson.medianRiskRatio.toFixed(2)
          : '0.00',
      });
    } catch (error) {
      console.warn(`⚠️  Failed to load summary for ${callerDir}: ${error}`);
    }
  }

  // Sort by final portfolio (reinvestment) descending
  summaries.sort(
    (a, b) => parseFloat(b.FinalPortfolio_Reinvestment) - parseFloat(a.FinalPortfolio_Reinvestment)
  );

  // Write to CSV
  const summaryCsvPath = path.join(OUTPUT_DIR, 'all_callers_summary.csv');
  await new Promise<void>((resolve, reject) => {
    stringify(summaries, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(summaryCsvPath, output);
        resolve();
      }
    });
  });

  console.log(`✅ Consolidated summary saved: ${summaryCsvPath}`);
  console.log(`   ${summaries.length} callers included`);
}

main().catch(console.error);
