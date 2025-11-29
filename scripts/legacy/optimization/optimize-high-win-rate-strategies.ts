#!/usr/bin/env ts-node
/**
 * Optimize High Win Rate Strategies
 * 
 * Tests strategies designed to achieve 70-90%+ win rates through:
 * - Dip entry strategies
 * - Lower profit targets
 * - Tighter stops
 * - Staged stops (instead of trailing)
 * - Ladder exits
 * 
 * Focuses on reinvestment performance (compound growth) rather than per-trade PnL.
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { initClickHouse, hasCandles, closeClickHouse } from '../src/storage/clickhouse-client';
import { stringify } from 'csv-stringify';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/high-win-rate-optimization');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface StrategyParams {
  // Entry timing
  entryDelayMinutes?: number; // Wait X minutes after alert
  waitForDipPercent?: number; // Wait for X% dip before entering
  dipConfirmationPercent?: number; // After dip, wait for X% bounce before entering
  
  // Profit targets
  profitTargets: Array<{ target: number; percent: number }>;
  
  // Stop loss configuration
  initialStopPercent: number; // Initial stop loss (e.g., 0.10 = 10%)
  
  // Staged stops (instead of trailing)
  stagedStops?: Array<{
    activationMultiplier: number; // Activate after this multiplier
    stopPrice: number; // Stop price as fraction of entry (e.g., 1.0 = breakeven, 1.2 = 20% profit)
  }>;
  
  // Trailing stop (optional, less reliance)
  trailingStopPercent?: number;
  trailingStopActivation?: number;
  
  // Strategy name
  name: string;
}

interface TradeResult {
  tokenAddress: string;
  alertTime: string;
  entryTime: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  maxReached: number;
  holdDuration: number;
  timeToAth: number;
  candlesCount: number;
}

interface StrategyResult {
  params: StrategyParams;
  totalPnl: number;
  totalPnlPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  avgHoldDuration: number;
  finalPortfolioWithReinvestment: number;
  compoundGrowthFactor: number;
  trades: TradeResult[];
}

/**
 * Find dip entry point in candles
 */
function findDipEntry(
  candles: any[],
  alertTime: number,
  waitForDipPercent: number,
  dipConfirmationPercent?: number
): { entryIndex: number; entryPrice: number; entryTime: number } | null {
  if (candles.length < 2) return null;
  
  const alertCandle = candles[0];
  const alertPrice = alertCandle.close;
  const targetDipPrice = alertPrice * (1 - waitForDipPercent);
  
  // Find first candle that reaches the dip target
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp
        : new Date(candle.timestamp).getTime()
      : alertTime;
    
    // Check if price dipped to target
    if (candle.low <= targetDipPrice) {
      // If confirmation required, check for bounce
      if (dipConfirmationPercent !== undefined) {
        const confirmationPrice = targetDipPrice * (1 + dipConfirmationPercent);
        // Look ahead for confirmation bounce
        for (let j = i; j < Math.min(i + 10, candles.length); j++) {
          if (candles[j].high >= confirmationPrice) {
            return {
              entryIndex: j,
              entryPrice: confirmationPrice,
              entryTime: candles[j].timestamp
                ? typeof candles[j].timestamp === 'number'
                  ? candles[j].timestamp
                  : new Date(candles[j].timestamp).getTime()
                : candleTime,
            };
          }
        }
        // No confirmation found, skip this dip
        continue;
      } else {
        // Enter at dip price
        return {
          entryIndex: i,
          entryPrice: targetDipPrice,
          entryTime: candleTime,
        };
      }
    }
  }
  
  return null;
}

/**
 * Simulate strategy with advanced features
 */
function simulateStrategyWithParams(
  candles: any[],
  params: StrategyParams
): { pnl: number; maxReached: number; holdDuration: number; timeToAth: number; entryPrice: number; exitPrice: number; entryTime: number; exitTime: number } {
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

  // Determine entry point
  let entryIndex = 0;
  let entryPrice = candles[0].close;
  let entryTime = alertTime;
  
  // Entry delay
  if (params.entryDelayMinutes) {
    const delaySeconds = params.entryDelayMinutes * 60;
    for (let i = 0; i < candles.length; i++) {
      const candleTime = candles[i].timestamp
        ? typeof candles[i].timestamp === 'number'
          ? candles[i].timestamp
          : new Date(candles[i].timestamp).getTime()
        : alertTime;
      
      if (candleTime >= alertTime + delaySeconds) {
        entryIndex = i;
        entryPrice = candles[i].close;
        entryTime = candleTime;
        break;
      }
    }
  }
  
  // Dip entry
  if (params.waitForDipPercent !== undefined) {
    const dipEntry = findDipEntry(
      candles,
      alertTime,
      params.waitForDipPercent,
      params.dipConfirmationPercent
    );
    
    if (dipEntry) {
      entryIndex = dipEntry.entryIndex;
      entryPrice = dipEntry.entryPrice;
      entryTime = dipEntry.entryTime;
    } else {
      // No dip found, exit with minimal loss
      return {
        pnl: 0.95, // 5% loss for missing entry
        maxReached: 1.0,
        holdDuration: 0,
        timeToAth: 0,
        entryPrice: candles[0].close,
        exitPrice: candles[0].close * 0.95,
        entryTime: alertTime,
        exitTime: alertTime,
      };
    }
  }

  // Start simulation from entry point
  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = entryPrice;
  let maxReached = 1.0;
  let athTime = entryTime;
  let exitTime = entryTime;
  let exited = false;

  const targetsHit = new Set<number>();
  const initialStopPrice = entryPrice * (1 - params.initialStopPercent);
  let currentStopPrice = initialStopPrice;
  
  // Initialize staged stops
  const stagedStops = params.stagedStops || [];
  const stagedStopsHit = new Set<number>();

  for (let i = entryIndex; i < candles.length; i++) {
    const candle = candles[i];
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

    const currentMultiplier = effectiveHigh / entryPrice;
    if (currentMultiplier > maxReached) {
      maxReached = currentMultiplier;
      athTime = candleTime;
    }

    if (remaining > 0 && effectiveHigh > highestPrice) {
      highestPrice = effectiveHigh;
    }

    // Check staged stops
    for (const stagedStop of stagedStops) {
      if (
        !stagedStopsHit.has(stagedStop.activationMultiplier) &&
        maxReached >= stagedStop.activationMultiplier
      ) {
        currentStopPrice = entryPrice * stagedStop.stopPrice;
        stagedStopsHit.add(stagedStop.activationMultiplier);
      }
    }

    // Check profit targets
    for (const target of params.profitTargets) {
      const targetPrice = entryPrice * target.target;
      if (!targetsHit.has(target.target) && remaining > 0 && effectiveHigh >= targetPrice) {
        const sellPercent = Math.min(target.percent, remaining);
        pnl += sellPercent * target.target;
        remaining -= sellPercent;
        targetsHit.add(target.target);
      }
    }

    // Check stop loss (current stop price)
    if (remaining > 0 && effectiveLow <= currentStopPrice) {
      pnl += remaining * (currentStopPrice / entryPrice);
      remaining = 0;
      exitTime = candleTime;
      exited = true;
      break;
    }

    // Trailing stop (if enabled and less reliance)
    if (
      params.trailingStopPercent &&
      params.trailingStopActivation &&
      remaining > 0 &&
      maxReached >= params.trailingStopActivation &&
      targetsHit.has(params.trailingStopActivation)
    ) {
      const trailingStopPrice = highestPrice * (1 - params.trailingStopPercent);
      const actualStopPrice = Math.max(trailingStopPrice, currentStopPrice);

      if (effectiveLow <= actualStopPrice) {
        pnl += remaining * (actualStopPrice / entryPrice);
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
    const exitPrice = Math.max(finalPrice, currentStopPrice);
    pnl += remaining * (exitPrice / entryPrice);
    exitTime = candles[candles.length - 1].timestamp
      ? typeof candles[candles.length - 1].timestamp === 'number'
        ? candles[candles.length - 1].timestamp
        : new Date(candles[candles.length - 1].timestamp).getTime()
      : entryTime;
    exited = true;
  }

  // Safety check
  if (pnl < (1 - params.initialStopPercent)) {
    pnl = 1 - params.initialStopPercent;
  }

  const holdDurationMinutes = exited
    ? Math.max(0, Math.floor((exitTime - entryTime) / 60))
    : 0;
  const timeToAthMinutes = Math.max(0, Math.floor((athTime - entryTime) / 60));

  return {
    pnl,
    maxReached,
    holdDuration: holdDurationMinutes,
    timeToAth: timeToAthMinutes,
    entryPrice,
    exitPrice: entryPrice * pnl,
    entryTime,
    exitTime,
  };
}

/**
 * Calculate reinvestment performance
 */
function calculateReinvestmentPerformance(
  trades: TradeResult[],
  initialPortfolio: number = 100,
  positionSizePercent: number = 0.02
): { finalPortfolio: number; compoundGrowthFactor: number } {
  const sortedTrades = [...trades].sort((a, b) => 
    DateTime.fromISO(a.entryTime).toMillis() - DateTime.fromISO(b.entryTime).toMillis()
  );

  let portfolio = initialPortfolio;

  for (const trade of sortedTrades) {
    const positionSize = portfolio * positionSizePercent;
    const tradeReturn = (trade.pnl - 1.0) * positionSize;
    portfolio = portfolio + tradeReturn;
  }

  return {
    finalPortfolio: portfolio,
    compoundGrowthFactor: portfolio / initialPortfolio,
  };
}

/**
 * Generate high win-rate strategy combinations
 */
function generateHighWinRateStrategies(): StrategyParams[] {
  const strategies: StrategyParams[] = [];
  let idx = 0;

  // 1. Conservative profit targets (no entry delays)
  const conservativeTargets = [
    [{ target: 1.2, percent: 0.30 }, { target: 1.5, percent: 0.30 }], // 30% @ 1.2x, 30% @ 1.5x
    [{ target: 1.3, percent: 0.25 }, { target: 1.6, percent: 0.25 }], // 25% @ 1.3x, 25% @ 1.6x
    [{ target: 1.2, percent: 0.20 }, { target: 1.4, percent: 0.20 }, { target: 1.6, percent: 0.20 }], // 20% each
    [{ target: 1.15, percent: 0.25 }, { target: 1.30, percent: 0.25 }], // 25% @ 1.15x, 25% @ 1.30x
    [{ target: 1.1, percent: 0.20 }, { target: 1.2, percent: 0.20 }, { target: 1.3, percent: 0.20 }], // 20% each
    [{ target: 1.05, percent: 0.30 }, { target: 1.10, percent: 0.30 }], // Very conservative
  ];

  const tightStops = [0.05, 0.10, 0.15, 0.20]; // 5%, 10%, 15%, 20%

  for (const targets of conservativeTargets) {
    for (const stop of tightStops) {
      strategies.push({
        name: `Conservative_${idx++}`,
        profitTargets: targets,
        initialStopPercent: stop,
        stagedStops: [
          { activationMultiplier: 1.2, stopPrice: 1.0 }, // Breakeven after 1.2x
          { activationMultiplier: 1.5, stopPrice: 1.2 }, // 20% profit after 1.5x
        ],
      });
    }
  }

  // 2. Dip entry strategies
  const dipLevels = [0.20, 0.30, 0.40, 0.50]; // 20%, 30%, 40%, 50% dips
  const confirmations = [undefined, 0.05, 0.10, 0.15]; // No confirmation, 5%, 10%, 15% bounce

  for (const dip of dipLevels) {
    for (const confirm of confirmations) {
      strategies.push({
        name: `DipEntry_${idx++}`,
        waitForDipPercent: dip,
        dipConfirmationPercent: confirm,
        profitTargets: [
          { target: 1.3, percent: 0.30 },
          { target: 1.6, percent: 0.30 },
        ],
        initialStopPercent: 0.15,
        stagedStops: [
          { activationMultiplier: 1.2, stopPrice: 1.0 },
          { activationMultiplier: 1.5, stopPrice: 1.2 },
        ],
      });
    }
  }

  // 3. Entry delay strategies
  const delays = [5, 10, 15, 30, 60]; // minutes

  for (const delay of delays) {
    strategies.push({
      name: `Delay_${idx++}`,
      entryDelayMinutes: delay,
      profitTargets: [
        { target: 1.2, percent: 0.30 },
        { target: 1.5, percent: 0.30 },
      ],
      initialStopPercent: 0.10,
      stagedStops: [
        { activationMultiplier: 1.2, stopPrice: 1.0 },
      ],
    });
  }

  // 4. Ladder exits (many small targets)
  const ladderConfigs = [
    [
      { target: 1.1, percent: 0.10 },
      { target: 1.2, percent: 0.10 },
      { target: 1.3, percent: 0.10 },
      { target: 1.4, percent: 0.10 },
      { target: 1.5, percent: 0.10 },
    ],
    [
      { target: 1.15, percent: 0.15 },
      { target: 1.30, percent: 0.15 },
      { target: 1.45, percent: 0.15 },
    ],
    [
      { target: 1.05, percent: 0.20 },
      { target: 1.10, percent: 0.20 },
      { target: 1.15, percent: 0.20 },
      { target: 1.20, percent: 0.20 },
    ],
  ];

  for (const ladder of ladderConfigs) {
    strategies.push({
      name: `Ladder_${idx++}`,
      profitTargets: ladder,
      initialStopPercent: 0.10,
      stagedStops: [
        { activationMultiplier: 1.1, stopPrice: 1.0 },
        { activationMultiplier: 1.2, stopPrice: 1.05 },
      ],
    });
  }

  // 5. Staged stops only (no trailing)
  const stagedStopConfigs = [
    [
      { activationMultiplier: 1.2, stopPrice: 1.0 },
      { activationMultiplier: 1.5, stopPrice: 1.2 },
      { activationMultiplier: 2.0, stopPrice: 1.5 },
    ],
    [
      { activationMultiplier: 1.3, stopPrice: 1.0 },
      { activationMultiplier: 1.6, stopPrice: 1.3 },
      { activationMultiplier: 2.0, stopPrice: 1.5 },
    ],
    [
      { activationMultiplier: 1.1, stopPrice: 1.0 },
      { activationMultiplier: 1.3, stopPrice: 1.1 },
      { activationMultiplier: 1.5, stopPrice: 1.2 },
      { activationMultiplier: 2.0, stopPrice: 1.5 },
    ],
  ];

  for (const staged of stagedStopConfigs) {
    strategies.push({
      name: `StagedStops_${idx++}`,
      profitTargets: [
        { target: 2.0, percent: 0.30 },
        { target: 3.0, percent: 0.20 },
      ],
      initialStopPercent: 0.15,
      stagedStops: staged,
    });
  }

  // 6. Combination strategies
  strategies.push({
    name: `Combo_Dip30_Confirm10_Tight_${idx++}`,
    waitForDipPercent: 0.30,
    dipConfirmationPercent: 0.10,
    profitTargets: [
      { target: 1.2, percent: 0.20 },
      { target: 1.4, percent: 0.20 },
      { target: 1.6, percent: 0.20 },
    ],
    initialStopPercent: 0.10,
    stagedStops: [
      { activationMultiplier: 1.2, stopPrice: 1.0 },
      { activationMultiplier: 1.4, stopPrice: 1.1 },
      { activationMultiplier: 1.6, stopPrice: 1.3 },
    ],
  });

  strategies.push({
    name: `Combo_Delay15_Dip40_Ladder_${idx++}`,
    entryDelayMinutes: 15,
    waitForDipPercent: 0.40,
    profitTargets: [
      { target: 1.1, percent: 0.15 },
      { target: 1.2, percent: 0.15 },
      { target: 1.3, percent: 0.15 },
    ],
    initialStopPercent: 0.10,
    stagedStops: [
      { activationMultiplier: 1.1, stopPrice: 1.0 },
    ],
  });

  return strategies;
}

/**
 * Calculate metrics
 */
function calculateMetrics(
  trades: TradeResult[],
  strategyParams: StrategyParams,
  reinvestmentResult: { finalPortfolio: number; compoundGrowthFactor: number }
): Omit<StrategyResult, 'params' | 'trades'> {
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

  const returns = trades.map((t) => t.pnl - 1.0);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1
      ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1)
      : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalLosses = losses.reduce((a, b) => a + b, 0);
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

  // Max drawdown with reinvestment
  const maxRiskPerTrade = 0.02;
  const maxLossPercentage = strategyParams.initialStopPercent;
  const positionSize = maxRiskPerTrade / maxLossPercentage;
  let maxDrawdown = 0;
  let peak = 1.0;
  let cumulative = 1.0;

  for (const trade of trades) {
    const tradeReturn = trade.pnl - 1.0;
    const portfolioImpact = positionSize * tradeReturn;
    cumulative = cumulative + portfolioImpact;

    if (cumulative > peak) {
      peak = cumulative;
    }

    if (peak > 0 && cumulative >= 0) {
      const drawdown = (peak - cumulative) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  maxDrawdown = Math.max(0, Math.min(1, isNaN(maxDrawdown) ? 0 : maxDrawdown));

  const avgHoldDuration =
    trades.length > 0
      ? trades.reduce((sum, t) => sum + t.holdDuration, 0) / trades.length
      : 0;

  return {
    totalPnl,
    totalPnlPercent,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    avgWin,
    avgLoss,
    maxDrawdown,
    sharpeRatio,
    profitFactor,
    avgHoldDuration,
    finalPortfolioWithReinvestment: reinvestmentResult.finalPortfolio,
    compoundGrowthFactor: reinvestmentResult.compoundGrowthFactor,
  };
}

async function optimizeHighWinRateStrategies() {
  const scriptStartTime = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎯 HIGH WIN RATE STRATEGY OPTIMIZATION');
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

  // Filter to Brook Giga
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

  // Pre-filter calls with candles
  console.log('🔍 Pre-filtering calls with candle data...');
  await initClickHouse();
  const callsWithCandles: any[] = [];

  for (let i = 0; i < uniqueCalls.length; i++) {
    const call = uniqueCalls[i];
    const tokenAddress = call.tokenAddress || call.mint;
    const chain = call.chain || 'solana';
    if (!tokenAddress) continue;

    const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
    if (!alertTime.isValid) continue;

    const endTime = alertTime.plus({ days: 7 });
    const hasData = await hasCandles(tokenAddress, chain, alertTime, endTime);

    if (hasData) {
      callsWithCandles.push(call);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`   Checked ${i + 1}/${uniqueCalls.length}... ${callsWithCandles.length} have candles`);
    }
  }

  console.log(`✅ Found ${callsWithCandles.length} calls with candle data\n`);

  // Generate strategies
  const strategies = generateHighWinRateStrategies();
  console.log(`🧪 Generated ${strategies.length} high win-rate strategies\n`);

  const results: StrategyResult[] = [];
  const initialPortfolio = 100;
  const positionSizePercent = 0.02;

  // Test each strategy
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    
    if ((i + 1) % 10 === 0 || i === 0) {
      console.log(`\n[${i + 1}/${strategies.length}] Testing: ${strategy.name}`);
    }

    const trades: TradeResult[] = [];

    for (const call of callsWithCandles.slice(0, 238)) {
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

        if (candles.length < 10) continue;

        const result = simulateStrategyWithParams(candles, strategy);

        trades.push({
          tokenAddress,
          alertTime: call.timestamp || call.alertTime || '',
          entryTime: DateTime.fromMillis(result.entryTime).toISO() || '',
          entryPrice: result.entryPrice,
          exitPrice: result.exitPrice,
          pnl: result.pnl,
          pnlPercent: (result.pnl - 1) * 100,
          maxReached: result.maxReached,
          holdDuration: result.holdDuration,
          timeToAth: result.timeToAth,
          candlesCount: candles.length,
        });
      } catch (error) {
        // Skip errors
      }
    }

    if (trades.length === 0) continue;

    // Calculate reinvestment performance
    const reinvestmentResult = calculateReinvestmentPerformance(trades, initialPortfolio, positionSizePercent);

    // Calculate metrics
    const metrics = calculateMetrics(trades, strategy, reinvestmentResult);

    results.push({
      params: strategy,
      ...metrics,
      trades,
    });

    if ((i + 1) % 10 === 0) {
      console.log(`   Win Rate: ${(metrics.winRate * 100).toFixed(1)}% | Final Portfolio: ${metrics.finalPortfolioWithReinvestment.toFixed(2)} | Compound: ${metrics.compoundGrowthFactor.toFixed(2)}x`);
    }
  }

  await closeClickHouse();

  // Sort by final portfolio (reinvestment performance)
  results.sort((a, b) => b.finalPortfolioWithReinvestment - a.finalPortfolioWithReinvestment);

  // Save results
  console.log(`\n${'='.repeat(80)}`);
  console.log('💾 Saving results...');
  console.log(`${'='.repeat(80)}\n`);

  const summaryPath = path.join(OUTPUT_DIR, 'high_win_rate_strategies.csv');
  const csvRows = results.map(r => ({
    Rank: results.indexOf(r) + 1,
    Strategy: r.params.name,
    WinRate: (r.winRate * 100).toFixed(2),
    AvgPnlPerTrade: r.totalPnlPercent.toFixed(2),
    FinalPortfolio: r.finalPortfolioWithReinvestment.toFixed(2),
    CompoundFactor: r.compoundGrowthFactor.toFixed(4),
    TotalTrades: r.totalTrades,
    WinningTrades: r.winningTrades,
    LosingTrades: r.losingTrades,
    ProfitFactor: r.profitFactor.toFixed(2),
    MaxDrawdown: (r.maxDrawdown * 100).toFixed(2),
    AvgHoldDuration: r.avgHoldDuration.toFixed(0),
    InitialStop: `${(r.params.initialStopPercent * 100).toFixed(0)}%`,
    ProfitTargets: JSON.stringify(r.params.profitTargets),
    EntryDelay: r.params.entryDelayMinutes || 0,
    WaitForDip: r.params.waitForDipPercent ? `${(r.params.waitForDipPercent * 100).toFixed(0)}%` : '',
    DipConfirmation: r.params.dipConfirmationPercent ? `${(r.params.dipConfirmationPercent * 100).toFixed(0)}%` : '',
    StagedStops: JSON.stringify(r.params.stagedStops || []),
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

  // Display top 20
  console.log('🏆 TOP 20 HIGH WIN RATE STRATEGIES (by Reinvestment Performance)\n');
  console.log('Rank | Win Rate | Avg PnL | Final Portfolio | Compound | Strategy');
  console.log('-'.repeat(100));

  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i];
    console.log(
      `${(i + 1).toString().padStart(4)} | ` +
      `${(r.winRate * 100).toFixed(1).padStart(7)}% | ` +
      `${r.totalPnlPercent >= 0 ? '+' : ''}${r.totalPnlPercent.toFixed(2).padStart(6)}% | ` +
      `${r.finalPortfolioWithReinvestment.toFixed(2).padStart(14)} | ` +
      `${r.compoundGrowthFactor.toFixed(2).padStart(8)}x | ` +
      `${r.params.name.substring(0, 50)}`
    );
  }

  console.log(`\n✅ Results saved to: ${summaryPath}`);
  console.log(`⏱️  Total time: ${((Date.now() - scriptStartTime) / 1000 / 60).toFixed(1)} minutes\n`);
}

optimizeHighWinRateStrategies().catch(console.error);

