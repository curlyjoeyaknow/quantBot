#!/usr/bin/env node

/**
 * Generates CSV table from combined simulation summary
 */

const fs = require('fs');
const path = require('path');

function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  if (typeof num === 'number' && (Math.abs(num) > 1e10 || Math.abs(num) < 1e-10 && num !== 0)) {
    return num.toExponential(2);
  }
  return typeof num === 'number' ? num.toFixed(decimals) : num;
}

function formatPercent(num) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  if (typeof num === 'number' && Math.abs(num) > 1e10) {
    return num.toExponential(2);
  }
  return typeof num === 'number' ? num.toFixed(2) : num;
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function main() {
  const jsonPath = path.join(__dirname, '..', 'data', 'simulation-summary-combined.json');
  
  if (!fs.existsSync(jsonPath)) {
    console.error('Combined summary JSON not found. Run combine-all-simulations.js first.');
    process.exit(1);
  }

  const aggregated = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  
  // Sort by total trades
  aggregated.sort((a, b) => b.totalTrades - a.totalTrades);

  // CSV headers
  const headers = [
    'Strategy',
    'Callers',
    'Total Calls',
    'Total Trades',
    'Avg Win Rate (%)',
    'Min Win Rate (%)',
    'Max Win Rate (%)',
    'Total Final Portfolio',
    'Avg Final Portfolio per Caller',
    'Min Final Portfolio',
    'Max Final Portfolio',
    'Avg Compound Factor',
    'Avg Simple Return (%)',
    'Avg TWR Daily (%)',
    'Avg TWR Weekly (%)',
    'Avg TWR Annual (%)',
    'Avg Risk Adjusted Score',
    'Avg PnL per Trade',
    'Total Winning Trades',
    'Total Losing Trades',
    'Total Unique Tokens',
    'Total Days Active'
  ];

  // Generate CSV rows
  const rows = aggregated.map(row => [
    escapeCSV(row.strategy),
    row.callerCount,
    row.totalCalls,
    row.totalTrades,
    formatPercent(row.avgWinRate),
    formatPercent(row.minWinRate),
    formatPercent(row.maxWinRate),
    formatNumber(row.totalFinalPortfolio),
    formatNumber(row.totalFinalPortfolio / row.callerCount),
    formatNumber(row.minFinalPortfolio),
    formatNumber(row.maxFinalPortfolio),
    formatNumber(row.avgCompoundFactor, 3),
    formatPercent(row.avgSimpleReturnPercent),
    formatPercent(row.avgTWRDailyPct),
    formatPercent(row.avgTWRWeeklyPct || 0),
    formatPercent(row.avgTWRAnnualPct || 0),
    formatNumber(row.avgRiskAdjustedScore, 3),
    formatNumber(row.avgPnlPerTrade),
    row.totalWinningTrades,
    row.totalLosingTrades,
    row.totalUniqueTokens || 0,
    formatNumber(row.totalDaysActive, 1)
  ]);

  // Combine headers and rows
  const csvLines = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ];

  const csvContent = csvLines.join('\n');

  // Save CSV
  const outputPath = path.join(__dirname, '..', 'data', 'simulation-summary-combined.csv');
  fs.writeFileSync(outputPath, csvContent);
  
  console.log(`✅ CSV table saved to: ${outputPath}`);
  console.log(`   ${aggregated.length} strategies, ${headers.length} columns`);
}

if (require.main === module) {
  main();
}

