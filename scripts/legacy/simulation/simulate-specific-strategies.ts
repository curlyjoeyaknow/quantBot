#!/usr/bin/env ts-node
/**
 * Simulate Specific Strategies on Brook Giga Calls
 * 
 * Runs two predefined strategies:
 * 1. Strategy A: 40% stop loss, 30% @ 2x, trailing stop 40% after 3x
 * 2. Strategy B: 30% stop loss, 50% @ 2x, 20% @ 5x, 20% @ 10x, trailing stop 30% after 10x
 */

// Load environment variables from .env file
import 'dotenv/config';

import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { fetchHybridCandles } from '../../../src/simulation/candles';
import { initClickHouse, hasCandles, closeClickHouse } from '../../../src/storage/clickhouse-client';
import { stringify } from 'csv-stringify';

const BROOK_CALLS_CSV = path.join(process.cwd(), 'data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(process.cwd(), 'data/exports/strategy-simulation');
const TOP_N_CALLERS = 5;

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface StrategyParams {
  profitTargets: Array<{ target: number; percent: number }>;
  trailingStopPercent: number;
  trailingStopActivation: number;
  minExitPrice: number;
  name: string;
}

interface TradeResult {
  tokenAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  chain?: string;
  caller?: string;
  alertTime?: string;
  pnl: number;
  pnlPercent: number;
  maxReached: number;
  holdDuration: number;
  timeToAth: number;
  entryPrice?: number;
  exitPrice?: number;
  candlesCount?: number;
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
  avgTimeToAth: number;
  trades: TradeResult[];
}

/**
 * Simulate a strategy with given parameters (same logic as optimize-strategies.ts)
 */
function simulateStrategyWithParams(
  candles: any[],
  params: StrategyParams
): { pnl: number; maxReached: number; holdDuration: number; timeToAth: number } {
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

  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = entryPrice;
  let maxReached = 1.0;
  let athTime = entryTime;
  let exitTime = entryTime;
  let exited = false;

  const targetsHit = new Set<number>();
  const minExitPrice = entryPrice * params.minExitPrice;

  for (const candle of candles) {
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp
        : new Date(candle.timestamp).getTime()
      : candle.time
      ? typeof candle.time === 'number'
        ? candle.time
        : new Date(candle.time).getTime()
      : entryTime;

    // Filter out flash spikes
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

    // Trailing stop logic
    if (
      remaining > 0 &&
      maxReached >= params.trailingStopActivation &&
      targetsHit.has(params.trailingStopActivation)
    ) {
      const trailingStopPrice = highestPrice * (1 - params.trailingStopPercent);
      const actualStopPrice = Math.max(trailingStopPrice, minExitPrice);

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
    const exitPrice = Math.max(finalPrice, minExitPrice);
    pnl += remaining * (exitPrice / entryPrice);
    exitTime = candles[candles.length - 1].timestamp
      ? typeof candles[candles.length - 1].timestamp === 'number'
        ? candles[candles.length - 1].timestamp
        : new Date(candles[candles.length - 1].timestamp).getTime()
      : entryTime;
    exited = true;
  }

  // Safety check
  if (pnl < params.minExitPrice) {
    pnl = params.minExitPrice;
  }

  const holdDurationMinutes = exited
    ? Math.max(0, Math.floor((exitTime - entryTime) / 60))
    : 0;
  const timeToAthMinutes = Math.max(0, Math.floor((athTime - entryTime) / 60));

  return { pnl, maxReached, holdDuration: holdDurationMinutes, timeToAth: timeToAthMinutes };
}

/**
 * Calculate performance metrics
 */
function calculateMetrics(trades: TradeResult[], strategyParams: StrategyParams): Omit<StrategyResult, 'params' | 'trades'> {
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

  // Calculate Sharpe ratio
  const returns = trades.map((t) => t.pnl - 1.0);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1
      ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1)
      : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

  // Profit factor
  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalLosses = losses.reduce((a, b) => a + b, 0);
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

  // Max drawdown
  const maxRiskPerTrade = 0.02;
  const maxLossPercentage = 1 - strategyParams.minExitPrice;
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
  const avgTimeToAth =
    trades.length > 0 ? trades.reduce((sum, t) => sum + t.timeToAth, 0) / trades.length : 0;

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
    avgTimeToAth,
  };
}

/**
 * Get top N callers by call count
 */
function getTopCallers(records: any[], topN: number): string[] {
  const callerCounts = new Map<string, number>();
  
  for (const record of records) {
    const caller = (record.sender || record.caller || '').trim();
    if (caller) {
      callerCounts.set(caller, (callerCounts.get(caller) || 0) + 1);
    }
  }
  
  // Sort by count descending and get top N
  const sortedCallers = Array.from(callerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([caller]) => caller);
  
  return sortedCallers;
}

async function simulateStrategies() {
  const scriptStartTime = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 SIMULATING SPECIFIC STRATEGIES ON TOP ${TOP_N_CALLERS} CALLERS`);
  console.log(`${'='.repeat(80)}\n`);

  // Define the two strategies
  const strategies: StrategyParams[] = [
    {
      name: 'Strategy A: 40% Stop Loss, 30% @ 2x, Trailing 40% @ 3x',
      profitTargets: [
        { target: 2.0, percent: 0.30 }, // 30% @ 2x
      ],
      trailingStopPercent: 0.40, // 40% trailing stop
      trailingStopActivation: 3.0, // Activate after 3x
      minExitPrice: 0.6, // 40% stop loss (exit at 60% of entry)
    },
    {
      name: 'Strategy B: 30% Stop Loss, 50% @ 2x, 20% @ 5x, 20% @ 10x, Trailing 30% @ 10x',
      profitTargets: [
        { target: 2.0, percent: 0.50 }, // 50% @ 2x
        { target: 5.0, percent: 0.20 }, // 20% @ 5x
        { target: 10.0, percent: 0.20 }, // 20% @ 10x
        // Remaining 10% runs with trailing stop
      ],
      trailingStopPercent: 0.30, // 30% trailing stop
      trailingStopActivation: 10.0, // Activate after 10x
      minExitPrice: 0.7, // 30% stop loss (exit at 70% of entry)
    },
  ];

  // Load calls data
  console.log('📂 Loading calls data...');
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  console.log(`✅ Loaded ${records.length} calls\n`);

  // Get top N callers
  console.log(`🔍 Finding top ${TOP_N_CALLERS} callers...`);
  const topCallers = getTopCallers(records, TOP_N_CALLERS);
  console.log(`✅ Top ${TOP_N_CALLERS} callers:`);
  topCallers.forEach((caller, idx) => {
    const count = records.filter(r => (r.sender || r.caller || '').trim() === caller).length;
    console.log(`   ${idx + 1}. ${caller.substring(0, 50).padEnd(50)} ${count} calls`);
  });
  console.log('');

  // Filter to top N callers only
  console.log(`🎯 Filtering calls to top ${TOP_N_CALLERS} callers...`);
  const topCallersSet = new Set(topCallers);
  const filteredCalls = records.filter(record => {
    const caller = (record.sender || record.caller || '').trim();
    return topCallersSet.has(caller);
  });
  console.log(`✅ Found ${filteredCalls.length} calls from top ${TOP_N_CALLERS} callers\n`);

  // Deduplicate: Only process unique tokens
  console.log('🔍 Deduplicating calls by token address...');
  const uniqueTokens = new Map<string, any>();
  for (const record of filteredCalls) {
    const tokenAddress = record.tokenAddress || record.mint;
    const chain = record.chain || 'solana';
    
    if (!tokenAddress) continue;
    
    const key = `${chain}:${tokenAddress}`;
    if (!uniqueTokens.has(key)) {
      uniqueTokens.set(key, record);
    }
  }
  
  const uniqueCalls = Array.from(uniqueTokens.values());
  console.log(`✅ Deduplicated: ${uniqueCalls.length} unique tokens\n`);

  // Pre-filter calls that have candles available
  console.log('🔍 Pre-filtering calls with available candle data...');
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
      console.log(`   Checked ${i + 1}/${uniqueCalls.length} unique tokens... ${callsWithCandles.length} have candles`);
    }
  }
  
  console.log(`✅ Pre-filtering complete: ${callsWithCandles.length}/${uniqueCalls.length} unique tokens have candle data\n`);

  const results: StrategyResult[] = [];

  // Test each strategy
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const strategyStartTime = Date.now();
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${i + 1}/${strategies.length}] Testing: ${strategy.name}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`📊 Configuration:`);
    console.log(`   Profit Targets:`);
    strategy.profitTargets.forEach((t, idx) => {
      console.log(`     ${idx + 1}. Sell ${(t.percent * 100).toFixed(0)}% at ${t.target.toFixed(1)}x`);
    });
    console.log(`   Trailing Stop: ${(strategy.trailingStopPercent * 100).toFixed(0)}%`);
    console.log(`   Stop Activation: ${strategy.trailingStopActivation.toFixed(1)}x`);
    console.log(`   Min Exit Price: ${((1 - strategy.minExitPrice) * 100).toFixed(0)}% stop loss`);
    console.log(`\n🔄 Processing ${callsWithCandles.length} calls...\n`);

    const trades: TradeResult[] = [];
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (let j = 0; j < callsWithCandles.length; j++) {
      const call = callsWithCandles[j];
      
      if ((j + 1) % 50 === 0 || j === 0) {
        const progress = ((j + 1) / callsWithCandles.length) * 100;
        console.log(`   📊 Progress: ${j + 1}/${callsWithCandles.length} (${progress.toFixed(1)}%)`);
      }
      
      try {
        const chain = call.chain || 'solana';
        const tokenAddress = call.tokenAddress || call.mint;
        if (!tokenAddress) {
          skipped++;
          continue;
        }

        const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
        if (!alertTime.isValid) {
          skipped++;
          continue;
        }
        
        const endTime = alertTime.plus({ days: 7 });

        // Use cache only to avoid API calls
        const originalUseCacheOnly = process.env.USE_CACHE_ONLY;
        process.env.USE_CACHE_ONLY = 'true';
        const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
        if (originalUseCacheOnly !== undefined) {
          process.env.USE_CACHE_ONLY = originalUseCacheOnly;
        } else {
          delete process.env.USE_CACHE_ONLY;
        }

        if (candles.length < 10) {
          skipped++;
          continue;
        }

        const result = simulateStrategyWithParams(candles, strategy);

        trades.push({
          tokenAddress,
          tokenSymbol: call.tokenSymbol || 'UNKNOWN',
          tokenName: call.tokenName || 'Unknown Token',
          chain: chain,
          caller: call.caller || call.creator || 'Unknown',
          alertTime: call.timestamp || call.alertTime || '',
          pnl: result.pnl,
          pnlPercent: (result.pnl - 1) * 100,
          maxReached: result.maxReached,
          holdDuration: result.holdDuration,
          timeToAth: result.timeToAth,
          entryPrice: candles[0]?.close || 0,
          exitPrice: (candles[0]?.close || 0) * result.pnl,
          candlesCount: candles.length,
        });

        processed++;
      } catch (error: any) {
        errors++;
      }
    }

    const metrics = calculateMetrics(trades, strategy);
    const strategyResult: StrategyResult = {
      params: strategy,
      ...metrics,
      trades,
    };
    results.push(strategyResult);

    const strategyTime = Date.now() - strategyStartTime;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Strategy Complete`);
    console.log(`${'='.repeat(80)}`);
    console.log(`⏱️  Duration: ${(strategyTime / 1000 / 60).toFixed(1)} minutes`);
    console.log(`📊 Stats: Processed: ${processed} | Skipped: ${skipped} | Errors: ${errors}`);
    console.log(`\n📈 Performance Metrics:`);
    console.log(`   Total PnL: ${metrics.totalPnlPercent >= 0 ? '✅' : '❌'} ${metrics.totalPnlPercent.toFixed(2)}%`);
    console.log(`   Total Trades: ${metrics.totalTrades}`);
    console.log(`   Win Rate: ${(metrics.winRate * 100).toFixed(1)}% (${metrics.winningTrades} wins, ${metrics.losingTrades} losses)`);
    console.log(`   Avg Win: ${(metrics.avgWin * 100).toFixed(2)}%`);
    console.log(`   Avg Loss: ${(metrics.avgLoss * 100).toFixed(2)}%`);
    console.log(`   Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
    console.log(`   Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`);
    console.log(`   Max Drawdown: ${(metrics.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`   Avg Hold Duration: ${metrics.avgHoldDuration.toFixed(0)} minutes`);
    console.log(`   Avg Time to ATH: ${metrics.avgTimeToAth.toFixed(0)} minutes`);
  }

  await closeClickHouse();

  // Save results
  console.log(`\n${'='.repeat(80)}`);
  console.log('💾 Saving results...');
  console.log(`${'='.repeat(80)}\n`);

  // Save summary CSV
  const summaryPath = path.join(OUTPUT_DIR, 'strategy_comparison.csv');
  const csvRows = results.map(r => ({
    Strategy: r.params.name,
    TotalPnL_Percent: r.totalPnlPercent.toFixed(2),
    TotalTrades: r.totalTrades,
    WinRate_Percent: (r.winRate * 100).toFixed(2),
    WinningTrades: r.winningTrades,
    LosingTrades: r.losingTrades,
    AvgWin_Percent: (r.avgWin * 100).toFixed(2),
    AvgLoss_Percent: (r.avgLoss * 100).toFixed(2),
    ProfitFactor: r.profitFactor.toFixed(2),
    SharpeRatio: r.sharpeRatio.toFixed(2),
    MaxDrawdown_Percent: (r.maxDrawdown * 100).toFixed(2),
    AvgHoldDuration_Minutes: r.avgHoldDuration.toFixed(0),
    AvgTimeToAth_Minutes: r.avgTimeToAth.toFixed(0),
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
  console.log(`✅ Summary saved: ${summaryPath}`);

  // Save detailed trade history for each strategy
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const safeName = result.params.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const tradeHistoryPath = path.join(OUTPUT_DIR, `${safeName}_trade_history.csv`);
    
    const tradeRows = result.trades.map((trade, idx) => ({
      'Trade#': idx + 1,
      'TokenAddress': trade.tokenAddress,
      'TokenSymbol': trade.tokenSymbol || 'UNKNOWN',
      'TokenName': trade.tokenName || 'Unknown Token',
      'Chain': trade.chain || 'solana',
      'Caller': trade.caller || 'Unknown',
      'AlertTime': trade.alertTime || '',
      'EntryPrice': trade.entryPrice?.toFixed(8) || '0',
      'ExitPrice': trade.exitPrice?.toFixed(8) || '0',
      'PnL_Multiplier': trade.pnl.toFixed(4),
      'PnL_Percent': trade.pnlPercent.toFixed(2),
      'Max_Multiplier_Reached': trade.maxReached.toFixed(4),
      'HoldDuration_Minutes': trade.holdDuration.toFixed(0),
      'TimeToAth_Minutes': trade.timeToAth.toFixed(0),
      'CandlesCount': trade.candlesCount || 0,
    }));

    await new Promise<void>((resolve, reject) => {
      stringify(tradeRows, { header: true }, (err, output) => {
        if (err) reject(err);
        else {
          fs.writeFileSync(tradeHistoryPath, output);
          resolve();
        }
      });
    });
    console.log(`✅ Trade history saved: ${tradeHistoryPath}`);
  }

  // Print comparison
  console.log(`\n${'='.repeat(80)}`);
  console.log('🏆 STRATEGY COMPARISON');
  console.log(`${'='.repeat(80)}\n`);
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`${'─'.repeat(80)}`);
    console.log(`${i + 1}. ${r.params.name}`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`   Total PnL: ${r.totalPnlPercent >= 0 ? '✅' : '❌'} ${r.totalPnlPercent.toFixed(2)}%`);
    console.log(`   Win Rate: ${(r.winRate * 100).toFixed(2)}% (${r.winningTrades}W / ${r.losingTrades}L)`);
    console.log(`   Profit Factor: ${r.profitFactor.toFixed(2)}`);
    console.log(`   Sharpe Ratio: ${r.sharpeRatio.toFixed(2)}`);
    console.log(`   Max Drawdown: ${(r.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`   Avg Hold Duration: ${r.avgHoldDuration.toFixed(0)} minutes`);
    console.log('');
  }

  const scriptTotalTime = (Date.now() - scriptStartTime) / 1000 / 60;
  console.log(`${'='.repeat(80)}`);
  console.log('✅ Simulation Complete!');
  console.log(`${'='.repeat(80)}`);
  console.log(`   Total time: ${scriptTotalTime.toFixed(1)} minutes`);
  console.log(`   Results saved to: ${OUTPUT_DIR}\n`);
}

// Run simulation
simulateStrategies().catch(console.error);

