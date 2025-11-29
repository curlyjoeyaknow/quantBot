#!/usr/bin/env ts-node
/**
 * Strategy Results Analysis and Visualization
 * 
 * Analyzes strategy optimization results and generates insights.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const RESULTS_CSV = path.join(__dirname, '../data/exports/strategy-optimization/strategy_comparison_summary.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/strategy-optimization');

interface StrategyRecord {
  Strategy: string;
  'Total PnL %': string;
  'Total Trades': string;
  'Win Rate %': string;
  'Avg Win': string;
  'Avg Loss': string;
  'Profit Factor': string;
  'Sharpe Ratio': string;
  'Max Drawdown %': string;
  'Trailing Stop %': string;
  'Stop Activation': string;
  'Min Exit %': string;
  'Profit Targets': string;
}

/**
 * Generate analysis report
 */
async function analyzeResults() {
  console.log('📊 Strategy Results Analysis\n');

  if (!fs.existsSync(RESULTS_CSV)) {
    console.error(`❌ Results CSV not found: ${RESULTS_CSV}`);
    console.error('   Please run optimize-strategies.ts first.');
    process.exit(1);
  }

  const csv = fs.readFileSync(RESULTS_CSV, 'utf8');
  const records: StrategyRecord[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  console.log(`✅ Loaded ${records.length} strategy results\n`);

  // Parse numeric values
  const strategies = records.map(r => ({
    name: r.Strategy,
    pnl: parseFloat(r['Total PnL %']),
    trades: parseInt(r['Total Trades']),
    winRate: parseFloat(r['Win Rate %']),
    avgWin: parseFloat(r['Avg Win']),
    avgLoss: parseFloat(r['Avg Loss']),
    profitFactor: parseFloat(r['Profit Factor']),
    sharpe: parseFloat(r['Sharpe Ratio']),
    drawdown: parseFloat(r['Max Drawdown %']),
    trailingStop: parseFloat(r['Trailing Stop %']),
    stopActivation: parseFloat(r['Stop Activation'].replace('x', '')),
    minExit: parseFloat(r['Min Exit %']),
    profitTargets: JSON.parse(r['Profit Targets']),
  }));

  // Analysis
  console.log('📈 KEY INSIGHTS:\n');

  // Best overall
  const bestOverall = strategies.sort((a, b) => b.pnl - a.pnl)[0];
  console.log('🏆 Best Overall Strategy:');
  console.log(`   Name: ${bestOverall.name}`);
  console.log(`   PnL: ${bestOverall.pnl.toFixed(2)}%`);
  console.log(`   Win Rate: ${bestOverall.winRate.toFixed(2)}%`);
  console.log(`   Profit Factor: ${bestOverall.profitFactor.toFixed(2)}`);
  console.log(`   Config: ${bestOverall.trailingStop}% stop after ${bestOverall.stopActivation}x\n`);

  // Best win rate
  const bestWinRate = strategies.sort((a, b) => b.winRate - a.winRate)[0];
  console.log('🎯 Highest Win Rate:');
  console.log(`   Name: ${bestWinRate.name}`);
  console.log(`   Win Rate: ${bestWinRate.winRate.toFixed(2)}%`);
  console.log(`   PnL: ${bestWinRate.pnl.toFixed(2)}%\n`);

  // Best profit factor
  const bestProfitFactor = strategies.sort((a, b) => b.profitFactor - a.profitFactor)[0];
  console.log('💰 Best Profit Factor:');
  console.log(`   Name: ${bestProfitFactor.name}`);
  console.log(`   Profit Factor: ${bestProfitFactor.profitFactor.toFixed(2)}`);
  console.log(`   PnL: ${bestProfitFactor.pnl.toFixed(2)}%\n`);

  // Parameter analysis
  console.log('🔍 PARAMETER ANALYSIS:\n');

  // Trailing stop analysis
  const stopGroups = new Map<number, number[]>();
  strategies.forEach(s => {
    const stop = s.trailingStop;
    if (!stopGroups.has(stop)) stopGroups.set(stop, []);
    stopGroups.get(stop)!.push(s.pnl);
  });

  console.log('Trailing Stop % vs Average PnL:');
  Array.from(stopGroups.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([stop, pnls]) => {
      const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
      console.log(`   ${stop}%: ${avg.toFixed(2)}% (${pnls.length} strategies)`);
    });
  console.log('');

  // Stop activation analysis
  const activationGroups = new Map<number, number[]>();
  strategies.forEach(s => {
    const activation = s.stopActivation;
    if (!activationGroups.has(activation)) activationGroups.set(activation, []);
    activationGroups.get(activation)!.push(s.pnl);
  });

  console.log('Stop Activation vs Average PnL:');
  Array.from(activationGroups.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([activation, pnls]) => {
      const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
      console.log(`   ${activation}x: ${avg.toFixed(2)}% (${pnls.length} strategies)`);
    });
  console.log('');

  // Correlation analysis
  console.log('📊 CORRELATIONS:\n');
  
  // Calculate correlation between trailing stop and PnL
  const stopValues = strategies.map(s => s.trailingStop);
  const pnlValues = strategies.map(s => s.pnl);
  const stopCorrelation = calculateCorrelation(stopValues, pnlValues);
  console.log(`Trailing Stop % ↔ PnL: ${stopCorrelation.toFixed(3)}`);

  const activationValues = strategies.map(s => s.stopActivation);
  const activationCorrelation = calculateCorrelation(activationValues, pnlValues);
  console.log(`Stop Activation ↔ PnL: ${activationCorrelation.toFixed(3)}`);

  const winRateValues = strategies.map(s => s.winRate);
  const winRateCorrelation = calculateCorrelation(winRateValues, pnlValues);
  console.log(`Win Rate ↔ PnL: ${winRateCorrelation.toFixed(3)}\n`);

  // Generate HTML report
  generateHTMLReport(strategies);

  console.log('✅ Analysis complete!');
  console.log(`📄 HTML report: ${path.join(OUTPUT_DIR, 'strategy_analysis.html')}`);
}

function calculateCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let xSumSq = 0;
  let ySumSq = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = x[i] - xMean;
    const yDiff = y[i] - yMean;
    numerator += xDiff * yDiff;
    xSumSq += xDiff * xDiff;
    ySumSq += yDiff * yDiff;
  }

  const denominator = Math.sqrt(xSumSq * ySumSq);
  return denominator > 0 ? numerator / denominator : 0;
}

function generateHTMLReport(strategies: any[]) {
  const top10 = strategies.sort((a, b) => b.pnl - a.pnl).slice(0, 10);

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Strategy Optimization Results</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #4CAF50; color: white; }
    tr:hover { background: #f5f5f5; }
    .positive { color: green; font-weight: bold; }
    .negative { color: red; font-weight: bold; }
    .metric { display: inline-block; margin: 10px 20px 10px 0; }
    .metric-value { font-size: 24px; font-weight: bold; color: #4CAF50; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏆 Strategy Optimization Results</h1>
    <p>Generated: ${new Date().toLocaleString()}</p>
    
    <h2>Top 10 Strategies</h2>
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Strategy</th>
          <th>PnL %</th>
          <th>Win Rate %</th>
          <th>Profit Factor</th>
          <th>Sharpe</th>
          <th>Trailing Stop</th>
          <th>Stop Activation</th>
        </tr>
      </thead>
      <tbody>
        ${top10
          .map(
            (s, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${s.name}</td>
          <td class="${s.pnl >= 0 ? 'positive' : 'negative'}">${s.pnl.toFixed(2)}%</td>
          <td>${s.winRate.toFixed(2)}%</td>
          <td>${s.profitFactor.toFixed(2)}</td>
          <td>${s.sharpe.toFixed(2)}</td>
          <td>${s.trailingStop}%</td>
          <td>${s.stopActivation}x</td>
        </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
    
    <h2>Summary Statistics</h2>
    <div class="metric">
      <div>Total Strategies Tested</div>
      <div class="metric-value">${strategies.length}</div>
    </div>
    <div class="metric">
      <div>Best PnL</div>
      <div class="metric-value">${Math.max(...strategies.map(s => s.pnl)).toFixed(2)}%</div>
    </div>
    <div class="metric">
      <div>Average PnL</div>
      <div class="metric-value">${(strategies.reduce((a, b) => a + b.pnl, 0) / strategies.length).toFixed(2)}%</div>
    </div>
    <div class="metric">
      <div>Best Win Rate</div>
      <div class="metric-value">${Math.max(...strategies.map(s => s.winRate)).toFixed(2)}%</div>
    </div>
  </div>
</body>
</html>`;

  const htmlPath = path.join(OUTPUT_DIR, 'strategy_analysis.html');
  fs.writeFileSync(htmlPath, html);
}

analyzeResults().catch(console.error);

