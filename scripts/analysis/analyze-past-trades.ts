#!/usr/bin/env ts-node
/**
 * Analyze Past Trades
 * 
 * Analyzes the most recent N trades from trade_by_trade CSV files
 * Provides comprehensive statistics and insights
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { DateTime } from 'luxon';

const CSV_DIR = path.join(__dirname, '../../data/exports/csv');
const TRADE_COUNT = parseInt(process.env.TRADE_COUNT || '1000');

interface Trade {
  tradeNumber: number;
  date: string;
  time: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  chain: string;
  investmentSOL: number;
  pnlMultiplier: number;
  returnSOL: number;
  profitSOL: number;
  portfolioBefore: number;
  portfolioAfter: number;
  maxMultiplierReached: number;
  holdDurationMinutes: number;
  timeToAthMinutes: number;
  timestamp: DateTime;
}

async function loadAllTrades(): Promise<Trade[]> {
  const allTrades: Trade[] = [];
  
  if (!fs.existsSync(CSV_DIR)) {
    console.error(`❌ CSV directory not found: ${CSV_DIR}`);
    return [];
  }
  
  const files = fs.readdirSync(CSV_DIR);
  const tradeFiles = files.filter(f => f.endsWith('_trade_by_trade.csv'));
  
  console.log(`📂 Found ${tradeFiles.length} trade CSV file(s)`);
  
  for (const file of tradeFiles) {
    const filePath = path.join(CSV_DIR, file);
    console.log(`   Reading: ${file}...`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    const records: any[] = await new Promise((resolve, reject) => {
      parse(content, { columns: true, skip_empty_lines: true }, (err, records) => {
        if (err) reject(err);
        else resolve(records);
      });
    });
    
    for (const record of records) {
      const dateStr = record['Date'] || record['date'] || '';
      const timeStr = record['Time'] || record['time'] || '';
      
      if (!dateStr) continue;
      
      const timestamp = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: 'utc' });
      if (!timestamp.isValid) continue;
      
      allTrades.push({
        tradeNumber: parseInt(record['Trade#'] || record['tradeNumber'] || '0'),
        date: dateStr,
        time: timeStr,
        tokenAddress: record['TokenAddress'] || record['tokenAddress'] || '',
        tokenSymbol: record['TokenSymbol'] || record['tokenSymbol'] || '',
        tokenName: record['TokenName'] || record['tokenName'] || '',
        chain: record['Chain'] || record['chain'] || 'SOL',
        investmentSOL: parseFloat(record['Investment_SOL'] || record['investmentSOL'] || '0'),
        pnlMultiplier: parseFloat(record['PNL_Multiplier'] || record['pnlMultiplier'] || '0'),
        returnSOL: parseFloat(record['Return_SOL'] || record['returnSOL'] || '0'),
        profitSOL: parseFloat(record['Profit_SOL'] || record['profitSOL'] || '0'),
        portfolioBefore: parseFloat(record['Portfolio_Before_SOL'] || record['portfolioBefore'] || '0'),
        portfolioAfter: parseFloat(record['Portfolio_After_SOL'] || record['portfolioAfter'] || '0'),
        maxMultiplierReached: parseFloat(record['Max_Multiplier_Reached'] || record['maxMultiplierReached'] || '0'),
        holdDurationMinutes: parseFloat(record['HoldDuration_Minutes'] || record['holdDurationMinutes'] || '0'),
        timeToAthMinutes: parseFloat(record['TimeToAth_Minutes'] || record['timeToAthMinutes'] || '0'),
        timestamp
      });
    }
  }
  
  // Sort by timestamp (most recent first)
  allTrades.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
  
  return allTrades;
}

function analyzeTrades(trades: Trade[]) {
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.pnlMultiplier > 1.0);
  const losingTrades = trades.filter(t => t.pnlMultiplier <= 1.0);
  const breakevenTrades = trades.filter(t => t.pnlMultiplier === 1.0);
  
  const totalInvestment = trades.reduce((sum, t) => sum + t.investmentSOL, 0);
  const totalReturn = trades.reduce((sum, t) => sum + t.returnSOL, 0);
  const totalProfit = trades.reduce((sum, t) => sum + t.profitSOL, 0);
  
  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  
  const avgPnL = totalTrades > 0 
    ? trades.reduce((sum, t) => sum + t.pnlMultiplier, 0) / totalTrades 
    : 0;
  
  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.pnlMultiplier, 0) / winningTrades.length
    : 0;
  
  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + t.pnlMultiplier, 0) / losingTrades.length
    : 0;
  
  const bestTrade = trades.reduce((best, t) => 
    t.pnlMultiplier > best.pnlMultiplier ? t : best, trades[0] || { pnlMultiplier: 0 });
  
  const worstTrade = trades.reduce((worst, t) => 
    t.pnlMultiplier < worst.pnlMultiplier ? t : worst, trades[0] || { pnlMultiplier: Infinity });
  
  const avgHoldDuration = totalTrades > 0
    ? trades.reduce((sum, t) => sum + t.holdDurationMinutes, 0) / totalTrades
    : 0;
  
  const avgTimeToAth = totalTrades > 0
    ? trades.reduce((sum, t) => sum + t.timeToAthMinutes, 0) / totalTrades
    : 0;
  
  // Chain distribution
  const chainCounts = new Map<string, number>();
  trades.forEach(t => {
    chainCounts.set(t.chain, (chainCounts.get(t.chain) || 0) + 1);
  });
  
  // PnL distribution
  const pnlRanges = {
    '10x+': trades.filter(t => t.pnlMultiplier >= 10).length,
    '5x-10x': trades.filter(t => t.pnlMultiplier >= 5 && t.pnlMultiplier < 10).length,
    '2x-5x': trades.filter(t => t.pnlMultiplier >= 2 && t.pnlMultiplier < 5).length,
    '1x-2x': trades.filter(t => t.pnlMultiplier >= 1 && t.pnlMultiplier < 2).length,
    '0.5x-1x': trades.filter(t => t.pnlMultiplier >= 0.5 && t.pnlMultiplier < 1).length,
    '<0.5x': trades.filter(t => t.pnlMultiplier < 0.5).length,
  };
  
  // Portfolio progression
  const initialPortfolio = trades.length > 0 ? trades[trades.length - 1].portfolioBefore : 0;
  const finalPortfolio = trades.length > 0 ? trades[0].portfolioAfter : 0;
  const portfolioGrowth = initialPortfolio > 0 
    ? ((finalPortfolio - initialPortfolio) / initialPortfolio) * 100 
    : 0;
  
  return {
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakevenTrades: breakevenTrades.length,
    winRate,
    totalInvestment,
    totalReturn,
    totalProfit,
    netPnL: totalProfit,
    roi: totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0,
    avgPnL,
    avgWin,
    avgLoss,
    bestTrade,
    worstTrade,
    avgHoldDuration,
    avgTimeToAth,
    chainCounts,
    pnlRanges,
    initialPortfolio,
    finalPortfolio,
    portfolioGrowth
  };
}

function printAnalysis(stats: ReturnType<typeof analyzeTrades>, trades: Trade[]) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 TRADE ANALYSIS - PAST ' + trades.length + ' TRADES');
  console.log('='.repeat(80) + '\n');
  
  console.log('📈 OVERALL PERFORMANCE');
  console.log('─'.repeat(80));
  console.log(`Total Trades:        ${stats.totalTrades}`);
  console.log(`Winning Trades:      ${stats.winningTrades} (${(stats.winningTrades/stats.totalTrades*100).toFixed(1)}%)`);
  console.log(`Losing Trades:       ${stats.losingTrades} (${(stats.losingTrades/stats.totalTrades*100).toFixed(1)}%)`);
  console.log(`Breakeven Trades:    ${stats.breakevenTrades}`);
  console.log(`Win Rate:            ${stats.winRate.toFixed(2)}%`);
  console.log('');
  
  console.log('💰 FINANCIAL METRICS');
  console.log('─'.repeat(80));
  console.log(`Total Investment:    ${stats.totalInvestment.toFixed(4)} SOL`);
  console.log(`Total Return:        ${stats.totalReturn.toFixed(4)} SOL`);
  console.log(`Total Profit:        ${stats.totalProfit.toFixed(4)} SOL`);
  console.log(`Net P/L:             ${stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(4)} SOL`);
  console.log(`ROI:                 ${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(2)}%`);
  console.log(`Avg PnL Multiplier:  ${stats.avgPnL.toFixed(4)}x`);
  console.log(`Avg Win:             ${stats.avgWin.toFixed(4)}x`);
  console.log(`Avg Loss:            ${stats.avgLoss.toFixed(4)}x`);
  console.log('');
  
  console.log('📊 PORTFOLIO PROGRESSION');
  console.log('─'.repeat(80));
  console.log(`Initial Portfolio:   ${stats.initialPortfolio.toFixed(4)} SOL`);
  console.log(`Final Portfolio:     ${stats.finalPortfolio.toFixed(4)} SOL`);
  console.log(`Portfolio Growth:   ${stats.portfolioGrowth >= 0 ? '+' : ''}${stats.portfolioGrowth.toFixed(2)}%`);
  console.log('');
  
  console.log('🏆 BEST & WORST TRADES');
  console.log('─'.repeat(80));
  if (stats.bestTrade.pnlMultiplier > 0) {
    console.log(`Best Trade:`);
    console.log(`  Token: ${stats.bestTrade.tokenSymbol} (${stats.bestTrade.tokenName})`);
    console.log(`  PnL: ${stats.bestTrade.pnlMultiplier.toFixed(4)}x (${((stats.bestTrade.pnlMultiplier - 1) * 100).toFixed(2)}%)`);
    console.log(`  Date: ${stats.bestTrade.date} ${stats.bestTrade.time}`);
    console.log(`  Max Reached: ${stats.bestTrade.maxMultiplierReached.toFixed(4)}x`);
  }
  if (stats.worstTrade.pnlMultiplier < Infinity) {
    console.log(`Worst Trade:`);
    console.log(`  Token: ${stats.worstTrade.tokenSymbol} (${stats.worstTrade.tokenName})`);
    console.log(`  PnL: ${stats.worstTrade.pnlMultiplier.toFixed(4)}x (${((stats.worstTrade.pnlMultiplier - 1) * 100).toFixed(2)}%)`);
    console.log(`  Date: ${stats.worstTrade.date} ${stats.worstTrade.time}`);
    console.log(`  Max Reached: ${stats.worstTrade.maxMultiplierReached.toFixed(4)}x`);
  }
  console.log('');
  
  console.log('⏱️  TIMING METRICS');
  console.log('─'.repeat(80));
  console.log(`Avg Hold Duration:   ${(stats.avgHoldDuration / 60).toFixed(2)} hours (${stats.avgHoldDuration.toFixed(0)} minutes)`);
  console.log(`Avg Time to ATH:     ${(stats.avgTimeToAth / 60).toFixed(2)} hours (${stats.avgTimeToAth.toFixed(0)} minutes)`);
  console.log('');
  
  console.log('🔗 CHAIN DISTRIBUTION');
  console.log('─'.repeat(80));
  const sortedChains = Array.from(stats.chainCounts.entries())
    .sort((a, b) => b[1] - a[1]);
  sortedChains.forEach(([chain, count]) => {
    const percentage = (count / stats.totalTrades) * 100;
    console.log(`  ${chain.padEnd(10)} ${count.toString().padStart(5)} trades (${percentage.toFixed(1)}%)`);
  });
  console.log('');
  
  console.log('📊 PNL DISTRIBUTION');
  console.log('─'.repeat(80));
  Object.entries(stats.pnlRanges).forEach(([range, count]) => {
    const percentage = (count / stats.totalTrades) * 100;
    const bar = '█'.repeat(Math.round(percentage / 2));
    console.log(`  ${range.padEnd(10)} ${count.toString().padStart(5)} trades (${percentage.toFixed(1)}%) ${bar}`);
  });
  console.log('');
  
  // Time range
  if (trades.length > 0) {
    const oldestTrade = trades[trades.length - 1];
    const newestTrade = trades[0];
    console.log('📅 TIME RANGE');
    console.log('─'.repeat(80));
    console.log(`Oldest Trade: ${oldestTrade.date} ${oldestTrade.time}`);
    console.log(`Newest Trade: ${newestTrade.date} ${newestTrade.time}`);
    const daysDiff = newestTrade.timestamp.diff(oldestTrade.timestamp, 'days').days;
    console.log(`Time Span:    ${daysDiff.toFixed(1)} days`);
    console.log('');
  }
  
  // Month-by-month breakdown
  if (stats.monthlyBreakdown && stats.monthlyBreakdown.length > 0) {
    console.log('📅 MONTH-BY-MONTH RETURNS');
    console.log('─'.repeat(80));
    console.log(`${'Month'.padEnd(20)} ${'Trades'.padStart(8)} ${'Investment'.padStart(12)} ${'Return'.padStart(12)} ${'Profit'.padStart(12)} ${'ROI'.padStart(10)} ${'Win Rate'.padStart(10)} ${'Portfolio Growth'.padStart(18)}`);
    console.log('─'.repeat(80));
    
    let cumulativeProfit = 0;
    let cumulativeInvestment = 0;
    
    stats.monthlyBreakdown.forEach(month => {
      cumulativeProfit += month.profit;
      cumulativeInvestment += month.investment;
      
      const profitStr = month.profit >= 0 
        ? `+${month.profit.toFixed(4)}` 
        : month.profit.toFixed(4);
      const roiStr = month.roi >= 0 
        ? `+${month.roi.toFixed(2)}%` 
        : `${month.roi.toFixed(2)}%`;
      const winRateStr = `${month.winRate.toFixed(1)}%`;
      const portfolioGrowthStr = month.portfolioGrowth >= 0
        ? `+${month.portfolioGrowth.toFixed(2)}%`
        : `${month.portfolioGrowth.toFixed(2)}%`;
      
      console.log(
        `${month.month.padEnd(20)} ` +
        `${month.tradeCount.toString().padStart(8)} ` +
        `${month.investment.toFixed(4).padStart(12)} SOL ` +
        `${month.return.toFixed(4).padStart(12)} SOL ` +
        `${profitStr.padStart(12)} SOL ` +
        `${roiStr.padStart(10)} ` +
        `${winRateStr.padStart(10)} ` +
        `${portfolioGrowthStr.padStart(18)}`
      );
    });
    
    console.log('─'.repeat(80));
    const cumulativeROI = cumulativeInvestment > 0 
      ? (cumulativeProfit / cumulativeInvestment) * 100 
      : 0;
    const cumulativeROIStr = cumulativeROI >= 0 
      ? `+${cumulativeROI.toFixed(2)}%` 
      : `${cumulativeROI.toFixed(2)}%`;
    
    console.log(
      `${'CUMULATIVE'.padEnd(20)} ` +
      `${stats.totalTrades.toString().padStart(8)} ` +
      `${cumulativeInvestment.toFixed(4).padStart(12)} SOL ` +
      `${stats.totalReturn.toFixed(4).padStart(12)} SOL ` +
      `${(cumulativeProfit >= 0 ? '+' : '') + cumulativeProfit.toFixed(4).padStart(12)} SOL ` +
      `${cumulativeROIStr.padStart(10)} ` +
      `${stats.winRate.toFixed(1).padStart(10)}% ` +
      `${(stats.portfolioGrowth >= 0 ? '+' : '') + stats.portfolioGrowth.toFixed(2).padStart(18)}%`
    );
    console.log('');
  }
}

async function main() {
  console.log('🔍 Loading trade data...\n');
  
  const allTrades = await loadAllTrades();
  
  if (allTrades.length === 0) {
    console.error('❌ No trades found in CSV files');
    return;
  }
  
  console.log(`✅ Loaded ${allTrades.length} total trades`);
  console.log(`📊 Analyzing past ${Math.min(TRADE_COUNT, allTrades.length)} trades...\n`);
  
  const recentTrades = allTrades.slice(0, TRADE_COUNT);
  const stats = analyzeTrades(recentTrades);
  printAnalysis(stats, recentTrades);
  
  // Export summary to file
  const outputDir = path.join(__dirname, '../../data/exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const timestamp = DateTime.now().toFormat('yyyyMMdd-HHmmss');
  const summaryFile = path.join(outputDir, `trade-analysis-${timestamp}.txt`);
  
  // Redirect console output to file
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    logs.push(msg);
    originalLog(...args);
  };
  
  printAnalysis(stats, recentTrades);
  
  fs.writeFileSync(summaryFile, logs.join('\n'));
  console.log(`\n✅ Analysis saved to: ${summaryFile}`);
}

main().catch(console.error);


