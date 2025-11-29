#!/usr/bin/env node

/**
 * Combines summaries from both JSON and CSV files to create comprehensive summary
 */

const fs = require('fs');
const path = require('path');

// Import both aggregation functions
const { findAllSummaries, aggregateByStrategy } = require('./aggregate-simulation-results');
const { findAllCSVSummaries } = require('./process-csv-simulations');

function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  if (typeof num === 'number' && (num > 1e10 || num < -1e10)) {
    return num.toExponential(2);
  }
  return typeof num === 'number' ? num.toFixed(decimals) : num;
}

function formatPercent(num) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  if (typeof num === 'number' && (Math.abs(num) > 1e10)) {
    return num.toExponential(2) + '%';
  }
  return `${formatNumber(num, 2)}%`;
}

function printSummaryTable(aggregated) {
  console.log('\n' + '='.repeat(180));
  console.log('COMPREHENSIVE SIMULATION RESULTS SUMMARY - All Strategies');
  console.log('='.repeat(180));
  console.log();

  aggregated.sort((a, b) => b.totalTrades - a.totalTrades);

  const header = [
    'Strategy',
    'Callers',
    'Total Calls',
    'Total Trades',
    'Avg Win Rate',
    'Win Rate Range',
    'Total Final Portfolio',
    'Avg Final/Caller',
    'Final Range',
    'Avg Compound Factor',
    'Avg Simple Return %',
    'Avg TWR Daily %',
    'Avg Risk Score',
    'Avg PnL/Trade'
  ];

  const colWidths = header.map((h, i) => {
    const maxContent = Math.max(
      h.length,
      ...aggregated.map(row => {
        const val = getValueForColumn(row, i);
        return val ? val.toString().length : 0;
      })
    );
    return Math.min(maxContent + 2, 25);
  });

  console.log(header.map((h, i) => h.padEnd(colWidths[i])).join(' | '));
  console.log('-'.repeat(colWidths.reduce((a, b) => a + b + 3, 0)));

  for (const row of aggregated) {
    const values = [
      row.strategy.substring(0, 24),
      row.callerCount,
      row.totalCalls,
      row.totalTrades,
      formatPercent(row.avgWinRate),
      `${formatPercent(row.minWinRate)}-${formatPercent(row.maxWinRate)}`,
      formatNumber(row.totalFinalPortfolio),
      formatNumber(row.totalFinalPortfolio / row.callerCount),
      `${formatNumber(row.minFinalPortfolio)}-${formatNumber(row.maxFinalPortfolio)}`,
      formatNumber(row.avgCompoundFactor, 3),
      formatPercent(row.avgSimpleReturnPercent),
      formatPercent(row.avgTWRDailyPct),
      formatNumber(row.avgRiskAdjustedScore, 3),
      formatNumber(row.avgPnlPerTrade)
    ];
    console.log(values.map((v, i) => String(v).padEnd(colWidths[i])).join(' | '));
  }

  console.log();
  console.log('='.repeat(180));
  console.log();
}

function getValueForColumn(row, colIndex) {
  switch (colIndex) {
    case 0: return row.strategy.substring(0, 24);
    case 1: return row.callerCount;
    case 2: return row.totalCalls;
    case 3: return row.totalTrades;
    case 4: return formatPercent(row.avgWinRate);
    case 5: return `${formatPercent(row.minWinRate)}-${formatPercent(row.maxWinRate)}`;
    case 6: return formatNumber(row.totalFinalPortfolio);
    case 7: return formatNumber(row.totalFinalPortfolio / row.callerCount);
    case 8: return `${formatNumber(row.minFinalPortfolio)}-${formatNumber(row.maxFinalPortfolio)}`;
    case 9: return formatNumber(row.avgCompoundFactor, 3);
    case 10: return formatPercent(row.avgSimpleReturnPercent);
    case 11: return formatPercent(row.avgTWRDailyPct);
    case 12: return formatNumber(row.avgRiskAdjustedScore, 3);
    case 13: return formatNumber(row.avgPnlPerTrade);
    default: return '';
  }
}

function main() {
  console.log('Combining summaries from JSON and CSV files...\n');
  
  // Get summaries from both sources
  console.log('1. Loading JSON summaries...');
  const jsonSummaries = findAllSummaries();
  console.log(`   Found ${jsonSummaries.length} JSON summaries`);
  
  console.log('\n2. Loading CSV summaries...');
  const csvSummaries = findAllCSVSummaries();
  console.log(`   Found ${csvSummaries.length} CSV summaries`);
  
  // Combine and deduplicate (prefer JSON over CSV for same strategy/caller)
  const combinedMap = new Map();
  
  // Add JSON summaries first
  for (const { strategy, caller, summary } of jsonSummaries) {
    const key = `${strategy}::${caller}`;
    combinedMap.set(key, { strategy, caller, summary, source: 'json' });
  }
  
  // Add CSV summaries (only if not already present)
  for (const { strategy, caller, summary } of csvSummaries) {
    const key = `${strategy}::${caller}`;
    if (!combinedMap.has(key)) {
      combinedMap.set(key, { strategy, caller, summary, source: 'csv' });
    }
  }
  
  const combined = Array.from(combinedMap.values());
  console.log(`\n3. Combined total: ${combined.length} unique summaries`);
  
  const strategiesFound = new Set(combined.map(s => s.strategy));
  console.log(`\n4. Strategies found: ${strategiesFound.size}`);
  strategiesFound.forEach(s => {
    const count = combined.filter(sum => sum.strategy === s).length;
    const jsonCount = combined.filter(sum => sum.strategy === s && sum.source === 'json').length;
    const csvCount = combined.filter(sum => sum.strategy === s && sum.source === 'csv').length;
    console.log(`   - ${s}: ${count} summaries (${jsonCount} JSON, ${csvCount} CSV)`);
  });
  
  // Aggregate
  const aggregated = aggregateByStrategy(combined);
  printSummaryTable(aggregated);
  
  // Save combined results
  const outputPath = path.join(__dirname, '..', 'data', 'simulation-summary-combined.json');
  fs.writeFileSync(outputPath, JSON.stringify(aggregated, null, 2));
  console.log(`\n✅ Combined results saved to: ${outputPath}`);
  
  // Create markdown
  const markdownPath = path.join(__dirname, '..', 'data', 'simulation-summary-combined.md');
  let markdown = '# Comprehensive Simulation Results Summary\n\n';
  markdown += 'Aggregated results by strategy across all callers (from both JSON and CSV sources).\n\n';
  markdown += `**Total Strategies**: ${aggregated.length}\n`;
  markdown += `**Total Summaries**: ${combined.length}\n\n`;
  markdown += '| Strategy | Callers | Total Calls | Total Trades | Avg Win Rate | Win Rate Range | Total Final Portfolio | Avg Final/Caller | Final Range | Avg Compound Factor | Avg Simple Return % | Avg TWR Daily % | Avg Risk Score | Avg PnL/Trade |\n';
  markdown += '|----------|---------|--------------|--------------|--------------|----------------|----------------------|-----------------|-------------|---------------------|---------------------|-----------------|----------------|---------------|\n';

  for (const row of aggregated) {
    const values = [
      row.strategy.substring(0, 40),
      row.callerCount,
      row.totalCalls,
      row.totalTrades,
      formatPercent(row.avgWinRate),
      `${formatPercent(row.minWinRate)}-${formatPercent(row.maxWinRate)}`,
      formatNumber(row.totalFinalPortfolio),
      formatNumber(row.totalFinalPortfolio / row.callerCount),
      `${formatNumber(row.minFinalPortfolio)}-${formatNumber(row.maxFinalPortfolio)}`,
      formatNumber(row.avgCompoundFactor, 3),
      formatPercent(row.avgSimpleReturnPercent),
      formatPercent(row.avgTWRDailyPct),
      formatNumber(row.avgRiskAdjustedScore, 3),
      formatNumber(row.avgPnlPerTrade)
    ];
    markdown += '| ' + values.join(' | ') + ' |\n';
  }

  fs.writeFileSync(markdownPath, markdown);
  console.log(`✅ Markdown table saved to: ${markdownPath}`);
}

if (require.main === module) {
  main();
}

