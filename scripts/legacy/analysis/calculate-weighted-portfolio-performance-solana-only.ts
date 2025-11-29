#!/usr/bin/env ts-node
/**
 * Calculate Combined Portfolio Performance - SOLANA ONLY
 * Applies weekly reinvestment strategy across all callers based on position sizing weights
 * Filters to only Solana tokens
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';

const OUTPUT_DIR = path.join(__dirname, '../data/exports/tenkan-kijun-remaining-period-by-caller');
const CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

interface CallerWeight {
  caller: string;
  weight: number;
  totalTrades: number;
  daysActive: number;
  twrDailyPct: number;
  stdDevReturnsPct: number;
  maxDrawdownPct: number;
}

interface Trade {
  caller: string;
  tokenAddress: string;
  alertTime: string;
  entryTime: string;
  exitTime: string;
  pnl: number;
  pnlPercent: number;
  weight: number;
  chain: string; // Add chain field
}

interface PortfolioSnapshot {
  week: string;
  date: DateTime;
  portfolioValue: number;
  tradesThisWeek: number;
  weeklyReturn: number;
}

// Load chain mapping from original calls CSV
async function loadChainMapping(): Promise<Map<string, string>> {
  const chainMap = new Map<string, string>();
  
  if (!fs.existsSync(CALLS_CSV)) {
    console.warn(`⚠️  Calls CSV not found: ${CALLS_CSV}`);
    return chainMap;
  }
  
  const csv = fs.readFileSync(CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  for (const record of records) {
    const tokenAddress = record.token_address || record.TokenAddress || record.mint;
    const chain = record.chain || record.Chain || 'solana'; // Default to solana if missing
    
    if (tokenAddress) {
      chainMap.set(tokenAddress.toLowerCase(), chain.toLowerCase());
    }
  }
  
  console.log(`   Loaded chain mapping for ${chainMap.size} tokens`);
  return chainMap;
}

// Get caller weights from the position sizing calculator
function getCallerWeights(): CallerWeight[] {
  const summaries: CallerWeight[] = [];
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.error(`❌ Output directory not found: ${OUTPUT_DIR}`);
    return summaries;
  }
  
  const callerDirs = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  // Filtering criteria (same as calc_caller_weights.ts)
  const MIN_TRADES = 50;
  const MIN_DAYS_ACTIVE = 60;
  const MAX_DRAWDOWN_PCT = 40;
  const REQUIRE_POSITIVE_TWR = true;
  
  for (const callerDir of callerDirs) {
    const summaryPath = path.join(OUTPUT_DIR, callerDir, 'summary.json');
    if (!fs.existsSync(summaryPath)) continue;
    
    try {
      const json = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      
      // Apply filters
      if (json.totalTrades < MIN_TRADES) continue;
      if (json.daysActive < MIN_DAYS_ACTIVE) continue;
      if (json.maxDrawdownPct > MAX_DRAWDOWN_PCT) continue;
      if (REQUIRE_POSITIVE_TWR && json.twrDailyPct <= 0) continue;
      
      // Calculate risk-adjusted score (same logic as calc_caller_weights.ts)
      const tradeFactor = Math.min(1, json.totalTrades / 100);
      const daysFactor = Math.min(1, json.daysActive / 90);
      const sizeFactor = tradeFactor * daysFactor;
      
      const base = json.stdDevReturnsPct > 0 
        ? json.twrDailyPct / json.stdDevReturnsPct 
        : 0;
      const score = Math.max(0, base * sizeFactor);
      
      if (score > 0) {
        summaries.push({
          caller: json.caller || callerDir,
          weight: 0, // Will calculate after
          totalTrades: json.totalTrades,
          daysActive: json.daysActive,
          twrDailyPct: json.twrDailyPct,
          stdDevReturnsPct: json.stdDevReturnsPct,
          maxDrawdownPct: json.maxDrawdownPct,
        });
      }
    } catch (e) {
      console.warn(`⚠️  Failed to load ${summaryPath}: ${e}`);
    }
  }
  
  // Calculate weights (normalize scores)
  const totalScore = summaries.reduce((sum, s) => {
    const tradeFactor = Math.min(1, s.totalTrades / 100);
    const daysFactor = Math.min(1, s.daysActive / 90);
    const sizeFactor = tradeFactor * daysFactor;
    const base = s.stdDevReturnsPct > 0 ? s.twrDailyPct / s.stdDevReturnsPct : 0;
    return sum + Math.max(0, base * sizeFactor);
  }, 0);
  
  if (totalScore > 0) {
    summaries.forEach(s => {
      const tradeFactor = Math.min(1, s.totalTrades / 100);
      const daysFactor = Math.min(1, s.daysActive / 90);
      const sizeFactor = tradeFactor * daysFactor;
      const base = s.stdDevReturnsPct > 0 ? s.twrDailyPct / s.stdDevReturnsPct : 0;
      const score = Math.max(0, base * sizeFactor);
      s.weight = score / totalScore;
    });
  }
  
  return summaries.sort((a, b) => b.weight - a.weight);
}

async function loadCallerTrades(callerName: string, chainMap: Map<string, string>): Promise<Trade[]> {
  const safeCallerName = callerName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const callerDir = path.join(OUTPUT_DIR, safeCallerName);
  const tradeHistoryPath = path.join(callerDir, 'complete_trade_history.csv');
  
  if (!fs.existsSync(tradeHistoryPath)) {
    return [];
  }
  
  const csv = fs.readFileSync(tradeHistoryPath, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  return records.map(r => {
    const tokenAddress = (r.TokenAddress || r.tokenAddress || '').toLowerCase();
    const chain = chainMap.get(tokenAddress) || 'solana'; // Default to solana
    
    return {
      caller: callerName,
      tokenAddress,
      alertTime: r.AlertTime,
      entryTime: r.EntryTime,
      exitTime: r.ExitTime,
      pnl: parseFloat(r.PnL),
      pnlPercent: parseFloat(r.PnLPercent),
      weight: 0, // Will set from caller weights
      chain,
    };
  });
}

function computeMaxDrawdown(equity: number[]) {
  if (equity.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPct: 0 };
  }

  let peak = equity[0];
  let maxDrawdown = 0;

  for (const v of equity) {
    if (v > peak) peak = v;
    const drawdown = peak - v;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
  return { maxDrawdown, maxDrawdownPct };
}

function computeStdDev(values: number[]) {
  const n = values.length;
  if (n <= 1) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / (n - 1);

  return Math.sqrt(variance);
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 WEIGHTED PORTFOLIO PERFORMANCE CALCULATOR - SOLANA ONLY');
  console.log('='.repeat(80));
  console.log('\nUsing weighted caller allocations with weekly reinvestment\n');
  
  // Load chain mapping
  console.log('📂 Loading chain mapping...');
  const chainMap = await loadChainMapping();
  
  // Get caller weights
  console.log('📂 Loading caller weights...');
  const callerWeights = getCallerWeights();
  console.log(`   Found ${callerWeights.length} eligible callers\n`);
  
  if (callerWeights.length === 0) {
    console.error('❌ No eligible callers found!');
    return;
  }
  
  // Display weights
  console.log('📊 CALLER ALLOCATIONS:');
  for (const cw of callerWeights) {
    console.log(`   ${cw.caller}: ${(cw.weight * 100).toFixed(2)}% (${cw.totalTrades} trades)`);
  }
  console.log('');
  
  // Load all trades from all callers
  console.log('📂 Loading trade histories...');
  const allTrades: Trade[] = [];
  
  for (const cw of callerWeights) {
    const trades = await loadCallerTrades(cw.caller, chainMap);
    // Assign weight to each trade
    trades.forEach(t => {
      t.weight = cw.weight;
      allTrades.push(t);
    });
    console.log(`   Loaded ${trades.length} trades from ${cw.caller}`);
  }
  
  console.log(`\n   Total trades (all chains): ${allTrades.length}`);
  
  // Filter to Solana only
  const solanaTrades = allTrades.filter(t => t.chain === 'solana');
  console.log(`   Solana-only trades: ${solanaTrades.length}`);
  console.log(`   Filtered out: ${allTrades.length - solanaTrades.length} non-Solana trades\n`);
  
  if (solanaTrades.length === 0) {
    console.error('❌ No Solana trades found!');
    return;
  }
  
  // Sort trades by alert time
  const sortedTrades = solanaTrades.sort((a, b) => 
    DateTime.fromISO(a.alertTime).toMillis() - DateTime.fromISO(b.alertTime).toMillis()
  );
  
  // Weekly reinvestment strategy
  const initialPortfolio = 100;
  const globalRiskBudget = 0.02; // 2% of portfolio per composite trade
  const stopLossPercent = 0.2; // 20% stop loss
  const positionSizePercent = globalRiskBudget / stopLossPercent; // 10% of portfolio per trade
  
  let portfolio = initialPortfolio;
  const portfolioHistory: number[] = [initialPortfolio];
  const portfolioSnapshots: PortfolioSnapshot[] = [
    {
      week: 'start',
      date: DateTime.fromISO(sortedTrades[0]?.alertTime || ''),
      portfolioValue: initialPortfolio,
      tradesThisWeek: 0,
      weeklyReturn: 0,
    }
  ];
  
  // Group trades by week
  const tradesByWeek = new Map<string, Trade[]>();
  
  for (const trade of sortedTrades) {
    const tradeDate = DateTime.fromISO(trade.alertTime);
    if (!tradeDate.isValid) continue;
    
    const weekStart = tradeDate.startOf('week');
    const weekKey = weekStart.toISODate() || '';
    
    if (!tradesByWeek.has(weekKey)) {
      tradesByWeek.set(weekKey, []);
    }
    tradesByWeek.get(weekKey)!.push(trade);
  }
  
  const sortedWeeks = Array.from(tradesByWeek.entries()).sort((a, b) => 
    DateTime.fromISO(a[0]).toMillis() - DateTime.fromISO(b[0]).toMillis()
  );
  
  // Process week by week with weighted position sizing
  let totalTradesProcessed = 0;
  
  for (const [weekKey, weekTrades] of sortedWeeks) {
    const weekStart = DateTime.fromISO(weekKey);
    const portfolioAtWeekStart = portfolio;
    
    // Rebalance position sizes weekly based on current portfolio
    // Each caller gets: portfolio * caller_weight * positionSizePercent
    for (const trade of weekTrades) {
      const callerWeight = trade.weight;
      const callerPositionSize = portfolio * callerWeight * positionSizePercent;
      
      // Calculate trade return
      const tradeReturn = (trade.pnl - 1.0) * callerPositionSize;
      portfolio = portfolio + tradeReturn;
      portfolioHistory.push(portfolio);
      totalTradesProcessed++;
    }
    
    const portfolioAtWeekEnd = portfolio;
    const weeklyReturn = portfolioAtWeekStart > 0 
      ? ((portfolioAtWeekEnd - portfolioAtWeekStart) / portfolioAtWeekStart) * 100 
      : 0;
    
    portfolioSnapshots.push({
      week: weekKey,
      date: weekStart,
      portfolioValue: portfolioAtWeekEnd,
      tradesThisWeek: weekTrades.length,
      weeklyReturn,
    });
  }
  
  const finalPortfolio = portfolio;
  const compoundFactor = finalPortfolio / initialPortfolio;
  
  // Calculate risk metrics
  const { maxDrawdown, maxDrawdownPct } = computeMaxDrawdown(portfolioHistory);
  
  // Calculate weekly returns for volatility
  const weeklyReturns = portfolioSnapshots
    .slice(1)
    .map(s => s.weeklyReturn / 100);
  const stdDevWeeklyReturns = computeStdDev(weeklyReturns) * 100;
  
  // Calculate TWR
  const firstTradeDate = DateTime.fromISO(sortedTrades[0]?.alertTime || '');
  const lastTradeDate = DateTime.fromISO(sortedTrades[sortedTrades.length - 1]?.alertTime || '');
  const daysActive = lastTradeDate.diff(firstTradeDate, 'days').days || 1;
  
  const twrDailyPct = (Math.pow(compoundFactor, 1 / daysActive) - 1) * 100;
  const twrWeeklyPct = (Math.pow(compoundFactor, 7 / daysActive) - 1) * 100;
  const twrAnnualPct = (Math.pow(compoundFactor, 365 / daysActive) - 1) * 100;
  
  // Calculate without reinvestment (fixed position sizes)
  let simplePortfolio = initialPortfolio;
  const fixedPositionSize = initialPortfolio * positionSizePercent; // Base $10
  
  for (const trade of sortedTrades) {
    const callerPositionSize = fixedPositionSize * trade.weight;
    const tradeReturn = (trade.pnl - 1.0) * callerPositionSize;
    simplePortfolio = simplePortfolio + tradeReturn;
  }
  
  const simpleReturn = ((simplePortfolio / initialPortfolio) - 1) * 100;
  const reinvestmentBenefit = finalPortfolio - simplePortfolio;
  const reinvestmentBenefitPercent = ((finalPortfolio / simplePortfolio) - 1) * 100;
  
  // Display results
  console.log('='.repeat(80));
  console.log('📊 WEIGHTED PORTFOLIO PERFORMANCE - SOLANA ONLY');
  console.log('='.repeat(80));
  console.log(`\n📈 PORTFOLIO STATISTICS:`);
  console.log(`   Initial Portfolio: $${initialPortfolio.toFixed(2)}`);
  console.log(`   Final Portfolio: $${finalPortfolio.toFixed(2)}`);
  console.log(`   Total Growth: ${compoundFactor.toFixed(4)}x`);
  console.log(`   Total Return: ${((compoundFactor - 1) * 100).toFixed(2)}%`);
  console.log(`   Profit: $${(finalPortfolio - initialPortfolio).toFixed(2)}`);
  
  console.log(`\n📊 TRADE STATISTICS:`);
  console.log(`   Total Trades: ${totalTradesProcessed}`);
  console.log(`   Active Days: ${daysActive.toFixed(1)}`);
  console.log(`   Number of Weeks: ${sortedWeeks.length}`);
  console.log(`   Average Trades per Week: ${(totalTradesProcessed / sortedWeeks.length).toFixed(1)}`);
  
  console.log(`\n⏱ TIME-WEIGHTED RETURNS:`);
  console.log(`   Daily TWR: ${twrDailyPct >= 0 ? '+' : ''}${twrDailyPct.toFixed(2)}%`);
  console.log(`   Weekly TWR: ${twrWeeklyPct >= 0 ? '+' : ''}${twrWeeklyPct.toFixed(2)}%`);
  console.log(`   Annualized TWR: ${twrAnnualPct >= 0 ? '+' : ''}${twrAnnualPct.toFixed(2)}%`);
  
  console.log(`\n📉 RISK METRICS:`);
  console.log(`   Max Drawdown: $${maxDrawdown.toFixed(2)} (${maxDrawdownPct.toFixed(2)}%)`);
  console.log(`   Peak Portfolio: $${Math.max(...portfolioHistory).toFixed(2)}`);
  console.log(`   Std Dev of Weekly Returns: ${stdDevWeeklyReturns.toFixed(2)}%`);
  
  const riskAdjustedScore = stdDevWeeklyReturns > 0 ? twrDailyPct / stdDevWeeklyReturns : 0;
  console.log(`   Risk-Adjusted Score: ${riskAdjustedScore.toFixed(2)}`);
  
  console.log(`\n💰 REINVESTMENT COMPARISON:`);
  console.log(`   With Reinvestment: $${finalPortfolio.toFixed(2)} (${compoundFactor.toFixed(4)}x)`);
  console.log(`   Without Reinvestment: $${simplePortfolio.toFixed(2)} (${((simplePortfolio / initialPortfolio) - 1) * 100 >= 0 ? '+' : ''}${simpleReturn.toFixed(2)}%)`);
  console.log(`   Reinvestment Benefit: $${reinvestmentBenefit.toFixed(2)} (${reinvestmentBenefitPercent >= 0 ? '+' : ''}${reinvestmentBenefitPercent.toFixed(2)}%)`);
  
  // Save results
  const outputPath = path.join(OUTPUT_DIR, 'weighted_portfolio_performance_solana_only.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    chain: 'solana',
    initialPortfolio,
    finalPortfolio,
    compoundFactor,
    totalReturn: (compoundFactor - 1) * 100,
    totalTrades: totalTradesProcessed,
    daysActive,
    numberOfWeeks: sortedWeeks.length,
    twrDailyPct,
    twrWeeklyPct,
    twrAnnualPct,
    maxDrawdown,
    maxDrawdownPct,
    peakPortfolio: Math.max(...portfolioHistory),
    stdDevWeeklyReturns,
    riskAdjustedScore,
    simplePortfolio,
    simpleReturn,
    reinvestmentBenefit,
    reinvestmentBenefitPercent,
    callerWeights: callerWeights.map(cw => ({
      caller: cw.caller,
      weight: cw.weight,
      weightPercent: cw.weight * 100,
    })),
    tradesFiltered: {
      totalTrades: allTrades.length,
      solanaTrades: solanaTrades.length,
      nonSolanaTrades: allTrades.length - solanaTrades.length,
    },
  }, null, 2));
  
  // Save portfolio history
  const historyPath = path.join(OUTPUT_DIR, 'weighted_portfolio_history_solana_only.csv');
  const historyRows = portfolioSnapshots.map(s => ({
    Week: s.week,
    Date: s.date.toISODate() || '',
    PortfolioValue: s.portfolioValue.toFixed(2),
    TradesThisWeek: s.tradesThisWeek,
    WeeklyReturn: s.weeklyReturn.toFixed(2),
  }));
  
  await new Promise<void>((resolve, reject) => {
    stringify(historyRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(historyPath, output);
        resolve();
      }
    });
  });
  
  console.log(`\n✅ Results saved:`);
  console.log(`   Performance: ${outputPath}`);
  console.log(`   History: ${historyPath}`);
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);

