#!/usr/bin/env node

/**
 * Aggregates simulation results by strategy across all callers
 * Creates a summary table showing aggregated metrics per strategy
 */

const fs = require('fs');
const path = require('path');

const EXPORTS_DIR = path.join(__dirname, '..', 'data', 'exports');

// Find all summary.json files recursively
function findAllSummaries() {
  const summaries = [];
  
  // Recursively find all summary.json files
  function findSummariesRecursive(dir, baseStrategy = null) {
    if (!fs.existsSync(dir)) return;
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile() && entry.name === 'summary.json') {
          try {
            const summary = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            // Extract strategy name from path
            const relativePath = path.relative(EXPORTS_DIR, fullPath);
            const pathParts = relativePath.split(path.sep);
            
            // Strategy is the first directory after exports
            let strategy = pathParts[0];
            let caller = summary.caller || pathParts[pathParts.length - 2] || 'unknown';
            
            // If we're in a timestamp directory, use the parent as strategy
            // Timestamp pattern: YYYY-MM-DD_HH-MM-SS
            if (pathParts.length > 2 && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(pathParts[1])) {
              strategy = pathParts[0]; // Keep the base strategy name
              caller = summary.caller || pathParts[pathParts.length - 2] || 'unknown';
            }
            
            summaries.push({
              strategy,
              caller,
              summary,
              path: fullPath
            });
          } catch (error) {
            console.error(`Error reading ${fullPath}:`, error.message);
          }
        } else if (entry.isDirectory()) {
          // Skip certain directories
          if (entry.name === 'csv' || entry.name === 'json' || entry.name === 'emails' || entry.name === 'reports') {
            continue;
          }
          // Recursively search subdirectories
          findSummariesRecursive(fullPath, baseStrategy || entry.name);
        }
      }
    } catch (error) {
      // Directory might not be readable, skip
    }
  }
  
  findSummariesRecursive(EXPORTS_DIR);
  return summaries;
}

// Aggregate results by strategy
function aggregateByStrategy(summaries) {
  const strategyMap = new Map();

  for (const { strategy, caller, summary } of summaries) {
    if (!strategyMap.has(strategy)) {
      strategyMap.set(strategy, {
        strategy,
        callers: [],
        totalCalls: 0,
        totalUniqueTokens: 0,
        totalTrades: 0,
        totalWinningTrades: 0,
        totalLosingTrades: 0,
        totalFinalPortfolio: 0,
        totalInitialPortfolio: 0,
        totalSimpleFinalPortfolio: 0,
        totalMaxDrawdown: 0,
        totalAvgPnlPerTrade: 0,
        totalRiskAdjustedScore: 0,
        totalDaysActive: 0,
        totalVolume: 0,
        callerCount: 0,
        avgWinRate: 0,
        avgCompoundFactor: 0,
        avgSimpleReturnPercent: 0,
        avgMaxDrawdownPct: 0,
        avgTWRDailyPct: 0,
        avgTWRWeeklyPct: 0,
        avgTWRAnnualPct: 0,
        avgRiskAdjustedScore: 0,
        minFinalPortfolio: Infinity,
        maxFinalPortfolio: -Infinity,
        minWinRate: Infinity,
        maxWinRate: -Infinity,
      });
    }

    const agg = strategyMap.get(strategy);
    agg.callers.push(caller);
    agg.callerCount++;
    
    // Sum metrics
    agg.totalCalls += summary.totalCalls || 0;
    agg.totalUniqueTokens += summary.uniqueTokens || 0;
    agg.totalTrades += summary.totalTrades || 0;
    agg.totalWinningTrades += summary.winningTrades || 0;
    agg.totalLosingTrades += summary.losingTrades || 0;
    agg.totalFinalPortfolio += summary.finalPortfolio || 0;
    agg.totalInitialPortfolio += summary.initialPortfolio || 0;
    agg.totalSimpleFinalPortfolio += summary.simpleFinalPortfolio || 0;
    agg.totalMaxDrawdown += summary.maxDrawdown || 0;
    agg.totalAvgPnlPerTrade += (summary.avgPnlPerTrade || 0) * (summary.totalTrades || 0);
    agg.totalRiskAdjustedScore += summary.riskAdjustedScore || 0;
    agg.totalDaysActive += summary.daysActive || 0;
    agg.totalVolume += summary.totalVolume || 0;

    // Track min/max
    if (summary.finalPortfolio) {
      agg.minFinalPortfolio = Math.min(agg.minFinalPortfolio, summary.finalPortfolio);
      agg.maxFinalPortfolio = Math.max(agg.maxFinalPortfolio, summary.finalPortfolio);
    }
    if (summary.winRate !== undefined) {
      agg.minWinRate = Math.min(agg.minWinRate, summary.winRate);
      agg.maxWinRate = Math.max(agg.maxWinRate, summary.winRate);
    }
  }

  // Calculate averages
  for (const agg of strategyMap.values()) {
    agg.avgWinRate = agg.totalTrades > 0 
      ? (agg.totalWinningTrades / agg.totalTrades) * 100 
      : 0;
    agg.avgCompoundFactor = agg.callerCount > 0 
      ? agg.totalFinalPortfolio / (agg.totalInitialPortfolio * agg.callerCount)
      : 0;
    agg.avgSimpleReturnPercent = agg.callerCount > 0
      ? ((agg.totalSimpleFinalPortfolio / agg.totalInitialPortfolio) - agg.callerCount) * 100 / agg.callerCount
      : 0;
    agg.avgMaxDrawdownPct = agg.callerCount > 0
      ? agg.totalMaxDrawdown / agg.callerCount
      : 0;
    agg.avgTWRDailyPct = agg.callerCount > 0
      ? agg.totalDaysActive > 0 
        ? (Math.pow(agg.totalFinalPortfolio / agg.totalInitialPortfolio, 1 / (agg.totalDaysActive / agg.callerCount)) - 1) * 100
        : 0
      : 0;
    agg.avgRiskAdjustedScore = agg.callerCount > 0
      ? agg.totalRiskAdjustedScore / agg.callerCount
      : 0;
    agg.avgPnlPerTrade = agg.totalTrades > 0
      ? agg.totalAvgPnlPerTrade / agg.totalTrades
      : 0;

    // Calculate TWR from individual summaries (average the values directly)
    let totalTWRDaily = 0;
    let totalTWRWeekly = 0;
    let totalTWRAnnual = 0;
    let twrCount = 0;
    for (const { summary } of summaries.filter(s => s.strategy === agg.strategy)) {
      if (summary.twrDailyPct !== undefined && !isNaN(summary.twrDailyPct)) {
        totalTWRDaily += summary.twrDailyPct;
        totalTWRWeekly += (summary.twrWeeklyPct || 0);
        // Cap TWR Annual at reasonable values (some may be extremely high due to short time periods)
        const twrAnnual = summary.twrAnnualPct || 0;
        totalTWRAnnual += Math.min(twrAnnual, 1000000); // Cap at 1,000,000% to avoid outliers
        twrCount++;
      }
    }
    agg.avgTWRDailyPct = twrCount > 0 ? totalTWRDaily / twrCount : 0;
    agg.avgTWRWeeklyPct = twrCount > 0 ? totalTWRWeekly / twrCount : 0;
    agg.avgTWRAnnualPct = twrCount > 0 ? totalTWRAnnual / twrCount : 0;

    if (agg.minFinalPortfolio === Infinity) agg.minFinalPortfolio = 0;
    if (agg.maxFinalPortfolio === -Infinity) agg.maxFinalPortfolio = 0;
    if (agg.minWinRate === Infinity) agg.minWinRate = 0;
    if (agg.maxWinRate === -Infinity) agg.maxWinRate = 0;
  }

  return Array.from(strategyMap.values());
}

// Format number for display
function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  return typeof num === 'number' ? num.toFixed(decimals) : num;
}

// Format percentage
function formatPercent(num) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  return `${formatNumber(num, 2)}%`;
}

// Print summary table
function printSummaryTable(aggregated) {
  console.log('\n' + '='.repeat(150));
  console.log('SIMULATION RESULTS SUMMARY - Aggregated by Strategy');
  console.log('='.repeat(150));
  console.log();

  // Sort by total trades (most active first)
  aggregated.sort((a, b) => b.totalTrades - a.totalTrades);

  // Table header
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
    'Avg TWR Annual %',
    'Avg Risk Score',
    'Avg PnL/Trade',
    'Total Volume'
  ];

  // Calculate column widths
  const colWidths = header.map((h, i) => {
    const maxContent = Math.max(
      h.length,
      ...aggregated.map(row => {
        const val = getValueForColumn(row, i);
        return val ? val.toString().length : 0;
      })
    );
    return Math.min(maxContent + 2, 20);
  });

  // Print header
  console.log(header.map((h, i) => h.padEnd(colWidths[i])).join(' | '));
  console.log('-'.repeat(colWidths.reduce((a, b) => a + b + 3, 0)));

  // Print rows
  for (const row of aggregated) {
    const values = [
      row.strategy.substring(0, 18),
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
      formatPercent(row.avgTWRAnnualPct),
      formatNumber(row.avgRiskAdjustedScore, 3),
      formatNumber(row.avgPnlPerTrade),
      formatNumber(row.totalVolume)
    ];
    console.log(values.map((v, i) => String(v).padEnd(colWidths[i])).join(' | '));
  }

  console.log();
  console.log('='.repeat(150));
  console.log();
}

function getValueForColumn(row, colIndex) {
  switch (colIndex) {
    case 0: return row.strategy.substring(0, 18);
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
    case 12: return formatPercent(row.avgTWRAnnualPct);
    case 13: return formatNumber(row.avgRiskAdjustedScore, 3);
    case 14: return formatNumber(row.avgPnlPerTrade);
    case 15: return formatNumber(row.totalVolume);
    default: return '';
  }
}

// Main execution
function main() {
  console.log('Scanning simulation results...');
  const summaries = findAllSummaries();
  console.log(`Found ${summaries.length} simulation summaries`);

  if (summaries.length === 0) {
    console.log('No simulation summaries found.');
    return;
  }

  // Show which strategies were found
  const strategiesFound = new Set(summaries.map(s => s.strategy));
  console.log(`\nStrategies with summary.json files: ${strategiesFound.size}`);
  strategiesFound.forEach(s => {
    const count = summaries.filter(sum => sum.strategy === s).length;
    console.log(`  - ${s}: ${count} summaries`);
  });

  const aggregated = aggregateByStrategy(summaries);
  printSummaryTable(aggregated);

  // Also save to JSON
  const outputPath = path.join(__dirname, '..', 'data', 'simulation-summary.json');
  fs.writeFileSync(outputPath, JSON.stringify(aggregated, null, 2));
  console.log(`\nDetailed results saved to: ${outputPath}`);

  // Create markdown table
  const markdownPath = path.join(__dirname, '..', 'data', 'simulation-summary.md');
  createMarkdownTable(aggregated, markdownPath);
  console.log(`Markdown table saved to: ${markdownPath}`);
}

function createMarkdownTable(aggregated, outputPath) {
  let markdown = '# Simulation Results Summary\n\n';
  markdown += 'Aggregated results by strategy across all callers.\n\n';
  markdown += '| Strategy | Callers | Total Calls | Total Trades | Avg Win Rate | Win Rate Range | Total Final Portfolio | Avg Final/Caller | Final Range | Avg Compound Factor | Avg Simple Return % | Avg TWR Daily % | Avg TWR Annual % | Avg Risk Score | Avg PnL/Trade |\n';
  markdown += '|----------|---------|--------------|--------------|--------------|----------------|----------------------|-----------------|-------------|---------------------|---------------------|-----------------|------------------|----------------|---------------|\n';

  for (const row of aggregated) {
    const values = [
      row.strategy.substring(0, 30),
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
      formatPercent(row.avgTWRAnnualPct),
      formatNumber(row.avgRiskAdjustedScore, 3),
      formatNumber(row.avgPnlPerTrade)
    ];
    markdown += '| ' + values.join(' | ') + ' |\n';
  }

  markdown += '\n## Strategy Details\n\n';
  for (const row of aggregated) {
    markdown += `### ${row.strategy}\n\n`;
    markdown += `- **Callers Tested**: ${row.callerCount}\n`;
    markdown += `- **Total Calls**: ${row.totalCalls}\n`;
    markdown += `- **Total Trades**: ${row.totalTrades}\n`;
    markdown += `- **Average Win Rate**: ${formatPercent(row.avgWinRate)} (Range: ${formatPercent(row.minWinRate)} - ${formatPercent(row.maxWinRate)})\n`;
    markdown += `- **Total Final Portfolio**: ${formatNumber(row.totalFinalPortfolio)} (Average per caller: ${formatNumber(row.totalFinalPortfolio / row.callerCount)})\n`;
    markdown += `- **Final Portfolio Range**: ${formatNumber(row.minFinalPortfolio)} - ${formatNumber(row.maxFinalPortfolio)}\n`;
    markdown += `- **Average Compound Factor**: ${formatNumber(row.avgCompoundFactor, 3)}\n`;
    markdown += `- **Average Simple Return**: ${formatPercent(row.avgSimpleReturnPercent)}\n`;
    markdown += `- **Average TWR Daily**: ${formatPercent(row.avgTWRDailyPct)}\n`;
    markdown += `- **Average TWR Annual**: ${formatPercent(row.avgTWRAnnualPct)}\n`;
    markdown += `- **Average Risk-Adjusted Score**: ${formatNumber(row.avgRiskAdjustedScore, 3)}\n`;
    markdown += `- **Average PnL per Trade**: ${formatNumber(row.avgPnlPerTrade)}\n`;
    markdown += `- **Callers**: ${row.callers.slice(0, 10).join(', ')}${row.callers.length > 10 ? ` ... and ${row.callers.length - 10} more` : ''}\n\n`;
  }

  fs.writeFileSync(outputPath, markdown);
}

if (require.main === module) {
  main();
}

module.exports = { findAllSummaries, aggregateByStrategy };

