/**
 * Strategy Type Definitions
 * 
 * Defines types for trading strategies and their configurations
 */

/**
 * Single take-profit level
 */
export interface TakeProfitLevel {
  /** Target multiplier (e.g., 2 for 2x) */
  target: number;
  /** Fraction of position to sell (0-1) */
  percent: number;
}

/**
 * Stop loss configuration
 */
export interface StopLossConfig {
  /** Initial stop loss as fraction of entry (e.g., -0.3 for -30%) */
  initial: number;
  /** Trailing stop activation threshold (multiplier) */
  trailing?: number | 'none';
  /** Trailing stop percent (e.g., 0.25 for 25%) */
  trailingPercent?: number;
}

/**
 * Entry optimization configuration
 */
export interface EntryConfig {
  /** Wait for price drop before entry (e.g., -0.3 for 30% drop, 'none' for immediate) */
  initialEntry?: number | 'none';
  /** Trailing entry: wait for rebound from low (e.g., 0.1 for 10% rebound) */
  trailingEntry?: number | 'none';
  /** Maximum wait time in minutes */
  maxWaitTime?: number;
}

/**
 * Re-entry configuration
 */
export interface ReEntryConfig {
  /** Percent retrace from peak to trigger re-entry (e.g., 0.5 for 50%) */
  trailingReEntry?: number | 'none';
  /** Maximum number of re-entries allowed */
  maxReEntries?: number;
  /** Size of re-entry as fraction of original position (e.g., 0.5 for 50%) */
  sizePercent?: number;
}

/**
 * Complete strategy configuration
 */
export interface StrategyConfig {
  /** Strategy name */
  name: string;
  /** Take profit levels */
  profitTargets: TakeProfitLevel[];
  /** Stop loss configuration */
  stopLoss?: StopLossConfig;
  /** Entry optimization */
  entry?: EntryConfig;
  /** Re-entry configuration */
  reEntry?: ReEntryConfig;
  /** Hold duration in hours */
  holdHours?: number;
  /** Loss clamp: maximum loss as fraction (e.g., 0.2 for -20% max) */
  lossClampPercent?: number;
  /** Minimum exit price as fraction of entry */
  minExitPrice?: number;
}

/**
 * Strategy preset identifier
 */
export type StrategyPresetName = 
  | 'basic-6h-20pct-sl'
  | 'conservative-24h'
  | 'aggressive-multi-tp'
  | 'trailing-stop-20pct'
  | 'buy-the-dip-30pct'
  | string; // Allow custom presets

