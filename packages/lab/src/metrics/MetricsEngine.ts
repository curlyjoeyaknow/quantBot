/**
 * MetricsEngine
 *
 * Computes simulation metrics once, centrally.
 *
 * Metrics:
 * - PnL (total, per-trade)
 * - Max drawdown
 * - Sharpe-like score
 * - Exposure time
 * - Trade count
 * - Win rate
 */

import type { SimulationMetrics, EquityPoint } from './types.js';
import type { SimulationEvent, FillEvent, PositionSnapshot } from '../simulation/types.js';
import { logger } from '@quantbot/infra/utils';

/**
 * MetricsEngine
 */
export class MetricsEngine {
  /**
   * Compute metrics from simulation results
   */
  computeMetrics(args: {
    initialCapital: number;
    finalCapital: number;
    events: SimulationEvent[];
    fills: FillEvent[];
    positions: PositionSnapshot[];
  }): SimulationMetrics {
    const { initialCapital, finalCapital, events, fills, positions } = args;

    // Compute PnL metrics
    const totalPnl = finalCapital - initialCapital;
    const totalPnlPercent = (totalPnl / initialCapital) * 100;

    // Extract trade PnLs
    const tradePnls = this.extractTradePnls(events);
    const winningTrades = tradePnls.filter((p) => p > 0);
    const losingTrades = tradePnls.filter((p) => p < 0);

    const totalTrades = tradePnls.length;
    const winRate = totalTrades > 0 ? winningTrades.length / totalTrades : 0;
    const avgPnlPerTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;
    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((a, b) => a + b, 0) / winningTrades.length
        : 0;
    const avgLoss =
      losingTrades.length > 0 ? losingTrades.reduce((a, b) => a + b, 0) / losingTrades.length : 0;

    const maxPnl = tradePnls.length > 0 ? Math.max(...tradePnls) : 0;
    const minPnl = tradePnls.length > 0 ? Math.min(...tradePnls) : 0;
    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades) : 0;
    const largestLoss = losingTrades.length > 0 ? Math.min(...losingTrades) : 0;

    const totalWins = winningTrades.reduce((a, b) => a + b, 0);
    const totalLosses = Math.abs(losingTrades.reduce((a, b) => a + b, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Compute drawdown
    const equityCurve = this.buildEquityCurve(initialCapital, events);
    const drawdownMetrics = this.computeDrawdown(equityCurve);

    // Compute exposure time
    const exposureMetrics = this.computeExposureTime(fills, positions);

    // Compute Sharpe-like ratio (simplified)
    const sharpeRatio = this.computeSharpeRatio(tradePnls);

    // Compute consecutive wins/losses
    const consecutiveMetrics = this.computeConsecutive(tradePnls);

    return {
      totalPnl,
      totalPnlPercent,
      avgPnlPerTrade,
      maxPnl,
      minPnl,
      maxDrawdown: drawdownMetrics.maxDrawdown,
      maxDrawdownPercent: drawdownMetrics.maxDrawdownPercent,
      maxDrawdownDuration: drawdownMetrics.maxDrawdownDuration,
      sharpeRatio,
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor: profitFactor === Infinity ? undefined : profitFactor,
      totalExposureTime: exposureMetrics.totalExposureTime,
      avgHoldTime: exposureMetrics.avgHoldTime,
      maxHoldTime: exposureMetrics.maxHoldTime,
      largestWin,
      largestLoss,
      consecutiveWins: consecutiveMetrics.consecutiveWins,
      consecutiveLosses: consecutiveMetrics.consecutiveLosses,
    };
  }

  /**
   * Extract PnL per trade from events
   */
  private extractTradePnls(events: SimulationEvent[]): number[] {
    const pnls: number[] = [];
    for (const event of events) {
      if (
        event.type === 'exit' ||
        event.type === 'stop_loss' ||
        event.type === 'take_profit' ||
        event.type === 'max_hold' ||
        event.type === 'trailing_stop' ||
        event.type === 'final_exit'
      ) {
        if (event.pnl !== undefined) {
          pnls.push(event.pnl);
        }
      }
    }
    return pnls;
  }

  /**
   * Build equity curve from events
   */
  private buildEquityCurve(initialCapital: number, events: SimulationEvent[]): EquityPoint[] {
    const curve: EquityPoint[] = [];
    let currentCapital = initialCapital;

    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => a.ts - b.ts);

    for (const event of sortedEvents) {
      if (event.pnlSoFar !== undefined) {
        currentCapital = initialCapital + event.pnlSoFar;
        curve.push({
          ts: event.ts,
          capital: currentCapital,
          pnl: event.pnlSoFar,
          pnlPercent: (event.pnlSoFar / initialCapital) * 100,
        });
      }
    }

    return curve;
  }

  /**
   * Compute drawdown metrics
   */
  private computeDrawdown(curve: EquityPoint[]): {
    maxDrawdown: number;
    maxDrawdownPercent: number;
    maxDrawdownDuration: number;
  } {
    if (curve.length === 0) {
      return { maxDrawdown: 0, maxDrawdownPercent: 0, maxDrawdownDuration: 0 };
    }

    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let maxDrawdownDuration = 0;
    let peak = curve[0]!.capital;
    let peakTs = curve[0]!.ts;
    let drawdownStartTs: number | undefined;

    for (const point of curve) {
      if (point.capital > peak) {
        peak = point.capital;
        peakTs = point.ts;
        drawdownStartTs = undefined;
      }

      const drawdown = peak - point.capital;
      const drawdownPercent = (drawdown / peak) * 100;

      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = drawdownPercent;
      }

      if (drawdown > 0 && !drawdownStartTs) {
        drawdownStartTs = point.ts;
      }

      if (drawdown === 0 && drawdownStartTs) {
        const duration = point.ts - drawdownStartTs;
        if (duration > maxDrawdownDuration) {
          maxDrawdownDuration = duration;
        }
        drawdownStartTs = undefined;
      }
    }

    // Check if drawdown is still ongoing
    if (drawdownStartTs && curve.length > 0) {
      const duration = curve[curve.length - 1]!.ts - drawdownStartTs;
      if (duration > maxDrawdownDuration) {
        maxDrawdownDuration = duration;
      }
    }

    return { maxDrawdown, maxDrawdownPercent, maxDrawdownDuration };
  }

  /**
   * Compute exposure time metrics
   */
  private computeExposureTime(
    fills: FillEvent[],
    positions: PositionSnapshot[]
  ): {
    totalExposureTime: number;
    avgHoldTime: number;
    maxHoldTime: number;
  } {
    // Group fills by trade (buy-sell pairs)
    const trades: Array<{ entryTs: number; exitTs: number }> = [];
    const buyFills = fills.filter((f) => f.side === 'buy');
    const sellFills = fills.filter((f) => f.side === 'sell');

    // Match buys with sells by token and order
    const buyMap = new Map<string, FillEvent[]>();
    for (const fill of buyFills) {
      if (!buyMap.has(fill.tokenId)) {
        buyMap.set(fill.tokenId, []);
      }
      buyMap.get(fill.tokenId)!.push(fill);
    }

    const sellMap = new Map<string, FillEvent[]>();
    for (const fill of sellFills) {
      if (!sellMap.has(fill.tokenId)) {
        sellMap.set(fill.tokenId, []);
      }
      sellMap.get(fill.tokenId)!.push(fill);
    }

    // Match trades
    for (const [tokenId, buys] of buyMap.entries()) {
      const sells = sellMap.get(tokenId) || [];
      for (let i = 0; i < Math.min(buys.length, sells.length); i++) {
        trades.push({
          entryTs: buys[i]!.ts,
          exitTs: sells[i]!.ts,
        });
      }
    }

    // Add open positions (use current ts as exit)
    for (const position of positions) {
      trades.push({
        entryTs: position.entryTs,
        exitTs: position.ts, // Current time
      });
    }

    if (trades.length === 0) {
      return { totalExposureTime: 0, avgHoldTime: 0, maxHoldTime: 0 };
    }

    const holdTimes = trades.map((t) => t.exitTs - t.entryTs);
    const totalExposureTime = holdTimes.reduce((a, b) => a + b, 0);
    const avgHoldTime = totalExposureTime / trades.length;
    const maxHoldTime = Math.max(...holdTimes);

    return { totalExposureTime, avgHoldTime, maxHoldTime };
  }

  /**
   * Compute Sharpe-like ratio (simplified)
   */
  private computeSharpeRatio(tradePnls: number[]): number | undefined {
    if (tradePnls.length < 2) {
      return undefined;
    }

    const mean = tradePnls.reduce((a, b) => a + b, 0) / tradePnls.length;
    const variance =
      tradePnls.reduce((sum, pnl) => sum + Math.pow(pnl - mean, 2), 0) / tradePnls.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) {
      return undefined;
    }

    // Simplified Sharpe: mean return / std dev
    // Assumes risk-free rate is 0
    return mean / stdDev;
  }

  /**
   * Compute consecutive wins/losses
   */
  private computeConsecutive(tradePnls: number[]): {
    consecutiveWins: number;
    consecutiveLosses: number;
  } {
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const pnl of tradePnls) {
      if (pnl > 0) {
        currentWins++;
        currentLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
      } else if (pnl < 0) {
        currentLosses++;
        currentWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
      } else {
        // Break even - reset both
        currentWins = 0;
        currentLosses = 0;
      }
    }

    return {
      consecutiveWins: maxConsecutiveWins,
      consecutiveLosses: maxConsecutiveLosses,
    };
  }
}
