#!/usr/bin/env ts-node
/**
 * Recalculate ALL Strategies with Correct Risk Management
 * 
 * Risk Management Rule: Maximum RISK per trade = 2% of portfolio
 * Position size = 2% / stop_loss_percentage
 * 
 * This ensures that if stop loss hits, we lose exactly 2% of portfolio
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';
import { simulateStrategyWithParams } from './optimize-strategies';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const TOP_STRATEGIES_JSON = path.join(__dirname, '../data/exports/strategy-optimization/top_10_strategies.json');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/reinvestment-analysis-corrected');

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
  positionSizePercent: number;
  stopLossPercent: number;
}

/**
 * Calculate reinvestment performance with CORRECT risk management
 * 
 * Risk Management Rule: Maximum RISK per trade = 2% of portfolio
 * Position size = 2% / stop_loss_percentage
 */
function calculateReinvestmentPerformance(
  trades: Trade[],
  initialPortfolio: number = 100,
  stopLossPercent: number,
  maxRiskPerTrade: number = 0.02
): {
  finalPortfolio: number;
  compoundGrowthFactor: number;
  maxDrawdown: number;
  positionSizePercent: number;
} {
  const sortedTrades = [...trades].sort((a, b) => 
    a.timestamp.toMillis() - b.timestamp.toMillis()
  );

  // Calculate position size based on stop loss
  // Position size = maxRiskPerTrade / stopLossPercent
  // This ensures that if stop loss hits, we lose exactly maxRiskPerTrade of portfolio
  const positionSizePercent = maxRiskPerTrade / stopLossPercent;

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

  const compoundGrowthFactor = portfolio / initialPortfolio;

  return {
    finalPortfolio: portfolio,
    compoundGrowthFactor,
    maxDrawdown,
    positionSizePercent,
  };
}

async function recalculateAllStrategies() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('💰 RECALCULATING ALL STRATEGIES WITH CORRECT RISK MANAGEMENT');
  console.log(`${'='.repeat(80)}\n`);

  // Load top strategies
  console.log('📂 Loading top strategies...');
  const topStrategiesJson = JSON.parse(fs.readFileSync(TOP_STRATEGIES_JSON, 'utf8'));
  console.log(`✅ Loaded ${topStrategiesJson.length} top strategies\n`);

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

  const results: ReinvestmentResult[] = [];
  const initialPortfolio = 100;
  const maxRiskPerTrade = 0.02; // 2% of portfolio maximum risk

  // Process each strategy
  for (let i = 0; i < topStrategiesJson.length; i++) {
    const strategyData = topStrategiesJson[i];
    const strategyParams: StrategyParams = strategyData.params;
    
    console.log(`[${i + 1}/${topStrategiesJson.length}] Recalculating: ${strategyParams.name}`);
    
    const stopLossPercent = 1 - strategyParams.minExitPrice; // e.g., minExitPrice 0.6 = 40% stop loss
    const positionSizePercent = maxRiskPerTrade / stopLossPercent;
    
    console.log(`   Stop Loss: ${(stopLossPercent * 100).toFixed(0)}% | Position Size: ${(positionSizePercent * 100).toFixed(2)}%`);

    const trades: Trade[] = [];

    // Use the trades from the strategy data if available
    if (strategyData.trades && strategyData.trades.length > 0) {
      for (const trade of strategyData.trades) {
        trades.push({
          tokenAddress: trade.tokenAddress || '',
          alertTime: trade.alertTime || '',
          pnl: trade.pnl,
          pnlPercent: trade.pnlPercent || (trade.pnl - 1) * 100,
          timestamp: DateTime.fromISO(trade.alertTime || ''),
        });
      }
    } else {
      // Simulate trades if not available
      console.log(`   ⚠️  No trade data, simulating...`);
      for (const call of uniqueCalls.slice(0, 238)) {
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

          const result = simulateStrategyWithParams(candles, strategyParams);

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
    }

    if (trades.length === 0) {
      console.log(`   ❌ No trades generated\n`);
      continue;
    }

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

    // Calculate reinvestment performance with CORRECT risk management
    const reinvestment = calculateReinvestmentPerformance(
      trades,
      initialPortfolio,
      stopLossPercent,
      maxRiskPerTrade
    );

    const totalReturn = reinvestment.finalPortfolio - initialPortfolio;
    const totalReturnPercent = (totalReturn / initialPortfolio) * 100;

    results.push({
      strategyName: strategyParams.name,
      params: strategyParams,
      initialPortfolio,
      finalPortfolio: reinvestment.finalPortfolio,
      totalReturn,
      totalReturnPercent,
      compoundGrowthFactor: reinvestment.compoundGrowthFactor,
      winRate,
      totalTrades: trades.length,
      avgPnlPerTrade,
      profitFactor,
      maxDrawdown: reinvestment.maxDrawdown,
      positionSizePercent: reinvestment.positionSizePercent,
      stopLossPercent,
    });

    console.log(`   ✅ Final Portfolio: $${reinvestment.finalPortfolio.toFixed(2)} (${reinvestment.compoundGrowthFactor.toFixed(2)}x) | Win Rate: ${(winRate * 100).toFixed(1)}%\n`);
  }

  // Sort by final portfolio (reinvestment performance)
  results.sort((a, b) => b.finalPortfolio - a.finalPortfolio);

  // Display results
  console.log(`\n${'='.repeat(80)}`);
  console.log('🏆 TOP STRATEGIES BY REINVESTMENT PERFORMANCE (CORRECT RISK MANAGEMENT)');
  console.log(`${'='.repeat(80)}\n`);

  console.log('Rank | Win Rate | Avg PnL | Final Portfolio | Compound | Stop Loss | Position Size | Strategy');
  console.log('-'.repeat(120));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(
      `${(i + 1).toString().padStart(4)} | ` +
      `${(r.winRate * 100).toFixed(1).padStart(7)}% | ` +
      `${r.avgPnlPerTrade >= 0 ? '+' : ''}${r.avgPnlPerTrade.toFixed(2).padStart(6)}% | ` +
      `$${r.finalPortfolio.toFixed(2).padStart(13)} | ` +
      `${r.compoundGrowthFactor.toFixed(2).padStart(8)}x | ` +
      `${(r.stopLossPercent * 100).toFixed(0).padStart(9)}% | ` +
      `${(r.positionSizePercent * 100).toFixed(1).padStart(12)}% | ` +
      `${r.strategyName.substring(0, 40)}`
    );
  }

  // Save results
  const summaryPath = path.join(OUTPUT_DIR, 'all_strategies_reinvestment_corrected.csv');
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
    StopLoss: `${(r.stopLossPercent * 100).toFixed(0)}%`,
    PositionSize: `${(r.positionSizePercent * 100).toFixed(2)}%`,
    ProfitTargets: JSON.stringify(r.params.profitTargets),
    TrailingStop: `${(r.params.trailingStopPercent * 100).toFixed(0)}% @ ${r.params.trailingStopActivation}x`,
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

  // Compare top strategy
  const topStrategy = results[0];
  console.log(`\n${'='.repeat(80)}`);
  console.log('🥇 TOP STRATEGY DETAILS');
  console.log(`${'='.repeat(80)}\n`);
  console.log(`Strategy: ${topStrategy.strategyName}`);
  console.log(`Win Rate: ${(topStrategy.winRate * 100).toFixed(2)}%`);
  console.log(`Average PnL per Trade: ${topStrategy.avgPnlPerTrade >= 0 ? '+' : ''}${topStrategy.avgPnlPerTrade.toFixed(2)}%`);
  console.log(`Stop Loss: ${(topStrategy.stopLossPercent * 100).toFixed(0)}%`);
  console.log(`Position Size: ${(topStrategy.positionSizePercent * 100).toFixed(2)}% of portfolio`);
  console.log(`Final Portfolio: $${topStrategy.finalPortfolio.toFixed(2)}`);
  console.log(`Total Return: ${topStrategy.totalReturnPercent >= 0 ? '+' : ''}${topStrategy.totalReturnPercent.toFixed(2)}%`);
  console.log(`Compound Growth Factor: ${topStrategy.compoundGrowthFactor.toFixed(2)}x`);
  console.log(`Max Drawdown: ${(topStrategy.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`\n💡 Starting with $100, you would have: $${topStrategy.finalPortfolio.toFixed(2)}\n`);
}

recalculateAllStrategies().catch(console.error);

