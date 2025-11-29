#!/usr/bin/env node

/**
 * Processes CSV files from simulation directories to generate summary statistics
 * Handles multiple CSV formats: trade history, optimization results, etc.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const EXPORTS_DIR = path.join(__dirname, '..', 'data', 'exports');

// Process trade history CSV (complete_trade_history.csv format)
function processTradeHistoryCSV(csvPath, strategy, caller) {
  try {
    const content = fs.readFileSync(csvPath, 'utf8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      cast: true
    });

    if (records.length === 0) return null;

    const trades = records.filter(r => r.PnL !== undefined && r.PnL !== null);
    if (trades.length === 0) return null;

    const winningTrades = trades.filter(t => t.IsWin === 'Yes' || t.IsWin === true || (t.PnLPercent && t.PnLPercent > 0));
    const losingTrades = trades.filter(t => t.IsWin === 'No' || t.IsWin === false || (t.PnLPercent && t.PnLPercent <= 0));
    
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
    
    // Calculate portfolio values (assuming starting with 100)
    let portfolio = 100;
    let peakPortfolio = 100;
    let maxDrawdown = 0;
    const pnls = [];
    
    for (const trade of trades) {
      const pnl = parseFloat(trade.PnL) || 0;
      const pnlPercent = parseFloat(trade.PnLPercent) || 0;
      pnls.push(pnlPercent);
      
      // Update portfolio (compound)
      portfolio *= (1 + pnlPercent / 100);
      peakPortfolio = Math.max(peakPortfolio, portfolio);
      const drawdown = ((peakPortfolio - portfolio) / peakPortfolio) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    const avgPnlPerTrade = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
    const finalPortfolio = portfolio;
    const compoundFactor = finalPortfolio / 100;
    
    // Calculate simple return (sum of all PnL percentages)
    const simpleReturnPercent = pnls.reduce((a, b) => a + b, 0);
    const simpleFinalPortfolio = 100 + simpleReturnPercent;

    // Calculate days active from first to last trade
    let daysActive = 0;
    if (trades.length > 0) {
      const firstTrade = trades[0];
      const lastTrade = trades[trades.length - 1];
      const firstTime = new Date(firstTrade.EntryTime || firstTrade.AlertTime || Date.now());
      const lastTime = new Date(lastTrade.ExitTime || lastTrade.EntryTime || Date.now());
      daysActive = (lastTime - firstTime) / (1000 * 60 * 60 * 24);
    }

    // Calculate TWR (Time-Weighted Return)
    let twrDailyPct = 0;
    let twrWeeklyPct = 0;
    let twrAnnualPct = 0;
    if (daysActive > 0 && compoundFactor > 0) {
      twrDailyPct = (Math.pow(compoundFactor, 1 / daysActive) - 1) * 100;
      twrWeeklyPct = (Math.pow(compoundFactor, 7 / daysActive) - 1) * 100;
      twrAnnualPct = (Math.pow(compoundFactor, 365 / daysActive) - 1) * 100;
      // Cap unrealistic values
      if (twrAnnualPct > 1000000) twrAnnualPct = 0;
      if (twrWeeklyPct > 1000000) twrWeeklyPct = 0;
    }

    // Risk-adjusted score (simplified)
    const riskAdjustedScore = winRate > 0 && maxDrawdown > 0 
      ? (winRate / 100) * (compoundFactor / (maxDrawdown / 100 + 1))
      : 0;

    return {
      caller: caller || 'unknown',
      totalCalls: trades.length,
      uniqueTokens: new Set(trades.map(t => t.TokenAddress)).size,
      totalTrades: totalTrades,
      winRate: winRate,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      avgPnlPerTrade: avgPnlPerTrade,
      finalPortfolio: finalPortfolio,
      compoundFactor: compoundFactor,
      simpleFinalPortfolio: simpleFinalPortfolio,
      simpleReturnPercent: simpleReturnPercent,
      initialPortfolio: 100,
      maxDrawdown: maxDrawdown,
      maxDrawdownPct: maxDrawdown,
      peakPortfolio: peakPortfolio,
      daysActive: daysActive,
      twrDailyPct: twrDailyPct,
      twrWeeklyPct: twrWeeklyPct,
      twrAnnualPct: twrAnnualPct,
      riskAdjustedScore: riskAdjustedScore,
      clampMinPnlEnabled: false,
      minPnlFloor: 0.8
    };
  } catch (error) {
    console.error(`Error processing ${csvPath}:`, error.message);
    return null;
  }
}

// Process optimization results CSV (optimization_results.csv format)
function processOptimizationCSV(csvPath, strategy) {
  try {
    const content = fs.readFileSync(csvPath, 'utf8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      cast: true
    });

    if (records.length === 0) return null;

    // Aggregate all strategies in the file
    const summaries = [];
    for (const record of records) {
      // Handle different CSV formats
      const strategyName = record.Strategy || record.strategy || record.Rank;
      const totalTrades = record.TotalTrades || record.totalTrades || 0;
      const winRate = parseFloat(record.WinRate || record.winRate || 0);
      const finalPortfolio = parseFloat(record.FinalPortfolio || record.finalPortfolio || 100);
      const compoundFactor = parseFloat(record.CompoundFactor || record.compoundFactor || 1);
      const avgPnlPerTrade = parseFloat(record.AvgPnlPerTrade || record.avgPnlPerTrade || 0);
      const maxDrawdown = parseFloat(record.MaxDrawdown || record.maxDrawdown || 0);
      const maxDrawdownPct = parseFloat(record.MaxDrawdownPct || record.maxDrawdownPct || maxDrawdown);
      const riskAdjustedScore = parseFloat(record.RiskAdjustedScore || record.riskAdjustedScore || 0);
      
      if (!strategyName || totalTrades === 0) continue;

      const winningTrades = record.WinningTrades || record.winningTrades || Math.round(winRate / 100 * totalTrades);
      const losingTrades = record.LosingTrades || record.losingTrades || Math.round((1 - winRate / 100) * totalTrades);

      summaries.push({
        caller: String(strategyName),
        totalCalls: totalTrades,
        uniqueTokens: 0,
        totalTrades: totalTrades,
        winRate: winRate,
        winningTrades: winningTrades,
        losingTrades: losingTrades,
        avgPnlPerTrade: avgPnlPerTrade,
        finalPortfolio: finalPortfolio,
        compoundFactor: compoundFactor,
        simpleFinalPortfolio: finalPortfolio,
        simpleReturnPercent: (finalPortfolio - 100),
        initialPortfolio: 100,
        maxDrawdown: maxDrawdown,
        maxDrawdownPct: maxDrawdownPct,
        peakPortfolio: finalPortfolio,
        daysActive: 0,
        twrDailyPct: 0,
        twrWeeklyPct: 0,
        twrAnnualPct: 0,
        riskAdjustedScore: riskAdjustedScore,
        clampMinPnlEnabled: record.LossClampEnabled === 'Yes' || record.LossClampEnabled === true || false,
        minPnlFloor: parseFloat(record.MinPnlFloor || record.minPnlFloor || 0.8)
      });
    }

    return summaries;
  } catch (error) {
    console.error(`Error processing optimization CSV ${csvPath}:`, error.message);
    return null;
  }
}

// Process results CSV (1h_candles_no_reinvestment_results.csv format)
function processResultsCSV(csvPath, strategy, caller) {
  try {
    const content = fs.readFileSync(csvPath, 'utf8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      cast: true
    });

    if (records.length === 0) return null;

    // This format is similar to trade history
    return processTradeHistoryCSV(csvPath, strategy, caller);
  } catch (error) {
    console.error(`Error processing results CSV ${csvPath}:`, error.message);
    return null;
  }
}

// Find and process all CSV files
function findAllCSVSummaries() {
  const summaries = [];
  const strategies = fs.readdirSync(EXPORTS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => !['csv', 'json', 'emails', 'reports'].includes(name));

  for (const strategy of strategies) {
    const strategyPath = path.join(EXPORTS_DIR, strategy);
    
    // Check for optimization results at strategy level (various formats)
    const optFiles = [
      'optimization_results.csv',
      'filtered_ichimoku_strategies.csv',
      'high_win_rate_strategies.csv',
      'indicator_strategies.csv',
      'tenkan_kijun_filtered_strategies.csv',
      'ichimoku_comparison.csv',
      'strategy_comparison.csv'
    ];
    
    for (const optFile of optFiles) {
      const optResultsPath = path.join(strategyPath, optFile);
      if (fs.existsSync(optResultsPath)) {
        const optSummaries = processOptimizationCSV(optResultsPath, strategy);
        if (optSummaries && optSummaries.length > 0) {
          optSummaries.forEach(summary => {
            summaries.push({ strategy, caller: summary.caller, summary });
          });
        }
      }
    }

    // Check for other CSV files at strategy level
    const csvFiles = fs.readdirSync(strategyPath).filter(f => f.endsWith('.csv'));
    for (const csvFile of csvFiles) {
      // Skip already processed files
      if (optFiles.some(f => csvFile === f)) continue;
      
      const csvPath = path.join(strategyPath, csvFile);
      if (csvFile.includes('trade') || csvFile.includes('result') || csvFile.includes('history') || csvFile.includes('comparison') || csvFile.includes('analysis')) {
        const summary = processTradeHistoryCSV(csvPath, strategy, strategy);
        if (summary) {
          summaries.push({ strategy, caller: strategy, summary });
        }
      }
    }

    // Check caller subdirectories
    try {
      const entries = fs.readdirSync(strategyPath, { withFileTypes: true });
      const callers = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

      for (const caller of callers) {
        const callerPath = path.join(strategyPath, caller);
        const csvFiles = fs.readdirSync(callerPath).filter(f => f.endsWith('.csv'));
        
        for (const csvFile of csvFiles) {
          const csvPath = path.join(callerPath, csvFile);
          
          if (csvFile.includes('trade') || csvFile.includes('complete') || csvFile.includes('history')) {
            const summary = processTradeHistoryCSV(csvPath, strategy, caller);
            if (summary) {
              summaries.push({ strategy, caller, summary });
            }
          } else if (csvFile.includes('result')) {
            const summary = processResultsCSV(csvPath, strategy, caller);
            if (summary) {
              summaries.push({ strategy, caller, summary });
            }
          }
        }
      }
    } catch (error) {
      // Directory might not be readable, skip
    }
  }

  return summaries;
}

// Aggregate by strategy (same as before)
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
    if (!agg.callers.includes(caller)) {
      agg.callers.push(caller);
    }
    agg.callerCount++;
    
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
    agg.avgRiskAdjustedScore = agg.callerCount > 0
      ? agg.totalRiskAdjustedScore / agg.callerCount
      : 0;
    agg.avgPnlPerTrade = agg.totalTrades > 0
      ? agg.totalAvgPnlPerTrade / agg.totalTrades
      : 0;

    // Calculate TWR from individual summaries
    let totalTWRDaily = 0;
    let totalTWRWeekly = 0;
    let totalTWRAnnual = 0;
    let twrCount = 0;
    for (const { summary } of summaries.filter(s => s.strategy === agg.strategy)) {
      if (summary.twrDailyPct !== undefined && !isNaN(summary.twrDailyPct)) {
        totalTWRDaily += summary.twrDailyPct;
        totalTWRWeekly += (summary.twrWeeklyPct || 0);
        const twrAnnual = summary.twrAnnualPct || 0;
        totalTWRAnnual += Math.min(twrAnnual, 1000000);
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

// Format functions (same as before)
function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  return typeof num === 'number' ? num.toFixed(decimals) : num;
}

function formatPercent(num) {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  return `${formatNumber(num, 2)}%`;
}

// Print summary table
function printSummaryTable(aggregated) {
  console.log('\n' + '='.repeat(150));
  console.log('SIMULATION RESULTS SUMMARY - Aggregated by Strategy (from CSV files)');
  console.log('='.repeat(150));
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
    'Avg TWR Annual %',
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
    return Math.min(maxContent + 2, 20);
  });

  console.log(header.map((h, i) => h.padEnd(colWidths[i])).join(' | '));
  console.log('-'.repeat(colWidths.reduce((a, b) => a + b + 3, 0)));

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
      formatNumber(row.avgPnlPerTrade)
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
    default: return '';
  }
}

// Main execution
function main() {
  console.log('Processing CSV files to generate summaries...');
  const summaries = findAllCSVSummaries();
  console.log(`Found ${summaries.length} summaries from CSV files`);

  if (summaries.length === 0) {
    console.log('No CSV summaries found.');
    return;
  }

  const strategiesFound = new Set(summaries.map(s => s.strategy));
  console.log(`\nStrategies found: ${strategiesFound.size}`);
  strategiesFound.forEach(s => {
    const count = summaries.filter(sum => sum.strategy === s).length;
    console.log(`  - ${s}: ${count} summaries`);
  });

  const aggregated = aggregateByStrategy(summaries);
  printSummaryTable(aggregated);

  // Save to JSON
  const outputPath = path.join(__dirname, '..', 'data', 'simulation-summary-from-csv.json');
  fs.writeFileSync(outputPath, JSON.stringify(aggregated, null, 2));
  console.log(`\nDetailed results saved to: ${outputPath}`);

  // Create markdown
  const markdownPath = path.join(__dirname, '..', 'data', 'simulation-summary-from-csv.md');
  let markdown = '# Simulation Results Summary (from CSV files)\n\n';
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

  fs.writeFileSync(markdownPath, markdown);
  console.log(`Markdown table saved to: ${markdownPath}`);
}

if (require.main === module) {
  main();
}

module.exports = { findAllCSVSummaries, aggregateByStrategy };

