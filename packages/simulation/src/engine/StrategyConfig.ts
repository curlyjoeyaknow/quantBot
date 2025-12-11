/**
 * StrategyConfig - Types for strategy configuration
 * 
 * Aligns with strategies.config_json in Postgres.
 * This is a simplified version focused on Golden Path use cases.
 */

import type {
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  SignalGroup,
  LadderConfig,
} from '../config';

/**
 * Strategy configuration matching Postgres strategies.config_json
 */
export interface StrategyConfig {
  /** Strategy name (matches strategies.name) */
  name: string;
  
  /** Version (matches strategies.version) */
  version?: string;
  
  /** Legacy profit targets (array of target/percent pairs) */
  profitTargets?: StrategyLeg[];
  
  /** Stop loss configuration */
  stopLoss?: StopLossConfig;
  
  /** Entry configuration */
  entry?: EntryConfig;
  
  /** Re-entry configuration */
  reEntry?: ReEntryConfig;
  
  /** Hold duration in hours */
  holdHours?: number;
  
  /** Loss clamp: maximum loss as fraction (e.g., 0.2 for -20% max) */
  lossClampPercent?: number;
  
  /** Minimum exit price as fraction of entry */
  minExitPrice?: number;
  
  /** Optional indicator-based entry signals */
  entrySignal?: SignalGroup;
  
  /** Optional indicator-based exit signals */
  exitSignal?: SignalGroup;
  
  /** Optional laddered entry configuration */
  entryLadder?: LadderConfig;
  
  /** Optional laddered exit configuration */
  exitLadder?: LadderConfig;
  
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Convert Postgres config_json to StrategyConfig
 */
export function parseStrategyConfig(configJson: Record<string, unknown>): StrategyConfig {
  return configJson as StrategyConfig;
}

