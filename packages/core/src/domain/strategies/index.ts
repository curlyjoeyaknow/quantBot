/**
 * Strategy Domain Types
 */

import { DateTime } from 'luxon';

/**
 * Strategy configuration
 */
export interface StrategyConfig {
  name: string;
  version?: string;
  category?: string;
  description?: string;
  config: Record<string, unknown>; // Full strategy config JSON
  isActive: boolean;
  createdAt: DateTime;
  updatedAt: DateTime;
}

/**
 * Strategy leg definition (array of target/percent pairs)
 */
export interface StrategyLeg {
  target: number;
  percent: number;
}

/**
 * Represents a single take-profit target in a trading strategy.
 * Alias for StrategyLeg for backward compatibility.
 */
export type Strategy = StrategyLeg;

/**
 * Configuration for stop-loss logic in a simulation.
 */
export interface StopLossConfig {
  initial: number;
  trailing: number | 'none';
  activation?: number;
}

/**
 * Entry configuration for delayed/trailing entries
 */
export interface EntryConfig {
  initialEntry: number | 'none';
  trailingEntry: number | 'none';
  maxWaitTime: number;
}

/**
 * Re-entry configuration
 */
export interface ReEntryConfig {
  trailingReEntry: number | 'none';
  maxReEntries: number;
  sizePercent: number;
}

/**
 * Cost configuration for simulation
 */
export interface CostConfig {
  entrySlippageBps?: number;
  exitSlippageBps?: number;
  takerFeeBps?: number;
  borrowAprBps?: number;
}

/**
 * Call selection criteria for simulation
 *
 * Note: Uses DateTime for consistency with database entities and timezone handling.
 */
export interface CallSelection {
  callerIds?: number[];
  callerNames?: string[];
  tokenAddresses?: string[]; // TokenAddress type (avoiding circular import)
  from?: DateTime;
  to?: DateTime;
  side?: 'buy' | 'sell';
  signalTypes?: string[];
}

/**
 * Date range for queries
 *
 * Note: Uses DateTime for consistency with database entities and timezone handling.
 */
export interface DateRange {
  from: DateTime;
  to: DateTime;
}

/**
 * User-saved strategy with metadata
 */
export interface UserStrategy {
  id?: number;
  userId: number;
  name: string;
  description?: string;
  strategy: StrategyLeg[];
  stopLossConfig: StopLossConfig;
  isDefault: boolean;
  createdAt: DateTime;
}

