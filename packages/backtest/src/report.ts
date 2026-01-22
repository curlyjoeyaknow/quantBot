/**
 * Reporter - Persist and render results
 *
 * Output artifacts:
 * - summary.json
 * - trades.json
 * - replay.ndjson (optional)
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Trade, BacktestEvent, CoverageResult, StrategyV1, BacktestSummary } from './types.js';
import { logger } from '@quantbot/infra/utils';

/**
 * Calculate summary metrics
 */
function calculateSummary(
  trades: Trade[],
  coverage: CoverageResult
): Omit<BacktestSummary, 'runId'> {
  if (trades.length === 0) {
    return {
      callsTested: coverage.eligible.length,
      callsExcluded: coverage.excluded.length,
      totalTrades: 0,
      pnlPct: 0,
      maxDrawdownPct: 0,
      winRate: 0,
      avgReturnPct: 0,
    };
  }

  const winningTrades = trades.filter((t) => t.pnl.netReturnPct > 0);
  const losingTrades = trades.filter((t) => t.pnl.netReturnPct < 0);

  // Calculate cumulative PnL for drawdown
  let cumulativePnl = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    cumulativePnl += trade.pnl.netReturnPct;
    if (cumulativePnl > peak) {
      peak = cumulativePnl;
    }
    const drawdown = peak - cumulativePnl;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl.netReturnPct, 0);
  const avgReturn = totalPnl / trades.length;

  return {
    callsTested: coverage.eligible.length,
    callsExcluded: coverage.excluded.length,
    totalTrades: trades.length,
    pnlPct: totalPnl,
    maxDrawdownPct: maxDrawdown,
    winRate: winningTrades.length / trades.length,
    avgReturnPct: avgReturn,
  };
}

/**
 * Emit report - persist results
 */
export async function emitReport(
  runId: string,
  trades: Trade[],
  events: BacktestEvent[],
  coverage: CoverageResult,
  strategy: StrategyV1
): Promise<BacktestSummary> {
  const artifactsDir = join(process.cwd(), 'artifacts', 'backtest', runId);
  await mkdir(artifactsDir, { recursive: true });

  // Calculate summary
  const summaryData = calculateSummary(trades, coverage);
  const summary: BacktestSummary = {
    runId,
    ...summaryData,
  };

  // Write summary.json
  const summaryPath = join(artifactsDir, 'summary.json');
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));

  // Write trades.json
  const tradesPath = join(artifactsDir, 'trades.json');
  await writeFile(tradesPath, JSON.stringify(trades, null, 2));

  // Write replay.ndjson (optional)
  if (events.length > 0) {
    const replayPath = join(artifactsDir, 'replay.ndjson');
    const replayContent = events.map((e) => JSON.stringify(e)).join('\n');
    await writeFile(replayPath, replayContent);
  }

  logger.info('Report emitted', {
    runId,
    summaryPath,
    tradesPath,
    trades: trades.length,
  });

  // Output to stdout
  console.log('\n=== Coverage Summary ===');
  console.log(`Eligible: ${coverage.eligible.length}`);
  console.log(`Excluded: ${coverage.excluded.length}`);

  // Integrity metrics
  if (coverage.integrity) {
    console.log('\n=== Data Integrity ===');
    console.log(`Status: ${coverage.integrity.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Total Issues: ${coverage.integrity.totalIssues}`);
    console.log(`Critical: ${coverage.integrity.criticalIssues}`);
    console.log(`Warnings: ${coverage.integrity.warningIssues}`);

    if (coverage.integrity.criticalIssues > 0) {
      console.log('\n⚠️  Critical integrity issues detected!');
      console.log('Review integrity issues before using results.');
    }
  }

  console.log('\n=== Run Summary ===');
  console.log(`Total Trades: ${summary.totalTrades}`);
  console.log(`PnL: ${summary.pnlPct.toFixed(2)}%`);
  console.log(`Max Drawdown: ${summary.maxDrawdownPct.toFixed(2)}%`);
  console.log(`Win Rate: ${(summary.winRate * 100).toFixed(2)}%`);
  console.log(`Avg Return: ${summary.avgReturnPct.toFixed(2)}%`);

  console.log('\n=== Artifacts ===');
  console.log(`Summary: ${summaryPath}`);
  console.log(`Trades: ${tradesPath}`);

  return summary;
}
