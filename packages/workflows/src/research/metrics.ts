/**
 * Research OS - Metrics Calculator
 * ==================================
 *
 * Calculates comprehensive metrics from simulation results.
 * All metrics are mandatory and must be present in every run.
 */

import type { TradeEvent, PnLSeries, RunMetrics } from './artifacts.js';

/**
 * Calculate metrics from trade events and PnL series
 */
export function calculateMetrics(tradeEvents: TradeEvent[], pnlSeries: PnLSeries[]): RunMetrics {
  if (tradeEvents.length === 0 || pnlSeries.length === 0) {
    return createEmptyMetrics();
  }

  // Return metrics
  const finalPnL = pnlSeries[pnlSeries.length - 1]!.cumulativePnL;
  // Ensure totalReturn is finite and valid
  const totalReturn = Number.isFinite(finalPnL) ? finalPnL : 1.0;

  // Drawdown metrics
  const drawdowns = pnlSeries.map((p) => p.drawdown).filter((d) => Number.isFinite(d));
  const maxDrawdown = drawdowns.length > 0 ? Math.max(...drawdowns, 0) : 0;
  const avgDrawdown = drawdowns.length > 0 ? drawdowns.reduce((sum, d) => sum + d, 0) / drawdowns.length : 0;

  // Hit rate
  const entries = tradeEvents.filter((t) => t.type === 'entry');
  const exits = tradeEvents.filter((t) => t.type === 'exit');
  const successfulExits = exits.filter((t) => !t.failed && t.value > 0);
  // Ensure hit rate is always between 0 and 1, and finite
  const rawHitRate = exits.length > 0 ? successfulExits.length / exits.length : 0;
  const overallHitRate = Number.isFinite(rawHitRate) ? Math.max(0, Math.min(1, rawHitRate)) : 0;

  // Trade counts
  const totalTrades = tradeEvents.length;
  const entryCount = entries.length;
  const exitCount = exits.length;
  const reentryCount = tradeEvents.filter((t) => t.type === 'reentry').length;
  const failedCount = tradeEvents.filter((t) => t.failed).length;

  // Tail loss
  const exitValues = exits
    .filter((t) => !t.failed)
    .map((t) => {
      // Calculate PnL for this exit
      // This is simplified - in reality, we'd track entry/exit pairs
      return t.value;
    });
  const worstTrade = exitValues.length > 0 ? Math.min(...exitValues) : 0;
  const sortedLosses = [...exitValues].sort((a, b) => a - b);
  const p5Index = Math.floor(sortedLosses.length * 0.05);
  const p1Index = Math.floor(sortedLosses.length * 0.01);
  const p5 = sortedLosses.length > 0 && p5Index >= 0 ? sortedLosses[p5Index] : undefined;
  const p1 = sortedLosses.length > 0 && p1Index >= 0 ? sortedLosses[p1Index] : undefined;

  // Fee sensitivity
  const totalFees = tradeEvents.reduce((sum, t) => sum + t.fees, 0);
  const feesAsPercentOfReturn = totalReturn > 0 ? (totalFees / totalReturn) * 100 : undefined;
  const averageFeePerTrade = totalTrades > 0 ? totalFees / totalTrades : 0;

  // Latency sensitivity
  const latencies = tradeEvents.map((t) => t.latencyMs).filter((l): l is number => l !== undefined);
  const averageLatencyMs =
    latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : 0;
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const p90Index = Math.floor(sortedLatencies.length * 0.9);
  const p99Index = Math.floor(sortedLatencies.length * 0.99);
  const p90LatencyMs =
    sortedLatencies.length > 0 && p90Index >= 0 ? sortedLatencies[p90Index] : undefined;
  const p99LatencyMs =
    sortedLatencies.length > 0 && p99Index >= 0 ? sortedLatencies[p99Index] : undefined;

  // Ensure all required fields are present and valid
  return {
    return: {
      total: Number.isFinite(totalReturn) ? totalReturn : 1.0,
      perTrade: totalTrades > 0 && Number.isFinite(totalReturn) ? totalReturn / totalTrades : undefined,
    },
    drawdown: {
      max: Number.isFinite(maxDrawdown) ? Math.max(0, maxDrawdown) : 0,
      average: Number.isFinite(avgDrawdown) ? Math.max(0, avgDrawdown) : 0,
    },
    hitRate: {
      overall: Number.isFinite(overallHitRate) ? Math.max(0, Math.min(1, overallHitRate)) : 0,
      entries: entries.length > 0 && Number.isFinite(successfulExits.length / entries.length)
        ? Math.max(0, Math.min(1, successfulExits.length / entries.length))
        : undefined,
      exits: exitCount > 0 && Number.isFinite(successfulExits.length / exitCount)
        ? Math.max(0, Math.min(1, successfulExits.length / exitCount))
        : undefined,
    },
    trades: {
      total: Math.max(0, totalTrades),
      entries: Math.max(0, entryCount),
      exits: Math.max(0, exitCount),
      reentries: reentryCount > 0 ? reentryCount : undefined,
      failed: failedCount > 0 ? failedCount : undefined,
    },
    tailLoss: {
      worstTrade: Number.isFinite(worstTrade) ? worstTrade : 0,
      p5: p5 !== undefined && Number.isFinite(p5) ? p5 : undefined,
      p1: p1 !== undefined && Number.isFinite(p1) ? p1 : undefined,
    },
    feeSensitivity: {
      totalFees: Number.isFinite(totalFees) ? Math.max(0, totalFees) : 0,
      feesAsPercentOfReturn: feesAsPercentOfReturn !== undefined && Number.isFinite(feesAsPercentOfReturn)
        ? Math.max(0, feesAsPercentOfReturn)
        : undefined,
      averageFeePerTrade: Number.isFinite(averageFeePerTrade) ? Math.max(0, averageFeePerTrade) : 0,
    },
    latencySensitivity:
      latencies.length > 0
        ? {
            averageLatencyMs: Number.isFinite(averageLatencyMs) ? Math.max(0, averageLatencyMs) : 0,
            p90LatencyMs: p90LatencyMs !== undefined && Number.isFinite(p90LatencyMs) ? Math.max(0, p90LatencyMs) : undefined,
            p99LatencyMs: p99LatencyMs !== undefined && Number.isFinite(p99LatencyMs) ? Math.max(0, p99LatencyMs) : undefined,
          }
        : undefined,
  };
}

/**
 * Create empty metrics (for runs with no trades)
 */
function createEmptyMetrics(): RunMetrics {
  return {
    return: {
      total: 1.0, // No change
    },
    drawdown: {
      max: 0,
    },
    hitRate: {
      overall: 0,
    },
    trades: {
      total: 0,
      entries: 0,
      exits: 0,
    },
    tailLoss: {
      worstTrade: 0,
    },
    feeSensitivity: {
      totalFees: 0,
      averageFeePerTrade: 0,
    },
  };
}

/**
 * Calculate PnL series from trade events
 *
 * This builds a time series of cumulative PnL and drawdown.
 */
export function calculatePnLSeries(
  tradeEvents: TradeEvent[],
  initialCapital: number = 1.0
): PnLSeries[] {
  if (tradeEvents.length === 0) {
    return [
      {
        timestampISO: new Date().toISOString(),
        cumulativePnL: 1.0,
        runningTotal: initialCapital,
        drawdown: 0,
      },
    ];
  }

  // Sort by timestamp
  const sorted = [...tradeEvents].sort(
    (a, b) => new Date(a.timestampISO).getTime() - new Date(b.timestampISO).getTime()
  );

  const series: PnLSeries[] = [];
  let runningTotal = initialCapital;
  let peak = initialCapital;

  for (const trade of sorted) {
    // Update running total (simplified - in reality, we'd track entry/exit pairs)
    if (trade.type === 'exit' && !trade.failed) {
      // Assume exit adds value (simplified)
      runningTotal += trade.value - trade.fees;
    } else if (trade.type === 'entry') {
      // Assume entry costs value
      runningTotal -= trade.value + trade.fees;
    }

    // Update peak
    if (runningTotal > peak) {
      peak = runningTotal;
    }

    // Calculate drawdown
    const drawdown = peak > 0 ? (peak - runningTotal) / peak : 0;

    // Calculate cumulative PnL (as multiplier)
    const cumulativePnL = runningTotal / initialCapital;

    series.push({
      timestampISO: trade.timestampISO,
      cumulativePnL,
      runningTotal,
      drawdown,
    });
  }

  return series;
}
