#!/usr/bin/env ts-node
/**
 * Calculate Position Sizing Based on Risk-Adjusted Performance
 * Filters callers and assigns weights based on TWR, volatility, drawdown, and sample size
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';

const INPUT_DIR = path.join(__dirname, '../data/exports/tenkan-kijun-remaining-period-by-caller');
const OUTPUT_FILE = path.join(__dirname, '../data/exports/tenkan-kijun-remaining-period-by-caller/position_sizing_recommendations.csv');

interface CallerSummary {
  caller: string;
  totalTrades: number;
  daysActive: number;
  twrDailyPct: number;
  maxDrawdownPct: number;
  stdDevReturnsPct: number;
  riskAdjustedScore: number;
  avgPerTradeMaxDrawdown: number;
  avgRiskRatio: number;
  finalPortfolio: number;
  compoundFactor: number;
}

interface PositionSizingResult {
  caller: string;
  passedFilters: boolean;
  filterReasons: string[];
  rawScore: number;
  effectiveScore: number;
  weight: number;
  positionSizePercent: number;
  maxPositionSizeDollars: number;
  // Original metrics
  totalTrades: number;
  daysActive: number;
  twrDailyPct: number;
  maxDrawdownPct: number;
  stdDevReturnsPct: number;
  riskAdjustedScore: number;
}

// Filtering thresholds
const MIN_TRADES = 50;
const MIN_DAYS_ACTIVE = 30;
const MIN_DAILY_TWR = 0; // Must be positive
const MAX_DRAWDOWN_PCT = 40; // Max acceptable drawdown

// Sample size weighting
const TARGET_TRADES = 100;
const TARGET_DAYS = 90;

// Global risk budget (2% of portfolio per composite trade)
const GLOBAL_RISK_BUDGET_PCT = 2.0;
const ASSUMED_PORTFOLIO = 10000; // Example portfolio size for dollar calculations

function loadCallerSummaries(): CallerSummary[] {
  const summaries: CallerSummary[] = [];
  
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Input directory not found: ${INPUT_DIR}`);
    return summaries;
  }
  
  const callerDirs = fs.readdirSync(INPUT_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const callerDir of callerDirs) {
    const summaryPath = path.join(INPUT_DIR, callerDir, 'summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        summaries.push({
          caller: data.caller || callerDir,
          totalTrades: data.totalTrades || 0,
          daysActive: data.daysActive || 0,
          twrDailyPct: data.twrDailyPct || 0,
          maxDrawdownPct: data.maxDrawdownPct || 0,
          stdDevReturnsPct: data.stdDevReturnsPct || 0,
          riskAdjustedScore: data.riskAdjustedScore || 0,
          avgPerTradeMaxDrawdown: data.avgPerTradeMaxDrawdown || 0,
          avgRiskRatio: data.avgRiskRatio || 0,
          finalPortfolio: data.finalPortfolio || 0,
          compoundFactor: data.compoundFactor || 0,
        });
      } catch (error) {
        console.warn(`⚠️  Failed to load ${summaryPath}: ${error}`);
      }
    }
  }
  
  return summaries;
}

function filterCaller(summary: CallerSummary): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  
  if (summary.totalTrades < MIN_TRADES) {
    reasons.push(`Trades < ${MIN_TRADES} (${summary.totalTrades})`);
  }
  
  if (summary.daysActive < MIN_DAYS_ACTIVE) {
    reasons.push(`Days < ${MIN_DAYS_ACTIVE} (${summary.daysActive.toFixed(1)})`);
  }
  
  if (summary.twrDailyPct <= MIN_DAILY_TWR) {
    reasons.push(`Daily TWR <= ${MIN_DAILY_TWR}% (${summary.twrDailyPct.toFixed(2)}%)`);
  }
  
  if (summary.maxDrawdownPct >= MAX_DRAWDOWN_PCT) {
    reasons.push(`Max DD >= ${MAX_DRAWDOWN_PCT}% (${summary.maxDrawdownPct.toFixed(2)}%)`);
  }
  
  return {
    passed: reasons.length === 0,
    reasons,
  };
}

function calculateEffectiveScore(summary: CallerSummary): number {
  // Base risk-adjusted score
  const rawScore = Math.max(0, summary.riskAdjustedScore);
  
  // Sample size weighting
  const tradesWeight = Math.min(1, summary.totalTrades / TARGET_TRADES);
  const daysWeight = Math.min(1, summary.daysActive / TARGET_DAYS);
  const sampleSizeWeight = (tradesWeight + daysWeight) / 2;
  
  // Effective score = raw score * sample size weight
  const effectiveScore = rawScore * sampleSizeWeight;
  
  return effectiveScore;
}

function calculatePositionSizing(summaries: CallerSummary[]): PositionSizingResult[] {
  const results: PositionSizingResult[] = [];
  
  // Step 1: Filter and calculate effective scores
  const filteredSummaries = summaries.map(summary => {
    const filterResult = filterCaller(summary);
    const effectiveScore = filterResult.passed ? calculateEffectiveScore(summary) : 0;
    
    results.push({
      caller: summary.caller,
      passedFilters: filterResult.passed,
      filterReasons: filterResult.reasons,
      rawScore: summary.riskAdjustedScore,
      effectiveScore,
      weight: 0, // Will calculate after
      positionSizePercent: 0,
      maxPositionSizeDollars: 0,
      totalTrades: summary.totalTrades,
      daysActive: summary.daysActive,
      twrDailyPct: summary.twrDailyPct,
      maxDrawdownPct: summary.maxDrawdownPct,
      stdDevReturnsPct: summary.stdDevReturnsPct,
      riskAdjustedScore: summary.riskAdjustedScore,
    });
    
    return { summary, effectiveScore, passed: filterResult.passed };
  });
  
  // Step 2: Calculate weights (only for callers that passed filters)
  const passedCallers = filteredSummaries.filter(f => f.passed);
  const totalEffectiveScore = passedCallers.reduce((sum, f) => sum + f.effectiveScore, 0);
  
  if (totalEffectiveScore > 0) {
    // Calculate weights
    for (const passed of passedCallers) {
      const result = results.find(r => r.caller === passed.summary.caller);
      if (result) {
        result.weight = passed.effectiveScore / totalEffectiveScore;
        result.positionSizePercent = result.weight * GLOBAL_RISK_BUDGET_PCT;
        result.maxPositionSizeDollars = (result.positionSizePercent / 100) * ASSUMED_PORTFOLIO;
      }
    }
  }
  
  // Sort by effective score (descending)
  results.sort((a, b) => b.effectiveScore - a.effectiveScore);
  
  return results;
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 POSITION SIZING CALCULATOR');
  console.log('='.repeat(80));
  console.log(`\nFiltering Criteria:`);
  console.log(`   Min Trades: ${MIN_TRADES}`);
  console.log(`   Min Days Active: ${MIN_DAYS_ACTIVE}`);
  console.log(`   Min Daily TWR: ${MIN_DAILY_TWR}%`);
  console.log(`   Max Drawdown: ${MAX_DRAWDOWN_PCT}%`);
  console.log(`\nGlobal Risk Budget: ${GLOBAL_RISK_BUDGET_PCT}% per composite trade`);
  console.log(`Assumed Portfolio: $${ASSUMED_PORTFOLIO.toLocaleString()}\n`);
  
  // Load summaries
  console.log('📂 Loading caller summaries...');
  const summaries = loadCallerSummaries();
  console.log(`   Loaded ${summaries.length} callers\n`);
  
  if (summaries.length === 0) {
    console.error('❌ No caller summaries found!');
    return;
  }
  
  // Calculate position sizing
  console.log('🔢 Calculating position sizing...');
  const results = calculatePositionSizing(summaries);
  
  const passedCount = results.filter(r => r.passedFilters).length;
  const failedCount = results.length - passedCount;
  
  console.log(`   ✅ Passed filters: ${passedCount}`);
  console.log(`   ❌ Failed filters: ${failedCount}\n`);
  
  // Display results
  console.log('='.repeat(120));
  console.log('POSITION SIZING RECOMMENDATIONS');
  console.log('='.repeat(120));
  console.log('\n#    Caller                              Status   Score    Weight   Position %   Max $        Trades   Days     TWR%      DD%');
  console.log('-'.repeat(120));
  
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const status = r.passedFilters ? '✅' : '❌';
    const caller = r.caller.length > 33 ? r.caller.substring(0, 30) + '...' : r.caller;
    
    const num = (i + 1).toString().padEnd(4);
    const callerPadded = caller.padEnd(33);
    const statusPadded = status.padEnd(8);
    const scorePadded = r.effectiveScore.toFixed(2).padStart(8);
    const weightPadded = r.weight.toFixed(4).padStart(8);
    const posPctPadded = r.positionSizePercent.toFixed(2).padStart(12);
    const maxDollarPadded = r.maxPositionSizeDollars.toFixed(2).padStart(12);
    const tradesPadded = r.totalTrades.toString().padStart(8);
    const daysPadded = r.daysActive.toFixed(1).padStart(8);
    const twrPadded = r.twrDailyPct.toFixed(2).padStart(10);
    const ddPadded = r.maxDrawdownPct.toFixed(2).padStart(8);
    
    console.log(`${num} ${callerPadded} ${statusPadded} ${scorePadded} ${weightPadded} ${posPctPadded} ${maxDollarPadded} ${tradesPadded} ${daysPadded} ${twrPadded} ${ddPadded}`);
    
    if (!r.passedFilters && i < 10) {
      console.log(`     Reasons: ${r.filterReasons.join(', ')}`);
    }
  }
  
  // Summary statistics
  const passedResults = results.filter(r => r.passedFilters);
  const totalWeight = passedResults.reduce((sum, r) => sum + r.weight, 0);
  const totalPositionPercent = passedResults.reduce((sum, r) => sum + r.positionSizePercent, 0);
  
  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));
  console.log(`\nCallers that passed filters: ${passedCount}`);
  console.log(`Total weight allocated: ${(totalWeight * 100).toFixed(2)}%`);
  console.log(`Total position size: ${totalPositionPercent.toFixed(2)}% of portfolio`);
  console.log(`Remaining buffer: ${(GLOBAL_RISK_BUDGET_PCT - totalPositionPercent).toFixed(2)}%`);
  
  // Top allocations
  console.log(`\n🏆 TOP 5 ALLOCATIONS:`);
  for (let i = 0; i < Math.min(5, passedResults.length); i++) {
    const r = passedResults[i];
    console.log(`   ${i + 1}. ${r.caller}: ${r.positionSizePercent.toFixed(2)}% ($${r.maxPositionSizeDollars.toFixed(2)}) - Score: ${r.effectiveScore.toFixed(2)}`);
  }
  
  // Save to CSV
  const csvRows = results.map(r => ({
    Caller: r.caller,
    PassedFilters: r.passedFilters ? 'Yes' : 'No',
    FilterReasons: r.filterReasons.join('; '),
    RawScore: r.rawScore.toFixed(4),
    EffectiveScore: r.effectiveScore.toFixed(4),
    Weight: r.weight.toFixed(6),
    PositionSizePercent: r.positionSizePercent.toFixed(4),
    MaxPositionSizeDollars: r.maxPositionSizeDollars.toFixed(2),
    TotalTrades: r.totalTrades,
    DaysActive: r.daysActive.toFixed(1),
    DailyTWRPercent: r.twrDailyPct.toFixed(2),
    MaxDrawdownPercent: r.maxDrawdownPct.toFixed(2),
    StdDevReturnsPercent: r.stdDevReturnsPct.toFixed(2),
    RiskAdjustedScore: r.riskAdjustedScore.toFixed(4),
  }));
  
  await new Promise<void>((resolve, reject) => {
    stringify(csvRows, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(OUTPUT_FILE, output);
        resolve();
      }
    });
  });
  
  console.log(`\n✅ Results saved to: ${OUTPUT_FILE}`);
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);

