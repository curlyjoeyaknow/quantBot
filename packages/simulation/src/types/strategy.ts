/**
 * Strategy Type Definitions
 * =========================
 * Types for trading strategy configuration.
 */

import type { SignalGroup, LadderConfig } from './signals';

/**
 * Take profit level configuration
 */
export interface TakeProfitLevel {
  /** Target price multiplier (e.g., 2 for 2x) */
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
  /** Trailing stop activation threshold as multiplier (e.g., 0.5 for +50%) */
  trailing: number | 'none';
  /** Trailing stop percent from peak (e.g., 0.25 for -25% from peak) */
  trailingPercent?: number;
  /** Rolling window size for trailing stop (number of candles) */
  trailingWindowSize?: number;
}

/**
 * Entry optimization configuration
 */
export interface EntryConfig {
  /** Wait for price drop before entry (e.g., -0.3 for 30% drop) */
  initialEntry: number | 'none';
  /** Trailing entry: wait for rebound from low (e.g., 0.1 for 10% rebound) */
  trailingEntry: number | 'none';
  /** Maximum wait time in minutes */
  maxWaitTime: number;
}

/**
 * Re-entry configuration
 */
export interface ReEntryConfig {
  /** Percent retrace from peak to trigger re-entry (e.g., 0.5 for 50%) */
  trailingReEntry: number | 'none';
  /** Maximum number of re-entries allowed */
  maxReEntries: number;
  /** Size of re-entry as fraction of original position (e.g., 0.5 for 50%) */
  sizePercent: number;
}

/**
 * Cost configuration
 */
export interface CostConfig {
  /** Entry slippage in basis points */
  entrySlippageBps: number;
  /** Exit slippage in basis points */
  exitSlippageBps: number;
  /** Taker fee in basis points */
  takerFeeBps: number;
  /** Borrow APR in basis points (for shorting) */
  borrowAprBps: number;
}

/**
 * Strategy leg (profit target)
 */
export interface StrategyLeg {
  /** Target multiplier */
  target: number;
  /** Percent of position to exit */
  percent: number;
}

/**
 * Complete strategy configuration
 */
export interface StrategyConfig {
  /** Strategy name */
  name: string;
  /** Strategy tags for categorization */
  tags?: string[];
  /** Take profit levels */
  profitTargets: StrategyLeg[];
  /** Stop loss configuration */
  stopLoss?: StopLossConfig;
  /** Entry optimization */
  entry?: EntryConfig;
  /** Re-entry configuration */
  reEntry?: ReEntryConfig;
  /** Cost configuration */
  costs?: CostConfig;
  /** Optional entry signal */
  entrySignal?: SignalGroup;
  /** Optional exit signal */
  exitSignal?: SignalGroup;
  /** Laddered entry configuration */
  entryLadder?: LadderConfig;
  /** Laddered exit configuration */
  exitLadder?: LadderConfig;
  /** Hold duration in hours */
  holdHours?: number;
  /** Notes/description */
  notes?: string;
}

/**
 * Default stop loss configuration
 */
export const DEFAULT_STOP_LOSS: StopLossConfig = {
  initial: -0.5,
  trailing: 0.5,
  trailingWindowSize: 20, // Default 20 candles for rolling window
};

/**
 * Default entry configuration
 */
export const DEFAULT_ENTRY: EntryConfig = {
  initialEntry: 'none',
  trailingEntry: 'none',
  maxWaitTime: 60,
};

/**
 * Default re-entry configuration
 */
export const DEFAULT_REENTRY: ReEntryConfig = {
  trailingReEntry: 'none',
  maxReEntries: 0,
  sizePercent: 0.5,
};

/**
 * Default cost configuration
 */
export const DEFAULT_COSTS: CostConfig = {
  entrySlippageBps: 0,
  exitSlippageBps: 0,
  takerFeeBps: 25,
  borrowAprBps: 0,
};

/**
 * Merge strategy config with defaults
 */
export function mergeWithDefaults(config: Partial<StrategyConfig>): StrategyConfig {
  return {
    name: config.name ?? 'default',
    profitTargets: config.profitTargets ?? [{ target: 2, percent: 1 }],
    stopLoss: config.stopLoss ? { ...DEFAULT_STOP_LOSS, ...config.stopLoss } : DEFAULT_STOP_LOSS,
    entry: config.entry ? { ...DEFAULT_ENTRY, ...config.entry } : DEFAULT_ENTRY,
    reEntry: config.reEntry ? { ...DEFAULT_REENTRY, ...config.reEntry } : DEFAULT_REENTRY,
    costs: config.costs ? { ...DEFAULT_COSTS, ...config.costs } : DEFAULT_COSTS,
    entrySignal: config.entrySignal,
    exitSignal: config.exitSignal,
    entryLadder: config.entryLadder,
    exitLadder: config.exitLadder,
    holdHours: config.holdHours,
    tags: config.tags,
    notes: config.notes,
  };
}
