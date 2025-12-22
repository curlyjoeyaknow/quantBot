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
  const totalReturn = finalPnL;

  // Drawdown metrics
  const drawdowns = pnlSeries.map((p) => p.drawdown);
  const maxDrawdown = Math.max(...drawdowns);
  const avgDrawdown = drawdowns.reduce((sum, d) => sum + d, 0) / drawdowns.length;

  // Hit rate
  const entries = tradeEvents.filter((t) => t.type === 'entry');
  const exits = tradeEvents.filter((t) => t.type === 'exit');
  const successfulExits = exits.filter((t) => !t.failed && t.value > 0);
  const overallHitRate = exits.length > 0 ? successfulExits.length / exits.length : 0;

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

  return {
    return: {
      total: totalReturn,
      perTrade: totalTrades > 0 ? totalReturn / totalTrades : undefined,
    },
    drawdown: {
      max: maxDrawdown,
      average: avgDrawdown,
    },
    hitRate: {
      overall: overallHitRate,
      entries: entries.length > 0 ? successfulExits.length / entries.length : undefined,
      exits: exitCount > 0 ? successfulExits.length / exitCount : undefined,
    },
    trades: {
      total: totalTrades,
      entries: entryCount,
      exits: exitCount,
      reentries: reentryCount > 0 ? reentryCount : undefined,
      failed: failedCount > 0 ? failedCount : undefined,
    },
    tailLoss: {
      worstTrade,
      p5,
      p1,
    },
    feeSensitivity: {
      totalFees,
      feesAsPercentOfReturn,
      averageFeePerTrade,
    },
    latencySensitivity:
      latencies.length > 0
        ? {
            averageLatencyMs,
            p90LatencyMs,
            p99LatencyMs,
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
