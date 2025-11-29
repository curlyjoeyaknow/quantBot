#!/usr/bin/env ts-node
/**
 * Strategy Optimization with Advanced Filters
 * 
 * Features:
 * - Market cap filters (min/max)
 * - Stop loss range filters
 * - Ladder exit configurations
 * - Multi-timeframe analysis (1m lead indicator for 5m moves)
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
const OUTPUT_DIR = path.join(__dirname, '../data/exports/filtered-strategy-optimization');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface FilterConfig {
  // Chain filters
  allowedChains?: string[]; // e.g., ['solana'], ['bsc'], ['ethereum'], ['solana', 'bsc']
  excludedChains?: string[]; // Chains to exclude
  
  // Caller filters
  allowedCallers?: string[]; // e.g., ['Brook Giga I verify @BrookCalls'], ['exy']
  excludedCallers?: string[]; // Callers to exclude
  
  // Market cap filters (global)
  minMarketCap?: number; // Minimum market cap in USD
  maxMarketCap?: number; // Maximum market cap in USD
  
  // Caller-specific market cap filters
  callerMarketCapFilters?: {
    [callerName: string]: {
      minMarketCap?: number;
      maxMarketCap?: number;
    };
  };
  // Example: { 'Brook Giga I verify @BrookCalls': { minMarketCap: 1000000 }, 'exy': { maxMarketCap: 200000 } }
  
  // Stop loss filters
  minStopLoss?: number; // Minimum stop loss % (e.g., 0.10 = 10%)
  maxStopLoss?: number; // Maximum stop loss % (e.g., 0.40 = 40%)
  
  // Multi-timeframe
  useMultiTimeframe?: boolean; // Use 1m candles for signals, 5m for execution
  timeframeSignalPeriod?: number; // Minutes to look back on 1m for signals
}

interface StrategyParams {
  name: string;
  
  // Entry conditions
  requireTenkanKijunCross?: boolean;
  requireIchimokuBullish?: boolean;
  requirePriceAboveSMA20?: boolean;
  
  // Exit conditions
  exitOnTenkanKijunCrossDown?: boolean;
  exitOnIchimokuCloudCrossDown?: boolean;
  
  // Profit targets (ladder exits)
  profitTargets: Array<{ target: number; percent: number }>;
  
  // Stop loss
  initialStopPercent: number;
  stopLossAtKijun?: boolean;
  stopLossAtCloudBottom?: boolean;
  
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
  marketCap?: number;
  passedFilters: boolean;
}

/**
 * Estimate market cap from candles (volume * price approximation)
 */
function estimateMarketCap(candles: any[]): number | null {
  if (candles.length === 0) return null;
  
  // Use average volume * average price as market cap proxy
  // This is a rough estimate - real mcap would need on-chain data
  const avgVolume = candles.reduce((sum, c) => sum + (c.volume || 0), 0) / candles.length;
  const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
  
  // Rough estimate: mcap ≈ volume * price * multiplier
  // This is very approximate - adjust multiplier based on your data
  const estimatedMcap = avgVolume * avgPrice * 10; // Adjust multiplier as needed
  
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
      return { passes: false, reason: `Chain ${chain} not in allowed list: ${filters.allowedChains.join(', ')}` };
    }
  }
  
  if (filters.excludedChains && filters.excludedChains.length > 0) {
    const normalizedChain = (chain || '').toLowerCase();
    const normalizedExcluded = filters.excludedChains.map(c => c.toLowerCase());
    if (normalizedExcluded.includes(normalizedChain)) {
      return { passes: false, reason: `Chain ${chain} is excluded` };
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
      return { passes: false, reason: `Caller "${caller}" not in allowed list: ${filters.allowedCallers.join(', ')}` };
    }
  }
  
  if (filters.excludedCallers && filters.excludedCallers.length > 0) {
    const normalizedCaller = (caller || '').trim().toLowerCase();
    const normalizedExcluded = filters.excludedCallers.map(c => c.trim().toLowerCase());
    if (normalizedExcluded.some(excluded => normalizedCaller.includes(excluded))) {
      return { passes: false, reason: `Caller "${caller}" is excluded` };
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
        return { passes: false, reason: `Cannot estimate market cap for caller-specific filter` };
      }
      
      if (callerFilters.minMarketCap && mcap < callerFilters.minMarketCap) {
        return { passes: false, reason: `Caller "${caller}" market cap ${mcap.toFixed(0)} < ${callerFilters.minMarketCap}` };
      }
      
      if (callerFilters.maxMarketCap && mcap > callerFilters.maxMarketCap) {
        return { passes: false, reason: `Caller "${caller}" market cap ${mcap.toFixed(0)} > ${callerFilters.maxMarketCap}` };
      }
    }
  }
  
  // Stop loss filter
  if (filters.minStopLoss && stopLossPercent < filters.minStopLoss) {
    return { passes: false, reason: `Stop loss ${(stopLossPercent*100).toFixed(0)}% < ${(filters.minStopLoss*100).toFixed(0)}%` };
  }
  
  if (filters.maxStopLoss && stopLossPercent > filters.maxStopLoss) {
    return { passes: false, reason: `Stop loss ${(stopLossPercent*100).toFixed(0)}% > ${(filters.maxStopLoss*100).toFixed(0)}%` };
  }
  
  return { passes: true, reason: 'Passed all filters', marketCap: mcap || undefined };
}

/**
 * Fetch candles for multiple timeframes
 */
async function fetchMultiTimeframeCandles(
  tokenAddress: string,
  alertTime: DateTime,
  endTime: DateTime,
  chain: string
): Promise<{ candles1m: any[]; candles5m: any[] }> {
  // For now, use the same candles for both (would need API support for 1m)
  // In production, you'd fetch 1m candles separately
  const candles5m = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
  
  // Simulate 1m candles by interpolating 5m candles (rough approximation)
  // In production, fetch actual 1m candles from API
  const candles1m: any[] = [];
  for (let i = 0; i < candles5m.length; i++) {
    const candle5m = candles5m[i];
    const candleTime = candle5m.timestamp
      ? typeof candle5m.timestamp === 'number'
        ? candle5m.timestamp
        : new Date(candle5m.timestamp).getTime()
      : Date.now();
    
    // Create 5 approximate 1m candles from each 5m candle
    for (let j = 0; j < 5; j++) {
      candles1m.push({
        ...candle5m,
        timestamp: candleTime + (j * 60 * 1000), // 1 minute intervals
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
  
  // Check recent 1m candles for momentum
  const recentCandles = candles1m.slice(-lookbackMinutes);
  const firstPrice = recentCandles[0].close;
  const lastPrice = recentCandles[recentCandles.length - 1].close;
  const priceChange = (lastPrice - firstPrice) / firstPrice;
  
  // Check for strong moves in 1m timeframe
  if (priceChange > 0.05) { // 5% move up in 15 minutes
    return { bullishSignal: true, bearishSignal: false, reason: `1m bullish momentum: +${(priceChange*100).toFixed(1)}%` };
  }
  
  if (priceChange < -0.05) { // 5% move down in 15 minutes
    return { bullishSignal: false, bearishSignal: true, reason: `1m bearish momentum: ${(priceChange*100).toFixed(1)}%` };
  }
  
  return { bullishSignal: false, bearishSignal: false, reason: 'No strong 1m signal' };
}

/**
 * Simulate strategy with filters and multi-timeframe
 */
function simulateStrategyWithFilters(
  candles5m: any[],
  candles1m: any[],
  params: StrategyParams,
  chain?: string,
  caller?: string
): { pnl: number; maxReached: number; holdDuration: number; entryTime: number; exitTime: number; entryPrice: number; passedFilters: boolean } {
  if (candles5m.length < 52) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime: Date.now(),
      exitTime: Date.now(),
      entryPrice: candles5m[0]?.close || 1,
      passedFilters: false,
    };
  }

  const stopLossPercent = 1 - params.minExitPrice;
  
  // Check filters (with chain and caller info)
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
    };
  }

  // Check 1m timeframe signals if enabled
  if (params.filters.useMultiTimeframe) {
    const signalPeriod = params.filters.timeframeSignalPeriod || 15;
    const signal1m = check1mTimeframeSignals(candles1m, signalPeriod);
    
    if (!signal1m.bullishSignal && params.filters.useMultiTimeframe) {
      return {
        pnl: params.minExitPrice,
        maxReached: 1.0,
        holdDuration: 0,
        entryTime: Date.now(),
        exitTime: Date.now(),
        entryPrice: candles5m[0]?.close || 1,
        passedFilters: false,
      };
    }
  }

  // Calculate indicators for 5m candles
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
    : firstCandle.time
    ? typeof firstCandle.time === 'number'
      ? firstCandle.time
      : new Date(firstCandle.time).getTime()
    : Date.now();

  // Find entry point
  let entryIndex = 0;
  
  for (let i = 52; i < candles5m.length; i++) {
    const indicators = indicatorData[i];
    const previousIndicators = i > 0 ? indicatorData[i - 1] : null;
    
    // Check entry conditions
    if (params.requireTenkanKijunCross && previousIndicators?.ichimoku && indicators.ichimoku) {
      const crossedUp = previousIndicators.ichimoku.tenkan <= previousIndicators.ichimoku.kijun &&
                        indicators.ichimoku.tenkan > indicators.ichimoku.kijun;
      if (crossedUp) {
        entryIndex = i;
        break;
      }
    } else {
      // No entry requirement, enter immediately
      entryIndex = 0;
      break;
    }
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

    // Stop loss
    let currentStopPrice = minExitPrice;
    if (params.stopLossAtKijun && indicators.ichimoku) {
      currentStopPrice = Math.max(indicators.ichimoku.kijun, minExitPrice);
    }
    if (params.stopLossAtCloudBottom && indicators.ichimoku) {
      currentStopPrice = Math.max(indicators.ichimoku.cloudBottom, currentStopPrice);
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
  };
}

/**
 * Generate filtered strategies
 */
function generateFilteredStrategies(): StrategyParams[] {
  const strategies: StrategyParams[] = [];
  let idx = 0;

  // Strategy 1: Brook Giga only, > 1M market cap
  strategies.push({
    name: `BrookGiga_Over1M_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      callerMarketCapFilters: {
        'Brook Giga I verify @BrookCalls': {
          minMarketCap: 1000000, // > $1M
        },
      },
    },
  });

  // Strategy 2: Exy only, < 200k market cap
  strategies.push({
    name: `Exy_Under200k_${idx++}`,
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
      callerMarketCapFilters: {
        'exy': {
          maxMarketCap: 200000, // < $200k
        },
      },
    },
  });

  // Strategy 3: Exy only, < 100k market cap
  strategies.push({
    name: `Exy_Under100k_${idx++}`,
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
      callerMarketCapFilters: {
        'exy': {
          maxMarketCap: 100000, // < $100k
        },
      },
    },
  });

  // Strategy 4: Solana only
  strategies.push({
    name: `Solana_Only_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedChains: ['solana'],
    },
  });

  // Strategy 5: BSC only
  strategies.push({
    name: `BSC_Only_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedChains: ['bsc'],
    },
  });

  // Strategy 6: Ethereum only
  strategies.push({
    name: `Ethereum_Only_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedChains: ['ethereum'],
    },
  });

  // Strategy 7: Brook Giga only (no market cap filter)
  strategies.push({
    name: `BrookGiga_All_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
    },
  });

  // Strategy 8: Brook Giga + BSC only
  strategies.push({
    name: `BrookGiga_BSC_Only_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
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

  // Strategy 9: Brook Giga + Solana only
  strategies.push({
    name: `BrookGiga_Solana_Only_${idx++}`,
    requireTenkanKijunCross: true,
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

  // Strategy 10: Exy + Solana only
  strategies.push({
    name: `Exy_Solana_Only_${idx++}`,
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
    },
  });

  // Strategy 11: Exy + BSC only
  strategies.push({
    name: `Exy_BSC_Only_${idx++}`,
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
    },
  });

  // Strategy 12: Exy + Solana + < 200k market cap
  strategies.push({
    name: `Exy_Solana_Under200k_${idx++}`,
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
          maxMarketCap: 200000, // < $200k
        },
      },
    },
  });

  // Strategy 13: Brook Giga + BSC + > 1M market cap
  strategies.push({
    name: `BrookGiga_BSC_Over1M_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['bsc'],
      callerMarketCapFilters: {
        'Brook Giga I verify @BrookCalls': {
          minMarketCap: 1000000, // > $1M
        },
      },
    },
  });

  // Strategy 14: Austic + Solana only
  strategies.push({
    name: `Austic_Solana_Only_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
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

  // Strategy 15: Meta Maxist + Solana only
  strategies.push({
    name: `MetaMaxist_Solana_Only_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.5, percent: 0.50 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['meta maxist'],
      allowedChains: ['solana'],
    },
  });

  // Strategy 16: Tenkan/Kijun with 1m timeframe filter
  strategies.push({
    name: `TenkanKijun_1mLead_${idx++}`,
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
      useMultiTimeframe: true,
      timeframeSignalPeriod: 15, // Check last 15 minutes of 1m data
    },
  });

  // Strategy 17: Ladder exits with stop loss filter
  strategies.push({
    name: `LadderExits_TightStop_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    profitTargets: [
      { target: 1.2, percent: 0.20 },
      { target: 1.4, percent: 0.20 },
      { target: 1.6, percent: 0.20 },
      { target: 2.0, percent: 0.20 },
    ],
    initialStopPercent: 0.15,
    minExitPrice: 0.85,
    filters: {
      minStopLoss: 0.10,
      maxStopLoss: 0.20,
    },
  });

  // Strategy 18: Medium cap with multi-timeframe
  strategies.push({
    name: `MediumCap_1mLead_Ladder_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.3, percent: 0.25 },
      { target: 1.6, percent: 0.25 },
      { target: 2.0, percent: 0.25 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      minMarketCap: 50000,
      maxMarketCap: 500000,
      useMultiTimeframe: true,
      timeframeSignalPeriod: 10,
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

async function optimizeFilteredStrategies() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎯 FILTERED STRATEGY OPTIMIZATION');
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
  const strategies = generateFilteredStrategies();
  console.log(`🧪 Testing ${strategies.length} filtered strategies\n`);

  const results: any[] = [];
  const initialPortfolio = 100;
  const maxRiskPerTrade = 0.02;

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    console.log(`[${i + 1}/${strategies.length}] Testing: ${strategy.name}`);
    
    if (strategy.filters.allowedChains) {
      console.log(`   Chain Filter: ${strategy.filters.allowedChains.join(', ')} only`);
    }
    if (strategy.filters.allowedCallers) {
      console.log(`   Caller Filter: ${strategy.filters.allowedCallers.join(', ')} only`);
    }
    if (strategy.filters.callerMarketCapFilters) {
      const callerFilters = Object.entries(strategy.filters.callerMarketCapFilters);
      callerFilters.forEach(([caller, filters]) => {
        const min = filters.minMarketCap ? `> ${filters.minMarketCap.toLocaleString()}` : '';
        const max = filters.maxMarketCap ? `< ${filters.maxMarketCap.toLocaleString()}` : '';
        console.log(`   ${caller} Market Cap: ${min}${min && max ? ' and ' : ''}${max}`);
      });
    }
    if (strategy.filters.minMarketCap || strategy.filters.maxMarketCap) {
      console.log(`   Market Cap Filter: ${strategy.filters.minMarketCap || 0} - ${strategy.filters.maxMarketCap || '∞'}`);
    }
    if (strategy.filters.useMultiTimeframe) {
      console.log(`   Multi-timeframe: 1m lead indicator (${strategy.filters.timeframeSignalPeriod || 15} min)`);
    }

    const trades: TradeResult[] = [];
    let filteredOut = 0;

    for (const call of uniqueCalls) {
      try {
        const chain = call.chain || 'solana';
        const tokenAddress = call.tokenAddress || call.mint;
        if (!tokenAddress) continue;

        const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
        if (!alertTime.isValid) continue;

        const endTime = alertTime.plus({ days: 7 });
        const caller = (call.sender || call.caller || '').trim();

        process.env.USE_CACHE_ONLY = 'true';
        const { candles1m, candles5m } = await fetchMultiTimeframeCandles(tokenAddress, alertTime, endTime, chain);
        delete process.env.USE_CACHE_ONLY;

        if (candles5m.length < 52) continue;

        const result = simulateStrategyWithFilters(candles5m, candles1m, strategy, chain, caller);

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
    });

    console.log(`   ✅ Trades: ${trades.length} (${filteredOut} filtered out) | Win Rate: ${(winRate * 100).toFixed(1)}% | Final Portfolio: $${reinvestment.finalPortfolio.toFixed(2)} (${reinvestment.compoundGrowthFactor.toFixed(2)}x)\n`);
  }

  // Sort by final portfolio
  results.sort((a, b) => b.finalPortfolio - a.finalPortfolio);

  // Display results
  console.log(`\n${'='.repeat(80)}`);
  console.log('🏆 TOP FILTERED STRATEGIES');
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
  const summaryPath = path.join(OUTPUT_DIR, 'filtered_strategies.csv');
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

optimizeFilteredStrategies().catch(console.error);

