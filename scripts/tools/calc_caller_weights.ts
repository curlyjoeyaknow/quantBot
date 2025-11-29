#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(
  __dirname,
  '../data/exports/tenkan-kijun-remaining-period-by-caller'
);

// --- TUNABLE PARAMETERS ---

// Minimum robustness to even consider a caller
const MIN_TRADES = 50;
const MIN_DAYS_ACTIVE = 60;
const MAX_DRAWDOWN_PCT = 40; // reject callers with >40% max DD
const REQUIRE_POSITIVE_TWR = true;

// How much to reward sample size (0–1 multipliers)
function sampleSizeFactor(totalTrades: number, daysActive: number): number {
  const tradeFactor = Math.min(1, totalTrades / 100);  // full credit at 100+ trades
  const daysFactor = Math.min(1, daysActive / 90);     // full credit at 90+ days
  return tradeFactor * daysFactor;
}

// Risk-adjusted score: Sharpe-ish: daily TWR / vol, scaled by sample size
function riskAdjustedScore(
  dailyTwrPct: number,
  stdDevReturnsPct: number,
  totalTrades: number,
  daysActive: number
): number {
  if (stdDevReturnsPct <= 0) return 0;
  const base = dailyTwrPct / stdDevReturnsPct;
  const sizeFactor = sampleSizeFactor(totalTrades, daysActive);
  return Math.max(0, base * sizeFactor);
}

// --- MAIN ---

interface CallerSummary {
  caller: string;
  totalTrades: number;
  daysActive: number;
  twrDailyPct: number;
  stdDevReturnsPct: number;
  maxDrawdownPct: number;
  finalPortfolio: number;
}

function loadSummaries(dir: string): CallerSummary[] {
  const callers: CallerSummary[] = [];

  const subdirs = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const name of subdirs) {
    const summaryPath = path.join(dir, name, 'summary.json');
    if (!fs.existsSync(summaryPath)) continue;

    try {
      const raw = fs.readFileSync(summaryPath, 'utf8');
      const json = JSON.parse(raw);

      const caller: CallerSummary = {
        caller: json.caller ?? name,
        totalTrades: json.totalTrades ?? 0,
        daysActive: json.daysActive ?? 0,
        twrDailyPct: json.twrDailyPct ?? 0,
        stdDevReturnsPct: json.stdDevReturnsPct ?? 0,
        maxDrawdownPct: json.maxDrawdownPct ?? 0,
        finalPortfolio: json.finalPortfolio ?? 100,
      };

      callers.push(caller);
    } catch (e) {
      console.error(`Failed to parse ${summaryPath}:`, e);
    }
  }

  return callers;
}

function main() {
  const summaries = loadSummaries(OUTPUT_DIR);

  // Filter to robust + positive edge callers
  const eligible = summaries.filter(s => {
    if (s.totalTrades < MIN_TRADES) return false;
    if (s.daysActive < MIN_DAYS_ACTIVE) return false;
    if (s.maxDrawdownPct > MAX_DRAWDOWN_PCT) return false;
    if (REQUIRE_POSITIVE_TWR && s.twrDailyPct <= 0) return false;
    return true;
  });

  if (eligible.length === 0) {
    console.log('No callers passed the filters.');
    process.exit(0);
  }

  // Compute scores
  const withScores = eligible.map(s => {
    const score = riskAdjustedScore(
      s.twrDailyPct,
      s.stdDevReturnsPct,
      s.totalTrades,
      s.daysActive
    );
    return { ...s, score };
  }).filter(s => s.score > 0);

  if (withScores.length === 0) {
    console.log('All eligible callers ended with zero score after adjustments.');
    process.exit(0);
  }

  const totalScore = withScores.reduce((sum, s) => sum + s.score, 0);

  const ranked = withScores
    .map(s => ({
      ...s,
      weight: s.score / totalScore,
    }))
    .sort((a, b) => b.weight - a.weight);

  console.log('\nCaller weights (normalized to 100% of caller risk budget):\n');
  console.log(
    [
      'Caller'.padEnd(28),
      'Trades'.padStart(6),
      'Days'.padStart(6),
      'DailyTWR%'.padStart(10),
      'StdDev%'.padStart(8),
      'MaxDD%'.padStart(8),
      'Score'.padStart(8),
      'Weight%'.padStart(9),
    ].join('  ')
  );

  for (const r of ranked) {
    console.log(
      [
        r.caller.slice(0, 28).padEnd(28),
        String(r.totalTrades).padStart(6),
        String(r.daysActive.toFixed(0)).padStart(6),
        r.twrDailyPct.toFixed(2).padStart(10),
        r.stdDevReturnsPct.toFixed(2).padStart(8),
        r.maxDrawdownPct.toFixed(2).padStart(8),
        r.score.toFixed(3).padStart(8),
        (r.weight * 100).toFixed(1).padStart(9),
      ].join('  ')
    );
  }

  console.log('\nInterpretation:');
  console.log('- Weight% is the fraction of your *caller risk budget* to allocate.');
  console.log('- If your global risk per trade is, say, 2% of equity, then');
  console.log('  per-caller risk ≈ 2% * Weight%. You can then derive position size per caller.');
}

main();

