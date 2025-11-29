#!/usr/bin/env ts-node
/**
 * Analyze Strategy Performance with Reinvestment
 * 
 * This script calculates cumulative portfolio growth with reinvestment,
 * showing how strategies with high win rates can outperform strategies
 * with low win rates but high per-trade PnL due to compound growth.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { DateTime } from 'luxon';

const OPTIMIZATION_CSV = path.join(__dirname, '../data/exports/strategy-optimization/strategy_comparison_summary.csv');
const TOP_STRATEGIES_JSON = path.join(__dirname, '../data/exports/strategy-optimization/top_10_strategies.json');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/reinvestment-analysis');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface Trade {
  tokenAddress: string;
  alertTime: string;
  pnl: number;
  pnlPercent: number;
  timestamp: DateTime;
}

interface StrategyWithTrades {
  name: string;
  params: any;
  trades: Trade[];
  metrics: {
    totalPnlPercent: number;
    winRate: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    profitFactor: number;
  };
}

interface ReinvestmentResult {
  strategyName: string;
  initialPortfolio: number;
  finalPortfolio: number;
  totalReturn: number;
  totalReturnPercent: number;
  maxPortfolio: number;
  minPortfolio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  avgReturnPerTrade: number;
  compoundGrowthFactor: number;
}

/**
 * Calculate portfolio growth with reinvestment
 */
function calculateReinvestmentPerformance(
  trades: Trade[],
  initialPortfolio: number = 100,
  positionSizePercent: number = 0.02 // 2% of portfolio per trade
): ReinvestmentResult {
  // Sort trades chronologically
  const sortedTrades = [...trades].sort((a, b) => 
    a.timestamp.toMillis() - b.timestamp.toMillis()
  );

  let portfolio = initialPortfolio;
  let maxPortfolio = initialPortfolio;
  let minPortfolio = initialPortfolio;
  let peak = initialPortfolio;
  let maxDrawdown = 0;

  const portfolioHistory: Array<{ trade: number; portfolio: number; return: number }> = [];

  for (let i = 0; i < sortedTrades.length; i++) {
    const trade = sortedTrades[i];
    
    // Calculate position size as % of current portfolio
    const positionSize = portfolio * positionSizePercent;
    
    // Calculate return from this trade
    // pnl is a multiplier (e.g., 1.5 = 50% gain, 0.6 = 40% loss)
    const tradeReturn = (trade.pnl - 1.0) * positionSize;
    
    // Update portfolio
    portfolio = portfolio + tradeReturn;
    
    // Track portfolio history
    portfolioHistory.push({
      trade: i + 1,
      portfolio,
      return: tradeReturn
    });
    
    // Update peak and drawdown
    if (portfolio > peak) {
      peak = portfolio;
    }
    if (portfolio > maxPortfolio) {
      maxPortfolio = portfolio;
    }
    if (portfolio < minPortfolio) {
      minPortfolio = portfolio;
    }
    
    // Calculate drawdown from peak
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
  const avgReturnPerTrade = sortedTrades.length > 0 ? totalReturn / sortedTrades.length : 0;

  return {
    strategyName: '',
    initialPortfolio,
    finalPortfolio: portfolio,
    totalReturn,
    totalReturnPercent,
    maxPortfolio,
    minPortfolio,
    maxDrawdown,
    winRate: 0, // Will be set by caller
    totalTrades: sortedTrades.length,
    avgReturnPerTrade,
    compoundGrowthFactor,
  };
}

async function analyzeReinvestmentPerformance() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('💰 REINVESTMENT PERFORMANCE ANALYSIS');
  console.log(`${'='.repeat(80)}\n`);

  // Load top strategies with trade data
  console.log('📂 Loading strategy data...');
  const topStrategiesData = JSON.parse(fs.readFileSync(TOP_STRATEGIES_JSON, 'utf8'));
  console.log(`✅ Loaded ${topStrategiesData.length} top strategies\n`);

  // Convert to our format
  const strategies: StrategyWithTrades[] = topStrategiesData.map((s: any) => ({
    name: s.params.name,
    params: s.params,
    trades: s.trades.map((t: any) => ({
      tokenAddress: t.tokenAddress,
      alertTime: t.alertTime,
      pnl: t.pnl,
      pnlPercent: t.pnlPercent,
      timestamp: DateTime.fromISO(t.alertTime || '2025-01-01'),
    })),
    metrics: {
      totalPnlPercent: s.totalPnlPercent,
      winRate: s.winRate,
      totalTrades: s.totalTrades,
      winningTrades: s.winningTrades,
      losingTrades: s.losingTrades,
      profitFactor: s.profitFactor,
    },
  }));

  console.log('🔄 Calculating reinvestment performance...\n');

  const initialPortfolio = 100; // Start with 100 units
  const positionSizePercent = 0.02; // 2% of portfolio per trade

  const results: Array<ReinvestmentResult & { metrics: StrategyWithTrades['metrics'] }> = [];

  for (const strategy of strategies) {
    const reinvestmentResult = calculateReinvestmentPerformance(
      strategy.trades,
      initialPortfolio,
      positionSizePercent
    );

    reinvestmentResult.strategyName = strategy.name;
    reinvestmentResult.winRate = strategy.metrics.winRate;

    results.push({
      ...reinvestmentResult,
      metrics: strategy.metrics,
    });
  }

  // Sort by final portfolio value (best reinvestment performance)
  results.sort((a, b) => b.finalPortfolio - a.finalPortfolio);

  // Display results
  console.log(`${'='.repeat(80)}`);
  console.log('📊 REINVESTMENT PERFORMANCE RESULTS');
  console.log(`${'='.repeat(80)}\n`);
  console.log(`Initial Portfolio: ${initialPortfolio} units`);
  console.log(`Position Size: ${(positionSizePercent * 100).toFixed(0)}% of portfolio per trade\n`);

  console.log('Rank | Strategy | Final Portfolio | Total Return % | Win Rate | Trades | Compound Factor | Max DD');
  console.log('-'.repeat(100));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const strategyShort = r.strategyName.length > 30 
      ? r.strategyName.substring(0, 27) + '...' 
      : r.strategyName;
    
    console.log(
      `${(i + 1).toString().padStart(4)} | ${strategyShort.padEnd(30)} | ` +
      `${r.finalPortfolio.toFixed(2).padStart(14)} | ` +
      `${r.totalReturnPercent >= 0 ? '+' : ''}${r.totalReturnPercent.toFixed(2).padStart(12)}% | ` +
      `${(r.winRate * 100).toFixed(1).padStart(7)}% | ` +
      `${r.totalTrades.toString().padStart(6)} | ` +
      `${r.compoundGrowthFactor.toFixed(2).padStart(15)}x | ` +
      `${(r.maxDrawdown * 100).toFixed(1).padStart(5)}%`
    );
  }

  // Compare top strategy by average PnL vs top by reinvestment
  console.log(`\n${'='.repeat(80)}`);
  console.log('🔍 KEY INSIGHTS');
  console.log(`${'='.repeat(80)}\n`);

  const topByAvgPnl = results.sort((a, b) => b.metrics.totalPnlPercent - a.metrics.totalPnlPercent)[0];
  const topByReinvestment = results.sort((a, b) => b.finalPortfolio - a.finalPortfolio)[0];

  console.log('Top Strategy by Average PnL per Trade:');
  console.log(`  Strategy: ${topByAvgPnl.strategyName}`);
  console.log(`  Avg PnL: ${topByAvgPnl.metrics.totalPnlPercent.toFixed(2)}%`);
  console.log(`  Win Rate: ${(topByAvgPnl.winRate * 100).toFixed(2)}%`);
  console.log(`  Final Portfolio (with reinvestment): ${topByAvgPnl.finalPortfolio.toFixed(2)} units`);
  console.log(`  Total Return: ${topByAvgPnl.totalReturnPercent >= 0 ? '+' : ''}${topByAvgPnl.totalReturnPercent.toFixed(2)}%`);
  console.log(`  Compound Factor: ${topByAvgPnl.compoundGrowthFactor.toFixed(2)}x\n`);

  console.log('Top Strategy by Reinvestment Performance:');
  console.log(`  Strategy: ${topByReinvestment.strategyName}`);
  console.log(`  Avg PnL: ${topByReinvestment.metrics.totalPnlPercent.toFixed(2)}%`);
  console.log(`  Win Rate: ${(topByReinvestment.winRate * 100).toFixed(2)}%`);
  console.log(`  Final Portfolio (with reinvestment): ${topByReinvestment.finalPortfolio.toFixed(2)} units`);
  console.log(`  Total Return: ${topByReinvestment.totalReturnPercent >= 0 ? '+' : ''}${topByReinvestment.totalReturnPercent.toFixed(2)}%`);
  console.log(`  Compound Factor: ${topByReinvestment.compoundGrowthFactor.toFixed(2)}x\n`);

  if (topByReinvestment.strategyName !== topByAvgPnl.strategyName) {
    const difference = topByReinvestment.finalPortfolio - topByAvgPnl.finalPortfolio;
    const differencePercent = (difference / topByAvgPnl.finalPortfolio) * 100;
    console.log(`💡 The reinvestment-optimized strategy outperforms by:`);
    console.log(`   ${difference.toFixed(2)} units (${differencePercent >= 0 ? '+' : ''}${differencePercent.toFixed(2)}%)`);
    console.log(`   This demonstrates the power of compound growth with high win rates!\n`);
  }

  // Save results
  const outputPath = path.join(OUTPUT_DIR, 'reinvestment_analysis.csv');
  const csvRows = results.map(r => ({
    Rank: results.indexOf(r) + 1,
    Strategy: r.strategyName,
    InitialPortfolio: r.initialPortfolio,
    FinalPortfolio: r.finalPortfolio.toFixed(2),
    TotalReturn: r.totalReturn.toFixed(2),
    TotalReturnPercent: r.totalReturnPercent.toFixed(2),
    CompoundGrowthFactor: r.compoundGrowthFactor.toFixed(4),
    WinRate: (r.winRate * 100).toFixed(2),
    TotalTrades: r.totalTrades,
    AvgPnlPerTrade: r.metrics.totalPnlPercent.toFixed(2),
    ProfitFactor: r.metrics.profitFactor.toFixed(2),
    MaxDrawdown: (r.maxDrawdown * 100).toFixed(2),
    MaxPortfolio: r.maxPortfolio.toFixed(2),
    MinPortfolio: r.minPortfolio.toFixed(2),
  }));

  const { stringify } = await import('csv-stringify');
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

analyzeReinvestmentPerformance().catch(console.error);

