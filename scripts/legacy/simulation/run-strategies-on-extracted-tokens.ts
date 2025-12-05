#!/usr/bin/env ts-node
/**
 * Run Strategies on Extracted Tokens (September Onwards)
 * 
 * Simple, fast script that uses extracted tokens JSON and runs all strategies
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import * as fs from 'fs';
import * as path from 'path';
import { fetchHybridCandles } from '../../../src/simulation/candles';
import { stringify } from 'csv-stringify';

const EXTRACTED_TOKENS_JSON = path.join(process.cwd(), 'data/exports/september-onwards-extraction-results.json');
const OUTPUT_DIR = path.join(process.cwd(), 'data/exports/strategy-simulation-extracted');

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
  profitFactor: number;
  trades: TradeResult[];
}

/**
 * Simulate a strategy with given parameters
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
  let trailingStopPrice = 0;
  let trailingStopActive = false;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const currentPrice = candle.close;
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp
        : new Date(candle.timestamp).getTime()
      : candle.time
      ? typeof candle.time === 'number'
        ? candle.time
        : new Date(candle.time).getTime()
      : Date.now();

    if (currentPrice > highestPrice) {
      highestPrice = currentPrice;
      athTime = candleTime;
      maxReached = currentPrice / entryPrice;
    }

    // Check profit targets
    for (const target of params.profitTargets) {
      if (!targetsHit.has(target.target) && currentPrice >= entryPrice * target.target) {
        const sellAmount = remaining * target.percent;
        pnl += sellAmount * target.target;
        remaining -= sellAmount;
        targetsHit.add(target.target);

        // Activate trailing stop if threshold reached
        if (target.target >= params.trailingStopActivation && !trailingStopActive) {
          trailingStopActive = true;
          trailingStopPrice = currentPrice * (1 - params.trailingStopPercent);
        }
      }
    }

    // Update trailing stop
    if (trailingStopActive) {
      const newTrailingStop = currentPrice * (1 - params.trailingStopPercent);
      if (newTrailingStop > trailingStopPrice) {
        trailingStopPrice = newTrailingStop;
      }
    }

    // Check stop loss or trailing stop
    if (currentPrice <= entryPrice * params.minExitPrice) {
      pnl += remaining * (currentPrice / entryPrice);
      remaining = 0;
      exitTime = candleTime;
      exited = true;
      break;
    }

    if (trailingStopActive && currentPrice <= trailingStopPrice) {
      pnl += remaining * (trailingStopPrice / entryPrice);
      remaining = 0;
      exitTime = candleTime;
      exited = true;
      break;
    }
  }

  // If still holding, exit at final price
  if (!exited && remaining > 0) {
    const finalPrice = candles[candles.length - 1].close;
    pnl += remaining * (finalPrice / entryPrice);
    exitTime = candles[candles.length - 1].timestamp
      ? typeof candles[candles.length - 1].timestamp === 'number'
        ? candles[candles.length - 1].timestamp
        : new Date(candles[candles.length - 1].timestamp).getTime()
      : candles[candles.length - 1].time
      ? typeof candles[candles.length - 1].time === 'number'
        ? candles[candles.length - 1].time
        : new Date(candles[candles.length - 1].time).getTime()
      : Date.now();
  }

  const holdDuration = (exitTime - entryTime) / (1000 * 60); // minutes
  const timeToAth = (athTime - entryTime) / (1000 * 60); // minutes

  return { pnl, maxReached, holdDuration, timeToAth };
}

/**
 * Get all strategy presets - define inline for simplicity
 */
function getAllStrategies(): StrategyParams[] {
  return [
    {
      name: 'MultiTP_10pctTrail_50pctDropRebound_24h',
      profitTargets: [
        { target: 2.0, percent: 0.2 },
        { target: 5.0, percent: 0.3 },
        { target: 10.0, percent: 0.3 },
      ],
      trailingStopPercent: 0.10,
      trailingStopActivation: 5.0,
      minExitPrice: 0.5, // 50% stop loss
    },
    {
      name: 'Conservative_2x_50pct_24h',
      profitTargets: [
        { target: 2.0, percent: 0.5 },
      ],
      trailingStopPercent: 0.20,
      trailingStopActivation: 3.0,
      minExitPrice: 0.7, // 30% stop loss
    },
    {
      name: 'Aggressive_5x_30pct_24h',
      profitTargets: [
        { target: 5.0, percent: 0.3 },
      ],
      trailingStopPercent: 0.15,
      trailingStopActivation: 5.0,
      minExitPrice: 0.6, // 40% stop loss
    },
    {
      name: 'MultiTP_20pctTrail_30pctDropRebound_24h',
      profitTargets: [
        { target: 2.0, percent: 0.3 },
        { target: 5.0, percent: 0.4 },
      ],
      trailingStopPercent: 0.20,
      trailingStopActivation: 3.0,
      minExitPrice: 0.7, // 30% stop loss
    },
    {
      name: 'LetItRide_20pctTrail_24h',
      profitTargets: [],
      trailingStopPercent: 0.20,
      trailingStopActivation: 2.0,
      minExitPrice: 0.8, // 20% stop loss
    },
  ];
}

async function runStrategies() {
  const scriptStartTime = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 RUNNING STRATEGIES ON EXTRACTED TOKENS`);
  console.log(`${'='.repeat(80)}\n`);

  // Load extracted tokens
  console.log('📂 Loading extracted tokens...');
  if (!fs.existsSync(EXTRACTED_TOKENS_JSON)) {
    console.error(`❌ File not found: ${EXTRACTED_TOKENS_JSON}`);
    process.exit(1);
  }

  const extractedData = JSON.parse(fs.readFileSync(EXTRACTED_TOKENS_JSON, 'utf8'));
  const tokens = extractedData.tokens || extractedData;
  
  if (!Array.isArray(tokens)) {
    console.error('❌ Invalid format: tokens must be an array');
    process.exit(1);
  }

  console.log(`✅ Loaded ${tokens.length} extracted tokens\n`);

  // Use all tokens (we'll check for candles when fetching)
  const tokensWithCandles = tokens;
  console.log(`✅ Processing ${tokensWithCandles.length} tokens\n`);

  // Get all strategies
  const strategies = getAllStrategies();
  console.log(`📊 Found ${strategies.length} strategies to test\n`);

  // Set cache-only mode
  process.env.USE_CACHE_ONLY = 'true';

  const results: StrategyResult[] = [];

  // Test each strategy
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const strategyStartTime = Date.now();
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${i + 1}/${strategies.length}] Testing: ${strategy.name}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`🔄 Processing ${tokensWithCandles.length} tokens...\n`);

    const trades: TradeResult[] = [];
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (let j = 0; j < tokensWithCandles.length; j++) {
      const token = tokensWithCandles[j];
      
      if ((j + 1) % 100 === 0 || j === 0) {
        const progress = ((j + 1) / tokensWithCandles.length) * 100;
        console.log(`   📊 Progress: ${j + 1}/${tokensWithCandles.length} (${progress.toFixed(1)}%) - Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`);
      }
      
      try {
        const chain = token.chain || 'solana';
        const mint = token.mint;
        if (!mint) {
          skipped++;
          continue;
        }

        // Get alert time from firstSeen or metadata
        const alertTime = token.firstSeen 
          ? DateTime.fromISO(token.firstSeen)
          : token.metadata?.timestamp
          ? DateTime.fromISO(token.metadata.timestamp)
          : DateTime.now().minus({ days: 7 });

        if (!alertTime.isValid) {
          skipped++;
          continue;
        }

        const endTime = alertTime.plus({ days: 7 });

        const candles = await fetchHybridCandles(mint, alertTime, endTime, chain);

        if (candles.length < 10) {
          skipped++;
          continue;
        }

        const result = simulateStrategyWithParams(candles, strategy);

        trades.push({
          tokenAddress: mint,
          tokenSymbol: token.metadata?.symbol,
          tokenName: token.metadata?.name,
          chain: chain,
          alertTime: alertTime.toISO(),
          pnl: result.pnl,
          pnlPercent: (result.pnl - 1) * 100,
          maxReached: result.maxReached,
          holdDuration: result.holdDuration,
          timeToAth: result.timeToAth,
          entryPrice: candles[0].close,
          exitPrice: candles[candles.length - 1].close,
          candlesCount: candles.length,
        });

        processed++;
      } catch (error: any) {
        errors++;
        if (errors <= 5) {
          console.log(`   ⚠️  Error on token ${token.mint?.substring(0, 20)}: ${error.message}`);
        }
      }
    }

    // Calculate metrics
    const winningTrades = trades.filter(t => t.pnl > 1.0);
    const losingTrades = trades.filter(t => t.pnl <= 1.0);
    const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;
    
    const wins = winningTrades.map(t => t.pnl - 1.0);
    const losses = losingTrades.map(t => 1.0 - t.pnl);
    const totalWins = wins.reduce((a, b) => a + b, 0);
    const totalLosses = losses.reduce((a, b) => a + b, 0);
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;
    
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
    const totalPnlPercent = trades.length > 0 ? (totalPnl / trades.length) * 100 : 0;
    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

    const strategyResult: StrategyResult = {
      params: strategy,
      totalPnl,
      totalPnlPercent,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      trades,
    };

    results.push(strategyResult);

    const strategyDuration = ((Date.now() - strategyStartTime) / 1000).toFixed(1);
    console.log(`\n✅ Strategy complete in ${strategyDuration}s:`);
    console.log(`   Total Trades: ${trades.length}`);
    console.log(`   Win Rate: ${(winRate * 100).toFixed(1)}%`);
    console.log(`   Total PnL: ${totalPnl.toFixed(2)} (${totalPnlPercent.toFixed(2)}% avg)`);
    console.log(`   Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log(`   Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`);
  }

  // Save results
  console.log(`\n${'='.repeat(80)}`);
  console.log('💾 SAVING RESULTS');
  console.log(`${'='.repeat(80)}\n`);

  const timestamp = DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss');
  const resultsDir = path.join(OUTPUT_DIR, timestamp);
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  // Save summary
  const summaryPath = path.join(resultsDir, 'summary.json');
  const summary = {
    timestamp,
    totalStrategies: results.length,
    totalTokens: tokensWithCandles.length,
    strategies: results.map(r => ({
      name: r.params.name,
      totalTrades: r.totalTrades,
      winRate: r.winRate,
      totalPnl: r.totalPnl,
      totalPnlPercent: r.totalPnlPercent,
      profitFactor: r.profitFactor,
    })),
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`✅ Saved summary: ${summaryPath}`);

  // Save per-strategy CSV
  for (const result of results) {
    const safeName = result.params.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const csvPath = path.join(resultsDir, `${safeName}_trades.csv`);
    
    await new Promise<void>((resolve, reject) => {
      stringify(
        result.trades,
        {
          header: true,
          columns: [
            'tokenAddress',
            'tokenSymbol',
            'tokenName',
            'chain',
            'alertTime',
            'pnl',
            'pnlPercent',
            'maxReached',
            'holdDuration',
            'timeToAth',
            'entryPrice',
            'exitPrice',
            'candlesCount',
          ],
        },
        (err, output) => {
          if (err) reject(err);
          else {
            fs.writeFileSync(csvPath, output);
            resolve();
          }
        }
      );
    });
    
    console.log(`✅ Saved ${result.trades.length} trades: ${csvPath}`);
  }

  const totalDuration = ((Date.now() - scriptStartTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ All strategies complete in ${totalDuration} minutes`);
  console.log(`📊 Results saved to: ${resultsDir}\n`);
}

runStrategies().catch(console.error);

