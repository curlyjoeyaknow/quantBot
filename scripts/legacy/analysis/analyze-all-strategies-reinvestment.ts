#!/usr/bin/env ts-node
/**
 * Analyze ALL Strategies with Reinvestment
 * 
 * Loads trade data for all strategies and calculates cumulative portfolio growth
 * to find strategies that excel with reinvestment (high win rates, consistent returns)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { initClickHouse, hasCandles, closeClickHouse } from '../src/storage/clickhouse-client';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OPTIMIZATION_CSV = path.join(__dirname, '../data/exports/strategy-optimization/strategy_comparison_summary.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/reinvestment-analysis');

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

interface Trade {
  tokenAddress: string;
  alertTime: string;
  pnl: number;
  pnlPercent: number;
  timestamp: DateTime;
}

interface ReinvestmentResult {
  strategyName: string;
  params: StrategyParams;
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
}

// Import simulation function from optimize-strategies.ts
function simulateStrategyWithParams(candles: any[], params: StrategyParams): { pnl: number; maxReached: number; holdDuration: number; timeToAth: number } {
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

    for (const target of params.profitTargets) {
      const targetPrice = entryPrice * target.target;
      if (!targetsHit.has(target.target) && remaining > 0 && effectiveHigh >= targetPrice) {
        const sellPercent = Math.min(target.percent, remaining);
        pnl += sellPercent * target.target;
        remaining -= sellPercent;
        targetsHit.add(target.target);
      }
    }

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

  if (pnl < params.minExitPrice) {
    pnl = params.minExitPrice;
  }

  const holdDurationMinutes = exited
    ? Math.max(0, Math.floor((exitTime - entryTime) / 60))
    : 0;
  const timeToAthMinutes = Math.max(0, Math.floor((athTime - entryTime) / 60));

  return { pnl, maxReached, holdDuration: holdDurationMinutes, timeToAth: timeToAthMinutes };
}

function calculateReinvestmentPerformance(
  trades: Trade[],
  initialPortfolio: number = 100,
  positionSizePercent: number = 0.02
): Omit<ReinvestmentResult, 'strategyName' | 'params' | 'winRate' | 'avgPnlPerTrade' | 'profitFactor'> {
  const sortedTrades = [...trades].sort((a, b) => 
    a.timestamp.toMillis() - b.timestamp.toMillis()
  );

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

function generateStrategyCombinations(): StrategyParams[] {
  const strategies: StrategyParams[] = [];
  
  // Focus on strategies with profit targets (higher win rates)
  const profitTargetConfigs = [
    [{ target: 2.0, percent: 0.50 }], // 50% @ 2x
    [{ target: 2.0, percent: 0.30 }, { target: 3.0, percent: 0.20 }], // 30% @ 2x, 20% @ 3x
    [{ target: 2.0, percent: 0.20 }, { target: 3.0, percent: 0.20 }, { target: 5.0, percent: 0.10 }], // 20% @ 2x, 20% @ 3x, 10% @ 5x
    [{ target: 1.5, percent: 0.30 }, { target: 2.0, percent: 0.30 }], // 30% @ 1.5x, 30% @ 2x
    [{ target: 2.0, percent: 0.40 }, { target: 5.0, percent: 0.20 }], // 40% @ 2x, 20% @ 5x
  ];

  const trailingStopPercents = [0.20, 0.25, 0.30];
  const trailingStopActivations = [2.0, 3.0, 5.0];
  const minExitPrices = [0.70, 0.80, 0.90]; // 30%, 20%, 10% stop losses

  let idx = 0;
  for (const profitTargets of profitTargetConfigs) {
    for (const trailingStopPercent of trailingStopPercents) {
      for (const trailingStopActivation of trailingStopActivations) {
        for (const minExitPrice of minExitPrices) {
          strategies.push({
            name: `HighWinRate_${idx++}`,
            profitTargets,
            trailingStopPercent,
            trailingStopActivation,
            minExitPrice,
          });
        }
      }
    }
  }

  return strategies;
}

async function analyzeAllStrategiesWithReinvestment() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('💰 COMPREHENSIVE REINVESTMENT ANALYSIS');
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

  // Generate high win-rate strategies
  const strategies = generateStrategyCombinations();
  console.log(`🧪 Testing ${strategies.length} high win-rate strategies...\n`);

  const results: ReinvestmentResult[] = [];
  const initialPortfolio = 100;
  const positionSizePercent = 0.02;

  // Test each strategy
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    
    if ((i + 1) % 10 === 0) {
      console.log(`   Testing strategy ${i + 1}/${strategies.length}...`);
    }

    const trades: Trade[] = [];
    
    for (const call of callsWithCandles.slice(0, 238)) { // Use same 238 tokens
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
          pnl: result.pnl,
          pnlPercent: (result.pnl - 1) * 100,
          timestamp: alertTime,
        });
      } catch (error) {
        // Skip errors
      }
    }

    if (trades.length === 0) continue;

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
    const reinvestment = calculateReinvestmentPerformance(trades, initialPortfolio, positionSizePercent);

    results.push({
      strategyName: strategy.name,
      params: strategy,
      ...reinvestment,
      winRate,
      avgPnlPerTrade,
      profitFactor,
    });
  }

  await closeClickHouse();

  // Sort by final portfolio (reinvestment performance)
  results.sort((a, b) => b.finalPortfolio - a.finalPortfolio);

  console.log(`\n${'='.repeat(80)}`);
  console.log('🏆 TOP 20 STRATEGIES BY REINVESTMENT PERFORMANCE');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Rank | Win Rate | Avg PnL | Final Portfolio | Compound | Profit Factor | Strategy');
  console.log('-'.repeat(100));

  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i];
    const profitTargets = r.params.profitTargets.map(t => `${(t.percent*100).toFixed(0)}% @ ${t.target}x`).join(', ');
    const strategyDesc = profitTargets || 'No targets';
    
    console.log(
      `${(i + 1).toString().padStart(4)} | ` +
      `${(r.winRate * 100).toFixed(1).padStart(7)}% | ` +
      `${r.avgPnlPerTrade >= 0 ? '+' : ''}${r.avgPnlPerTrade.toFixed(2).padStart(6)}% | ` +
      `${r.finalPortfolio.toFixed(2).padStart(14)} | ` +
      `${r.compoundGrowthFactor.toFixed(2).padStart(8)}x | ` +
      `${r.profitFactor.toFixed(2).padStart(13)} | ` +
      `${strategyDesc.substring(0, 40)}`
    );
  }

  // Compare top by reinvestment vs top by avg PnL
  const topByReinvestment = results[0];
  const topByAvgPnl = [...results].sort((a, b) => b.avgPnlPerTrade - a.avgPnlPerTrade)[0];

  console.log(`\n${'='.repeat(80)}`);
  console.log('🔍 COMPARISON');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Top by Reinvestment Performance:');
  console.log(`  Win Rate: ${(topByReinvestment.winRate * 100).toFixed(2)}%`);
  console.log(`  Avg PnL per Trade: ${topByReinvestment.avgPnlPerTrade >= 0 ? '+' : ''}${topByReinvestment.avgPnlPerTrade.toFixed(2)}%`);
  console.log(`  Final Portfolio: ${topByReinvestment.finalPortfolio.toFixed(2)} units`);
  console.log(`  Compound Factor: ${topByReinvestment.compoundGrowthFactor.toFixed(2)}x\n`);

  console.log('Top by Average PnL per Trade:');
  console.log(`  Win Rate: ${(topByAvgPnl.winRate * 100).toFixed(2)}%`);
  console.log(`  Avg PnL per Trade: ${topByAvgPnl.avgPnlPerTrade >= 0 ? '+' : ''}${topByAvgPnl.avgPnlPerTrade.toFixed(2)}%`);
  console.log(`  Final Portfolio: ${topByAvgPnl.finalPortfolio.toFixed(2)} units`);
  console.log(`  Compound Factor: ${topByAvgPnl.compoundGrowthFactor.toFixed(2)}x\n`);

  const difference = topByReinvestment.finalPortfolio - topByAvgPnl.finalPortfolio;
  const differencePercent = (difference / topByAvgPnl.finalPortfolio) * 100;
  
  if (Math.abs(difference) > 0.01) {
    console.log(`💡 Reinvestment-optimized strategy ${difference >= 0 ? 'outperforms' : 'underperforms'} by:`);
    console.log(`   ${difference.toFixed(2)} units (${difference >= 0 ? '+' : ''}${differencePercent.toFixed(2)}%)\n`);
  }

  // Save results
  const { stringify } = await import('csv-stringify');
  const outputPath = path.join(OUTPUT_DIR, 'all_strategies_reinvestment.csv');
  const csvRows = results.map(r => ({
    Rank: results.indexOf(r) + 1,
    Strategy: r.strategyName,
    WinRate: (r.winRate * 100).toFixed(2),
    AvgPnlPerTrade: r.avgPnlPerTrade.toFixed(2),
    FinalPortfolio: r.finalPortfolio.toFixed(2),
    TotalReturn: r.totalReturnPercent.toFixed(2),
    CompoundFactor: r.compoundGrowthFactor.toFixed(4),
    ProfitFactor: r.profitFactor.toFixed(2),
    MaxDrawdown: (r.maxDrawdown * 100).toFixed(2),
    TotalTrades: r.totalTrades,
    ProfitTargets: JSON.stringify(r.params.profitTargets),
    TrailingStop: `${(r.params.trailingStopPercent * 100).toFixed(0)}% @ ${r.params.trailingStopActivation}x`,
    StopLoss: `${((1 - r.params.minExitPrice) * 100).toFixed(0)}%`,
  }));

  await new Promise<void>((resolve, reject) => {
    stringify(csvRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(outputPath, output);
        resolve();
      }
    });
  });

  console.log(`✅ Results saved to: ${outputPath}\n`);
}

analyzeAllStrategiesWithReinvestment().catch(console.error);

