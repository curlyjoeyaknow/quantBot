#!/usr/bin/env ts-node
/**
 * Run simulations with top 3 strategies from optimization results
 */

import 'dotenv/config';

import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/csv');

interface StrategyParams {
  profitTargets: Array<{ target: number; percent: number }>;
  trailingStopPercent: number;
  trailingStopActivation: number;
  minExitPrice: number;
  name: string;
}

interface TradeResult {
  timestamp: DateTime;
  pnl: number;
  address: string;
  fullAddress?: string;
  tokenSymbol?: string;
  tokenName?: string;
  chain?: string;
  maxReached: number;
  holdDuration?: number;
  timeToAth?: number;
  caller?: string;
}

/**
 * Simulate a strategy with given parameters
 */
function simulateStrategy(
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

  // Timestamps are in Unix SECONDS
  const holdDurationMinutes = exited
    ? Math.max(0, Math.floor((exitTime - entryTime) / 60))
    : 0;
  const timeToAthMinutes = Math.max(0, Math.floor((athTime - entryTime) / 60));

  return { pnl, maxReached, holdDuration: holdDurationMinutes, timeToAth: timeToAthMinutes };
}

/**
 * Get top 3 strategy parameters
 */
function getTop3Strategies(): StrategyParams[] {
  // Strategy generation logic
  const profitTargetConfigs = [
    [{ target: 2.0, percent: 0.1 }, { target: 3.0, percent: 0.1 }, { target: 5.0, percent: 0.1 }],
    [{ target: 2.0, percent: 0.15 }, { target: 4.0, percent: 0.15 }],
    [{ target: 2.5, percent: 0.1 }, { target: 5.0, percent: 0.1 }],
    [{ target: 3.0, percent: 0.05 }, { target: 5.0, percent: 0.05 }],
    [{ target: 3.0, percent: 0.1 }, { target: 6.0, percent: 0.1 }],
    [{ target: 5.0, percent: 0.05 }],
    [{ target: 4.0, percent: 0.1 }],
    [{ target: 6.0, percent: 0.05 }],
    [],
  ];

  const trailingStopPercents = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45];
  const trailingStopActivations = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
  const minExitPrices = [0.01, 0.02, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60];

  let strategyIndex = 0;
  const top3Indices = [980, 1000, 1010];
  const strategies: StrategyParams[] = [];

  for (const profitTargets of profitTargetConfigs) {
    for (const trailingStopPercent of trailingStopPercents) {
      for (const trailingStopActivation of trailingStopActivations) {
        for (const minExitPrice of minExitPrices) {
          if (trailingStopActivation < 2.0) continue;
          if (minExitPrice > 0.6) continue;

          if (top3Indices.includes(strategyIndex)) {
            strategies.push({
              name: `Strategy_${strategyIndex}`,
              profitTargets,
              trailingStopPercent,
              trailingStopActivation,
              minExitPrice,
            });
          }
          strategyIndex++;
        }
      }
    }
  }

  return strategies;
}

async function runTopStrategiesSimulation() {
  console.log('🚀 Running simulations with top 3 strategies from optimization\n');

  const top3Strategies = getTop3Strategies();
  
  console.log('📊 Top 3 Strategies:\n');
  top3Strategies.forEach((s, i) => {
    console.log(`${i + 1}. ${s.name}:`);
    console.log(`   Profit Targets: ${s.profitTargets.length === 0 ? 'None (let it ride)' : s.profitTargets.map(t => `${(t.percent * 100).toFixed(0)}% at ${t.target.toFixed(1)}x`).join(', ')}`);
    console.log(`   Trailing Stop: ${(s.trailingStopPercent * 100).toFixed(0)}%`);
    console.log(`   Stop Activation: ${s.trailingStopActivation.toFixed(1)}x`);
    console.log(`   Min Exit Price: ${(s.minExitPrice * 100).toFixed(0)}% of entry`);
    console.log('');
  });

  // Load calls data
  console.log('📂 Loading calls data...');
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const allRecords: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  console.log(`✅ Loaded ${allRecords.length} total calls\n`);

  // Deduplicate: Only process unique tokens (ignore duplicate calls for same token)
  console.log('🔍 Deduplicating calls by token address...');
  const uniqueTokens = new Map<string, any>();
  for (const record of allRecords) {
    const tokenAddress = record.tokenAddress || record.mint;
    const chain = record.chain || 'solana';
    
    if (!tokenAddress) continue;
    
    const key = `${chain}:${tokenAddress}`;
    // Use first call for each unique token
    if (!uniqueTokens.has(key)) {
      uniqueTokens.set(key, record);
    }
  }
  
  const records = Array.from(uniqueTokens.values());
  console.log(`✅ Deduplicated: ${records.length} unique tokens (from ${allRecords.length} total calls)\n`);

  // Run simulation for each strategy
  for (const strategy of top3Strategies) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📈 Running simulation: ${strategy.name}`);
    console.log(`${'='.repeat(80)}\n`);

    const tradeResults: TradeResult[] = [];
    let processed = 0;
    let skipped = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const tokenAddress = record.tokenAddress || record.mint;
      const chain = record.chain || 'solana';

      if (!tokenAddress) {
        skipped++;
        continue;
      }

      const alertTime = DateTime.fromISO(record.timestamp || record.alertTime);
      if (!alertTime.isValid) {
        skipped++;
        continue;
      }

      const endTime = alertTime.plus({ days: 60 });

      if ((i + 1) % 100 === 0) {
        console.log(`   Processing ${i + 1}/${records.length}... (processed: ${processed}, skipped: ${skipped})`);
      }

      try {
        const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);

        if (candles.length < 10) {
          skipped++;
          continue;
        }

        const result = simulateStrategy(candles, strategy);

        tradeResults.push({
          timestamp: alertTime,
          pnl: result.pnl,
          address: tokenAddress,
          fullAddress: tokenAddress,
          tokenSymbol: record.tokenSymbol || 'UNKNOWN',
          tokenName: record.tokenName || 'Unknown Token',
          chain: chain,
          maxReached: result.maxReached,
          holdDuration: result.holdDuration,
          timeToAth: result.timeToAth,
          caller: record.caller || record.creator || 'Unknown',
        });

        processed++;
      } catch (error: any) {
        skipped++;
      }
    }

    // Calculate portfolio PNL
    const totalPnl = tradeResults.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
    const totalPnlPercent = tradeResults.length > 0 ? (totalPnl / tradeResults.length) * 100 : 0;

    console.log(`\n✅ ${strategy.name} Complete:`);
    console.log(`   Total Trades: ${processed}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total PnL: ${totalPnlPercent.toFixed(2)}%`);

    // Export CSV
    const safeName = strategy.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const csvPath = path.join(OUTPUT_DIR, `${safeName}_trade_by_trade.csv`);
    
    const csvRows = tradeResults.map((trade, idx) => ({
      'Trade#': idx + 1,
      'Date': trade.timestamp.toFormat('yyyy-MM-dd'),
      'Time': trade.timestamp.toFormat('HH:mm:ss'),
      'TokenAddress': trade.fullAddress || trade.address,
      'TokenSymbol': trade.tokenSymbol || 'UNKNOWN',
      'TokenName': trade.tokenName || 'Unknown Token',
      'Chain': trade.chain || 'solana',
      'Caller': trade.caller || 'Unknown',
      'Investment_SOL': 1.0,
      'PNL_Multiplier': trade.pnl.toFixed(4),
      'Return_SOL': trade.pnl.toFixed(4),
      'Profit_SOL': (trade.pnl - 1.0).toFixed(4),
      'Max_Multiplier_Reached': trade.maxReached.toFixed(4),
      'HoldDuration_Minutes': trade.holdDuration?.toFixed(0) || '0',
      'TimeToAth_Minutes': trade.timeToAth?.toFixed(0) || '0',
    }));

    await new Promise<void>((resolve, reject) => {
      stringify(csvRows, { header: true }, (err, output) => {
        if (err) reject(err);
        else {
          fs.writeFileSync(csvPath, output);
          resolve();
        }
      });
    });

    console.log(`   ✅ Exported to: ${csvPath}\n`);
  }

  console.log('✅ All top 3 strategy simulations complete!\n');
}

runTopStrategiesSimulation().catch(console.error);

