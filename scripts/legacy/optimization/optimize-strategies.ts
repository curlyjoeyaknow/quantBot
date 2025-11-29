#!/usr/bin/env ts-node
/**
 * Strategy Optimization Framework with ML Support
 * 
 * Tests multiple strategy parameter combinations and uses ML to find optimal parameters.
 * Leverages ClickHouse for fast data access.
 */

// Load environment variables from .env file
import 'dotenv/config';

import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/strategy-optimization');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface StrategyParams {
  // Profit target levels (multiplier, percent to sell)
  profitTargets: Array<{ target: number; percent: number }>;
  
  // Trailing stop configuration
  trailingStopPercent: number; // e.g., 0.25 = 25% trailing stop
  trailingStopActivation: number; // Activate after this multiplier (e.g., 2x, 3x)
  
  // Risk management
  minExitPrice: number; // Minimum exit price as fraction of entry (e.g., 0.02 = 2%)
  
  // Strategy name for identification
  name: string;
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
  trades: Array<{
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
  }>;
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

    // Filter out flash spikes: if high is >10x the close, it's likely a wick/spike
    // Use the close price instead for more realistic trading
    const effectiveHigh = candle.close > 0 && candle.high / candle.close > 10 
      ? candle.close * 1.05 // Allow 5% above close for realistic slippage
      : candle.high;
    
    const effectiveLow = candle.close > 0 && candle.low / candle.close < 0.1
      ? candle.close * 0.95 // Allow 5% below close for realistic slippage
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
      // Use effectiveHigh (filtered for spikes)
      if (!targetsHit.has(target.target) && remaining > 0 && effectiveHigh >= targetPrice) {
        const sellPercent = Math.min(target.percent, remaining);
        pnl += sellPercent * target.target;
        remaining -= sellPercent;
        targetsHit.add(target.target);
      }
    }

    // Trailing stop logic
    // FIXED: Trailing stop should activate when maxReached >= activation, regardless of profit targets
    // If no profit targets exist, we still want trailing stop protection after reaching activation level
    const trailingStopShouldActivate = params.profitTargets.length === 0
      ? maxReached >= params.trailingStopActivation  // No targets: activate when price reaches level
      : maxReached >= params.trailingStopActivation && targetsHit.has(params.trailingStopActivation);  // Has targets: activate after target is hit
    
    if (remaining > 0 && trailingStopShouldActivate) {
      const trailingStopPrice = highestPrice * (1 - params.trailingStopPercent);
      const actualStopPrice = Math.max(trailingStopPrice, minExitPrice);

      // Use effectiveLow (filtered for spikes)
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

  // Timestamps are in Unix SECONDS (not milliseconds), so divide by 60 to get minutes
  const holdDurationMinutes = exited
    ? Math.max(0, Math.floor((exitTime - entryTime) / 60))
    : 0;
  const timeToAthMinutes = Math.max(0, Math.floor((athTime - entryTime) / 60));

  return { pnl, maxReached, holdDuration: holdDurationMinutes, timeToAth: timeToAthMinutes };
}

/**
 * Generate strategy parameter combinations to test
 */
function generateStrategyCombinations(): StrategyParams[] {
  const strategies: StrategyParams[] = [];

  // Base strategy variations - expanded for comprehensive testing
  const profitTargetConfigs = [
    // Conservative: take profits early
    [
      { target: 2.0, percent: 0.1 },
      { target: 3.0, percent: 0.1 },
      { target: 5.0, percent: 0.1 },
    ],
    [
      { target: 2.0, percent: 0.15 },
      { target: 4.0, percent: 0.15 },
    ],
    [
      { target: 2.5, percent: 0.1 },
      { target: 5.0, percent: 0.1 },
    ],
    // Current: minimal early profit taking
    [
      { target: 3.0, percent: 0.05 },
      { target: 5.0, percent: 0.05 },
    ],
    [
      { target: 3.0, percent: 0.1 },
      { target: 6.0, percent: 0.1 },
    ],
    // Aggressive: let it ride
    [{ target: 5.0, percent: 0.05 }],
    [{ target: 4.0, percent: 0.1 }],
    [{ target: 6.0, percent: 0.05 }],
    // Very aggressive: no early profit taking
    [],
  ];

  const trailingStopPercents = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45];
  const trailingStopActivations = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
  const minExitPrices = [0.01, 0.02, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60];

  let strategyIndex = 0;
  for (const profitTargets of profitTargetConfigs) {
    for (const trailingStopPercent of trailingStopPercents) {
      for (const trailingStopActivation of trailingStopActivations) {
        for (const minExitPrice of minExitPrices) {
          // Skip invalid combinations
          if (trailingStopActivation < 2.0) continue;
          // Allow minExitPrice up to 0.6 (40% max loss cap)
          if (minExitPrice > 0.6) continue;

          strategies.push({
            name: `Strategy_${strategyIndex++}`,
            profitTargets,
            trailingStopPercent,
            trailingStopActivation,
            minExitPrice,
          });
        }
      }
    }
  }

  // Generate more combinations for comprehensive testing
  // This will create ~400-800 strategy combinations
  return strategies; // Return all combinations for ML optimization
}

/**
 * Calculate performance metrics
 */
function calculateMetrics(trades: StrategyResult['trades'], strategyParams?: StrategyParams): Omit<StrategyResult, 'params' | 'trades'> {
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

  // Calculate Sharpe ratio (simplified)
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

  // Max drawdown: track cumulative portfolio value over time
  // Risk management rule: Maximum RISK per trade = 2% of portfolio
  // Position size is determined by: position_size = 2% / stop_loss_percentage
  // Example: If stop loss is 40% (minExitPrice = 0.6), position = 2% / 40% = 5% of portfolio
  //          If stop loss is 5%, position = 2% / 5% = 40% of portfolio
  const maxRiskPerTrade = 0.02; // 2% of portfolio maximum risk per trade
  let maxDrawdown = 0;
  let peak = 1.0;
  let cumulative = 1.0;
  
  // Get max loss percentage from strategy params (stop loss)
  const maxLossPercentage = strategyParams ? (1 - strategyParams.minExitPrice) : 0.4; // Default to 40% if not provided
  
  // Calculate position size based on risk management rule
  // position_size = maxRiskPerTrade / maxLossPercentage
  const positionSize = maxRiskPerTrade / maxLossPercentage;
  
  for (const trade of trades) {
    // Calculate trade return (gain/loss multiplier - 1)
    const tradeReturn = trade.pnl - 1.0; // e.g., 0.5 = 50% gain, -0.5 = 50% loss
    
    // Portfolio impact = position_size * trade_return
    // This correctly accounts for position sizing based on stop loss
    // Example: position = 5% (if 40% stop loss), trade loses 40% → portfolio impact = 5% * -40% = -2%
    //          position = 5%, trade gains 100% → portfolio impact = 5% * 100% = +5%
    const portfolioImpact = positionSize * tradeReturn;
    
    cumulative = cumulative + portfolioImpact;
    
    // Update peak if we've reached a new high
    if (cumulative > peak) {
      peak = cumulative;
    }
    
    // Calculate drawdown from peak (as a percentage)
    if (peak > 0 && cumulative >= 0) {
      const drawdown = (peak - cumulative) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }
  
  // Clamp maxDrawdown to valid range [0, 1]
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
 * Main optimization function
 */
async function optimizeStrategies() {
  const scriptStartTime = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log('🚀 STRATEGY OPTIMIZATION WITH ML SUPPORT');
  console.log(`${'='.repeat(80)}\n`);

  // Load calls data
  console.log('📂 Loading calls data...');
  const loadStart = Date.now();
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  const loadTime = Date.now() - loadStart;
  console.log(`✅ Loaded ${records.length} calls in ${loadTime}ms\n`);

  // Filter to ONLY Brook Giga calls - strict single caller filter
  const TARGET_CALLER = 'Brook Giga I verify @BrookCalls';
  console.log(`🎯 Filtering calls to ONLY: ${TARGET_CALLER}...`);
  console.log(`📋 Ensuring single caller filter is applied...`);
  
  let brookGigaCalls = records.filter(record => {
    const caller = (record.sender || record.caller || '').trim();
    // Strict filter: must match exactly or contain "Brook Giga" (case-insensitive)
    const normalizedCaller = caller.toLowerCase();
    const normalizedTarget = TARGET_CALLER.toLowerCase();
    return normalizedCaller === normalizedTarget || 
           normalizedCaller.includes('brook giga') ||
           caller === TARGET_CALLER;
  });
  
  // Verify only one unique caller is present
  const uniqueCallers = new Set(brookGigaCalls.map(r => (r.sender || r.caller || '').trim()));
  console.log(`📊 Found ${uniqueCallers.size} unique caller(s) in filtered data:`);
  uniqueCallers.forEach(caller => console.log(`   - "${caller}"`));
  
  if (uniqueCallers.size > 1) {
    console.warn(`⚠️  WARNING: Multiple callers found! Expected only "${TARGET_CALLER}"`);
    console.warn(`   Applying strict filter to exact match only...`);
    brookGigaCalls = brookGigaCalls.filter(record => {
      const caller = (record.sender || record.caller || '').trim();
      return caller === TARGET_CALLER || caller.toLowerCase().includes('brook giga');
  });
    console.log(`✅ Strict filter applied: ${brookGigaCalls.length} calls from ${TARGET_CALLER} (from ${records.length} total calls)\n`);
  } else {
  console.log(`✅ Filtered to ${brookGigaCalls.length} calls from ${TARGET_CALLER} (from ${records.length} total calls)\n`);
  }

  // Deduplicate: Only process unique tokens (ignore duplicate calls for same token)
  console.log('🔍 Deduplicating calls by token address...');
  const uniqueTokens = new Map<string, any>();
  for (const record of brookGigaCalls) {
    const tokenAddress = record.tokenAddress || record.mint;
    const chain = record.chain || 'solana';
    
    if (!tokenAddress) continue;
    
    const key = `${chain}:${tokenAddress}`;
    // Use first call for each unique token
    if (!uniqueTokens.has(key)) {
      uniqueTokens.set(key, record);
    }
  }
  
  const uniqueCalls = Array.from(uniqueTokens.values());
  console.log(`✅ Deduplicated: ${uniqueCalls.length} unique tokens (from ${brookGigaCalls.length} Brook Giga calls)\n`);

  // Pre-filter calls that have candles available (to avoid wasting time on calls without data)
  console.log('🔍 Pre-filtering calls with available candle data...');
  const { initClickHouse, hasCandles, closeClickHouse } = await import('../src/storage/clickhouse-client');
  await initClickHouse();
  
  const callsWithCandles: any[] = [];
  const uniqueTokenChecks = new Map<string, boolean>(); // Cache token checks
  
  for (let i = 0; i < uniqueCalls.length; i++) {
    const call = uniqueCalls[i];
    const tokenAddress = call.tokenAddress || call.mint;
    const chain = call.chain || 'solana';
    
    if (!tokenAddress) continue;
    
    const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
    if (!alertTime.isValid) continue;
    
    const endTime = alertTime.plus({ days: 7 });
    
    // Check if candles exist
    const hasData = await hasCandles(tokenAddress, chain, alertTime, endTime);
    
    if (hasData) {
      callsWithCandles.push(call);
    }
    
    if ((i + 1) % 100 === 0) {
      console.log(`   Checked ${i + 1}/${uniqueCalls.length} unique tokens... ${callsWithCandles.length} have candles`);
    }
  }
  
  console.log(`✅ Pre-filtering complete: ${callsWithCandles.length}/${uniqueCalls.length} unique tokens have candle data\n`);

  // Generate strategy combinations
  console.log('🧪 Generating strategy combinations...');
  const genStart = Date.now();
  const strategies = generateStrategyCombinations();
  const genTime = Date.now() - genStart;
  console.log(`✅ Generated ${strategies.length} strategy combinations in ${genTime}ms`);
  
  const USE_SUBSET = process.env.OPTIMIZE_FAST === 'true';
  const testCallsCount = USE_SUBSET ? Math.min(200, callsWithCandles.length) : callsWithCandles.length;
  console.log(`📊 Configuration:`);
  console.log(`   Strategies to test: ${strategies.length}`);
  console.log(`   Calls per strategy: ${testCallsCount} (${USE_SUBSET ? 'FAST MODE' : 'FULL MODE'})`);
  console.log(`   Total simulations: ${strategies.length * testCallsCount}`);
  const estimatedMinutes = ((strategies.length * testCallsCount * 0.5) / 60).toFixed(0);
  console.log(`   Estimated time: ~${estimatedMinutes} minutes (at ~0.5s per call)\n`);

  const results: StrategyResult[] = [];

  // Initialize incremental save files
  const summaryPath = path.join(OUTPUT_DIR, 'strategy_comparison_summary.csv');
  const top10Path = path.join(OUTPUT_DIR, 'top_10_strategies.json');
  
  // Initialize CSV file with headers
  const csvHeaders = [
    'Strategy',
    'Total PnL %',
    'Total Trades',
    'Win Rate %',
    'Avg Win',
    'Avg Loss',
    'Profit Factor',
    'Sharpe Ratio',
    'Max Drawdown %',
    'Trailing Stop %',
    'Stop Activation',
    'Min Exit %',
    'Profit Targets',
  ];
  fs.writeFileSync(summaryPath, csvHeaders.join(',') + '\n');
  console.log(`📝 Initialized incremental save file: ${summaryPath}`);

  // Initialize top 10 JSON file
  fs.writeFileSync(top10Path, JSON.stringify([], null, 2));
  console.log(`📝 Initialized incremental save file: ${top10Path}\n`);

  // Test each strategy
  const startTime = Date.now();
  
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const strategyStartTime = Date.now();
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${i + 1}/${strategies.length}] Testing Strategy: ${strategy.name}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`📊 Configuration:`);
    console.log(`   Profit Targets: ${strategy.profitTargets.length} levels`);
    strategy.profitTargets.forEach((t, idx) => {
      console.log(`     ${idx + 1}. Sell ${(t.percent * 100).toFixed(0)}% at ${t.target.toFixed(1)}x`);
    });
    console.log(`   Trailing Stop: ${(strategy.trailingStopPercent * 100).toFixed(0)}%`);
    console.log(`   Stop Activation: ${strategy.trailingStopActivation.toFixed(1)}x`);
    console.log(`   Min Exit Price: ${(strategy.minExitPrice * 100).toFixed(0)}% of entry`);
    console.log(`\n🔄 Processing calls...`);

    const trades: StrategyResult['trades'] = [];
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    // Test on all calls for comprehensive results (or use subset for faster testing)
    const USE_SUBSET = process.env.OPTIMIZE_FAST === 'true';
    const testCalls = USE_SUBSET 
      ? callsWithCandles.slice(0, Math.min(200, callsWithCandles.length))
      : callsWithCandles;
    console.log(`   Testing on ${testCalls.length} calls (${USE_SUBSET ? 'FAST MODE - subset' : 'FULL MODE - all calls with candles'})\n`);

    for (let j = 0; j < testCalls.length; j++) {
      const call = testCalls[j];
      const callStartTime = Date.now();
      
      // Verbose progress every 10 calls, summary every 50
      const isVerboseUpdate = (j + 1) % 10 === 0 || j === 0;
      const isSummaryUpdate = (j + 1) % 50 === 0 || j === 0;
      
      if (isSummaryUpdate) {
        const progress = ((j + 1) / testCalls.length) * 100;
        const elapsed = (Date.now() - strategyStartTime) / 1000;
        const rate = (j + 1) / elapsed;
        const remaining = testCalls.length - (j + 1);
        const eta = remaining / rate;
        console.log(`\n   📊 Progress: ${j + 1}/${testCalls.length} (${progress.toFixed(1)}%)`);
        console.log(`      Processed: ${processed} | Skipped: ${skipped} | Errors: ${errors}`);
        console.log(`      Rate: ${rate.toFixed(1)} calls/sec | Elapsed: ${(elapsed / 60).toFixed(1)}m | ETA: ${(eta / 60).toFixed(1)}m`);
      }
      
      try {
        const chain = call.chain || 'solana';
        const tokenAddress = call.tokenAddress || call.mint;
        if (!tokenAddress) {
          skipped++;
          if (isVerboseUpdate) {
            console.log(`      [${j + 1}] ⏭️  Skipped: No token address`);
          }
          continue;
        }

        const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
        if (!alertTime.isValid) {
          skipped++;
          if (isVerboseUpdate) {
            const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
            console.log(`      [${j + 1}] ⏭️  Skipped: Invalid timestamp - ${displayAddr}`);
          }
          continue;
        }
        
        const endTime = alertTime.plus({ days: 7 });

        if (isVerboseUpdate) {
          const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
          console.log(`      [${j + 1}] 🔍 Fetching: ${displayAddr} (${chain})...`);
        }

        // Double-check that candles exist before fetching (skip if not in pre-filtered list)
        // Since we already pre-filtered callsWithCandles, we should have data, but verify anyway
        const fetchStart = Date.now();
        
        // Use USE_CACHE_ONLY mode to avoid API calls for missing data
        // Only fetch from ClickHouse/CSV cache - skip if not available
        const originalUseCacheOnly = process.env.USE_CACHE_ONLY;
        process.env.USE_CACHE_ONLY = 'true';
        // Pass alertTime for 1m candles around alert time
        const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain, alertTime);
        if (originalUseCacheOnly !== undefined) {
          process.env.USE_CACHE_ONLY = originalUseCacheOnly;
        } else {
          delete process.env.USE_CACHE_ONLY;
        }
        const fetchTime = Date.now() - fetchStart;

        if (candles.length < 10) {
          skipped++;
          if (isVerboseUpdate) {
            const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
            console.log(`      [${j + 1}] ⚠️  Insufficient data: ${displayAddr} - ${candles.length} candles (skipped)`);
          }
          continue;
        }

        if (isVerboseUpdate) {
          const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
          const source = fetchTime < 100 ? 'ClickHouse/CSV' : 'API';
          console.log(`      [${j + 1}] ✅ Got ${candles.length} candles (from ${source}, ${fetchTime}ms) - Simulating...`);
        }

        const simStart = Date.now();
        const result = simulateStrategyWithParams(candles, strategy);
        const simTime = Date.now() - simStart;

        // Enrich trade data with all available information
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
        
        if (isVerboseUpdate) {
          const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
          const pnlPercent = ((result.pnl - 1) * 100).toFixed(2);
          const totalTime = Date.now() - callStartTime;
          console.log(`      [${j + 1}] ✅ Complete: ${displayAddr} - PnL: ${pnlPercent}%, Max: ${result.maxReached.toFixed(2)}x (total: ${totalTime}ms)`);
        }
      } catch (error: any) {
        errors++;
        if (isVerboseUpdate) {
          const displayAddr = (call.tokenAddress || call.mint || 'unknown').length > 30 
            ? (call.tokenAddress || call.mint || 'unknown').substring(0, 30) + '...' 
            : (call.tokenAddress || call.mint || 'unknown');
          console.log(`      [${j + 1}] ❌ Error: ${displayAddr} - ${error.message}`);
        }
      }
    }

    const metrics = calculateMetrics(trades, strategy);
    const strategyResult: StrategyResult = {
      params: strategy,
      ...metrics,
      trades,
    };
    results.push(strategyResult);

    // Save incrementally: append to CSV immediately
    const csvRow = [
      strategyResult.params.name,
      strategyResult.totalPnlPercent.toFixed(2),
      strategyResult.totalTrades.toString(),
      (strategyResult.winRate * 100).toFixed(2),
      strategyResult.avgWin.toFixed(4),
      strategyResult.avgLoss.toFixed(4),
      strategyResult.profitFactor.toFixed(2),
      strategyResult.sharpeRatio.toFixed(2),
      (strategyResult.maxDrawdown * 100).toFixed(2),
      (strategyResult.params.trailingStopPercent * 100).toFixed(0),
      strategyResult.params.trailingStopActivation.toFixed(1) + 'x',
      (strategyResult.params.minExitPrice * 100).toFixed(0),
      JSON.stringify(strategyResult.params.profitTargets).replace(/"/g, '""'), // Escape quotes for CSV
    ];
    fs.appendFileSync(summaryPath, csvRow.map(cell => `"${cell}"`).join(',') + '\n');

    // Update top 10 JSON every 10 strategies or if this is in top 10
    const sortedResults = [...results].sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
    const currentTop10 = sortedResults.slice(0, 10);
    
    // Save top 10 JSON (without full trade history to keep file size manageable)
    const top10ForJson = currentTop10.map(r => ({
      params: r.params,
      totalPnl: r.totalPnl,
      totalPnlPercent: r.totalPnlPercent,
      totalTrades: r.totalTrades,
      winningTrades: r.winningTrades,
      losingTrades: r.losingTrades,
      winRate: r.winRate,
      avgWin: r.avgWin,
      avgLoss: r.avgLoss,
      profitFactor: r.profitFactor,
      sharpeRatio: r.sharpeRatio,
      maxDrawdown: r.maxDrawdown,
      avgHoldDuration: r.avgHoldDuration,
      avgTimeToAth: r.avgTimeToAth,
      // Include trade count but not full trade history to keep file size reasonable
      tradeCount: r.trades.length,
    }));
    fs.writeFileSync(top10Path, JSON.stringify(top10ForJson, null, 2));

    const strategyTime = Date.now() - strategyStartTime;
    const elapsedTotal = Date.now() - startTime;
    const avgTimePerStrategy = elapsedTotal / (i + 1);
    const remainingStrategies = strategies.length - (i + 1);
    const estimatedTimeRemaining = (remainingStrategies * avgTimePerStrategy) / 1000 / 60; // minutes

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Strategy ${strategy.name} COMPLETE`);
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
    console.log(`\n⏳ Overall Progress: ${i + 1}/${strategies.length} strategies (${(((i + 1) / strategies.length) * 100).toFixed(1)}%)`);
    console.log(`   Estimated time remaining: ${estimatedTimeRemaining.toFixed(1)} minutes`);
    console.log(`${'='.repeat(80)}\n`);
  }

  // Sort by total PnL (already sorted incrementally, but ensure final sort)
  results.sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);

  // Final results summary
  const optimizationTotalTime = (Date.now() - startTime) / 1000 / 60;
  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ OPTIMIZATION COMPLETE`);
  console.log(`${'='.repeat(80)}`);
  console.log(`⏱️  Total optimization time: ${optimizationTotalTime.toFixed(1)} minutes`);
  console.log(`📊 Strategies tested: ${strategies.length}`);
  console.log(`📈 Unique tokens tested: ${callsWithCandles.length} (from ${uniqueCalls.length} unique tokens, ${brookGigaCalls.length} Brook Giga calls)`);
  console.log(`🎯 Optimized specifically for: ${TARGET_CALLER}`);
  
  await closeClickHouse();
  console.log(`⚡ Avg time per strategy: ${(optimizationTotalTime / strategies.length).toFixed(1)} minutes\n`);

  // Files were saved incrementally, but we need to re-sort the CSV file
  // Read all rows, sort, and rewrite
  console.log(`🔄 Finalizing CSV file (sorting by PnL)...`);
  const csvContent = fs.readFileSync(summaryPath, 'utf8');
  const lines = csvContent.trim().split('\n');
  const header = lines[0];
  const dataLines = lines.slice(1);
  
  // Parse and sort data rows
  const rows = dataLines.map(line => {
    const cells = line.match(/("(?:[^"]|"")*"|[^,]+)(?=\s*,|\s*$)/g) || [];
    return cells.map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"'));
  });
  
  // Sort by Total PnL % (column index 1)
  rows.sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
  
  // Rewrite sorted CSV
  fs.writeFileSync(summaryPath, header + '\n');
  rows.forEach(row => {
    fs.appendFileSync(summaryPath, row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',') + '\n');
  });
  
  console.log(`✅ Summary CSV finalized: ${summaryPath}`);

  // Save final top 10 with full trade history
  console.log(`💾 Saving final top 10 detailed results with full trade history...`);
  const top10WithTrades = results.slice(0, 10).map(r => ({
    params: r.params,
    totalPnl: r.totalPnl,
    totalPnlPercent: r.totalPnlPercent,
    totalTrades: r.totalTrades,
    winningTrades: r.winningTrades,
    losingTrades: r.losingTrades,
    winRate: r.winRate,
    avgWin: r.avgWin,
    avgLoss: r.avgLoss,
    profitFactor: r.profitFactor,
    sharpeRatio: r.sharpeRatio,
    maxDrawdown: r.maxDrawdown,
    avgHoldDuration: r.avgHoldDuration,
    avgTimeToAth: r.avgTimeToAth,
    trades: r.trades, // Include full trade history in final file
  }));
  fs.writeFileSync(top10Path, JSON.stringify(top10WithTrades, null, 2));
  console.log(`✅ Top 10 strategies (with trade history) saved to: ${top10Path}`);

  // Export detailed trade history for top 10 strategies
  console.log(`💾 Exporting detailed trade history for top 10 strategies...`);
  const top10 = results.slice(0, 10);
  
  for (let i = 0; i < top10.length; i++) {
    const strategy = top10[i];
    if (strategy.trades.length === 0) continue;
    
    const rank = i + 1;
    const safeName = strategy.params.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const tradeHistoryPath = path.join(OUTPUT_DIR, `top_${rank}_${safeName}_trade_history.csv`);
    
    const tradeHistoryRows = strategy.trades.map((trade, idx) => ({
      'Trade#': idx + 1,
      'Rank': rank,
      'Strategy': strategy.params.name,
      'TotalPnL_Percent': strategy.totalPnlPercent.toFixed(2),
      'WinRate_Percent': (strategy.winRate * 100).toFixed(2),
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
      stringify(tradeHistoryRows, { header: true }, (err, output) => {
        if (err) reject(err);
        else {
          fs.writeFileSync(tradeHistoryPath, output);
          resolve();
        }
      });
    });

    console.log(`   ✅ Rank ${rank}: ${strategy.params.name} - ${strategy.trades.length} trades → ${tradeHistoryPath}`);
  }
  
  console.log(`✅ Trade history exported for top ${Math.min(10, top10.length)} strategies\n`);

  console.log(`${'='.repeat(80)}\n`);

  // Print top 10 with detailed info
  console.log(`\n${'='.repeat(80)}`);
  console.log('🏆 TOP 10 STRATEGIES');
  console.log(`${'='.repeat(80)}\n`);
  
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    console.log(`${'─'.repeat(80)}`);
    console.log(`${i + 1}. ${r.params.name}`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`   📊 Performance Metrics:`);
    console.log(`      Total PnL: ${r.totalPnlPercent >= 0 ? '✅' : '❌'} ${r.totalPnlPercent.toFixed(2)}%`);
    console.log(`      Win Rate: ${(r.winRate * 100).toFixed(2)}% (${r.winningTrades}W / ${r.losingTrades}L)`);
    console.log(`      Profit Factor: ${r.profitFactor.toFixed(2)}`);
    console.log(`      Sharpe Ratio: ${r.sharpeRatio.toFixed(2)}`);
    console.log(`      Max Drawdown: ${(r.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`   ⚙️  Configuration:`);
    console.log(`      Profit Targets: ${r.params.profitTargets.length} levels`);
    r.params.profitTargets.forEach((t, idx) => {
      console.log(`         ${idx + 1}. ${(t.percent * 100).toFixed(0)}% @ ${t.target.toFixed(1)}x`);
    });
    console.log(`      Trailing Stop: ${(r.params.trailingStopPercent * 100).toFixed(0)}%`);
    console.log(`      Stop Activation: ${r.params.trailingStopActivation.toFixed(1)}x`);
    console.log(`      Min Exit Price: ${(r.params.minExitPrice * 100).toFixed(0)}%`);
    console.log(`   📈 Trade Statistics:`);
    console.log(`      Total Trades: ${r.totalTrades}`);
    console.log(`      Avg Win: ${(r.avgWin * 100).toFixed(2)}%`);
    console.log(`      Avg Loss: ${(r.avgLoss * 100).toFixed(2)}%`);
    console.log(`      Avg Hold Duration: ${r.avgHoldDuration.toFixed(0)} minutes`);
    console.log(`      Avg Time to ATH: ${r.avgTimeToAth.toFixed(0)} minutes`);
    console.log('');
  }

  const scriptTotalTime = Date.now() - startTime;
  console.log(`${'='.repeat(80)}`);
  console.log('✅ Optimization Complete!');
  console.log(`${'='.repeat(80)}`);
  console.log(`   Total strategies tested: ${results.length}`);
  console.log(`   Total time: ${(scriptTotalTime / 1000 / 60).toFixed(1)} minutes`);
  console.log(`   Average time per strategy: ${(scriptTotalTime / results.length / 1000).toFixed(1)} seconds`);
  console.log(`\n📊 Results saved to:`);
  console.log(`   Summary CSV: ${summaryPath}`);
  console.log(`   Top 10 JSON: ${top10Path}`);
  console.log(`   Output directory: ${OUTPUT_DIR}\n`);
}

// Run optimization
optimizeStrategies().catch(console.error);

