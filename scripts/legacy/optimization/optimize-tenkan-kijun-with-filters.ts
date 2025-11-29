#!/usr/bin/env ts-node
/**
 * Optimize Tenkan/Kijun Cross Strategy with Filters
 * 
 * Focuses specifically on Tenkan/Kijun cross entry with various filter combinations:
 * - Chain filters (Solana, BSC)
 * - Caller filters (Brook Giga, Exy, etc.)
 * - Market cap filters
 * - Combined filters
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
const OUTPUT_DIR = path.join(__dirname, '../data/exports/tenkan-kijun-filtered-optimization');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface FilterConfig {
  allowedChains?: string[];
  allowedCallers?: string[];
  minMarketCap?: number;
  maxMarketCap?: number;
  callerMarketCapFilters?: {
    [callerName: string]: {
      minMarketCap?: number;
      maxMarketCap?: number;
    };
  };
}

interface StrategyParams {
  name: string;
  requireTenkanKijunCross: boolean;
  exitOnTenkanKijunCrossDown: boolean;
  stopLossAtKijun: boolean;
  profitTargets: Array<{ target: number; percent: number }>;
  initialStopPercent: number;
  trailingStopPercent?: number;
  trailingStopActivation?: number;
  minExitPrice: number;
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
}

/**
 * Estimate market cap
 */
function estimateMarketCap(candles: any[]): number | null {
  if (candles.length === 0) return null;
  const avgVolume = candles.reduce((sum, c) => sum + (c.volume || 0), 0) / candles.length;
  const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
  return avgVolume * avgPrice * 10;
}

/**
 * Check filters
 */
function passesFilters(
  candles: any[],
  filters: FilterConfig,
  chain?: string,
  caller?: string
): { passes: boolean; reason: string } {
  if (filters.allowedChains && filters.allowedChains.length > 0) {
    const normalizedChain = (chain || '').toLowerCase();
    if (!filters.allowedChains.map(c => c.toLowerCase()).includes(normalizedChain)) {
      return { passes: false, reason: `Chain ${chain} not allowed` };
    }
  }
  
  if (filters.allowedCallers && filters.allowedCallers.length > 0) {
    const normalizedCaller = (caller || '').trim();
    const matches = filters.allowedCallers.some(allowed => 
      normalizedCaller.toLowerCase() === allowed.toLowerCase() ||
      normalizedCaller.toLowerCase().includes(allowed.toLowerCase())
    );
    if (!matches) {
      return { passes: false, reason: `Caller "${caller}" not allowed` };
    }
  }
  
  const mcap = estimateMarketCap(candles);
  
  if (mcap !== null) {
    if (filters.minMarketCap && mcap < filters.minMarketCap) {
      return { passes: false, reason: `Market cap too low` };
    }
    if (filters.maxMarketCap && mcap > filters.maxMarketCap) {
      return { passes: false, reason: `Market cap too high` };
    }
    
    if (caller && filters.callerMarketCapFilters) {
      const callerFilters = filters.callerMarketCapFilters[caller];
      if (callerFilters) {
        if (callerFilters.minMarketCap && mcap < callerFilters.minMarketCap) {
          return { passes: false, reason: `Caller mcap too low` };
        }
        if (callerFilters.maxMarketCap && mcap > callerFilters.maxMarketCap) {
          return { passes: false, reason: `Caller mcap too high` };
        }
      }
    }
  }
  
  return { passes: true, reason: 'Passed' };
}

/**
 * Simulate Tenkan/Kijun cross strategy
 */
function simulateTenkanKijunStrategy(
  candles: any[],
  params: StrategyParams,
  chain?: string,
  caller?: string
): { pnl: number; maxReached: number; holdDuration: number; entryTime: number; exitTime: number; entryPrice: number; passedFilters: boolean } {
  if (candles.length < 52) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime: Date.now(),
      exitTime: Date.now(),
      entryPrice: candles[0]?.close || 1,
      passedFilters: false,
    };
  }

  // Check filters
  const filterCheck = passesFilters(candles, params.filters, chain, caller);
  if (!filterCheck.passes) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime: Date.now(),
      exitTime: Date.now(),
      entryPrice: candles[0]?.close || 1,
      passedFilters: false,
    };
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
  const alertTime = firstCandle.timestamp
    ? typeof firstCandle.timestamp === 'number'
      ? firstCandle.timestamp
      : new Date(firstCandle.timestamp).getTime()
    : Date.now();

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

  // If no cross found, skip
  if (entryIndex === 0) {
    return {
      pnl: params.minExitPrice,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime: alertTime,
      exitTime: alertTime,
      entryPrice: candles[0].close,
      passedFilters: false,
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

  // Simulate from entry point
  for (let i = entryIndex; i < candles.length; i++) {
    const candle = candles[i];
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

    // Stop loss at Kijun
    let currentStopPrice = minExitPrice;
    if (params.stopLossAtKijun && indicators.ichimoku) {
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
    passedFilters: true,
  };
}

/**
 * Generate Tenkan/Kijun strategies with filters
 */
function generateTenkanKijunStrategies(): StrategyParams[] {
  const strategies: StrategyParams[] = [];
  let idx = 0;

  // Base Tenkan/Kijun strategy (no filters)
  strategies.push({
    name: `TenkanKijun_Base_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {},
  });

  // Brook Giga + BSC
  strategies.push({
    name: `TenkanKijun_BrookGiga_BSC_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['bsc'],
    },
  });

  // Brook Giga + Solana
  strategies.push({
    name: `TenkanKijun_BrookGiga_Solana_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['solana'],
    },
  });

  // Exy + Solana
  strategies.push({
    name: `TenkanKijun_Exy_Solana_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['exy'],
      allowedChains: ['solana'],
    },
  });

  // Exy + BSC
  strategies.push({
    name: `TenkanKijun_Exy_BSC_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['exy'],
      allowedChains: ['bsc'],
    },
  });

  // Exy + Solana + < 200k
  strategies.push({
    name: `TenkanKijun_Exy_Solana_Under200k_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['exy'],
      allowedChains: ['solana'],
      callerMarketCapFilters: {
        'exy': { maxMarketCap: 200000 },
      },
    },
  });

  // Exy + Solana + < 100k
  strategies.push({
    name: `TenkanKijun_Exy_Solana_Under100k_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['exy'],
      allowedChains: ['solana'],
      callerMarketCapFilters: {
        'exy': { maxMarketCap: 100000 },
      },
    },
  });

  // Brook Giga + BSC + > 1M
  strategies.push({
    name: `TenkanKijun_BrookGiga_BSC_Over1M_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['bsc'],
      callerMarketCapFilters: {
        'Brook Giga I verify @BrookCalls': { minMarketCap: 1000000 },
      },
    },
  });

  // Brook Giga only (no chain filter)
  strategies.push({
    name: `TenkanKijun_BrookGiga_All_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
    },
  });

  // Solana only
  strategies.push({
    name: `TenkanKijun_Solana_Only_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedChains: ['solana'],
    },
  });

  // BSC only
  strategies.push({
    name: `TenkanKijun_BSC_Only_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [{ target: 1.5, percent: 0.50 }],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedChains: ['bsc'],
    },
  });

  // Ladder exits variations
  strategies.push({
    name: `TenkanKijun_BrookGiga_Solana_Ladder_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.2, percent: 0.20 },
      { target: 1.4, percent: 0.20 },
      { target: 1.6, percent: 0.20 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['solana'],
    },
  });

  strategies.push({
    name: `TenkanKijun_BrookGiga_BSC_Ladder_${idx++}`,
    requireTenkanKijunCross: true,
    exitOnTenkanKijunCrossDown: true,
    stopLossAtKijun: true,
    profitTargets: [
      { target: 1.2, percent: 0.20 },
      { target: 1.4, percent: 0.20 },
      { target: 1.6, percent: 0.20 },
    ],
    initialStopPercent: 0.20,
    minExitPrice: 0.8,
    filters: {
      allowedCallers: ['Brook Giga I verify @BrookCalls'],
      allowedChains: ['bsc'],
    },
  });

  return strategies;
}

/**
 * Calculate reinvestment with correct risk management
 * Position sizes are recalculated weekly, not after every trade
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

  if (sortedTrades.length === 0) {
    return {
      finalPortfolio: initialPortfolio,
      compoundGrowthFactor: 1.0,
      maxDrawdown: 0,
      positionSizePercent: maxRiskPerTrade / stopLossPercent,
    };
  }

  const positionSizePercent = maxRiskPerTrade / stopLossPercent;

  let portfolio = initialPortfolio;
  let peak = initialPortfolio;
  let maxDrawdown = 0;

  // Group trades by week
  const tradesByWeek = new Map<string, TradeResult[]>();
  
  for (const trade of sortedTrades) {
    const tradeDate = DateTime.fromISO(trade.alertTime);
    if (!tradeDate.isValid) continue;
    
    // Get the start of the week (Monday)
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
    // At the start of each week, calculate position size based on current portfolio
    const weeklyPositionSize = portfolio * positionSizePercent;
    
    // Process all trades in this week with the same position size
    let weeklyPnL = 0;
    
    for (const trade of weekTrades) {
      const tradeReturn = (trade.pnl - 1.0) * weeklyPositionSize;
      weeklyPnL += tradeReturn;
    }
    
    // Update portfolio at the end of the week
    portfolio = portfolio + weeklyPnL;
    
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

async function optimizeTenkanKijunWithFilters() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎯 TENKAN/KIJUN CROSS OPTIMIZATION WITH FILTERS');
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

  // Generate strategies
  const strategies = generateTenkanKijunStrategies();
  console.log(`🧪 Testing ${strategies.length} Tenkan/Kijun strategies with filters\n`);

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
    if (strategy.filters.callerMarketCapFilters) {
      const callerFilters = Object.entries(strategy.filters.callerMarketCapFilters);
      callerFilters.forEach(([caller, filters]) => {
        const min = filters.minMarketCap ? `> ${filters.minMarketCap.toLocaleString()}` : '';
        const max = filters.maxMarketCap ? `< ${filters.maxMarketCap.toLocaleString()}` : '';
        console.log(`   ${caller} Market Cap: ${min}${min && max ? ' and ' : ''}${max}`);
      });
    }

    const trades: TradeResult[] = [];
    let filteredOut = 0;
    let noCrossFound = 0;

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
        const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
        delete process.env.USE_CACHE_ONLY;

        if (candles.length < 52) continue;

        const result = simulateTenkanKijunStrategy(candles, strategy, chain, caller);

        if (!result.passedFilters) {
          filteredOut++;
          continue;
        }

        // Check if Tenkan/Kijun cross was found
        if (result.entryPrice === candles[0].close && result.entryTime === (candles[0].timestamp ? typeof candles[0].timestamp === 'number' ? candles[0].timestamp : new Date(candles[0].timestamp).getTime() : Date.now())) {
          noCrossFound++;
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
      console.log(`   ❌ No trades (${filteredOut} filtered, ${noCrossFound} no cross)\n`);
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
      noCrossFound,
      finalPortfolio: reinvestment.finalPortfolio,
      compoundFactor: reinvestment.compoundGrowthFactor,
      maxDrawdown: reinvestment.maxDrawdown * 100,
      positionSizePercent: reinvestment.positionSizePercent * 100,
      filters: strategy.filters,
    });

    // Export trade data for this strategy
    const tradeDataPath = path.join(OUTPUT_DIR, `trades_${strategy.name.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
    const tradeRows = trades.map(t => ({
      Strategy: strategy.name,
      TokenAddress: t.tokenAddress,
      AlertTime: t.alertTime,
      EntryTime: t.entryTime,
      PnL: t.pnl.toFixed(6),
      PnLPercent: t.pnlPercent.toFixed(2),
      MaxReached: t.maxReached.toFixed(4),
      HoldDurationMinutes: t.holdDuration,
      IsWin: t.pnl > 1.0 ? 'Yes' : 'No',
    }));

    await new Promise<void>((resolve, reject) => {
      stringify(tradeRows, { header: true }, (err, output) => {
        if (err) reject(err);
        else {
          fs.writeFileSync(tradeDataPath, output);
          resolve();
        }
      });
    });

    console.log(`   ✅ Trades: ${trades.length} (${filteredOut} filtered, ${noCrossFound} no cross) | Win Rate: ${(winRate * 100).toFixed(1)}% | Final: $${reinvestment.finalPortfolio.toFixed(2)} (${reinvestment.compoundGrowthFactor.toFixed(2)}x)`);
    console.log(`   📊 Trade data saved: ${tradeDataPath}\n`);
  }

  // Sort by final portfolio
  results.sort((a, b) => b.finalPortfolio - a.finalPortfolio);

  // Display results
  console.log(`\n${'='.repeat(80)}`);
  console.log('🏆 TOP TENKAN/KIJUN STRATEGIES WITH FILTERS');
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
  const summaryPath = path.join(OUTPUT_DIR, 'tenkan_kijun_filtered_strategies.csv');
  const csvRows = results.map(r => ({
    Rank: results.indexOf(r) + 1,
    Strategy: r.strategy,
    WinRate: r.winRate.toFixed(2),
    AvgPnlPerTrade: r.avgPnlPerTrade.toFixed(2),
    TotalTrades: r.totalTrades,
    FilteredOut: r.filteredOut,
    NoCrossFound: r.noCrossFound,
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

  // Show top strategy details
  const topStrategy = results[0];
  if (topStrategy) {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🥇 TOP STRATEGY DETAILS');
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Strategy: ${topStrategy.strategy}`);
    console.log(`Win Rate: ${topStrategy.winRate.toFixed(2)}%`);
    console.log(`Average PnL per Trade: ${topStrategy.avgPnlPerTrade >= 0 ? '+' : ''}${topStrategy.avgPnlPerTrade.toFixed(2)}%`);
    console.log(`Total Trades: ${topStrategy.totalTrades}`);
    console.log(`Filtered Out: ${topStrategy.filteredOut}`);
    console.log(`No Cross Found: ${topStrategy.noCrossFound}`);
    console.log(`Final Portfolio: $${topStrategy.finalPortfolio.toFixed(2)}`);
    console.log(`Compound Growth Factor: ${topStrategy.compoundFactor.toFixed(2)}x`);
    console.log(`Max Drawdown: ${topStrategy.maxDrawdown.toFixed(2)}%`);
    console.log(`Position Size: ${topStrategy.positionSizePercent.toFixed(2)}% of portfolio`);
    console.log(`\n💡 Starting with $100, you would have: $${topStrategy.finalPortfolio.toFixed(2)}\n`);
  }
}

optimizeTenkanKijunWithFilters().catch(console.error);

