/**
 * Metrics Types
 *
 * Types for computing simulation metrics.
 */

/**
 * Simulation metrics
 */
export interface SimulationMetrics {
  // PnL metrics
  totalPnl: number;
  totalPnlPercent: number;
  avgPnlPerTrade: number;
  maxPnl: number;
  minPnl: number;

  // Drawdown metrics
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxDrawdownDuration: number; // seconds

  // Risk-adjusted metrics
  sharpeRatio?: number; // Sharpe-like score (simplified)
  sortinoRatio?: number; // Sortino ratio

  // Trade metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor?: number; // Total wins / Total losses

  // Exposure metrics
  totalExposureTime: number; // seconds
  avgHoldTime: number; // seconds per trade
  maxHoldTime: number; // seconds

  // Additional metrics
  largestWin: number;
  largestLoss: number;
  consecutiveWins: number;
  consecutiveLosses: number;
}

/**
 * Equity curve point
 */
export interface EquityPoint {
  ts: number;
  capital: number;
  pnl: number;
  pnlPercent: number;
}
