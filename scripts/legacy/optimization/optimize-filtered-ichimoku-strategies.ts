#!/usr/bin/env ts-node
/**
 * Filtered Strategy Optimization with Ichimoku Indicators
 * 
 * Combines:
 * - Chain filters (Solana, BSC, Ethereum)
 * - Caller filters (Brook Giga, Exy, etc.)
 * - Caller-specific market cap filters
 * - Ichimoku Cloud indicators for entry/exit
 * - Multi-timeframe analysis (1m lead indicator)
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
const OUTPUT_DIR = path.join(__dirname, '../data/exports/filtered-ichimoku-optimization');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface FilterConfig {
  // Chain filters
  allowedChains?: string[];
  excludedChains?: string[];
  
  // Caller filters
  allowedCallers?: string[];
  excludedCallers?: string[];
  
  // Market cap filters
  minMarketCap?: number;
  maxMarketCap?: number;
  
  // Caller-specific market cap filters
  callerMarketCapFilters?: {
    [callerName: string]: {
      minMarketCap?: number;
      maxMarketCap?: number;
    };
  };
  
  // Stop loss filters
  minStopLoss?: number;
  maxStopLoss?: number;
  
  // Multi-timeframe
  useMultiTimeframe?: boolean;
  timeframeSignalPeriod?: number;
}

interface StrategyParams {
  name: string;
  
  // Ichimoku entry conditions
  requireIchimokuBullish?: boolean; // Price above cloud
  requireIchimokuCloudCross?: boolean; // Price crosses above cloud
  requireTenkanKijunCross?: boolean; // Tenkan crosses above Kijun
  requireTenkanAboveKijun?: boolean; // Tenkan already above Kijun
  
  // Ichimoku exit conditions
  exitOnIchimokuBearish?: boolean; // Price below cloud
  exitOnIchimokuCloudCrossDown?: boolean; // Price crosses below cloud
  exitOnTenkanKijunCrossDown?: boolean; // Tenkan crosses below Kijun
  
  // Profit targets (ladder exits)
  profitTargets: Array<{ target: number; percent: number }>;
  
  // Stop loss
  initialStopPercent: number;
  stopLossAtKijun?: boolean;
  stopLossAtCloudBottom?: boolean;
  stopLossAtSMA20?: boolean;
  
  // Trailing stop
  trailingStopPercent?: number;
  trailingStopActivation?: number;
  
  minExitPrice: number;
  
  // Filters
  filters: FilterConfig;
}

interface TradeResult {
  tokenAddress: string;
  alertTime: string;
  entryTime: string;
  pnl: number;
  pnlPercent: number;
  maxReached: number;
  holdDuration: number;
  passedFilters: boolean;
  entryReason: string;
  exitReason: string;
}

/**
 * Estimate market cap from candles
 */
function estimateMarketCap(candles: any[]): number | null {
  if (candles.length === 0) return null;
  const avgVolume = candles.reduce((sum, c) => sum + (c.volume || 0), 0) / candles.length;
  const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
  const estimatedMcap = avgVolume * avgPrice * 10;
  return estimatedMcap;
}

/**
 * Check if token passes filters
 */
function passesFilters(
  candles: any[],
  filters: FilterConfig,
  stopLossPercent: number,
  chain?: string,
  caller?: string
): { passes: boolean; reason: string; marketCap?: number } {
  // Chain filter
  if (filters.allowedChains && filters.allowedChains.length > 0) {
    const normalizedChain = (chain || '').toLowerCase();
    const normalizedAllowed = filters.allowedChains.map(c => c.toLowerCase());
    if (!normalizedAllowed.includes(normalizedChain)) {
      return { passes: false, reason: `Chain ${chain} not allowed` };
    }
  }
  
  if (filters.excludedChains && filters.excludedChains.length > 0) {
    const normalizedChain = (chain || '').toLowerCase();
    const normalizedExcluded = filters.excludedChains.map(c => c.toLowerCase());
    if (normalizedExcluded.includes(normalizedChain)) {
      return { passes: false, reason: `Chain ${chain} excluded` };
    }
  }
  
  // Caller filter
  if (filters.allowedCallers && filters.allowedCallers.length > 0) {
    const normalizedCaller = (caller || '').trim();
    const normalizedAllowed = filters.allowedCallers.map(c => c.trim());
    const matches = normalizedAllowed.some(allowed => 
      normalizedCaller.toLowerCase() === allowed.toLowerCase() ||
      normalizedCaller.toLowerCase().includes(allowed.toLowerCase())
    );
    if (!matches) {
      return { passes: false, reason: `Caller "${caller}" not allowed` };
    }
  }
  
  // Estimate market cap
  const mcap = estimateMarketCap(candles);
  
  // Global market cap filter
  if (mcap !== null) {
    if (filters.minMarketCap && mcap < filters.minMarketCap) {
      return { passes: false, reason: `Market cap ${mcap.toFixed(0)} < ${filters.minMarketCap}` };
    }
    if (filters.maxMarketCap && mcap > filters.maxMarketCap) {
      return { passes: false, reason: `Market cap ${mcap.toFixed(0)} > ${filters.maxMarketCap}` };
    }
  }
  
  // Caller-specific market cap filters
  if (caller && filters.callerMarketCapFilters) {
    const callerFilters = filters.callerMarketCapFilters[caller];
    if (callerFilters) {
      if (mcap === null) {
        return { passes: false, reason: `Cannot estimate market cap` };
      }
      if (callerFilters.minMarketCap && mcap < callerFilters.minMarketCap) {
        return { passes: false, reason: `Caller mcap ${mcap.toFixed(0)} < ${callerFilters.minMarketCap}` };
      }
      if (callerFilters.maxMarketCap && mcap > callerFilters.maxMarketCap) {
        return { passes: false, reason: `Caller mcap ${mcap.toFixed(0)} > ${callerFilters.maxMarketCap}` };
      }
    }
  }
  
  // Stop loss filter
  if (filters.minStopLoss && stopLossPercent < filters.minStopLoss) {
    return { passes: false, reason: `Stop loss too tight` };
  }
  if (filters.maxStopLoss && stopLossPercent > filters.maxStopLoss) {
    return { passes: false, reason: `Stop loss too wide` };
  }
  
  return { passes: true, reason: 'Passed all filters', marketCap: mcap || undefined };
}

/**
 * Fetch multi-timeframe candles
 */
async function fetchMultiTimeframeCandles(
  tokenAddress: string,
  alertTime: DateTime,
  endTime: DateTime,
  chain: string
): Promise<{ candles1m: any[]; candles5m: any[] }> {
  const candles5m = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
  
  // Simulate 1m candles (in production, fetch actual 1m candles)
  const candles1m: any[] = [];
  for (let i = 0; i < candles5m.length; i++) {
    const candle5m = candles5m[i];
    const candleTime = candle5m.timestamp
      ? typeof candle5m.timestamp === 'number'
        ? candle5m.timestamp
        : new Date(candle5m.timestamp).getTime()
      : Date.now();
    
    for (let j = 0; j < 5; j++) {
      candles1m.push({
        ...candle5m,
        timestamp: candleTime + (j * 60 * 1000),
        time: candleTime + (j * 60 * 1000),
      });
    }
  }
  
  return { candles1m, candles5m };
}

/**
 * Check 1m timeframe for early signals
 */
function check1mTimeframeSignals(
  candles1m: any[],
  lookbackMinutes: number = 15
): { bullishSignal: boolean; bearishSignal: boolean; reason: string } {
  if (candles1m.length < lookbackMinutes) {
    return { bullishSignal: false, bearishSignal: false, reason: 'Insufficient 1m data' };
  }
  
  const recentCandles = candles1m.slice(-lookbackMinutes);
  const firstPrice = recentCandles[0].close;
  const lastPrice = recentCandles[recentCandles.length - 1].close;
  const priceChange = (lastPrice - firstPrice) / firstPrice;
  
  if (priceChange > 0.05) {
    return { bullishSignal: true, bearishSignal: false, reason: `1m bullish: +${(priceChange*100).toFixed(1)}%` };
  }
  if (priceChange < -0.05) {
    return { bullishSignal: false, bearishSignal: true, reason: `1m bearish: ${(priceChange*100).toFixed(1)}%` };
  }
  
  return { bullishSignal: false, bearishSignal: false, reason: 'No strong 1m signal' };
}

/**
 * Check Ichimoku entry conditions
 */
function checkIchimokuEntry(
  indicators: IndicatorData,
  previousIndicators: IndicatorData | null,
  params: StrategyParams
): { canEnter: boolean; reason: string } {
  if (!indicators.ichimoku) {
    return { canEnter: false, reason: 'No Ichimoku data' };
  }

  const reasons: string[] = [];
  
  // Require price above cloud
  if (params.requireIchimokuBullish) {
    if (!indicators.ichimoku.isBullish) {
      return { canEnter: false, reason: 'Price not above Ichimoku cloud' };
    }
    reasons.push('Price above cloud');
  }
  
  // Require cloud cross up
  if (params.requireIchimokuCloudCross && previousIndicators?.ichimoku) {
    const crossedUp = !previousIndicators.ichimoku.isBullish && indicators.ichimoku.isBullish;
    if (!crossedUp) {
      return { canEnter: false, reason: 'No cloud cross up' };
    }
    reasons.push('Cloud cross up');
  }
  
  // Require Tenkan/Kijun cross up
  if (params.requireTenkanKijunCross && previousIndicators?.ichimoku) {
    const crossedUp = previousIndicators.ichimoku.tenkan <= previousIndicators.ichimoku.kijun &&
                      indicators.ichimoku.tenkan > indicators.ichimoku.kijun;
    if (!crossedUp) {
      return { canEnter: false, reason: 'No Tenkan/Kijun cross up' };
    }
    reasons.push('Tenkan/Kijun cross up');
  }
  
  // Require Tenkan already above Kijun
  if (params.requireTenkanAboveKijun) {
    if (indicators.ichimoku.tenkan <= indicators.ichimoku.kijun) {
      return { canEnter: false, reason: 'Tenkan not above Kijun' };
    }
    reasons.push('Tenkan > Kijun');
  }
  
  return { canEnter: reasons.length > 0 || !params.requireTenkanKijunCross, reason: reasons.join(', ') || 'Ichimoku entry' };
}

/**
 * Check Ichimoku exit conditions
 */
function checkIchimokuExit(
  indicators: IndicatorData,
  previousIndicators: IndicatorData | null,
  params: StrategyParams
): { shouldExit: boolean; reason: string } {
  if (!indicators.ichimoku) {
    return { shouldExit: false, reason: '' };
  }

  // Exit on bearish cloud
  if (params.exitOnIchimokuBearish && indicators.ichimoku.isBearish) {
    return { shouldExit: true, reason: 'Price below Ichimoku cloud' };
  }
  
  // Exit on cloud cross down
  if (params.exitOnIchimokuCloudCrossDown && previousIndicators?.ichimoku) {
    const crossedDown = previousIndicators.ichimoku.isBullish && indicators.ichimoku.isBearish;
    if (crossedDown) {
      return { shouldExit: true, reason: 'Cloud cross down' };
    }
  }
  
  // Exit on Tenkan/Kijun cross down
  if (params.exitOnTenkanKijunCrossDown && previousIndicators?.ichimoku) {
    const crossedDown = previousIndicators.ichimoku.tenkan >= previousIndicators.ichimoku.kijun &&
                         indicators.ichimoku.tenkan < indicators.ichimoku.kijun;
    if (crossedDown) {
      return { shouldExit: true, reason: 'Tenkan/Kijun cross down' };
    }
  }
  
  return { shouldExit: false, reason: '' };
}

/**
 * Simulate strategy with filters and Ichimoku
 */
function simulateStrategyWithFiltersAndIchimoku(
  candles5m: any[],
  candles1m: any[],
  params: StrategyParams,
  chain?: string,
  caller?: string
): { pnl: number; maxReached: number; holdDuration: number; entryTime: number; exitTime: number; entryPrice: number; passedFilters: boolean; entryReason: string; exitReason: string } {
  if (candles5m.length < 52) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime: Date.now(),
      exitTime: Date.now(),
      entryPrice: candles5m[0]?.close || 1,
      passedFilters: false,
      entryReason: 'Insufficient data',
      exitReason: '',
    };
  }

  const stopLossPercent = 1 - params.minExitPrice;
  
  // Check filters
  const filterCheck = passesFilters(candles5m, params.filters, stopLossPercent, chain, caller);
  if (!filterCheck.passes) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime: Date.now(),
      exitTime: Date.now(),
      entryPrice: candles5m[0]?.close || 1,
      passedFilters: false,
      entryReason: filterCheck.reason,
      exitReason: '',
    };
  }

  // Check 1m timeframe signals if enabled
  if (params.filters.useMultiTimeframe) {
    const signalPeriod = params.filters.timeframeSignalPeriod || 15;
    const signal1m = check1mTimeframeSignals(candles1m, signalPeriod);
    
    if (!signal1m.bullishSignal) {
      return {
        pnl: params.minExitPrice,
        maxReached: 1.0,
        holdDuration: 0,
        entryTime: Date.now(),
        exitTime: Date.now(),
        entryPrice: candles5m[0]?.close || 1,
        passedFilters: false,
        entryReason: 'No 1m bullish signal',
        exitReason: '',
      };
    }
  }

  // Calculate indicators
  const indicatorData: IndicatorData[] = [];
  let previousEMAs: { ema9?: number | null; ema20?: number | null; ema50?: number | null } = {};
  
  for (let i = 0; i < candles5m.length; i++) {
    const indicators = calculateIndicators(candles5m, i, previousEMAs);
    indicatorData.push(indicators);
    
    previousEMAs = {
      ema9: indicators.movingAverages.ema9,
      ema20: indicators.movingAverages.ema20,
      ema50: indicators.movingAverages.ema50,
    };
  }

  const firstCandle = candles5m[0];
  const alertTime = firstCandle.timestamp
    ? typeof firstCandle.timestamp === 'number'
      ? firstCandle.timestamp
      : new Date(firstCandle.timestamp).getTime()
    : Date.now();

  // Find entry point based on Ichimoku conditions
  let entryIndex = 0;
  let entryReason = 'Immediate entry';
  
  for (let i = 52; i < candles5m.length; i++) {
    const indicators = indicatorData[i];
    const previousIndicators = i > 0 ? indicatorData[i - 1] : null;
    
    const entryCheck = checkIchimokuEntry(indicators, previousIndicators, params);
    if (entryCheck.canEnter) {
      entryIndex = i;
      entryReason = entryCheck.reason;
      break;
    }
  }

  // If no entry found and entry is required, skip
  if (entryIndex === 0 && (params.requireTenkanKijunCross || params.requireIchimokuCloudCross || params.requireIchimokuBullish)) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime: alertTime,
      exitTime: alertTime,
      entryPrice: candles5m[0].close,
      passedFilters: false,
      entryReason: 'Ichimoku entry conditions never met',
      exitReason: '',
    };
  }

  const actualEntryPrice = candles5m[entryIndex].close;
  const entryTime = candles5m[entryIndex].timestamp
    ? typeof candles5m[entryIndex].timestamp === 'number'
      ? candles5m[entryIndex].timestamp
      : new Date(candles5m[entryIndex].timestamp).getTime()
    : alertTime;

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
  for (let i = entryIndex; i < candles5m.length; i++) {
    const candle = candles5m[i];
    const indicators = indicatorData[i];
    const previousIndicators = i > entryIndex ? indicatorData[i - 1] : null;
    
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp
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

    // Check Ichimoku exit conditions
    const exitCheck = checkIchimokuExit(indicators, previousIndicators, params);
    if (exitCheck.shouldExit && remaining > 0) {
      const exitPrice = Math.max(effectiveLow, minExitPrice);
      pnl += remaining * (exitPrice / actualEntryPrice);
      remaining = 0;
      exitTime = candleTime;
      exitReason = exitCheck.reason;
      exited = true;
      break;
    }

    // Check profit targets (ladder exits)
    for (const target of params.profitTargets) {
      const targetPrice = actualEntryPrice * target.target;
      if (!targetsHit.has(target.target) && remaining > 0 && effectiveHigh >= targetPrice) {
        const sellPercent = Math.min(target.percent, remaining);
        pnl += sellPercent * target.target;
        remaining -= sellPercent;
        targetsHit.add(target.target);
      }
    }

    // Dynamic stop loss based on Ichimoku
    let currentStopPrice = minExitPrice;
    if (params.stopLossAtKijun && indicators.ichimoku) {
      currentStopPrice = Math.max(indicators.ichimoku.kijun, minExitPrice);
    }
    if (params.stopLossAtCloudBottom && indicators.ichimoku) {
      currentStopPrice = Math.max(indicators.ichimoku.cloudBottom, currentStopPrice);
    }
    if (params.stopLossAtSMA20 && indicators.movingAverages.sma20) {
      currentStopPrice = Math.max(indicators.movingAverages.sma20, currentStopPrice);
    }
    
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
    const finalPrice = candles5m[candles5m.length - 1].close;
    const exitPrice = Math.max(finalPrice, minExitPrice);
    pnl += remaining * (exitPrice / actualEntryPrice);
    exitTime = candles5m[candles5m.length - 1].timestamp
      ? typeof candles5m[candles5m.length - 1].timestamp === 'number'
        ? candles5m[candles5m.length - 1].timestamp
        : new Date(candles5m[candles5m.length - 1].timestamp).getTime()
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
    passedFilters: true,
    entryReason,
    exitReason,
  };
}

/**
 * Generate filtered strategies with Ichimoku
 */
function generateFilteredIchimokuStrategies(): StrategyParams[] {
  const strategies: StrategyParams[] = [];
  let idx = 0;

  // Strategy 1: Brook Giga + BSC + Ichimoku Cloud Cross
  strategies.push({
    name: `BrookGiga_BSC_IchimokuCloudCross_${idx++}`,
    requireIchimokuCloudCross: true,
    requireIchimokuBullish: true,
    exitOnIchimokuCloudCrossDown: true,
    stopLossAtCloudBottom: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['bsc'],
    },
  });

  // Strategy 2: Brook Giga + Solana + Tenkan/Kijun Cross
  strategies.push({
    name: `BrookGiga_Solana_TenkanKijunCross_${idx++}`,
    requireTenkanKijunCross: true,
    requireTenkanAboveKijun: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['solana'],
    },
  });

  // Strategy 3: Exy + Solana + Ichimoku Cloud + < 200k
  strategies.push({
    name: `Exy_Solana_Ichimoku_Under200k_${idx++}`,
    requireIchimokuBullish: true,
    requireIchimokuCloudCross: true,
    exitOnIchimokuCloudCrossDown: true,
    stopLossAtCloudBottom: true,
    profitTargets: [
      { target: 1.3, percent: 0.30 },
      { target: 1.6, percent: 0.30 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['exy'],
      allowedChains: ['solana'],
      callerMarketCapFilters: {
        'exy': {
          maxMarketCap: 200000,
        },
      },
    },
  });

  // Strategy 4: Brook Giga + BSC + > 1M + Ichimoku Cloud Cross
  strategies.push({
    name: `BrookGiga_BSC_Over1M_IchimokuCloud_${idx++}`,
    requireIchimokuCloudCross: true,
    requireIchimokuBullish: true,
    exitOnIchimokuCloudCrossDown: true,
    stopLossAtCloudBottom: true,
    profitTargets: [
      { target: 2.0, percent: 0.30 },
      { target: 3.0, percent: 0.20 },
    ],
    trailingStopPercent: 0.30,
    trailingStopActivation: 3.0,
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['bsc'],
      callerMarketCapFilters: {
        'Brook Giga I verify @BrookCalls': {
          minMarketCap: 1000000,
        },
      },
    },
  });

  // Strategy 5: Exy + Solana + Tenkan/Kijun + < 100k
  strategies.push({
    name: `Exy_Solana_TenkanKijun_Under100k_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['exy'],
      allowedChains: ['solana'],
      callerMarketCapFilters: {
        'exy': {
          maxMarketCap: 100000,
        },
      },
    },
  });

  // Strategy 6: Austic + Solana + Ichimoku Cloud Cross
  strategies.push({
    name: `Austic_Solana_IchimokuCloud_${idx++}`,
    requireIchimokuCloudCross: true,
    requireIchimokuBullish: true,
    exitOnIchimokuCloudCrossDown: true,
    stopLossAtCloudBottom: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Austic'],
      allowedChains: ['solana'],
    },
  });

  // Strategy 7: Meta Maxist + Solana + Tenkan/Kijun + 1m lead
  strategies.push({
    name: `MetaMaxist_Solana_TenkanKijun_1mLead_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.3, percent: 0.30 },
      { target: 1.6, percent: 0.30 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['meta maxist'],
      allowedChains: ['solana'],
      useMultiTimeframe: true,
      timeframeSignalPeriod: 15,
    },
  });

  // Strategy 8: Brook Giga + Solana + Ichimoku Cloud + Ladder exits
  strategies.push({
    name: `BrookGiga_Solana_Ichimoku_Ladder_${idx++}`,
    requireIchimokuCloudCross: true,
    requireIchimokuBullish: true,
    exitOnIchimokuCloudCrossDown: true,
    stopLossAtCloudBottom: true,
    profitTargets: [
      { target: 1.2, percent: 0.20 },
      { target: 1.4, percent: 0.20 },
      { target: 1.6, percent: 0.20 },
      { target: 2.0, percent: 0.20 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['solana'],
    },
  });

  // Strategy 9: Exy + BSC + Tenkan/Kijun + < 200k
  strategies.push({
    name: `Exy_BSC_TenkanKijun_Under200k_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['exy'],
      allowedChains: ['bsc'],
      callerMarketCapFilters: {
        'exy': {
          maxMarketCap: 200000,
        },
      },
    },
  });

  // Strategy 10: Solana only + Ichimoku Cloud Cross
  strategies.push({
    name: `Solana_IchimokuCloudCross_${idx++}`,
    requireIchimokuCloudCross: true,
    requireIchimokuBullish: true,
    exitOnIchimokuCloudCrossDown: true,
    stopLossAtCloudBottom: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedChains: ['solana'],
    },
  });

  return strategies;
}

/**
 * Calculate reinvestment with correct risk management
 */
function calculateReinvestmentPerformance(
  trades: TradeResult[],
  initialPortfolio: number = 100,
  stopLossPercent: number,
  maxRiskPerTrade: number = 0.02
): {
  finalPortfolio: number;
  compoundGrowthFactor: number;
  maxDrawdown: number;
  positionSizePercent: number;
} {
  const sortedTrades = trades.filter(t => t.passedFilters).sort((a, b) => 
    DateTime.fromISO(a.alertTime).toMillis() - DateTime.fromISO(b.alertTime).toMillis()
  );

  const positionSizePercent = maxRiskPerTrade / stopLossPercent;

  let portfolio = initialPortfolio;
  let peak = initialPortfolio;
  let maxDrawdown = 0;

  for (const trade of sortedTrades) {
    const positionSize = portfolio * positionSizePercent;
    const tradeReturn = (trade.pnl - 1.0) * positionSize;
    portfolio = portfolio + tradeReturn;
    
    if (portfolio > peak) {
      peak = portfolio;
    }
    
    if (peak > 0) {
      const drawdown = (peak - portfolio) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  return {
    finalPortfolio: portfolio,
    compoundGrowthFactor: portfolio / initialPortfolio,
    maxDrawdown,
    positionSizePercent,
  };
}

async function optimizeFilteredIchimokuStrategies() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎯 FILTERED STRATEGIES WITH ICHIMOKU INDICATORS');
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

  // Get all unique calls (not just Brook Giga)
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

  // Generate strategies
  const strategies = generateFilteredIchimokuStrategies();
  console.log(`🧪 Testing ${strategies.length} filtered Ichimoku strategies\n`);

  const results: any[] = [];
  const initialPortfolio = 100;
  const maxRiskPerTrade = 0.02;

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    console.log(`[${i + 1}/${strategies.length}] Testing: ${strategy.name}`);
    
    if (strategy.filters.allowedChains) {
      console.log(`   Chain: ${strategy.filters.allowedChains.join(', ')}`);
    }
    if (strategy.filters.allowedCallers) {
      console.log(`   Caller: ${strategy.filters.allowedCallers.join(', ')}`);
    }
    if (strategy.requireIchimokuCloudCross) {
      console.log(`   Entry: Ichimoku Cloud Cross Up`);
    }
    if (strategy.requireTenkanKijunCross) {
      console.log(`   Entry: Tenkan/Kijun Cross Up`);
    }

    const trades: TradeResult[] = [];
    let filteredOut = 0;

    for (const call of uniqueCalls) {
      try {
        const chain = call.chain || 'solana';
        const caller = (call.sender || call.caller || '').trim();
        const tokenAddress = call.tokenAddress || call.mint;
        if (!tokenAddress) continue;

        const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
        if (!alertTime.isValid) continue;

        const endTime = alertTime.plus({ days: 7 });

        process.env.USE_CACHE_ONLY = 'true';
        const { candles1m, candles5m } = await fetchMultiTimeframeCandles(tokenAddress, alertTime, endTime, chain);
        delete process.env.USE_CACHE_ONLY;

        if (candles5m.length < 52) continue;

        const result = simulateStrategyWithFiltersAndIchimoku(candles5m, candles1m, strategy, chain, caller);

        if (!result.passedFilters) {
          filteredOut++;
          continue;
        }

        trades.push({
          tokenAddress,
          alertTime: call.timestamp || call.alertTime || '',
          entryTime: DateTime.fromMillis(result.entryTime).toISO() || '',
          pnl: result.pnl,
          pnlPercent: (result.pnl - 1) * 100,
          maxReached: result.maxReached,
          holdDuration: result.holdDuration,
          passedFilters: true,
          entryReason: result.entryReason,
          exitReason: result.exitReason,
        });
      } catch (error) {
        // Skip errors
      }
    }

    if (trades.length === 0) {
      console.log(`   ❌ No trades passed filters\n`);
      continue;
    }

    // Calculate metrics
    const winningTrades = trades.filter(t => t.pnl > 1.0).length;
    const losingTrades = trades.filter(t => t.pnl <= 1.0).length;
    const winRate = trades.length > 0 ? winningTrades / trades.length : 0;
    
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
    const avgPnlPerTrade = trades.length > 0 ? (totalPnl / trades.length) * 100 : 0;

    const stopLossPercent = 1 - strategy.minExitPrice;
    const reinvestment = calculateReinvestmentPerformance(trades, initialPortfolio, stopLossPercent, maxRiskPerTrade);

    results.push({
      strategy: strategy.name,
      winRate: winRate * 100,
      avgPnlPerTrade,
      totalTrades: trades.length,
      filteredOut,
      finalPortfolio: reinvestment.finalPortfolio,
      compoundFactor: reinvestment.compoundGrowthFactor,
      maxDrawdown: reinvestment.maxDrawdown * 100,
      positionSizePercent: reinvestment.positionSizePercent * 100,
      filters: strategy.filters,
      ichimokuEntry: strategy.requireIchimokuCloudCross || strategy.requireTenkanKijunCross,
    });

    console.log(`   ✅ Trades: ${trades.length} (${filteredOut} filtered) | Win Rate: ${(winRate * 100).toFixed(1)}% | Final: $${reinvestment.finalPortfolio.toFixed(2)} (${reinvestment.compoundGrowthFactor.toFixed(2)}x)\n`);
  }

  // Sort by final portfolio
  results.sort((a, b) => b.finalPortfolio - a.finalPortfolio);

  // Display results
  console.log(`\n${'='.repeat(80)}`);
  console.log('🏆 TOP FILTERED ICHIMOKU STRATEGIES');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Rank | Win Rate | Avg PnL | Trades | Final Portfolio | Compound | Strategy');
  console.log('-'.repeat(100));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(
      `${(i + 1).toString().padStart(4)} | ` +
      `${r.winRate.toFixed(1).padStart(7)}% | ` +
      `${r.avgPnlPerTrade >= 0 ? '+' : ''}${r.avgPnlPerTrade.toFixed(2).padStart(6)}% | ` +
      `${r.totalTrades.toString().padStart(6)} | ` +
      `$${r.finalPortfolio.toFixed(2).padStart(13)} | ` +
      `${r.compoundFactor.toFixed(2).padStart(8)}x | ` +
      `${r.strategy.substring(0, 40)}`
    );
  }

  // Save results
  const summaryPath = path.join(OUTPUT_DIR, 'filtered_ichimoku_strategies.csv');
  const csvRows = results.map(r => ({
    Rank: results.indexOf(r) + 1,
    Strategy: r.strategy,
    WinRate: r.winRate.toFixed(2),
    AvgPnlPerTrade: r.avgPnlPerTrade.toFixed(2),
    TotalTrades: r.totalTrades,
    FilteredOut: r.filteredOut,
    FinalPortfolio: r.finalPortfolio.toFixed(2),
    CompoundFactor: r.compoundFactor.toFixed(4),
    MaxDrawdown: r.maxDrawdown.toFixed(2),
    PositionSize: r.positionSizePercent.toFixed(2),
    Filters: JSON.stringify(r.filters),
    IchimokuEntry: r.ichimokuEntry,
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

optimizeFilteredIchimokuStrategies().catch(console.error);

