/**
 * Metrics Calculator
 * ===================
 * Calculates aggregated metrics from a single simulation result.
 *
 * @deprecated This has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/storage/metrics-calculator instead.
 * This file will be removed in a future version.
 */

import type { SimulationResult, SimulationEvent } from '../types';

/**
 * Calculate metrics from a single simulation result
 */
export function calculateResultMetrics(result: SimulationResult): {
  finalPnl: number;
  maxDrawdown?: number;
  volatility?: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  winRate?: number;
  tradeCount: number;
  avgTradeReturn?: number;
  medianTradeReturn?: number;
  reentryCount: number;
  ladderEntriesUsed: number;
  ladderExitsUsed: number;
  averageHoldingMinutes?: number;
  maxHoldingMinutes?: number;
} {
  const events = result.events;

  // Basic counts
  const entryEvents = events.filter(
    (e) => e.type === 'entry' || e.type === 'trailing_entry_triggered' || e.type === 're_entry'
  );
  const exitEvents = events.filter(
    (e) => e.type === 'target_hit' || e.type === 'stop_loss' || e.type === 'final_exit'
  );
  const reentryCount = events.filter((e) => e.type === 're_entry').length;
  const ladderEntriesUsed = events.filter((e) => e.type === 'ladder_entry').length;
  const ladderExitsUsed = events.filter((e) => e.type === 'ladder_exit').length;

  const tradeCount = Math.max(entryEvents.length, exitEvents.length);

  // Calculate win rate from exit events
  const winningExits = exitEvents.filter((e) => e.pnlSoFar > 0);
  const winRate = exitEvents.length > 0 ? winningExits.length / exitEvents.length : undefined;

  // Calculate holding duration
  let totalHoldingMinutes = 0;
  let maxHoldingMinutes = 0;
  let holdingCount = 0;

  if (events.length >= 2) {
    const firstEntry = events.find(
      (e) => e.type === 'entry' || e.type === 'trailing_entry_triggered'
    );
    const lastExit = events[events.length - 1];

    if (firstEntry && lastExit) {
      const duration = (lastExit.timestamp - firstEntry.timestamp) / 60;
      totalHoldingMinutes = duration;
      maxHoldingMinutes = duration;
      holdingCount = 1;
    }
  }

  const averageHoldingMinutes = holdingCount > 0 ? totalHoldingMinutes / holdingCount : undefined;

  // Calculate returns from events
  const returns: number[] = [];
  let lastEntryPrice = result.entryPrice;

  for (const event of events) {
    if (
      event.type === 'entry' ||
      event.type === 'trailing_entry_triggered' ||
      event.type === 're_entry'
    ) {
      lastEntryPrice = event.price;
    } else if (
      event.type === 'target_hit' ||
      event.type === 'stop_loss' ||
      event.type === 'final_exit'
    ) {
      if (lastEntryPrice > 0) {
        const returnPct = event.price / lastEntryPrice - 1;
        returns.push(returnPct);
      }
    }
  }

  // If no explicit returns, use final PnL
  if (returns.length === 0 && result.finalPnl !== undefined) {
    returns.push(result.finalPnl - 1);
  }

  const avgTradeReturn =
    returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : undefined;

  const sortedReturns = [...returns].sort((a, b) => a - b);
  const medianTradeReturn =
    sortedReturns.length > 0 ? sortedReturns[Math.floor(sortedReturns.length / 2)] : undefined;

  // Calculate volatility (standard deviation of returns)
  let volatility: number | undefined;
  if (returns.length > 1) {
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    volatility = Math.sqrt(variance);
  }

  // Calculate Sharpe ratio (simplified - assumes risk-free rate = 0)
  let sharpeRatio: number | undefined;
  if (volatility !== undefined && volatility > 0 && avgTradeReturn !== undefined) {
    sharpeRatio = avgTradeReturn / volatility;
  }

  // Calculate Sortino ratio (downside deviation only)
  let sortinoRatio: number | undefined;
  if (returns.length > 1 && avgTradeReturn !== undefined) {
    const negativeReturns = returns.filter((r) => r < 0);
    if (negativeReturns.length > 0) {
      const mean = negativeReturns.reduce((sum, r) => sum + r, 0) / negativeReturns.length;
      const downsideVariance =
        negativeReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / negativeReturns.length;
      const downsideDev = Math.sqrt(downsideVariance);
      if (downsideDev > 0) {
        sortinoRatio = avgTradeReturn / downsideDev;
      }
    }
  }

  // Calculate max drawdown
  let maxDrawdown: number | undefined;
  if (events.length > 0) {
    let peak = result.entryPrice;
    let maxDD = 0;

    for (const event of events) {
      if (event.price > peak) {
        peak = event.price;
      }
      const drawdown = (peak - event.price) / peak;
      if (drawdown > maxDD) {
        maxDD = drawdown;
      }
    }

    maxDrawdown = maxDD;
  }

  return {
    finalPnl: result.finalPnl,
    maxDrawdown,
    volatility,
    sharpeRatio,
    sortinoRatio,
    winRate,
    tradeCount,
    avgTradeReturn,
    medianTradeReturn,
    reentryCount,
    ladderEntriesUsed,
    ladderExitsUsed,
    averageHoldingMinutes,
    maxHoldingMinutes: maxHoldingMinutes > 0 ? maxHoldingMinutes : undefined,
  };
}
