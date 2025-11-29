#!/usr/bin/env ts-node
/**
 * Extract partial results from optimization log
 * Parses the log file to extract strategy results that were completed
 */

import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';

const LOG_FILE = '/tmp/optimize-deduplicated.log';
const OUTPUT_DIR = path.join(__dirname, '../data/exports/strategy-optimization');

interface StrategyResult {
  name: string;
  totalPnlPercent: number;
  totalTrades: number;
  winRate: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgHoldDuration: number;
  avgTimeToAth: number;
  duration: number;
  processed: number;
  skipped: number;
  errors: number;
}

function parseLogFile(): StrategyResult[] {
  const logContent = fs.readFileSync(LOG_FILE, 'utf8');
  const results: StrategyResult[] = [];
  
  // Pattern to match strategy completion blocks
  const strategyPattern = /Testing Strategy: (Strategy_\d+).*?✅ Strategy (Strategy_\d+) COMPLETE.*?⏱️  Duration: ([\d.]+) minutes.*?📊 Stats: Processed: (\d+) \| Skipped: (\d+) \| Errors: (\d+).*?Total PnL: (✅|❌) ([\d.-]+)%.*?Total Trades: (\d+).*?Win Rate: ([\d.]+)% \((\d+) wins, (\d+) losses\).*?Avg Win: ([\d.]+)%.*?Avg Loss: ([\d.]+)%.*?Profit Factor: ([\d.]+).*?Sharpe Ratio: ([\d.-]+).*?Max Drawdown: ([\d.]+)%.*?Avg Hold Duration: ([\d.]+) minutes.*?Avg Time to ATH: ([\d.]+) minutes/gs;
  
  let match;
  while ((match = strategyPattern.exec(logContent)) !== null) {
    const [
      ,
      testName,
      completeName,
      duration,
      processed,
      skipped,
      errors,
      pnlSign,
      totalPnlPercent,
      totalTrades,
      winRate,
      winningTrades,
      losingTrades,
      avgWin,
      avgLoss,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      avgHoldDuration,
      avgTimeToAth,
    ] = match;
    
    // Ensure names match
    if (testName !== completeName) continue;
    
    const pnlValue = pnlSign === '✅' ? parseFloat(totalPnlPercent) : -parseFloat(totalPnlPercent);
    
    results.push({
      name: completeName,
      totalPnlPercent: pnlValue,
      totalTrades: parseInt(totalTrades),
      winRate: parseFloat(winRate) / 100,
      winningTrades: parseInt(winningTrades),
      losingTrades: parseInt(losingTrades),
      avgWin: parseFloat(avgWin) / 100,
      avgLoss: parseFloat(avgLoss) / 100,
      profitFactor: parseFloat(profitFactor),
      sharpeRatio: parseFloat(sharpeRatio),
      maxDrawdown: parseFloat(maxDrawdown) / 100,
      avgHoldDuration: parseFloat(avgHoldDuration),
      avgTimeToAth: parseFloat(avgTimeToAth),
      duration: parseFloat(duration),
      processed: parseInt(processed),
      skipped: parseInt(skipped),
      errors: parseInt(errors),
    });
  }
  
  return results;
}

async function extractResults() {
  console.log('🔍 Extracting partial results from optimization log...\n');
  
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`❌ Log file not found: ${LOG_FILE}`);
    process.exit(1);
  }
  
  const results = parseLogFile();
  
  if (results.length === 0) {
    console.error('❌ No strategy results found in log file');
    process.exit(1);
  }
  
  console.log(`✅ Extracted ${results.length} strategy results\n`);
  
  // Sort by total PnL
  results.sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Save summary CSV
  const summaryPath = path.join(OUTPUT_DIR, 'partial_strategy_comparison_summary.csv');
  const summaryRows = results.map((r) => ({
    Strategy: r.name,
    'Total PnL %': r.totalPnlPercent.toFixed(2),
    'Total Trades': r.totalTrades,
    'Win Rate %': (r.winRate * 100).toFixed(2),
    'Winning Trades': r.winningTrades,
    'Losing Trades': r.losingTrades,
    'Avg Win %': (r.avgWin * 100).toFixed(2),
    'Avg Loss %': (r.avgLoss * 100).toFixed(2),
    'Profit Factor': r.profitFactor.toFixed(2),
    'Sharpe Ratio': r.sharpeRatio.toFixed(2),
    'Max Drawdown %': (r.maxDrawdown * 100).toFixed(2),
    'Avg Hold Duration (min)': r.avgHoldDuration.toFixed(0),
    'Avg Time to ATH (min)': r.avgTimeToAth.toFixed(0),
    'Duration (min)': r.duration.toFixed(1),
    'Processed': r.processed,
    'Skipped': r.skipped,
    'Errors': r.errors,
  }));
  
  await new Promise<void>((resolve, reject) => {
    stringify(summaryRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(summaryPath, output);
        resolve();
      }
    });
  });
  
  console.log(`✅ Summary saved to: ${summaryPath}`);
  
  // Save top 10 as JSON
  const top10Path = path.join(OUTPUT_DIR, 'partial_top_10_strategies.json');
  fs.writeFileSync(
    top10Path,
    JSON.stringify(results.slice(0, 10), null, 2)
  );
  console.log(`✅ Top 10 strategies saved to: ${top10Path}`);
  
  // Print top 10
  console.log(`\n${'='.repeat(80)}`);
  console.log('🏆 TOP 10 STRATEGIES (from partial results)');
  console.log(`${'='.repeat(80)}\n`);
  
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    console.log(`${i + 1}. ${r.name}`);
    console.log(`   Total PnL: ${r.totalPnlPercent >= 0 ? '✅' : '❌'} ${r.totalPnlPercent.toFixed(2)}%`);
    console.log(`   Win Rate: ${(r.winRate * 100).toFixed(1)}% (${r.winningTrades} wins, ${r.losingTrades} losses)`);
    console.log(`   Profit Factor: ${r.profitFactor.toFixed(2)}`);
    console.log(`   Sharpe Ratio: ${r.sharpeRatio.toFixed(2)}`);
    console.log(`   Max Drawdown: ${(r.maxDrawdown * 100).toFixed(2)}%`);
    console.log('');
  }
  
  console.log(`\n📊 Total strategies extracted: ${results.length}`);
  console.log(`📁 Files saved to: ${OUTPUT_DIR}\n`);
}

extractResults().catch(console.error);

