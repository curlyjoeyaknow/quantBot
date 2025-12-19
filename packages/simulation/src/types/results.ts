/**
 * Simulation Result Types
 * =======================
 * Types for simulation outputs and metrics.
 */

import type { LegacySimulationEvent } from './events.js';

/**
 * Entry optimization details
 */
export interface EntryOptimization {
  /** Lowest price observed */
  lowestPrice: number;
  /** Timestamp of lowest price */
  lowestPriceTimestamp: number;
  /** Lowest price as percent from entry */
  lowestPricePercent: number;
  /** Time from entry to lowest price (minutes) */
  lowestPriceTimeFromEntry: number;
  /** Whether trailing entry was used */
  trailingEntryUsed: boolean;
  /** Actual entry price after optimization */
  actualEntryPrice: number;
  /** Entry delay in minutes */
  entryDelay: number;
}

/**
 * Simulation result (legacy compatible)
 */
export interface SimulationResult {
  /** Final PnL as multiplier (1 = break even) */
  finalPnl: number;
  /** All simulation events */
  events: LegacySimulationEvent[];
  /** Entry price */
  entryPrice: number;
  /** Final/exit price */
  finalPrice: number;
  /** Total candles processed */
  totalCandles: number;
  /** Entry optimization details */
  entryOptimization: EntryOptimization;
}

/**
 * Period metrics for re-entry analysis (from @quantbot/analytics)
 */
export interface PeriodMetrics {
  /** Period ATH (highest price in the analysis period) */
  periodAthPrice: number;
  periodAthTimestamp: number;
  periodAthMultiple: number;
  timeToPeriodAthMinutes: number;
  /** Period ATL (lowest price before period ATH) */
  periodAtlPrice: number;
  periodAtlTimestamp?: number;
  periodAtlMultiple: number;
  /** Post-ATH drawdown (lowest price after period ATH) */
  postAthDrawdownPrice?: number;
  postAthDrawdownTimestamp?: number;
  postAthDrawdownPercent?: number;
  postAthDrawdownMultiple?: number;
  /** Re-entry opportunities detected */
  reEntryOpportunities?: Array<{
    timestamp: number;
    price: number;
    drawdownFromAth: number;
    recoveryMultiple?: number;
    recoveryTimestamp?: number;
  }>;
}

/**
 * Extended simulation result with metrics
 */
export interface ExtendedSimulationResult extends SimulationResult {
  /** Maximum drawdown (0-1) */
  maxDrawdown: number;
  /** Peak price reached */
  peakPrice: number;
  /** Realized volatility */
  volatility: number;
  /** Sharpe ratio */
  sharpeRatio: number;
  /** Sortino ratio */
  sortinoRatio: number;
  /** Hold duration in seconds */
  holdDuration: number;
  /** Number of targets hit */
  targetsHit: number;
  /** Total targets configured */
  totalTargets: number;
  /** Entry count (including re-entries) */
  entryCount: number;
  /** Re-entry count */
  reEntryCount: number;
  /** Ladder entries used */
  ladderEntriesUsed: number;
  /** Ladder exits used */
  ladderExitsUsed: number;
  /** Total fees paid */
  totalFees: number;
  /** Period-based ATH/ATL metrics (optional, calculated when enabled) */
  periodMetrics?: PeriodMetrics;
}

/**
 * Simulation metrics summary
 */
export interface SimulationMetrics {
  /** Average PnL */
  averagePnl: number;
  /** Median PnL */
  medianPnl: number;
  /** Win rate (0-1) */
  winRate: number;
  /** Profit factor */
  profitFactor: number;
  /** Average win */
  averageWin: number;
  /** Average loss */
  averageLoss: number;
  /** Max win */
  maxWin: number;
  /** Max loss */
  maxLoss: number;
  /** Standard deviation of returns */
  stdDev: number;
  /** Sharpe ratio */
  sharpeRatio: number;
  /** Sortino ratio */
  sortinoRatio: number;
  /** Maximum drawdown */
  maxDrawdown: number;
  /** Total trades */
  totalTrades: number;
  /** Winners */
  winners: number;
  /** Losers */
  losers: number;
  /** Breakeven trades */
  breakeven: number;
}

/**
 * Portfolio simulation result
 */
export interface PortfolioResult {
  /** Results by token */
  byToken: Map<string, ExtendedSimulationResult>;
  /** Aggregate metrics */
  metrics: SimulationMetrics;
  /** Total PnL */
  totalPnl: number;
  /** Total capital deployed */
  capitalDeployed: number;
  /** Capital efficiency */
  capitalEfficiency: number;
}

/**
 * Empty simulation result
 */
export const EMPTY_SIMULATION_RESULT: SimulationResult = {
  finalPnl: 0,
  events: [],
  entryPrice: 0,
  finalPrice: 0,
  totalCandles: 0,
  entryOptimization: {
    lowestPrice: 0,
    lowestPriceTimestamp: 0,
    lowestPricePercent: 0,
    lowestPriceTimeFromEntry: 0,
    trailingEntryUsed: false,
    actualEntryPrice: 0,
    entryDelay: 0,
  },
};

/**
 * Calculate metrics from results
 */
export function calculateMetrics(results: SimulationResult[]): SimulationMetrics {
  if (results.length === 0) {
    return {
      averagePnl: 0,
      medianPnl: 0,
      winRate: 0,
      profitFactor: 0,
      averageWin: 0,
      averageLoss: 0,
      maxWin: 0,
      maxLoss: 0,
      stdDev: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      totalTrades: 0,
      winners: 0,
      losers: 0,
      breakeven: 0,
    };
  }

  const pnls = results.map((r) => r.finalPnl - 1); // Convert to percentage return
  const sortedPnls = [...pnls].sort((a, b) => a - b);

  const sum = pnls.reduce((a, b) => a + b, 0);
  const avg = sum / pnls.length;
  const median = sortedPnls[Math.floor(sortedPnls.length / 2)];

  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const breakeven = pnls.filter((p) => p === 0).length;

  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalLosses = Math.abs(losses.reduce((a, b) => a + b, 0));

  const variance = pnls.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / pnls.length;
  const stdDev = Math.sqrt(variance);

  const downsideVariance =
    losses.reduce((sum, p) => sum + Math.pow(p, 2), 0) / Math.max(losses.length, 1);
  const downsideDev = Math.sqrt(downsideVariance);

  return {
    averagePnl: avg,
    medianPnl: median,
    winRate: wins.length / pnls.length,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    averageWin: wins.length > 0 ? totalWins / wins.length : 0,
    averageLoss: losses.length > 0 ? totalLosses / losses.length : 0,
    maxWin: Math.max(...wins, 0),
    maxLoss: Math.min(...losses, 0),
    stdDev,
    sharpeRatio: stdDev > 0 ? avg / stdDev : 0,
    sortinoRatio: downsideDev > 0 ? avg / downsideDev : 0,
    maxDrawdown: Math.abs(Math.min(...pnls, 0)),
    totalTrades: pnls.length,
    winners: wins.length,
    losers: losses.length,
    breakeven,
  };
}
